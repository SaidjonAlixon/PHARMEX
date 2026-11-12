import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, ChevronLeft, ChevronRight, KeyRound, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { OwnerShell } from './shell';
import {
  Creds, EmptyState, KpiCard, PageHeader, formatDate, ownerApi, roleLabel, userStatusLabel,
} from './shared';

type Row = {
  id: number; displayName: string; email: string; username: string | null; phone: string;
  role: string; status: string; organizationId: number | null; orgName: string | null;
  lastLoginAt: string | null; createdAt: string;
};

export function OwnerUsersPage() {
  const [, setLoc] = useLocation();
  const qc = useQueryClient();
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const [q, setQ] = useState(params.get('q') || '');
  const [msg, setMsg] = useState('');
  const [creds, setCreds] = useState<Creds>(null);
  const role = params.get('role') || '';
  const status = params.get('status') || '';
  const page = Math.max(1, Number(params.get('page') || 1));

  const setFilter = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (!v) next.delete(k); else next.set(k, v);
    }
    if (!('page' in patch)) next.delete('page');
    const s = next.toString();
    setLoc(s ? `/owner/users?${s}` : '/owner/users');
  };

  const list = useQuery({
    queryKey: ['owner-crm-users', q, role, status, page],
    queryFn: () => {
      const sp = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (q.trim()) sp.set('q', q.trim());
      if (role) sp.set('role', role);
      if (status) sp.set('status', status);
      return ownerApi<{ items: Row[]; total: number; stats: { total: number; active: number; pending: number; disabled: number } }>(
        `/api/platform/crm/users?${sp}`,
      );
    },
  });

  const patchUser = useMutation({
    mutationFn: ({ uid, body }: { uid: number; body: Record<string, unknown> }) =>
      ownerApi(`/api/platform/users/${uid}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['owner-crm-users'] }); setMsg('Yangilandi'); },
    onError: (e: Error) => setMsg(e.message),
  });
  const resetPass = useMutation({
    mutationFn: (uid: number) =>
      ownerApi<{ credentials: { username: string; password: string } }>(`/api/platform/users/${uid}/reset-password`, { method: 'POST' }),
    onSuccess: (r) => setCreds({ ...r.credentials, title: 'Yangi parol' }),
    onError: (e: Error) => setMsg(e.message),
  });
  const removeUser = useMutation({
    mutationFn: (uid: number) => ownerApi(`/api/platform/users/${uid}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['owner-crm-users'] }),
    onError: (e: Error) => setMsg(e.message),
  });

  const totalPages = Math.max(1, Math.ceil((list.data?.total || 0) / 20));
  const stats = list.data?.stats;

  return (
    <OwnerShell>
      <PageHeader title="Foydalanuvchilar" text="Barcha kompaniya foydalanuvchilari — rol, holat va parol boshqaruvi." />
      <div className="ocrm-kpi-grid compact">
        <KpiCard label="Jami" value={stats?.total ?? '—'} />
        <KpiCard label="Faol" value={stats?.active ?? '—'} active={status === 'active'} onClick={() => setFilter({ status: 'active' })} />
        <KpiCard label="Kutilmoqda" value={stats?.pending ?? '—'} active={status === 'pending'} onClick={() => setFilter({ status: 'pending' })} />
        <KpiCard label="Bloklangan" value={stats?.disabled ?? '—'} active={status === 'disabled'} onClick={() => setFilter({ status: 'disabled' })} />
      </div>
      {msg && <div className="notice">{msg}</div>}
      {creds && (
        <div className="owner-creds">
          <div>
            <span className="eyebrow">{creds.title}</span>
            <div className="plan-current">
              <div><span className="eyebrow">Login</span><b>{creds.username}</b></div>
              <div><span className="eyebrow">Parol</span><b>{creds.password}</b></div>
            </div>
          </div>
          <button type="button" className="button ghost" onClick={() => setCreds(null)}>Yopish</button>
        </div>
      )}
      <section className="ocrm-card">
        <div className="ocrm-toolbar">
          <label className="ocrm-search">
            <Search size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') setFilter({ q: q.trim() || null }); }} placeholder="Ism, login, telefon, kompaniya…" />
          </label>
          <select value={role} onChange={(e) => setFilter({ role: e.target.value || null })}>
            <option value="">Barcha rollar</option>
            <option value="admin">Admin</option>
            <option value="finance">Moliya</option>
            <option value="viewer">Kuzatuvchi</option>
          </select>
          <button type="button" className="button primary" onClick={() => setFilter({ q: q.trim() || null })}>Qidirish</button>
        </div>
        <div className="ocrm-table-wrap">
          <table>
            <thead>
              <tr><th>Foydalanuvchi</th><th>Kompaniya</th><th>Rol</th><th>Holat</th><th>Oxirgi kirish</th><th>Amal</th></tr>
            </thead>
            <tbody>
              {(list.data?.items ?? []).map((u) => (
                <tr key={u.id}>
                  <td>
                    <b>{u.displayName}</b>
                    <div className="muted-line">{u.username || '—'} · {u.phone || u.email || '—'}</div>
                  </td>
                  <td>
                    {u.organizationId
                      ? <Link href={`/owner/companies/${u.organizationId}`}>{u.orgName || `#${u.organizationId}`}</Link>
                      : '—'}
                  </td>
                  <td>
                    <select value={u.role} onChange={(e) => patchUser.mutate({ uid: u.id, body: { role: e.target.value } })}>
                      <option value="admin">Admin</option>
                      <option value="finance">Moliya</option>
                      <option value="viewer">Kuzatuvchi</option>
                    </select>
                  </td>
                  <td>{userStatusLabel(u.status)} · {roleLabel(u.role)}</td>
                  <td>{formatDate(u.lastLoginAt)}</td>
                  <td className="row-actions">
                    {u.status === 'active'
                      ? <button type="button" className="button ghost" onClick={() => patchUser.mutate({ uid: u.id, body: { status: 'disabled' } })}><Ban size={13} /></button>
                      : <button type="button" className="button ghost" onClick={() => patchUser.mutate({ uid: u.id, body: { status: 'active' } })}><Check size={13} /></button>}
                    {u.username && <button type="button" className="button ghost" onClick={() => resetPass.mutate(u.id)}><KeyRound size={13} /></button>}
                    <button type="button" className="button ghost" onClick={() => { if (confirm('Oʻchirasizmi?')) removeUser.mutate(u.id); }}><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
              {!list.isLoading && !(list.data?.items?.length) && <tr><td colSpan={6}><EmptyState text="Foydalanuvchi topilmadi." /></td></tr>}
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
