import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban, Building2, Check, ChevronDown, ChevronRight, ClipboardList, CreditCard, ExternalLink, KeyRound, Loader2,
  LogOut, Pencil, Plus, Shield, Trash2, UserPlus, Users, Wallet,
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, Redirect } from 'wouter';
import { BrandLogo } from '@/components/brand-logo';
import { useAccess } from '@/lib/access';
import { useClerk } from '@/lib/auth';

type UserRow = {
  id: number;
  displayName: string;
  email: string;
  username: string | null;
  phone: string;
  role: string;
  status: string;
  organizationId: number | null;
  lastLoginAt: string | null;
  createdAt: string;
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

type Company = {
  id: number;
  name: string;
  planCode: string;
  planName: string;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  planExpiresAt: string | null;
  endsAt: string | null;
  daysLeft: number | null;
  branchLimit: number | null;
  createdAt: string;
  owner: UserRow | null;
  users: UserRow[];
  payments: PayRow[];
  userCount: number;
  paidTotal: number;
};

type Remain = { days: number; hours: number; minutes: number; seconds: number; totalMs: number };

function remainFrom(iso: string | null | undefined): Remain | null {
  if (!iso) return null;
  const totalMs = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(totalMs)) return null;
  const abs = Math.max(0, totalMs);
  return {
    totalMs,
    days: Math.floor(abs / 86400000),
    hours: Math.floor((abs % 86400000) / 3600000),
    minutes: Math.floor((abs % 3600000) / 60000),
    seconds: Math.floor((abs % 60000) / 1000),
  };
}

function useNowTick(enabled: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [enabled]);
  return now;
}

function formatEnds(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('uz-UZ', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

type AppRow = {
  id: number;
  displayName: string;
  email: string;
  phone: string;
  companyName: string;
  status: string;
  createdAt: string;
};

type Creds = { username: string; password: string; title: string } | null;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Xatolik');
  return data as T;
}

function statusLabel(s: string) {
  if (s === 'trialing') return '7 kun bepul';
  if (s === 'active') return 'Faol';
  if (s === 'past_due') return 'Muddati tugagan';
  if (s === 'canceled') return 'Bekor / cheklangan';
  if (s === 'disabled') return 'Bloklangan';
  if (s === 'pending') return 'Kutilmoqda';
  return s;
}

function roleLabel(r: string) {
  if (r === 'admin') return 'Admin';
  if (r === 'viewer') return 'Kuzatuvchi';
  if (r === 'finance') return 'Moliya';
  return r;
}

function money(n: number) {
  return `${n.toLocaleString('uz-UZ')} soʻm`;
}

export function OwnerLoginPage() {
  const access = useAccess();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  if (access.loaded && access.isPlatformAdmin) {
    return <Redirect to={access.actingAsCompany ? '/' : '/owner'} />;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError('');
    try {
      const user = await api<{ role: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      });
      if (user.role !== 'platform_admin') {
        setError('Bu sahifa faqat platforma egasi uchun. Kompaniya kabineti: https://pharmxs.uz/sign-in');
        await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
        setPending(false);
        return;
      }
      window.location.replace('/owner');
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  };

  return (
    <div className="owner-auth">
      <form className="owner-auth-card" onSubmit={submit} data-testid="form-owner-login">
        <BrandLogo />
        <h1>Platforma egasi</h1>
        <p>Kompaniyalar, tariflar, muddatlar va foydalanuvchilar — toʻliq boshqaruv.</p>
        {error && <div className="notice error">{error}</div>}
        <label>
          <span>Login</span>
          <input required autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="admin" data-testid="input-owner-login" />
        </label>
        <label>
          <span>Parol</span>
          <input required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-owner-password" />
        </label>
        <button type="submit" className="button primary plan-buy" disabled={pending}>
          {pending ? <Loader2 className="spin" size={16} /> : <Shield size={16} />}
          Kirish
        </button>
        <Link href="/sign-in" className="muted-line">Kompaniya kabineti →</Link>
      </form>
    </div>
  );
}

export function OwnerConsolePage() {
  const access = useAccess();
  const { signOut } = useClerk();
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<number | null>(null);
  const [tab, setTab] = useState<'companies' | 'payments' | 'apps'>('companies');
  const [msg, setMsg] = useState('');
  const [creds, setCreds] = useState<Creds>(null);
  const [newUser, setNewUser] = useState<{ orgId: number; displayName: string; phone: string; role: string } | null>(null);
  const [rename, setRename] = useState<{ id: number; name: string } | null>(null);

  const directory = useQuery({
    queryKey: ['platform-directory'],
    queryFn: () => api<{ companies: Company[] }>('/api/platform/directory'),
    enabled: access.isPlatformAdmin,
  });
  const apps = useQuery({
    queryKey: ['platform-apps'],
    queryFn: () => api<AppRow[]>('/api/platform/applications'),
    enabled: access.isPlatformAdmin,
    refetchInterval: 20_000,
  });
  const overview = useQuery({
    queryKey: ['platform-overview'],
    queryFn: () => api<{ companies: number; activePaid: number; trialing: number; revenueUzs: number; pendingApplications: number }>('/api/platform/overview'),
    enabled: access.isPlatformAdmin,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['platform-directory'] });
    void qc.invalidateQueries({ queryKey: ['platform-overview'] });
    void qc.invalidateQueries({ queryKey: ['platform-apps'] });
    void qc.invalidateQueries({ queryKey: ['platform-orgs'] });
    void qc.invalidateQueries({ queryKey: ['platform-payments'] });
  };

  const patchOrg = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      api(`/api/platform/organizations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => { setMsg('Kompaniya yangilandi'); setRename(null); invalidate(); },
    onError: (e: Error) => setMsg(e.message),
  });

  const suspendOrg = useMutation({
    mutationFn: (id: number) => api(`/api/platform/organizations/${id}`, { method: 'DELETE' }),
    onSuccess: () => { setMsg('Kompaniya vaqtinchalik cheklandi'); invalidate(); },
    onError: (e: Error) => setMsg(e.message),
  });

  const deleteOrg = useMutation({
    mutationFn: (id: number) => api(`/api/platform/organizations/${id}?hard=1`, { method: 'DELETE' }),
    onSuccess: () => { setMsg('Kompaniya oʻchirildi'); setOpenId(null); invalidate(); },
    onError: (e: Error) => setMsg(e.message),
  });

  const createUser = useMutation({
    mutationFn: () => {
      if (!newUser) throw new Error('Forma boʻsh');
      return api<{ credentials: { username: string; password: string }; user: UserRow }>(
        `/api/platform/organizations/${newUser.orgId}/users`,
        { method: 'POST', body: JSON.stringify(newUser) },
      );
    },
    onSuccess: (data) => {
      setCreds({ ...data.credentials, title: `${data.user.displayName} — login/parol` });
      setNewUser(null);
      setMsg('Foydalanuvchi yaratildi');
      invalidate();
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const patchUser = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      api(`/api/platform/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => { setMsg('Foydalanuvchi yangilandi'); invalidate(); },
    onError: (e: Error) => setMsg(e.message),
  });

  const resetPass = useMutation({
    mutationFn: (id: number) => api<{ credentials: { username: string; password: string } }>(`/api/platform/users/${id}/reset-password`, { method: 'POST' }),
    onSuccess: (data) => { setCreds({ ...data.credentials, title: 'Yangi parol' }); setMsg('Parol yangilandi'); },
    onError: (e: Error) => setMsg(e.message),
  });

  const removeUser = useMutation({
    mutationFn: (id: number) => api(`/api/platform/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => { setMsg('Foydalanuvchi oʻchirildi'); invalidate(); },
    onError: (e: Error) => setMsg(e.message),
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
        title: `${data.user.displayName} · ${data.organization.name}`,
      });
      setMsg('Akkaunt ochildi');
      invalidate();
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const reject = useMutation({
    mutationFn: (id: number) => api(`/api/platform/applications/${id}/reject`, { method: 'POST' }),
    onSuccess: () => { setMsg('Ariza rad etildi'); invalidate(); },
    onError: (e: Error) => setMsg(e.message),
  });

  const companies = directory.data?.companies ?? [];
  const allPayments = useMemo(() => companies.flatMap((c) => c.payments.map((p) => ({ ...p, companyName: c.name }))), [companies]);
  const tick = useNowTick(tab === 'companies' && companies.some((c) => !!c.endsAt));

  const enterCompany = useMutation({
    mutationFn: (id: number) => api<{ redirect: string }>(`/api/platform/organizations/${id}/enter`, { method: 'POST' }),
    onSuccess: () => { window.location.assign('/'); },
    onError: (e: Error) => setMsg(e.message),
  });

  if (!access.loaded) {
    return (
      <div className="owner-auth">
        <div className="owner-auth-card" style={{ alignItems: 'center' }}>
          <Loader2 className="spin" size={28} />
          <p className="muted-line">Owner panel yuklanmoqda…</p>
        </div>
      </div>
    );
  }
  if (!access.isPlatformAdmin) return <Redirect to="/owner/kirish" />;
  if (access.actingAsCompany) return <Redirect to="/" />;

  const o = overview.data;

  return (
    <div className="owner-shell" data-testid="page-owner-console">
      <header className="owner-top">
        <div className="owner-brand">
          <BrandLogo />
          <div>
            <b>Platforma egasi</b>
            <span>Toʻliq boshqaruv paneli</span>
          </div>
        </div>
        <div className="owner-top-actions">
          <button type="button" className="button ghost" onClick={() => void signOut({ redirectUrl: '/owner/kirish' })}>
            <LogOut size={15} /> Chiqish
          </button>
        </div>
      </header>

      <div className="owner-body">
        <div className="metric-grid">
          <div className="metric-card"><span className="metric-top">Kompaniyalar</span><div className="metric-value">{o?.companies ?? '—'}</div></div>
          <div className="metric-card"><span className="metric-top">Faol toʻlov</span><div className="metric-value">{o?.activePaid ?? '—'}</div></div>
          <div className="metric-card"><span className="metric-top">Sinov</span><div className="metric-value">{o?.trialing ?? '—'}</div></div>
          <div className="metric-card"><span className="metric-top">Tushum</span><div className="metric-value" style={{ fontSize: 18 }}>{o ? money(o.revenueUzs) : '—'}</div></div>
          <div className="metric-card"><span className="metric-top">Arizalar</span><div className="metric-value">{apps.data?.length ?? o?.pendingApplications ?? '—'}</div></div>
        </div>

        {msg && <div className="notice">{msg}</div>}
        {creds && (
          <div className="owner-creds">
            <div>
              <span className="eyebrow">{creds.title}</span>
              <div className="plan-current">
                <div><span className="eyebrow">Login</span><b data-testid="text-owner-issued-username">{creds.username}</b></div>
                <div><span className="eyebrow">Parol</span><b data-testid="text-owner-issued-password">{creds.password}</b></div>
              </div>
              <p className="muted-line">Bir marta koʻrsatiladi — mijozga bering.</p>
            </div>
            <button type="button" className="button ghost" onClick={() => setCreds(null)}>Yopish</button>
          </div>
        )}

        <div className="owner-tabs">
          <button type="button" className={tab === 'companies' ? 'on' : ''} onClick={() => setTab('companies')}><Building2 size={15} /> Kompaniyalar</button>
          <button type="button" className={tab === 'payments' ? 'on' : ''} onClick={() => setTab('payments')}><CreditCard size={15} /> Toʻlovlar</button>
          <button type="button" className={tab === 'apps' ? 'on' : ''} onClick={() => setTab('apps')}><ClipboardList size={15} /> Arizalar {apps.data?.length ? `(${apps.data.length})` : ''}</button>
        </div>

        {tab === 'apps' && (
          <section className="owner-panel">
            <h2>Yangi arizalar</h2>
            <div className="owner-table-wrap">
              <table>
                <thead><tr><th>Ism</th><th>Kompaniya</th><th>Aloqa</th><th>Sana</th><th>Amal</th></tr></thead>
                <tbody>
                  {(apps.data ?? []).map((row) => (
                    <tr key={row.id}>
                      <td><b>{row.displayName}</b></td>
                      <td>{row.companyName || '—'}</td>
                      <td>{row.phone}<div className="muted-line">{row.email}</div></td>
                      <td>{new Date(row.createdAt).toLocaleString('uz-UZ')}</td>
                      <td className="row-actions">
                        <button type="button" className="button primary" disabled={approve.isPending} onClick={() => approve.mutate(row.id)}>Akkaunt ochish</button>
                        <button type="button" className="button ghost" disabled={reject.isPending} onClick={() => reject.mutate(row.id)}>Rad etish</button>
                      </td>
                    </tr>
                  ))}
                  {!apps.data?.length && <tr><td colSpan={5}>Kutayotgan ariza yoʻq.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === 'payments' && (
          <section className="owner-panel">
            <h2>Barcha toʻlovlar</h2>
            <div className="owner-table-wrap">
              <table>
                <thead><tr><th>ID</th><th>Kompaniya</th><th>Tarif</th><th>Summa</th><th>Status</th><th>Sana</th></tr></thead>
                <tbody>
                  {allPayments.map((p) => (
                    <tr key={p.id}>
                      <td>{p.merchantTransId}</td>
                      <td>{p.companyName}</td>
                      <td>{p.planCode}</td>
                      <td>{money(p.amount)}</td>
                      <td>{p.status}</td>
                      <td>{new Date(p.paidAt || p.createdAt).toLocaleString('uz-UZ')}</td>
                    </tr>
                  ))}
                  {!allPayments.length && <tr><td colSpan={6}>Toʻlovlar yoʻq.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === 'companies' && (
          <section className="owner-panel">
            <h2>Kompaniyalar · foydalanuvchilar · toʻlovlar</h2>
            <div className="owner-company-list">
              {companies.map((c) => {
                const open = openId === c.id;
                const remain = remainFrom(c.endsAt);
                const ended = remain != null && remain.totalMs <= 0;
                return (
                  <article key={c.id} className={`owner-company ${open ? 'open' : ''} ${c.subscriptionStatus === 'canceled' || c.subscriptionStatus === 'past_due' || ended ? 'muted' : ''}`}>
                    <button type="button" className="owner-company-head" onClick={() => setOpenId(open ? null : c.id)}>
                      <span className="owner-chev">{open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</span>
                      <div className="owner-company-meta">
                        <b>{c.name}</b>
                        <span>#{c.id} · {statusLabel(c.subscriptionStatus)} · {c.userCount} foydalanuvchi · {money(c.paidTotal)}</span>
                        <div className="owner-plan-row">
                          <em className="owner-plan-badge">{c.planName}</em>
                          <span>Tugash: {formatEnds(c.endsAt)}</span>
                        </div>
                      </div>
                      <div className={`owner-company-days ${ended ? 'ended' : remain && remain.days <= 3 ? 'warn' : ''}`}>
                        {remain == null ? '—' : ended ? 'Tugagan' : (
                          <span className="owner-countdown" title="Qolgan muddat" data-tick={tick}>
                            <b>{remain.days}</b>k <b>{String(remain.hours).padStart(2, '0')}</b>:<b>{String(remain.minutes).padStart(2, '0')}</b>:<b>{String(remain.seconds).padStart(2, '0')}</b>
                          </span>
                        )}
                      </div>
                    </button>

                    {open && (
                      <div className="owner-company-body">
                        <div className="owner-sub-card">
                          <div><span>Tarif</span><b>{c.planName}</b></div>
                          <div><span>Holat</span><b>{statusLabel(c.subscriptionStatus)}</b></div>
                          <div><span>Tugash sanasi</span><b>{formatEnds(c.endsAt)}</b></div>
                          <div><span>Qolgan</span><b>{remain == null ? '—' : ended ? '0 kun' : `${remain.days} kun ${String(remain.hours).padStart(2, '0')}:${String(remain.minutes).padStart(2, '0')}:${String(remain.seconds).padStart(2, '0')}`}</b></div>
                          <div><span>Filial limiti</span><b>{c.branchLimit == null ? 'Istalgancha' : `${c.branchLimit} ta`}</b></div>
                          <div><span>Bosh admin</span><b>{c.owner?.displayName || '—'}{c.owner?.username ? ` · ${c.owner.username}` : ''}</b></div>
                        </div>
                        <div className="owner-actions-row">
                          <button type="button" className="button primary" disabled={enterCompany.isPending} onClick={() => enterCompany.mutate(c.id)}>
                            <ExternalLink size={14} /> Kabinetga kirish
                          </button>
                          <button type="button" className="button ghost" onClick={() => setRename({ id: c.id, name: c.name })}><Pencil size={14} /> Nom</button>
                          <button type="button" className="button ghost" onClick={() => patchOrg.mutate({ id: c.id, body: { planCode: 'starter', extendDays: 7 } })}>+7 kun</button>
                          <button type="button" className="button ghost" onClick={() => patchOrg.mutate({ id: c.id, body: { planCode: 'business', extendMonths: 1 } })}>Biznes</button>
                          <button type="button" className="button ghost" onClick={() => patchOrg.mutate({ id: c.id, body: { planCode: 'enterprise', extendMonths: 1 } })}>Korxona</button>
                          <button type="button" className="button ghost" onClick={() => patchOrg.mutate({ id: c.id, body: { planCode: 'custom', extendMonths: 1 } })}>Maxsus</button>
                          <button type="button" className="button ghost" onClick={() => patchOrg.mutate({ id: c.id, body: { subscriptionStatus: 'active' } })}><Check size={14} /> Faollashtirish</button>
                          <button type="button" className="button ghost" onClick={() => { if (confirm(`${c.name} ni vaqtincha cheklaysizmi?`)) suspendOrg.mutate(c.id); }}><Ban size={14} /> Cheklash</button>
                          <button type="button" className="button ghost" onClick={() => { if (confirm(`${c.name} ni butunlay oʻchirasizmi?`)) deleteOrg.mutate(c.id); }}><Trash2 size={14} /> Oʻchirish</button>
                          <button type="button" className="button ghost" onClick={() => setNewUser({ orgId: c.id, displayName: '', phone: '', role: 'admin' })}><UserPlus size={14} /> Foydalanuvchi</button>
                        </div>

                        {rename?.id === c.id && (
                          <form className="owner-inline-form" onSubmit={(e) => { e.preventDefault(); patchOrg.mutate({ id: c.id, body: { name: rename.name } }); }}>
                            <input value={rename.name} onChange={(e) => setRename({ ...rename, name: e.target.value })} />
                            <button type="submit" className="button primary">Saqlash</button>
                            <button type="button" className="button ghost" onClick={() => setRename(null)}>Bekor</button>
                          </form>
                        )}

                        {newUser?.orgId === c.id && (
                          <form className="owner-inline-form" onSubmit={(e) => { e.preventDefault(); createUser.mutate(); }}>
                            <input required placeholder="Ism" value={newUser.displayName} onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })} />
                            <input placeholder="Telefon" value={newUser.phone} onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })} />
                            <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
                              <option value="admin">Administrator</option>
                              <option value="viewer">Kuzatuvchi</option>
                              <option value="finance">Moliya</option>
                            </select>
                            <button type="submit" className="button primary" disabled={createUser.isPending}><Plus size={14} /> Yaratish</button>
                            <button type="button" className="button ghost" onClick={() => setNewUser(null)}>Bekor</button>
                          </form>
                        )}

                        <h3><Users size={15} /> Foydalanuvchilar</h3>
                        <div className="owner-table-wrap">
                          <table>
                            <thead><tr><th>Ism</th><th>Login</th><th>Rol</th><th>Holat</th><th>Oxirgi kirish</th><th>Amal</th></tr></thead>
                            <tbody>
                              {c.users.map((u) => (
                                <tr key={u.id}>
                                  <td><b>{u.displayName}</b>{c.owner?.id === u.id && <span className="owner-pill">Egasi</span>}<div className="muted-line">{u.phone || u.email || '—'}</div></td>
                                  <td>{u.username || '—'}</td>
                                  <td>
                                    <select value={u.role} onChange={(e) => patchUser.mutate({ id: u.id, body: { role: e.target.value } })}>
                                      <option value="admin">Admin</option>
                                      <option value="viewer">Kuzatuvchi</option>
                                      <option value="finance">Moliya</option>
                                    </select>
                                  </td>
                                  <td>{statusLabel(u.status)}</td>
                                  <td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('uz-UZ') : '—'}</td>
                                  <td className="row-actions">
                                    {u.status === 'active'
                                      ? <button type="button" className="button ghost" onClick={() => patchUser.mutate({ id: u.id, body: { status: 'disabled' } })}><Ban size={13} /></button>
                                      : <button type="button" className="button ghost" onClick={() => patchUser.mutate({ id: u.id, body: { status: 'active' } })}><Check size={13} /></button>}
                                    {u.username && <button type="button" className="button ghost" onClick={() => resetPass.mutate(u.id)}><KeyRound size={13} /></button>}
                                    <button type="button" className="button ghost" onClick={() => { if (confirm(`${u.displayName} ni oʻchirasizmi?`)) removeUser.mutate(u.id); }}><Trash2 size={13} /></button>
                                  </td>
                                </tr>
                              ))}
                              {!c.users.length && <tr><td colSpan={6}>Foydalanuvchi yoʻq.</td></tr>}
                            </tbody>
                          </table>
                        </div>

                        <h3><Wallet size={15} /> Toʻlovlar</h3>
                        <div className="owner-table-wrap">
                          <table>
                            <thead><tr><th>ID</th><th>Tarif</th><th>Summa</th><th>Status</th><th>Sana</th></tr></thead>
                            <tbody>
                              {c.payments.map((p) => (
                                <tr key={p.id}>
                                  <td>{p.merchantTransId}</td>
                                  <td>{p.planCode}</td>
                                  <td>{money(p.amount)}</td>
                                  <td>{p.status}</td>
                                  <td>{new Date(p.paidAt || p.createdAt).toLocaleString('uz-UZ')}</td>
                                </tr>
                              ))}
                              {!c.payments.length && <tr><td colSpan={5}>Toʻlov yoʻq.</td></tr>}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
              {!companies.length && <div className="muted-line">Hali kompaniya yoʻq.</div>}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
