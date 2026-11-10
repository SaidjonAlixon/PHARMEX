import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck, Ban, Calculator, Check, ClipboardList, Copy, Crown, Eye, Hourglass, KeyRound, Mail, MailCheck,
  Pencil, Phone, Plus, RotateCcw, ShieldCheck, Sparkles, Trash2, UserCheck, UserPlus, UserX, Users, X,
} from 'lucide-react';
import { useGetCurrentUser } from '@workspace/api-client-react';
import { SelectMenu, type MenuOption } from '@/components/select-menu';
import {
  Chips, DataState, FormError, KpiStrip, Modal, PageHeading, Panel, SearchBox, StatusBadge, TableWrap, dateTime,
} from '@/components/kit';

type Status = 'active' | 'pending' | 'rejected' | 'disabled';
type Account = {
  id: number;
  displayName: string;
  email: string;
  username: string | null;
  phone: string;
  role: string;
  status: Status;
  signupMethod: 'admin' | 'google' | 'email' | 'request';
  emailVerifiedAt: string | null;
  hasPassword: boolean;
  hasGoogle: boolean;
  reviewedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
};
type Credentials = { username: string; password: string };
type AccountsResponse = {
  users: Account[];
  policy: { autoApproveVerified: boolean };
  me: number;
  ownerId: number | null;
  isOwner: boolean;
  canManageUsers?: boolean;
  mail: { configured: boolean; devMode: boolean };
  google: boolean;
};

const accountsKey = ['accounts'] as const;

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Amal bajarilmadi.');
  return data as T;
}

/** Admin-only: the pending count drives the sidebar badge. */
export function usePendingAccounts() {
  const me = useGetCurrentUser();
  const isAdmin = me.data?.role === 'admin' || me.data?.role === 'platform_admin';
  const q = useQuery({ queryKey: accountsKey, queryFn: () => request<AccountsResponse>('GET', '/accounts'), enabled: isAdmin, refetchInterval: 30_000 });
  return { isAdmin, pending: q.data?.users.filter(u => u.status === 'pending').length ?? 0 };
}

export const roleMenu: MenuOption[] = [
  { value: 'viewer', label: 'Kuzatuvchi', hint: 'Hammasi koʻrinadi · tugmalar ishlamaydi · yuklab olish mumkin', icon: Eye, color: '#6b7a96' },
  { value: 'finance', label: 'Moliya xodimi', hint: 'Hujjat va pul amallari', icon: Calculator, color: '#1f5fd0' },
  { value: 'admin', label: 'Administrator', hint: 'Kompaniya maʼlumotlari · foydalanuvchi yaratish', icon: Crown, color: '#0fb3c7' },
];
const roleLabel = (r: string) => roleMenu.find(m => m.value === r)?.label ?? r;

const statusView: Record<Status, { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }> = {
  active: { label: 'Faol', tone: 'good' },
  pending: { label: 'Tasdiq kutmoqda', tone: 'warn' },
  rejected: { label: 'Rad etilgan', tone: 'bad' },
  disabled: { label: 'Bloklangan', tone: 'neutral' },
};

const methodView: Record<Account['signupMethod'], { label: string; icon: typeof Mail; cls: string }> = {
  google: { label: 'Google', icon: Sparkles, cls: 'google' },
  email: { label: 'Email + kod', icon: MailCheck, cls: 'email' },
  request: { label: 'Ariza', icon: ClipboardList, cls: 'request' },
  admin: { label: 'Qoʻlda', icon: KeyRound, cls: 'admin' },
};

const phoneView = (p: string) => {
  const m = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(p);
  return m ? `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : p;
};

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('') || '?';

function MethodTag({ method }: { method: Account['signupMethod'] }) {
  const m = methodView[method] ?? methodView.admin;
  return <span className={`acc-method ${m.cls}`}><m.icon size={12} />{m.label}</span>;
}

function Avatar({ account }: { account: Account }) {
  return <span className={`acc-ava ${account.status}`}>{initials(account.displayName)}</span>;
}

function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`acc-switch ${checked ? 'on' : ''}`} disabled={disabled} onClick={() => onChange(!checked)} data-testid="switch-auto-approve"><i /></button>;
}

function copyTextFallback(text: string) {
  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  el.style.position = 'fixed';
  el.style.top = '0';
  el.style.left = '0';
  el.style.width = '1px';
  el.style.height = '1px';
  el.style.padding = '0';
  el.style.border = 'none';
  el.style.outline = 'none';
  el.style.boxShadow = 'none';
  el.style.background = 'transparent';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.focus();
  el.select();
  el.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(el);
  return ok;
}

async function copyText(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through */
    }
  }
  return copyTextFallback(text);
}

function CredentialsCard({
  credentials, title, onClose,
}: {
  credentials: Credentials;
  title: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<'login' | 'password' | 'both' | null>(null);
  const [copyError, setCopyError] = useState(false);
  const both = `Login: ${credentials.username}\nParol: ${credentials.password}`;
  const mark = async (kind: 'login' | 'password' | 'both', value: string) => {
    setCopyError(false);
    const ok = await copyText(value);
    if (ok) {
      setCopied(kind);
      setTimeout(() => setCopied(null), 2000);
    } else {
      setCopyError(true);
    }
  };
  return (
    <Modal eyebrow="KIRISH MAʼLUMOTLARI" title={title} onClose={onClose}>
      <div className="acc-creds">
        <p className="field-hint">Parol faqat hozir koʻrsatiladi. Saqlab qoʻying yoki nusxalang — keyin qayta koʻrsatilmaydi (yangilash mumkin).</p>
        <label>
          Login
          <div className="acc-cred-row">
            <input
              readOnly
              value={credentials.username}
              data-testid="input-cred-username"
              onFocus={e => e.currentTarget.select()}
              onClick={e => e.currentTarget.select()}
            />
            <button type="button" className="button secondary" onClick={() => void mark('login', credentials.username)}>
              <Copy size={14} /> {copied === 'login' ? 'Nusxa olindi' : 'Nusxa'}
            </button>
          </div>
        </label>
        <label>
          Parol
          <div className="acc-cred-row">
            <input
              readOnly
              value={credentials.password}
              data-testid="input-cred-password"
              onFocus={e => e.currentTarget.select()}
              onClick={e => e.currentTarget.select()}
            />
            <button type="button" className="button secondary" onClick={() => void mark('password', credentials.password)}>
              <Copy size={14} /> {copied === 'password' ? 'Nusxa olindi' : 'Nusxa'}
            </button>
          </div>
        </label>
        {copyError && <div className="notice error">Nusxa olinmadi. Maydonni bosing (matn tanlanadi) va Ctrl+C qiling.</div>}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={() => void mark('both', both)}>
            <Copy size={15} /> {copied === 'both' ? 'Ikkalasi nusxa olindi' : 'Login + parol nusxa'}
          </button>
          <button type="button" className="button primary" onClick={onClose} data-testid="button-cred-done">Yopish</button>
        </div>
      </div>
    </Modal>
  );
}

function UserFormModal({
  mode, initial, busy, error, onClose, onSubmit,
}: {
  mode: 'create' | 'edit';
  initial?: Account;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (v: { displayName: string; phone: string; role: string }) => void;
}) {
  const [displayName, setDisplayName] = useState(initial?.displayName || '');
  const [phone, setPhone] = useState(initial?.phone || '');
  const [role, setRole] = useState(initial?.role || 'viewer');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({ displayName: displayName.trim(), phone: phone.trim(), role });
  };
  return (
    <Modal
      eyebrow={mode === 'create' ? 'YANGI FOYDALANUVCHI' : 'TAHRIRLASH'}
      title={mode === 'create' ? 'Foydalanuvchi yaratish' : 'Foydalanuvchini tahrirlash'}
      onClose={onClose}
      busy={busy}
    >
      <form className="form-stack" onSubmit={submit}>
        <label>
          Ismi
          <input required value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Masalan: Dilshod Karimov" data-testid="input-user-name" />
        </label>
        <label>
          Telefon
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+998 90 123 45 67" inputMode="tel" data-testid="input-user-phone" />
        </label>
        <div className="acc-form-role">
          <span>Rol</span>
          <SelectMenu ariaLabel="Rol" value={role} onChange={setRole} options={roleMenu} testId="select-user-role" />
        </div>
        {mode === 'create' && (
          <p className="field-hint">
            <KeyRound size={14} /> Yaratilganda login va parol avtomatik beriladi — darhol nusxalashingiz mumkin.
          </p>
        )}
        <FormError error={error} />
        <div className="modal-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>Bekor</button>
          <button type="submit" className="button primary" disabled={busy} data-testid="button-save-user">
            {mode === 'create' ? <><UserPlus size={15} /> Yaratish</> : <><Check size={15} /> Saqlash</>}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function UsersPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: accountsKey, queryFn: () => request<AccountsResponse>('GET', '/accounts') });
  const [roles, setRoles] = useState<Record<number, string>>({});
  const [filter, setFilter] = useState<'all' | Status>('all');
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [credentials, setCredentials] = useState<{ title: string; value: Credentials } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const data = q.data;
  const isOwner = !!data?.isOwner;
  const canManage = !!data?.canManageUsers || isOwner;
  const ownerId = data?.ownerId ?? null;

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { status?: Status; role?: string; displayName?: string; phone?: string } }) =>
      request<{ user: Account; mailed: boolean }>('PATCH', `/accounts/${id}`, body),
    onSuccess: (r, v) => {
      qc.invalidateQueries({ queryKey: accountsKey });
      setEditing(null);
      setFormError(null);
      const name = r.user.displayName;
      const text = v.body.status === 'active' && !v.body.role && !v.body.displayName
        ? `${name} faollashtirildi.`
        : v.body.status === 'active' && v.body.role ? `${name} tasdiqlandi — rol: ${roleLabel(r.user.role)}.`
        : v.body.status === 'rejected' ? `${name} arizasi rad etildi.`
        : v.body.status === 'disabled' ? `${name} bloklandi.`
        : v.body.displayName || v.body.phone !== undefined ? `${name} maʼlumotlari yangilandi.`
        : `${name} roli: ${roleLabel(r.user.role)}.`;
      setMessage({ tone: 'success', text: r.mailed ? `${text} Foydalanuvchiga email yuborildi.` : text });
    },
    onError: (e: Error) => {
      setFormError(e.message);
      setMessage({ tone: 'error', text: e.message });
    },
  });

  const create = useMutation({
    mutationFn: (body: { displayName: string; phone: string; role: string }) =>
      request<{ user: Account; credentials: Credentials }>('POST', '/accounts', body),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: accountsKey });
      setCreating(false);
      setFormError(null);
      setCredentials({ title: `${r.user.displayName} — kirish maʼlumotlari`, value: r.credentials });
      setMessage({ tone: 'success', text: `${r.user.displayName} yaratildi. Login va parolni nusxalang.` });
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const resetPassword = useMutation({
    mutationFn: (id: number) =>
      request<{ user: Account; credentials: Credentials }>('POST', `/accounts/${id}/reset-password`),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: accountsKey });
      setCredentials({ title: `${r.user.displayName} — yangi parol`, value: r.credentials });
      setMessage({ tone: 'success', text: `Yangi parol yaratildi: ${r.user.displayName}` });
    },
    onError: (e: Error) => setMessage({ tone: 'error', text: e.message }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => request<{ ok: boolean }>('DELETE', `/accounts/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: accountsKey });
      setMessage({ tone: 'success', text: 'Foydalanuvchi oʻchirildi.' });
    },
    onError: (e: Error) => setMessage({ tone: 'error', text: e.message }),
  });

  const policy = useMutation({
    mutationFn: (autoApproveVerified: boolean) => request('PUT', '/accounts/policy', { autoApproveVerified }),
    onSuccess: () => qc.invalidateQueries({ queryKey: accountsKey }),
    onError: (e: Error) => setMessage({ tone: 'error', text: e.message }),
  });

  const users = data?.users ?? [];
  const pending = users.filter(u => u.status === 'pending');
  const counts = useMemo(() => ({
    all: users.length,
    active: users.filter(u => u.status === 'active').length,
    pending: pending.length,
    rejected: users.filter(u => u.status === 'rejected').length,
    disabled: users.filter(u => u.status === 'disabled').length,
  }), [users, pending.length]);
  const shown = users.filter(u => (filter === 'all' || u.status === filter)
    && `${u.displayName} ${u.email} ${u.username ?? ''} ${u.phone}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  const act = (id: number, body: { status?: Status; role?: string; displayName?: string; phone?: string }) => {
    setMessage(null);
    setFormError(null);
    patch.mutate({ id, body });
  };
  const busyId = patch.isPending ? patch.variables?.id
    : resetPassword.isPending ? resetPassword.variables
    : remove.isPending ? remove.variables
    : undefined;

  return <>
    <PageHeading
      eyebrow="KIRISH VA HUQUQLAR"
      title="Foydalanuvchilar"
      subtitle="Qoʻlda yaratish · rollar · login/parol · kuzatuvchi faqat koʻradi"
      actions={canManage && (
        <button type="button" className="button primary" onClick={() => { setFormError(null); setCreating(true); }} data-testid="button-create-user">
          <Plus size={16} /> Foydalanuvchi yaratish
        </button>
      )}
    />
    {q.isError && <div className="notice error">{(q.error as Error).message}</div>}
    <DataState loading={q.isLoading} error={false} empty={false} retry={() => q.refetch()} />
    {data && <>
      <KpiStrip items={[
        { label: 'Jami foydalanuvchi', value: counts.all, count: true, icon: Users },
        { label: 'Faol', value: counts.active, count: true, icon: UserCheck, tone: 'good' },
        { label: 'Tasdiq kutmoqda', value: counts.pending, count: true, icon: Hourglass, tone: counts.pending ? 'warn' : undefined },
        { label: 'Rad etilgan / bloklangan', value: counts.rejected + counts.disabled, count: true, icon: UserX },
      ]} />
      {message && <div className={`notice ${message.tone}`} data-testid="status-accounts-message">{message.text}</div>}
      {!canManage && (
        <div className="notice warn">
          Faqat administrator foydalanuvchi yaratadi va boshqaradi. Kuzatuvchi faqat koʻradi.
        </div>
      )}

      <div className="acc-grid">
        <Panel title="Tasdiq kutayotganlar" subtitle={pending.length ? `${pending.length} ta yangi ariza` : 'Yangi arizalar yoʻq'} className="acc-pending-panel">
          {!pending.length && <div className="acc-empty"><span><BadgeCheck size={22} /></span><b>Hammasi koʻrib chiqilgan</b><small>Yangi arizalar shu yerda paydo boʻladi.</small></div>}
          <div className="acc-requests">{pending.map((u, i) => {
            const role = roles[u.id] ?? 'viewer';
            const busy = busyId === u.id;
            return <article key={u.id} className="acc-req" style={{ ['--i' as string]: i }} data-testid={`card-pending-${u.id}`}>
              <div className="acc-req-who">
                <Avatar account={u} />
                <div>
                  <b>{u.displayName}</b>
                  <span><Mail size={13} />{u.email || u.username}{u.emailVerifiedAt ? <em className="acc-verified"><BadgeCheck size={12} /> tasdiqlangan</em> : <em className="acc-unverified">tasdiqlanmagan</em>}</span>
                  {u.phone && <span><Phone size={13} />{phoneView(u.phone)}</span>}
                  <div className="acc-req-tags"><MethodTag method={u.signupMethod} /><small>{dateTime(u.createdAt)}</small></div>
                </div>
              </div>
              {canManage && (
                <div className="acc-req-actions">
                  <SelectMenu ariaLabel="Rol" caption="ROL" value={role} onChange={v => setRoles({ ...roles, [u.id]: v })} options={roleMenu} align="right" testId={`select-role-${u.id}`} />
                  <button className="button primary" disabled={busy} onClick={() => act(u.id, { status: 'active', role })} data-testid={`button-approve-${u.id}`}><Check size={15} />Tasdiqlash</button>
                  <button className="button danger-soft" disabled={busy} onClick={() => act(u.id, { status: 'rejected' })} data-testid={`button-reject-${u.id}`}><X size={15} />Rad etish</button>
                </div>
              )}
            </article>;
          })}</div>
        </Panel>

        <Panel title="Kirish usullari" subtitle="Boshlash sahifasidagi 3 ta yoʻl">
          <div className="acc-methods">
            <div className={`acc-method-row ${data.google ? 'on' : ''}`}>
              <span className="acc-method-icon google"><Sparkles size={17} /></span>
              <div><b>Google orqali</b><small>{data.google ? 'Yoqilgan — Gmail bilan bir bosishda' : 'Sozlanmagan: .env ga GOOGLE_CLIENT_ID va GOOGLE_CLIENT_SECRET'}</small></div>
              <StatusBadge tone={data.google ? 'good' : 'warn'}>{data.google ? 'Faol' : 'Sozlanmagan'}</StatusBadge>
            </div>
            <div className={`acc-method-row ${data.mail.configured ? 'on' : ''}`}>
              <span className="acc-method-icon email"><MailCheck size={17} /></span>
              <div><b>Email + 6 xonali kod</b><small>{data.mail.configured ? 'Yoqilgan — kodlar Gmail orqali yuboriladi' : data.mail.devMode ? 'Test rejimi: SMTP yoʻq, kod server jurnaliga yoziladi' : 'Sozlanmagan: SMTP_HOST, SMTP_USER, SMTP_PASS'}</small></div>
              <StatusBadge tone={data.mail.configured ? 'good' : 'warn'}>{data.mail.configured ? 'Faol' : data.mail.devMode ? 'Test' : 'Sozlanmagan'}</StatusBadge>
            </div>
            <div className="acc-method-row on">
              <span className="acc-method-icon request"><ClipboardList size={17} /></span>
              <div><b>Ariza qoldirish</b><small>Ism, telefon, email va parol — siz tasdiqlaysiz</small></div>
              <StatusBadge tone="good">Faol</StatusBadge>
            </div>
          </div>
          <div className="acc-policy">
            <div>
              <b>Tasdiqlangan email bilan darhol kirish</b>
              <small>{data.policy.autoApproveVerified
                ? 'Google yoki email-kod orqali roʻyxatdan oʻtganlar «Kuzatuvchi» roli bilan darhol kiradi.'
                : 'Hozir barcha yangi akkauntlar bosh admin tasdigʻini kutadi.'}</small>
            </div>
            <Switch checked={data.policy.autoApproveVerified} disabled={!canManage || policy.isPending} onChange={v => policy.mutate(v)} label="Tasdiqlangan email bilan darhol kirish" />
          </div>
          <p className="field-hint"><ShieldCheck size={14} /> Kuzatuvchi hamma boʻlimni koʻradi, filter va yuklab olish ishlaydi; oʻzgartirish tugmalari oʻchirilgan.</p>
        </Panel>
      </div>

      <Panel
        title="Barcha foydalanuvchilar"
        subtitle={`${shown.length} ta koʻrsatilmoqda`}
        action={<SearchBox value={query} onChange={setQuery} placeholder="Ism, login, email yoki telefon" />}
      >
        <div className="acc-filter"><Chips value={filter} onChange={setFilter} options={[
          { id: 'all', label: 'Barchasi', count: counts.all },
          { id: 'active', label: 'Faol', count: counts.active },
          { id: 'pending', label: 'Kutmoqda', count: counts.pending },
          { id: 'disabled', label: 'Bloklangan', count: counts.disabled },
          { id: 'rejected', label: 'Rad etilgan', count: counts.rejected },
        ]} /></div>
        {shown.length ? <TableWrap><thead><tr><th>FOYDALANUVCHI</th><th>TELEFON</th><th>USUL</th><th>ROL</th><th>HOLAT</th><th>OXIRGI KIRISH</th><th /></tr></thead>
          <tbody>{shown.map(u => {
            const self = u.id === data.me;
            const isTargetOwner = ownerId === u.id;
            const busy = busyId === u.id;
            const s = statusView[u.status] ?? statusView.disabled;
            return <tr key={u.id} data-testid={`row-account-${u.id}`}>
              <td>
                <div className="acc-cell">
                  <Avatar account={u} />
                  <div>
                    <b>
                      {u.displayName}
                      {self && <em className="acc-you">siz</em>}
                      {isTargetOwner && <em className="acc-owner">bosh admin</em>}
                    </b>
                    <small>{u.username ? `@${u.username}` : u.email || '—'}{u.emailVerifiedAt && <BadgeCheck size={12} className="acc-ok" />}</small>
                  </div>
                </div>
              </td>
              <td className="acc-phone">{u.phone ? phoneView(u.phone) : '—'}</td>
              <td><MethodTag method={u.signupMethod} /></td>
              <td>
                {!canManage || self || isTargetOwner || u.status !== 'active'
                  ? <span className="acc-role">{roleLabel(u.role)}</span>
                  : <SelectMenu ariaLabel="Rol" value={u.role} onChange={role => role !== u.role && act(u.id, { role })} options={roleMenu} className="acc-role-menu" testId={`select-row-role-${u.id}`} />}
              </td>
              <td><StatusBadge tone={s.tone}>{s.label}</StatusBadge></td>
              <td>{u.lastLoginAt ? dateTime(u.lastLoginAt) : <span className="muted">Hali kirmagan</span>}</td>
              <td className="acc-actions">
                {canManage && !isTargetOwner && !self && (
                  <>
                    <button type="button" className="button ghost small" disabled={busy} title="Tahrirlash" onClick={() => { setFormError(null); setEditing(u); }} data-testid={`button-edit-${u.id}`}>
                      <Pencil size={13} />
                    </button>
                    {u.username && (
                      <button type="button" className="button ghost small" disabled={busy} title="Yangi parol" onClick={() => {
                        if (confirm(`${u.displayName} uchun yangi parol yaratilsinmi? Eski parol ishlamay qoladi.`)) resetPassword.mutate(u.id);
                      }} data-testid={`button-reset-password-${u.id}`}>
                        <KeyRound size={13} />
                      </button>
                    )}
                    {u.status === 'active' ? (
                      <button className="button secondary small" disabled={busy} onClick={() => act(u.id, { status: 'disabled' })} data-testid={`button-disable-${u.id}`}><Ban size={13} />Bloklash</button>
                    ) : u.status === 'pending' ? (
                      <button className="button primary small" disabled={busy} onClick={() => act(u.id, { status: 'active', role: roles[u.id] ?? 'viewer' })}><Check size={13} />Tasdiqlash</button>
                    ) : (
                      <button className="button secondary small" disabled={busy} onClick={() => act(u.id, { status: 'active' })} data-testid={`button-enable-${u.id}`}><RotateCcw size={13} />Faollashtirish</button>
                    )}
                    <button type="button" className="button danger-soft small" disabled={busy} title="Oʻchirish" onClick={() => {
                      if (confirm(`${u.displayName} butunlay oʻchirilsinmi?`)) remove.mutate(u.id);
                    }} data-testid={`button-delete-${u.id}`}>
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
                {canManage && self && u.username && (
                  <button type="button" className="button secondary small" disabled={busy} onClick={() => {
                    if (confirm('Oʻzingiz uchun yangi parol yaratilsinmi?')) resetPassword.mutate(u.id);
                  }} data-testid="button-reset-own-password">
                    <KeyRound size={13} /> Parolni yangilash
                  </button>
                )}
              </td>
            </tr>;
          })}</tbody>
        </TableWrap> : <div className="inline-empty">Mos foydalanuvchi topilmadi</div>}
      </Panel>
    </>}

    {creating && (
      <UserFormModal
        mode="create"
        busy={create.isPending}
        error={formError}
        onClose={() => !create.isPending && setCreating(false)}
        onSubmit={v => { setFormError(null); create.mutate(v); }}
      />
    )}
    {editing && (
      <UserFormModal
        mode="edit"
        initial={editing}
        busy={patch.isPending}
        error={formError}
        onClose={() => !patch.isPending && setEditing(null)}
        onSubmit={v => act(editing.id, v)}
      />
    )}
    {credentials && (
      <CredentialsCard
        title={credentials.title}
        credentials={credentials.value}
        onClose={() => setCredentials(null)}
      />
    )}
  </>;
}
