import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban, Building2, Check, ChevronLeft, ChevronRight, Clock3, ExternalLink, Plus, Search, Shield, Users,
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { OwnerShell } from './shell';
import {
  Creds, EmptyState, KpiCard, PageHeader, StatusBadge, formatDate, money, ownerApi,
  remainLabel, subStatusLabel, subTone,
} from './shared';

type CompanyRow = {
  id: number; name: string; planCode: string; planName: string; subscriptionStatus: string;
  endsAt: string | null; daysLeft: number | null; branchLimit: number | null;
  createdAt: string; userCount: number; branchCount: number; paidTotal: number; pendingTotal: number;
  lastPaidAt: string | null; paymentStatus: string;
  owner: { id: number; displayName: string; email: string; phone: string; username: string | null } | null;
};

type ListRes = {
  items: CompanyRow[]; total: number; page: number; pageSize: number;
  stats: { total: number; active: number; trialing: number; pastDue: number; canceled: number; endingSoon: number; withPendingPay: number };
};

function useQueryMap() {
  const search = useSearch();
  return useMemo(() => new URLSearchParams(search), [search]);
}

export function OwnerCompaniesPage() {
  const [, setLoc] = useLocation();
  const qc = useQueryClient();
  const params = useQueryMap();
  const [q, setQ] = useState(params.get('q') || '');
  const [msg, setMsg] = useState('');
  const [creds, setCreds] = useState<Creds>(null);
  const [createOpen, setCreateOpen] = useState(params.get('create') === '1');
  const [form, setForm] = useState({ name: '', displayName: '', phone: '', email: '', planCode: 'starter' });
  const status = params.get('status') || '';
  const planCode = params.get('planCode') || '';
  const endingSoon = params.get('endingSoon') === '1';
  const page = Math.max(1, Number(params.get('page') || 1));

  useEffect(() => {
    setCreateOpen(params.get('create') === '1');
  }, [params]);

  const setFilter = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (!v) next.delete(k); else next.set(k, v);
    }
    if (!('page' in patch)) next.delete('page');
    const s = next.toString();
    setLoc(s ? `/owner/companies?${s}` : '/owner/companies');
  };

  const list = useQuery({
    queryKey: ['owner-crm-companies', q, status, planCode, endingSoon, page],
    queryFn: () => {
      const sp = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (q.trim()) sp.set('q', q.trim());
      if (status) sp.set('status', status);
      if (planCode) sp.set('planCode', planCode);
      if (endingSoon) sp.set('endingSoon', '1');
      return ownerApi<ListRes>(`/api/platform/crm/companies?${sp}`);
    },
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['owner-crm-companies'] });
    void qc.invalidateQueries({ queryKey: ['owner-crm-dashboard'] });
  };

  const patchOrg = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      ownerApi(`/api/platform/organizations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => { setMsg('Yangilandi'); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });
  const suspend = useMutation({
    mutationFn: (id: number) => ownerApi(`/api/platform/organizations/${id}`, { method: 'DELETE' }),
    onSuccess: () => { setMsg('Kompaniya cheklandi'); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });
  const enter = useMutation({
    mutationFn: (id: number) => ownerApi(`/api/platform/organizations/${id}/enter`, { method: 'POST' }),
    onSuccess: () => window.location.assign('/'),
    onError: (e: Error) => setMsg(e.message),
  });
  const createOrg = useMutation({
    mutationFn: () =>
      ownerApi<{
        organization: { id: number };
        credentials: { username: string; password: string };
      }>('/api/platform/organizations', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: (r) => {
      setCreds({ ...r.credentials, title: 'Yangi kompaniya login' });
      setCreateOpen(false);
      setForm({ name: '', displayName: '', phone: '', email: '', planCode: 'starter' });
      setFilter({ create: null });
      refresh();
      setMsg('Kompaniya yaratildi');
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    createOrg.mutate();
  };

  const stats = list.data?.stats;
  const totalPages = Math.max(1, Math.ceil((list.data?.total || 0) / 20));
  const items = list.data?.items ?? [];

  return (
    <OwnerShell>
      <PageHeader
        title="Kompaniyalar"
        text="Har bir mijoz alohida tenant. Tarif, muddat, foydalanuvchi va kabinet — shu yerdan toʻliq boshqariladi."
        actions={
          <button type="button" className="button primary" onClick={() => { setCreateOpen(true); setFilter({ create: '1' }); }}>
            <Plus size={14} /> Yangi kompaniya
          </button>
        }
      />

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

      <div className="ocrm-kpi-grid compact">
        <KpiCard label="Jami" value={stats?.total ?? '—'} active={!status && !endingSoon} onClick={() => setFilter({ status: null, endingSoon: null })} />
        <KpiCard label="Faol" value={stats?.active ?? '—'} active={status === 'active'} onClick={() => setFilter({ status: 'active', endingSoon: null })} />
        <KpiCard label="Sinov" value={stats?.trialing ?? '—'} active={status === 'trialing'} onClick={() => setFilter({ status: 'trialing', endingSoon: null })} />
        <KpiCard label="Toʻlov kutilmoqda" value={stats?.withPendingPay ?? '—'} />
        <KpiCard label="7 kun ichida" value={stats?.endingSoon ?? '—'} active={endingSoon} onClick={() => setFilter({ endingSoon: '1', status: null })} />
        <KpiCard label="Muddati tugagan" value={stats?.pastDue ?? '—'} active={status === 'past_due'} onClick={() => setFilter({ status: 'past_due', endingSoon: null })} />
        <KpiCard label="Bloklangan" value={stats?.canceled ?? '—'} active={status === 'canceled'} onClick={() => setFilter({ status: 'canceled', endingSoon: null })} />
      </div>

      <section className="ocrm-card">
        <div className="ocrm-toolbar">
          <label className="ocrm-search">
            <Search size={15} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') setFilter({ q: q.trim() || null }); }}
              placeholder="Nom, ID, telefon, email, masʼul…"
            />
          </label>
          <select value={planCode} onChange={(e) => setFilter({ planCode: e.target.value || null })}>
            <option value="">Barcha tariflar</option>
            <option value="starter">Boshlangʻich</option>
            <option value="business">Biznes</option>
            <option value="enterprise">Korxona</option>
            <option value="custom">Maxsus</option>
          </select>
          <button type="button" className="button primary" onClick={() => setFilter({ q: q.trim() || null })}>Qidirish</button>
          <button type="button" className="button ghost" onClick={() => { setQ(''); setLoc('/owner/companies'); }}>Tozalash</button>
        </div>

        <div className="ocrm-company-grid">
          {items.map((c) => {
            const ended = c.daysLeft != null && c.daysLeft <= 0;
            const warn = c.daysLeft != null && c.daysLeft > 0 && c.daysLeft <= 7;
            return (
              <article key={c.id} className={`ocrm-co ${c.subscriptionStatus === 'canceled' || ended ? 'is-muted' : ''}`}>
                <header className="ocrm-co-head">
                  <div className="ocrm-co-title">
                    <span className="ocrm-co-id">#{c.id}</span>
                    <Link href={`/owner/companies/${c.id}`}><b>{c.name}</b></Link>
                    <StatusBadge tone={subTone(c.subscriptionStatus)}>{subStatusLabel(c.subscriptionStatus)}</StatusBadge>
                  </div>
                  <div className={`ocrm-co-remain ${ended ? 'ended' : warn ? 'warn' : ''}`}>
                    <Clock3 size={14} />
                    {remainLabel(c.endsAt, c.daysLeft)}
                  </div>
                </header>

                <div className="ocrm-co-grid">
                  <div><span>Tarif</span><b>{c.planName}</b></div>
                  <div><span>Tugash</span><b>{formatDate(c.endsAt)}</b></div>
                  <div><span>Masʼul</span><b>{c.owner?.displayName || '—'}</b></div>
                  <div><span>Aloqa</span><b>{c.owner?.phone || c.owner?.email || '—'}</b></div>
                  <div><span>Filial</span><b>{c.branchCount}{c.branchLimit != null ? ` / ${c.branchLimit}` : ''}</b></div>
                  <div><span>Foydalanuvchi</span><b>{c.userCount}</b></div>
                  <div><span>Toʻlangan</span><b>{money(c.paidTotal)}</b></div>
                  <div><span>Kutilayotgan</span><b>{money(c.pendingTotal)}</b></div>
                </div>

                <div className="ocrm-co-actions">
                  <Link className="button ghost" href={`/owner/companies/${c.id}`}>
                    <Building2 size={14} /> Batafsil boshqaruv
                  </Link>
                  <button type="button" className="button primary" disabled={enter.isPending} onClick={() => enter.mutate(c.id)}>
                    <ExternalLink size={14} /> Kabinetga kirish
                  </button>
                  <button type="button" className="button ghost" disabled={patchOrg.isPending} onClick={() => patchOrg.mutate({ id: c.id, body: { planCode: c.planCode, extendDays: 7 } })}>
                    +7 kun
                  </button>
                  <button type="button" className="button ghost" disabled={patchOrg.isPending} onClick={() => patchOrg.mutate({ id: c.id, body: { planCode: c.planCode, extendMonths: 1 } })}>
                    +30 kun
                  </button>
                  <button type="button" className="button ghost" disabled={patchOrg.isPending} onClick={() => patchOrg.mutate({ id: c.id, body: { subscriptionStatus: 'active' } })}>
                    <Check size={14} /> Faollashtirish
                  </button>
                  <button
                    type="button"
                    className="button ghost"
                    disabled={suspend.isPending}
                    onClick={() => { if (confirm(`${c.name} ni cheklaysizmi? Kabinet yopiladi.`)) suspend.mutate(c.id); }}
                  >
                    <Ban size={14} /> Cheklash
                  </button>
                </div>

                <footer className="ocrm-co-foot">
                  <span><Users size={13} /> {c.owner?.username ? `login: ${c.owner.username}` : 'login yoʻq'}</span>
                  <span><Shield size={13} /> Roʻyxat: {formatDate(c.createdAt)}</span>
                </footer>
              </article>
            );
          })}
          {!list.isLoading && !items.length && <EmptyState text="Kompaniya topilmadi. Filtrni oʻzgartiring yoki arizani tasdiqlang." />}
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

      {createOpen && (
        <div className="ocrm-modal-backdrop" onClick={() => { setCreateOpen(false); setFilter({ create: null }); }}>
          <form className="ocrm-modal" onClick={(e) => e.stopPropagation()} onSubmit={onCreate}>
            <h2>Yangi kompaniya</h2>
            <label>
              Kompaniya nomi
              <input required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label>
              Masʼul ismi
              <input required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
            </label>
            <label>
              Telefon
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </label>
            <label>
              Email
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
            <label>
              Boshlangʻich tarif
              <select value={form.planCode} onChange={(e) => setForm({ ...form, planCode: e.target.value })}>
                <option value="starter">Boshlangʻich (sinov)</option>
                <option value="business">Biznes</option>
                <option value="enterprise">Korxona</option>
                <option value="custom">Maxsus</option>
              </select>
            </label>
            <div className="ocrm-modal-actions">
              <button type="button" className="button ghost" onClick={() => { setCreateOpen(false); setFilter({ create: null }); }}>Bekor</button>
              <button type="submit" className="button primary" disabled={createOrg.isPending}>Yaratish</button>
            </div>
          </form>
        </div>
      )}
    </OwnerShell>
  );
}
