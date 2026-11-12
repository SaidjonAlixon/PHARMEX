import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { OwnerShell } from './shell';
import { EmptyState, PageHeader, formatDate, ownerApi } from './shared';

type Alert = {
  id: string; kind: string; tone: 'info' | 'warn' | 'danger' | 'ok';
  title: string; text: string; href: string; createdAt: string;
};

export function OwnerAlertsPage() {
  const q = useQuery({
    queryKey: ['owner-crm-alerts'],
    queryFn: () => ownerApi<{ items: Alert[]; unread: number }>('/api/platform/crm/alerts'),
    refetchInterval: 20_000,
  });

  return (
    <OwnerShell>
      <PageHeader
        title="Bildirishnomalar"
        text="Arizalar, obuna muddati va muvaffaqiyatsiz toʻlovlar — avtomatik ogohlantirishlar."
      />
      <section className="ocrm-card">
        <div className="ocrm-alert-list">
          {(q.data?.items ?? []).map((a) => (
            <Link key={a.id} href={a.href} className="ocrm-alert-item">
              <span className={`ocrm-alert-dot ${a.tone}`} />
              <div>
                <b>{a.title}</b>
                <div className="muted-line">{a.text}</div>
              </div>
              <span className="muted-line">{formatDate(a.createdAt)}</span>
            </Link>
          ))}
          {!q.isLoading && !(q.data?.items?.length) && <EmptyState text="Hozircha ogohlantirish yoʻq." />}
        </div>
      </section>
    </OwnerShell>
  );
}
