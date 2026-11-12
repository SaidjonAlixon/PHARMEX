import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  db,
  productsTable,
} from "@workspace/db";
import {
  GetProductQueryParams,
  GetProductResponse,
  ListInventoryQueryParams,
  ListInventoryResponse,
  ListSalesQueryParams,
  ListSalesResponse,
} from "@workspace/api-zod";
import { getDataMode } from "./financialUtils";
import { loadInventory, loadSaleLines, loadWarehouseInsights, tenantOrgId, withTenant } from "./queries";
import { requireCompanyContext } from "../lib/org";

const router: IRouter = Router();
router.use(requireCompanyContext);

router.get("/sales", async (req, res): Promise<void> => {
  const parsed = ListSalesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const mode = await getDataMode();
  const rows = await loadSaleLines(withTenant(res, {
    mode,
    dateFrom: parsed.data.dateFrom,
    dateTo: parsed.data.dateTo,
    branchId: parsed.data.branchId,
    paymentType: parsed.data.paymentType,
    search: parsed.data.search,
    limit: parsed.data.limit,
  }));
  res.json(
    ListSalesResponse.parse(
      rows.map(
        ({
          costCents: _costCents,
          revenueCents: _revenueCents,
          ...sale
        }) => sale,
      ),
    ),
  );
});

router.get("/inventory", async (req, res): Promise<void> => {
  const parsed = ListInventoryQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const mode = await getDataMode();
  const rows = await loadInventory(withTenant(res, {
    mode,
    branchId: parsed.data.branchId,
    search: parsed.data.search,
  }));
  res.json(ListInventoryResponse.parse(rows));
});

/** Ombor: top sellers in the period + slow / unsold stock with last-sale age. */
router.get("/warehouse-insights", async (req, res): Promise<void> => {
  const parsed = ListSalesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const mode = await getDataMode();
  const data = await loadWarehouseInsights(withTenant(res, {
    mode,
    branchId: parsed.data.branchId,
    dateFrom: parsed.data.dateFrom,
    dateTo: parsed.data.dateTo,
  }));
  res.json(data);
});

/** One product: every sale/return line (when + qty + sum). */
router.get("/product-sales", async (req, res): Promise<void> => {
  const productId = Number(req.query.productId);
  if (!Number.isFinite(productId) || productId < 1) {
    res.status(400).json({ error: "productId majburiy." });
    return;
  }
  const dateFrom = req.query.dateFrom ? new Date(String(req.query.dateFrom)) : undefined;
  const dateTo = req.query.dateTo ? new Date(String(req.query.dateTo)) : undefined;
  const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
  const limitRaw = req.query.limit ? Number(req.query.limit) : 200;
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), 500) : 200;
  const mode = await getDataMode();
  const rows = await loadSaleLines(withTenant(res, {
    mode,
    productId,
    branchId: Number.isFinite(branchId) && (branchId as number) >= 1 ? branchId : undefined,
    dateFrom: dateFrom && !Number.isNaN(dateFrom.getTime()) ? dateFrom : undefined,
    dateTo: dateTo && !Number.isNaN(dateTo.getTime()) ? dateTo : undefined,
    limit,
  }));
  res.json(
    ListSalesResponse.parse(
      rows.map(({ costCents: _c, revenueCents: _r, ...sale }) => sale),
    ),
  );
});

router.get("/product-detail", async (req, res): Promise<void> => {
  const parsed = GetProductQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const orgId = tenantOrgId(res);
  const [product] = await db
    .select()
    .from(productsTable)
    .where(and(eq(productsTable.id, parsed.data.productId), eq(productsTable.organizationId, orgId)))
    .limit(1);
  if (!product) {
    res.status(404).json({ error: "Mahsulot topilmadi." });
    return;
  }

  const mode = await getDataMode();
  const branchBalances = (await loadInventory(withTenant(res, { mode }))).filter(
    (item) => item.productId === product.id,
  );
  // FOM versions without the stock report (6) send products with no balances; the card still opens.
  const summary = branchBalances[0] ?? {
    productId: product.id,
    productName: product.name,
    barcode: product.barcode,
    group: product.groupName,
    manufacturer: product.manufacturer,
    ikpu: product.ikpu,
    unit: product.unit || "dona",
    branchId: 0,
    branchName: "Qoldiq maʼlumoti yoʻq",
    quantity: 0,
    costPrice: product.costPrice,
    retailPrice: product.retailPrice,
    value: null,
    expiryDate: product.expiryDate,
    source: product.source,
  };
  res.json(GetProductResponse.parse({ product: summary, branchBalances }));
});

export default router;
