import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Link, Redirect, useSearch } from 'wouter';
import {
  AlertCircle, ArrowLeft, ArrowRight, BadgeCheck, Building2, Check, ClipboardList, Clock3, Crown, Eye, EyeOff, Hourglass, Info, KeyRound, Loader2, Lock, Mail,
  MailCheck, Phone, RefreshCw, ShieldCheck, Sparkles, User, UserCheck, type LucideIcon,
} from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { ThemeToggle } from '@/lib/theme';
import { useUser } from '@/lib/auth';
import './site.css';

const homeUrl = import.meta.env.BASE_URL;

type AuthOptions = {
  google: boolean;
  emailCode: boolean;
  emailDevMode: boolean;
  autoApprove: boolean;
  codeLength: number;
  codeTtlMinutes: number;
  resendSeconds: number;
};
type Method = 'google' | 'email' | 'request';
type Done = 'pending' | 'request';

class AuthError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly retryAfter?: number) { super(message); }
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new AuthError('Server bilan aloqa yoʻq. Internetni tekshirib, qayta urinib koʻring.', 0);
  }
  const data = await res.json().catch(() => ({})) as { error?: string; code?: string; retryAfter?: number };
  if (!res.ok) throw new AuthError(data.error || 'Amal bajarilmadi. Qayta urinib koʻring.', res.status, data.code, data.retryAfter);
  return data as T;
}

function useAuthOptions() {
  const [options, setOptions] = useState<AuthOptions | null>(null);
  useEffect(() => {
    let alive = true;
    api<AuthOptions>('/auth/options')
      .then(o => alive && setOptions(o))
      .catch(() => alive && setOptions({ google: false, emailCode: false, emailDevMode: false, autoApprove: false, codeLength: 6, codeTtlMinutes: 10, resendSeconds: 60 }));
    return () => { alive = false; };
  }, []);
  return options;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

// --- small building blocks ------------------------------------------------

function Field({ label, icon: Icon, children, hint, action }: { label: string; icon?: LucideIcon; children: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return <label className="s-field">
    <span className="s-field-label">{label}</span>
    <span className="s-field-box">{Icon && <Icon size={17} className="s-field-icon" />}{children}{action}</span>
    {hint && <small className="s-field-hint">{hint}</small>}
  </label>;
}

function PasswordField({ label = 'Parol', value, onChange, autoComplete, testId, meter }: { label?: string; value: string; onChange: (v: string) => void; autoComplete: string; testId: string; meter?: boolean }) {
  const [show, setShow] = useState(false);
  return <div className="s-field-wrap">
    <Field label={label} icon={Lock} action={<button type="button" className="s-field-action" onClick={() => setShow(v => !v)} aria-label={show ? 'Parolni yashirish' : 'Parolni koʻrsatish'}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button>}>
      <input type={show ? 'text' : 'password'} required autoComplete={autoComplete} value={value} onChange={e => onChange(e.target.value)} data-testid={testId} />
    </Field>
    {meter && <StrengthMeter value={value} />}
  </div>;
}

function strength(p: string) {
  let score = 0;
  if (p.length >= 8) score++;
  if (p.length >= 12) score++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score++;
  if (/\d/.test(p) && /[a-z]/i.test(p)) score++;
  if (/[^a-z0-9]/i.test(p)) score++;
  return Math.min(4, score);
}

function StrengthMeter({ value }: { value: string }) {
  const s = value ? Math.max(1, strength(value)) : 0;
  const labels = ['', 'Zaif', 'Oʻrtacha', 'Yaxshi', 'Kuchli'];
  return <div className={`s-meter s${s}`} aria-live="polite">
    <div className="s-meter-bars">{[1, 2, 3, 4].map(i => <i key={i} className={i <= s ? 'on' : ''} />)}</div>
    <span>{value ? labels[s] : 'Kamida 8 belgi, harf va raqam'}</span>
  </div>;
}

function Notice({ tone, icon: Icon, children }: { tone: 'error' | 'info' | 'success' | 'warn'; icon?: LucideIcon; children: ReactNode }) {
  const Fallback = tone === 'error' ? AlertCircle : tone === 'success' ? BadgeCheck : Info;
  const I = Icon ?? Fallback;
  return <div className={`s-auth-notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}><I size={17} /><div>{children}</div></div>;
}

function GoogleMark() {
  return <svg width="19" height="19" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>;
}

function GoogleButton({ intent, enabled, label }: { intent: 'sign-in' | 'sign-up'; enabled: boolean | undefined; label: string }) {
  const [going, setGoing] = useState(false);
  if (enabled === undefined) return <button type="button" className="s-google busy" disabled><GoogleMark />{label}</button>;
  if (!enabled) return <div className="s-google-wrap">
    <button type="button" className="s-google" disabled data-testid="button-google-disabled"><GoogleMark />{label}</button>
    <small>Administrator Google orqali kirishni hali yoqmagan</small>
  </div>;
  return <a href={`/api/auth/google/start?intent=${intent}`} className={`s-google ${going ? 'busy' : ''}`} onClick={() => setGoing(true)} data-testid={`button-google-${intent}`}>
    {going ? <Loader2 size={18} className="s-spin" /> : <GoogleMark />}{going ? 'Google ga yoʻnaltirilmoqda…' : label}
  </a>;
}

function Divider({ children }: { children: ReactNode }) {
  return <div className="s-auth-divider"><span>{children}</span></div>;
}

function AuthHead({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return <div className="s-auth-head">
    <span className="s-eyebrow"><i />{eyebrow}</span>
    <h1>{title}</h1>
    <p>{text}</p>
  </div>;
}

// --- 6-character code input ----------------------------------------------

function CodeInput({ value, onChange, onComplete, disabled, invalid }: { value: string[]; onChange: (v: string[]) => void; onComplete: (code: string) => void; disabled?: boolean; invalid?: boolean }) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  useEffect(() => { refs.current[0]?.focus(); }, []);
  useEffect(() => { if (invalid) refs.current[value.findIndex(c => !c) === -1 ? 5 : value.findIndex(c => !c)]?.focus(); }, [invalid, value]);

  const fill = (start: number, raw: string) => {
    const chars = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').split('');
    if (!chars.length) return;
    const next = [...value];
    let i = start;
    for (const ch of chars) { if (i > 5) break; next[i++] = ch; }
    onChange(next);
    refs.current[Math.min(i, 5)]?.focus();
    if (next.every(Boolean)) onComplete(next.join(''));
  };

  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !value[i] && i > 0) {
      e.preventDefault();
      const next = [...value]; next[i - 1] = ''; onChange(next);
      refs.current[i - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
    else if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
  };

  return <div className={`s-code ${invalid ? 'invalid' : ''}`} role="group" aria-label="6 xonali tasdiqlash kodi">
    {value.map((ch, i) => <input
      key={i}
      ref={el => { refs.current[i] = el; }}
      value={ch}
      disabled={disabled}
      inputMode="text"
      autoCapitalize="characters"
      autoComplete={i === 0 ? 'one-time-code' : 'off'}
      spellCheck={false}
      aria-label={`${i + 1}-belgi`}
      className={ch ? 'filled' : ''}
      style={{ ['--i' as string]: i }}
      onFocus={e => e.currentTarget.select()}
      onKeyDown={e => onKey(i, e)}
      onPaste={(e: ClipboardEvent<HTMLInputElement>) => { e.preventDefault(); fill(i, e.clipboardData.getData('text')); }}
      onChange={e => {
        const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!raw) { const next = [...value]; next[i] = ''; onChange(next); return; }
        fill(i, raw.length > 1 && ch ? raw.replace(ch, '') || raw.slice(-1) : raw);
      }}
      data-testid={`input-code-${i}`}
    />)}
  </div>;
}

// --- shared screens --------------------------------------------------------

function PendingCard({ kind }: { kind: Done }) {
  const steps = [
    { icon: ClipboardList, title: 'Ariza yuborildi', text: 'Maʼlumotlaringiz xavfsiz saqlandi', state: 'done' as const },
    { icon: UserCheck, title: 'Platforma admini koʻrib chiqadi', text: 'Boshlangʻich — 7 kun bepul ochiladi', state: 'now' as const },
    { icon: KeyRound, title: 'Login va parol beriladi', text: 'Keyin «Kirish» orqali kabinetga kirasiz', state: 'next' as const },
  ];
  return <div className="s-pending" data-testid="status-signup-pending">
    <div className="s-pending-orb"><span /><span /><Hourglass size={30} /></div>
    <h1>Arizangiz qabul qilindi</h1>
    <p>Tez orada platforma administratori akkauntingizni ochadi va <b>login / parol</b>ni sizga yetkazadi. Shu maʼlumotlar bilan «Kirish» orqali tizimga kirasiz.</p>
    <ol className="s-pending-steps">{steps.map((s, i) => <li key={s.title} className={s.state} style={{ ['--i' as string]: i }}>
      <span className="s-pending-dot">{s.state === 'done' ? <Check size={15} /> : <s.icon size={15} />}</span>
      <div><b>{s.title}</b><small>{s.text}</small></div>
    </li>)}</ol>
    <div className="s-pending-actions">
      <Link href="/" className="s-btn ghost">Bosh sahifa</Link>
      <Link href="/sign-in" className="s-btn primary">Kirish sahifasi <ArrowRight size={16} /></Link>
    </div>
  </div>;
}

const queryMessages: Record<string, { tone: 'error' | 'info' | 'warn'; text: string }> = {
  pending: { tone: 'info', text: 'Akkauntingiz yaratildi va administrator tasdigʻini kutmoqda. Tasdiqlangach shu yerdan kirasiz.' },
  google_cancel: { tone: 'warn', text: 'Google orqali kirish bekor qilindi.' },
  google_state: { tone: 'error', text: 'Google sessiyasi eskirdi. Qaytadan urinib koʻring.' },
  google_failed: { tone: 'error', text: 'Google bilan bogʻlanib boʻlmadi. Birozdan soʻng qayta urinib koʻring.' },
  google_off: { tone: 'warn', text: 'Google orqali kirish hali sozlanmagan. Email usulidan foydalaning.' },
  rejected: { tone: 'error', text: 'Roʻyxatdan oʻtish arizangiz administrator tomonidan rad etilgan.' },
  disabled: { tone: 'error', text: 'Akkauntingiz bloklangan. Administratorga murojaat qiling.' },
};

// --- sign in ---------------------------------------------------------------

function SignInView({ options }: { options: AuthOptions | null }) {
  const params = new URLSearchParams(useSearch());
  const fromQuery = queryMessages[params.get('notice') ?? params.get('error') ?? ''];
  const nextPath = params.get('next');
  const safeNext = nextPath && nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : null;
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'info' | 'warn'; text: string } | null>(fromQuery ?? null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const user = await api<{ role?: string }>('/auth/login', { identifier, password });
      if (user?.role === 'platform_admin') {
        window.location.assign(`${homeUrl.replace(/\/?$/, '/')}owner`);
      } else if (safeNext) {
        window.location.assign(safeNext);
      } else {
        window.location.assign(homeUrl);
      }
      return;
    } catch (err) {
      const error = err as AuthError;
      setMessage({ tone: error.code === 'pending' ? 'info' : 'error', text: error.message });
    }
    setPending(false);
  };

  return <>
    <AuthHead eyebrow="KIRISH" title="Hisobingizga kiring" text="Platforma admini bergan login va parol bilan kabinetga kiring." />
    {message && <Notice tone={message.tone} icon={message.tone === 'info' ? Hourglass : undefined}>{message.text}</Notice>}
    <form className="s-auth-form" onSubmit={submit}>
      <Field label="Login yoki email" icon={Mail} hint="Administrator bergan login">
        <input required autoComplete="username" value={identifier} onChange={e => setIdentifier(e.target.value)} placeholder="login yoki email" data-testid="input-login-identifier" />
      </Field>
      <PasswordField value={password} onChange={setPassword} autoComplete="current-password" testId="input-login-password" />
      <button className="s-btn primary s-auth-submit" disabled={pending} data-testid="button-login">
        {pending ? <><Loader2 size={18} className="s-spin" /> Tekshirilmoqda…</> : <>Kirish <ArrowRight size={17} /></>}
      </button>
    </form>
    <p className="s-auth-switch">Hali akkauntingiz yoʻqmi? <Link href="/sign-up" data-testid="link-to-sign-up">7 kun bepul ariza</Link></p>
  </>;
}

// --- sign up: method picker --------------------------------------------------

const methods: Array<{ id: Method; icon: LucideIcon; title: string; hint: string; tag?: string }> = [
  { id: 'google', icon: Sparkles, title: 'Google', hint: 'Gmail akkaunt bilan bir bosishda', tag: 'Eng tez' },
  { id: 'email', icon: MailCheck, title: 'Email + kod', hint: 'Gmailga 6 xonali kod keladi' },
  { id: 'request', icon: ClipboardList, title: 'Ariza', hint: 'Admin tasdiqlaydi, kod shart emas' },
];

function MethodPicker({ value, onChange }: { value: Method; onChange: (m: Method) => void }) {
  const index = methods.findIndex(m => m.id === value);
  return <div className="s-methods" role="tablist" aria-label="Roʻyxatdan oʻtish usuli" style={{ ['--idx' as string]: index }}>
    <span className="s-methods-glider" aria-hidden="true" />
    {methods.map(m => <button key={m.id} type="button" role="tab" aria-selected={value === m.id} className={value === m.id ? 'on' : ''} onClick={() => onChange(m.id)} data-testid={`tab-method-${m.id}`}>
      <span className="s-method-icon">{m.id === 'google' ? <GoogleMark /> : <m.icon size={18} />}</span>
      <b>{m.title}{m.tag && <em>{m.tag}</em>}</b>
      <small>{m.hint}</small>
    </button>)}
  </div>;
}

function GooglePane({ options }: { options: AuthOptions | null }) {
  const steps = ['Google akkauntingizni (Gmail) tanlaysiz', 'Google oynasida ruxsatni tasdiqlaysiz', options?.autoApprove ? 'Darhol kabinetga kirasiz' : 'Administrator tasdiqlagach kabinetga kirasiz'];
  return <div className="s-auth-pane">
    <ol className="s-flow">{steps.map((s, i) => <li key={s} style={{ ['--i' as string]: i }}><span>{i + 1}</span>{s}</li>)}</ol>
    <GoogleButton intent="sign-up" enabled={options?.google} label="Google bilan davom etish" />
    <p className="s-auth-fine"><ShieldCheck size={14} /> PHARMXS faqat ismingiz va email manzilingizni oladi. Parolingiz Google da qoladi.</p>
  </div>;
}

function EmailPane({ options, onDone }: { options: AuthOptions | null; onDone: (d: Done) => void }) {
  const [step, setStep] = useState<'form' | 'code'>('form');
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', confirm: '' });
  const [code, setCode] = useState<string[]>(['', '', '', '', '', '']);
  const [timers, setTimers] = useState({ expiresAt: 0, resendAt: 0 });
  const [busy, setBusy] = useState<'send' | 'verify' | 'resend' | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'success' | 'info'; text: string } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const now = useNow(step === 'code');
  const disabled = options !== null && !options.emailCode;

  const started = (r: { expiresIn: number; resendIn: number }) => setTimers({ expiresAt: Date.now() + r.expiresIn * 1000, resendAt: Date.now() + r.resendIn * 1000 });

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (form.password !== form.confirm) { setMessage({ tone: 'error', text: 'Parollar bir xil emas.' }); return; }
    setBusy('send');
    try {
      started(await api<{ expiresIn: number; resendIn: number }>('/auth/register/email/start', { firstName: form.firstName, lastName: form.lastName, email: form.email, password: form.password }));
      setCode(['', '', '', '', '', '']);
      setStep('code');
    } catch (err) {
      setMessage({ tone: 'error', text: (err as AuthError).message });
    }
    setBusy(null);
  };

  const verify = async (value = code.join('')) => {
    if (value.length !== 6 || busy) return;
    setBusy('verify');
    setMessage(null);
    setInvalid(false);
    try {
      const r = await api<{ status: 'active' | 'pending' }>('/auth/register/email/verify', { email: form.email, code: value });
      if (r.status === 'active') {
        setWelcome(true);
        window.setTimeout(() => window.location.assign(homeUrl), 1100);
        return;
      }
      onDone('pending');
      return;
    } catch (err) {
      const error = err as AuthError;
      setInvalid(true);
      if (error.code === 'locked' || error.code === 'expired' || error.code === 'missing') setCode(['', '', '', '', '', '']);
      setMessage({ tone: 'error', text: error.message });
    }
    setBusy(null);
  };

  const resend = async () => {
    setBusy('resend');
    setMessage(null);
    setInvalid(false);
    try {
      started(await api<{ expiresIn: number; resendIn: number }>('/auth/register/email/resend', { email: form.email }));
      setCode(['', '', '', '', '', '']);
      setMessage({ tone: 'success', text: 'Yangi kod yuborildi. Pochtangizni tekshiring.' });
    } catch (err) {
      setMessage({ tone: 'error', text: (err as AuthError).message });
    }
    setBusy(null);
  };

  if (welcome) return <div className="s-auth-pane s-welcome"><div className="s-welcome-check"><Check size={34} /></div><h2>Akkaunt ochildi!</h2><p>Kabinetingizga yoʻnaltirilmoqda…</p></div>;

  if (step === 'code') {
    const left = timers.expiresAt - now;
    const wait = timers.resendAt - now;
    return <div className="s-auth-pane">
      <div className="s-mailsent">
        <div className="s-mailsent-icon"><Mail size={22} /><i /></div>
        <div><b>Kod yuborildi</b><span>{form.email}</span></div>
      </div>
      {options?.emailDevMode && <Notice tone="warn">Test rejimi: SMTP hali sozlanmagan, kod server jurnaliga yozildi.</Notice>}
      <p className="s-auth-lead">Pochtangizga kelgan <b>6 xonali</b> kodni kiriting. Kod harf va raqamlardan iborat.</p>
      <CodeInput value={code} onChange={v => { setCode(v); setInvalid(false); }} onComplete={c => void verify(c)} disabled={busy === 'verify'} invalid={invalid} />
      <div className="s-code-meta">
        <span className={left <= 60_000 ? 'warn' : ''}><Clock3 size={14} /> {left > 0 ? <>Kod <b>{mmss(left)}</b> amal qiladi</> : 'Kod muddati tugadi'}</span>
        <button type="button" onClick={resend} disabled={wait > 0 || busy !== null} data-testid="button-resend-code">
          <RefreshCw size={14} className={busy === 'resend' ? 's-spin' : ''} />{wait > 0 ? `Qayta yuborish ${mmss(wait)}` : 'Kodni qayta yuborish'}
        </button>
      </div>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <button type="button" className="s-btn primary s-auth-submit" disabled={code.some(c => !c) || busy !== null} onClick={() => void verify()} data-testid="button-verify-code">
        {busy === 'verify' ? <><Loader2 size={18} className="s-spin" /> Tekshirilmoqda…</> : <>Tasdiqlash va akkaunt ochish <ArrowRight size={17} /></>}
      </button>
      <button type="button" className="s-auth-link" onClick={() => { setStep('form'); setMessage(null); }}><ArrowLeft size={14} /> Emailni oʻzgartirish</button>
    </div>;
  }

  return <form className="s-auth-pane s-auth-form" onSubmit={send}>
    {disabled && <Notice tone="warn">Email orqali kod yuborish hozircha sozlanmagan. Google yoki «Ariza» usulidan foydalaning.</Notice>}
    <div className="s-field-row">
      <Field label="Ism" icon={User}><input required autoComplete="given-name" value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} data-testid="input-email-first-name" /></Field>
      <Field label="Familiya"><input required autoComplete="family-name" value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} data-testid="input-email-last-name" /></Field>
    </div>
    <Field label="Gmail manzili" icon={Mail} hint="Shu manzilga 6 xonali tasdiqlash kodi yuboriladi">
      <input required type="email" autoComplete="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="siz@gmail.com" data-testid="input-email-address" />
    </Field>
    <PasswordField value={form.password} onChange={v => setForm({ ...form, password: v })} autoComplete="new-password" testId="input-email-password" meter />
    <PasswordField label="Parolni takrorlang" value={form.confirm} onChange={v => setForm({ ...form, confirm: v })} autoComplete="new-password" testId="input-email-confirm" />
    {message && <Notice tone={message.tone}>{message.text}</Notice>}
    <button className="s-btn primary s-auth-submit" disabled={busy !== null || disabled} data-testid="button-send-code">
      {busy === 'send' ? <><Loader2 size={18} className="s-spin" /> Kod yuborilmoqda…</> : <>Tasdiqlash kodini yuborish <ArrowRight size={17} /></>}
    </button>
    <p className="s-auth-fine"><ShieldCheck size={14} /> {options?.autoApprove ? 'Email tasdiqlangach akkauntingiz darhol ochiladi.' : 'Email tasdiqlangach akkaunt administrator tasdigʻiga yuboriladi.'}</p>
  </form>;
}

function formatPhone(input: string) {
  let d = input.replace(/\D/g, '');
  if (!d.startsWith('998')) d = `998${d}`;
  d = d.slice(0, 12);
  const p = [d.slice(0, 3), d.slice(3, 5), d.slice(5, 8), d.slice(8, 10), d.slice(10, 12)].filter(Boolean);
  return `+${p.join(' ')}`;
}

function RequestPane({ onDone, plan }: { onDone: (d: Done) => void; plan?: string | null }) {
  const isCustom = plan === 'custom';
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '+998 ', email: '', companyName: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.phone.replace(/\D/g, '').length !== 12) { setError('Telefon raqamini toʻliq kiriting: +998 XX XXX XX XX'); return; }
    if (form.companyName.trim().length < 2) { setError('Kompaniya (dorixona) nomini kiriting.'); return; }
    setBusy(true);
    try {
      const company = form.companyName.trim();
      await api('/auth/register/request', {
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone,
        email: form.email,
        companyName: isCustom ? `${company} · Maxsus tarif` : company,
      });
      onDone('request');
      return;
    } catch (err) {
      setError((err as AuthError).message);
    }
    setBusy(false);
  };

  return <form className="s-auth-pane s-auth-form" onSubmit={submit}>
    <div className="s-trial-callout" data-testid={isCustom ? 'banner-custom-plan' : 'banner-trial-7'}>
      <Crown size={18} />
      {isCustom ? (
        <div><b>Maxsus — moslashuvchan tarif</b><span>Arizangiz qabul qilinadi. Platforma egasi siz bilan bogʻlanib, filial soni va narxni kelishadi.</span></div>
      ) : (
        <div><b>Boshlangʻich — 7 kun bepul</b><span>Ariza tasdiqlangach kabinet ochiladi. Biznes / Korxona — Tariflar boʻlimidan Click toʻlov. Maxsus — alohida ariza.</span></div>
      )}
    </div>
    <div className="s-field-row">
      <Field label="Ism" icon={User}><input required autoComplete="given-name" value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} data-testid="input-request-first-name" /></Field>
      <Field label="Familiya"><input required autoComplete="family-name" value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} data-testid="input-request-last-name" /></Field>
    </div>
    <Field label="Kompaniya / dorixona nomi" icon={Building2}>
      <input required value={form.companyName} onChange={e => setForm({ ...form, companyName: e.target.value })} placeholder="Masalan: Pharma Plus" data-testid="input-request-company" />
    </Field>
    <Field label="Telefon raqami" icon={Phone}>
      <input required type="tel" autoComplete="tel" inputMode="tel" value={form.phone} onChange={e => setForm({ ...form, phone: formatPhone(e.target.value) })} data-testid="input-request-phone" />
    </Field>
    <Field label="Email" icon={Mail} hint="Aloqa uchun — kirish loginini admin beradi">
      <input required type="email" autoComplete="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="siz@email.com" data-testid="input-request-email" />
    </Field>
    {error && <Notice tone="error">{error}</Notice>}
    <button className="s-btn primary s-auth-submit" disabled={busy} data-testid="button-submit-request">
      {busy ? <><Loader2 size={18} className="s-spin" /> Yuborilmoqda…</> : <>Ariza qoldirish <ArrowRight size={17} /></>}
    </button>
    <p className="s-auth-fine"><UserCheck size={14} /> Google yoki mustaqil roʻyxat yoʻq — faqat ariza. Tasdiqdan keyin login/parol beriladi.</p>
  </form>;
}

function SignUpView({ options: _options }: { options: AuthOptions | null }) {
  const params = new URLSearchParams(useSearch());
  const plan = params.get('plan');
  const isCustom = plan === 'custom';
  const [done, setDone] = useState<Done | null>(null);
  const fromQuery = queryMessages[params.get('error') ?? ''];

  if (done) return <PendingCard kind={done} />;
  return <>
    <AuthHead
      eyebrow={isCustom ? 'MAXSUS TARIF' : '7 KUN BEPUL'}
      title="Ariza qoldiring"
      text={isCustom
        ? 'Maxsus tarif uchun ariza yuboring — istalgancha filial, toʻliq imkoniyatlar. Platforma egasi siz bilan bogʻlanadi.'
        : 'Platforma admini koʻrib chiqadi, Boshlangʻich sinovini ochadi va login/parol beradi.'}
    />
    {fromQuery && <Notice tone={fromQuery.tone}>{fromQuery.text}</Notice>}
    <RequestPane onDone={setDone} plan={plan} />
    <p className="s-auth-switch">Akkaunt ochilganmi? <Link href="/sign-in" data-testid="link-to-sign-in">Kirish</Link></p>
  </>;
}

// --- page shell ---------------------------------------------------------------

function Showcase({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  return <aside className="s-auth-side" aria-hidden="true">
    <div className="s-auth-side-glow"><i /><i /></div>
    <div className="s-auth-side-grid" />
    <Link href="/" className="s-auth-side-logo"><BrandLogo /></Link>
    <div className="s-auth-side-copy">
      <span className="s-auth-side-tag"><ShieldCheck size={13} /> Xavfsiz kirish</span>
      <h2>{mode === 'sign-in' ? <>Login va parol<br /><span>bilan kiring.</span></> : <>7 kun bepul —<br /><span>ariza qoldiring.</span></>}</h2>
      <p>Boshlangʻich sinovi admin tasdigʻidan keyin ochiladi. Keyin kabinetdagi Tariflar orqali Click toʻlov.</p>
    </div>
    <div className="s-auth-mock">
      <div className="s-auth-mail">
        <div className="s-auth-mail-head"><span className="s-auth-mail-ava">P</span><div><b>PHARMXS</b><small>Login / parol</small></div><em>admin</em></div>
        <div className="s-auth-mail-code">{['L', 'O', 'G', 'I', 'N'].map((c, i) => <span key={i} style={{ ['--i' as string]: i }}>{c}</span>)}</div>
      </div>
      <div className="s-auth-chip c1"><BadgeCheck size={15} /> Ariza qabul qilindi</div>
      <div className="s-auth-chip c2"><UserCheck size={15} /> Admin akkaunt ochdi</div>
    </div>
    <ul className="s-auth-points">
      <li><Lock size={16} /><span><b>Login admin beradi</b>Mustaqil Google/email roʻyxat yoʻq</span></li>
      <li><Crown size={16} /><span><b>Boshlangʻich 7 kun</b>Faqat birinchi tarif bepul sinovda</span></li>
      <li><UserCheck size={16} /><span><b>Platforma nazorati</b>Har bir kompaniya alohida ochiladi</span></li>
    </ul>
  </aside>;
}

export function AuthPage({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const { isSignedIn } = useUser();
  const options = useAuthOptions();
  if (isSignedIn) return <Redirect to="/" />;
  return <div className="site s-auth">
    <div className="s-aurora" aria-hidden="true"><i /><i /><i /></div>
    <Showcase mode={mode} />
    <main className="s-auth-main">
      <div className="s-auth-top">
        <Link href="/" className="s-auth-back" data-testid="link-auth-home"><ArrowLeft size={16} /> Bosh sahifa</Link>
        <Link href="/" className="s-auth-mobile-logo"><BrandLogo /></Link>
        <ThemeToggle />
      </div>
      <div className="s-auth-card" key={mode}>
        {mode === 'sign-in' ? <SignInView options={options} /> : <SignUpView options={options} />}
      </div>
      <p className="s-auth-legal">Davom etish orqali siz maʼlumotlaringiz PHARMXS tizimida xavfsiz saqlanishiga rozilik bildirasiz.</p>
    </main>
  </div>;
}
