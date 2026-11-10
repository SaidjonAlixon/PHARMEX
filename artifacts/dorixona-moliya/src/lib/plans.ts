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
    name: 'Boshlangʻich',
    priceUzs: 299_000,
    branchLimit: 2,
    telegram: false,
    features: [
      '7 kun bepul sinov (faqat shu tarif)',
      '2 ta filial',
      'Savdo, zaxira, kassa',
      'Asosiy hisobotlar',
      'Kompaniya ichida foydalanuvchilar',
    ],
  },
  {
    code: 'business',
    name: 'Biznes',
    priceUzs: 499_000,
    branchLimit: 5,
    telegram: false,
    highlight: true,
    features: [
      'Click toʻlovdan keyin ochiladi',
      '5 ta filial',
      'Barcha modullar toʻliq',
      'Qarzlar, foyda-zarar, Excel/PDF',
      'FOM F-APTEKA integratsiyasi',
    ],
  },
  {
    code: 'enterprise',
    name: 'Korxona',
    priceUzs: 799_000,
    branchLimit: null,
    telegram: true,
    features: [
      'Click toʻlovdan keyin ochiladi',
      'Istalgancha filial',
      'Biznes dagi barcha imkoniyatlar',
      'Telegram bot xabarnomalari',
      'Ustuvor qoʻllab-quvvatlash',
    ],
  },
];

export function formatUzs(n: number): string {
  return `${n.toLocaleString('uz-UZ')} soʻm`;
}
