import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgePercent, Building2, Check, Clock3, CreditCard, Loader2, QrCode, Send, Sparkles, Wallet, X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Modal, PageHeading, Panel, StatusBadge } from '@/components/kit';
import { useAccess } from '@/lib/access';
import { formatUzs, planPriceLabel, type PlanCode } from '@/lib/plans';

type OrgSub = {
  id: number;
  name: string;
  planCode: string;
  planName: string;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  planExpiresAt: string | null;
  daysLeft: number | null;
  branchLimit: number | null;
  telegramEnabled: boolean;
  telegramLinked: boolean;
  features: string[];
};

type PlanRow = {
  code: PlanCode;
  name: string;
  priceUzs: number;
  branchLimit: number | null;
  telegram: boolean;
  features: string[];
  highlight?: boolean;
  applyOnly?: boolean;
};

type PayMethod = 'card' | 'click';

type ClickWidget = {
  service_id: string;
  merchant_id: string;
  amount: string;
  transaction_param: string;
  merchant_user_id?: string;
  card_type?: string;
};

type CheckoutResult = {
  url: string;
  merchantTransId: string;
  amount: number;
  planCode: PlanCode;
  paymentMethod: PayMethod;
  widget: ClickWidget;
  returnUrl: string;
};

type Remain = { days: number; hours: number; minutes: number; seconds: number; totalMs: number };

declare global {
  interface Window {
    createPaymentRequest?: (
      params: ClickWidget,
      cb?: (data: { status: number }) => void,
    ) => void;
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Xatolik');
  return data as T;
}

function loadClickCheckoutJs(): Promise<void> {
  if (typeof window.createPaymentRequest === 'function') return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>('script[data-click-checkout]');
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Click skript yuklanmadi.')), { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://my.click.uz/pay/checkout.js';
    s.async = true;
    s.dataset.clickCheckout = '1';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Click skript yuklanmadi.'));
    document.head.appendChild(s);
  });
}

async function openCardWidget(widget: ClickWidget, returnUrl: string): Promise<void> {
  await loadClickCheckoutJs();
  if (typeof window.createPaymentRequest !== 'function') {
    throw new Error('Click karta oynasi ochilmadi. Qayta urinib koʻring.');
  }
  await new Promise<void>((resolve) => {
    window.createPaymentRequest!(widget, (data) => {
      if (data?.status >= 0) window.location.assign(returnUrl);
      resolve();
    });
  });
}

function statusView(status: string): { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' | 'info' } {
  if (status === 'active') return { label: 'Faol', tone: 'good' };
  if (status === 'trialing') return { label: 'Sinov', tone: 'info' };
  if (status === 'past_due') return { label: 'Muddati tugagan', tone: 'bad' };
  if (status === 'canceled') return { label: 'Bekor qilingan', tone: 'neutral' };
  return { label: status, tone: 'neutral' };
}

function expiryTarget(org: OrgSub): { at: Date; label: string } | null {
  const plan = org.planExpiresAt ? new Date(org.planExpiresAt) : null;
  const trial = org.trialEndsAt ? new Date(org.trialEndsAt) : null;
  if (org.subscriptionStatus === 'trialing' && trial) return { at: trial, label: 'Sinov tugashiga' };
  if (plan) return { at: plan, label: 'Obuna tugashiga' };
  if (trial) return { at: trial, label: 'Muddat tugashiga' };
  return null;
}

function calcRemain(target: Date, now: number): Remain {
  const totalMs = Math.max(0, target.getTime() - now);
  const totalSec = Math.floor(totalMs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return { days, hours, minutes, seconds, totalMs };
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function useCountdown(target: Date | null): Remain | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [target?.getTime()]);
  return useMemo(() => (target ? calcRemain(target, now) : null), [target, now]);
}

export function PlansPage() {
  const access = useAccess();
  const qc = useQueryClient();
  const [chatId, setChatId] = useState('');
  const [msg, setMsg] = useState('');
  const [payPlan, setPayPlan] = useState<PlanRow | null>(null);
  const [method, setMethod] = useState<PayMethod>('card');
  const [paying, setPaying] = useState(false);

  const q = useQuery({
    queryKey: ['billing-subscription'],
    queryFn: () => api<{ organization: OrgSub | null; plans: PlanRow[] }>('/api/billing/subscription'),
  });

  const checkout = useMutation({
    mutationFn: ({ planCode, paymentMethod }: { planCode: PlanCode; paymentMethod: PayMethod }) =>
      api<CheckoutResult>('/api/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ planCode, paymentMethod }),
      }),
  });

  const telegram = useMutation({
    mutationFn: () => api('/api/billing/telegram', { method: 'POST', body: JSON.stringify({ chatId }) }),
    onSuccess: () => { setMsg('Telegram bogʻlandi'); void qc.invalidateQueries({ queryKey: ['billing-subscription'] }); },
    onError: (e: Error) => setMsg(e.message),
  });

  const org = q.data?.organization;
  const plans = q.data?.plans ?? [];
  const canPay = !!org && (access.role === 'admin' || access.role === 'finance');
  const payHint = access.isPlatformAdmin
    ? 'Platforma egasi toʻlov qilmaydi. Kompaniya admini bilan /sign-in orqali kiring.'
    : !org
      ? 'Kompaniya topilmadi. Avval ariza tasdiqlangan kompaniya login/paroli bilan kiring.'
      : !(access.role === 'admin' || access.role === 'finance')
        ? 'Toʻlovni faqat kompaniya administratori qila oladi.'
        : '';

  const expiry = org ? expiryTarget(org) : null;
  const remain = useCountdown(expiry?.at ?? null);
  const st = org ? statusView(org.subscriptionStatus) : null;
  const ended = remain != null && remain.totalMs <= 0;

  const openPay = (p: PlanRow) => {
    setMsg('');
    if (!canPay) {
      setMsg(payHint || 'Toʻlov uchun ruxsat yoʻq.');
      return;
    }
    setMethod('card');
    setPayPlan(p);
  };

  const startPay = async () => {
    if (!payPlan || paying) return;
    setMsg('');
    setPaying(true);
    try {
      const data = await checkout.mutateAsync({ planCode: payPlan.code, paymentMethod: method });
      if (method === 'card') {
        setPayPlan(null);
        await openCardWidget(data.widget, data.returnUrl || '/tariflar?paid=1&method=card');
      } else {
        if (!data?.url) throw new Error('Click havolasi olinmadi.');
        window.location.assign(data.url);
        return;
      }
    } catch (e) {
      setMsg((e as Error).message || 'Toʻlovni boshlab boʻlmadi.');
    } finally {
      setPaying(false);
    }
  };

  const busy = paying || checkout.isPending;

  return (
    <div className="page-stack plans-page">
      <PageHeading title="Tariflar" subtitle="Joriy obuna, muddat va Click orqali yangilash" icon={BadgePercent} />
      {msg && <div className="notice error" data-testid="notice-checkout-error">{msg}</div>}
      {payHint && (
        <div className="notice warn" data-testid="notice-checkout-hint">
          {payHint}{' '}
          {access.isPlatformAdmin && <Link href="/owner">Owner panel →</Link>}
          {!org && !access.isPlatformAdmin && <Link href="/sign-in">Kirish →</Link>}
        </div>
      )}

      {org && st && (
        <section className={`sub-hero ${ended ? 'ended' : st.tone === 'good' ? 'ok' : ''}`} data-testid="panel-subscription-hero">
          <div className="sub-hero-top">
            <div className="sub-hero-brand">
              <span className="sub-hero-icon"><Sparkles size={18} /></span>
              <div>
                <span className="eyebrow">JORIY OBUNA</span>
                <h2>{org.planName}</h2>
                <p>{org.name}</p>
              </div>
            </div>
            <StatusBadge tone={ended ? 'bad' : st.tone}>
              {ended ? 'Muddati tugagan' : st.label}
            </StatusBadge>
          </div>

          <div className="sub-hero-meta">
            <div><span>Tarif</span><b>{org.planName}</b></div>
            <div>
              <span>Status</span>
              <b className={`sub-status ${ended ? 'bad' : st.tone === 'good' ? 'good' : ''}`}>
                <i /> {ended ? 'Tugagan' : st.label}
              </b>
            </div>
            <div><span>Filial limiti</span><b>{org.branchLimit == null ? 'Cheksiz' : `${org.branchLimit} ta`}</b></div>
            <div>
              <span>{org.subscriptionStatus === 'trialing' ? 'Sinov tugashi' : 'Amal qiladi'}</span>
              <b>
                {new Date(org.planExpiresAt || org.trialEndsAt || Date.now()).toLocaleString('uz-UZ', {
                  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </b>
            </div>
          </div>

          {expiry && remain && (
            <div className="sub-countdown" data-testid="countdown-subscription">
              <div className="sub-countdown-head">
                <Clock3 size={16} />
                <span>{ended ? 'Muddat tugagan' : expiry.label}</span>
              </div>
              <div className="sub-countdown-grid" aria-live="polite">
                <div className="sub-tick"><b>{remain.days}</b><small>kun</small></div>
                <div className="sub-tick"><b>{pad2(remain.hours)}</b><small>soat</small></div>
                <div className="sub-tick"><b>{pad2(remain.minutes)}</b><small>minut</small></div>
                <div className="sub-tick"><b>{pad2(remain.seconds)}</b><small>soniya</small></div>
              </div>
            </div>
          )}
        </section>
      )}

      <div className="plan-grid">
        {plans.map((p) => {
          const trialLocked = p.code === 'starter' && org?.subscriptionStatus === 'trialing' && org?.planCode === 'starter';
          const isCurrent = org?.planCode === p.code;
          const applyOnly = Boolean(p.applyOnly) || p.code === 'custom';
          const disabled = busy || trialLocked || !canPay || applyOnly;
          const price = planPriceLabel(p);
          return (
            <article key={p.code} className={`plan-card ${p.highlight ? 'featured' : ''} ${isCurrent ? 'current' : ''} ${applyOnly ? 'custom' : ''}`}>
              {p.highlight && <span className="plan-badge">Tavsiya</span>}
              {applyOnly && !isCurrent && <span className="plan-badge">Moslashuvchan</span>}
              {isCurrent && <span className="plan-badge current-badge">Joriy</span>}
              <h3>{p.name}</h3>
              <div className="plan-price">
                <b>{price}</b>
                {!applyOnly && price !== 'Kelishiladi' && <small>/ oy</small>}
              </div>
              <p><Building2 size={14} /> {p.branchLimit == null ? 'Istalgancha filial' : p.branchLimit >= 50 ? `${p.branchLimit} tagacha filial` : `${p.branchLimit} ta filial`}</p>
              <ul>{p.features.map((f) => <li key={f}><Check size={14} />{f}</li>)}</ul>
              {applyOnly ? (
                <a
                  className="button ghost plan-buy"
                  href="mailto:support@pharmxs.uz?subject=Maxsus%20tarif%20arizasi"
                  data-testid={`button-apply-${p.code}`}
                >
                  <Sparkles size={16} />
                  {isCurrent ? 'Joriy Maxsus tarif' : 'Ariza qoldirish'}
                </a>
              ) : (
                <button
                  type="button"
                  className="button primary plan-buy"
                  disabled={disabled}
                  onClick={() => openPay(p)}
                  data-testid={`button-checkout-${p.code}`}
                >
                  <Wallet size={16} />
                  {trialLocked ? 'Hozir bepul sinovdasiz' : isCurrent ? 'Obunani uzaytirish' : 'Obuna olish'}
                </button>
              )}
            </article>
          );
        })}
      </div>

      {org?.telegramEnabled && (
        <Panel title="Telegram xabarnoma (Korxona)" subtitle="Muhim eslatmalar bot orqali keladi">
          <p className="muted-line">Botga /start yuboring va chat ID ni kiriting.</p>
          <div className="inline-form">
            <input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="Chat ID" data-testid="input-telegram-chat" />
            <button type="button" className="button" disabled={telegram.isPending} onClick={() => telegram.mutate()}>
              <Send size={15} /> {org.telegramLinked ? 'Yangilash' : 'Bogʻlash'}
            </button>
          </div>
        </Panel>
      )}

      {payPlan && (
        <Modal
          eyebrow="TOʻLOV USULI"
          title={`${payPlan.name} — ${formatUzs(payPlan.priceUzs)}`}
          onClose={() => !busy && setPayPlan(null)}
          busy={busy}
          size="md"
        >
          <div className="pay-modal">
            <p className="pay-modal-lead">Qanday toʻlamoqchisiz? Karta — sahifada ochiladi; Click/QR — ilova orqali.</p>
            <div className="pay-method-grid" role="radiogroup" aria-label="Toʻlov usuli">
              <button
                type="button"
                role="radio"
                aria-checked={method === 'card'}
                className={`pay-method ${method === 'card' ? 'on' : ''}`}
                onClick={() => setMethod('card')}
                data-testid="pay-method-card"
              >
                <span className="pay-method-icon"><CreditCard size={22} /></span>
                <span className="pay-method-body">
                  <b>Karta orqali</b>
                  <small>Shu yerda Uzcard / Humo raqami va muddatini kiritasiz. QR yoki Click ilovasiga oʻtmaydi.</small>
                </span>
                <span className="pay-method-check">{method === 'card' && <Check size={16} />}</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={method === 'click'}
                className={`pay-method ${method === 'click' ? 'on' : ''}`}
                onClick={() => setMethod('click')}
                data-testid="pay-method-click"
              >
                <span className="pay-method-icon qr"><QrCode size={22} /></span>
                <span className="pay-method-body">
                  <b>Click / QR</b>
                  <small>Click ilovasi yoki QR kod orqali toʻlaysiz — karta yozish shart emas.</small>
                </span>
                <span className="pay-method-check">{method === 'click' && <Check size={16} />}</span>
              </button>
            </div>
            <div className="pay-modal-sum">
              <span>Toʻlov summasi</span>
              <b>{formatUzs(payPlan.priceUzs)} <small>/ oy</small></b>
            </div>
            <div className="pay-modal-actions">
              <button type="button" className="button ghost" disabled={busy} onClick={() => setPayPlan(null)}>
                <X size={15} /> Bekor
              </button>
              <button
                type="button"
                className="button primary plan-buy"
                disabled={busy}
                onClick={() => void startPay()}
                data-testid="button-pay-continue"
              >
                {busy ? <Loader2 className="spin" size={16} /> : method === 'card' ? <CreditCard size={16} /> : <QrCode size={16} />}
                {method === 'card' ? 'Kartani kiritish' : 'Click / QR ga oʻtish'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
