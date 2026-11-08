import { StatusBadge, date, qty, unitLabel } from '@/components/kit';

/** Calendar day YYYY-MM-DD from API date / ISO / Date. */
export function expiryDay(value?: string | Date | null): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : null;
}

/** Days from today (Tashkent calendar) to expiry: negative = already expired. */
export function expiryDaysOf(value?: string | Date | null): number | null {
  const day = expiryDay(value);
  if (!day) return null;
  const today = new Date();
  // Compare calendar days in local offset used by the app (UTC+5).
  const tz = 5 * 60 * 60 * 1000;
  const todayDay = new Date(today.getTime() + tz).toISOString().slice(0, 10);
  const a = Date.parse(`${todayDay}T00:00:00Z`);
  const b = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

export function expiryBadge(value?: string | Date | null, expiryDays?: number | null) {
  const days = expiryDays ?? expiryDaysOf(value);
  if (days == null || !Number.isFinite(days)) return null;
  if (days < 0) {
    const n = Math.abs(days);
    return <StatusBadge tone="bad">Muddati oʻtgan · {n} kun</StatusBadge>;
  }
  if (days === 0) return <StatusBadge tone="warn">Muddati bugun tugaydi</StatusBadge>;
  if (days <= 30) return <StatusBadge tone="warn">Muddati {days} kun qoldi</StatusBadge>;
  if (days <= 90) return <StatusBadge tone="warn">Muddati {days} kun qoldi</StatusBadge>;
  return <StatusBadge tone="good">Muddati {days} kun qoldi</StatusBadge>;
}

export function daysAgoLabel(days: number | null | undefined) {
  if (days == null) return 'Hech qachon';
  if (days === 0) return 'Bugun';
  if (days === 1) return '1 kun';
  return `${days} kun`;
}

/** Short status for slow-mover teasers / lists. */
export function slowStatusLabel(row: {
  expired?: boolean;
  expiryDays?: number | null;
  lastSoldAt?: string | null;
  daysSinceSale?: number | null;
  soldQty?: number;
}) {
  if (row.expired) {
    const n = row.expiryDays != null ? Math.abs(row.expiryDays) : null;
    return n != null ? `Muddati oʻtgan · ${n} kun` : 'Muddati oʻtgan';
  }
  if (row.lastSoldAt == null) return 'Sotilmagan';
  if ((row.soldQty ?? 0) <= 0) return `${daysAgoLabel(row.daysSinceSale)} · kam`;
  return `${daysAgoLabel(row.daysSinceSale)} oldin`;
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

export function ExpiryCell({ value, days }: { value?: string | Date | null; days?: number | null }) {
  const day = expiryDay(value);
  if (!day) return <span className="muted">—</span>;
  const d = days ?? expiryDaysOf(day);
  return (
    <div className="expiry-cell">
      <span>{date(day)}</span>
      {expiryBadge(day, d)}
    </div>
  );
}
