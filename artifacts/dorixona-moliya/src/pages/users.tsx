import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck, Ban, Calculator, Check, ClipboardList, Crown, Eye, Hourglass, KeyRound, Mail, MailCheck, Phone, RotateCcw, ShieldCheck, Sparkles, UserCheck, UserX, Users, X,
} from 'lucide-react';
import { useGetCurrentUser } from '@workspace/api-client-react';
import { SelectMenu, type MenuOption } from '@/components/select-menu';
import { Chips, DataState, KpiStrip, PageHeading, Panel, SearchBox, StatusBadge, TableWrap, dateTime } from '@/components/kit';

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
type AccountsResponse = {
  users: Account[];
  policy: { autoApproveVerified: boolean };
  me: number;
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
  const isAdmin = me.data?.role === 'admin';
  const q = useQuery({ queryKey: accountsKey, queryFn: () => request<AccountsResponse>('GET', '/accounts'), enabled: isAdmin, refetchInterval: 30_000 });
  return { isAdmin, pending: q.data?.users.filter(u => u.status === 'pending').length ?? 0 };
}

export const roleMenu: MenuOption[] = [
  { value: 'viewer', label: 'Kuzatuvchi', hint: 'Faqat koʻrish', icon: Eye, color: '#6b7a96' },
  { value: 'finance', label: 'Moliya xodimi', hint: 'Hujjat va pul amallari', icon: Calculator, color: '#1f5fd0' },
  { value: 'admin', label: 'Administrator', hint: 'Toʻliq boshqaruv', icon: Crown, color: '#0fb3c7' },
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
  admin: { label: 'Tizim', icon: KeyRound, cls: 'admin' },
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

export function UsersPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: accountsKey, queryFn: () => request<AccountsResponse>('GET', '/accounts') });
  const [roles, setRoles] = useState<Record<number, string>>({});
  const [filter, setFilter] = useState<'all' | Status>('all');
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { status?: Status; role?: string } }) =>
      request<{ user: Account; mailed: boolean }>('PATCH', `/accounts/${id}`, body),
    onSuccess: (r, v) => {
      qc.invalidateQueries({ queryKey: accountsKey });
      const name = r.user.displayName;
      const text = v.body.status === 'active' && !v.body.role
        ? `${name} faollashtirildi.`
        : v.body.status === 'active' ? `${name} tasdiqlandi — rol: ${roleLabel(r.user.role)}.`
        : v.body.status === 'rejected' ? `${name} arizasi rad etildi.`
        : v.body.status === 'disabled' ? `${name} bloklandi.`
        : `${name} roli: ${roleLabel(r.user.role)}.`;
      setMessage({ tone: 'success', text: r.mailed ? `${text} Foydalanuvchiga email yuborildi.` : text });
    },
    onError: (e: Error) => setMessage({ tone: 'error', text: e.message }),
  });
  const policy = useMutation({
    mutationFn: (autoApproveVerified: boolean) => request('PUT', '/accounts/policy', { autoApproveVerified }),
    onSuccess: () => qc.invalidateQueries({ queryKey: accountsKey }),
    onError: (e: Error) => setMessage({ tone: 'error', text: e.message }),
  });

  const data = q.data;
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

  const act = (id: number, body: { status?: Status; role?: string }) => { setMessage(null); patch.mutate({ id, body }); };
  const busyId = patch.isPending ? patch.variables?.id : undefined;

  return <>
    <PageHeading eyebrow="KIRISH VA HUQUQLAR" title="Foydalanuvchilar" subtitle="Roʻyxatdan oʻtish arizalari, rollar va kirish usullari" />
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
              <div className="acc-req-actions">
                <SelectMenu ariaLabel="Rol" caption="ROL" value={role} onChange={v => setRoles({ ...roles, [u.id]: v })} options={roleMenu} align="right" testId={`select-role-${u.id}`} />
                <button className="button primary" disabled={busy} onClick={() => act(u.id, { status: 'active', role })} data-testid={`button-approve-${u.id}`}><Check size={15} />Tasdiqlash</button>
                <button className="button danger-soft" disabled={busy} onClick={() => act(u.id, { status: 'rejected' })} data-testid={`button-reject-${u.id}`}><X size={15} />Rad etish</button>
              </div>
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
                ? 'Google yoki email-kod orqali roʻyxatdan oʻtganlar «Kuzatuvchi» roli bilan darhol kiradi va moliyaviy maʼlumotlarni koʻradi.'
                : 'Hozir barcha yangi akkauntlar sizning tasdigʻingizni kutadi. Ariza usuli har doim tasdiq talab qiladi.'}</small>
            </div>
            <Switch checked={data.policy.autoApproveVerified} disabled={policy.isPending} onChange={v => policy.mutate(v)} label="Tasdiqlangan email bilan darhol kirish" />
          </div>
          <p className="field-hint"><ShieldCheck size={14} /> Parollar scrypt bilan shifrlanadi. Kodlar 10 daqiqa amal qiladi va 5 marta xato kiritilsa bekor boʻladi.</p>
        </Panel>
      </div>

      <Panel title="Barcha foydalanuvchilar" subtitle={`${shown.length} ta koʻrsatilmoqda`} action={<SearchBox value={query} onChange={setQuery} placeholder="Ism, email yoki telefon" />}>
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
            const busy = busyId === u.id;
            const s = statusView[u.status] ?? statusView.disabled;
            return <tr key={u.id} data-testid={`row-account-${u.id}`}>
              <td><div className="acc-cell"><Avatar account={u} /><div><b>{u.displayName}{self && <em className="acc-you">siz</em>}</b><small>{u.email || u.username}{u.emailVerifiedAt && <BadgeCheck size={12} className="acc-ok" />}</small></div></div></td>
              <td className="acc-phone">{u.phone ? phoneView(u.phone) : '—'}</td>
              <td><MethodTag method={u.signupMethod} /></td>
              <td>{self || u.status !== 'active' ? <span className="acc-role">{roleLabel(u.role)}</span> : <SelectMenu ariaLabel="Rol" value={u.role} onChange={role => role !== u.role && act(u.id, { role })} options={roleMenu} className="acc-role-menu" testId={`select-row-role-${u.id}`} />}</td>
              <td><StatusBadge tone={s.tone}>{s.label}</StatusBadge></td>
              <td>{u.lastLoginAt ? dateTime(u.lastLoginAt) : <span className="muted">Hali kirmagan</span>}</td>
              <td className="acc-actions">
                {self ? null
                  : u.status === 'active' ? <button className="button secondary small" disabled={busy} onClick={() => act(u.id, { status: 'disabled' })} data-testid={`button-disable-${u.id}`}><Ban size={13} />Bloklash</button>
                  : u.status === 'pending' ? <button className="button primary small" disabled={busy} onClick={() => act(u.id, { status: 'active', role: roles[u.id] ?? 'viewer' })}><Check size={13} />Tasdiqlash</button>
                  : <button className="button secondary small" disabled={busy} onClick={() => act(u.id, { status: 'active' })} data-testid={`button-enable-${u.id}`}><RotateCcw size={13} />Faollashtirish</button>}
              </td>
            </tr>;
          })}</tbody>
        </TableWrap> : <div className="inline-empty">Mos foydalanuvchi topilmadi</div>}
      </Panel>
    </>}
  </>;
}
