import { useQuery } from '@tanstack/react-query';
import { Download, Plus } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { OwnerShell } from './shell';
import {
  EmptyState, KpiCard, PageHeader, StatusBadge, formatDate, formatDay, money, ownerApi,
  payStatusLabel, remainLabel, subStatusLabel, subTone,
} from './shared';

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
  recentCompanies?: Array<{
    id: number; name: string; planName: string; subscriptionStatus: string;
    endsAt: string | null; daysLeft: number | null; userCount: number; branchCount: number;
    pendingAmount: number; createdAt: string;
  }>;
  recentApplications?: Array<{
    id: number; ref: string; displayName: string; companyName: string; status: string;
    typeLabel: string; createdAt: string;
  }>;
};

function pct(cur: number, prev: number) {
  if (!prev && !cur) return '0%';
  if (!prev) return '+100%';
  const v = Math.round(((cur - prev) / prev) * 100);
  return `${v > 0 ? '+' : ''}${v}%`;
}

export function OwnerDashboardPage() {
  const [, setLoc] = useLocation();
  const q = useQuery({
    queryKey: ['owner-crm-dashboard'],
    queryFn: () => ownerApi<Dash>('/api/platform/crm/dashboard'),
    refetchInterval: 30_000,
  });
  const k = q.data?.kpis;
  const charts = q.data?.charts;
  const monthDelta = k ? pct(k.monthRevenue, k.prevMonthRevenue) : '—';
  const activeShare = k && k.companies ? Math.round((k.active / k.companies) * 100) : 0;

  const statusMap = Object.fromEntries((charts?.paymentStatuses ?? []).map((s) => [s.status, s.value]));

  return (
    <OwnerShell>
      <PageHeader
        title="Umumiy koʻrinish"
        text="Kompaniyalar, tushum, obunalar va arizalar — platformaning jonli holati."
        actions={
          <>
            <Link className="button primary" href="/owner/companies?create=1"><Plus size={14} /> Yangi kompaniya</Link>
            <Link className="button ghost" href="/owner/reports"><Download size={14} /> Hisobotlar</Link>
          </>
        }
      />

      <div className="ocrm-kpi-grid">
        <KpiCard label="Jami kompaniyalar" value={k?.companies ?? '—'} hint="barcha tenantlar" onClick={() => setLoc('/owner/companies')} />
        <KpiCard label="Faol kompaniyalar" value={k?.active ?? '—'} hint={`${activeShare}%`} onClick={() => setLoc('/owner/companies?status=active')} />
        <KpiCard label="Sinov rejimida" value={k?.trialing ?? '—'} onClick={() => setLoc('/owner/companies?status=trialing')} />
        <KpiCard label="Obuna tugash arafasida" value={k?.endingSoon ?? '—'} hint="7 kun ichida" onClick={() => setLoc('/owner/companies?endingSoon=1')} />
        <KpiCard label="Muddati tugagan" value={k?.pastDue ?? '—'} hint="toʻlov talab" onClick={() => setLoc('/owner/companies?status=past_due')} />
        <KpiCard label="Jami foydalanuvchilar" value={k?.users ?? '—'} onClick={() => setLoc('/owner/users')} />
      </div>

      <div className="ocrm-grid-3">
        <section className="ocrm-card" style={{ gridColumn: 'span 2' }}>
          <div className="ocrm-card-head">
            <div>
              <h2>Tushumlar dinamikasi</h2>
              <p className="muted-line" style={{ margin: '4px 0 0' }}>
                Jami tasdiqlangan: <b>{k ? money(k.revenuePaid) : '—'}</b> · oy: {monthDelta}
              </p>
            </div>
            <Link className="button ghost" href="/owner/payments">Toʻlovlar</Link>
          </div>
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
            <span>Joriy oy <b>{k ? money(k.monthRevenue) : '—'}</b></span>
            <span>Kutilayotgan <b>{k ? money(k.pendingAmount) : '—'}</b></span>
          </div>
        </section>

        <section className="ocrm-card">
          <h2>Tezkor amallar</h2>
          <div className="ocrm-quick">
            <Link href="/owner/companies?create=1"><Plus size={15} /> Yangi kompaniya qoʻshish</Link>
            <Link className="secondary" href="/owner/payments"><Plus size={15} /> Toʻlovlarni koʻrish</Link>
            <Link className="secondary" href="/owner/requests?status=pending"><Plus size={15} /> Arizalarni koʻrib chiqish</Link>
            <Link className="secondary" href="/owner/reports"><Download size={15} /> Hisobotni ochish</Link>
          </div>
        </section>
      </div>

      <div className="ocrm-grid-3">
        <section className="ocrm-card">
          <h2>Tariflar taqsimoti</h2>
          <ul className="ocrm-dist">
            {(charts?.planDistribution ?? []).map((p) => (
              <li key={p.code}><span>{p.name}</span><b>{p.value}</b></li>
            ))}
            {!charts?.planDistribution?.length && <li className="muted-line">Maʼlumot yoʻq</li>}
          </ul>
        </section>
        <section className="ocrm-card">
          <h2>Toʻlovlar holati</h2>
          <ul className="ocrm-dist">
            <li><span>Toʻlangan</span><b>{statusMap.paid ?? 0}</b></li>
            <li><span>Kutilmoqda</span><b>{(statusMap.pending ?? 0) + (statusMap.prepared ?? 0)}</b></li>
            <li><span>Muvaffaqiyatsiz</span><b>{statusMap.failed ?? 0}</b></li>
            <li><span>Bekor</span><b>{statusMap.canceled ?? 0}</b></li>
          </ul>
        </section>
        <section className="ocrm-card">
          <h2>Kompaniyalar holati</h2>
          <ul className="ocrm-dist">
            <li><span>Faol</span><b>{k?.active ?? 0}</b></li>
            <li><span>Sinov</span><b>{k?.trialing ?? 0}</b></li>
            <li><span>Muddati tugagan</span><b>{k?.pastDue ?? 0}</b></li>
            <li><span>Bloklangan</span><b>{k?.canceled ?? 0}</b></li>
          </ul>
        </section>
      </div>

      <div className="ocrm-grid-2">
        <section className="ocrm-card">
          <div className="ocrm-card-head">
            <h2>Soʻnggi kompaniyalar</h2>
            <Link href="/owner/companies">Hammasi</Link>
          </div>
          <div className="ocrm-table-wrap">
            <table>
              <thead>
                <tr><th>Kompaniya</th><th>Tarif</th><th>Holat</th><th>Muddat</th><th>Stat</th></tr>
              </thead>
              <tbody>
                {(q.data?.recentCompanies ?? []).map((c) => (
                  <tr key={c.id}>
                    <td><Link href={`/owner/companies/${c.id}`}><b>{c.name}</b></Link></td>
                    <td>{c.planName}</td>
                    <td><StatusBadge tone={subTone(c.subscriptionStatus)}>{subStatusLabel(c.subscriptionStatus)}</StatusBadge></td>
                    <td>{remainLabel(c.endsAt, c.daysLeft)}<div className="muted-line">{formatDay(c.endsAt)}</div></td>
                    <td>{c.userCount} foyd. · {c.branchCount} filial</td>
                  </tr>
                ))}
                {!q.data?.recentCompanies?.length && <tr><td colSpan={5}><EmptyState text="Hali kompaniya yoʻq." /></td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="ocrm-card">
          <div className="ocrm-card-head">
            <h2>Soʻnggi arizalar</h2>
            <Link href="/owner/requests">Hammasi</Link>
          </div>
          <ul className="ocrm-dist">
            {(q.data?.recentApplications ?? []).map((a) => (
              <li key={a.id}>
                <span>
                  <b>#{a.ref}</b> · {a.companyName || a.displayName}
                  <div className="muted-line">{a.typeLabel} · {formatDate(a.createdAt)}</div>
                </span>
                <StatusBadge tone="warn">{payStatusLabel(a.status) === a.status ? 'Yangi' : a.status}</StatusBadge>
              </li>
            ))}
            {!q.data?.recentApplications?.length && <li className="muted-line">Kutilayotgan ariza yoʻq.</li>}
          </ul>
        </section>
      </div>
    </OwnerShell>
  );
}
