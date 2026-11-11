export type PlanCode = 'starter' | 'business' | 'enterprise' | 'custom';

export type PlanCard = {
  code: PlanCode;
  name: string;
  priceUzs: number;
  branchLimit: number | null;
  telegram: boolean;
  highlight?: boolean;
  /** Maxsus — toʻlov emas, ariza */
  applyOnly?: boolean;
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
      '7 kun bepul sinov',
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
      '5 ta filial',
      'Qarzdorliklar nazorati',
      'Barcha modullar toʻliq',
      'Foyda-zarar, Excel/PDF',
      'FOM F-APTEKA integratsiyasi',
    ],
  },
  {
    code: 'enterprise',
    name: 'Korxona',
    priceUzs: 799_000,
    branchLimit: 50,
    telegram: true,
    features: [
      '50 tagacha filial',
      'Sverka va solishtirish',
      'Biznesdagi barcha imkoniyatlar',
      'Telegram bot xabarnomalari',
      'Ustuvor qoʻllab-quvvatlash',
    ],
  },
  {
    code: 'custom',
    name: 'Maxsus',
    priceUzs: 0,
    branchLimit: null,
    telegram: true,
    applyOnly: true,
    features: [
      'Moslashuvchan narx va shartlar',
      'Istalgancha filial',
      'Barcha modullar toʻliq ochiq',
      'Telegram + shaxsiy menejer',
      'Individual integratsiya va trening',
    ],
  },
];

export function formatUzs(n: number): string {
  return `${n.toLocaleString('uz-UZ')} soʻm`;
}

export function planPriceLabel(p: Pick<PlanCard, 'priceUzs' | 'applyOnly' | 'code'>): string {
  if (p.applyOnly || p.code === 'custom' || p.priceUzs <= 0) return 'Kelishiladi';
  return formatUzs(p.priceUzs);
}

export function planCta(p: PlanCard): { href: string; label: string; kind: 'free' | 'pay' | 'apply' } {
  if (p.code === 'starter') {
    return { href: '/sign-up', label: 'Bepul boshlash', kind: 'free' };
  }
  if (p.applyOnly || p.code === 'custom') {
    return { href: '/sign-up?plan=custom', label: 'Ariza qoldirish', kind: 'apply' };
  }
  return { href: '/sign-in?next=/tariflar', label: 'Obuna olish', kind: 'pay' };
}
