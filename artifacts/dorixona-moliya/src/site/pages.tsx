import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, Ban, BadgeCheck, Boxes, Building2, Calculator, Check, ChevronDown, CircleCheck, CircleHelp, Cloud, Crown, Database,
  Eye, FileSpreadsheet, Fingerprint, History, KeyRound, Landmark, Laptop, LayoutDashboard, LockKeyhole, Minus, Network, Pill,
  PlugZap, Receipt, RefreshCw, ScrollText, Search, Server, ShieldCheck, Sparkles, Store, Truck, Undo2, UserCog, Users, Wallet,
  Warehouse, Workflow, X, Zap, type LucideIcon,
} from 'lucide-react';
import { modules } from './content';
import { AnchorLink, CtaBand, FeatureCard, PageHero, PrimaryCta, SectionHead, delay } from './ui';

/* ------------------------------------------------------------------ Imkoniyatlar */

function useScrollSpy(ids: string[]) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    const io = new IntersectionObserver(entries => {
      const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setActive(visible.target.id);
    }, { rootMargin: '-35% 0px -55% 0px' });
    ids.forEach(id => { const el = document.getElementById(id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, [ids]);
  return active;
}

export function FeaturesPage() {
  const ids = useMemo(() => modules.map(m => m.id), []);
  const active = useScrollSpy(ids);
  return <>
    <PageHero eyebrow="IMKONIYATLAR" icon={Sparkles} title="Dorixona moliyasi —" accent="toʻliq sikl bilan." text="Kirimdan sotuvgacha, kassadan sof foydagacha: 10 ta modul bir-biri bilan bogʻlangan, shuning uchun bitta hujjat qoldiqni, pulni va qarzni bir vaqtda yangilaydi." chips={['10 ta modul', 'Filial kesimi', 'Real vaqt', 'Kunduzgi / tungi rejim']}>
      <div className="s-mosaic">{modules.map((m, i) => <span key={m.id} style={{ ['--c' as string]: m.color, ...delay(i, 90) }}><m.icon size={22} /></span>)}</div>
    </PageHero>
    <section className="s-section tight">
      <div className="s-wrap s-modules">
        <aside className="s-spy" aria-label="Modullar">
          {modules.map((m, i) => <AnchorLink key={m.id} href={`#${m.id}`} className={`s-spy-link ${active === m.id ? 'on' : ''}`}><span>{String(i + 1).padStart(2, '0')}</span>{m.title}</AnchorLink>)}
        </aside>
        <div className="s-module-list">
          {modules.map((m, i) => <article key={m.id} id={m.id} className="s-module spot" style={{ ['--c' as string]: m.color }} data-reveal>
            <div className="s-module-head">
              <span className="s-module-icon"><m.icon size={24} /></span>
              <div><span className="s-module-n">{String(i + 1).padStart(2, '0')} · {m.short}</span><h3>{m.title}</h3></div>
            </div>
            <p>{m.text}</p>
            <ul>{m.points.map(p => <li key={p}><Check size={15} />{p}</li>)}</ul>
          </article>)}
        </div>
      </div>
    </section>
    <CtaBand title="Barcha modullar — bitta tizimda, bitta haqiqat." />
  </>;
}

/* ------------------------------------------------------------------ Yechimlar */

type Role = { id: string; icon: LucideIcon; title: string; question: string; pains: string[]; gains: string[]; screens: string[] };
const roles: Role[] = [
  {
    id: 'owner', icon: Crown, title: 'Egasi / rahbar', question: '“Bu oy guruh qancha sof foyda qildi va qaysi filial orqada?”',
    pains: ['Raqamlar har filialdan kech va turli formatda keladi', 'Foyda tannarx va xarajatsiz hisoblanadi', 'Qaror sezgi bilan qabul qilinadi'],
    gains: ['Butun guruh bitta dashboardda, real vaqtda', 'Filiallarni bir xil mezonda solishtirish', 'Sof foyda: qaytarish va xarajatlar bilan', 'Egalar kiritgan va olgan mablagʻ alohida'],
    screens: ['dashboard', 'foyda', 'filiallar'],
  },
  {
    id: 'accountant', icon: Calculator, title: 'Bosh hisobchi', question: '“Kassa, bank va qarzlar hujjatlarga mos keladimi?”',
    pains: ['Kassa va bank alohida jadvallarda', 'Yetkazib beruvchi qarzi daftarda', 'Oy yopilishi kunlab choʻziladi'],
    gains: ['Boshlangʻich / yakuniy qoldiq har bir hisob uchun', 'Kirimdan kreditor qarz avtomatik', 'Har bir pul harakati hujjat bilan', 'Hisobotlar bir xil manbadan'],
    screens: ['pul', 'qarzlar', 'hisobotlar'],
  },
  {
    id: 'manager', icon: Store, title: 'Filial mudiri', question: '“Bugungi savdo, kassa va kam qolgan tovarlar qanday?”',
    pains: ['Smenadagi tushumni qoʻlda sanash', 'Qaytarish va bekor qilish izsiz qoladi', 'Kam qolgan tovar kech bilinadi'],
    gains: ['Filial savdosi toʻlov turlari bilan', 'Qaytarish va bekor qilish sababi bilan', 'Kam qoldiq ogohlantirishlari', 'Inkassatsiya hujjat bilan'],
    screens: ['savdolar', 'pul', 'tovar-harakati'],
  },
  {
    id: 'warehouse', icon: Warehouse, title: 'Omborchi / provizor', question: '“Qaysi partiya qayerda va muddati qachon tugaydi?”',
    pains: ['Oʻtkazmalar telefon orqali kelishiladi', 'Hisobdan chiqarish sababsiz', 'Inventarizatsiya natijasi yoʻqoladi'],
    gains: ['Filiallararo oʻtkazma hujjati', 'Hisobdan chiqarish sababi bilan', 'Inventarizatsiya: kamomad va ortiqcha', 'Partiya va yaroqlilik muddati'],
    screens: ['tovar-harakati', 'kirim', 'malumotnomalar'],
  },
];

const reasons: Array<{ icon: LucideIcon; color: string; title: string; text: string }> = [
  { icon: Pill, color: '#0fb3c7', title: 'Dorixona uchun qurilgan', text: 'QQS narx ichida, partiya, yaroqlilik muddati, nasiya — umumiy dastur emas.' },
  { icon: PlugZap, color: '#1fb84f', title: 'FOM bilan ishlaydi', text: 'Mavjud F-APTEKA dasturini almashtirmaydi — maʼlumotini oʻzi oladi.' },
  { icon: Building2, color: '#1f5fd0', title: 'Koʻp filial', text: 'Har bir dorixona va ombor alohida, guruh esa bitta ekranda.' },
  { icon: ScrollText, color: '#6d4fd8', title: 'Hujjatga asoslangan', text: 'Har bir qoldiq va pul harakati hujjatdan kelib chiqadi — izsiz oʻzgarish yoʻq.' },
  { icon: Eye, color: '#e48a0c', title: 'Manbasi koʻrinadi', text: 'Raqam FOM dan keldimi yoki qoʻlda kiritildimi — har doim belgilanadi.' },
  { icon: Zap, color: '#0b8fa3', title: 'Tez va yengil', text: 'Brauzerda ishlaydi, oʻrnatish shart emas; kompyuter va telefonda.' },
  { icon: ShieldCheck, color: '#179a45', title: 'Rollar va audit', text: 'Kim nima qila olishi va kim nima qilgani nazoratda.' },
  { icon: Sparkles, color: '#e0484f', title: 'Oʻzbek tilida', text: 'Interfeys, atamalar va sana formati — oʻzbekcha, tushunarli.' },
];

type Mark = 'yes' | 'part' | 'no';
const compare: Array<{ label: string; excel: Mark; pos: Mark; px: Mark }> = [
  { label: 'Cheklar va toʻlov turlari', excel: 'no', pos: 'yes', px: 'yes' },
  { label: 'Barcha filiallar bitta ekranda', excel: 'part', pos: 'no', px: 'yes' },
  { label: 'Kassa va bank qoldiqlari', excel: 'part', pos: 'part', px: 'yes' },
  { label: 'Qarzlar muddati bilan', excel: 'part', pos: 'no', px: 'yes' },
  { label: 'Tannarx va sof foyda', excel: 'part', pos: 'no', px: 'yes' },
  { label: 'FOM F-APTEKA bilan avtomatik', excel: 'no', pos: 'no', px: 'yes' },
  { label: 'Rollar va audit jurnali', excel: 'no', pos: 'part', px: 'yes' },
];
const markIcon = (m: Mark) => m === 'yes' ? <span className="s-mark yes"><Check size={14} /></span> : m === 'part' ? <span className="s-mark part"><Minus size={14} /></span> : <span className="s-mark no"><X size={14} /></span>;

export function SolutionsPage() {
  const [roleId, setRoleId] = useState(roles[0].id);
  const role = roles.find(r => r.id === roleId) ?? roles[0];
  return <>
    <PageHero eyebrow="YECHIMLAR" icon={Users} title="Har bir xodimga —" accent="kerakli raqam, oʻz vaqtida." text="PHARMEX guruhdagi har bir rol uchun oʻz savoliga tez javob beradi. Bir xil maʼlumot, lekin har kim oʻziga keraklisini koʻradi." chips={['Rahbar', 'Bosh hisobchi', 'Filial mudiri', 'Omborchi']}>
      <div className="s-roles-art">{roles.map((r, i) => <span key={r.id} style={delay(i, 120)}><r.icon size={20} />{r.title}</span>)}</div>
    </PageHero>

    <section className="s-section tight">
      <div className="s-wrap">
        <div className="s-tabs" role="tablist" data-reveal>
          {roles.map(r => <button key={r.id} role="tab" aria-selected={r.id === roleId} className={r.id === roleId ? 'on' : ''} onClick={() => setRoleId(r.id)}><r.icon size={16} />{r.title}</button>)}
        </div>
        <div className="s-role" key={role.id}>
          <div className="s-role-q"><role.icon size={22} /><p>{role.question}</p></div>
          <div className="s-role-cols">
            <div className="s-role-col pains"><b>Bugungi muammo</b>{role.pains.map((p, i) => <span key={p} style={delay(i, 70)}><X size={14} />{p}</span>)}</div>
            <div className="s-role-col gains"><b>PHARMEX beradi</b>{role.gains.map((g, i) => <span key={g} style={delay(i, 70)}><Check size={14} />{g}</span>)}</div>
            <div className="s-role-col screens"><b>Asosiy boʻlimlar</b>{role.screens.map(id => { const m = modules.find(x => x.id === id)!; return <AnchorLink key={id} href={`/imkoniyatlar#${id}`} className="s-role-screen"><span style={{ ['--c' as string]: m.color }}><m.icon size={16} /></span>{m.title}<ArrowRight size={14} /></AnchorLink>; })}</div>
          </div>
        </div>
      </div>
    </section>

    <section className="s-section">
      <div className="s-wrap">
        <SectionHead eyebrow="NIMA UCHUN AYNAN PHARMEX" title="Sakkiz sabab," accent="bitta natija." text="Aniq raqam — tez qaror. PHARMEX shunga xizmat qiladi." />
        <div className="s-cards four">{reasons.map((r, i) => <FeatureCard key={r.title} i={i} {...r} />)}</div>
      </div>
    </section>

    <section className="s-section">
      <div className="s-wrap">
        <SectionHead center eyebrow="SOLISHTIRING" title="Excel, kassa dasturi" accent="va PHARMEX." />
        <div className="s-compare" data-reveal>
          <div className="s-compare-row head"><span /><span><FileSpreadsheet size={16} /> Excel</span><span><Receipt size={16} /> Kassa dasturi</span><span className="px"><Sparkles size={16} /> PHARMEX</span></div>
          {compare.map((c, i) => <div key={c.label} className="s-compare-row" style={delay(i, 50)}><span>{c.label}</span><span>{markIcon(c.excel)}</span><span>{markIcon(c.pos)}</span><span className="px">{markIcon(c.px)}</span></div>)}
        </div>
      </div>
    </section>
    <CtaBand />
  </>;
}

/* ------------------------------------------------------------------ Qanday ishlaydi */

const timeline: Array<{ icon: LucideIcon; title: string; text: string; tags: string[] }> = [
  { icon: PlugZap, title: 'Ulanish', text: 'Sozlamalarda FOM server IP manzili, port va filial ID larini kiriting va «Saqlash va ulash» ni bosing. FOM boʻlmasa — maʼlumotlarni qoʻlda kiritasiz.', tags: ['5 daqiqa', 'FOM yoki qoʻlda'] },
  { icon: Database, title: 'Maʼlumotnomalar toʻladi', text: 'Filiallar, tovarlar katalogi (IKPU, birlik, QQS) va hamkorlar avtomatik yuklanadi. Takroriy yuklash dublikat yaratmaydi.', tags: ['Filiallar', 'Tovarlar', 'Hamkorlar'] },
  { icon: Truck, title: 'Kirim va zaxira', text: 'Kirim hujjati tannarx va partiya bilan qoldiqqa tushadi; toʻlanmagan qism yetkazib beruvchi qarziga aylanadi.', tags: ['Partiya', 'Kreditor qarz'] },
  { icon: Receipt, title: 'Savdo va qaytarish', text: 'Har bir chek qoldiqni kamaytiradi, pulni kassa yoki bankka yozadi; nasiya — mijoz qarziga. Qaytarish va bekor qilish teskari yozuv qiladi.', tags: ['Chek', 'Qaytarish', 'Nasiya'] },
  { icon: Wallet, title: 'Pul harakati', text: 'Inkassatsiya, hisoblararo oʻtkazma, xarajat, yetkazib beruvchiga toʻlov — har biri kassa va bank qoldigʻini aniq oʻzgartiradi.', tags: ['Kassa', 'Bank', 'Xarajat'] },
  { icon: LayoutDashboard, title: 'Hisobot va qaror', text: 'Dashboard, foyda va zarar, qarzlar va hisobotlar bir xil manbadan olinadi — filial va davr boʻyicha bir bosishda.', tags: ['Foyda', 'Qarzlar', 'Hisobot'] },
];

function Timeline() {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const el = box.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (window.innerHeight * 0.6 - r.top) / r.height));
      el.style.setProperty('--fill', String(p));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, []);
  return <div className="s-timeline" ref={box}>
    <div className="s-timeline-rail" aria-hidden="true"><i /></div>
    {timeline.map((t, i) => <div key={t.title} className={`s-tl-item ${i % 2 ? 'right' : 'left'}`} data-reveal>
      <span className="s-tl-dot"><t.icon size={18} /></span>
      <div className="s-tl-card spot"><span className="s-tl-n">{String(i + 1).padStart(2, '0')}</span><h3>{t.title}</h3><p>{t.text}</p><div className="s-tl-tags">{t.tags.map(g => <span key={g}>{g}</span>)}</div></div>
    </div>)}
  </div>;
}

export function HowPage() {
  const chain: Array<{ icon: LucideIcon; label: string; sub: string }> = [
    { icon: Truck, label: 'Kirim', sub: 'tannarx, partiya' },
    { icon: Boxes, label: 'Qoldiq', sub: 'filial omborida' },
    { icon: Receipt, label: 'Chek', sub: 'savdo, QQS' },
    { icon: Landmark, label: 'Kassa / bank', sub: 'pul harakati' },
    { icon: BadgeCheck, label: 'Sof foyda', sub: 'hisobotda' },
  ];
  const firstDay = ['FOM ulanishini sozlash yoki filiallarni qoʻshish', 'Kassa va bank hisoblarini ochish', 'Boshlangʻich qoldiq va qarzlarni kiritish', 'Xodimlarga rol berish', 'Birinchi davr hisobotini koʻrish'];
  return <>
    <PageHero eyebrow="QANDAY ISHLAYDI" icon={Workflow} title="Bitta hujjat —" accent="hamma joyda toʻgʻri raqam." text="PHARMEX hujjatlar zanjiri asosida ishlaydi: har bir kirim, chek yoki toʻlov qoldiqni, kassani va qarzni bir vaqtda, izchil yangilaydi." chips={['Hujjat zanjiri', 'Teskari yozuv', 'Dublikatsiz import']}>
      <div className="s-chain">{chain.map((c, i) => <div key={c.label} className="s-chain-node" style={delay(i, 160)}><span><c.icon size={18} /></span><b>{c.label}</b><small>{c.sub}</small></div>)}<div className="s-chain-pulse" aria-hidden="true" /></div>
    </PageHero>
    <section className="s-section tight">
      <div className="s-wrap">
        <SectionHead center eyebrow="OLTI BOSQICH" title="Ulanishdan" accent="hisobotgacha." />
        <Timeline />
      </div>
    </section>
    <section className="s-section">
      <div className="s-wrap s-split">
        <div><SectionHead eyebrow="BIRINCHI KUN" title="Ishni boshlash" accent="bir kunda." text="Murakkab joriy etish loyihasi kerak emas. Mana birinchi kunning roʻyxati:" /></div>
        <ol className="s-checklist">{firstDay.map((d, i) => <li key={d} data-reveal style={delay(i, 90)}><span><CircleCheck size={18} /></span>{d}</li>)}</ol>
      </div>
    </section>
    <section className="s-section">
      <div className="s-wrap">
        <div className="s-cards three">
          <FeatureCard i={0} icon={Undo2} color="#e48a0c" title="Oʻchirish yoʻq — teskari yozuv" text="Xato chek oʻchirilmaydi, bekor qilinadi: tovar qoldiqqa, pul kassaga qaytadi va izi qoladi." />
          <FeatureCard i={1} icon={RefreshCw} color="#0fb3c7" title="Dublikatsiz sinxron" text="FOM hujjatlari FOM ID boʻyicha yangilanadi — qayta tortish ikki marta yozmaydi." />
          <FeatureCard i={2} icon={Eye} color="#1f5fd0" title="Manba belgisi" text="Har bir yozuvda u FOM dan kelganmi yoki qoʻlda kiritilganmi — koʻrinib turadi." />
        </div>
      </div>
    </section>
    <CtaBand />
  </>;
}

/* ------------------------------------------------------------------ Integratsiya */

const fomReports: Array<[number, string, string]> = [
  [189, 'Tashkilotlar maʼlumotnomasi', 'Filiallar, yetkazib beruvchilar, mijozlar'],
  [188, 'Tovarlar maʼlumotnomasi', 'Tovarlar: nomi, ishlab chiqaruvchi, IKPU, birlik'],
  [6, 'Joriy qoldiqlar', 'Ombor qoldiqlari, chakana narx, yaroqlilik muddati'],
  [11, 'Omborga kirim (v2)', 'Kirim hujjatlari va tannarx'],
  [12, 'Yetkazib beruvchiga qaytarish (v2)', 'Tovar harakati: qaytarish'],
  [3, 'Hisobdan chiqarish', 'Tovar harakati: hisobdan chiqarish'],
  [14, 'Chakana savdo (v2)', 'Savdolar (cheklar)'],
  [15, 'Sugʻurta savdosi (v2)', 'Savdolar (sugʻurta orqali)'],
];

export function IntegrationPage() {
  const setup: Array<{ icon: LucideIcon; t: string; d: string }> = [
    { icon: Laptop, t: 'REPORT.exe ni ishga tushiring', d: 'F-APTEKA bazasi turgan apteka kompyuterida FOM ning REPORT.exe (SERVICEREPORTS) xizmati ishlab turishi kerak.' },
    { icon: Network, t: 'Tarmoqni bogʻlang', d: 'Server va apteka kompyuteri bitta tarmoqda boʻlsin: lokal tarmoq, Radmin VPN (26.x.x.x) yoki ochiq IP.' },
    { icon: KeyRound, t: 'Sozlamalarni kiriting', d: 'PHARMEX → Sozlamalar → «FOM ulanishi»: IP manzil, port va filial ID lari (masalan 1, 2, 3).' },
    { icon: Zap, t: '«Saqlash va ulash»', d: 'Tizim ulanishni tekshiradi va barcha hisobotlarni tortadi. Keyin har N daqiqada oʻzi yangilaydi.' },
  ];
  return <>
    <PageHero eyebrow="FOM F-APTEKA INTEGRATSIYASI" icon={PlugZap} title="Mavjud dasturingiz qoladi —" accent="maʼlumot oʻzi keladi." text="PHARMEX FOM F-APTEKA bilan REPORT.exe va SITE.exe orqali bogʻlanadi. Kassada hech narsa oʻzgarmaydi; filiallar, tovarlar, qoldiq, kirim va cheklar avtomatik yuklanadi." chips={['REPORT.exe', 'SITE.exe', 'Radmin VPN', 'Har 5 daqiqa']}>
      <div className="s-net">
        <div className="s-net-node a"><Laptop size={20} /><b>Apteka</b><small>F-APTEKA · REPORT.exe</small></div>
        <div className="s-net-link"><i /><i /><i /><span>VPN / tarmoq</span></div>
        <div className="s-net-node b"><Server size={20} /><b>PHARMEX</b><small>server · baza</small></div>
        <div className="s-net-link"><i /><i /><i /><span>HTTPS</span></div>
        <div className="s-net-node c"><LayoutDashboard size={20} /><b>Dashboard</b><small>real vaqt</small></div>
      </div>
    </PageHero>

    <section className="s-section tight">
      <div className="s-wrap">
        <div className="s-cards two">
          <FeatureCard i={0} icon={RefreshCw} color="#0fb3c7" title="REPORT.exe — biz soʻraymiz" text="PHARMEX FOM serveridan P_GetReport_XML orqali 8 ta hisobotni davr va filial boʻyicha tortadi. Maʼlumotnomalar va qoldiqlar toʻliq, hujjatlar tanlangan davr boʻyicha.">
            <div className="s-card-tags"><span>Pull</span><span>8 hisobot</span><span>Avto-interval</span></div>
          </FeatureCard>
          <FeatureCard i={1} icon={Cloud} color="#1fb84f" title="SITE.exe — FOM yuboradi" text="FOM texnigi SETUP.ini ga PHARMEX manzili va tokenini yozadi; SITE.exe qoldiqlarni XML koʻrinishida oʻzi joʻnatadi. Token serverda tekshiriladi.">
            <div className="s-card-tags"><span>Push</span><span>Qoldiqlar</span><span>Token bilan</span></div>
          </FeatureCard>
        </div>
      </div>
    </section>

    <section className="s-section">
      <div className="s-wrap">
        <SectionHead eyebrow="QAYSI MAʼLUMOTLAR KELADI" title="8 ta FOM hisoboti —" accent="8 ta boʻlimga." />
        <div className="s-table" data-reveal>
          <div className="s-table-row head"><span>ID</span><span>FOM hisoboti</span><span>PHARMEX da</span></div>
          {fomReports.map(([id, name, target], i) => <div key={id} className="s-table-row" style={delay(i, 40)}><span><code>{id}</code></span><span>{name}</span><span>{target}</span></div>)}
        </div>
      </div>
    </section>

    <section className="s-section">
      <div className="s-wrap">
        <SectionHead center eyebrow="TOʻRT QADAMDA ULANISH" title="Texnik bilim" accent="shart emas." />
        <div className="s-setup">{setup.map((s, i) => <div key={s.t} className="s-setup-step spot" data-reveal style={delay(i, 110)}><span className="s-setup-n">{i + 1}</span><span className="s-setup-icon"><s.icon size={20} /></span><h3>{s.t}</h3><p>{s.d}</p></div>)}</div>
      </div>
    </section>

    <section className="s-section">
      <div className="s-wrap">
        <div className="s-cards three">
          <FeatureCard i={0} icon={History} color="#6d4fd8" title="Har bir import tarixi" text="Qaysi hisobot nechta qator olib keldi, qaysi biri xato berdi — Sozlamalar sahifasida koʻrinadi." />
          <FeatureCard i={1} icon={LockKeyhole} color="#0b8fa3" title="Kalitlar serverda" text="Server manzili va tokenlar faqat serverda saqlanadi; brauzerga toʻliq chiqarilmaydi." />
          <FeatureCard i={2} icon={Building2} color="#1f5fd0" title="Barcha filiallar" text="Filial ID lari vergul bilan kiritiladi yoki avtomatik aniqlanadi — har biri alohida yuklanadi." />
        </div>
      </div>
    </section>
    <CtaBand title="FOM ni ulang — maʼlumotlar bugunoq kelsin." text="Sozlamalar sahifasida IP, port va filial ID larini kiriting va «Saqlash va ulash» ni bosing." />
  </>;
}

/* ------------------------------------------------------------------ Xavfsizlik */

export function SecurityPage() {
  const pillars: Array<{ icon: LucideIcon; color: string; title: string; text: string }> = [
    { icon: UserCog, color: '#1f5fd0', title: 'Rollar va ruxsatlar', text: 'Administrator, moliya xodimi va kuzatuvchi — har biri faqat oʻziga ruxsat etilgan amallarni bajaradi.' },
    { icon: History, color: '#6d4fd8', title: 'Audit jurnali', text: 'Muhim amallar — kim, qachon va nima qilgani bilan jurnalga yoziladi.' },
    { icon: Ban, color: '#e0484f', title: 'Izsiz oʻchirish yoʻq', text: 'Hujjatlar oʻchirilmaydi, bekor qilinadi: teskari yozuv qoldiq va pulni tiklaydi, iz saqlanadi.' },
    { icon: Fingerprint, color: '#0fb3c7', title: 'Parollar xeshlanadi', text: 'Parollar scrypt bilan xeshlangan holda saqlanadi; ochiq matnda hech qayerda turmaydi.' },
    { icon: LockKeyhole, color: '#1fb84f', title: 'Himoyalangan sessiya', text: 'Imzolangan, httpOnly cookie — skriptlar sessiyani oʻqiy olmaydi.' },
    { icon: KeyRound, color: '#e48a0c', title: 'Kalitlar serverda', text: 'FOM tokenlari va server manzillari brauzerga toʻliq chiqarilmaydi.' },
  ];
  const matrix: Array<[string, Mark, Mark, Mark]> = [
    ['Dashboard va hisobotlarni koʻrish', 'yes', 'yes', 'yes'],
    ['Cheklar, kirim, tovar hujjatlari', 'yes', 'yes', 'no'],
    ['Kassa, bank va qarz operatsiyalari', 'yes', 'yes', 'no'],
    ['FOM sinxronini ishga tushirish', 'yes', 'yes', 'no'],
    ['FOM ulanish sozlamalarini oʻzgartirish', 'yes', 'no', 'no'],
    ['Filial qoʻshish va foydalanuvchilar', 'yes', 'no', 'no'],
  ];
  return <>
    <PageHero eyebrow="XAVFSIZLIK" icon={ShieldCheck} title="Moliyaviy maʼlumot —" accent="ishonchli qoʻllarda." text="Pul va qoldiq bilan ishlaydigan tizimda eng muhimi — kim nima qilganini bilish va izsiz oʻzgarishga yoʻl qoʻymaslik. PHARMEX shu tamoyilda qurilgan." chips={['Rollar', 'Audit', 'Teskari yozuv', 'scrypt']}>
      <div className="s-shield"><i className="r1" /><i className="r2" /><i className="r3" /><span><ShieldCheck size={46} /></span></div>
    </PageHero>
    <section className="s-section tight">
      <div className="s-wrap"><div className="s-cards three">{pillars.map((p, i) => <FeatureCard key={p.title} i={i} {...p} />)}</div></div>
    </section>
    <section className="s-section">
      <div className="s-wrap">
        <SectionHead eyebrow="RUXSATLAR MATRITSASI" title="Har kim —" accent="oʻz vakolatida." />
        <div className="s-compare roles" data-reveal>
          <div className="s-compare-row head"><span /><span><Crown size={16} /> Administrator</span><span><Calculator size={16} /> Moliya xodimi</span><span><Eye size={16} /> Kuzatuvchi</span></div>
          {matrix.map(([label, a, f, v], i) => <div key={label} className="s-compare-row" style={delay(i, 50)}><span>{label}</span><span>{markIcon(a)}</span><span>{markIcon(f)}</span><span>{markIcon(v)}</span></div>)}
        </div>
      </div>
    </section>
    <section className="s-section">
      <div className="s-wrap s-split">
        <SectionHead eyebrow="BEKOR QILISH QANDAY ISHLAYDI" title="Xato tuzatiladi," accent="tarix qoladi." text="Chek bekor qilinsa, tizim uni oʻchirmaydi. Teskari yozuvlar tovarni qoldiqqa, pulni kassaga qaytaradi, nasiya qarzini yopadi — va kim, qachon, nima sababdan bekor qilgani saqlanadi." />
        <div className="s-void">
          {[
            { icon: Receipt, t: 'Chek #10482 yaratildi', d: '3-filial · 184 500 soʻm · Naqd', c: '#1fb84f' },
            { icon: Ban, t: 'Bekor qilindi', d: 'Sabab: notoʻgʻri tovar · admin · 14:32', c: '#e0484f' },
            { icon: Undo2, t: 'Teskari yozuvlar', d: 'Qoldiq +2 · Kassa −184 500', c: '#e48a0c' },
            { icon: ScrollText, t: 'Audit jurnalida', d: 'Hujjat va tarix saqlangan', c: '#6d4fd8' },
          ].map((s, i) => <div key={s.t} className="s-void-row" data-reveal style={{ ...delay(i, 120), ['--c' as string]: s.c }}><span><s.icon size={16} /></span><div><b>{s.t}</b><small>{s.d}</small></div></div>)}
        </div>
      </div>
    </section>
    <CtaBand title="Ishonchli raqamlar bilan boshqaring." />
  </>;
}

/* ------------------------------------------------------------------ Savollar */

const faqs: Array<{ cat: string; q: string; a: string }> = [
  { cat: 'Umumiy', q: 'PHARMEX nima?', a: 'Dorixona guruhlari uchun moliyaviy boshqaruv platformasi: savdo, kirim, zaxira harakati, kassa va bank, qarzlar, foyda va zarar hamda hisobotlarni filiallar kesimida bitta joyda yuritadi.' },
  { cat: 'Umumiy', q: 'FOM F-APTEKA ni almashtirish kerakmi?', a: 'Yoʻq. PHARMEX FOM ni almashtirmaydi — uning maʼlumotlarini REPORT.exe va SITE.exe orqali oladi. Kassada odatdagidek F-APTEKA ishlaydi, rahbariyat esa PHARMEX da umumiy manzarani koʻradi.' },
  { cat: 'Umumiy', q: 'Qaysi qurilmalarda ishlaydi?', a: 'Brauzer orqali — kompyuter, planshet va telefonda. Hech narsa oʻrnatish shart emas. Kunduzgi va tungi rejim mavjud.' },
  { cat: 'Integratsiya', q: 'FOM ni qanday ulayman?', a: 'Apteka kompyuterida REPORT.exe ishlab turishi kerak. Sozlamalar → «FOM ulanishi» boʻlimida server IP manzili, port va filial ID larini kiritib «Saqlash va ulash» ni bosing — tizim ulanishni tekshiradi va maʼlumotni tortadi.' },
  { cat: 'Integratsiya', q: 'Maʼlumotlar qanchalik tez yangilanadi?', a: 'Avto-yangilash oraligʻi sozlamalarda belgilanadi (masalan har 5 daqiqada). Maʼlumotnomalar alohida, kamroq yangilanadi. Istalgan vaqtda «Yangilash» tugmasi bilan qoʻlda ham tortish mumkin.' },
  { cat: 'Integratsiya', q: 'Qayta tortsam dublikat paydo boʻladimi?', a: 'Yoʻq. FOM hujjatlari FOM ID boʻyicha yangilanadi, shuning uchun bir davrni qayta-qayta tortish ikki marta yozmaydi.' },
  { cat: 'Integratsiya', q: 'Apteka kompyuteri boshqa joyda boʻlsa-chi?', a: 'Server apteka kompyuteriga tarmoq orqali yetib borishi kerak: lokal tarmoq, Radmin VPN (26.x.x.x manzil) yoki ochiq IP. Sozlamalarga oʻsha manzil kiritiladi.' },
  { cat: 'Hisob', q: 'Qaytarish va bekor qilish foydaga taʼsir qiladimi?', a: 'Ha. Qaytarilgan va bekor qilingan cheklar savdo, tannarx va foydadan chiqariladi; pul va qoldiq teskari yozuv bilan tiklanadi.' },
  { cat: 'Hisob', q: 'QQS qanday hisoblanadi?', a: 'Tovar kartasidagi QQS stavkasi (0%, 12% yoki 15%) boʻyicha QQS narx ichida ajratib koʻrsatiladi.' },
  { cat: 'Hisob', q: 'Nasiya savdo qanday yuritiladi?', a: 'Chekda «Nasiya» toʻlov turi tanlansa, summa mijoz qarziga yoziladi. Toʻlov kelganda qarz qisman yoki toʻliq yopiladi, tarix saqlanadi.' },
  { cat: 'Xavfsizlik', q: 'Kim nima qila oladi?', a: 'Administrator hamma narsani boshqaradi, moliya xodimi hujjat va pul operatsiyalarini yuritadi, kuzatuvchi esa faqat koʻradi.' },
  { cat: 'Xavfsizlik', q: 'Xato kiritilgan hujjatni oʻchirsa boʻladimi?', a: 'Hujjatlar oʻchirilmaydi, bekor qilinadi. Bu tarixni saqlaydi va hisob-kitobni buzilishdan himoya qiladi.' },
];

export function FaqPage() {
  const cats = ['Barchasi', ...Array.from(new Set(faqs.map(f => f.cat)))];
  const [cat, setCat] = useState('Barchasi');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(faqs[0].q);
  const shown = faqs.filter(f => (cat === 'Barchasi' || f.cat === cat) && `${f.q} ${f.a}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <>
    <PageHero eyebrow="SAVOLLAR" icon={CircleHelp} title="Savolingiz bormi?" accent="Javob shu yerda." text="PHARMEX, FOM integratsiyasi, hisob-kitob va xavfsizlik boʻyicha eng koʻp beriladigan savollar." />
    <section className="s-section tight">
      <div className="s-wrap s-faq-wrap">
        <div className="s-faq-tools" data-reveal>
          <label className="s-faq-search"><Search size={17} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Savol boʻyicha qidirish…" data-testid="input-faq-search" /></label>
          <div className="s-faq-cats">{cats.map(c => <button key={c} className={c === cat ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}</div>
        </div>
        <div className="s-faq">
          {shown.map(f => {
            const isOpen = open === f.q;
            return <div key={f.q} className={`s-faq-item ${isOpen ? 'open' : ''}`}>
              <button onClick={() => setOpen(isOpen ? null : f.q)} aria-expanded={isOpen}><span className="s-faq-cat">{f.cat}</span><b>{f.q}</b><ChevronDown size={18} /></button>
              <div className="s-faq-a"><div><p>{f.a}</p></div></div>
            </div>;
          })}
          {!shown.length && <div className="s-faq-empty">Hech narsa topilmadi. Boshqa soʻz bilan qidirib koʻring.</div>}
        </div>
        <div className="s-faq-help" data-reveal>
          <span><Sparkles size={20} /></span>
          <div><b>Javob topilmadimi?</b><p>Tizimga kiring va Sozlamalar sahifasidagi holatni tekshiring yoki administratoringizga murojaat qiling.</p></div>
          <PrimaryCta />
        </div>
      </div>
    </section>
    <CtaBand />
  </>;
}