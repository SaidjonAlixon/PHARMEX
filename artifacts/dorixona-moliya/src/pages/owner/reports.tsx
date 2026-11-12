import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { OwnerShell } from './shell';
import { KpiCard, PageHeader, formatDate, money, ownerApi } from './shared';

type Report = {
  summary: {
    companies: number; active: number; pastDue: number; users: number; branches: number;
    revenueAll: number; revenueMonth: number; pendingAmount: number; failedPayments: number;
    debtCompanies: number; generatedAt: string;
  };
  revenueByPlan: { code: string; name: string; amount: number }[];
};

export function OwnerReportsPage() {
  const q = useQuery({
    queryKey: ['owner-crm-reports'],
    queryFn: () => ownerApi<Report>('/api/platform/crm/reports'),
  });
  const s = q.data?.summary;

  return (
    <OwnerShell>
      <PageHeader
        title="Hisobotlar"
        text={`Moliyaviy va tenant koʻrsatkichlari. Yangilangan: ${s ? formatDate(s.generatedAt) : '—'}`}
        actions={<Link className="button ghost" href="/owner/payments">Toʻlovlar tafsiloti</Link>}
      />
      <div className="ocrm-kpi-grid">
        <KpiCard label="Jami tushum" value={s ? money(s.revenueAll) : '—'} />
        <KpiCard label="Joriy oy tushumi" value={s ? money(s.revenueMonth) : '—'} />
        <KpiCard label="Kutilayotgan" value={s ? money(s.pendingAmount) : '—'} />
        <KpiCard label="Qarzdor kompaniyalar" value={s?.debtCompanies ?? '—'} />
        <KpiCard label="Faol kompaniyalar" value={s?.active ?? '—'} />
        <KpiCard label="Filiallar" value={s?.branches ?? '—'} />
        <KpiCard label="Foydalanuvchilar" value={s?.users ?? '—'} />
        <KpiCard label="Muvaffaqiyatsiz toʻlov" value={s?.failedPayments ?? '—'} />
      </div>
      <section className="ocrm-card">
        <h2>Tariflar boʻyicha tushum</h2>
        <ul className="ocrm-dist">
          {(q.data?.revenueByPlan ?? []).map((p) => (
            <li key={p.code}><span>{p.name}</span><b>{money(p.amount)}</b></li>
          ))}
          {!q.data?.revenueByPlan?.length && <li className="muted-line">Hali tasdiqlangan tushum yoʻq.</li>}
        </ul>
      </section>
    </OwnerShell>
  );
}
