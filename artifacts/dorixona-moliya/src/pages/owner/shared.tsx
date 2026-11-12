import { ReactNode } from 'react';

export type Creds = { username: string; password: string; title: string } | null;

export async function ownerApi<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Xatolik');
  return data as T;
}

export function money(n: number) {
  return `${Math.round(n).toLocaleString('uz-UZ')} soʻm`;
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('uz-UZ', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function formatDay(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('uz-UZ', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function subStatusLabel(s: string) {
  if (s === 'trialing') return 'Sinov';
  if (s === 'active') return 'Faol';
  if (s === 'past_due') return 'Muddati tugagan';
  if (s === 'canceled') return 'Bloklangan';
  return s;
}

export function payStatusLabel(s: string) {
  if (s === 'pending') return 'Kutilmoqda';
  if (s === 'prepared') return 'Jarayonda';
  if (s === 'paid') return 'Toʻlandi';
  if (s === 'failed') return 'Muvaffaqiyatsiz';
  if (s === 'canceled') return 'Bekor qilingan';
  return s;
}

export function userStatusLabel(s: string) {
  if (s === 'active') return 'Faol';
  if (s === 'pending') return 'Yangi';
  if (s === 'rejected') return 'Rad etildi';
  if (s === 'disabled') return 'Bloklangan';
  return s;
}

export function roleLabel(r: string) {
  if (r === 'admin') return 'Admin';
  if (r === 'viewer') return 'Kuzatuvchi';
  if (r === 'finance') return 'Moliya';
  return r;
}

export function StatusBadge({ tone, children }: { tone: 'ok' | 'warn' | 'danger' | 'muted' | 'info'; children: ReactNode }) {
  return <span className={`ocrm-badge ${tone}`}>{children}</span>;
}

export function subTone(s: string): 'ok' | 'warn' | 'danger' | 'muted' | 'info' {
  if (s === 'active') return 'ok';
  if (s === 'trialing') return 'info';
  if (s === 'past_due') return 'danger';
  if (s === 'canceled') return 'muted';
  return 'muted';
}

export function payTone(s: string): 'ok' | 'warn' | 'danger' | 'muted' | 'info' {
  if (s === 'paid') return 'ok';
  if (s === 'pending' || s === 'prepared') return 'warn';
  if (s === 'failed') return 'danger';
  return 'muted';
}

export function KpiCard({
  label, value, hint, onClick, active,
}: { label: string; value: ReactNode; hint?: string; onClick?: () => void; active?: boolean }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`ocrm-kpi ${active ? 'on' : ''} ${onClick ? 'clickable' : ''}`} onClick={onClick}>
      <span>{label}</span>
      <b>{value}</b>
      {hint ? <em>{hint}</em> : null}
    </Tag>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <div className="ocrm-empty">{text}</div>;
}

export function PageHeader({ title, text, actions }: { title: string; text?: string; actions?: ReactNode }) {
  return (
    <div className="ocrm-page-head">
      <div>
        <h1>{title}</h1>
        {text ? <p>{text}</p> : null}
      </div>
      {actions ? <div className="ocrm-page-actions">{actions}</div> : null}
    </div>
  );
}

export function remainLabel(endsAt: string | null | undefined, daysLeft: number | null | undefined) {
  if (!endsAt) return '—';
  if (daysLeft == null) return '—';
  if (daysLeft <= 0) return 'Muddati tugagan';
  return `${daysLeft} kun qoldi`;
}
