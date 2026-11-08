import { StatusBadge, date, qty, unitLabel } from '@/components/kit';

export function expiryDaysOf(value?: string | null) {
  if (!value) return null;
  return Math.floor((new Date(`${value}T00:00:00`).getTime() - Date.now()) / 86400000);
}

export function expiryBadge(value?: string | null, expiryDays?: number | null) {
  const days = expiryDays ?? expiryDaysOf(value);
  if (days == null) return null;
  if (days < 0) return <StatusBadge tone="bad">Muddati oʻtgan · {Math.abs(days)} kun</StatusBadge>;
  if (days <= 90) return <StatusBadge tone="warn">{days} kun qoldi</StatusBadge>;
  return <StatusBadge tone="good">Yaroqli</StatusBadge>;
}

export function daysAgoLabel(days: number | null | undefined) {
  if (days == null) return 'Hech qachon';
  if (days === 0) return 'Bugun';
  if (days === 1) return '1 kun';
  return `${days} kun`;
}

export function QtyCell({ quantity, unit }: { quantity: number; unit?: string | null }) {
  const openPack = quantity > 0 && quantity < 1;
  return (
    <div className={`stock-qty ${quantity <= 0 ? 'is-empty' : openPack ? 'is-low' : ''}`}>
      <b>{qty(quantity)}</b>
      <span>{unitLabel(unit)}</span>
      {openPack && <em>ochilgan</em>}
    </div>
  );
}

export function ExpiryCell({ value, days }: { value?: string | null; days?: number | null }) {
  if (!value) return <span className="muted">—</span>;
  return (
    <div className="expiry-cell">
      <span>{date(value)}</span>
      {expiryBadge(value, days)}
    </div>
  );
}
