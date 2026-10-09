import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  counterpartiesTable,
  db,
  inventoryBalancesTable,
  productsTable,
} from "@workspace/db";
import {
  CreateCounterpartyBody,
  CreateCounterpartyResponse,
  CreateProductBody,
  CreateProductResponse,
  ListCounterpartiesQueryParams,
  ListCounterpartiesResponse,
  ListProductsQueryParams,
  ListProductsResponse,
} from "@workspace/api-zod";
import { requireRole } from "../middlewares/requireClerkUser";
import { actorOf, audit, dateOnlyString } from "../lib/ledger";
import { centsMoney, getDataMode, moneyCents, sourceCondition, toNumber } from "./financialUtils";
import { loadDebts } from "./queries";

const router: IRouter = Router();

function isUniqueViolation(error: unknown) {
  const cause = (error as { cause?: { code?: string } })?.cause;
  return (error as { code?: string })?.code === "23505" || cause?.code === "23505";
}

async function loadProducts(search?: string, productId?: number) {
  const mode = await getDataMode();
  const rows = await db
    .select({
      id: productsTable.id,
      name: productsTable.name,
      code: productsTable.code,
      barcode: productsTable.barcode,
      group: productsTable.groupName,
      unit: productsTable.unit,
      manufacturer: productsTable.manufacturer,
      ikpu: productsTable.ikpu,
      fomId: productsTable.fomId,
      retailPrice: productsTable.retailPrice,
      costPrice: productsTable.costPrice,
      vatRate: productsTable.vatRate,
      expiryDate: productsTable.expiryDate,
      source: productsTable.source,
      stock: sql<string>`coalesce((select sum(${inventoryBalancesTable.quantity}) from ${inventoryBalancesTable} where ${inventoryBalancesTable.productId} = ${productsTable.id}), 0)::text`,
    })
    .from(productsTable)
    .where(
      and(
        sourceCondition(productsTable.source, mode === "empty" ? "live" : mode),
        productId ? eq(productsTable.id, productId) : undefined,
        search
          ? or(
              ilike(productsTable.name, `%${search}%`),
              ilike(productsTable.code, `%${search}%`),
              ilike(productsTable.barcode, `%${search}%`),
              ilike(productsTable.manufacturer, `%${search}%`),
              ilike(productsTable.ikpu, `%${search}%`),
              eq(productsTable.fomId, search),
            )
          : undefined,
      ),
    )
    .orderBy(asc(productsTable.name))
    .limit(1000);
  return rows.map((row) => ({
    ...row,
    vatRate: toNumber(row.vatRate),
    stock: toNumber(row.stock),
  }));
}

router.get("/products", async (req, res): Promise<void> => {
  const parsed = ListProductsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.json(ListProductsResponse.parse(await loadProducts(parsed.data.search?.trim())));
});

router.post(
  "/products",
  requireRole("admin", "finance"),
  async (req, res): Promise<void> => {
    const parsed = CreateProductBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const input = parsed.data;
    const actor = actorOf(res.locals);
    try {
      const product = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(productsTable)
          .values({
            name: input.name.trim(),
            code: input.code?.trim() || null,
            barcode: input.barcode?.trim() || null,
            groupName: input.group?.trim() || "Boshqa",
            unit: input.unit?.trim() || "dona",
            retailPrice: input.retailPrice,
            vatRate: String(input.vatRate ?? 0),
            expiryDate: dateOnlyString(input.expiryDate),
            source: "manual",
          })
          .returning();
        await audit(tx, actor.id, "product.created", "product", created.id, `Mahsulot qo‘shildi: ${created.name}`);
        return created;
      });
      const [row] = await loadProducts(undefined, product.id);
      res.status(201).json(CreateProductResponse.parse(row));
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({ error: "Bu kod yoki shtrix-kod bilan mahsulot allaqachon mavjud." });
        return;
      }
      throw error;
    }
  },
);

async function loadCounterparties(filters: { kind?: string; search?: string; id?: number }) {
  const rows = await db
    .select()
    .from(counterpartiesTable)
    .where(
      and(
        filters.kind ? eq(counterpartiesTable.kind, filters.kind) : undefined,
        filters.id ? eq(counterpartiesTable.id, filters.id) : undefined,
        filters.search
          ? or(
              ilike(counterpartiesTable.name, `%${filters.search}%`),
              ilike(counterpartiesTable.taxId, `%${filters.search}%`),
              ilike(counterpartiesTable.phone, `%${filters.search}%`),
            )
          : undefined,
      ),
    )
    .orderBy(asc(counterpartiesTable.name));
  const debts = await loadDebts({ mode: await getDataMode() });
  return rows.map((row) => {
    const own = debts.filter((debt) => debt.counterpartyId === row.id);
    const sum = (kind: string) =>
      centsMoney(
        own
          .filter((debt) => debt.kind === kind)
          .reduce((total, debt) => total + moneyCents(debt.balance), 0n),
      );
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      taxId: row.taxId,
      phone: row.phone,
      note: row.note,
      payable: sum("payable"),
      receivable: sum("receivable"),
    };
  });
}

router.get("/counterparties", async (req, res): Promise<void> => {
  const parsed = ListCounterpartiesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.json(
    ListCounterpartiesResponse.parse(
      await loadCounterparties({
        kind: parsed.data.kind,
        search: parsed.data.search?.trim(),
      }),
    ),
  );
});

router.post(
  "/counterparties",
  requireRole("admin", "finance"),
  async (req, res): Promise<void> => {
    const parsed = CreateCounterpartyBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const input = parsed.data;
    const actor = actorOf(res.locals);
    try {
      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(counterpartiesTable)
          .values({
            name: input.name.trim(),
            kind: input.kind,
            taxId: input.taxId?.trim() ?? "",
            phone: input.phone?.trim() ?? "",
            note: input.note?.trim() ?? "",
          })
          .returning();
        await audit(tx, actor.id, "counterparty.created", "counterparty", row.id, `${row.kind === "supplier" ? "Yetkazib beruvchi" : "Mijoz"} qo‘shildi: ${row.name}`);
        return row;
      });
      const [row] = await loadCounterparties({ id: created.id });
      res.status(201).json(CreateCounterpartyResponse.parse(row));
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({ error: "Bu nomdagi hamkor allaqachon mavjud." });
        return;
      }
      throw error;
    }
  },
);

export default router;
