import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgePercent, Building2, Check, CreditCard, Loader2, QrCode, Send, Wallet, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'wouter';
import { Modal, PageHeading, Panel } from '@/components/kit';
import { useAccess } from '@/lib/access';
import { formatUzs, type PlanCode } from '@/lib/plans';

type OrgSub = {
  id: number;
  name: string;
  planCode: string;
  planName: string;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  planExpiresAt: string | null;
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
};

type PayMethod = 'card' | 'click';

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Xatolik');
  return data as T;
}

export function PlansPage() {
  const access = useAccess();
  const qc = useQueryClient();
  const [chatId, setChatId] = useState('');
  const [msg, setMsg] = useState('');
  const [payPlan, setPayPlan] = useState<PlanRow | null>(null);
  const [method, setMethod] = useState<PayMethod>('card');

  const q = useQuery({
    queryKey: ['billing-subscription'],
    queryFn: () => api<{ organization: OrgSub | null; plans: PlanRow[] }>('/api/billing/subscription'),
  });

  const checkout = useMutation({
    mutationFn: ({ planCode, paymentMethod }: { planCode: PlanCode; paymentMethod: PayMethod }) =>
      api<{ url: string }>('/api/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ planCode, paymentMethod }),
      }),
    onSuccess: (data) => {
      if (!data?.url) {
        setMsg('Click havolasi olinmadi. Qayta urinib koʻring.');
        return;
      }
      window.location.assign(data.url);
    },
    onError: (e: Error) => setMsg(e.message),
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

  const openPay = (p: PlanRow) => {
    setMsg('');
    if (!canPay) {
      setMsg(payHint || 'Toʻlov uchun ruxsat yoʻq.');
      return;
    }
    setMethod('card');
    setPayPlan(p);
  };

  const startPay = () => {
    if (!payPlan) return;
    checkout.mutate({ planCode: payPlan.code, paymentMethod: method });
  };

  return (
    <div className="page-stack">
      <PageHeading title="Tariflar" subtitle="Joriy obuna va Click orqali yangilash" icon={BadgePercent} />
      {msg && <div className="notice error" data-testid="notice-checkout-error">{msg}</div>}
      {payHint && (
        <div className="notice warn" data-testid="notice-checkout-hint">
          {payHint}{' '}
          {access.isPlatformAdmin && <Link href="/owner">Owner panel →</Link>}
          {!org && !access.isPlatformAdmin && <Link href="/sign-in">Kirish →</Link>}
        </div>
      )}
      {org && (
        <Panel title="Joriy holat">
          <div className="plan-current">
            <div><span className="eyebrow">Kompaniya</span><b>{org.name}</b></div>
            <div><span className="eyebrow">Tarif</span><b>{org.planName}</b></div>
            <div><span className="eyebrow">Status</span><b>{org.subscriptionStatus}</b></div>
            <div><span className="eyebrow">Filial limiti</span><b>{org.branchLimit == null ? 'Cheksiz' : org.branchLimit}</b></div>
            {org.trialEndsAt && <div><span className="eyebrow">Sinov tugashi</span><b>{new Date(org.trialEndsAt).toLocaleString('uz-UZ')}</b></div>}
            {org.planExpiresAt && <div><span className="eyebrow">Amal qiladi</span><b>{new Date(org.planExpiresAt).toLocaleString('uz-UZ')}</b></div>}
          </div>
        </Panel>
      )}
      <div className="plan-grid">
        {plans.map((p) => {
          const trialLocked = p.code === 'starter' && org?.subscriptionStatus === 'trialing' && org?.planCode === 'starter';
          const disabled = checkout.isPending || trialLocked || !canPay;
          return (
            <article key={p.code} className={`plan-card ${p.highlight ? 'featured' : ''} ${org?.planCode === p.code ? 'current' : ''}`}>
              {p.highlight && <span className="plan-badge">Tavsiya</span>}
              <h3>{p.name}</h3>
              <div className="plan-price"><b>{formatUzs(p.priceUzs)}</b><small>/ oy</small></div>
              <p><Building2 size={14} /> {p.branchLimit == null ? 'Istalgancha filial' : `${p.branchLimit} ta filial`}</p>
              <ul>{p.features.map((f) => <li key={f}><Check size={14} />{f}</li>)}</ul>
              <button
                type="button"
                className="button primary plan-buy"
                disabled={disabled}
                onClick={() => openPay(p)}
                data-testid={`button-checkout-${p.code}`}
              >
                <Wallet size={16} />
                {trialLocked ? 'Hozir bepul sinovdasiz' : 'Obuna sotib olish'}
              </button>
            </article>
          );
        })}
      </div>
      {org?.telegramEnabled && (
        <Panel title="Telegram xabarnoma (Korxona)">
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
          onClose={() => !checkout.isPending && setPayPlan(null)}
          busy={checkout.isPending}
          size="md"
        >
          <div className="pay-modal">
            <p className="pay-modal-lead">Qanday toʻlamoqchisiz? Ikkalasi ham Click orqali xavfsiz oʻtadi.</p>
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
                  <small>Uzcard / Humo raqamini Click sahifasida kiritasiz. Toʻlov Click orqali amalga oshadi.</small>
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
                  <small>Click ilovasi yoki QR kod orqali toʻgʻridan-toʻgʻri toʻlaysiz — karta yozish shart emas.</small>
                </span>
                <span className="pay-method-check">{method === 'click' && <Check size={16} />}</span>
              </button>
            </div>
            <div className="pay-modal-sum">
              <span>Toʻlov summasi</span>
              <b>{formatUzs(payPlan.priceUzs)} <small>/ oy</small></b>
            </div>
            <div className="pay-modal-actions">
              <button type="button" className="button ghost" disabled={checkout.isPending} onClick={() => setPayPlan(null)}>
                <X size={15} /> Bekor
              </button>
              <button
                type="button"
                className="button primary plan-buy"
                disabled={checkout.isPending}
                onClick={startPay}
                data-testid="button-pay-continue"
              >
                {checkout.isPending ? <Loader2 className="spin" size={16} /> : method === 'card' ? <CreditCard size={16} /> : <QrCode size={16} />}
                {method === 'card' ? 'Kartaga oʻtish' : 'Click / QR ga oʻtish'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
