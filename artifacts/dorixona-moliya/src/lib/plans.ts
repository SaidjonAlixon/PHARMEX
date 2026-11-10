export type PlanCode = 'starter' | 'business' | 'enterprise';

export type PlanCard = {
  code: PlanCode;
  name: string;
  priceUzs: number;
  branchLimit: number | null;
  telegram: boolean;
  highlight?: boolean;
  features: string[];
};

export const PUBLIC_PLANS: PlanCard[] = [
  {
    code: 'starter',
    name: 'Starter',
    priceUzs: 300_000,
    branchLimit: 2,
    telegram: false,
    features: [
      '2 ta filial',
      'Savdo, zaxira, kassa',
      'Asosiy hisobotlar',
      'Kompaniya ichida foydalanuvchilar',
      '7 kun bepul sinov',
    ],
  },
  {
    code: 'business',
    name: 'Business',
    priceUzs: 450_000,
    branchLimit: 5,
    telegram: false,
    highlight: true,
    features: [
      '5 ta filial',
      'Barcha modullar toʻliq',
      'Qarzlar, foyda-zarar, Excel/PDF',
      'FOM F-APTEKA integratsiyasi',
      'Kompaniya admin paneli',
    ],
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    priceUzs: 700_000,
    branchLimit: null,
    telegram: true,
    features: [
      'Istalgancha filial',
      'Business dagi barcha imkoniyatlar',
      'Telegram bot xabarnomalari',
      'Ustuvor qoʻllab-quvvatlash',
      'Kengaytirilgan monitoring',
    ],
  },
];

export function formatUzs(n: number): string {
  return `${n.toLocaleString('uz-UZ')} soʻm`;
}
