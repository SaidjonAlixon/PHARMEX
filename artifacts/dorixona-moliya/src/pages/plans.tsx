import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgePercent, Building2, Check, Crown, Loader2, Send } from 'lucide-react';
import { useState } from 'react';
import { PageHeading, Panel } from '@/components/kit';
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

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Xatolik');
  return data as T;
}

export function PlansPage() {
  const qc = useQueryClient();
  const [chatId, setChatId] = useState('');
  const [msg, setMsg] = useState('');
  const q = useQuery({
    queryKey: ['billing-subscription'],
    queryFn: () => api<{ organization: OrgSub | null; plans: PlanRow[] }>('/api/billing/subscription'),
  });
  const checkout = useMutation({
    mutationFn: (planCode: PlanCode) => api<{ url: string }>('/api/billing/checkout', { method: 'POST', body: JSON.stringify({ planCode }) }),
    onSuccess: (data) => { window.location.href = data.url; },
    onError: (e: Error) => setMsg(e.message),
  });
  const telegram = useMutation({
    mutationFn: () => api('/api/billing/telegram', { method: 'POST', body: JSON.stringify({ chatId }) }),
    onSuccess: () => { setMsg('Telegram bogʻlandi'); void qc.invalidateQueries({ queryKey: ['billing-subscription'] }); },
    onError: (e: Error) => setMsg(e.message),
  });

  const org = q.data?.organization;
  const plans = q.data?.plans ?? [];

  return (
    <div className="page-stack">
      <PageHeading title="Tariflar" subtitle="Joriy obuna va Click orqali yangilash" icon={BadgePercent} />
      {msg && <div className="notice">{msg}</div>}
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
        {plans.map((p) => (
          <article key={p.code} className={`plan-card ${p.highlight ? 'featured' : ''} ${org?.planCode === p.code ? 'current' : ''}`}>
            {p.highlight && <span className="plan-badge">Tavsiya</span>}
            <h3>{p.name}</h3>
            <div className="plan-price"><b>{formatUzs(p.priceUzs)}</b><small>/ oy</small></div>
            <p><Building2 size={14} /> {p.branchLimit == null ? 'Istalgancha filial' : `${p.branchLimit} ta filial`}</p>
            <ul>{p.features.map((f) => <li key={f}><Check size={14} />{f}</li>)}</ul>
            <button
              type="button"
              className="button primary"
              disabled={checkout.isPending || (p.code === 'starter' && org?.subscriptionStatus === 'trialing' && org?.planCode === 'starter')}
              onClick={() => checkout.mutate(p.code)}
              data-testid={`button-checkout-${p.code}`}
            >
              {checkout.isPending ? <Loader2 className="spin" size={16} /> : <Crown size={16} />}
              {p.code === 'starter' && org?.subscriptionStatus === 'trialing' && org?.planCode === 'starter'
                ? 'Hozir bepul sinovdasiz'
                : p.code === 'starter'
                  ? 'Starter — Click toʻlov'
                  : `${p.name} — Click toʻlov`}
            </button>
          </article>
        ))}
      </div>
      {org?.telegramEnabled && (
        <Panel title="Telegram xabarnoma (Enterprise)">
          <p className="muted-line">Botga /start yuboring va chat ID ni kiriting.</p>
          <div className="inline-form">
            <input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="Chat ID" data-testid="input-telegram-chat" />
            <button type="button" className="button" disabled={telegram.isPending} onClick={() => telegram.mutate()}>
              <Send size={15} /> {org.telegramLinked ? 'Yangilash' : 'Bogʻlash'}
            </button>
          </div>
        </Panel>
      )}
    </div>
  );
}
