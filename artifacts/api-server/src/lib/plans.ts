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
    name: "Starter",
    priceUzs: 300_000,
    branchLimit: 2,
    telegram: false,
    features: [
      "2 ta filial",
      "Savdo, zaxira, kassa",
      "Asosiy hisobotlar",
      "Foydalanuvchilar (kompaniya ichida)",
      "7 kun bepul sinov",
    ],
  },
  business: {
    code: "business",
    name: "Business",
    priceUzs: 450_000,
    branchLimit: 5,
    telegram: false,
    highlight: true,
    features: [
      "5 ta filial",
      "Barcha modullar toʻliq",
      "Qarzlar, foyda-zarar, Excel/PDF",
      "FOM F-APTEKA integratsiyasi",
      "Kompaniya admin paneli",
    ],
  },
  enterprise: {
    code: "enterprise",
    name: "Enterprise",
    priceUzs: 700_000,
    branchLimit: null,
    telegram: true,
    features: [
      "Istalgancha filial",
      "Business dagi barcha imkoniyatlar",
      "Telegram bot xabarnomalari",
      "Ustuvor qoʻllab-quvvatlash",
      "Kengaytirilgan monitoring",
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
