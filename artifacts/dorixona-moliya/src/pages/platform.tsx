import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CreditCard, Shield } from 'lucide-react';
import { Redirect } from 'wouter';
import { PageHeading, Panel, TableWrap } from '@/components/kit';
import { useAccess } from '@/lib/access';

type OrgRow = {
  id: number;
  name: string;
  planCode: string;
  planName: string;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  planExpiresAt: string | null;
  branchLimit: number | null;
  createdAt: string;
  owner: { id: number; email: string; displayName: string } | null;
};

type PayRow = {
  id: number;
  organizationId: number;
  planCode: string;
  amount: number;
  status: string;
  merchantTransId: string;
  createdAt: string;
  paidAt: string | null;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Xatolik');
  return data as T;
}

export function PlatformPage() {
  const access = useAccess();
  const qc = useQueryClient();
  const overview = useQuery({ queryKey: ['platform-overview'], queryFn: () => api<{ companies: number; activePaid: number; trialing: number; revenueUzs: number }>('/api/platform/overview'), enabled: access.isPlatformAdmin });
  const orgs = useQuery({ queryKey: ['platform-orgs'], queryFn: () => api<OrgRow[]>('/api/platform/organizations'), enabled: access.isPlatformAdmin });
  const payments = useQuery({ queryKey: ['platform-payments'], queryFn: () => api<PayRow[]>('/api/platform/payments'), enabled: access.isPlatformAdmin });
  if (access.loaded && !access.isPlatformAdmin) return <Redirect to="/" />;
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      api(`/api/platform/organizations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform-orgs'] });
      void qc.invalidateQueries({ queryKey: ['platform-overview'] });
    },
  });

  const o = overview.data;

  return (
    <div className="page-stack">
      <PageHeading title="Platforma admin" subtitle="Barcha kompaniyalar, toʻlovlar va tariflar" icon={Shield} />
      <div className="metric-grid">
        <div className="metric-card"><span className="metric-top">Kompaniyalar</span><div className="metric-value">{o?.companies ?? '—'}</div></div>
        <div className="metric-card"><span className="metric-top">Faol toʻlov</span><div className="metric-value">{o?.activePaid ?? '—'}</div></div>
        <div className="metric-card"><span className="metric-top">Sinovda</span><div className="metric-value">{o?.trialing ?? '—'}</div></div>
        <div className="metric-card"><span className="metric-top">Tushum</span><div className="metric-value">{o ? `${o.revenueUzs.toLocaleString('uz-UZ')} soʻm` : '—'}</div></div>
      </div>
      <Panel title="Kompaniyalar" icon={Building2}>
        <TableWrap>
          <table>
            <thead>
              <tr><th>Kompaniya</th><th>Egasi</th><th>Tarif</th><th>Status</th><th>Amal</th></tr>
            </thead>
            <tbody>
              {(orgs.data ?? []).map((row) => (
                <tr key={row.id}>
                  <td><b>{row.name}</b><div className="muted-line">#{row.id}</div></td>
                  <td>{row.owner ? <>{row.owner.displayName}<div className="muted-line">{row.owner.email}</div></> : '—'}</td>
                  <td>{row.planName}</td>
                  <td>{row.subscriptionStatus}</td>
                  <td className="row-actions">
                    <button type="button" className="button ghost" onClick={() => patch.mutate({ id: row.id, body: { planCode: 'starter', extendMonths: 1 } })}>Starter +1oy</button>
                    <button type="button" className="button ghost" onClick={() => patch.mutate({ id: row.id, body: { planCode: 'business', extendMonths: 1 } })}>Business +1oy</button>
                    <button type="button" className="button ghost" onClick={() => patch.mutate({ id: row.id, body: { planCode: 'enterprise', extendMonths: 1 } })}>Enterprise +1oy</button>
                    <button type="button" className="button ghost" onClick={() => patch.mutate({ id: row.id, body: { subscriptionStatus: 'canceled' } })}>Bekor</button>
                  </td>
                </tr>
              ))}
              {!orgs.data?.length && <tr><td colSpan={5}>Hali kompaniya yoʻq.</td></tr>}
            </tbody>
          </table>
        </TableWrap>
      </Panel>
      <Panel title="Toʻlovlar" icon={CreditCard}>
        <TableWrap>
          <table>
            <thead>
              <tr><th>ID</th><th>Org</th><th>Tarif</th><th>Summa</th><th>Status</th><th>Sana</th></tr>
            </thead>
            <tbody>
              {(payments.data ?? []).map((p) => (
                <tr key={p.id}>
                  <td>{p.merchantTransId}</td>
                  <td>#{p.organizationId}</td>
                  <td>{p.planCode}</td>
                  <td>{p.amount.toLocaleString('uz-UZ')} soʻm</td>
                  <td>{p.status}</td>
                  <td>{new Date(p.paidAt || p.createdAt).toLocaleString('uz-UZ')}</td>
                </tr>
              ))}
              {!payments.data?.length && <tr><td colSpan={6}>Toʻlovlar yoʻq.</td></tr>}
            </tbody>
          </table>
        </TableWrap>
      </Panel>
    </div>
  );
}
