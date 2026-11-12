import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { OwnerShell } from './shell';
import { EmptyState, PageHeader, money, ownerApi } from './shared';

type Plan = {
  code: string; name: string; priceUzs: number; branchLimit: number | null;
  telegram: boolean; features: string[]; highlight?: boolean; applyOnly?: boolean; companies: number;
};

export function OwnerPlansPage() {
  const q = useQuery({
    queryKey: ['owner-crm-plans'],
    queryFn: () => ownerApi<{ items: Plan[]; totalCompanies: number }>('/api/platform/crm/plans'),
  });

  return (
    <OwnerShell>
      <PageHeader
        title="Tariflar va rejalar"
        text="Narxlar kod katalogidan olinadi. Kompaniyaga tarif berish — kompaniya profilidan."
      />
      <div className="ocrm-plan-cards">
        {(q.data?.items ?? []).map((p) => (
          <article key={p.code} className={`ocrm-plan-card ${p.highlight ? 'highlight' : ''}`}>
            <h3>{p.name}</h3>
            <div className="price">{p.applyOnly ? 'Kelishiladi' : money(p.priceUzs)}</div>
            <div className="muted-line">
              {p.branchLimit == null ? 'Cheksiz filial' : `${p.branchLimit} ta filial`}
              {p.telegram ? ' · Telegram' : ''}
            </div>
            <ul>
              {p.features.map((f) => <li key={f}>{f}</li>)}
            </ul>
            <div className="ocrm-card-head">
              <b>{p.companies} kompaniya</b>
              <Link className="button ghost" href={`/owner/companies?planCode=${p.code}`}>Koʻrish</Link>
            </div>
          </article>
        ))}
        {!q.isLoading && !q.data?.items?.length && <EmptyState text="Tariflar topilmadi." />}
      </div>
    </OwnerShell>
  );
}
