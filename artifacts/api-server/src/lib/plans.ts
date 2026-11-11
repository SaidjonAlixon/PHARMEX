export type PlanCode = "starter" | "business" | "enterprise" | "custom";

export type PlanDef = {
  code: PlanCode;
  name: string;
  priceUzs: number;
  branchLimit: number | null;
  telegram: boolean;
  features: string[];
  highlight?: boolean;
  /** Maxsus — Click toʻlov yoʻq, faqat ariza */
  applyOnly?: boolean;
};

export const PLANS: Record<PlanCode, PlanDef> = {
  starter: {
    code: "starter",
    name: "Boshlangʻich",
    priceUzs: 299_000,
    branchLimit: 2,
    telegram: false,
    features: [
      "7 kun bepul sinov",
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
      "5 ta filial",
      "Qarzdorliklar nazorati",
      "Barcha modullar toʻliq",
      "Foyda-zarar, Excel/PDF",
      "FOM F-APTEKA integratsiyasi",
    ],
  },
  enterprise: {
    code: "enterprise",
    name: "Korxona",
    priceUzs: 799_000,
    branchLimit: 50,
    telegram: true,
    features: [
      "50 tagacha filial",
      "Sverka va solishtirish",
      "Biznesdagi barcha imkoniyatlar",
      "Telegram bot xabarnomalari",
      "Ustuvor qoʻllab-quvvatlash",
    ],
  },
  custom: {
    code: "custom",
    name: "Maxsus",
    priceUzs: 0,
    branchLimit: null,
    telegram: true,
    applyOnly: true,
    features: [
      "Moslashuvchan narx va shartlar",
      "Istalgancha filial",
      "Barcha modullar toʻliq ochiq",
      "Telegram + shaxsiy menejer",
      "Individual integratsiya va trening",
    ],
  },
};

export const TRIAL_DAYS = 7;
export const PLAN_PERIOD_DAYS = 30;

export function isPlanCode(v: unknown): v is PlanCode {
  return v === "starter" || v === "business" || v === "enterprise" || v === "custom";
}

export function isPayablePlan(v: unknown): v is Exclude<PlanCode, "custom"> {
  return isPlanCode(v) && !PLANS[v].applyOnly;
}

export function planList(): PlanDef[] {
  return [PLANS.starter, PLANS.business, PLANS.enterprise, PLANS.custom];
}
