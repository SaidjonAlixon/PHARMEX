export type PlanCode = "starter" | "business" | "enterprise";

export type PlanDef = {
  code: PlanCode;
  name: string;
  priceUzs: number;
  branchLimit: number | null;
  telegram: boolean;
  features: string[];
  highlight?: boolean;
};

export const PLANS: Record<PlanCode, PlanDef> = {
  starter: {
    code: "starter",
    name: "Boshlangʻich",
    priceUzs: 299_000,
    branchLimit: 2,
    telegram: false,
    features: [
      "7 kun bepul sinov (faqat shu tarif)",
      "2 ta filial",
      "Savdo, zaxira, kassa",
      "Asosiy hisobotlar",
      "Foydalanuvchilar (kompaniya ichida)",
    ],
  },
  business: {
    code: "business",
    name: "Biznes",
    priceUzs: 499_000,
    branchLimit: 5,
    telegram: false,
    highlight: true,
    features: [
      "Click toʻlovdan keyin ochiladi",
      "5 ta filial",
      "Barcha modullar toʻliq",
      "Qarzlar, foyda-zarar, Excel/PDF",
      "FOM F-APTEKA integratsiyasi",
    ],
  },
  enterprise: {
    code: "enterprise",
    name: "Korxona",
    priceUzs: 799_000,
    branchLimit: null,
    telegram: true,
    features: [
      "Click toʻlovdan keyin ochiladi",
      "Istalgancha filial",
      "Biznes dagi barcha imkoniyatlar",
      "Telegram bot xabarnomalari",
      "Ustuvor qoʻllab-quvvatlash",
    ],
  },
};

export const TRIAL_DAYS = 7;
export const PLAN_PERIOD_DAYS = 30;

export function isPlanCode(v: unknown): v is PlanCode {
  return v === "starter" || v === "business" || v === "enterprise";
}

export function planList(): PlanDef[] {
  return [PLANS.starter, PLANS.business, PLANS.enterprise];
}
