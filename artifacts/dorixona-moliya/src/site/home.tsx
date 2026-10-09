import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Link } from 'wouter';
import {
  ArrowRight, ArrowUpRight, Banknote, BadgeCheck, CircleCheck, CircleX, FileSpreadsheet, HandCoins, Landmark, PlugZap, Receipt,
  RefreshCw, ShieldCheck, Sparkles, TrendingUp, Truck, Wallet, Zap, type LucideIcon,
} from 'lucide-react';
import { modules, sitePages } from './content';
import { CountUp, CtaBand, Eyebrow, PrimaryCta, SectionHead, delay, reducedMotion } from './ui';

const words = ['savdosi', 'zaxirasi', 'kassasi', 'qarzlari', 'foydasi'];

function RotatingWord() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reducedMotion()) return;
    const t = window.setInterval(() => setI(v => (v + 1) % words.length), 2200);
    return () => window.clearInterval(t);
  }, []);
  return <span className="s-rotator" aria-live="polite">
    <span className="s-rotator-sizer" aria-hidden="true">qarzlari</span>
    {words.map((w, idx) => <span key={w} className={`s-rotator-word ${idx === i ? 'on' : idx === (i + words.length - 1) % words.length ? 'out' : ''}`}>{w}</span>)}
  </span>;
}

type FeedItem = { icon: LucideIcon; color: string; title: string; meta: string; amount: number; sale?: boolean };
const feedSource: FeedItem[] = [
  { icon: Receipt, color: '#1fb84f', title: 'Chek #10482', meta: '3-filial · Naqd', amount: 184_500, sale: true },
  { icon: Truck, color: '#e48a0c', title: 'Kirim hujjati', meta: '12 pozitsiya · qisman qarz', amount: -2_350_000 },
  { icon: Receipt, color: '#1fb84f', title: 'Chek #10483', meta: '1-filial · Karta', amount: 96_200, sale: true },
  { icon: Landmark, color: '#1f5fd0', title: 'Inkassatsiya', meta: 'Kassa → Bank hisobi', amount: -4_000_000 },
  { icon: Receipt, color: '#1fb84f', title: 'Chek #10484', meta: '2-filial · Aralash', amount: 312_750, sale: true },
  { icon: HandCoins, color: '#6d4fd8', title: 'Qarz toʻlandi', meta: 'Mijoz · nasiya', amount: 450_000 },
  { icon: RefreshCw, color: '#0fb3c7', title: 'FOM sinxron', meta: '3 filial · 22 yozuv', amount: 0 },
];

const fmt = (n: number) => Math.abs(n).toLocaleString('uz-UZ').replace(/,/g, ' ');

function LiveBoard() {
  const [tick, setTick] = useState(0);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reducedMotion()) return;
    const t = window.setInterval(() => setTick(v => v + 1), 2400);
    return () => window.clearInterval(t);
  }, []);
  const feed = Array.from({ length: 4 }, (_, k) => {
    const n = tick - k;
    return { ...feedSource[((n % feedSource.length) + feedSource.length) % feedSource.length], key: n };
  });
  const sales = 48_270_400 + Array.from({ length: tick }, (_, n) => feedSource[n % feedSource.length]).filter(f => f.sale).reduce((s, f) => s + f.amount, 0);
  const bars = [72, 58, 86, 44].map((b, k) => Math.max(18, Math.min(96, b + Math.round(Math.sin(tick * 0.9 + k * 1.7) * 9))));

  const onMove = (e: PointerEvent) => {
    const el = card.current;
    if (!el || reducedMotion()) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * 8}deg`);
    el.style.setProperty('--rx', `${-((e.clientY - r.top) / r.height - 0.5) * 6}deg`);
  };
  const reset = () => { card.current?.style.setProperty('--rx', '0deg'); card.current?.style.setProperty('--ry', '0deg'); };

  return <div className="s-board-wrap" onPointerMove={onMove} onPointerLeave={reset}>
    <div className="s-board" ref={card}>
      <div className="s-board-head"><span className="s-dots"><i /><i /><i /></span><span>pharmex · Bosh dashboard</span><span className="s-live"><i /> LIVE</span></div>
      <div className="s-board-body">
        <div className="s-board-kpis">
          <div className="k1"><span>Bugungi savdo</span><b key={sales} className="s-tickup">{fmt(sales)}</b><small><TrendingUp size={12} /> +12,4% oʻtgan haftaga</small></div>
          <div className="k2"><span>Yalpi foyda</span><b>{fmt(Math.round(sales * 0.27))}</b><small>marja 27%</small></div>
        </div>
        <div className="s-board-chart">
          <svg viewBox="0 0 320 110" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="s-line" x1="0" x2="1"><stop offset="0" stopColor="#0fb3c7" /><stop offset="1" stopColor="#2fcf5a" /></linearGradient>
              <linearGradient id="s-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#0fb3c7" stopOpacity=".35" /><stop offset="1" stopColor="#0fb3c7" stopOpacity="0" /></linearGradient>
            </defs>
            <path className="s-area" d="M0 88 C30 80 45 92 70 74 S115 70 135 58 S175 66 200 46 S250 40 270 28 S305 22 320 14 L320 110 L0 110Z" fill="url(#s-area)" />
            <path className="s-draw" d="M0 88 C30 80 45 92 70 74 S115 70 135 58 S175 66 200 46 S250 40 270 28 S305 22 320 14" fill="none" stroke="url(#s-line)" strokeWidth="3" strokeLinecap="round" />
            <path className="s-draw late" d="M0 98 C40 96 60 90 90 88 S140 80 170 80 S230 70 260 64 S300 58 320 52" fill="none" stroke="#1f5fd0" strokeOpacity=".55" strokeWidth="2" strokeDasharray="5 6" />
            <circle className="s-chart-dot" cx="320" cy="14" r="5" />
          </svg>
        </div>
        <div className="s-board-split">
          <div className="s-board-branches">
            <span className="s-mini-title">Filiallar</span>
            {['Markaziy', 'Chilonzor', 'Yunusobod', 'Sergeli'].map((b, k) => <div key={b} className="s-branch"><span>{b}</span><div><i style={{ width: `${bars[k]}%` }} /></div></div>)}
          </div>
          <div className="s-board-feed">
            <span className="s-mini-title">Jonli hodisalar</span>
            {feed.map(f => <div key={f.key} className="s-feed-row">
              <span className="s-feed-icon" style={{ ['--c' as string]: f.color }}><f.icon size={13} /></span>
              <span className="s-feed-text"><b>{f.title}</b><small>{f.meta}</small></span>
              {f.amount !== 0 && <em className={f.amount > 0 ? 'up' : 'down'}>{f.amount > 0 ? '+' : '−'}{fmt(f.amount)}</em>}
            </div>)}
          </div>
        </div>
      </div>
    </div>
    <div className="s-float f1"><BadgeCheck size={15} /> QQS avtomatik hisoblandi</div>
    <div className="s-float f2"><PlugZap size={15} /> FOM · har 5 daqiqada</div>
    <div className="s-float f3"><ShieldCheck size={15} /> Har bir raqam manbasi bilan</div>
  </div>;
}

function Marquee() {
  const row = [...modules, ...modules];
  return <section className="s-marquee" aria-label="Modullar">
    <div className="s-marquee-track">{row.map((m, i) => <span key={i} className="s-marquee-item" style={{ ['--c' as string]: m.color }}><m.icon size={16} />{m.title}</span>)}</div>
    <div className="s-marquee-track reverse">{row.map((m, i) => <span key={i} className="s-marquee-item ghost">{m.short}</span>)}</div>
  </section>;
}

const pains = [
  { t: 'Har bir filial Excel yuboradi', d: 'Kechikkan, turli formatdagi eksportlar; guruh boʻyicha umumiy raqam yoʻq.' },
  { t: 'Kassadagi farq kech aniqlanadi', d: 'Naqd, karta va inkassatsiya alohida yuritiladi — kamomad oy oxirida chiqadi.' },
  { t: 'Qarzlar esdan chiqadi', d: 'Yetkazib beruvchi va nasiya qarzlari daftarda; muddati oʻtgani bilinmaydi.' },
  { t: 'Sof foyda taxminiy', d: 'Tannarx, qaytarish va xarajatlar hisobga olinmagan “foyda”.' },
];
const gains = [
  { t: 'Barcha filiallar bitta ekranda', d: 'FOM dan avtomatik maʼlumot, filial va davr boʻyicha bir bosishda filtr.' },
  { t: 'Kassa har kuni aniq', d: 'Boshlangʻich va yakuniy qoldiq, inkassatsiya va oʻtkazmalar hujjat bilan.' },
  { t: 'Qarzlar nazoratda', d: 'Kirim va nasiya savdodan qarz avtomatik; muddati oʻtganlar ajratiladi.' },
  { t: 'Haqiqiy sof foyda', d: 'Tannarx, QQS, qaytarish va xarajatlar hisobga olingan natija.' },
];

function BeforeAfter() {
  const [after, setAfter] = useState(true);
  const list = after ? gains : pains;
  return <section className="s-section">
    <div className="s-wrap">
      <SectionHead center eyebrow="NIMA UCHUN PHARMEX" title="Tarqoq hisobdan" accent="aniq nazoratga." text="Dorixona guruhida eng qimmat narsa — kechikkan va bir-biriga mos kelmaydigan raqamlar. PHARMEX ularni bitta haqiqatga aylantiradi." />
      <div className="s-ba-toggle" data-reveal role="tablist">
        <button role="tab" aria-selected={!after} className={!after ? 'on' : ''} onClick={() => setAfter(false)}><FileSpreadsheet size={15} /> PHARMEX dan oldin</button>
        <button role="tab" aria-selected={after} className={after ? 'on' : ''} onClick={() => setAfter(true)}><Sparkles size={15} /> PHARMEX bilan</button>
        <span className={`s-ba-thumb ${after ? 'right' : ''}`} aria-hidden="true" />
      </div>
      <div className={`s-ba-grid ${after ? 'after' : 'before'}`} key={String(after)}>
        {list.map((p, i) => <div key={p.t} className="s-ba-card" style={delay(i, 80)}>
          <span className="s-ba-icon">{after ? <CircleCheck size={18} /> : <CircleX size={18} />}</span>
          <b>{p.t}</b><p>{p.d}</p>
        </div>)}
      </div>
    </div>
  </section>;
}

function Stats() {
  const items: Array<{ to: number; suffix?: string; label: string; note: string }> = [
    { to: 10, label: 'modul', note: 'savdodan foydagacha' },
    { to: 8, label: 'FOM hisoboti', note: 'avtomatik import' },
    { to: 5, suffix: ' daq', label: 'yangilanish', note: 'real vaqtga yaqin' },
    { to: 100, suffix: '%', label: 'manbali raqam', note: 'FOM yoki qoʻlda — belgilanadi' },
  ];
  return <section className="s-stats">
    <div className="s-wrap s-stats-grid">
      {items.map((s, i) => <div key={s.label} className="s-stat" data-reveal style={delay(i)}>
        <b><CountUp to={s.to} suffix={s.suffix} /></b><span>{s.label}</span><small>{s.note}</small>
      </div>)}
    </div>
  </section>;
}

function Bento() {
  return <section className="s-section">
    <div className="s-wrap">
      <SectionHead eyebrow="PLATFORMA IMKONIYATLARI" title="Dorixona uchun yaratilgan," accent="har bir jarayon." text="Umumiy buxgalteriya dasturi emas — dorixona guruhining kundalik ishiga moslab qurilgan modullar." />
      <div className="s-bento">
        <article className="s-tile t-sales spot" data-reveal style={delay(0)}>
          <div className="s-tile-copy"><span className="s-tile-icon" style={{ ['--c' as string]: '#1fb84f' }}><Receipt size={18} /></span><h3>Savdo va cheklar</h3><p>Toʻlov turlari, chegirma, narx ichidagi QQS, tannarx va yalpi foyda — har bir chekda.</p></div>
          <div className="s-receipt" aria-hidden="true">
            <div><span>Paracetamol 500mg ×2</span><b>18 400</b></div><div><span>Vitamin C 1000</span><b>42 000</b></div><div><span>Bint steril</span><b>6 500</b></div>
            <div className="sum"><span>Jami · QQS 12%</span><b>66 900</b></div><div className="pay"><i className="cash">Naqd 40 000</i><i className="card">Karta 26 900</i></div>
          </div>
        </article>
        <article className="s-tile t-stock spot" data-reveal style={delay(1)}>
          <div className="s-tile-copy"><span className="s-tile-icon" style={{ ['--c' as string]: '#6d4fd8' }}><TrendingUp size={18} /></span><h3>Zaxira harakati</h3><p>Oʻtkazma, hisobdan chiqarish, inventarizatsiya.</p></div>
          <div className="s-stockbars" aria-hidden="true">{[64, 88, 42, 76, 30, 58, 92].map((h, i) => <i key={i} style={{ height: `${h}%`, ...delay(i, 90) }} />)}</div>
        </article>
        <article className="s-tile t-cash spot" data-reveal style={delay(2)}>
          <div className="s-tile-copy"><span className="s-tile-icon" style={{ ['--c' as string]: '#0b8fa3' }}><Wallet size={18} /></span><h3>Kassa va bank</h3><p>Inkassatsiya va oʻtkazmalar hujjat bilan.</p></div>
          <div className="s-flow" aria-hidden="true"><span><Banknote size={16} /> Kassa</span><div className="s-flow-line"><i /><i /><i /></div><span><Landmark size={16} /> Bank</span></div>
        </article>
        <article className="s-tile t-debt spot" data-reveal style={delay(3)}>
          <div className="s-tile-copy"><span className="s-tile-icon" style={{ ['--c' as string]: '#e0484f' }}><HandCoins size={18} /></span><h3>Qarzlar muddati bilan</h3><p>Debitor va kreditor qarzlar, qisman toʻlovlar tarixi.</p></div>
          <div className="s-aging" aria-hidden="true"><div><i style={{ flex: 5 }} className="ok" /><i style={{ flex: 3 }} className="mid" /><i style={{ flex: 2 }} className="bad" /></div><span><b>Muddatida</b><b>Yaqinlashmoqda</b><b>Oʻtgan</b></span></div>
        </article>
        <article className="s-tile t-profit spot" data-reveal style={delay(4)}>
          <div className="s-tile-copy"><span className="s-tile-icon" style={{ ['--c' as string]: '#179a45' }}><TrendingUp size={18} /></span><h3>Sof foyda</h3><p>Qaytarish va xarajatlar hisobga olingan natija.</p></div>
          <div className="s-pl" aria-hidden="true"><div><span>Tushum</span><i style={{ width: '100%' }} /></div><div><span>Tannarx</span><i style={{ width: '68%' }} className="c" /></div><div><span>Xarajat</span><i style={{ width: '14%' }} className="x" /></div><div><span>Sof foyda</span><i style={{ width: '18%' }} className="p" /></div></div>
        </article>
        <article className="s-tile t-fom spot" data-reveal style={delay(5)}>
          <div className="s-tile-copy"><span className="s-tile-icon" style={{ ['--c' as string]: '#0fb3c7' }}><PlugZap size={18} /></span><h3>FOM F-APTEKA integratsiyasi</h3><p>Filiallar, tovarlar, qoldiq, kirim va cheklar avtomatik keladi.</p><Link href="/integratsiya" className="s-tile-link">Batafsil <ArrowRight size={14} /></Link></div>
          <div className="s-orbit" aria-hidden="true"><span className="core"><Zap size={18} /></span><i className="r1" /><i className="r2" /><b className="o1">189</b><b className="o2">14</b><b className="o3">6</b></div>
        </article>
      </div>
    </div>
  </section>;
}

function Steps() {
  const steps = [
    { n: '01', t: 'Ulang', d: 'FOM server IP va portini kiriting yoki maʼlumotlarni qoʻlda kiriting. Filiallar, tovarlar va hamkorlar avtomatik toʻladi.' },
    { n: '02', t: 'Ishlating', d: 'Kirim, sotuv, qaytarish, kassa va qarz — har bir hujjat oʻz izini qoldiradi, qoldiq va pul oʻzi yangilanadi.' },
    { n: '03', t: 'Qaror qiling', d: 'Filial va davr kesimida foyda, qarzdorlik va zaxirani solishtiring — taxmin emas, dalil bilan.' },
  ];
  return <section className="s-section">
    <div className="s-wrap">
      <SectionHead center eyebrow="UCH QADAM" title="Ulanishdan" accent="qarorgacha." />
      <div className="s-steps">
        <div className="s-steps-line" aria-hidden="true"><i /></div>
        {steps.map((s, i) => <div key={s.n} className="s-step" data-reveal style={delay(i, 140)}><span className="s-step-n">{s.n}</span><h3>{s.t}</h3><p>{s.d}</p></div>)}
      </div>
      <div className="s-center" data-reveal><Link href="/qanday-ishlaydi" className="s-btn ghost">Toʻliq jarayonni koʻrish <ArrowRight size={16} /></Link></div>
    </div>
  </section>;
}

function Explore() {
  return <section className="s-section">
    <div className="s-wrap">
      <SectionHead eyebrow="SAYTNI OʻRGANING" title="Har bir savolga" accent="alohida sahifa." />
      <div className="s-explore">
        {sitePages.map((p, i) => <Link key={p.href} href={p.href} className="s-explore-card spot" data-reveal style={delay(i)}>
          <span className="s-explore-icon"><p.icon size={20} /></span>
          <b>{p.label}</b><small>{p.short}</small>
          <ArrowUpRight className="s-explore-arrow" size={18} />
        </Link>)}
      </div>
    </div>
  </section>;
}

export function HomePage() {
  return <>
    <section className="s-hero">
      <div className="s-wrap s-hero-grid">
        <div className="s-hero-copy">
          <Eyebrow icon={Sparkles}>DORIXONA GURUHLARI UCHUN MOLIYAVIY MARKAZ</Eyebrow>
          <h1 className="s-hero-title">Har bir filialning <RotatingWord /><br />bitta ekranda.</h1>
          <p className="s-hero-lead" data-reveal style={delay(1)}>PHARMEX — savdo, zaxira, kassa, qarz va sof foydani FOM F-APTEKA maʼlumotlari bilan real vaqtda jamlaydigan boshqaruv platformasi. Excel eksport kutmasdan, har bir raqamning manbasini koʻrib qaror qiling.</p>
          <div className="s-hero-ctas" data-reveal style={delay(2)}><PrimaryCta large label="Boshqaruvni boshlash" /><Link href="/imkoniyatlar" className="s-btn ghost lg">Imkoniyatlar <ArrowRight size={17} /></Link></div>
          <div className="s-hero-proof" data-reveal style={delay(3)}>
            <span><ShieldCheck size={15} /> Manbasi koʻrsatilgan raqamlar</span>
            <span><RefreshCw size={15} /> Har 5 daqiqada yangilanadi</span>
            <span><BadgeCheck size={15} /> Kunduzgi va tungi rejim</span>
          </div>
        </div>
        <div className="s-hero-art" data-reveal style={delay(2)}><LiveBoard /></div>
      </div>
    </section>
    <Marquee />
    <BeforeAfter />
    <Stats />
    <Bento />
    <Steps />
    <Explore />
    <CtaBand />
  </>;
}
