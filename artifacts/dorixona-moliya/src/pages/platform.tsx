import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, ClipboardList, CreditCard, Shield } from 'lucide-react';
import { useState } from 'react';
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
  daysLeft: number | null;
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

type AppRow = {
  id: number;
  displayName: string;
  email: string;
  phone: string;
  companyName: string;
  status: string;
  createdAt: string;
};

type Creds = { username: string; password: string; displayName: string; company: string } | null;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Xatolik');
  return data as T;
}

function statusLabel(s: string) {
  if (s === 'trialing') return '7 kun bepul';
  if (s === 'active') return 'Faol toʻlov';
  if (s === 'past_due') return 'Muddati tugagan';
  if (s === 'canceled') return 'Bekor';
  return s;
}

function daysText(row: OrgRow) {
  if (row.daysLeft == null) return '—';
  if (row.daysLeft <= 0) return 'Tugagan';
  return `${row.daysLeft} kun`;
}

export function PlatformPage() {
  const access = useAccess();
  const qc = useQueryClient();
  const [creds, setCreds] = useState<Creds>(null);
  const [msg, setMsg] = useState('');
  const overview = useQuery({
    queryKey: ['platform-overview'],
    queryFn: () => api<{ companies: number; activePaid: number; trialing: number; revenueUzs: number }>('/api/platform/overview'),
    enabled: access.isPlatformAdmin,
  });
  const orgs = useQuery({ queryKey: ['platform-orgs'], queryFn: () => api<OrgRow[]>('/api/platform/organizations'), enabled: access.isPlatformAdmin });
  const payments = useQuery({ queryKey: ['platform-payments'], queryFn: () => api<PayRow[]>('/api/platform/payments'), enabled: access.isPlatformAdmin });
  const apps = useQuery({ queryKey: ['platform-apps'], queryFn: () => api<AppRow[]>('/api/platform/applications'), enabled: access.isPlatformAdmin, refetchInterval: 20_000 });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      api(`/api/platform/organizations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform-orgs'] });
      void qc.invalidateQueries({ queryKey: ['platform-overview'] });
    },
  });

  const approve = useMutation({
    mutationFn: (id: number) =>
      api<{ credentials: { username: string; password: string }; user: { displayName: string }; organization: { name: string } }>(
        `/api/platform/applications/${id}/approve`,
        { method: 'POST' },
      ),
    onSuccess: (data) => {
      setCreds({
        username: data.credentials.username,
        password: data.credentials.password,
        displayName: data.user.displayName,
        company: data.organization.name,
      });
      setMsg('Akkaunt ochildi — login/parolni mijozga bering.');
      void qc.invalidateQueries({ queryKey: ['platform-apps'] });
      void qc.invalidateQueries({ queryKey: ['platform-orgs'] });
      void qc.invalidateQueries({ queryKey: ['platform-overview'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const reject = useMutation({
    mutationFn: (id: number) => api(`/api/platform/applications/${id}/reject`, { method: 'POST' }),
    onSuccess: () => {
      setMsg('Ariza rad etildi.');
      void qc.invalidateQueries({ queryKey: ['platform-apps'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  if (access.loaded && access.isPlatformAdmin) return <Redirect to="/owner" />;
  if (access.loaded && !access.isPlatformAdmin) return <Redirect to="/" />;

  const o = overview.data;

  return (
    <div className="page-stack">
      <PageHeading title="Platforma admin" subtitle="Arizalar, kompaniyalar, tariflar va muddatlar — faqat siz uchun" icon={Shield} />
      {msg && <div className="notice">{msg}</div>}
      {creds && (
        <Panel title="Yangi login / parol (bir marta koʻrsatiladi)">
          <div className="plan-current">
            <div><span className="eyebrow">Mijoz</span><b>{creds.displayName}</b></div>
            <div><span className="eyebrow">Kompaniya</span><b>{creds.company}</b></div>
            <div><span className="eyebrow">Login</span><b data-testid="text-issued-username">{creds.username}</b></div>
            <div><span className="eyebrow">Parol</span><b data-testid="text-issued-password">{creds.password}</b></div>
          </div>
          <p className="muted-line" style={{ marginTop: 10 }}>Mijoz «Kirish» orqali shu login va parol bilan kabinetiga kiradi. Boshlangʻich — 7 kun bepul.</p>
          <button type="button" className="button ghost" onClick={() => setCreds(null)}>Yopish</button>
        </Panel>
      )}
      <div className="metric-grid">
        <div className="metric-card"><span className="metric-top">Kompaniyalar</span><div className="metric-value">{o?.companies ?? '—'}</div></div>
        <div className="metric-card"><span className="metric-top">Faol toʻlov</span><div className="metric-value">{o?.activePaid ?? '—'}</div></div>
        <div className="metric-card"><span className="metric-top">Bepul sinov</span><div className="metric-value">{o?.trialing ?? '—'}</div></div>
        <div className="metric-card"><span className="metric-top">Arizalar</span><div className="metric-value">{apps.data?.length ?? '—'}</div></div>
      </div>

      <Panel title="Yangi arizalar" subtitle="Tasdiqlangach login/parol chiqadi" icon={ClipboardList}>
        <TableWrap>
          <table>
            <thead>
              <tr><th>Ism</th><th>Kompaniya</th><th>Aloqa</th><th>Sana</th><th>Amal</th></tr>
            </thead>
            <tbody>
              {(apps.data ?? []).map((row) => (
                <tr key={row.id}>
                  <td><b>{row.displayName}</b></td>
                  <td>{row.companyName || '—'}</td>
                  <td>{row.phone}<div className="muted-line">{row.email}</div></td>
                  <td>{new Date(row.createdAt).toLocaleString('uz-UZ')}</td>
                  <td className="row-actions">
                    <button type="button" className="button primary" disabled={approve.isPending} onClick={() => approve.mutate(row.id)} data-testid={`button-approve-${row.id}`}>Akkaunt ochish</button>
                    <button type="button" className="button ghost" disabled={reject.isPending} onClick={() => reject.mutate(row.id)}>Rad etish</button>
                  </td>
                </tr>
              ))}
              {!apps.data?.length && <tr><td colSpan={5}>Kutayotgan ariza yoʻq.</td></tr>}
            </tbody>
          </table>
        </TableWrap>
      </Panel>

      <Panel title="Kompaniyalar" icon={Building2}>
        <TableWrap>
          <table>
            <thead>
              <tr><th>Kompaniya</th><th>Egasi</th><th>Tarif</th><th>Status</th><th>Qolgan</th><th>Amal</th></tr>
            </thead>
            <tbody>
              {(orgs.data ?? []).map((row) => (
                <tr key={row.id}>
                  <td><b>{row.name}</b><div className="muted-line">#{row.id}</div></td>
                  <td>{row.owner ? <>{row.owner.displayName}<div className="muted-line">{row.owner.email}</div></> : '—'}</td>
                  <td>{row.planName}</td>
                  <td>{statusLabel(row.subscriptionStatus)}</td>
                  <td>{daysText(row)}</td>
                  <td className="row-actions">
                    <button type="button" className="button ghost" onClick={() => patch.mutate({ id: row.id, body: { planCode: 'starter', extendDays: 7 } })}>+7 kun</button>
                    <button type="button" className="button ghost" onClick={() => patch.mutate({ id: row.id, body: { planCode: 'business', extendMonths: 1 } })}>Biznes</button>
                    <button type="button" className="button ghost" onClick={() => patch.mutate({ id: row.id, body: { planCode: 'enterprise', extendMonths: 1 } })}>Korxona</button>
                    <button type="button" className="button ghost" onClick={() => patch.mutate({ id: row.id, body: { planCode: 'custom', extendMonths: 1 } })}>Maxsus</button>
                    <button type="button" className="button ghost" onClick={() => patch.mutate({ id: row.id, body: { subscriptionStatus: 'canceled' } })}>Bekor</button>
                  </td>
                </tr>
              ))}
              {!orgs.data?.length && <tr><td colSpan={6}>Hali kompaniya yoʻq.</td></tr>}
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
