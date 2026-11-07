import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, PackageSearch, RefreshCw, Search, X, type LucideIcon } from 'lucide-react';
import {
  useListBranches, useListCashAccounts, useListCounterparties, useListInventory, useListProducts,
} from '@workspace/api-client-react';
import type { Product } from '@workspace/api-client-react';

/** `period` is the topbar choice (today, this-week, range, …) the dates were derived from. */
export type Filters = { dateFrom: string; dateTo: string; branchId: string; period?: string };

/** The pharmacies' time zone: every day and clock time in the app is shown in it, whatever the browser's zone. */
export const APP_TZ = 'Asia/Tashkent';
const tzFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
function tzParts(d: Date) {
  const p = Object.fromEntries(tzFormat.formatToParts(d).map(x => [x.type, x.value]));
  return { y: p.year, m: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second };
}
/** YYYY-MM-DD of an instant in Tashkent. */
export const localDay = (d: Date) => { const p = tzParts(d); return `${p.y}-${p.m}-${p.d}`; };
/** Calendar arithmetic on YYYY-MM-DD strings. */
export function addDaysTo(day: string, days: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export const todayDay = () => localDay(new Date());
export const today = todayDay();
export const monthStart = `${today.slice(0, 8)}01`;
/** HH:mm:ss of an instant in Tashkent. */
export function clockTime(value?: string | Date | null) {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  const p = tzParts(d);
  return `${p.h}:${p.mi}:${p.s}`;
}

// Uzbek notation: space between thousands, comma before tiyin (39 500 · 14 000,03), so a
// thousands separator can never be read as a decimal point.
const moneyFormat = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export function money(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const text = moneyFormat.format(n).replace(/\u00a0|\u202f/g, ' ');
  // Tiyin are shown as two digits (14 000,30), never one.
  return /,\d$/.test(text) ? `${text}0` : text;
}
export function qty(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(Number(value)).replace(/\u00a0|\u202f/g, ' ');
}
// Browsers ship no short Uzbek month names (Chromium prints "M10"), so they are spelled out here.
const MONTHS = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'];
const pad = (n: number) => String(n).padStart(2, '0');
// Date-only strings ("2026-10-09") are calendar days, not instants; instants are read in Tashkent time.
function fields(value: string) {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (day) return { y: day[1], m: day[2], d: day[3], h: '00', mi: '00' };
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : tzParts(d);
}
export function date(value?: string | null) {
  if (!value) return '—';
  const f = fields(value);
  return f ? `${f.d} ${MONTHS[Number(f.m) - 1]} ${f.y}` : value;
}
export function dateTime(value?: string | null) {
  if (!value) return '—';
  const f = fields(value);
  if (!f) return value;
  // Day-level documents (daily cash totals, F-APTEKA documents without a time) sit at midnight.
  const atMidnight = f.h === '00' && f.mi === '00' && (!('s' in f) || f.s === '00');
  return atMidnight ? `${f.d} ${MONTHS[Number(f.m) - 1]} ${f.y}` : `${f.d} ${MONTHS[Number(f.m) - 1]} ${f.y}, ${f.h}:${f.mi}`;
}
export function sourceText(value?: string) { return value === 'demo' ? 'Sinov maʼlumoti' : value === 'fom' ? 'FOM' : value === 'manual' ? 'Qoʻlda kiritilgan' : '—'; }

/** Current Tashkent time in the format a datetime-local input expects. */
export function nowLocal() {
  const p = tzParts(new Date());
  return `${p.y}-${p.m}-${p.d}T${p.h}:${p.mi}`;
}
/** A datetime-local value entered as Tashkent time (UTC+5, no daylight saving). */
export function localToIso(value: string) {
  const withSeconds = /T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
  return new Date(`${withSeconds}+05:00`).toISOString();
}
export function round2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }
/** Formats a number for API money fields, which accept at most two decimals and no sign. */
export function toMoney(n: number) { return Math.max(0, round2(n)).toFixed(2); }
export function num(value: string | number | null | undefined) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
export function includedVat(total: number, rate: number) { return rate > 0 ? round2(total * rate / (100 + rate)) : 0; }

export function filterParams(filters: Filters) {
  return {
    branchId: filters.branchId ? Number(filters.branchId) : undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
  };
}

export function apiErrorMessage(error: unknown, fallback = 'Amal bajarilmadi. Maʼlumotlarni tekshirib qayta urinib koʻring.') {
  const data = (error as { data?: { error?: unknown } } | null)?.data;
  const message = typeof data?.error === 'string' ? data.error : '';
  if (!message) return fallback;
  if (message.trim().startsWith('[') || message.includes('"code"')) return 'Kiritilgan maʼlumotlar notoʻgʻri. Majburiy maydonlar va summalarni tekshiring.';
  return message;
}

/** Every write touches stock, money and debts at once, so refresh all cached reads. */
export function useRefreshAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

export function DataState({ loading, error, empty, retry, emptyText }: { loading: boolean; error?: boolean; empty: boolean; retry: () => void; emptyText?: string }) {
  if (loading) return <div className="state-box" data-testid="state-loading"><div className="skeleton-line wide" /><div className="skeleton-line" /><div className="skeleton-line short" /><span>Maʼlumotlar yuklanmoqda</span></div>;
  if (error) return <div className="state-box state-error" data-testid="state-error"><AlertCircle size={22} /><strong>Maʼlumotlarni olib boʻlmadi</strong><span>Ulanishni tekshirib, qayta urinib koʻring.</span><button className="button secondary" onClick={retry} data-testid="button-retry"><RefreshCw size={15} /> Qayta urinish</button></div>;
  if (empty) return <div className="state-box" data-testid="state-empty"><PackageSearch size={25} /><strong>Hozircha maʼlumot yoʻq</strong><span>{emptyText || 'Tanlangan davr yoki filial boʻyicha yozuv topilmadi. Bu qiymat nol degani emas.'}</span></div>;
  return null;
}
export function StatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'good' | 'warn' | 'bad' | 'neutral' | 'info' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function DataMode({ mode }: { mode?: string }) {
  return mode === 'demo' ? <div className="demo-ribbon" data-testid="status-demo-mode"><span className="demo-dot" /> SINOV REJIMI <span className="demo-copy">— ekrandagi maʼlumotlar namuna sifatida berilgan</span></div> : null;
}
export function PageHeading({ eyebrow, title, subtitle, actions }: { eyebrow?: string; title: string; subtitle?: string; actions?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow || 'MOLIYAVIY BOSHQARUV'}</div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{actions && <div className="heading-actions">{actions}</div>}</div>;
}
export function Panel({ title, subtitle, action, children, className = '' }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}><div className="panel-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>{children}</section>;
}
/**
 * Card figure that fits its card: sums of a million and more drop the tiyin, and long figures get
 * a smaller size class. The exact amount stays in `title`.
 */
export function fitFigure(value: string | number | null | undefined, count = false) {
  if (value === null || value === undefined || value === '') return { text: '—', title: undefined, cls: '' };
  const n = Number(value);
  const text = count || !Number.isFinite(n) ? String(value) : Math.abs(n) >= 1_000_000 ? money(Math.round(n)) : money(n);
  const title = count || !Number.isFinite(n) ? undefined : `${money(n)} soʻm`;
  return { text, title, cls: text.length > 14 ? 'fit-sm' : text.length > 10 ? 'fit-md' : '' };
}

export function Metric({ label, value, unit = 'soʻm', trend, icon: Icon }: { label: string; value: string | null | undefined; unit?: string; trend?: string; icon: LucideIcon }) {
  const f = fitFigure(value);
  return <div className="metric-card"><div className="metric-top"><span>{label}</span><span className="metric-icon"><Icon size={17} /></span></div><div className={`metric-value ${f.cls}`} title={f.title}>{f.text}</div><div className="metric-foot"><span>{value == null ? 'Maʼlumot yetarli emas' : unit}</span>{trend && <span className="positive">{trend}</span>}</div></div>;
}
export function TableWrap({ children }: { children: ReactNode }) { return <div className="table-scroll"><table>{children}</table></div>; }

export type Kpi = { label: string; value: string | number | null | undefined; hint?: string; tone?: 'good' | 'bad' | 'warn'; icon?: LucideIcon; count?: boolean };
export function KpiStrip({ items }: { items: Kpi[] }) {
  return <div className="kpi-strip">{items.map(item => {
    const Icon = item.icon;
    const f = fitFigure(item.value, item.count);
    return <div className={`kpi ${item.tone || ''}`} key={item.label}>
      <div className="kpi-label">{Icon && <Icon size={14} />}<span>{item.label}</span></div>
      <b className={f.cls} title={f.title}>{f.text}</b>
      <small>{item.hint ?? (item.count ? 'ta' : 'soʻm')}</small>
    </div>;
  })}</div>;
}

export function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: NoInfer<T>) => void; options: { id: NoInfer<T>; label: string; count?: number }[] }) {
  return <div className="chips" role="tablist">{options.map(o => <button type="button" key={o.id} className={value === o.id ? 'selected' : ''} onClick={() => onChange(o.id)}>{o.label}{o.count != null && <span>{o.count}</span>}</button>)}</div>;
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <label className="search-field"><Search size={15} /><input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} /></label>;
}

function useEscape(onClose: () => void, disabled?: boolean) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !disabled) onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, disabled]);
}

export function Modal({ eyebrow, title, onClose, busy, size = 'md', children }: { eyebrow?: string; title: string; onClose: () => void; busy?: boolean; size?: 'md' | 'lg' | 'xl'; children: ReactNode }) {
  useEscape(onClose, busy);
  return <div className="modal-backdrop" role="presentation" onMouseDown={() => !busy && onClose()}>
    <div className={`modal-card modal-${size}`} role="dialog" aria-modal="true" onMouseDown={e => e.stopPropagation()}>
      <div className="modal-head"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div><button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Yopish"><X size={18} /></button></div>
      {children}
    </div>
  </div>;
}

export function Drawer({ eyebrow, title, subtitle, onClose, actions, children }: { eyebrow?: string; title: string; subtitle?: ReactNode; onClose: () => void; actions?: ReactNode; children: ReactNode }) {
  useEscape(onClose);
  return <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
    <aside className="drawer" role="dialog" aria-modal="true" onMouseDown={e => e.stopPropagation()}>
      <div className="drawer-head">
        <div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2>{subtitle && <div className="drawer-sub">{subtitle}</div>}</div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Yopish"><X size={18} /></button>
      </div>
      {actions && <div className="drawer-actions">{actions}</div>}
      <div className="drawer-body">{children}</div>
    </aside>
  </div>;
}

export function InfoGrid({ items }: { items: { label: string; value: ReactNode }[] }) {
  return <div className="info-grid">{items.map(item => <div key={item.label}><span>{item.label}</span><b>{item.value ?? '—'}</b></div>)}</div>;
}

export function Totals({ rows }: { rows: { label: string; value: string | number | null | undefined; strong?: boolean; tone?: 'good' | 'bad' }[] }) {
  return <div className="totals">{rows.map(row => <div key={row.label} className={row.strong ? 'strong' : ''}><span>{row.label}</span><b className={row.tone === 'good' ? 'positive' : row.tone === 'bad' ? 'negative' : ''}>{money(row.value)} soʻm</b></div>)}</div>;
}

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="form-error" role="alert">{typeof error === 'string' ? error : apiErrorMessage(error)}</div>;
}

export function BranchSelect({ value, onChange, label = 'Filial', required = true, exclude, allowEmpty, emptyLabel = 'Tanlang' }: { value: string; onChange: (v: string) => void; label?: string; required?: boolean; exclude?: string; allowEmpty?: boolean; emptyLabel?: string }) {
  const branches = useListBranches().data || [];
  return <label>{label}<select required={required} value={value} onChange={e => onChange(e.target.value)}>
    {(allowEmpty || !value) && <option value="">{emptyLabel}</option>}
    {branches.filter(b => String(b.id) !== exclude).map(b => <option key={b.id} value={b.id}>{b.name} · {b.kind === 'warehouse' ? 'Ombor' : 'Dorixona'}</option>)}
  </select></label>;
}

export function AccountSelect({ value, onChange, label = 'Kassa / bank hisobi', kind, branchId, required, emptyLabel = 'Avtomatik (filial kassasi)' }: { value: string; onChange: (v: string) => void; label?: string; kind?: 'cash' | 'bank'; branchId?: string; required?: boolean; emptyLabel?: string }) {
  const accounts = useListCashAccounts().data || [];
  const list = accounts.filter(a => (!kind || a.kind === kind) && (!branchId || a.branchId == null || String(a.branchId) === branchId));
  return <label>{label}<select required={required} value={value} onChange={e => onChange(e.target.value)}>
    <option value="">{required ? 'Hisobni tanlang' : emptyLabel}</option>
    {list.map(a => <option key={a.id} value={a.id}>{a.kind === 'cash' ? 'Kassa' : 'Bank'} · {a.name} · {a.branchName} — {money(a.balance)} soʻm</option>)}
  </select></label>;
}

export function CounterpartyField({ kind, value, onChange, label, required = true }: { kind: 'supplier' | 'customer'; value: string; onChange: (name: string, id: number | null) => void; label: string; required?: boolean }) {
  const list = useListCounterparties({ kind }).data || [];
  const id = `cp-${kind}`;
  return <label>{label}<input required={required} list={id} value={value} onChange={e => { const name = e.target.value; const match = list.find(c => c.name.toLowerCase() === name.trim().toLowerCase()); onChange(name, match?.id ?? null); }} placeholder={kind === 'supplier' ? 'Yetkazib beruvchi nomi' : 'Mijoz ismi yoki tashkilot'} />
    <datalist id={id}>{list.map(c => <option key={c.id} value={c.name}>{c.taxId ? `STIR ${c.taxId}` : ''}</option>)}</datalist>
  </label>;
}

export type PickedProduct = Product & { available: number | null; branchCost: string | null };

/** Searchable product picker; when a branch is given it shows (and optionally limits to) stock on hand there. */
export function ProductPicker({ branchId, onPick, onlyInStock, placeholder = 'Mahsulot nomi, kodi yoki shtrix-kodi' }: { branchId?: string; onPick: (p: PickedProduct) => void; onlyInStock?: boolean; placeholder?: string }) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [serverTerm, setServerTerm] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setServerTerm(term.trim()), 250);
    return () => clearTimeout(timer);
  }, [term]);
  const products = useListProducts(serverTerm ? { search: serverTerm } : undefined).data || [];
  const inventory = useListInventory(branchId ? { branchId: Number(branchId) } : undefined, { query: { enabled: !!branchId, queryKey: ['inventory-picker', branchId] } }).data || [];
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const stockById = useMemo(() => new Map(inventory.map(i => [i.productId, i])), [inventory]);
  const matches = useMemo(() => {
    const q = term.trim().toLowerCase();
    const result: PickedProduct[] = [];
    for (const p of products) {
      if (q && !`${p.name} ${p.code ?? ''} ${p.barcode ?? ''} ${p.manufacturer} ${p.ikpu} ${p.fomId ?? ''}`.toLowerCase().includes(q)) continue;
      const stock = stockById.get(p.id);
      const available = branchId ? (stock?.quantity ?? 0) : null;
      if (onlyInStock && (available ?? 0) <= 0) continue;
      result.push({ ...p, available, branchCost: stock?.costPrice ?? null });
      if (result.length >= 40) break;
    }
    return result;
  }, [products, stockById, term, branchId, onlyInStock]);
  const pick = (p: PickedProduct) => { onPick(p); setTerm(''); setOpen(false); };
  return <div className="picker" ref={box}>
    <label className="search-field picker-input"><Search size={15} /><input value={term} onFocus={() => setOpen(true)} onChange={e => { setTerm(e.target.value); setOpen(true); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (matches[0]) pick(matches[0]); } }} placeholder={placeholder} /></label>
    {open && <div className="picker-list">
      {matches.length ? matches.map(p => <button type="button" key={p.id} onClick={() => pick(p)}>
        <span><b>{p.name}</b><small>{[p.code, p.barcode, p.manufacturer, p.fomId && `FOM ${p.fomId}`].filter(Boolean).join(' · ') || p.group}</small></span>
        <span className="picker-meta">{p.available != null && <em className={p.available > 0 ? 'positive' : 'negative'}>{qty(p.available)} {p.unit}</em>}<small>{money(p.retailPrice)} soʻm</small></span>
      </button>) : <div className="inline-empty">{onlyInStock ? 'Bu filialda qoldigʻi bor mahsulot topilmadi' : 'Mahsulot topilmadi — avval “Maʼlumotnomalar”da qoʻshing'}</div>}
    </div>}
  </div>;
}
