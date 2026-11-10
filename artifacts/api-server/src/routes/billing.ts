import { desc, eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, organizationsTable, paymentsTable } from "@workspace/db";
import { requireClerkUser, requireRole } from "../middlewares/requireClerkUser";
import {
  clickConfig,
  clickPayUrl,
  clickWidgetParams,
  newMerchantTransId,
  newPrepareId,
  parseClickBody,
  verifyCompleteSign,
  verifyPrepareSign,
} from "../lib/click";
import { PLANS, PLAN_PERIOD_DAYS, isPlanCode, planList } from "../lib/plans";
import { loadOrganization, publicOrganization, requireOrgId } from "../lib/org";
import { notifyOrgTelegram } from "../lib/telegram";

const router: IRouter = Router();

router.get("/billing/plans", (_req, res): void => {
  res.json({
    trialDays: 7,
    currency: "UZS",
    plans: planList().map((p) => ({
      code: p.code,
      name: p.name,
      priceUzs: p.priceUzs,
      branchLimit: p.branchLimit,
      telegram: p.telegram,
      features: p.features,
      highlight: Boolean(p.highlight),
    })),
  });
});

router.get("/billing/subscription", requireClerkUser, async (_req, res): Promise<void> => {
  if (res.locals.userRole === "platform_admin") {
    res.json({ organization: null, plans: planList() });
    return;
  }
  const org = (res.locals.organization as Awaited<ReturnType<typeof loadOrganization>>) ?? null;
  res.json({ organization: publicOrganization(org), plans: planList() });
});

router.post("/billing/checkout", requireClerkUser, async (req, res): Promise<void> => {
  const role = String(res.locals.userRole ?? "");
  if (role === "platform_admin") {
    res.status(403).json({
      error: "Platforma egasi toʻlov qilmaydi. Kompaniya admini login/paroli bilan kabinetga kiring, soʻng Tariflar orqali toʻlang.",
      code: "company_login_required",
    });
    return;
  }
  if (role !== "admin" && role !== "finance") {
    res.status(403).json({
      error: "Obuna toʻlovini faqat kompaniya administratori (yoki moliya) qila oladi. Kuzatuvchiga ruxsat yoʻq.",
      code: "role_forbidden",
      role,
    });
    return;
  }
  const cfg = clickConfig();
  if (!cfg) {
    res.status(503).json({ error: "Click toʻlov hozircha sozlanmagan. Platforma egasiga murojaat qiling." });
    return;
  }
  const orgId = requireOrgId(res);
  if (!orgId) {
    res.status(403).json({ error: "Kompaniya akkaunti topilmadi. Avval ariza tasdiqlangan login bilan kiring." });
    return;
  }
  const planCode = req.body?.planCode;
  if (!isPlanCode(planCode)) {
    res.status(400).json({ error: "Notoʻgʻri tarif." });
    return;
  }
  const plan = PLANS[planCode];
  const paymentMethod = req.body?.paymentMethod === "click" ? "click" : "card";
  const merchantTransId = newMerchantTransId();
  await db.insert(paymentsTable).values({
    organizationId: orgId,
    planCode,
    amount: plan.priceUzs,
    status: "pending",
    merchantTransId,
  });
  const origin = (process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  const returnUrl = `${origin}/tariflar?paid=1&method=${paymentMethod}`;
  const url = clickPayUrl({
    serviceId: cfg.serviceId,
    merchantId: cfg.merchantId,
    merchantUserId: cfg.merchantUserId,
    amount: plan.priceUzs,
    merchantTransId,
    returnUrl,
    paymentMethod,
  });
  const widget = clickWidgetParams({
    serviceId: cfg.serviceId,
    merchantId: cfg.merchantId,
    merchantUserId: cfg.merchantUserId,
    amount: plan.priceUzs,
    merchantTransId,
  });
  res.json({
    url,
    merchantTransId,
    amount: plan.priceUzs,
    planCode,
    paymentMethod,
    /** Use with checkout.js createPaymentRequest for in-page card form (no app/QR hijack). */
    widget,
    returnUrl,
  });
});

async function handleClick(req: Request, res: Response): Promise<void> {
  const cfg = clickConfig();
  if (!cfg) {
    res.json({ error: -1, error_note: "Click not configured" });
    return;
  }
  const p = parseClickBody(req.body);
  const action = Number(p.action);
  if (action === 0) {
    if (!verifyPrepareSign(p, cfg.secretKey)) {
      res.json({ error: -1, error_note: "Invalid sign" });
      return;
    }
    const [payment] = await db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.merchantTransId, p.merchant_trans_id))
      .limit(1);
    if (!payment) {
      res.json({ error: -5, error_note: "Payment not found" });
      return;
    }
    if (payment.status === "paid") {
      res.json({
        click_trans_id: p.click_trans_id,
        merchant_trans_id: p.merchant_trans_id,
        merchant_prepare_id: payment.prepareId,
        error: -4,
        error_note: "Already paid",
      });
      return;
    }
    if (Number(p.amount) !== payment.amount) {
      res.json({ error: -2, error_note: "Incorrect amount" });
      return;
    }
    const prepareId = payment.prepareId ?? newPrepareId();
    await db
      .update(paymentsTable)
      .set({
        status: "prepared",
        prepareId,
        clickTransId: p.click_trans_id,
        clickPaydocId: p.click_paydoc_id || null,
      })
      .where(eq(paymentsTable.id, payment.id));
    res.json({
      click_trans_id: p.click_trans_id,
      merchant_trans_id: p.merchant_trans_id,
      merchant_prepare_id: prepareId,
      error: 0,
      error_note: "Success",
    });
    return;
  }

  if (action === 1) {
    if (!verifyCompleteSign(p, cfg.secretKey)) {
      res.json({ error: -1, error_note: "Invalid sign" });
      return;
    }
    const [payment] = await db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.merchantTransId, p.merchant_trans_id))
      .limit(1);
    if (!payment) {
      res.json({ error: -5, error_note: "Payment not found" });
      return;
    }
    if (payment.status === "paid") {
      res.json({
        click_trans_id: p.click_trans_id,
        merchant_trans_id: p.merchant_trans_id,
        merchant_prepare_id: payment.prepareId,
        error: -4,
        error_note: "Already paid",
      });
      return;
    }
    if (Number(p.error) < 0) {
      await db
        .update(paymentsTable)
        .set({ status: "failed", errorNote: p.error_note || "Click error" })
        .where(eq(paymentsTable.id, payment.id));
      res.json({
        click_trans_id: p.click_trans_id,
        merchant_trans_id: p.merchant_trans_id,
        merchant_prepare_id: payment.prepareId,
        error: -9,
        error_note: "Transaction cancelled",
      });
      return;
    }
    if (String(payment.prepareId) !== String(p.merchant_prepare_id)) {
      res.json({ error: -6, error_note: "prepare_id mismatch" });
      return;
    }
    const plan = isPlanCode(payment.planCode) ? PLANS[payment.planCode] : PLANS.starter;
    const expires = new Date(Date.now() + PLAN_PERIOD_DAYS * 24 * 60 * 60 * 1000);
    await db
      .update(paymentsTable)
      .set({
        status: "paid",
        paidAt: new Date(),
        clickTransId: p.click_trans_id,
        clickPaydocId: p.click_paydoc_id || null,
      })
      .where(eq(paymentsTable.id, payment.id));
    const [org] = await db
      .update(organizationsTable)
      .set({
        planCode: plan.code,
        subscriptionStatus: "active",
        planExpiresAt: expires,
        branchLimit: plan.branchLimit,
      })
      .where(eq(organizationsTable.id, payment.organizationId))
      .returning();
    if (org) {
      await notifyOrgTelegram(
        org.telegramChatId,
        plan.telegram,
        `<b>PHARMXS</b>\nToʻlov qabul qilindi: <b>${plan.name}</b>\nSumma: ${payment.amount.toLocaleString("uz-UZ")} soʻm\nAmal qiladi: ${expires.toLocaleDateString("uz-UZ")}`,
      );
    }
    res.json({
      click_trans_id: p.click_trans_id,
      merchant_trans_id: p.merchant_trans_id,
      merchant_prepare_id: payment.prepareId,
      error: 0,
      error_note: "Success",
    });
    return;
  }

  res.json({ error: -3, error_note: "Unknown action" });
}

router.post("/billing/click/prepare", handleClick);
router.post("/billing/click/complete", handleClick);
// Some Click setups post both to one URL:
router.post("/billing/click", handleClick);

router.get("/billing/payments", requireClerkUser, requireRole("admin"), async (_req, res): Promise<void> => {
  const orgId = requireOrgId(res);
  if (!orgId) {
    res.json([]);
    return;
  }
  const rows = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.organizationId, orgId))
    .orderBy(desc(paymentsTable.createdAt))
    .limit(50);
  res.json(rows);
});

router.post("/billing/telegram", requireClerkUser, requireRole("admin"), async (req, res): Promise<void> => {
  const orgId = requireOrgId(res);
  if (!orgId) {
    res.status(403).json({ error: "Kompaniya topilmadi." });
    return;
  }
  const org = await loadOrganization(orgId);
  if (!org || !isPlanCode(org.planCode) || !PLANS[org.planCode].telegram) {
    res.status(403).json({ error: "Telegram faqat Korxona tarifida." });
    return;
  }
  const chatId = typeof req.body?.chatId === "string" ? req.body.chatId.trim() : "";
  if (!chatId) {
    res.status(400).json({ error: "Telegram chat ID kiriting." });
    return;
  }
  const [updated] = await db
    .update(organizationsTable)
    .set({ telegramChatId: chatId })
    .where(eq(organizationsTable.id, orgId))
    .returning();
  await notifyOrgTelegram(chatId, true, "<b>PHARMXS</b>\nTelegram xabarnomalari yoqildi.");
  res.json(publicOrganization(updated));
});

export default router;
