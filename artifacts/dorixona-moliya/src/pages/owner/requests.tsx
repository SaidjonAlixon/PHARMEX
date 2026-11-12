import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { OwnerShell } from './shell';
import {
  Creds, EmptyState, KpiCard, PageHeader, StatusBadge, formatDate, ownerApi, userStatusLabel,
} from './shared';

type AppRow = {
  id: number; displayName: string; email: string; phone: string; companyName: string;
  status: string; signupMethod: string; organizationId: number | null; createdAt: string;
  type: string; typeLabel: string; priority: string;
};

type ListRes = {
  items: AppRow[]; total: number; page: number; pageSize: number;
  stats: { pending: number; total: number };
};

export function OwnerRequestsPage() {
  const [, setLoc] = useLocation();
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const [q, setQ] = useState(params.get('q') || '');
  const [creds, setCreds] = useState<Creds>(null);
  const [msg, setMsg] = useState('');
  const status = params.get('status') || '';
  const page = Math.max(1, Number(params.get('page') || 1));
  const qc = useQueryClient();

  const setFilter = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (!v) next.delete(k); else next.set(k, v);
    }
    if (!('page' in patch)) next.delete('page');
    const s = next.toString();
    setLoc(s ? `/owner/requests?${s}` : '/owner/requests');
  };

  const list = useQuery({
    queryKey: ['owner-crm-apps', q, status, page],
    queryFn: () => {
      const sp = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (q.trim()) sp.set('q', q.trim());
      if (status) sp.set('status', status);
      return ownerApi<ListRes>(`/api/platform/crm/applications?${sp}`);
    },
  });

  const approve = useMutation({
    mutationFn: (id: number) =>
      ownerApi<{ credentials: { username: string; password: string }; organization: { id: number; name: string } }>(
        `/api/platform/applications/${id}/approve`,
        { method: 'POST' },
      ),
    onSuccess: (r) => {
      setCreds({ ...r.credentials, title: `${r.organization.name} — ochilgan akkaunt` });
      setMsg('Ariza tasdiqlandi. Login/parolni mijozga bering.');
      void qc.invalidateQueries({ queryKey: ['owner-crm-apps'] });
      void qc.invalidateQueries({ queryKey: ['owner-crm-dashboard'] });
      void qc.invalidateQueries({ queryKey: ['owner-crm-companies'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const reject = useMutation({
    mutationFn: (id: number) => ownerApi(`/api/platform/applications/${id}/reject`, { method: 'POST' }),
    onSuccess: () => {
      setMsg('Ariza rad etildi.');
      void qc.invalidateQueries({ queryKey: ['owner-crm-apps'] });
      void qc.invalidateQueries({ queryKey: ['owner-crm-dashboard'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const stats = list.data?.stats;
  const totalPages = Math.max(1, Math.ceil((list.data?.total || 0) / 20));

  return (
    <OwnerShell>
      <PageHeader title="Arizalar" text="Yangi kompaniya arizalari. Tasdiqlangach login/parol beriladi — faqat shu kompaniya uchun admin." />
      <div className="ocrm-kpi-grid compact">
        <KpiCard label="Jami" value={stats?.total ?? '—'} active={!status} onClick={() => setFilter({ status: null })} />
        <KpiCard label="Yangi / kutilmoqda" value={stats?.pending ?? '—'} active={status === 'pending'} onClick={() => setFilter({ status: 'pending' })} />
        <KpiCard label="Faollashtirilgan" value="—" active={status === 'active'} onClick={() => setFilter({ status: 'active' })} />
        <KpiCard label="Rad etilgan" value="—" active={status === 'rejected'} onClick={() => setFilter({ status: 'rejected' })} />
      </div>

      {msg && <div className="notice">{msg}</div>}
      {creds && (
        <div className="owner-creds">
          <div>
            <span className="eyebrow">{creds.title}</span>
            <div className="plan-current">
              <div><span className="eyebrow">Login</span><b data-testid="text-owner-issued-username">{creds.username}</b></div>
              <div><span className="eyebrow">Parol</span><b data-testid="text-owner-issued-password">{creds.password}</b></div>
            </div>
            <p className="muted-line">Bir marta koʻrsatiladi — mijozga bering. Kirish: https://pharmxs.uz/sign-in</p>
          </div>
          <button type="button" className="button ghost" onClick={() => setCreds(null)}>Yopish</button>
        </div>
      )}

      <section className="ocrm-card">
        <div className="ocrm-toolbar">
          <label className="ocrm-search">
            <Search size={15} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') setFilter({ q: q.trim() || null }); }}
              placeholder="Ism, kompaniya, telefon, email…"
            />
          </label>
          <button type="button" className="button primary" onClick={() => setFilter({ q: q.trim() || null })}>Qidirish</button>
        </div>

        <div className="owner-table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th><th>Tur</th><th>Murojaatchi</th><th>Kompaniya</th><th>Aloqa</th>
                <th>Holat</th><th>Sana</th><th>Amallar</th>
              </tr>
            </thead>
            <tbody>
              {(list.data?.items ?? []).map((row) => (
                <tr key={row.id}>
                  <td>#{row.id}</td>
                  <td>{row.typeLabel}</td>
                  <td><b>{row.displayName}</b></td>
                  <td>
                    {row.organizationId
                      ? <Link href={`/owner/companies/${row.organizationId}`}>{row.companyName || 'Kompaniya'}</Link>
                      : (row.companyName || '—')}
                  </td>
                  <td>{row.phone}<div className="muted-line">{row.email}</div></td>
                  <td>
                    <StatusBadge tone={row.status === 'pending' ? 'warn' : row.status === 'active' ? 'ok' : row.status === 'rejected' ? 'danger' : 'muted'}>
                      {userStatusLabel(row.status)}
                    </StatusBadge>
                  </td>
                  <td>{formatDate(row.createdAt)}</td>
                  <td className="row-actions">
                    {row.status === 'pending' && (
                      <>
                        <button type="button" className="button primary" disabled={approve.isPending} onClick={() => approve.mutate(row.id)}>
                          Tasdiqlash
                        </button>
                        <button type="button" className="button ghost" disabled={reject.isPending} onClick={() => reject.mutate(row.id)}>
                          Rad etish
                        </button>
                      </>
                    )}
                    {row.organizationId && (
                      <Link className="button ghost" href={`/owner/companies/${row.organizationId}`}>Profil</Link>
                    )}
                  </td>
                </tr>
              ))}
              {!list.isLoading && !(list.data?.items?.length) && (
                <tr><td colSpan={8}><EmptyState text="Ariza yoʻq." /></td></tr>
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
    </OwnerShell>
  );
}
