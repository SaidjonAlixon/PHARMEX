import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertCircle, ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, BarChart3, Boxes, Building2,
  Check, ChevronDown, CircleHelp, ClipboardList, Clock3, Download, FileBarChart2, Filter, Landmark, LogOut,
  Menu, PackageSearch, Plus, RefreshCw, Search, Settings2, ShieldCheck, Wallet, X
} from 'lucide-react';
import {
  useGetDashboard, getGetDashboardQueryKey, useListBranches, getListBranchesQueryKey, useCreateBranch,
  useGetBranch, getGetBranchQueryKey, useListSales, getListSalesQueryKey, useListInventory,
  getListInventoryQueryKey, useGetProduct, getGetProductQueryKey, useListExpenses,
  getListExpensesQueryKey, useCreateExpense, useListCashAccounts, getListCashAccountsQueryKey,
  useListMoneyTransactions, getListMoneyTransactionsQueryKey, useListDebts, getListDebtsQueryKey,
  useGetReport, getGetReportQueryKey, useGetFomStatus, getGetFomStatusQueryKey,
  useSaveFomSettings, useTestFomConnection, useSyncFom,
} from '@workspace/api-client-react';
import type { Branch, Dashboard, Expense, InventoryItem, Sale, Debt } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter, Redirect, Link } from 'wouter';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const stripBase = (path: string) => basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
const appearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: { logoPlacement: 'inside' as const, logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
  variables: {
    colorPrimary: '#176b4a', colorForeground: '#18352b', colorMutedForeground: '#687b72',
    colorDanger: '#bd3a32', colorBackground: '#ffffff', colorInput: '#f8faf8',
    colorInputForeground: '#18352b', colorNeutral: '#dce5df', fontFamily: 'DM Sans',
    borderRadius: '0.75rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center', cardBox: 'bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none', footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#18352b] font-bold', headerSubtitle: 'text-[#687b72]',
    socialButtonsBlockButtonText: 'text-[#18352b]', formFieldLabel: 'text-[#244538]',
    footerActionLink: 'text-[#176b4a]', footerActionText: 'text-[#687b72]', dividerText: 'text-[#687b72]',
    identityPreviewEditButton: 'text-[#176b4a]', formFieldSuccessText: 'text-[#176b4a]', alertText: 'text-[#18352b]',
    logoBox: 'mb-3', logoImage: 'rounded-lg', socialButtonsBlockButton: 'border-[#dce5df]',
    formButtonPrimary: 'bg-[#176b4a] hover:bg-[#10583b]', formFieldInput: 'border-[#dce5df] bg-[#f8faf8]',
    footerAction: 'bg-transparent', dividerLine: 'bg-[#dce5df]', alert: 'border-[#e7b95c]',
    otpCodeFieldInput: 'border-[#dce5df]', formFieldRow: 'text-[#18352b]', main: 'text-[#18352b]',
  },
};

type Filters = { dateFrom: string; dateTo: string; branchId: string };
const today = new Date().toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 8)}01`;
const navItems = [
  { href: '/', label: 'Bosh dashboard', icon: BarChart3 },
  { href: '/branches', label: 'Filiallar', icon: Building2 },
  { href: '/trade', label: 'Savdo va zaxira', icon: Boxes },
  { href: '/finance', label: 'Moliya', icon: Wallet },
  { href: '/debts', label: 'Qarzlar', icon: ArrowUpRight },
  { href: '/profit', label: 'Foyda va zarar', icon: Activity },
  { href: '/reports', label: 'Hisobotlar', icon: FileBarChart2 },
  { href: '/settings', label: 'Sozlamalar', icon: Settings2 },
];

function money(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('uz-UZ', { maximumFractionDigits: 2 }).format(n);
}
function date(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat('uz-UZ', { day: '2-digit', month: 'short', year: 'numeric' }).format(d);
}
function sourceText(value?: string) { return value === 'demo' ? 'Sinov maʼlumoti' : value === 'fom' ? 'FOM' : value === 'manual' ? 'Qoʻlda kiritilgan' : '—'; }

function DataState({ loading, error, empty, retry }: { loading: boolean; error?: boolean; empty: boolean; retry: () => void }) {
  if (loading) return <div className="state-box" data-testid="state-loading"><div className="skeleton-line wide" /><div className="skeleton-line" /><div className="skeleton-line short" /><span>Maʼlumotlar yuklanmoqda</span></div>;
  if (error) return <div className="state-box state-error" data-testid="state-error"><AlertCircle size={22} /><strong>Maʼlumotlarni olib boʻlmadi</strong><span>Ulanishni tekshirib, qayta urinib koʻring.</span><button className="button secondary" onClick={retry} data-testid="button-retry"><RefreshCw size={15} /> Qayta urinish</button></div>;
  if (empty) return <div className="state-box" data-testid="state-empty"><PackageSearch size={25} /><strong>Hozircha maʼlumot yoʻq</strong><span>Tanlangan davr yoki filial boʻyicha yozuv topilmadi. Bu qiymat nol degani emas.</span></div>;
  return null;
}

function StatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'good' | 'warn' | 'bad' | 'neutral' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function DataMode({ mode }: { mode?: string }) {
  return mode === 'demo' ? <div className="demo-ribbon" data-testid="status-demo-mode"><span className="demo-dot" /> SINOV REJIMI <span className="demo-copy">— ekrandagi maʼlumotlar namuna sifatida berilgan</span></div> : null;
}
function PageHeading({ eyebrow, title, subtitle, actions }: { eyebrow?: string; title: string; subtitle?: string; actions?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow || 'MOLIYAVIY BOSHQARUV'}</div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{actions && <div className="heading-actions">{actions}</div>}</div>;
}
function Panel({ title, subtitle, action, children, className = '' }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}><div className="panel-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>{children}</section>;
}
function Metric({ label, value, unit = 'soʻm', trend, icon: Icon }: { label: string; value: string | null | undefined; unit?: string; trend?: string; icon: typeof Wallet }) {
  return <div className="metric-card"><div className="metric-top"><span>{label}</span><span className="metric-icon"><Icon size={17} /></span></div><div className="metric-value">{value == null ? '—' : money(value)}</div><div className="metric-foot"><span>{value == null ? 'Maʼlumot yetarli emas' : unit}</span>{trend && <span className="positive">{trend}</span>}</div></div>;
}
function TableWrap({ children }: { children: ReactNode }) { return <div className="table-scroll"><table>{children}</table></div>; }

function Shell({ children, filters, setFilters }: { children: ReactNode; filters: Filters; setFilters: (v: Filters) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [location] = useLocation();
  const branchesQuery = useListBranches();
  const branches = branchesQuery.data || [];
  const selectedLabel = branches.find(b => String(b.id) === filters.branchId)?.name;
  const { user } = useUser();
  const { signOut } = useClerk();
  const [period, setPeriod] = useState('this-month');
  const choosePeriod = (value: string) => {
    setPeriod(value);
    const now = new Date();
    const end = now.toISOString().slice(0, 10);
    const start = value === 'this-month' ? `${end.slice(0, 8)}01` : value === 'last-month' ? new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10) : value === '7-days' ? new Date(now.getTime() - 6 * 86400000).toISOString().slice(0, 10) : '';
    const rangeEnd = value === 'last-month' ? new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10) : end;
    setFilters({ ...filters, dateFrom: start, dateTo: rangeEnd });
  };
  return <div className="app-shell">
    <aside className={`sidebar ${menuOpen ? 'is-open' : ''}`}>
      <Link href="/" className="brand-lockup" data-testid="link-brand"><span className="brand-mark"><span>+</span></span><span className="brand-name">dorixona<span>hisob</span></span></Link>
      <div className="workspace-label">MOLIYA MARKAZI</div>
      <nav className="primary-nav" aria-label="Asosiy navigatsiya">{navItems.map(item => {
        const active = item.href === '/' ? location === '/' : location === item.href || location.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return <Link key={item.href} href={item.href} className={`nav-link ${active ? 'active' : ''}`} onClick={() => setMenuOpen(false)} data-testid={`link-nav-${item.href.slice(1) || 'dashboard'}`}><Icon size={18} strokeWidth={1.9} /><span>{item.label}</span>{active && <span className="nav-indicator" />}</Link>;
      })}</nav>
      <div className="sidebar-bottom"><div className="reconcile-note"><ShieldCheck size={17} /><div><b>Yagona manba</b><span>Har bir raqam izchil manbaga bogʻlangan</span></div></div><div className="profile-mini"><div className="avatar">{(user?.firstName || user?.primaryEmailAddress?.emailAddress || 'M').slice(0, 1).toUpperCase()}</div><div className="profile-text"><b>{user?.fullName || 'Moliya mutaxassisi'}</b><span>{user?.primaryEmailAddress?.emailAddress || 'Dorixona guruhi'}</span></div><button title="Tizimdan chiqish" onClick={() => signOut({ redirectUrl: basePath || '/' })} className="icon-button" data-testid="button-sign-out"><LogOut size={16} /></button></div></div>
    </aside>
    {menuOpen && <button className="mobile-shade" onClick={() => setMenuOpen(false)} aria-label="Menyuni yopish" />}
    <main className="main-area">
      <header className="topbar"><button className="mobile-menu icon-button" onClick={() => setMenuOpen(!menuOpen)} data-testid="button-menu"><Menu size={20} /></button><div className="crumb"><span>Hisob markazi</span><ArrowRight size={13} /><strong>{navItems.find(n => n.href === location || (n.href !== '/' && location.startsWith(n.href)))?.label || 'Filial maʼlumoti'}</strong></div><div className="top-actions"><label className="filter-control"><span>DAVR</span><select aria-label="Davr" value={period} onChange={e => choosePeriod(e.target.value)} data-testid="select-global-period"><option value="this-month">Joriy oy</option><option value="last-month">Oʻtgan oy</option><option value="7-days">Soʻnggi 7 kun</option><option value="custom">Barcha davr</option></select><ChevronDown size={13} /></label><label className="filter-control branch-control"><span>FILIAL</span><select aria-label="Filial" value={filters.branchId} onChange={e => setFilters({ ...filters, branchId: e.target.value })} data-testid="select-global-branch"><option value="">Barcha filiallar</option>{branches.map((b: Branch) => <option key={b.id} value={b.id}>{b.name}</option>)}</select><ChevronDown size={13} /></label><span className="header-avatar">{(user?.firstName || 'M').slice(0, 1).toUpperCase()}</span></div></header>
    {selectedLabel && <div className="active-scope"><Filter size={13} /> Koʻrinish: <b>{selectedLabel}</b><button onClick={() => setFilters({ ...filters, branchId: '' })} data-testid="button-clear-branch">Filialni tozalash</button></div>}
      <div className="content-area">{branches.some(b => b.source === 'demo') && location !== '/' && location !== '/profit' && location !== '/reports' && (!location.startsWith('/branches/') || location === '/branches') && <DataMode mode="demo" />}{children}</div>
      <footer className="app-footer"><span>Dorixona Hisob <span className="footer-dot">/</span> Moliyaviy boshqaruv</span><span>Maʼlumotlar manbasi va yangilanish vaqti har bir boʻlimda koʻrsatiladi</span></footer>
    </main>
  </div>;
}

function SignInPage() { return <div className="auth-screen"><div className="auth-intro"><Link href="/" className="brand-lockup"><span className="brand-mark"><span>+</span></span><span className="brand-name">dorixona<span>hisob</span></span></Link><span className="eyebrow">FILIALDAN GURUHGACHA</span><h1>Hisobingizga<br />aniq nazar.</h1><p>Savdo, zaxira va pul oqimlari bitta ishonchli manzilda.</p></div><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div>; }
function SignUpPage() { return <div className="auth-screen"><div className="auth-intro"><Link href="/" className="brand-lockup"><span className="brand-mark"><span>+</span></span><span className="brand-name">dorixona<span>hisob</span></span></Link><span className="eyebrow">BOSHQARUVNI BIRLASHTIRING</span><h1>Yagona tizim.<br />Aniq qarorlar.</h1><p>Guruhingiz moliyasini filiallar kesimida kuzating.</p></div><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div>; }
function Landing() {
  return <div className="landing"><header className="landing-nav"><Link href="/" className="brand-lockup"><span className="brand-mark"><span>+</span></span><span className="brand-name">dorixona<span>hisob</span></span></Link><span className="landing-tag"><span className="online-dot" /> FILIALLAR UCHUN MOLIYAVIY MARKAZ</span><div><Link href="/sign-in" className="button ghost" data-testid="link-sign-in">Kirish</Link><Link href="/sign-up" className="button primary" data-testid="link-sign-up">Hisob ochish <ArrowRight size={15} /></Link></div></header>
    <section className="landing-hero"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line" /> DORIXONA GURUHLARI UCHUN</div><h1>Har bir filial.<br /><em>Bir xil aniqlik.</em></h1><p>Savdo, zaxira, naqd pul, qarz va foyda — tarqoq eksportlar emas, bitta izchil moliyaviy boshqaruv markazida.</p><div className="hero-ctas"><Link href="/sign-up" className="button primary large" data-testid="link-hero-start">Boshqaruvni boshlash <ArrowRight size={17} /></Link><Link href="/sign-in" className="text-link" data-testid="link-hero-sign-in">Hisobimga kirish <ArrowRight size={15} /></Link></div><div className="hero-proof"><ShieldCheck size={16} /><span>Manbasi koʻrsatilgan raqamlar. Yashirin hisob-kitob yoʻq.</span></div></div>
      <div className="hero-visual"><div className="visual-kicker"><span>GURUH KOʻRINISHI</span><span>BUGUN <span className="online-dot" /></span></div><div className="visual-title"><span>Moliyaviy holat</span><span className="visual-period">Joriy oy <ChevronDown size={12} /></span></div><div className="visual-metric"><div><span>Sof savdo</span><b>· · · · · ·</b></div><div><span>Yalpi foyda</span><b>· · · · · ·</b></div></div><div className="visual-chart"><div className="chart-lines"><span /><span /><span /><span /></div><svg viewBox="0 0 520 150" preserveAspectRatio="none" aria-hidden="true"><path d="M0 122 C38 118 45 100 82 106 S133 82 170 90 S218 44 260 65 S316 74 348 47 S404 62 435 30 S488 47 520 12" fill="none" stroke="#3f9971" strokeWidth="3" /><path d="M0 145 C50 137 66 136 98 125 S151 126 180 110 S235 121 268 101 S310 115 352 90 S405 101 444 76 S487 87 520 61" fill="none" stroke="#dbb35c" strokeWidth="2" strokeDasharray="5 6" /></svg><div className="visual-months"><span>1-hafta</span><span>2-hafta</span><span>3-hafta</span><span>4-hafta</span></div></div><div className="visual-branches"><span>Filiallar holati</span><div><span className="branch-bars"><i style={{ width: '78%' }} /><i style={{ width: '62%' }} /><i style={{ width: '48%' }} /></span><span>bir koʻrinishda</span></div></div><div className="visual-stamp"><ShieldCheck size={15} /> HAR BIR RAQAM MANBASI BILAN</div></div></section>
    <section className="landing-strip"><div><span className="strip-n">01</span><span>Filiallar kesimida nazorat</span></div><div><span className="strip-n">02</span><span>Savdodan sof foydagacha</span></div><div><span className="strip-n">03</span><span>Izchil va kuzatiladigan maʼlumotlar</span></div></section>
    <section className="landing-story"><div className="eyebrow">TARQOQ HISOBDAN — ANIQ NAZORATGA</div><h2>Bir xil raqam.<br /><span>Bir xil haqiqat.</span></h2><p>Filiallar turli eksport yuborganda, guruh boʻyicha qarorlar taxminga aylanadi. Dorixona Hisob mavjud manbalarni bir joyga jamlaydi, har bir raqamning kelib chiqishini ochiq koʻrsatadi.</p><Link href="/sign-up" className="text-link" data-testid="link-story-start">Platformaga qoʻshilish <ArrowRight size={15} /></Link></section>
    <section className="landing-steps"><div className="step-intro"><span className="eyebrow">ANIQ ISH JARAYONI</span><h2>Harakatdan<br />natijagacha.</h2></div><div className="step-list"><div className="step"><span>01</span><div><b>Filiallarni bogʻlang</b><p>Guruh tarkibini boshqarib, har bir filial uchun masʼuliyatni belgilang.</p></div><Building2 /></div><div className="step"><span>02</span><div><b>Maʼlumotni jamlang</b><p>Savdo, zaxira, xarajat va pul harakatlari bir izchil manbada.</p></div><RefreshCw /></div><div className="step"><span>03</span><div><b>Dalil bilan qaror qiling</b><p>Foyda, qarzdorlik va filiallar holatini bir xil mezonda solishtiring.</p></div><BarChart3 /></div></div></section>
    <section className="landing-cta"><div><span className="eyebrow">DORIXONA GURUHI MOLIYASINI BIRLASHTIRING</span><h2>Bugun nazoratni qoʻlga oling.</h2></div><Link href="/sign-up" className="button light-button" data-testid="link-footer-signup">Hisob ochish <ArrowRight size={16} /></Link></section>
    <footer className="landing-footer"><Link href="/" className="brand-lockup"><span className="brand-mark"><span>+</span></span><span className="brand-name">dorixona<span>hisob</span></span></Link><span>Filial moliyasining yagona manzili.</span><span>© {new Date().getFullYear()} Dorixona Hisob</span></footer>
  </div>;
}

function ChartLine({ data, valueKey, secondaryKey }: { data: Dashboard['salesTrend']; valueKey: 'sales'; secondaryKey?: 'cost' }) {
  if (!data?.length) return <div className="chart-empty"><PackageSearch size={21} /> Davr boʻyicha trend yoʻq</div>;
  const nums = data.map(d => Number(d[valueKey]) || 0).concat(secondaryKey ? data.map(d => Number(d[secondaryKey]) || 0) : []);
  const max = Math.max(...nums, 1);
  const points = data.map((d, i) => `${data.length === 1 ? 50 : i / (data.length - 1) * 100},${100 - Number(d[valueKey]) / max * 84}`).join(' ');
  const points2 = secondaryKey ? data.map((d, i) => `${data.length === 1 ? 50 : i / (data.length - 1) * 100},${100 - Number(d[secondaryKey!]) / max * 84}`).join(' ') : '';
  return <div className="chart-area"><div className="chart-labels"><span>{money(max)} soʻm</span><span>{money(max * .5)} soʻm</span><span>0</span></div><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Savdo dinamikasi"><polyline points={points} fill="none" stroke="#176b4a" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />{secondaryKey && <polyline points={points2} fill="none" stroke="#d7a33c" strokeWidth="1.8" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />}</svg><div className="chart-xlabels">{data.map((p, i) => <span key={`${p.label}-${i}`}>{p.label}</span>)}</div></div>;
}
function DashboardPage({ filters }: { filters: Filters }) {
  const params = { dateFrom: filters.dateFrom || undefined, dateTo: filters.dateTo || undefined, branchId: filters.branchId ? Number(filters.branchId) : undefined };
  const q = useGetDashboard(params);
  const d = q.data;
  return <><DataMode mode={d?.mode} /><PageHeading eyebrow="UMUMIY KOʻRINISH" title="Bosh dashboard" subtitle={`Moliyaviy holat • ${date(filters.dateFrom)} — ${date(filters.dateTo)}`} actions={<span className="updated-stamp"><Clock3 size={14} /> Yangilandi: {d ? date(d.updatedAt) : '—'}</span>} />
    <DataState loading={q.isLoading} error={q.isError} empty={!q.isLoading && !q.isError && (!d || d.mode === 'empty')} retry={() => q.refetch()} />
    {d && d.mode !== 'empty' && <><div className="metric-grid">
      <Metric label="Sotuv hajmi" value={d.totals.sales} trend={d.completeness === 'complete' ? 'Hisobot toʻliq' : undefined} icon={ArrowUpRight} />
      <Metric label="Yalpi foyda" value={d.totals.grossProfit} icon={Activity} />
      <Metric label="Xarajatlar" value={d.totals.expenses} icon={ClipboardList} />
      <Metric label="Pul qoldigʻi" value={d.totals.cashBalance} icon={Wallet} />
      <Metric label="Tovar zaxirasi" value={d.totals.inventoryValue} icon={Boxes} />
      <Metric label="Muddati oʻtgan qarz" value={d.totals.overdueDebt} icon={Clock3} />
    </div><div className="dash-grid"><Panel title="Savdo va tannarx dinamikasi" subtitle="Davr boʻyicha soʻmda" action={<span className="chart-legend"><i className="legend-green" /> Savdo <i className="legend-amber" /> Tannarx</span>}><ChartLine data={d.salesTrend} valueKey="sales" secondaryKey="cost" /></Panel><Panel title="Eʼtibor talab qiladi" subtitle="Manba maʼlumotlariga asoslangan ogohlantirishlar">{d.alerts.length ? <div className="alert-list">{d.alerts.map(a => <div className="alert-row" key={a.id} data-testid={`alert-item-${a.id}`}><span className={`alert-icon ${a.severity}`}><AlertCircle size={17} /></span><div><b>{a.title}</b><p>{a.description}</p><small>{a.target}</small></div><ArrowRight size={15} /></div>)}</div> : <div className="inline-empty"><Check size={17} /> Faol ogohlantirishlar yoʻq</div>}</Panel></div>
      <div className="dash-grid lower"><Panel title="Filiallar taqqoslanishi" subtitle="Savdo, foyda va pul holati"><TableWrap><thead><tr><th>FILIAL</th><th>SAVDO</th><th>YALPI FOYDA</th><th>SOF FOYDA</th><th>PUL QOLDIGʻI</th></tr></thead><tbody>{d.branchComparison.map(b => <tr key={b.id}><td><Link href={`/branches/${b.id}`} className="table-main-link" data-testid={`link-branch-${b.id}`}>{b.name}<ArrowRight size={13} /></Link><small>{date(b.updatedAt)}</small></td><td>{money(b.sales)}</td><td>{money(b.grossProfit)}</td><td className={b.netProfit == null ? 'missing' : 'positive'}>{money(b.netProfit)}</td><td>{money(b.cashBalance)}</td></tr>)}</tbody></TableWrap>{!d.branchComparison.length && <div className="inline-empty">Filial taqqoslash maʼlumoti yoʻq</div>}</Panel><Panel title="Xarajatlar tarkibi" subtitle="Kategoriya boʻyicha taqsimot">{d.expenseBreakdown.length ? <div className="breakdown-list">{d.expenseBreakdown.map((x, i) => <div className="breakdown-row" key={`${x.label}-${i}`}><div><span>{x.label}</span><b>{money(x.value)} soʻm</b></div><div className="bar-track"><i style={{ width: `${Math.max(3, Number(x.value) / Math.max(1, ...d.expenseBreakdown.map(z => Number(z.value))) * 100)}%` }} /></div></div>)}</div> : <div className="inline-empty">Tarkib maʼlumoti mavjud emas</div>}</Panel></div>
      <div className="dash-grid lower"><Panel title="Eng koʻp sotilgan mahsulotlar" subtitle="Davr ichida sotilgan miqdor"><TableWrap><thead><tr><th>MAHSULOT</th><th>MIQDOR</th><th>SAVDO</th><th>YALPI FOYDA</th></tr></thead><tbody>{d.topProducts.map(p => <tr key={p.productId}><td><Link className="table-main-link" href={`/trade/product/${p.productId}`} data-testid={`link-product-${p.productId}`}>{p.name}<ArrowRight size={13} /></Link></td><td>{p.quantity}</td><td>{money(p.sales)}</td><td className={p.grossProfit == null ? 'missing' : 'positive'}>{money(p.grossProfit)}</td></tr>)}</tbody></TableWrap>{!d.topProducts.length && <div className="inline-empty">Mahsulot maʼlumoti yoʻq</div>}</Panel><Panel title="Pul oqimi" subtitle="Tushum va chiqimlar"><div className="flow-list">{d.moneyFlow.map((p,i) => <div className="flow-row" key={`${p.label}-${i}`}><span>{p.label}</span><span className="positive"><ArrowDownLeft size={14} /> {money(p.inflow)}</span><span className="negative"><ArrowUpRight size={14} /> {money(p.outflow)}</span></div>)}</div>{!d.moneyFlow.length && <div className="inline-empty">Pul oqimi maʼlumoti yoʻq</div>}</Panel></div>
      <div className="completeness-note" data-testid="status-completeness"><ShieldCheck size={15} /><span>{d.completeness === 'complete' ? 'Hisobot toʻliq' : d.completeness === 'preliminary' ? 'Dastlabki natija — ayrim manbalar hali toʻliq emas' : 'Natija chiqarish uchun maʼlumot yetarli emas'}</span><span className="source-note">Manba: {d.mode === 'demo' ? 'sinov maʼlumotlari' : 'jonli maʼlumotlar'}</span></div></>}
  </>;
}

function BranchesPage({ filters }: { filters: Filters }) {
  const qc = useQueryClient();
  const branchesQ = useListBranches();
  const create = useCreateBranch();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', region: '', address: '', manager: '', fomId: '' });
  const [query, setQuery] = useState('');
  const items = (branchesQ.data || []).filter(b => (!filters.branchId || String(b.id) === filters.branchId) && `${b.name} ${b.region} ${b.manager}`.toLowerCase().includes(query.toLowerCase()));
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate({ data: { ...form, fomId: form.fomId || null } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListBranchesQueryKey() }); setOpen(false); setForm({ name: '', region: '', address: '', manager: '', fomId: '' }); } }); };
  return <><PageHeading title="Filiallar" subtitle="Guruh tarkibini boshqaring va filiallar holatini kuzating" actions={<button className="button primary" onClick={() => setOpen(true)} data-testid="button-create-branch"><Plus size={16} /> Filial qoʻshish</button>} />
    <Panel title="Filiallar roʻyxati" subtitle={`${branchesQ.data?.length ?? '—'} ta roʻyxatdagi filial`} action={<label className="search-field"><Search size={15} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filial qidirish" data-testid="input-search-branches" /></label>}>
      <DataState loading={branchesQ.isLoading} error={branchesQ.isError} empty={!branchesQ.isLoading && !branchesQ.isError && !items.length} retry={() => branchesQ.refetch()} />
      {!!items.length && <TableWrap><thead><tr><th>FILIAL</th><th>HUDUD</th><th>MASʼUL</th><th>MANBA</th><th>HOLAT</th><th>YANGILANGAN</th><th /></tr></thead><tbody>{items.map(b => <tr key={b.id} data-testid={`row-branch-${b.id}`}><td><Link href={`/branches/${b.id}`} className="table-main-link" data-testid={`link-branch-details-${b.id}`}>{b.name}<ArrowRight size={13} /></Link><small>{b.address || 'Manzil koʻrsatilmagan'}</small></td><td>{b.region || '—'}</td><td>{b.manager || '—'}</td><td><StatusBadge tone={b.source === 'demo' ? 'warn' : 'neutral'}>{sourceText(b.source)}</StatusBadge></td><td><StatusBadge tone={b.status === 'active' ? 'good' : 'warn'}>{b.status === 'active' ? 'Faol' : b.status || 'Holat nomaʼlum'}</StatusBadge></td><td>{date(b.updatedAt)}</td><td><Link href={`/branches/${b.id}`} className="icon-button" aria-label="Filialni ochish"><ArrowRight size={16} /></Link></td></tr>)}</tbody></TableWrap>}
    </Panel>
    {open && <div className="modal-backdrop" role="presentation" onClick={() => !create.isPending && setOpen(false)}><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="branch-modal-title" onClick={e => e.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">GURUH TARKIBI</span><h2 id="branch-modal-title">Yangi filial</h2></div><button className="icon-button" onClick={() => setOpen(false)} data-testid="button-close-branch"><X size={18} /></button></div><form onSubmit={submit} className="form-stack"><label>Filial nomi<input required minLength={2} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} data-testid="input-branch-name" /></label><label>Hudud<input required value={form.region} onChange={e => setForm({ ...form, region: e.target.value })} data-testid="input-branch-region" /></label><label>Manzil<input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} data-testid="input-branch-address" /></label><label>Filial masʼuli<input value={form.manager} onChange={e => setForm({ ...form, manager: e.target.value })} data-testid="input-branch-manager" /></label><label>FOM filial identifikatori <span className="optional">ixtiyoriy</span><input value={form.fomId} onChange={e => setForm({ ...form, fomId: e.target.value })} data-testid="input-branch-fomid" /></label>{create.isError && <div className="form-error" data-testid="status-branch-error">Filialni saqlashda xatolik. Kiritilgan maʼlumotlarni tekshiring.</div>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => setOpen(false)}>Bekor qilish</button><button className="button primary" disabled={create.isPending} data-testid="button-save-branch">{create.isPending ? 'Saqlanmoqda…' : 'Filialni saqlash'}</button></div></form></div></div>}
  </>;
}
function BranchDetailPage({ id, filters }: { id: number; filters: Filters }) {
  const params = { branchId: id, dateFrom: filters.dateFrom || undefined, dateTo: filters.dateTo || undefined };
  const q = useGetBranch(params, { query: { queryKey: getGetBranchQueryKey(params) } });
  const d = q.data;
  return <><div className="back-row"><Link href="/branches" className="text-link" data-testid="link-back-branches"><ArrowLeft size={15} /> Filiallar roʻyxatiga</Link></div><DataState loading={q.isLoading} error={q.isError} empty={!q.isLoading && !q.isError && !d} retry={() => q.refetch()} />
    {d && <><DataMode mode={d.branch.source === 'demo' ? 'demo' : undefined} /><PageHeading eyebrow={`${d.branch.region || 'FILIAL'} • FILIAL MAʼLUMOTI`} title={d.branch.name} subtitle={`${d.branch.address || 'Manzil koʻrsatilmagan'} · Masʼul: ${d.branch.manager || '—'}`} actions={<StatusBadge tone={d.branch.status === 'active' ? 'good' : 'warn'}>{d.branch.status === 'active' ? 'Faol' : d.branch.status}</StatusBadge>} /><div className="metric-grid compact"><Metric label="Savdo" value={d.summary.sales} icon={ArrowUpRight} /><Metric label="Yalpi foyda" value={d.summary.grossProfit} icon={Activity} /><Metric label="Xarajat" value={d.summary.expenses} icon={ClipboardList} /><Metric label="Pul qoldigʻi" value={d.summary.cashBalance} icon={Wallet} /><Metric label="Zaxira qiymati" value={d.summary.inventoryValue} icon={Boxes} /><Metric label="Qarzdorlik" value={d.summary.payable} icon={Clock3} /></div><div className="dash-grid"><Panel title="Soʻnggi savdolar" subtitle="Tanlangan davrdagi filial savdosi"><SalesTable rows={d.recentSales} /></Panel><Panel title="Xarajatlar" subtitle="Filial xarajatlari"><ExpenseTable rows={d.expenses} /></Panel></div><div className="completeness-note"><ShieldCheck size={15} /><span>Manba: {sourceText(d.branch.source)}</span><span className="source-note">Yangilangan: {date(d.branch.updatedAt)}</span></div></>}
  </>;
}

function SalesTable({ rows }: { rows?: Sale[] }) {
  if (!rows?.length) return <div className="inline-empty">Savdo yozuvlari mavjud emas</div>;
  return <TableWrap><thead><tr><th>SANA / CHEK</th><th>MAHSULOT</th><th>MIQDOR</th><th>SAVDO</th><th>FOYDA</th><th>TOʻLOV</th></tr></thead><tbody>{rows.map((s, i) => <tr key={s.id ?? i} data-testid={`row-sale-${s.id ?? i}`}><td>{date(s.date)}<small>{s.receiptNo} · {sourceText(s.source)}</small></td><td>{s.productName}<small>{s.branchName}</small></td><td>{s.quantity}</td><td>{money(s.revenue)}</td><td className={s.grossProfit == null ? 'missing' : 'positive'}>{money(s.grossProfit)}</td><td>{s.paymentType || '—'}</td></tr>)}</tbody></TableWrap>;
}
function ExpenseTable({ rows }: { rows?: Expense[] }) {
  if (!rows?.length) return <div className="inline-empty">Xarajat yozuvlari mavjud emas</div>;
  return <TableWrap><thead><tr><th>SANA</th><th>KATEGORIYA</th><th>IZOH</th><th>MIQDOR</th></tr></thead><tbody>{rows.map((x,i) => <tr key={x.id ?? i}><td>{date(x.date)}<small>{sourceText(x.source)}</small></td><td>{x.category}</td><td>{x.description || '—'}</td><td className="negative">{money(x.amount)} soʻm</td></tr>)}</tbody></TableWrap>;
}
function TradePage({ filters, productId }: { filters: Filters; productId?: number }) {
  const [tab, setTab] = useState<'sales' | 'inventory'>(productId ? 'inventory' : 'sales');
  const [search, setSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<number | null>(productId ?? null);
  const params = { branchId: filters.branchId ? Number(filters.branchId) : undefined, dateFrom: filters.dateFrom || undefined, dateTo: filters.dateTo || undefined, search: search || undefined, limit: 100 };
  const sales = useListSales(params);
  const inventoryParams = { branchId: filters.branchId ? Number(filters.branchId) : undefined, search: search || undefined };
  const inventory = useListInventory(inventoryParams);
  const productParams = { productId: selectedProduct || 1 };
  const product = useGetProduct(productParams, { query: { enabled: selectedProduct !== null, queryKey: getGetProductQueryKey(productParams) } });
  const rows = inventory.data || [];
  return <><PageHeading title="Savdo va zaxira" subtitle="Savdo hujjatlari, filial qoldiqlari va mahsulotlar kesimi" /><div className="tabs" role="tablist"><button onClick={() => { setTab('sales'); setSearch(''); }} className={tab === 'sales' ? 'selected' : ''} data-testid="tab-sales"><ArrowUpRight size={15} /> Savdolar</button><button onClick={() => { setTab('inventory'); setSearch(''); }} className={tab === 'inventory' ? 'selected' : ''} data-testid="tab-inventory"><Boxes size={15} /> Tovar zaxirasi</button></div>
    <Panel title={tab === 'sales' ? 'Savdo yozuvlari' : 'Zaxira qoldiqlari'} subtitle={tab === 'sales' ? 'Chek, mahsulot va toʻlov turi boʻyicha' : 'Filialdagi mahsulot qoldiqlari'} action={<label className="search-field"><Search size={15} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder={tab === 'sales' ? 'Chek yoki mahsulot' : 'Mahsulot, shtrix-kod'} data-testid="input-trade-search" /></label>}>
      {tab === 'sales' ? <><DataState loading={sales.isLoading} error={sales.isError} empty={!sales.isLoading && !sales.isError && !(sales.data || []).length} retry={() => sales.refetch()} /><SalesTable rows={sales.data || []} /></> :
        <><DataState loading={inventory.isLoading} error={inventory.isError} empty={!inventory.isLoading && !inventory.isError && !rows.length} retry={() => inventory.refetch()} />{!!rows.length && <TableWrap><thead><tr><th>MAHSULOT</th><th>FILIAL</th><th>QOLDIQ</th><th>TANNARX</th><th>SOTUV NARXI</th><th>QIYMAT</th><th>YAROQLILIK</th></tr></thead><tbody>{rows.map((x: InventoryItem) => <tr key={`${x.productId}-${x.branchId}`} data-testid={`row-inventory-${x.productId}-${x.branchId}`}><td><button className="table-main-link plain" onClick={() => setSelectedProduct(x.productId)} data-testid={`button-product-${x.productId}`}>{x.productName}<ArrowRight size={13} /></button><small>{x.barcode || x.group || '—'}</small></td><td>{x.branchName}</td><td>{x.quantity}</td><td>{money(x.costPrice)}</td><td>{money(x.retailPrice)}</td><td>{money(x.value)}</td><td>{date(x.expiryDate)}</td></tr>)}</tbody></TableWrap>}</>}
    </Panel>
    {selectedProduct !== null && <div className="modal-backdrop" role="presentation" onClick={() => setSelectedProduct(null)}><div className="modal-card product-modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">MAHSULOT KARTASI</span><h2>{product.data?.product.productName || 'Mahsulot'}</h2></div><button onClick={() => setSelectedProduct(null)} className="icon-button" data-testid="button-close-product"><X size={18} /></button></div><DataState loading={product.isLoading} error={product.isError} empty={!product.isLoading && !product.isError && !product.data} retry={() => product.refetch()} />{product.data && <><div className="product-detail-grid"><div><span>Shtrix-kod</span><b>{product.data.product.barcode || '—'}</b></div><div><span>Guruh</span><b>{product.data.product.group || '—'}</b></div><div><span>Sotuv narxi</span><b>{money(product.data.product.retailPrice)} soʻm</b></div></div><h3 className="subhead">Filiallar kesimidagi qoldiq</h3><TableWrap><thead><tr><th>FILIAL</th><th>MIQDOR</th><th>QIYMAT</th><th>YAROQLILIK</th></tr></thead><tbody>{product.data.branchBalances.map((b,i) => <tr key={`${b.branchId}-${i}`}><td>{b.branchName}</td><td>{b.quantity}</td><td>{money(b.value)}</td><td>{date(b.expiryDate)}</td></tr>)}</tbody></TableWrap></>}</div></div>}
  </>;
}

function FinancePage({ filters }: { filters: Filters }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'accounts' | 'transactions' | 'expenses'>('accounts');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ date: today, branchId: filters.branchId, category: '', description: '', amount: '' });
  const branchesQ = useListBranches();
  const params = { branchId: filters.branchId ? Number(filters.branchId) : undefined, dateFrom: filters.dateFrom || undefined, dateTo: filters.dateTo || undefined };
  const accounts = useListCashAccounts({ branchId: params.branchId });
  const transactions = useListMoneyTransactions(params);
  const expenses = useListExpenses(params);
  const add = useCreateExpense();
  const submit = (e: FormEvent) => { e.preventDefault(); add.mutate({ data: { ...form, branchId: Number(form.branchId), amount: form.amount } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListExpensesQueryKey(params) }); qc.invalidateQueries({ queryKey: getGetDashboardQueryKey({ dateFrom: params.dateFrom, dateTo: params.dateTo, branchId: params.branchId }) }); setOpen(false); setForm({ date: today, branchId: filters.branchId, category: '', description: '', amount: '' }); } }); };
  const tabs = [{ id: 'accounts', label: 'Hisoblar' }, { id: 'transactions', label: 'Pul harakati' }, { id: 'expenses', label: 'Xarajatlar' }] as const;
  return <><PageHeading title="Moliya" subtitle="Hisobvaraqlar, pul oqimi va xarajatlar" actions={tab === 'expenses' && <button className="button primary" onClick={() => setOpen(true)} data-testid="button-add-expense"><Plus size={16} /> Xarajat kiritish</button>} /><div className="tabs">{tabs.map(t => <button key={t.id} className={tab === t.id ? 'selected' : ''} onClick={() => setTab(t.id)} data-testid={`tab-finance-${t.id}`}>{t.label}</button>)}</div>
    {tab === 'accounts' && <Panel title="Hisobvaraqlar" subtitle="Kassa va bank qoldiqlari"><DataState loading={accounts.isLoading} error={accounts.isError} empty={!accounts.isLoading && !accounts.isError && !(accounts.data || []).length} retry={() => accounts.refetch()} />{!!accounts.data?.length && <><div className="account-grid">{accounts.data.map(a => <div className="account-card" key={a.id} data-testid={`card-account-${a.id}`}><div className="account-type"><span className="metric-icon">{a.kind === 'cash' ? <Wallet size={17} /> : <Landmark size={17} />}</span><span>{a.kind === 'cash' ? 'Kassa' : 'Bank hisobvaragʻi'}</span><StatusBadge tone={a.source === 'demo' ? 'warn' : 'neutral'}>{sourceText(a.source)}</StatusBadge></div><b>{money(a.balance)} <small>soʻm</small></b><span>{a.name} · {a.branchName}</span><div className="account-movement"><span className="positive">Kirim {money(a.inflow)}</span><span className="negative">Chiqim {money(a.outflow)}</span></div></div>)}</div><div className="account-totals"><span>Hisoblar soni <b>{accounts.data.length}</b></span><span>Qoldiq maʼlumotlari asl manba qiymatida berilgan</span></div></>}</Panel>}
    {tab === 'transactions' && <Panel title="Pul harakati" subtitle="Hisoblar boʻyicha kirim va chiqim yozuvlari"><DataState loading={transactions.isLoading} error={transactions.isError} empty={!transactions.isLoading && !transactions.isError && !(transactions.data || []).length} retry={() => transactions.refetch()} />{!!transactions.data?.length && <TableWrap><thead><tr><th>SANA</th><th>OPERATSIYA</th><th>HISOB</th><th>FILIAL</th><th>HUJJAT</th><th>SUMMA</th></tr></thead><tbody>{transactions.data.map(t => <tr key={t.id} data-testid={`row-transaction-${t.id}`}><td>{date(t.date)}</td><td>{t.type || (t.direction === 'in' ? 'Kirim' : t.direction === 'out' ? 'Chiqim' : 'Ichki oʻtkazma')}<small>{t.note}</small></td><td>{t.accountName}</td><td>{t.branchName}</td><td>{t.documentNo || '—'}</td><td className={t.direction === 'in' ? 'positive' : t.direction === 'out' ? 'negative' : ''}>{money(t.amount)} soʻm</td></tr>)}</tbody></TableWrap>}</Panel>}
    {tab === 'expenses' && <Panel title="Xarajatlar" subtitle="Filial va kategoriya boʻyicha xarajatlar"><DataState loading={expenses.isLoading} error={expenses.isError} empty={!expenses.isLoading && !expenses.isError && !(expenses.data || []).length} retry={() => expenses.refetch()} /><ExpenseTable rows={expenses.data || []} /></Panel>}
    {open && <div className="modal-backdrop" role="presentation" onClick={() => !add.isPending && setOpen(false)}><div className="modal-card" role="dialog" aria-modal="true"><div className="modal-head"><div><span className="eyebrow">XARAJAT HISOBI</span><h2>Yangi xarajat</h2></div><button onClick={() => setOpen(false)} className="icon-button" data-testid="button-close-expense"><X size={18} /></button></div><form onSubmit={submit} className="form-stack"><label>Sana<input type="date" required value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} data-testid="input-expense-date" /></label><label>Filial<select required value={form.branchId} onChange={e => setForm({ ...form, branchId: e.target.value })} data-testid="select-expense-branch"><option value="">Filialni tanlang</option>{(branchesQ.data || []).map(b => <option value={b.id} key={b.id}>{b.name}</option>)}</select></label><label>Kategoriya<input required value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} data-testid="input-expense-category" /></label><label>Izoh<input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} data-testid="input-expense-description" /></label><label>Summa (soʻm)<input required type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} data-testid="input-expense-amount" /><span className="field-hint">Aniqlik saqlanishi uchun summa matn qiymati sifatida yuboriladi.</span></label>{add.isError && <div className="form-error" data-testid="status-expense-error">Xarajat saqlanmadi. Maʼlumotlarni tekshirib qayta urinib koʻring.</div>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => setOpen(false)}>Bekor qilish</button><button className="button primary" disabled={add.isPending} data-testid="button-save-expense">{add.isPending ? 'Saqlanmoqda…' : 'Xarajatni saqlash'}</button></div></form></div></div>}
  </>;
}

function DebtsPage({ filters }: { filters: Filters }) {
  const [tab, setTab] = useState<'payable' | 'receivable'>('payable');
  const params = { branchId: filters.branchId ? Number(filters.branchId) : undefined, kind: tab };
  const q = useListDebts(params);
  const debts = q.data || [];
  const sum = debts.reduce((acc, d) => acc + Number(d.balance || 0), 0);
  return <><PageHeading title="Qarzlar" subtitle="Yetkazib beruvchilar va mijozlar bilan hisob-kitoblar" /><div className="debt-overview"><div><span>{tab === 'payable' ? 'Jami toʻlanishi kerak' : 'Jami undirilishi kerak'}</span><b>{debts.length ? money(sum.toString()) : '—'} <small>soʻm</small></b><span>{q.isLoading || q.isError ? '— ta hujjat' : `${debts.length} ta hujjat`}</span></div><div className="debt-side"><span className="debt-mark"><Clock3 size={18} /></span><div><b>Toʻlov muddatlarini kuzating</b><span>Har bir qarz boʻyicha qoldiq va muddat alohida koʻrsatilgan.</span></div></div></div><div className="tabs"><button onClick={() => setTab('payable')} className={tab === 'payable' ? 'selected' : ''} data-testid="tab-payables">Toʻlanadigan qarzlar</button><button onClick={() => setTab('receivable')} className={tab === 'receivable' ? 'selected' : ''} data-testid="tab-receivables">Undiriladigan qarzlar</button></div><Panel title={tab === 'payable' ? 'Yetkazib beruvchilarga' : 'Mijozlardan'} subtitle="Qarz hujjatlari va qoldiq"><DataState loading={q.isLoading} error={q.isError} empty={!q.isLoading && !q.isError && !debts.length} retry={() => q.refetch()} />{!!debts.length && <TableWrap><thead><tr><th>HAMKOR</th><th>HUJJAT</th><th>FILIAL</th><th>BERILGAN SANA</th><th>MUDDAT</th><th>BOSHLANGʻICH</th><th>TOʻLANGAN</th><th>QOLDIQ</th></tr></thead><tbody>{debts.map((d: Debt) => <tr key={d.id} data-testid={`row-debt-${d.id}`}><td className="cell-strong">{d.counterparty}<small>{d.source === 'demo' ? 'Sinov maʼlumoti' : sourceText(d.source)}</small></td><td>{d.documentNo || '—'}</td><td>{d.branchName}</td><td>{date(d.issuedDate)}</td><td><span className={new Date(d.dueDate) < new Date() ? 'negative' : ''}>{date(d.dueDate)}</span></td><td>{money(d.initialAmount)}</td><td>{money(d.paidAmount)}</td><td className="cell-strong">{money(d.balance)} soʻm</td></tr>)}</tbody></TableWrap>}</Panel></>;
}

function ProfitPage({ filters }: { filters: Filters }) {
  const params = { reportType: 'profit' as const, dateFrom: filters.dateFrom || undefined, dateTo: filters.dateTo || undefined, branchId: filters.branchId ? Number(filters.branchId) : undefined };
  const q = useGetReport(params, { query: { queryKey: getGetReportQueryKey(params) } });
  const r = q.data;
  const incomplete = !!r?.rows.some(row => Object.values(row).some(value => value === null || value === undefined || value === ''));
  return <><DataMode mode={r?.mode} /><PageHeading title="Foyda va zarar" subtitle={`Hisobot endpointidan olingan natija • ${date(params.dateFrom)} — ${date(params.dateTo)}`} actions={<button className="button secondary" disabled={!r?.rows.length} onClick={() => r && exportRows(r.columns, r.rows, 'foyda-zarar.csv')} data-testid="button-export-profit"><Download size={15} /> CSV yuklab olish</button>} />
    <DataState loading={q.isLoading} error={q.isError} empty={!q.isLoading && !q.isError && (!r || r.mode === 'empty')} retry={() => q.refetch()} />
    {r && r.mode !== 'empty' && <><div className={`profit-status ${r.mode === 'demo' || incomplete ? 'warn' : ''}`} data-testid="status-profit-completeness"><span className="profit-icon"><ShieldCheck size={18} /></span><div><b>{r.mode === 'demo' ? 'SINOV REJIMI' : incomplete ? 'Qisman natija' : 'Hisobot maʼlumotlari'}</b><span>{r.mode === 'demo' ? 'Ushbu natijalar demo maʼlumotlariga asoslangan.' : incomplete ? 'Ayrim qiymatlar yetishmaydi. Natijani yakuniy deb qabul qilmang.' : 'Foyda va zarar raqamlari hisobot xizmatidan olindi.'} {r.rows.length ? '' : 'Hisobot qatorlari mavjud emas; summani nol deb talqin qilmang.'}</span></div><span className="updated-stamp">{date(r.updatedAt)}</span></div><Panel title="Foyda va zarar tafsilotlari" subtitle={`${r.rows.length} qator · Jami ${money(r.total)} soʻm`}>{r.rows.length ? <TableWrap><thead><tr>{r.columns.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{r.rows.map((row,i) => <tr key={i}>{r.columns.map(c => <td key={c}>{displayCell(row[c])}</td>)}</tr>)}</tbody></TableWrap> : <div className="inline-empty">Hisobot qatorlari yoʻq — yakuniy xulosa chiqarish uchun maʼlumot yetarli emas.</div>}</Panel><div className="completeness-note"><CircleHelp size={15} /><span>Natija toʻliqligi manba hisobotiga bogʻliq. Yetishmayotgan qiymat «—» bilan belgilanadi.</span></div></>}
  </>;
}

function displayCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
function exportRows(columns: string[], rows: Record<string, unknown>[], filename: string) {
  const quote = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const csv = [columns.map(quote).join(','), ...rows.map(row => columns.map(c => quote(row[c])).join(','))].join('\r\n');
  const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}
function ReportsPage({ filters }: { filters: Filters }) {
  const [kind, setKind] = useState<'sales' | 'inventory' | 'expenses' | 'debts' | 'profit' | 'cashflow'>('sales');
  const [dates, setDates] = useState({ from: filters.dateFrom || monthStart, to: filters.dateTo || today });
  const [hasRun, setHasRun] = useState(false);
  const [submitted, setSubmitted] = useState({ kind: 'sales' as typeof kind, from: filters.dateFrom || monthStart, to: filters.dateTo || today, branchId: filters.branchId });
  const params = { reportType: submitted.kind, dateFrom: submitted.from || undefined, dateTo: submitted.to || undefined, branchId: submitted.branchId ? Number(submitted.branchId) : undefined };
  const q = useGetReport(params, { query: { queryKey: getGetReportQueryKey(params), enabled: hasRun } });
  const labels: Record<typeof kind, string> = { sales: 'Savdo hisoboti', inventory: 'Tovar qoldiqlari', expenses: 'Xarajatlar', debts: 'Qarzlar', profit: 'Foyda va zarar', cashflow: 'Pul oqimi' };
  const run = (e: FormEvent) => { e.preventDefault(); setSubmitted({ kind, ...dates, branchId: filters.branchId }); setHasRun(true); };
  const report = q.data;
  return <><PageHeading title="Hisobotlar" subtitle="Hisobot turini, davrni va filialni tanlang" /><Panel title="Hisobot sozlamalari" subtitle="Soʻrov API hisobot xizmatidan olinadi"><form className="report-form" onSubmit={run}><label>Hisobot turi<select value={kind} onChange={e => setKind(e.target.value as typeof kind)} data-testid="select-report-type">{Object.entries(labels).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label><label>Boshlanish sanasi<input type="date" value={dates.from} onChange={e => setDates({ ...dates, from: e.target.value })} data-testid="input-report-from" /></label><label>Tugash sanasi<input type="date" value={dates.to} onChange={e => setDates({ ...dates, to: e.target.value })} data-testid="input-report-to" /></label><div className="report-branch"><span>Filial</span><div>{filters.branchId ? 'Global filtr tanlangan filialni qoʻllaydi' : 'Barcha filiallar'}</div></div><button className="button primary" data-testid="button-run-report"><FileBarChart2 size={15} /> Hisobotni koʻrsatish</button></form></Panel>
    <DataMode mode={report?.mode} />
    <Panel title={labels[submitted.kind]} subtitle={report ? `Yangilandi: ${date(report.updatedAt)} · ${report.rows.length} qator` : 'Hisobot natijasi'}>
      {!hasRun && <div className="report-prompt"><FileBarChart2 size={22} /><b>Hisobot turini tanlang</b><span>Filtrlarni belgilang va «Hisobotni koʻrsatish» tugmasini bosing.</span></div>}
      {q.isFetching && <DataState loading error={false} empty={false} retry={() => q.refetch()} />}
      {q.isError && <DataState loading={false} error empty={false} retry={() => q.refetch()} />}
      {report?.mode === 'empty' && <DataState loading={false} error={false} empty retry={() => q.refetch()} />}
      {report && report.mode !== 'empty' && <><div className="report-toolbar"><div><b>Jami:</b> {money(report.total)} soʻm <StatusBadge tone={report.mode === 'demo' ? 'warn' : 'good'}>{report.mode === 'demo' ? 'Sinov rejimi' : 'Jonli maʼlumot'}</StatusBadge></div><button className="button secondary small" disabled={!report.rows.length} onClick={() => exportRows(report.columns, report.rows, `${submitted.kind}-hisobot.csv`)} data-testid="button-export-report"><Download size={14} /> CSV eksport</button></div>{report.rows.length ? <TableWrap><thead><tr>{report.columns.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{report.rows.map((row, i) => <tr key={i} data-testid={`row-report-${i}`}>{report.columns.map(c => <td key={c}>{displayCell(row[c])}</td>)}</tr>)}</tbody></TableWrap> : <div className="inline-empty">Natija qatorlari topilmadi. Boʻsh natija nolga teng emas.</div>}</>}
    </Panel></>;
}

function SettingsPage() {
  const qc = useQueryClient();
  const q = useGetFomStatus();
  const save = useSaveFomSettings();
  const test = useTestFomConnection();
  const sync = useSyncFom();
  const [baseUrl, setBaseUrl] = useState('');
  const [message, setMessage] = useState<{ status: string; text: string } | null>(null);
  const initialized = useRef(false);
  useEffect(() => { if (q.data && !initialized.current) { setBaseUrl(q.data.baseUrl || ''); initialized.current = true; } }, [q.data]);
  const saveUrl = (e: FormEvent) => { e.preventDefault(); save.mutate({ data: { baseUrl: baseUrl.trim() } }, { onSuccess: data => { qc.setQueryData(getGetFomStatusQueryKey(), data); setMessage({ status: 'success', text: 'FOM server manzili saqlandi.' }); }, onError: () => setMessage({ status: 'error', text: 'Manzil saqlanmadi. URL formatini tekshiring.' }) }); };
  const runTest = () => { setMessage(null); test.mutate(undefined, { onSuccess: result => { setMessage({ status: result.status, text: result.message }); qc.invalidateQueries({ queryKey: getGetFomStatusQueryKey() }); }, onError: () => setMessage({ status: 'error', text: 'Ulanishni tekshirib boʻlmadi.' }) }); };
  const runSync = () => { setMessage(null); sync.mutate(undefined, { onSuccess: result => { setMessage({ status: result.status, text: result.message }); qc.invalidateQueries({ queryKey: getGetFomStatusQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); qc.invalidateQueries({ queryKey: getGetReportQueryKey() }); qc.invalidateQueries({ queryKey: getListBranchesQueryKey() }); qc.invalidateQueries({ queryKey: getListSalesQueryKey() }); qc.invalidateQueries({ queryKey: getListInventoryQueryKey() }); qc.invalidateQueries({ queryKey: getListExpensesQueryKey() }); qc.invalidateQueries({ queryKey: getListCashAccountsQueryKey() }); qc.invalidateQueries({ queryKey: getListMoneyTransactionsQueryKey() }); qc.invalidateQueries({ queryKey: getListDebtsQueryKey() }); }, onError: () => setMessage({ status: 'error', text: 'Sinxronlash amalga oshmadi.' }) }); };
  const status = q.data;
  return <><PageHeading title="Sozlamalar" subtitle="FOM integratsiyasining tayyorgarligi, aloqa sinovi va import holati" /><DataState loading={q.isLoading} error={q.isError} empty={false} retry={() => q.refetch()} />{status && <><div className={`integration-banner ${status.connected ? 'connected' : 'disconnected'}`} data-testid="status-fom-connection"><div className="integration-icon">{status.connected ? <Check size={20} /> : <AlertCircle size={20} />}</div><div><span className="eyebrow">FOM ULANISHI</span><b>{status.connected ? 'Ulanish faol' : status.configured ? 'Ulanish yoʻq' : 'Sozlash kutilmoqda'}</b><span>{status.configured ? status.baseUrl : 'FOM server manzili kiritilmagan'}</span></div><StatusBadge tone={status.connected ? 'good' : status.configured ? 'bad' : 'warn'}>{status.connected ? 'Ulangan' : status.configured ? 'Ulanmagan' : 'Tayyor emas'}</StatusBadge></div>
      <div className="dash-grid settings-grid"><Panel title="FOM server manzili" subtitle="Faqat server manzilini kiriting. API kaliti brauzerda saqlanmaydi."><form onSubmit={saveUrl} className="fom-form"><label>Asosiy URL<input type="url" required placeholder="https://fom.example.uz" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} data-testid="input-fom-url" /></label><div className="field-hint"><ShieldCheck size={14} /> Maxfiy API kaliti server tomonidan boshqariladi.</div>{message && <div className={`notice ${message.status === 'error' ? 'error' : 'success'}`} data-testid="status-fom-message">{message.text}</div>}<div className="button-row"><button className="button primary" disabled={save.isPending} data-testid="button-save-fom">{save.isPending ? 'Saqlanmoqda…' : 'Manzilni saqlash'}</button><button type="button" className="button secondary" onClick={runTest} disabled={!status.configured || test.isPending} data-testid="button-test-fom"><Activity size={15} />{test.isPending ? 'Tekshirilmoqda…' : 'Ulanishni sinash'}</button></div></form></Panel>
        <Panel title="Import va sinxronlash" subtitle="Oxirgi FOM importi va yozuvlar holati"><div className="sync-status"><div className={`sync-orb ${status.lastSyncStatus}`}><RefreshCw size={19} /></div><div><span>Oxirgi sinxronlash</span><b>{status.lastSyncAt ? date(status.lastSyncAt) : 'Hali bajarilmagan'}</b><small>{status.lastMessage || `Holat: ${status.lastSyncStatus === 'success' ? 'muvaffaqiyatli' : status.lastSyncStatus === 'error' ? 'xatolik' : status.lastSyncStatus === 'running' ? 'jarayonda' : 'boshlanmagan'}`}</small></div></div><div className="import-count"><div><span>Import qilingan yozuvlar</span><b data-testid="text-imported-count">{status.importedRecords.toLocaleString('uz-UZ')}</b></div><div><span>FOM API kaliti</span><StatusBadge tone={status.keyConfigured ? 'good' : 'warn'}>{status.keyConfigured ? 'Serverda sozlangan' : 'Sozlanmagan'}</StatusBadge></div></div><button className="button primary full-button" onClick={runSync} disabled={!status.configured || sync.isPending} data-testid="button-sync-fom"><RefreshCw size={15} className={sync.isPending ? 'spin' : ''} />{sync.isPending ? 'Sinxronlanmoqda…' : 'Sinxronlashni boshlash'}</button>{!status.configured && <p className="field-hint center-hint">Avval FOM server manzilini saqlang.</p>}</Panel></div>
      <div className="completeness-note"><ShieldCheck size={15} /><span>FOM ulanishi va import holati: {status.lastSyncStatus}</span><span className="source-note">{status.connected ? 'Ulanish mavjud' : 'API maʼlumotlari hozircha ulanmagan'}</span></div></>}</>;
}

function AppRoutes({ filters, setFilters }: { filters: Filters; setFilters: (v: Filters) => void }) {
  return <Switch>
    <Route path="/"><Show when="signed-in"><Shell filters={filters} setFilters={setFilters}><DashboardPage filters={filters} /></Shell></Show><Show when="signed-out"><Landing /></Show></Route>
    <Route path="/branches"><Show when="signed-in"><Shell filters={filters} setFilters={setFilters}><BranchesPage filters={filters} /></Shell></Show><Show when="signed-out"><Redirect to="/" /></Show></Route>
    <Route path="/branches/:id">{params => <><Show when="signed-in"><Shell filters={filters} setFilters={setFilters}><BranchDetailPage id={Number(params.id)} filters={filters} /></Shell></Show><Show when="signed-out"><Redirect to="/" /></Show></>}</Route>
    <Route path="/trade"><Show when="signed-in"><Shell filters={filters} setFilters={setFilters}><TradePage filters={filters} /></Shell></Show><Show when="signed-out"><Redirect to="/" /></Show></Route>
    <Route path="/trade/product/:id">{params => <><Show when="signed-in"><Shell filters={filters} setFilters={setFilters}><TradePage filters={filters} productId={Number(params.id)} /></Shell></Show><Show when="signed-out"><Redirect to="/" /></Show></>}</Route>
    <Route path="/finance"><Show when="signed-in"><Shell filters={filters} setFilters={setFilters}><FinancePage filters={filters} /></Shell></Show><Show when="signed-out"><Redirect to="/" /></Show></Route>
    <Route path="/debts"><Show when="signed-in"><Shell filters={filters} setFilters={setFilters}><DebtsPage filters={filters} /></Shell></Show><Show when="signed-out"><Redirect to="/" /></Show></Route>
    <Route path="/profit"><Show when="signed-in"><Shell filters={filters} setFilters={setFilters}><ProfitPage filters={filters} /></Shell></Show><Show when="signed-out"><Redirect to="/" /></Show></Route>
    <Route path="/reports"><Show when="signed-in"><Shell filters={filters} setFilters={setFilters}><ReportsPage filters={filters} /></Shell></Show><Show when="signed-out"><Redirect to="/" /></Show></Route>
    <Route path="/settings"><Show when="signed-in"><Shell filters={filters} setFilters={setFilters}><SettingsPage /></Shell></Show><Show when="signed-out"><Redirect to="/" /></Show></Route>
    <Route path="/sign-in/*?"><SignInPage /></Route>
    <Route path="/sign-up/*?"><SignUpPage /></Route>
    <Route component={NotFound} />
  </Switch>;
}
function ClerkCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prev = useRef<string | null | undefined>(undefined);
  useEffect(() => addListener(({ user }) => { const id = user?.id ?? null; if (prev.current !== undefined && prev.current !== id) qc.clear(); prev.current = id; }), [addListener, qc]);
  return null;
}
function AppRouter() {
  const [, setLocation] = useLocation();
  const [filters, setFilters] = useState<Filters>({ dateFrom: monthStart, dateTo: today, branchId: '' });
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={appearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{
    signIn: { start: { title: 'Hisobingizga kiring', subtitle: 'Dorixona Hisob moliyaviy markaziga xush kelibsiz' } },
    signUp: { start: { title: 'Hisob yarating', subtitle: 'Guruhingiz moliyasini bir joyda boshqaring' } },
  }} routerPush={to => setLocation(stripBase(to))} routerReplace={to => setLocation(stripBase(to), { replace: true })}>
    <QueryClientProvider client={queryClient}><ClerkCacheInvalidator /><ErrorBoundary resetKey={location}><AppRoutes filters={filters} setFilters={setFilters} /></ErrorBoundary></QueryClientProvider>
  </ClerkProvider>;
}
function App() {
  if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY');
  return <TooltipProvider><WouterRouter base={basePath}><AppRouter /></WouterRouter><Toaster /></TooltipProvider>;
}
export default App;
