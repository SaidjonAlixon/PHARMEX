import { createHash, randomBytes } from "node:crypto";

export type ClickConfig = {
  serviceId: string;
  merchantId: string;
  secretKey: string;
  merchantUserId: string;
};

export function clickConfig(): ClickConfig | null {
  const serviceId = process.env.CLICK_SERVICE_ID?.trim();
  const merchantId = process.env.CLICK_MERCHANT_ID?.trim();
  const secretKey = process.env.CLICK_SECRET_KEY?.trim();
  const merchantUserId = process.env.CLICK_MERCHANT_USER_ID?.trim() || "";
  if (!serviceId || !merchantId || !secretKey) return null;
  return { serviceId, merchantId, secretKey, merchantUserId };
}

export function md5(s: string): string {
  return createHash("md5").update(s, "utf8").digest("hex");
}

export function verifyPrepareSign(p: Record<string, string>, secret: string): boolean {
  const raw =
    `${p.click_trans_id}${p.service_id}${secret}${p.merchant_trans_id}${p.amount}${p.action}${p.sign_time}`;
  return md5(raw) === String(p.sign_string || "").toLowerCase() || md5(raw) === p.sign_string;
}

export function verifyCompleteSign(p: Record<string, string>, secret: string): boolean {
  const raw =
    `${p.click_trans_id}${p.service_id}${secret}${p.merchant_trans_id}${p.merchant_prepare_id}${p.amount}${p.action}${p.sign_time}`;
  return md5(raw) === String(p.sign_string || "").toLowerCase() || md5(raw) === p.sign_string;
}

export function newMerchantTransId(): string {
  return `px_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

export function newPrepareId(): number {
  return Date.now() % 2147483647;
}

export function clickPayUrl(opts: {
  serviceId: string;
  merchantId: string;
  amount: number;
  merchantTransId: string;
  returnUrl: string;
}): string {
  const u = new URL("https://my.click.uz/services/pay");
  u.searchParams.set("service_id", opts.serviceId);
  u.searchParams.set("merchant_id", opts.merchantId);
  u.searchParams.set("amount", String(opts.amount));
  u.searchParams.set("transaction_param", opts.merchantTransId);
  u.searchParams.set("return_url", opts.returnUrl);
  return u.toString();
}

export function parseClickBody(body: unknown): Record<string, string> {
  if (!body || typeof body !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    out[k] = v == null ? "" : String(v);
  }
  return out;
}
