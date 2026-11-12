import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { OwnerShell } from './shell';
import {
  EmptyState, KpiCard, PageHeader, StatusBadge, formatDate, money, ownerApi,
  payStatusLabel, payTone,
} from './shared';

type PayRow = {
  id: number; organizationId: number; organizationName: string | null; planCode: string; planName: string;
  amount: number; currency: string; status: string; merchantTransId: string; clickTransId: string | null;
  clickPaydocId: string | null; errorNote: string; paidAt: string | null; createdAt: string; updatedAt: string;
  provider: string; method: string;
};

type ListRes = {
  items: PayRow[]; total: number; page: number; pageSize: number;
  stats: { total: number; paidAmount: number; pendingAmount: number; failedCount: number; canceledCount: number; paidCount: number };
};

export function OwnerPaymentsPage() {
  const [, setLoc] = useLocation();
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const [q, setQ] = useState(params.get('q') || '');
  const [detailId, setDetailId] = useState<number | null>(null);
  const status = params.get('status') || '';
  const page = Math.max(1, Number(params.get('page') || 1));

  const setFilter = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (!v) next.delete(k); else next.set(k, v);
    }
    if (!('page' in patch)) next.delete('page');
    const s = next.toString();
    setLoc(s ? `/owner/payments?${s}` : '/owner/payments');
  };

  const list = useQuery({
    queryKey: ['owner-crm-payments', q, status, page],
    queryFn: () => {
      const sp = new URLSearchParams({ page: String(page), pageSize: '25' });
      if (q.trim()) sp.set('q', q.trim());
      if (status) sp.set('status', status);
      return ownerApi<ListRes>(`/api/platform/crm/payments?${sp}`);
    },
  });

  const detail = useQuery({
    queryKey: ['owner-crm-payment', detailId],
    queryFn: () => ownerApi<{ payment: PayRow }>(`/api/platform/crm/payments/${detailId}`),
    enabled: detailId != null,
  });

  const stats = list.data?.stats;
  const totalPages = Math.max(1, Math.ceil((list.data?.total || 0) / 25));

  return (
    <OwnerShell>
      <PageHeader title="Toʻlovlar" text="Barcha kompaniyalar boʻyicha moliyaviy tranzaksiyalar. Faqat «Toʻlandi» tushum hisoblanadi." />
      <div className="ocrm-kpi-grid compact">
        <KpiCard label="Tranzaksiyalar" value={stats?.total ?? '—'} active={!status} onClick={() => setFilter({ status: null })} />
        <KpiCard label="Tasdiqlangan" value={stats ? money(stats.paidAmount) : '—'} active={status === 'paid'} onClick={() => setFilter({ status: 'paid' })} />
        <KpiCard label="Kutilmoqda" value={stats ? money(stats.pendingAmount) : '—'} active={status === 'pending'} onClick={() => setFilter({ status: 'pending' })} />
        <KpiCard label="Muvaffaqiyatsiz" value={stats?.failedCount ?? '—'} active={status === 'failed'} onClick={() => setFilter({ status: 'failed' })} />
        <KpiCard label="Bekor" value={stats?.canceledCount ?? '—'} active={status === 'canceled'} onClick={() => setFilter({ status: 'canceled' })} />
        <KpiCard label="Toʻlangan soni" value={stats?.paidCount ?? '—'} />
      </div>

      <section className="ocrm-card">
        <div className="ocrm-toolbar">
          <label className="ocrm-search">
            <Search size={15} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') setFilter({ q: q.trim() || null }); }}
              placeholder="Tranzaksiya ID, kompaniya, Click ID…"
            />
          </label>
          <select value={status} onChange={(e) => setFilter({ status: e.target.value || null })}>
            <option value="">Barcha holatlar</option>
            <option value="pending">Kutilmoqda</option>
            <option value="prepared">Jarayonda</option>
            <option value="paid">Toʻlandi</option>
            <option value="failed">Muvaffaqiyatsiz</option>
            <option value="canceled">Bekor</option>
          </select>
          <button type="button" className="button primary" onClick={() => setFilter({ q: q.trim() || null })}>Qidirish</button>
        </div>

        <div className="owner-table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th><th>Kompaniya</th><th>Tarif</th><th>Summa</th><th>Usul</th>
                <th>Holat</th><th>Yaratilgan</th><th>Tasdiqlangan</th><th></th>
              </tr>
            </thead>
            <tbody>
              {(list.data?.items ?? []).map((p) => (
                <tr key={p.id}>
                  <td>
                    <button type="button" className="ocrm-linkish" onClick={() => setDetailId(p.id)}>{p.merchantTransId}</button>
                    <div className="muted-line">#{p.id}</div>
                  </td>
                  <td>
                    <Link href={`/owner/companies/${p.organizationId}`}><b>{p.organizationName || `#${p.organizationId}`}</b></Link>
                  </td>
                  <td>{p.planName}</td>
                  <td>{money(p.amount)}</td>
                  <td>{p.provider}</td>
                  <td><StatusBadge tone={payTone(p.status)}>{payStatusLabel(p.status)}</StatusBadge></td>
                  <td>{formatDate(p.createdAt)}</td>
                  <td>{formatDate(p.paidAt)}</td>
                  <td><button type="button" className="button ghost" onClick={() => setDetailId(p.id)}>Batafsil</button></td>
                </tr>
              ))}
              {!list.isLoading && !(list.data?.items?.length) && (
                <tr><td colSpan={9}><EmptyState text="Toʻlov topilmadi." /></td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="ocrm-pager">
          <button type="button" className="button ghost" disabled={page <= 1} onClick={() => setFilter({ page: String(page - 1) })}>
            <ChevronLeft size={14} /> Oldingi
          </button>
          <span>{page} / {totalPages}</span>
          <button type="button" className="button ghost" disabled={page >= totalPages} onClick={() => setFilter({ page: String(page + 1) })}>
            Keyingi <ChevronRight size={14} />
          </button>
        </div>
      </section>

      {detailId != null && (
        <div className="ocrm-drawer-backdrop" onClick={() => setDetailId(null)}>
          <aside className="ocrm-drawer" onClick={(e) => e.stopPropagation()}>
            <header>
              <h2>Toʻlov tafsiloti</h2>
              <button type="button" className="button ghost" onClick={() => setDetailId(null)}><X size={16} /></button>
            </header>
            {detail.data?.payment ? (
              <div className="owner-sub-card">
                <div><span>Ichki ID</span><b>#{detail.data.payment.id}</b></div>
                <div><span>Merchant ID</span><b>{detail.data.payment.merchantTransId}</b></div>
                <div><span>Kompaniya</span><b><Link href={`/owner/companies/${detail.data.payment.organizationId}`}>{detail.data.payment.organizationName}</Link></b></div>
                <div><span>Tarif</span><b>{detail.data.payment.planName}</b></div>
                <div><span>Summa</span><b>{money(detail.data.payment.amount)}</b></div>
                <div><span>Holat</span><b>{payStatusLabel(detail.data.payment.status)}</b></div>
                <div><span>Provayder</span><b>{detail.data.payment.provider}</b></div>
                <div><span>Click trans</span><b>{detail.data.payment.clickTransId || '—'}</b></div>
                <div><span>Paydoc</span><b>{detail.data.payment.clickPaydocId || '—'}</b></div>
                <div><span>Yaratilgan</span><b>{formatDate(detail.data.payment.createdAt)}</b></div>
                <div><span>Tasdiqlangan</span><b>{formatDate(detail.data.payment.paidAt)}</b></div>
                <div><span>Xato</span><b>{detail.data.payment.errorNote || '—'}</b></div>
              </div>
            ) : <EmptyState text="Yuklanmoqda…" />}
          </aside>
        </div>
      )}
    </OwnerShell>
  );
}
