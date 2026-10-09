import { eq } from "drizzle-orm";
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
import { loadInventory, loadSaleLines } from "./queries";

const router: IRouter = Router();

router.get("/sales", async (req, res): Promise<void> => {
  const parsed = ListSalesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const mode = await getDataMode();
  const rows = await loadSaleLines({
    mode,
    dateFrom: parsed.data.dateFrom,
    dateTo: parsed.data.dateTo,
    branchId: parsed.data.branchId,
    paymentType: parsed.data.paymentType,
    search: parsed.data.search,
    limit: parsed.data.limit,
  });
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
  const rows = await loadInventory({
    mode,
    branchId: parsed.data.branchId,
    search: parsed.data.search,
  });
  res.json(ListInventoryResponse.parse(rows));
});

router.get("/product-detail", async (req, res): Promise<void> => {
  const parsed = GetProductQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [product] = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.id, parsed.data.productId))
    .limit(1);
  if (!product) {
    res.status(404).json({ error: "Mahsulot topilmadi." });
    return;
  }

  const mode = await getDataMode();
  const branchBalances = (await loadInventory({ mode })).filter(
    (item) => item.productId === product.id,
  );
  if (branchBalances.length === 0) {
    res.status(404).json({ error: "Mahsulot qoldig‘i topilmadi." });
    return;
  }
  res.json(
    GetProductResponse.parse({
      product: branchBalances[0],
      branchBalances,
    }),
  );
});

export default router;
