import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowRight, ArrowUpRight, ChevronDown, Menu, PlugZap, Sparkles, X } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { ThemeToggle } from '@/lib/theme';
import { Show } from '@/lib/auth';
import { modules, sitePages } from './content';
import { AnchorLink, PrimaryCta, observeReveals } from './ui';
import './site.css';

function useScrollState() {
  const [scrolled, setScrolled] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      bar.current?.style.setProperty('--p', String(max > 0 ? window.scrollY / max : 0));
      setScrolled(window.scrollY > 12);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); cancelAnimationFrame(frame); };
  }, []);
  return { scrolled, bar };
}

function MegaMenu({ onNavigate }: { onNavigate: () => void }) {
  return <div className="s-mega" role="menu">
    <div className="s-mega-intro">
      <span className="s-mega-badge"><Sparkles size={13} /> 10 ta modul</span>
      <b>Dorixona moliyasining toʻliq sikli</b>
      <p>Kirimdan sotuvgacha, kassadan sof foydagacha — har bir jarayon bitta tizimda.</p>
      <Link href="/imkoniyatlar" className="s-mega-all" onClick={onNavigate}>Barcha imkoniyatlar <ArrowRight size={14} /></Link>
    </div>
    <div className="s-mega-grid">
      {modules.map(m => <AnchorLink key={m.id} href={`/imkoniyatlar#${m.id}`} className="s-mega-item" onNavigate={onNavigate}>
        <span className="s-mega-icon" style={{ ['--c' as string]: m.color }}><m.icon size={17} /></span>
        <span><b>{m.title}</b><small>{m.short}</small></span>
      </AnchorLink>)}
    </div>
  </div>;
}

function NavLinks() {
  const [location] = useLocation();
  const [hover, setHover] = useState<string | null>(null);
  const [mega, setMega] = useState(false);
  const refs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const wrap = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number; on: boolean }>({ x: 0, w: 0, on: false });
  const closeTimer = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    const measure = () => {
      const key = hover ?? sitePages.find(p => location.startsWith(p.href))?.href;
      const el = key ? refs.current[key] : null;
      const box = wrap.current?.getBoundingClientRect();
      if (!el || !box) { setPill(p => ({ ...p, on: false })); return; }
      const r = el.getBoundingClientRect();
      setPill({ x: r.left - box.left, w: r.width, on: true });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [hover, location]);

  useEffect(() => setMega(false), [location]);
  const openMega = () => { window.clearTimeout(closeTimer.current); setMega(true); };
  const closeMega = () => { closeTimer.current = window.setTimeout(() => setMega(false), 140); };

  return <div className="s-navlinks" ref={wrap} onMouseLeave={() => setHover(null)}>
    <span className={`s-navpill ${pill.on ? 'on' : ''}`} style={{ transform: `translateX(${pill.x}px)`, width: pill.w }} aria-hidden="true" />
    {sitePages.map(p => {
      const active = location.startsWith(p.href);
      const isMega = p.href === '/imkoniyatlar';
      return <div key={p.href} className={`s-navitem ${isMega ? 'has-mega' : ''} ${isMega && mega ? 'open' : ''}`} onMouseEnter={isMega ? openMega : undefined} onMouseLeave={isMega ? closeMega : undefined}>
        <Link href={p.href} ref={el => { refs.current[p.href] = el; }} className={`s-navlink ${active ? 'active' : ''}`} onMouseEnter={() => setHover(p.href)} onFocus={() => setHover(p.href)} onBlur={() => setHover(null)} aria-current={active ? 'page' : undefined}>
          {p.label}{isMega && <ChevronDown size={14} className="s-navchev" />}
        </Link>
        {isMega && <MegaMenu onNavigate={() => setMega(false)} />}
      </div>;
    })}
  </div>;
}

function MobileMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [location] = useLocation();
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [open, onClose]);
  return <div className={`s-sheet ${open ? 'open' : ''}`} aria-hidden={!open}>
    <div className="s-sheet-inner">
      <Link href="/" className={`s-sheet-link ${location === '/' ? 'active' : ''}`} onClick={onClose} style={{ ['--i' as string]: 0 }}><span>00</span>Bosh sahifa<ArrowUpRight size={18} /></Link>
      {sitePages.map((p, i) => <Link key={p.href} href={p.href} className={`s-sheet-link ${location.startsWith(p.href) ? 'active' : ''}`} onClick={onClose} style={{ ['--i' as string]: i + 1 }}>
        <span>{String(i + 1).padStart(2, '0')}</span>{p.label}<ArrowUpRight size={18} />
      </Link>)}
      <div className="s-sheet-foot" style={{ ['--i' as string]: sitePages.length + 1 }}>
        <Show when="signed-out"><Link href="/sign-in" className="s-btn ghost" onClick={onClose} data-testid="link-sheet-sign-in">Kirish</Link></Show>
        <PrimaryCta />
      </div>
    </div>
  </div>;
}

function Footer() {
  return <footer className="s-footer">
    <div className="s-wrap">
      <div className="s-footer-top">
        <div className="s-footer-brand">
          <Link href="/" className="s-logo"><BrandLogo /></Link>
          <p>Dorixona guruhlari uchun moliyaviy boshqaruv markazi: savdo, zaxira, kassa, qarz va foyda — bitta aniq manzilda.</p>
          <span className="s-footer-live"><i /> FOM F-APTEKA bilan real vaqt integratsiyasi</span>
        </div>
        <div className="s-footer-col"><b>Platforma</b><Link href="/">Bosh sahifa</Link>{sitePages.map(p => <Link key={p.href} href={p.href}>{p.label}</Link>)}</div>
        <div className="s-footer-col"><b>Modullar</b>{modules.slice(0, 7).map(m => <AnchorLink key={m.id} href={`/imkoniyatlar#${m.id}`}>{m.title}</AnchorLink>)}</div>
        <div className="s-footer-col"><b>Boshlash</b>
          <Show when="signed-out"><Link href="/sign-up">Akkaunt ochish</Link><Link href="/sign-in">Tizimga kirish</Link></Show>
          <Show when="signed-in"><Link href="/">Kabinetga oʻtish</Link></Show>
          <Link href="/integratsiya">FOM ni ulash</Link><Link href="/qanday-ishlaydi">Birinchi kun</Link><Link href="/savollar">Yordam</Link>
        </div>
      </div>
      <div className="s-footer-word" aria-hidden="true">PHARMEX</div>
      <div className="s-footer-bottom"><span>© {new Date().getFullYear()} PHARMEX · Dorixona moliyaviy boshqaruvi</span><span>Oʻzbekiston dorixonalari uchun yaratilgan</span></div>
    </div>
  </footer>;
}

export function SiteLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { scrolled, bar } = useScrollState();
  const [menu, setMenu] = useState(false);
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    setMenu(false);
    if (!window.location.hash) window.scrollTo({ top: 0 });
    return main.current ? observeReveals(main.current) : undefined;
  }, [location]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.('.spot') as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - r.left}px`);
      el.style.setProperty('--my', `${e.clientY - r.top}px`);
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    return () => document.removeEventListener('pointermove', onMove);
  }, []);

  return <div className="site">
    <div className="s-aurora" aria-hidden="true"><i /><i /><i /></div>
    <div className="s-gridbg" aria-hidden="true" />
    <Link href="/integratsiya" className="s-announce" data-testid="link-announce"><span className="s-announce-tag"><PlugZap size={12} /> Yangi</span>FOM F-APTEKA bilan real vaqt integratsiyasi — IP va portni kiriting, maʼlumot oʻzi keladi<ArrowRight size={14} /></Link>
    <header className={`s-nav ${scrolled ? 'scrolled' : ''} ${menu ? 'menu-open' : ''}`}>
      <div className="s-nav-inner">
        <Link href="/" className="s-logo" aria-label="PHARMEX bosh sahifa" data-testid="link-site-home"><BrandLogo /></Link>
        <nav aria-label="Asosiy menyu"><NavLinks /></nav>
        <div className="s-nav-actions">
          <ThemeToggle />
          <Show when="signed-out"><Link href="/sign-in" className="s-nav-login" data-testid="link-sign-in">Kirish</Link></Show>
          <PrimaryCta label="Boshlash" />
          <button type="button" className="s-burger" onClick={() => setMenu(v => !v)} aria-label={menu ? 'Menyuni yopish' : 'Menyuni ochish'} aria-expanded={menu}>{menu ? <X size={20} /> : <Menu size={20} />}</button>
        </div>
      </div>
      <div className="s-progress" ref={bar} aria-hidden="true" />
    </header>
    <MobileMenu open={menu} onClose={() => setMenu(false)} />
    <main ref={main} key={location} className="s-main">{children}</main>
    <Footer />
  </div>;
}
