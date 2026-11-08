import { date, money, sourceText } from '@/components/kit';
import { moneyTypeLabels, paymentLabels } from '@/lib/labels';

const MONEY_COLS = new Set([
  'Tushum', 'Tannarx', 'Yalpi foyda', 'Summa', 'Qiymat',
  'Sof sotuv', 'Xarajatlar', 'Sof foyda', 'Boshlang‘ich qarz', "Boshlang'ich qarz",
  'To‘langan', "To'langan", 'Qoldiq', 'Jami',
]);

const DEBT_KIND: Record<string, string> = {
  payable: 'Kreditor (biz qarzdormiz)',
  receivable: 'Debitor (bizdan qarzdor)',
};

function normalizeCol(col: string) {
  return col.normalize('NFC').replace(/['ʻ’‘`´]/g, "'");
}

/** Hisobot jadvali / PDF / Excel uchun odam oʻqiydigan qiymat. */
export function formatReportCell(column: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';

  if (typeof value === 'object') {
    if (value instanceof Date) return date(value.toISOString());
    return JSON.stringify(value);
  }

  const col = normalizeCol(column);
  const raw = String(value);

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T|$)/.test(value)) {
    return date(value);
  }

  if (col === 'Manba' || col === 'Source') {
    const labeled = sourceText(raw);
    return labeled !== '—' ? labeled : raw;
  }

  if (col === "To'lov" || col === 'Tolov' || col === 'Payment') {
    return paymentLabels[raw] ?? raw;
  }

  if (col === 'Turi') {
    return moneyTypeLabels[raw] ?? DEBT_KIND[raw] ?? raw;
  }

  if (MONEY_COLS.has(column) || MONEY_COLS.has(col) || /foyda|summa|tannarx|tushum|qarz|qoldiq|qiymat|sotuv|xarajat/i.test(col)) {
    if (raw !== '—' && raw !== '' && Number.isFinite(Number(raw))) return money(raw);
  }

  return raw;
}
