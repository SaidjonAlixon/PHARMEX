import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowRight, type LucideIcon } from 'lucide-react';
import { Show } from '@/lib/auth';

export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Navigates to `/path#anchor` and scrolls to the anchor once the page has rendered. */
export function useAnchorNav() {
  const [location, navigate] = useLocation();
  return (href: string) => {
    const [path, hash] = href.split('#');
    const samePage = !path || path === location;
    if (!samePage) navigate(path);
    if (hash) window.setTimeout(() => document.getElementById(hash)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }), samePage ? 0 : 140);
  };
}

export function AnchorLink({ href, className, children, onNavigate }: { href: string; className?: string; children: ReactNode; onNavigate?: () => void }) {
  const go = useAnchorNav();
  return <a href={href} className={className} onClick={e => { e.preventDefault(); onNavigate?.(); go(href); }}>{children}</a>;
}

/** Elements with `data-reveal` fade in once they scroll into view (wired up in SiteLayout). */
export function observeReveals(root: HTMLElement) {
  const pending = () => Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]:not(.is-in)'));
  if (reducedMotion() || !('IntersectionObserver' in window)) {
    const showAll = () => pending().forEach(el => el.classList.add('is-in'));
    showAll();
    const mo = new MutationObserver(showAll);
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  }
  const io = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('is-in');
    io.unobserve(entry.target);
  }), { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  const scan = () => pending().forEach(el => io.observe(el));
  scan();
  const mo = new MutationObserver(scan);
  mo.observe(root, { childList: true, subtree: true });
  return () => { io.disconnect(); mo.disconnect(); };
}

export const delay = (i: number, step = 70): CSSProperties => ({ ['--d' as string]: `${i * step}ms` });

export function useInView<T extends HTMLElement>(threshold = 0.3) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (!('IntersectionObserver' in window)) { setSeen(true); return; }
    const io = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [seen, threshold]);
  return [ref, seen] as const;
}

export function CountUp({ to, suffix = '', prefix = '', duration = 1400 }: { to: number; suffix?: string; prefix?: string; duration?: number }) {
  const [ref, seen] = useInView<HTMLSpanElement>(0.4);
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!seen) return;
    if (reducedMotion()) { setValue(to); return; }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setValue(Math.round(to * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [seen, to, duration]);
  return <span ref={ref}>{prefix}{value.toLocaleString('uz-UZ')}{suffix}</span>;
}

export function Eyebrow({ children, icon: Icon }: { children: ReactNode; icon?: LucideIcon }) {
  return <span className="s-eyebrow">{Icon ? <Icon size={13} /> : <i />}{children}</span>;
}

export function SectionHead({ eyebrow, title, accent, text, center = false, icon }: { eyebrow: string; title: ReactNode; accent?: ReactNode; text?: ReactNode; center?: boolean; icon?: LucideIcon }) {
  return <div className={`s-head ${center ? 'center' : ''}`} data-reveal>
    <Eyebrow icon={icon}>{eyebrow}</Eyebrow>
    <h2>{title}{accent && <> <span className="s-grad">{accent}</span></>}</h2>
    {text && <p>{text}</p>}
  </div>;
}

export function PageHero({ eyebrow, icon, title, accent, text, chips, children }: { eyebrow: string; icon: LucideIcon; title: ReactNode; accent: ReactNode; text: ReactNode; chips?: string[]; children?: ReactNode }) {
  return <section className="s-page-hero">
    <div className="s-wrap">
      <div className="s-page-hero-copy">
        <Eyebrow icon={icon}>{eyebrow}</Eyebrow>
        <h1 data-reveal>{typeof title === 'string' ? title.replace(/ —$/, '\u00a0—') : title}<br /><span className="s-grad">{accent}</span></h1>
        <p data-reveal style={delay(1)}>{text}</p>
        {chips && <div className="s-chips" data-reveal style={delay(2)}>{chips.map(c => <span key={c}>{c}</span>)}</div>}
      </div>
      {children && <div className="s-page-hero-art" data-reveal style={delay(2)}>{children}</div>}
    </div>
  </section>;
}

export function PrimaryCta({ large = false, label = 'Boshlash' }: { large?: boolean; label?: string }) {
  return <>
    <Show when="signed-out"><Link href="/sign-up" className={`s-btn primary ${large ? 'lg' : ''}`} data-testid="link-site-signup">{label} <ArrowRight size={large ? 18 : 16} /></Link></Show>
    <Show when="signed-in"><Link href="/" className={`s-btn primary ${large ? 'lg' : ''}`} data-testid="link-site-cabinet">Kabinetga oʻtish <ArrowRight size={large ? 18 : 16} /></Link></Show>
  </>;
}

export function CtaBand({ title = 'Dorixona moliyasini bugun tartibga soling.', text = 'Filiallar, kassa, zaxira va qarzlar — bitta aniq, real vaqtdagi manzilda.' }: { title?: string; text?: string }) {
  return <section className="s-section">
    <div className="s-wrap">
      <div className="s-cta" data-reveal>
        <div className="s-cta-glow" aria-hidden="true" />
        <div className="s-cta-grid" aria-hidden="true" />
        <div className="s-cta-copy"><Eyebrow>KEYINGI QADAM</Eyebrow><h2>{title}</h2><p>{text}</p></div>
        <div className="s-cta-actions"><PrimaryCta large /><Link href="/savollar" className="s-btn ghost lg">Savollar <ArrowRight size={17} /></Link></div>
      </div>
    </div>
  </section>;
}

export function FeatureCard({ icon: Icon, title, text, color, i = 0, children }: { icon: LucideIcon; title: string; text: ReactNode; color: string; i?: number; children?: ReactNode }) {
  return <article className="s-card spot" style={{ ...delay(i), ['--c' as string]: color }} data-reveal>
    <span className="s-card-icon"><Icon size={20} /></span>
    <h3>{title}</h3>
    <p>{text}</p>
    {children}
  </article>;
}
