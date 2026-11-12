import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { OwnerShell } from './shell';
import { KpiCard, PageHeader, money, ownerApi } from './shared';

type Dash = {
  kpis: {
    companies: number; active: number; trialing: number; pastDue: number; canceled: number;
    endingSoon: number; users: number; branches: number; pendingApplications: number;
    revenuePaid: number; pendingAmount: number; failedPayments: number; canceledPayments: number;
    todayRevenue: number; weekRevenue: number; monthRevenue: number; prevMonthRevenue: number;
  };
  charts: {
    revenueLast30: { date: string; amount: number }[];
    planDistribution: { code: string; name: string; value: number }[];
    paymentStatuses: { status: string; value: number }[];
  };
};

export function OwnerDashboardPage() {
  const [, setLoc] = useLocation();
  const q = useQuery({
    queryKey: ['owner-crm-dashboard'],
    queryFn: () => ownerApi<Dash>('/api/platform/crm/dashboard'),
    refetchInterval: 30_000,
  });
  const k = q.data?.kpis;
  const charts = q.data?.charts;

  return (
    <OwnerShell>
      <PageHeader title="Umumiy dashboard" text="Platforma holati, tushum va ogohlantirishlar — bir qarashda." />
      <div className="ocrm-kpi-grid">
        <KpiCard label="Jami kompaniyalar" value={k?.companies ?? '—'} onClick={() => setLoc('/owner/companies')} />
        <KpiCard label="Faol" value={k?.active ?? '—'} onClick={() => setLoc('/owner/companies?status=active')} />
        <KpiCard label="Sinov" value={k?.trialing ?? '—'} onClick={() => setLoc('/owner/companies?status=trialing')} />
        <KpiCard label="Muddati tugagan" value={k?.pastDue ?? '—'} onClick={() => setLoc('/owner/companies?status=past_due')} />
        <KpiCard label="7 kun ichida tugaydi" value={k?.endingSoon ?? '—'} onClick={() => setLoc('/owner/companies?endingSoon=1')} />
        <KpiCard label="Bloklangan" value={k?.canceled ?? '—'} onClick={() => setLoc('/owner/companies?status=canceled')} />
        <KpiCard label="Foydalanuvchilar" value={k?.users ?? '—'} />
        <KpiCard label="Filiallar" value={k?.branches ?? '—'} />
        <KpiCard label="Kutilayotgan toʻlov" value={k ? money(k.pendingAmount) : '—'} onClick={() => setLoc('/owner/payments?status=pending')} />
        <KpiCard label="Tasdiqlangan tushum" value={k ? money(k.revenuePaid) : '—'} onClick={() => setLoc('/owner/payments?status=paid')} />
        <KpiCard label="Joriy oy tushumi" value={k ? money(k.monthRevenue) : '—'} />
        <KpiCard label="Arizalar" value={k?.pendingApplications ?? '—'} onClick={() => setLoc('/owner/requests?status=pending')} />
      </div>

      <div className="ocrm-grid-2">
        <section className="ocrm-card">
          <h2>Oxirgi 30 kun tushum</h2>
          <div className="ocrm-bars">
            {(charts?.revenueLast30 ?? []).map((d) => {
              const max = Math.max(1, ...(charts?.revenueLast30.map((x) => x.amount) ?? [1]));
              return (
                <div key={d.date} className="ocrm-bar" title={`${d.date}: ${money(d.amount)}`}>
                  <i style={{ height: `${Math.max(2, (d.amount / max) * 100)}%` }} />
                </div>
              );
            })}
          </div>
          <div className="ocrm-mini-kpis">
            <span>Bugun <b>{k ? money(k.todayRevenue) : '—'}</b></span>
            <span>Hafta <b>{k ? money(k.weekRevenue) : '—'}</b></span>
            <span>Oʻtgan oy <b>{k ? money(k.prevMonthRevenue) : '—'}</b></span>
          </div>
        </section>
        <section className="ocrm-card">
          <h2>Tariflar taqsimoti</h2>
          <ul className="ocrm-dist">
            {(charts?.planDistribution ?? []).map((p) => (
              <li key={p.code}><span>{p.name}</span><b>{p.value}</b></li>
            ))}
            {!charts?.planDistribution?.length && <li className="muted-line">Maʼlumot yoʻq</li>}
          </ul>
          <h2 style={{ marginTop: 18 }}>Toʻlov holatlari</h2>
          <ul className="ocrm-dist">
            {(charts?.paymentStatuses ?? []).map((p) => (
              <li key={p.status}><span>{p.status}</span><b>{p.value}</b></li>
            ))}
          </ul>
        </section>
      </div>
    </OwnerShell>
  );
}
