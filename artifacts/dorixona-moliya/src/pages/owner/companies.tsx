import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ExternalLink, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { OwnerShell } from './shell';
import {
  EmptyState, KpiCard, PageHeader, StatusBadge, formatDate, money, ownerApi,
  remainLabel, subStatusLabel, subTone,
} from './shared';

type CompanyRow = {
  id: number; name: string; planCode: string; planName: string; subscriptionStatus: string;
  endsAt: string | null; daysLeft: number | null; branchLimit: number | null;
  createdAt: string; userCount: number; branchCount: number; paidTotal: number; pendingTotal: number;
  lastPaidAt: string | null; paymentStatus: string;
  owner: { id: number; displayName: string; email: string; phone: string; username: string | null } | null;
};

type ListRes = {
  items: CompanyRow[]; total: number; page: number; pageSize: number;
  stats: { total: number; active: number; trialing: number; pastDue: number; canceled: number; endingSoon: number; withPendingPay: number };
};

function useQueryMap() {
  const search = useSearch();
  return useMemo(() => new URLSearchParams(search), [search]);
}

export function OwnerCompaniesPage() {
  const [, setLoc] = useLocation();
  const params = useQueryMap();
  const [q, setQ] = useState(params.get('q') || '');
  const status = params.get('status') || '';
  const planCode = params.get('planCode') || '';
  const endingSoon = params.get('endingSoon') === '1';
  const page = Math.max(1, Number(params.get('page') || 1));

  const setFilter = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (!v) next.delete(k); else next.set(k, v);
    }
    if (!('page' in patch)) next.delete('page');
    const s = next.toString();
    setLoc(s ? `/owner/companies?${s}` : '/owner/companies');
  };

  const list = useQuery({
    queryKey: ['owner-crm-companies', q, status, planCode, endingSoon, page],
    queryFn: () => {
      const sp = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (q.trim()) sp.set('q', q.trim());
      if (status) sp.set('status', status);
      if (planCode) sp.set('planCode', planCode);
      if (endingSoon) sp.set('endingSoon', '1');
      return ownerApi<ListRes>(`/api/platform/crm/companies?${sp}`);
    },
  });

  const stats = list.data?.stats;
  const totalPages = Math.max(1, Math.ceil((list.data?.total || 0) / 20));

  return (
    <OwnerShell>
      <PageHeader title="Kompaniyalar" text="Har bir mijoz kompaniyasi, tarif, muddat, filial va foydalanuvchilar — alohida CRM." />
      <div className="ocrm-kpi-grid compact">
        <KpiCard label="Jami" value={stats?.total ?? '—'} active={!status && !endingSoon} onClick={() => setFilter({ status: null, endingSoon: null })} />
        <KpiCard label="Faol" value={stats?.active ?? '—'} active={status === 'active'} onClick={() => setFilter({ status: 'active', endingSoon: null })} />
        <KpiCard label="Sinov" value={stats?.trialing ?? '—'} active={status === 'trialing'} onClick={() => setFilter({ status: 'trialing', endingSoon: null })} />
        <KpiCard label="Toʻlov kutilmoqda" value={stats?.withPendingPay ?? '—'} />
        <KpiCard label="7 kun ichida" value={stats?.endingSoon ?? '—'} active={endingSoon} onClick={() => setFilter({ endingSoon: '1', status: null })} />
        <KpiCard label="Tugagan" value={stats?.pastDue ?? '—'} active={status === 'past_due'} onClick={() => setFilter({ status: 'past_due', endingSoon: null })} />
        <KpiCard label="Bloklangan" value={stats?.canceled ?? '—'} active={status === 'canceled'} onClick={() => setFilter({ status: 'canceled', endingSoon: null })} />
      </div>

      <section className="ocrm-card">
        <div className="ocrm-toolbar">
          <label className="ocrm-search">
            <Search size={15} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') setFilter({ q: q.trim() || null }); }}
              placeholder="Nom, ID, telefon, email, masʼul…"
            />
          </label>
          <select value={planCode} onChange={(e) => setFilter({ planCode: e.target.value || null })}>
            <option value="">Barcha tariflar</option>
            <option value="starter">Boshlangʻich</option>
            <option value="business">Biznes</option>
            <option value="enterprise">Korxona</option>
            <option value="custom">Maxsus</option>
          </select>
          <button type="button" className="button primary" onClick={() => setFilter({ q: q.trim() || null })}>Qidirish</button>
          <button type="button" className="button ghost" onClick={() => { setQ(''); setLoc('/owner/companies'); }}>Tozalash</button>
        </div>

        <div className="owner-table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th><th>Kompaniya</th><th>Masʼul</th><th>Tarif</th><th>Holat</th>
                <th>Filial</th><th>Foyd.</th><th>Tugash</th><th>Qolgan</th><th>Toʻlangan</th><th></th>
              </tr>
            </thead>
            <tbody>
              {(list.data?.items ?? []).map((c) => (
                <tr key={c.id}>
                  <td>#{c.id}</td>
                  <td>
                    <Link href={`/owner/companies/${c.id}`}><b>{c.name}</b></Link>
                    <div className="muted-line">{formatDate(c.createdAt)}</div>
                  </td>
                  <td>
                    {c.owner?.displayName || '—'}
                    <div className="muted-line">{c.owner?.phone || c.owner?.email || '—'}</div>
                  </td>
                  <td>{c.planName}</td>
                  <td><StatusBadge tone={subTone(c.subscriptionStatus)}>{subStatusLabel(c.subscriptionStatus)}</StatusBadge></td>
                  <td>{c.branchCount}{c.branchLimit != null ? ` / ${c.branchLimit}` : ''}</td>
                  <td>{c.userCount}</td>
                  <td>{formatDate(c.endsAt)}</td>
                  <td>{remainLabel(c.endsAt, c.daysLeft)}</td>
                  <td>{money(c.paidTotal)}</td>
                  <td className="row-actions">
                    <Link className="button ghost" href={`/owner/companies/${c.id}`}>Batafsil</Link>
                    <button
                      type="button"
                      className="button primary"
                      onClick={async () => {
                        await ownerApi(`/api/platform/organizations/${c.id}/enter`, { method: 'POST' });
                        window.location.assign('/');
                      }}
                    >
                      <ExternalLink size={13} /> Kirish
                    </button>
                  </td>
                </tr>
              ))}
              {!list.isLoading && !(list.data?.items?.length) && (
                <tr><td colSpan={11}><EmptyState text="Kompaniya topilmadi." /></td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="ocrm-pager">
          <button type="button" className="button ghost" disabled={page <= 1} onClick={() => setFilter({ page: String(page - 1) })}>
            <ChevronLeft size={14} /> Oldingi
          </button>
          <span>{page} / {totalPages} · {list.data?.total ?? 0} ta</span>
          <button type="button" className="button ghost" disabled={page >= totalPages} onClick={() => setFilter({ page: String(page + 1) })}>
            Keyingi <ChevronRight size={14} />
          </button>
        </div>
      </section>
    </OwnerShell>
  );
}
