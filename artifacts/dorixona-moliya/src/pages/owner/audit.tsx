import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { OwnerShell } from './shell';
import { EmptyState, PageHeader, formatDate, ownerApi } from './shared';

type Row = {
  id: number; actorId: string; action: string; entityType: string; entityId: string;
  summary: string; createdAt: string;
};

export function OwnerAuditPage() {
  const [, setLoc] = useLocation();
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const [q, setQ] = useState(params.get('q') || '');
  const page = Math.max(1, Number(params.get('page') || 1));

  const setFilter = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (!v) next.delete(k); else next.set(k, v);
    }
    if (!('page' in patch)) next.delete('page');
    const s = next.toString();
    setLoc(s ? `/owner/audit?${s}` : '/owner/audit');
  };

  const list = useQuery({
    queryKey: ['owner-crm-audit', q, page],
    queryFn: () => {
      const sp = new URLSearchParams({ page: String(page), pageSize: '30' });
      if (q.trim()) sp.set('q', q.trim());
      return ownerApi<{ items: Row[]; total: number }>(`/api/platform/crm/audit?${sp}`);
    },
  });
  const totalPages = Math.max(1, Math.ceil((list.data?.total || 0) / 30));

  return (
    <OwnerShell>
      <PageHeader title="Audit jurnali" text="Platformadagi barcha muhim amallar — kim, nima, qachon." />
      <section className="ocrm-card">
        <div className="ocrm-toolbar">
          <label className="ocrm-search">
            <Search size={15} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') setFilter({ q: q.trim() || null }); }}
              placeholder="Amal, izoh, actor, entity…"
            />
          </label>
          <button type="button" className="button primary" onClick={() => setFilter({ q: q.trim() || null })}>Qidirish</button>
        </div>
        <div className="ocrm-table-wrap">
          <table>
            <thead><tr><th>Sana</th><th>Amal</th><th>Obʼyekt</th><th>Izoh</th><th>Kim</th></tr></thead>
            <tbody>
              {(list.data?.items ?? []).map((a) => (
                <tr key={a.id}>
                  <td>{formatDate(a.createdAt)}</td>
                  <td><b>{a.action}</b></td>
                  <td>{a.entityType} #{a.entityId || '—'}</td>
                  <td>{a.summary || '—'}</td>
                  <td>{a.actorId}</td>
                </tr>
              ))}
              {!list.isLoading && !(list.data?.items?.length) && <tr><td colSpan={5}><EmptyState text="Audit yozuvi yoʻq." /></td></tr>}
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
