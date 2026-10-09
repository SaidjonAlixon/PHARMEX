export const paymentLabels: Record<string, string> = {
  cash: 'Naqd',
  card: 'Karta',
  transfer: 'Oʻtkazma',
  credit: 'Nasiya',
  other: 'Boshqa',
  mixed: 'Aralash',
};

export const moneyTypeLabels: Record<string, string> = {
  sale: 'Savdo tushumi',
  sale_refund: 'Mijozga qaytarilgan pul',
  sale_void: 'Bekor qilingan chek',
  cash_in: 'Naqd kirim',
  cash_out: 'Naqd chiqim',
  bank_receipt: 'Bank hisobiga tushum',
  encashment: 'Inkassatsiya',
  transfer: 'Hisoblararo oʻtkazma',
  supplier_payment: 'Yetkazib beruvchiga toʻlov',
  supplier_refund: 'Yetkazib beruvchidan qaytgan pul',
  customer_payment: 'Mijozdan qarz undirildi',
  expense: 'Xarajat',
  owner_in: 'Egalar kiritgan mablagʻ',
  owner_out: 'Egalar olgan mablagʻ',
  Xarajat: 'Xarajat',
};

export const stockDocLabels: Record<string, string> = {
  transfer: 'Oʻtkazma',
  write_off: 'Hisobdan chiqarish',
  supplier_return: 'Yetkazib beruvchiga qaytarish',
  customer_return: 'Mijozdan qaytgan tovar',
  inventory_count: 'Inventarizatsiya',
};

export const movementLabels: Record<string, string> = {
  purchase: 'Kirim',
  sale: 'Sotuv',
  sale_void: 'Bekor qilingan sotuv',
  customer_return: 'Mijozdan qaytdi',
  transfer_out: 'Oʻtkazma (chiqim)',
  transfer_in: 'Oʻtkazma (kirim)',
  write_off: 'Hisobdan chiqarildi',
  supplier_return: 'Yetkazib beruvchiga qaytdi',
  inventory_surplus: 'Ortiqcha',
  inventory_shortage: 'Kamomad',
  inventory_match: 'Mos keldi',
};

export const debtStateLabels: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' | 'info' }> = {
  open: { label: 'Ochiq', tone: 'info' },
  partial: { label: 'Qisman toʻlangan', tone: 'warn' },
  closed: { label: 'Yopilgan', tone: 'good' },
  overdue: { label: 'Muddati oʻtgan', tone: 'bad' },
  cancelled: { label: 'Bekor qilingan', tone: 'neutral' },
};

export const debtOriginLabels: Record<string, string> = {
  purchase: 'Kirim hujjati',
  sale: 'Nasiya savdo',
  manual: 'Qoʻlda kiritilgan',
  opening: 'Boshlangʻich qoldiq',
};

export const debtOperationLabels: Record<string, string> = {
  initial: 'Qarz paydo boʻldi',
  payment: 'Toʻlov',
  return: 'Qaytarish',
  writeoff: 'Hisobdan chiqarildi',
};

export const purchaseStatusLabels: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' | 'info' }> = {
  paid: { label: 'Toʻlangan', tone: 'good' },
  partial: { label: 'Qisman toʻlangan', tone: 'warn' },
  unpaid: { label: 'Toʻlanmagan', tone: 'info' },
  overdue: { label: 'Muddati oʻtgan', tone: 'bad' },
};

export const expenseCategories = ['Ish haqi', 'Ijara', 'Kommunal xizmatlar', 'Soliq va yigʻimlar', 'Bank xizmati', 'Transport', 'Reklama', 'Xoʻjalik xarajati', 'Boshqa xarajat'];
export const writeOffReasons = ['Yaroqlilik muddati oʻtgan', 'Shikastlangan / singan', 'Sifatsiz tovar', 'Yoʻqolgan', 'Ichki ehtiyoj uchun', 'Boshqa sabab'];
export const units = ['dona', 'qadoq', 'blister', 'flakon', 'ampula', 'tyubik', 'shisha', 'kg', 'litr'];
