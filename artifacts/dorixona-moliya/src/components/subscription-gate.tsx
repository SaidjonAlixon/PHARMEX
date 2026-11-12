import { ArrowRight, BadgePercent, Lock, ShieldAlert } from 'lucide-react';
import { Link } from 'wouter';
import type { OrgBrief } from '@/lib/access';

function formatEnds(iso: string | null | undefined) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('uz-UZ', {
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function SubscriptionGate({
  organization,
  status,
}: {
  organization: OrgBrief | null;
  status?: string;
}) {
  const ended = status === 'past_due' || status === 'canceled';
  const title = status === 'canceled'
    ? 'Kabinet vaqtincha yopilgan'
    : 'Obuna muddati tugagan';
  const text = status === 'canceled'
    ? 'Platforma egasi yoki toʻlov holati boʻyicha kabinet cheklangan. Toʻlovni amalga oshirib, yana ochishingiz mumkin.'
    : 'Toʻlov kuni oʻtdi yoki sinov yakunlandi. Maʼlumotlar saqlanadi — tarifni yangilang va kabinetga qayting.';

  return (
    <div className="paywall" data-testid="page-subscription-gate">
      <div className="paywall-card">
        <div className="paywall-icon" aria-hidden>
          <Lock size={28} />
        </div>
        <p className="paywall-eyebrow"><ShieldAlert size={14} /> Kirish cheklangan</p>
        <h1>{title}</h1>
        <p className="paywall-text">{text}</p>

        <div className="paywall-meta">
          <div>
            <span>Kompaniya</span>
            <b>{organization?.name || '—'}</b>
          </div>
          <div>
            <span>Tarif</span>
            <b>{organization?.planName || organization?.planCode || '—'}</b>
          </div>
          <div>
            <span>Tugash sanasi</span>
            <b>{formatEnds(organization?.endsAt) || '—'}</b>
          </div>
          <div>
            <span>Holat</span>
            <b>{ended ? (status === 'canceled' ? 'Bloklangan' : 'Muddati tugagan') : '—'}</b>
          </div>
        </div>

        <div className="paywall-actions">
          <Link href="/tariflar" className="button primary paywall-cta" data-testid="link-paywall-plans">
            <BadgePercent size={16} /> Tarifni tanlash va toʻlash <ArrowRight size={16} />
          </Link>
          <p className="paywall-fine">Click orqali xavfsiz toʻlov. Tasdiqlangach kabinet avtomatik ochiladi.</p>
        </div>
      </div>
    </div>
  );
}
