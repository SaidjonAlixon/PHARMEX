import { Building2, Clock3 } from 'lucide-react';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import type { OrgBrief } from '@/lib/access';

const TEST_MARQUEE =
  'Bu platforma test holatda ishlamoqda — barcha imkoniyatlar ketma-ketlik bilan qoʻshib borilmoqda…!';
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
  pageLabel,
}: {
  organization: OrgBrief | null;
  pageLabel?: string;
}) {
  const countdown = useCountdown(organization?.endsAt);
  const plan = organization?.planName || organization?.planCode || '—';
  const name = organization?.name || 'Kompaniya';

  return (
    <div className="cabinet-status-main" data-testid="cabinet-status-bar">
      <div className="cabinet-org">
        <span className="cabinet-org-icon" aria-hidden><Building2 size={14} /></span>
        <div className="cabinet-org-text">
          <span className="cabinet-org-label">{pageLabel || 'Kompaniya'}</span>
          <b title={name}>{name}</b>
        </div>
        <span className="cabinet-plan-chip" title={`Tarif: ${plan}`}>{plan}</span>
      </div>

      <div className={`cabinet-countdown ${countdown?.ended ? 'is-ended' : ''}`} aria-live="polite">
        <Clock3 size={13} />
        <span className="cabinet-countdown-label">
          {countdown?.ended ? 'Tugagan' : 'Tugashiga'}
        </span>
        {countdown && !countdown.ended ? (
          <div className="cabinet-ticks">
            <span><b>{pad(countdown.days)}</b><em>kun</em></span>
            <i>:</i>
            <span><b>{pad(countdown.hours)}</b><em>soat</em></span>
            <i>:</i>
            <span><b>{pad(countdown.minutes)}</b><em>daq</em></span>
            <i>:</i>
            <span><b>{pad(countdown.seconds)}</b><em>sek</em></span>
          </div>
        ) : (
          <strong className="cabinet-ended-note">Tarifni yangilang</strong>
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
                <em aria-hidden>●</em>
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
