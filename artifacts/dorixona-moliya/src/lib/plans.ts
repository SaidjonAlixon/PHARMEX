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
    branchLimit: 50,
    telegram: true,
    features: [
      'Click toʻlovdan keyin ochiladi',
      '50 tagacha filial',
      'Biznes dagi barcha imkoniyatlar',
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

export function planCta(p: PlanCard): { href: string; label: string; primary: boolean } {
  if (p.code === 'starter') {
    return { href: '/sign-up', label: '7 kun bepul boshlash', primary: true };
  }
  if (p.applyOnly || p.code === 'custom') {
    return { href: '/sign-up?plan=custom', label: 'Ariza qoldirish', primary: true };
  }
  return { href: '/sign-in?next=/tariflar', label: 'Obuna olish', primary: false };
}
