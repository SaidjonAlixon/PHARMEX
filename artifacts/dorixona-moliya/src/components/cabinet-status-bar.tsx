import { Building2, Clock3, Info } from 'lucide-react';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import type { OrgBrief } from '@/lib/access';

const TEST_MARQUEE =
  'PHARMXS sinov rejimida ishlamoqda. Yangi imkoniyatlar bosqichma-bosqich joriy etilmoqda.';
const MARQUEE_COPIES = 6;

function pad(n: number) {
  return String(Math.max(0, n)).padStart(2, '0');
}

function useCountdown(endsAt: string | null | undefined) {
  const target = useMemo(() => {
    if (!endsAt) return null;
    const t = new Date(endsAt).getTime();
    return Number.isNaN(t) ? null : t;
  }, [endsAt]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [target]);

  if (!target) return null;
  const diff = Math.max(0, target - now);
  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return { days, hours, minutes, seconds, ended: diff <= 0 };
}

function OrgStrip({
  organization,
}: {
  organization: OrgBrief | null;
  pageLabel?: string;
}) {
  const countdown = useCountdown(organization?.endsAt);
  const plan = organization?.planName || organization?.planCode || '—';
  const name = organization?.name || 'Kompaniya';

  return (
    <div className="cabinet-status-main" data-testid="cabinet-status-bar">
      <span className="cabinet-org-icon" aria-hidden><Building2 size={15} /></span>

      <div className="cabinet-meta-col" title={name}>
        <span className="cabinet-meta-label">Kompaniya nomi</span>
        <b className="cabinet-meta-value">{name}</b>
      </div>

      <div className="cabinet-meta-divider" aria-hidden />

      <div className="cabinet-meta-col" title={`Tarif: ${plan}`}>
        <span className="cabinet-meta-label">Tarif</span>
        <b className="cabinet-meta-value cabinet-meta-plan">{plan}</b>
      </div>

      <div className={`cabinet-countdown ${countdown?.ended ? 'is-ended' : ''}`} aria-live="polite">
        <span className="cabinet-countdown-head">
          <Clock3 size={12} />
          <span>{countdown?.ended ? 'Tugagan' : 'Muddat'}</span>
        </span>
        {countdown && !countdown.ended ? (
          <div className="cabinet-ticks">
            <span className="is-days"><b>{pad(countdown.days)}</b><em>kun</em></span>
            <i>:</i>
            <span><b>{pad(countdown.hours)}</b><em>soat</em></span>
            <i>:</i>
            <span><b>{pad(countdown.minutes)}</b><em>daq</em></span>
            <i>:</i>
            <span><b>{pad(countdown.seconds)}</b><em>sek</em></span>
          </div>
        ) : (
          <strong className="cabinet-ended-note">Yangilang</strong>
        )}
      </div>
    </div>
  );
}

function Marquee() {
  return (
    <div className="cabinet-marquee" role="status" aria-label="Platforma eʼloni">
      <div className="cabinet-marquee-track">
        {[0, 1].map((group) => (
          <div key={group} className="cabinet-marquee-group" aria-hidden={group === 1 || undefined}>
            {Array.from({ length: MARQUEE_COPIES }, (_, i) => (
              <span key={i} className="cabinet-marquee-item">
                <Info className="cabinet-marquee-info" size={14} strokeWidth={2.4} aria-hidden />
                {TEST_MARQUEE}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Sticky head: top row (menu + org strip + actions) and red marquee below. */
export function CabinetHead({
  organization,
  pageLabel,
  menu,
  actions,
}: {
  organization: OrgBrief | null;
  pageLabel?: string;
  menu: ReactNode;
  actions: ReactNode;
}) {
  return (
    <header className="cabinet-head">
      <div className="cabinet-head-row">
        {menu}
        <OrgStrip organization={organization} pageLabel={pageLabel} />
        <div className="cabinet-head-spacer" />
        {actions}
      </div>
      <Marquee />
    </header>
  );
}

/** @deprecated use CabinetHead */
export function CabinetStatusBar(props: { organization: OrgBrief | null; pageLabel?: string }) {
  return <OrgStrip {...props} />;
}
