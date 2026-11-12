import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban, CalendarClock, Check, ExternalLink, KeyRound, Pencil, Plus, Trash2, UserPlus,
} from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { Link, Redirect } from 'wouter';
import { OwnerShell } from './shell';
import {
  Creds, EmptyState, PageHeader, StatusBadge, formatDate, money, ownerApi,
  payStatusLabel, payTone, remainLabel, roleLabel, subStatusLabel, subTone, userStatusLabel,
} from './shared';

type Detail = {
  organization: {
    id: number; name: string; planCode: string; planName: string; subscriptionStatus: string;
    endsAt: string | null; daysLeft: number | null; branchLimit: number | null;
    trialEndsAt: string | null; planExpiresAt: string | null; createdAt: string; updatedAt: string;
  };
  owner: { id: number; displayName: string; email: string; phone: string; username: string | null; lastLoginAt: string | null } | null;
  users: Array<{
    id: number; displayName: string; email: string; username: string | null; phone: string;
    role: string; status: string; lastLoginAt: string | null; createdAt: string;
  }>;
  payments: Array<{
    id: number; planCode: string; amount: number; status: string; merchantTransId: string;
    clickTransId: string | null; errorNote: string; paidAt: string | null; createdAt: string;
  }>;
  branches: Array<{
    id: number; name: string; region: string; address: string; manager: string; status: string; fomId: number | null;
  }>;
  audit: Array<{ id: number; action: string; summary: string; actorId: string; createdAt: string }>;
  totals: { paidTotal: number; pendingTotal: number; userCount: number; branchCount: number; activeBranches: number };
};

function toDateInput(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export function OwnerCompanyDetailPage({ id }: { id: number }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'overview' | 'plan' | 'payments' | 'branches' | 'users' | 'audit'>('overview');
  const [msg, setMsg] = useState('');
  const [creds, setCreds] = useState<Creds>(null);
  const [rename, setRename] = useState('');
  const [planCode, setPlanCode] = useState('starter');
  const [customDays, setCustomDays] = useState('30');
  const [endsDate, setEndsDate] = useState('');
  const [branchLimit, setBranchLimit] = useState('');
  const [newUser, setNewUser] = useState<{ displayName: string; phone: string; role: string } | null>(null);

  const detail = useQuery({
    queryKey: ['owner-crm-company', id],
    queryFn: () => ownerApi<Detail>(`/api/platform/crm/companies/${id}`),
    enabled: Number.isFinite(id),
  });

  useEffect(() => {
    const o = detail.data?.organization;
    if (!o) return;
    setPlanCode(o.planCode || 'starter');
    setEndsDate(toDateInput(o.endsAt || o.planExpiresAt));
    setBranchLimit(o.branchLimit == null ? '' : String(o.branchLimit));
    if (!rename) setRename(o.name);
  }, [detail.data?.organization?.id, detail.data?.organization?.updatedAt]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['owner-crm-company', id] });
    void qc.invalidateQueries({ queryKey: ['owner-crm-companies'] });
    void qc.invalidateQueries({ queryKey: ['owner-crm-dashboard'] });
  };

  const patchOrg = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      ownerApi(`/api/platform/organizations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => { setMsg('Saqlandi'); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });
  const suspend = useMutation({
    mutationFn: () => ownerApi(`/api/platform/organizations/${id}`, { method: 'DELETE' }),
    onSuccess: () => { setMsg('Kompaniya cheklandi — kabinet yopildi'); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });
  const hardDelete = useMutation({
    mutationFn: () => ownerApi(`/api/platform/organizations/${id}?hard=1`, { method: 'DELETE' }),
    onSuccess: () => { window.location.assign('/owner/companies'); },
    onError: (e: Error) => setMsg(e.message),
  });
  const enter = useMutation({
    mutationFn: () => ownerApi(`/api/platform/organizations/${id}/enter`, { method: 'POST' }),
    onSuccess: () => window.location.assign('/'),
    onError: (e: Error) => setMsg(e.message),
  });
  const createUser = useMutation({
    mutationFn: () => ownerApi<{ credentials: { username: string; password: string } }>(
      `/api/platform/organizations/${id}/users`,
      { method: 'POST', body: JSON.stringify(newUser) },
    ),
    onSuccess: (r) => {
      setCreds({ ...r.credentials, title: 'Yangi foydalanuvchi' });
      setNewUser(null);
      refresh();
    },
    onError: (e: Error) => setMsg(e.message),
  });
  const patchUser = useMutation({
    mutationFn: ({ uid, body }: { uid: number; body: Record<string, unknown> }) =>
      ownerApi(`/api/platform/users/${uid}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => refresh(),
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
    onSuccess: () => refresh(),
    onError: (e: Error) => setMsg(e.message),
  });

  if (!Number.isFinite(id)) return <Redirect to="/owner/companies" />;

  const o = detail.data?.organization;
  const totals = detail.data?.totals;
  const busy = patchOrg.isPending || suspend.isPending || hardDelete.isPending || enter.isPending;

  const savePlan = (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = { planCode };
    const days = Number(customDays);
    if (Number.isFinite(days) && days > 0) body.extendDays = days;
    if (branchLimit.trim() === '') body.branchLimit = null;
    else {
      const lim = Number(branchLimit);
      if (Number.isFinite(lim)) body.branchLimit = lim;
    }
    patchOrg.mutate(body);
  };

  const saveEnds = (e: FormEvent) => {
    e.preventDefault();
    if (!endsDate) return;
    patchOrg.mutate({ planCode, planExpiresAt: `${endsDate}T23:59:59.000Z` });
  };

  return (
    <OwnerShell>
      <div className="ocrm-breadcrumb">
        <Link href="/owner">Dashboard</Link>
        <span>/</span>
        <Link href="/owner/companies">Kompaniyalar</Link>
        <span>/</span>
        <b>{o?.name || `#${id}`}</b>
      </div>

      <PageHeader
        title={o?.name || 'Kompaniya'}
        text={o ? `#${o.id} · ${o.planName} · ${remainLabel(o.endsAt, o.daysLeft)}` : 'Yuklanmoqda…'}
        actions={
          <>
            <button type="button" className="button primary" disabled={busy} onClick={() => enter.mutate()}>
              <ExternalLink size={14} /> Kabinetga kirish
            </button>
            <button type="button" className="button ghost" disabled={busy} onClick={() => patchOrg.mutate({ planCode: o?.planCode || 'starter', extendDays: 7 })}>+7 kun</button>
            <button type="button" className="button ghost" disabled={busy} onClick={() => patchOrg.mutate({ planCode: o?.planCode || 'starter', extendMonths: 1 })}>+30 kun</button>
            <button type="button" className="button ghost" disabled={busy} onClick={() => patchOrg.mutate({ subscriptionStatus: 'active' })}><Check size={14} /> Faollashtirish</button>
            <button type="button" className="button ghost" disabled={busy} onClick={() => { if (confirm('Kompaniyani cheklaysizmi? Kabinet yopiladi.')) suspend.mutate(); }}><Ban size={14} /> Cheklash</button>
            <button type="button" className="button ghost" disabled={busy} onClick={() => { if (confirm('Kompaniyani butunlay oʻchirish? Bu qaytarilmaydi.')) hardDelete.mutate(); }}><Trash2 size={14} /> Oʻchirish</button>
          </>
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
        <div className="ocrm-kpi"><span>Holat</span><b><StatusBadge tone={subTone(o?.subscriptionStatus || '')}>{subStatusLabel(o?.subscriptionStatus || '')}</StatusBadge></b></div>
        <div className="ocrm-kpi"><span>Tarif</span><b>{o?.planName || '—'}</b></div>
        <div className="ocrm-kpi"><span>Tugash</span><b>{formatDate(o?.endsAt)}</b></div>
        <div className="ocrm-kpi"><span>Filiallar</span><b>{totals?.branchCount ?? '—'}{o?.branchLimit != null ? ` / ${o.branchLimit}` : ''}</b></div>
        <div className="ocrm-kpi"><span>Foydalanuvchilar</span><b>{totals?.userCount ?? '—'}</b></div>
        <div className="ocrm-kpi"><span>Toʻlangan</span><b>{totals ? money(totals.paidTotal) : '—'}</b></div>
      </div>

      <div className="owner-tabs">
        {([
          ['overview', 'Umumiy'],
          ['plan', 'Tarif va muddat'],
          ['payments', 'Toʻlovlar'],
          ['branches', 'Filiallar'],
          ['users', 'Foydalanuvchilar'],
          ['audit', 'Audit'],
        ] as const).map(([k, label]) => (
          <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <section className="ocrm-card">
          <div className="owner-sub-card">
            <div><span>Masʼul</span><b>{detail.data?.owner?.displayName || '—'}</b></div>
            <div><span>Telefon</span><b>{detail.data?.owner?.phone || '—'}</b></div>
            <div><span>Email</span><b>{detail.data?.owner?.email || '—'}</b></div>
            <div><span>Login</span><b>{detail.data?.owner?.username || '—'}</b></div>
            <div><span>Roʻyxat</span><b>{formatDate(o?.createdAt)}</b></div>
            <div><span>Oxirgi kirish</span><b>{formatDate(detail.data?.owner?.lastLoginAt)}</b></div>
          </div>
          <form
            className="owner-inline-form"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (rename.trim().length >= 2) patchOrg.mutate({ name: rename.trim() });
            }}
          >
            <Pencil size={14} />
            <input placeholder="Yangi nom" value={rename || o?.name || ''} onChange={(e) => setRename(e.target.value)} />
            <button type="submit" className="button primary" disabled={busy}>Nomni saqlash</button>
          </form>
        </section>
      )}

      {tab === 'plan' && (
        <section className="ocrm-card">
          <div className="owner-sub-card">
            <div><span>Joriy tarif</span><b>{o?.planName}</b></div>
            <div><span>Holat</span><b>{subStatusLabel(o?.subscriptionStatus || '')}</b></div>
            <div><span>Sinov tugashi</span><b>{formatDate(o?.trialEndsAt)}</b></div>
            <div><span>Obuna tugashi</span><b>{formatDate(o?.planExpiresAt)}</b></div>
            <div><span>Filial limiti</span><b>{o?.branchLimit == null ? 'Istalgancha' : o.branchLimit}</b></div>
            <div><span>Qolgan</span><b>{remainLabel(o?.endsAt, o?.daysLeft)}</b></div>
          </div>

          <form className="ocrm-plan-form" onSubmit={savePlan}>
            <h3>Tarifni yangilash</h3>
            <div className="ocrm-plan-grid">
              <label>
                Tarif
                <select value={planCode} onChange={(e) => setPlanCode(e.target.value)}>
                  <option value="starter">Boshlangʻich</option>
                  <option value="business">Biznes</option>
                  <option value="enterprise">Korxona</option>
                  <option value="custom">Maxsus</option>
                </select>
              </label>
              <label>
                Qoʻshimcha kun
                <input type="number" min={1} max={3650} value={customDays} onChange={(e) => setCustomDays(e.target.value)} />
              </label>
              <label>
                Filial limiti (boʻsh = cheksiz)
                <input type="number" min={0} max={999} value={branchLimit} onChange={(e) => setBranchLimit(e.target.value)} placeholder="Cheksiz" />
              </label>
            </div>
            <div className="owner-actions-row">
              <button type="submit" className="button primary" disabled={busy}>Saqlash va muddat berish</button>
              <button type="button" className="button ghost" disabled={busy} onClick={() => patchOrg.mutate({ planCode: 'business', extendMonths: 1 })}>Biznes +30</button>
              <button type="button" className="button ghost" disabled={busy} onClick={() => patchOrg.mutate({ planCode: 'enterprise', extendMonths: 1 })}>Korxona +30</button>
              <button type="button" className="button ghost" disabled={busy} onClick={() => patchOrg.mutate({ planCode: 'starter', extendDays: 7 })}>Sinov +7</button>
            </div>
          </form>

          <form className="ocrm-plan-form" onSubmit={saveEnds}>
            <h3><CalendarClock size={16} /> Aniq tugash sanasi</h3>
            <div className="ocrm-plan-grid">
              <label>
                Tugash kuni
                <input type="date" required value={endsDate} onChange={(e) => setEndsDate(e.target.value)} />
              </label>
            </div>
            <button type="submit" className="button primary" disabled={busy || !endsDate}>Sanani belgilash</button>
          </form>
        </section>
      )}

      {tab === 'payments' && (
        <section className="ocrm-card">
          <div className="owner-table-wrap">
            <table>
              <thead><tr><th>ID</th><th>Tarif</th><th>Summa</th><th>Holat</th><th>Click</th><th>Sana</th></tr></thead>
              <tbody>
                {(detail.data?.payments ?? []).map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/owner/payments?q=${encodeURIComponent(p.merchantTransId)}`}>{p.merchantTransId}</Link></td>
                    <td>{p.planCode}</td>
                    <td>{money(p.amount)}</td>
                    <td><StatusBadge tone={payTone(p.status)}>{payStatusLabel(p.status)}</StatusBadge></td>
                    <td>{p.clickTransId || '—'}</td>
                    <td>{formatDate(p.paidAt || p.createdAt)}</td>
                  </tr>
                ))}
                {!detail.data?.payments?.length && <tr><td colSpan={6}><EmptyState text="Toʻlov yoʻq." /></td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'branches' && (
        <section className="ocrm-card">
          <div className="owner-table-wrap">
            <table>
              <thead><tr><th>ID</th><th>Nom</th><th>Hudud</th><th>Manzil</th><th>Masʼul</th><th>Holat</th><th>FOM</th></tr></thead>
              <tbody>
                {(detail.data?.branches ?? []).map((b) => (
                  <tr key={b.id}>
                    <td>#{b.id}</td>
                    <td><b>{b.name}</b></td>
                    <td>{b.region || '—'}</td>
                    <td>{b.address || '—'}</td>
                    <td>{b.manager || '—'}</td>
                    <td>{b.status}</td>
                    <td>{b.fomId ?? '—'}</td>
                  </tr>
                ))}
                {!detail.data?.branches?.length && <tr><td colSpan={7}><EmptyState text="Filial yoʻq." /></td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'users' && (
        <section className="ocrm-card">
          <div className="owner-actions-row">
            <button type="button" className="button primary" onClick={() => setNewUser({ displayName: '', phone: '', role: 'admin' })}>
              <UserPlus size={14} /> Foydalanuvchi
            </button>
          </div>
          {newUser && (
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
          <div className="owner-table-wrap">
            <table>
              <thead><tr><th>Ism</th><th>Login</th><th>Rol</th><th>Holat</th><th>Oxirgi kirish</th><th>Amal</th></tr></thead>
              <tbody>
                {(detail.data?.users ?? []).map((u) => (
                  <tr key={u.id}>
                    <td><b>{u.displayName}</b><div className="muted-line">{u.phone || u.email}</div></td>
                    <td>{u.username || '—'}</td>
                    <td>
                      <select value={u.role} onChange={(e) => patchUser.mutate({ uid: u.id, body: { role: e.target.value } })}>
                        <option value="admin">Admin</option>
                        <option value="viewer">Kuzatuvchi</option>
                        <option value="finance">Moliya</option>
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
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'audit' && (
        <section className="ocrm-card">
          <div className="owner-table-wrap">
            <table>
              <thead><tr><th>Sana</th><th>Amal</th><th>Izoh</th><th>Kim</th></tr></thead>
              <tbody>
                {(detail.data?.audit ?? []).map((a) => (
                  <tr key={a.id}>
                    <td>{formatDate(a.createdAt)}</td>
                    <td>{a.action}</td>
                    <td>{a.summary || '—'}</td>
                    <td>{a.actorId}</td>
                  </tr>
                ))}
                {!detail.data?.audit?.length && <tr><td colSpan={4}><EmptyState text="Audit yozuvi yoʻq." /></td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </OwnerShell>
  );
}
