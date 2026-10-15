import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useUser, localAuth } from '@/lib/auth';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertCircle, ArrowDownLeft, ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, BarChart3, BookOpen, Boxes, Building2,
  Check, ChevronDown, CircleHelp, ClipboardList, Clock3, Download, FileBarChart2, Filter, HandCoins, LogOut,
  Menu, PackageSearch, Plus, RefreshCw, Search, Settings2, ShieldCheck, ShoppingCart, Truck, Wallet, X,
  CalendarDays, CalendarClock, CalendarRange, Infinity as InfinityIcon, Layers, Store, UserCog
} from 'lucide-react';
import { SelectMenu, type MenuOption } from '@/components/select-menu';
import {
  useGetDashboard, getGetDashboardQueryKey, useListBranches, getListBranchesQueryKey, useCreateBranch,
  useGetBranch, getGetBranchQueryKey,
  useGetReport, getGetReportQueryKey,
} from '@workspace/api-client-react';
import type { Branch, Dashboard, Expense, Sale } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  DataMode, DataState, Metric, PageHeading, Panel, StatusBadge, TableWrap, date, money, monthStart, sourceText, today, type Filters,
} from '@/components/kit';
import NotFound from '@/pages/not-found';
import { SalesPage } from '@/pages/sales';
import { PurchasesPage } from '@/pages/purchases';
import { StockPage } from '@/pages/stock';
import { MoneyPage } from '@/pages/money';
import { DebtsPage } from '@/pages/debts';
import { CatalogPage } from '@/pages/catalog';
import { FomLive, SettingsPage } from '@/pages/settings';
import { ThemeToggle } from '@/lib/theme';
import { BrandLogo } from '@/components/brand-logo';
import { SiteLayout } from '@/site/layout';
import { HomePage } from '@/site/home';
import { FaqPage, FeaturesPage, HowPage, IntegrationPage, SecurityPage, SolutionsPage } from '@/site/pages';
import { AuthPage } from '@/site/auth';
import { UsersPage, usePendingAccounts } from '@/pages/users';
import { roleLabel, useAccess } from '@/lib/access';
import { Route, Switch, useLocation, Router as WouterRouter, Redirect, Link } from 'wouter';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: true } },
});
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const stripBase = (path: string) => basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
const appearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: { logoPlacement: 'inside' as const, logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/Phrmexslogo.png` },
  variables: {
    colorPrimary: '#0b8fa3', colorForeground: '#0b1e4a', colorMutedForeground: '#5b6b88',
    colorDanger: '#bd3a32', colorBackground: '#ffffff', colorInput: '#f6f9fd',
    colorInputForeground: '#0b1e4a', colorNeutral: '#dbe4f0', fontFamily: 'DM Sans',
    borderRadius: '0.75rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center', cardBox: 'bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none', footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#0b1e4a] font-bold', headerSubtitle: 'text-[#5b6b88]',
    socialButtonsBlockButtonText: 'text-[#0b1e4a]', formFieldLabel: 'text-[#13306e]',
    footerActionLink: 'text-[#0b8fa3]', footerActionText: 'text-[#5b6b88]', dividerText: 'text-[#5b6b88]',
    identityPreviewEditButton: 'text-[#0b8fa3]', formFieldSuccessText: 'text-[#0b8fa3]', alertText: 'text-[#0b1e4a]',
    logoBox: 'mb-3', logoImage: 'rounded-lg', socialButtonsBlockButton: 'border-[#dbe4f0]',
    formButtonPrimary: 'bg-[#0b8fa3] hover:bg-[#0b1e4a]', formFieldInput: 'border-[#dbe4f0] bg-[#f6f9fd]',
    footerAction: 'bg-transparent', dividerLine: 'bg-[#dbe4f0]', alert: 'border-[#e7b95c]',
    otpCodeFieldInput: 'border-[#dbe4f0]', formFieldRow: 'text-[#0b1e4a]', main: 'text-[#0b1e4a]',
  },
};

const navItems = [
  { href: '/', label: 'Bosh dashboard', icon: BarChart3 },
  { href: '/branches', label: 'Filiallar', icon: Building2 },
  { href: '/sales', label: 'Savdolar', icon: ShoppingCart },
  { href: '/purchases', label: 'Kirim', icon: Truck },
  { href: '/stock', label: 'Tovar harakati', icon: ArrowLeftRight },
  { href: '/finance', label: 'Pul operatsiyalari', icon: Wallet },
  { href: '/debts', label: 'Qarzlar', icon: HandCoins },
  { href: '/catalog', label: 'Maʼlumotnomalar', icon: BookOpen },
  { href: '/profit', label: 'Foyda va zarar', icon: Activity },
  { href: '/reports', label: 'Hisobotlar', icon: FileBarChart2 },
  { href: '/settings', label: 'Sozlamalar', icon: Settings2 },
];
const usersNavItem = { href: '/users', label: 'Foydalanuvchilar', icon: UserCog };

const periodOptions: MenuOption[] = [
  { value: 'this-month', label: 'Joriy oy', hint: 'Oy boshidan bugungacha', icon: CalendarDays, color: '#0fb3c7' },
  { value: 'last-month', label: 'Oʻtgan oy', hint: 'Toʻliq oldingi oy', icon: CalendarClock, color: '#1f5fd0' },
  { value: '7-days', label: 'Soʻnggi 7 kun', hint: 'Bugun bilan birga', icon: CalendarRange, color: '#1fb84f' },
  { value: 'custom', label: 'Barcha davr', hint: 'Sana cheklovisiz', icon: InfinityIcon, color: '#6d4fd8' },
];

function Shell({ children, filters, setFilters }: { children: ReactNode; filters: Filters; setFilters: (v: Filters) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [location] = useLocation();
  const branchesQuery = useListBranches();
  const branches = branchesQuery.data || [];
  const selectedLabel = branches.find(b => String(b.id) === filters.branchId)?.name;
  const branchOptions: MenuOption[] = [
    { value: '', label: 'Barcha filiallar', hint: `${branches.length} ta filial`, icon: Layers, color: '#0fb3c7' },
    ...branches.map((b: Branch) => ({ value: String(b.id), label: b.name, hint: [b.region, b.fomId ? `FOM #${b.fomId}` : ''].filter(Boolean).join(' · ') || undefined, icon: Store, color: '#1f5fd0' })),
  ];
  const { user } = useUser();
  const { signOut } = useClerk();
  const accounts = usePendingAccounts();
  const access = useAccess();
  const items = localAuth && accounts.isAdmin ? [...navItems.slice(0, -1), usersNavItem, navItems[navItems.length - 1]!] : navItems;
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
      <Link href="/" className="brand-lockup brand-card" data-testid="link-brand"><BrandLogo /></Link>
      <div className="workspace-label">BOʻLIMLAR</div>
      <nav className="primary-nav" aria-label="Asosiy navigatsiya">{items.map(item => {
        const active = item.href === '/' ? location === '/' : location === item.href || location.startsWith(`${item.href}/`);
        const Icon = item.icon;
        const badge = item.href === '/users' && accounts.pending > 0 ? accounts.pending : 0;
        return <Link key={item.href} href={item.href} className={`nav-link ${active ? 'active' : ''}`} onClick={() => setMenuOpen(false)} data-testid={`link-nav-${item.href.slice(1) || 'dashboard'}`}><span className="nav-icon"><Icon size={17} strokeWidth={2} /></span><span>{item.label}</span>{badge > 0 && <span className="nav-badge" title={`${badge} ta ariza tasdiq kutmoqda`}>{badge}</span>}{active && <span className="nav-indicator" />}</Link>;
      })}</nav>
      <div className="sidebar-bottom"><div className="reconcile-note"><ShieldCheck size={17} /><div><b>Yagona manba</b><span>Har bir raqam izchil manbaga bogʻlangan</span></div></div><div className="profile-mini"><div className="avatar">{(user?.firstName || user?.primaryEmailAddress?.emailAddress || 'M').slice(0, 1).toUpperCase()}</div><div className="profile-text"><b>{user?.fullName || 'Moliya mutaxassisi'}</b><span>{user?.primaryEmailAddress?.emailAddress || 'Dorixona guruhi'}</span>{access.role && <i className={`profile-role role-${access.role}`} data-testid="text-user-role">{roleLabel(access.role)}</i>}</div><button title="Tizimdan chiqish" onClick={() => signOut({ redirectUrl: basePath || '/' })} className="icon-button" data-testid="button-sign-out"><LogOut size={16} /></button></div></div>
    </aside>
    {menuOpen && <button className="mobile-shade" onClick={() => setMenuOpen(false)} aria-label="Menyuni yopish" />}
    <main className="main-area">
      <header className="topbar"><button className="mobile-menu icon-button" onClick={() => setMenuOpen(!menuOpen)} data-testid="button-menu"><Menu size={20} /></button><div className="crumb"><span>Hisob markazi</span><ArrowRight size={13} /><strong>{items.find(n => n.href === location || (n.href !== '/' && location.startsWith(n.href)))?.label || 'Filial maʼlumoti'}</strong></div><div className="top-actions"><ThemeToggle /><FomLive /><SelectMenu caption="DAVR" ariaLabel="Davr" value={period} onChange={choosePeriod} options={periodOptions} align="right" testId="select-global-period" /><SelectMenu caption="FILIAL" ariaLabel="Filial" className="branch-menu" value={filters.branchId} onChange={branchId => setFilters({ ...filters, branchId })} options={branchOptions} align="right" testId="select-global-branch" /><span className="header-avatar">{(user?.firstName || 'M').slice(0, 1).toUpperCase()}</span></div></header>
    {selectedLabel && <div className="active-scope"><Filter size={13} /> Koʻrinish: <b>{selectedLabel}</b><button onClick={() => setFilters({ ...filters, branchId: '' })} data-testid="button-clear-branch">Filialni tozalash</button></div>}
      <div className="content-area">{branches.some(b => b.source === 'demo') && location !== '/' && location !== '/profit' && location !== '/reports' && (!location.startsWith('/branches/') || location === '/branches') && <DataMode mode="demo" />}{children}</div>
      <footer className="app-footer"><span>PHARMEX <span className="footer-dot">/</span> Moliyaviy boshqaruv</span><span>Maʼlumotlar manbasi va yangilanish vaqti har bir boʻlimda koʻrsatiladi</span></footer>
    </main>
  </div>;
}

function SignInPage() { if (localAuth) return <AuthPage mode="sign-in" />; return <div className="auth-screen"><ThemeToggle className="auth-theme" /><div className="auth-intro"><Link href="/" className="brand-lockup"><BrandLogo /></Link><span className="eyebrow">FILIALDAN GURUHGACHA</span><h1>Hisobingizga<br />aniq nazar.</h1><p>Savdo, zaxira va pul oqimlari bitta ishonchli manzilda.</p></div><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div>; }
function SignUpPage() { if (localAuth) return <AuthPage mode="sign-up" />; return <div className="auth-screen"><div className="auth-intro"><Link href="/" className="brand-lockup"><BrandLogo /></Link><span className="eyebrow">BOSHQARUVNI BIRLASHTIRING</span><h1>Yagona tizim.<br />Aniq qarorlar.</h1><p>Guruhingiz moliyasini filiallar kesimida kuzating.</p></div><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div>; }

function ChartLine({ data, valueKey, secondaryKey }: { data: Dashboard['salesTrend']; valueKey: 'sales'; secondaryKey?: 'cost' }) {
  if (!data?.length) return <div className="chart-empty"><PackageSearch size={21} /> Davr boʻyicha trend yoʻq</div>;
  const nums = data.map(d => Number(d[valueKey]) || 0).concat(secondaryKey ? data.map(d => Number(d[secondaryKey]) || 0) : []);
  const max = Math.max(...nums, 1);
  const points = data.map((d, i) => `${data.length === 1 ? 50 : i / (data.length - 1) * 100},${100 - Number(d[valueKey]) / max * 84}`).join(' ');
  const points2 = secondaryKey ? data.map((d, i) => `${data.length === 1 ? 50 : i / (data.length - 1) * 100},${100 - Number(d[secondaryKey!]) / max * 84}`).join(' ') : '';
  return <div className="chart-area"><div className="chart-labels"><span>{money(max)} soʻm</span><span>{money(max * .5)} soʻm</span><span>0</span></div><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Savdo dinamikasi"><defs><linearGradient id="px-line" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stopColor="#0fb3c7" /><stop offset="1" stopColor="#2fcf5a" /></linearGradient><linearGradient id="px-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#0fb3c7" stopOpacity=".22" /><stop offset="1" stopColor="#2fcf5a" stopOpacity="0" /></linearGradient></defs>{data.length > 1 && <polygon points={`0,100 ${points} 100,100`} fill="url(#px-area)" />}<polyline points={points} fill="none" stroke="url(#px-line)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />{secondaryKey && <polyline points={points2} fill="none" stroke="#1f5fd0" strokeWidth="1.8" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />}</svg><div className="chart-xlabels">{data.map((p, i) => <span key={`${p.label}-${i}`}>{p.label}</span>)}</div></div>;
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
    </div><div className="dash-grid"><Panel title="Savdo va tannarx dinamikasi" subtitle="Davr boʻyicha soʻmda" action={<span className="chart-legend"><i className="legend-green" /> Savdo <i className="legend-amber" /> Tannarx</span>}><ChartLine data={d.salesTrend} valueKey="sales" secondaryKey="cost" /></Panel><Panel title="Eʼtibor talab qiladi" subtitle="Manba maʼlumotlariga asoslangan ogohlantirishlar">{d.alerts.length ? <div className="alert-list">{d.alerts.map(a => <Link href={a.target} className="alert-row" key={a.id} data-testid={`alert-item-${a.id}`}><span className={`alert-icon ${a.severity}`}><AlertCircle size={17} /></span><div><b>{a.title}</b><p>{a.description}</p></div><ArrowRight size={15} /></Link>)}</div> : <div className="inline-empty"><Check size={17} /> Faol ogohlantirishlar yoʻq</div>}</Panel></div>
      <div className="dash-grid lower"><Panel title="Filiallar taqqoslanishi" subtitle="Savdo, foyda va pul holati"><TableWrap><thead><tr><th>FILIAL</th><th>SAVDO</th><th>YALPI FOYDA</th><th>SOF FOYDA</th><th>PUL QOLDIGʻI</th></tr></thead><tbody>{d.branchComparison.map(b => <tr key={b.id}><td><Link href={`/branches/${b.id}`} className="table-main-link" data-testid={`link-branch-${b.id}`}>{b.name}<ArrowRight size={13} /></Link><small>{date(b.updatedAt)}</small></td><td>{money(b.sales)}</td><td>{money(b.grossProfit)}</td><td className={b.netProfit == null ? 'missing' : 'positive'}>{money(b.netProfit)}</td><td>{money(b.cashBalance)}</td></tr>)}</tbody></TableWrap>{!d.branchComparison.length && <div className="inline-empty">Filial taqqoslash maʼlumoti yoʻq</div>}</Panel><Panel title="Xarajatlar tarkibi" subtitle="Kategoriya boʻyicha taqsimot">{d.expenseBreakdown.length ? <div className="breakdown-list">{d.expenseBreakdown.map((x, i) => <div className="breakdown-row" key={`${x.label}-${i}`}><div><span>{x.label}</span><b>{money(x.value)} soʻm</b></div><div className="bar-track"><i style={{ width: `${Math.max(3, Number(x.value) / Math.max(1, ...d.expenseBreakdown.map(z => Number(z.value))) * 100)}%` }} /></div></div>)}</div> : <div className="inline-empty">Tarkib maʼlumoti mavjud emas</div>}</Panel></div>
      <div className="dash-grid lower"><Panel title="Eng koʻp sotilgan mahsulotlar" subtitle="Davr ichida sotilgan miqdor"><TableWrap><thead><tr><th>MAHSULOT</th><th>MIQDOR</th><th>SAVDO</th><th>YALPI FOYDA</th></tr></thead><tbody>{d.topProducts.map(p => <tr key={p.productId}><td><Link className="table-main-link" href={`/stock/product/${p.productId}`} data-testid={`link-product-${p.productId}`}>{p.name}<ArrowRight size={13} /></Link></td><td>{p.quantity}</td><td>{money(p.sales)}</td><td className={p.grossProfit == null ? 'missing' : 'positive'}>{money(p.grossProfit)}</td></tr>)}</tbody></TableWrap>{!d.topProducts.length && <div className="inline-empty">Mahsulot maʼlumoti yoʻq</div>}</Panel><Panel title="Pul oqimi" subtitle="Tushum va chiqimlar"><div className="flow-list">{d.moneyFlow.map((p,i) => <div className="flow-row" key={`${p.label}-${i}`}><span>{p.label}</span><span className="positive"><ArrowDownLeft size={14} /> {money(p.inflow)}</span><span className="negative"><ArrowUpRight size={14} /> {money(p.outflow)}</span></div>)}</div>{!d.moneyFlow.length && <div className="inline-empty">Pul oqimi maʼlumoti yoʻq</div>}</Panel></div>
      <div className="completeness-note" data-testid="status-completeness"><ShieldCheck size={15} /><span>{d.completeness === 'complete' ? 'Hisobot toʻliq' : d.completeness === 'preliminary' ? 'Dastlabki natija — ayrim manbalar hali toʻliq emas' : 'Natija chiqarish uchun maʼlumot yetarli emas'}</span><span className="source-note">Manba: {d.mode === 'demo' ? 'sinov maʼlumotlari' : 'jonli maʼlumotlar'}</span></div></>}
  </>;
}

function BranchesPage({ filters }: { filters: Filters }) {
  const qc = useQueryClient();
  const branchesQ = useListBranches();
  const create = useCreateBranch();
  const { canEdit } = useAccess();
  const [open, setOpen] = useState(false);
  const emptyForm = { name: '', kind: 'pharmacy' as 'pharmacy' | 'warehouse', region: '', address: '', manager: '', fomId: '' };
  const [form, setForm] = useState(emptyForm);
  const [query, setQuery] = useState('');
  const items = (branchesQ.data || []).filter(b => (!filters.branchId || String(b.id) === filters.branchId) && `${b.name} ${b.region} ${b.manager}`.toLowerCase().includes(query.toLowerCase()));
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate({ data: { ...form, fomId: form.fomId || null } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListBranchesQueryKey() }); setOpen(false); setForm(emptyForm); } }); };
  return <><PageHeading title="Filiallar" subtitle="Guruh tarkibini boshqaring va filiallar holatini kuzating" actions={canEdit && <button className="button primary" onClick={() => setOpen(true)} data-testid="button-create-branch"><Plus size={16} /> Filial qoʻshish</button>} />
    <Panel title="Filiallar roʻyxati" subtitle={`${branchesQ.data?.length ?? '—'} ta roʻyxatdagi filial`} action={<label className="search-field"><Search size={15} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filial qidirish" data-testid="input-search-branches" /></label>}>
      <DataState loading={branchesQ.isLoading} error={branchesQ.isError} empty={!branchesQ.isLoading && !branchesQ.isError && !items.length} retry={() => branchesQ.refetch()} />
      {!!items.length && <TableWrap><thead><tr><th>FILIAL</th><th>TURI</th><th>HUDUD</th><th>MASʼUL</th><th>MANBA</th><th>HOLAT</th><th>YANGILANGAN</th><th /></tr></thead><tbody>{items.map(b => <tr key={b.id} data-testid={`row-branch-${b.id}`}><td><Link href={`/branches/${b.id}`} className="table-main-link" data-testid={`link-branch-details-${b.id}`}>{b.name}<ArrowRight size={13} /></Link><small>{b.address || 'Manzil koʻrsatilmagan'}</small></td><td><StatusBadge tone={b.kind === 'warehouse' ? 'info' : 'neutral'}>{b.kind === 'warehouse' ? 'Ombor' : 'Dorixona'}</StatusBadge></td><td>{b.region || '—'}</td><td>{b.manager || '—'}</td><td><StatusBadge tone={b.source === 'demo' ? 'warn' : 'neutral'}>{sourceText(b.source)}</StatusBadge></td><td><StatusBadge tone={b.status === 'active' ? 'good' : 'warn'}>{b.status === 'active' ? 'Faol' : b.status || 'Holat nomaʼlum'}</StatusBadge></td><td>{date(b.updatedAt)}</td><td><Link href={`/branches/${b.id}`} className="icon-button" aria-label="Filialni ochish"><ArrowRight size={16} /></Link></td></tr>)}</tbody></TableWrap>}
    </Panel>
    {open && <div className="modal-backdrop" role="presentation" onClick={() => !create.isPending && setOpen(false)}><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="branch-modal-title" onClick={e => e.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">GURUH TARKIBI</span><h2 id="branch-modal-title">Yangi filial</h2></div><button className="icon-button" onClick={() => setOpen(false)} data-testid="button-close-branch"><X size={18} /></button></div><form onSubmit={submit} className="form-stack"><label>Filial nomi<input required minLength={2} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} data-testid="input-branch-name" /></label><label>Turi<select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value as 'pharmacy' | 'warehouse' })} data-testid="select-branch-kind"><option value="pharmacy">Dorixona (savdo nuqtasi)</option><option value="warehouse">Ombor (markaziy sklad)</option></select></label><label>Hudud<input required value={form.region} onChange={e => setForm({ ...form, region: e.target.value })} data-testid="input-branch-region" /></label><label>Manzil<input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} data-testid="input-branch-address" /></label><label>Filial masʼuli<input value={form.manager} onChange={e => setForm({ ...form, manager: e.target.value })} data-testid="input-branch-manager" /></label><label>FOM filial identifikatori <span className="optional">ixtiyoriy</span><input value={form.fomId} onChange={e => setForm({ ...form, fomId: e.target.value })} data-testid="input-branch-fomid" /></label>{create.isError && <div className="form-error" data-testid="status-branch-error">Filialni saqlashda xatolik. Kiritilgan maʼlumotlarni tekshiring.</div>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => setOpen(false)}>Bekor qilish</button><button className="button primary" disabled={create.isPending} data-testid="button-save-branch">{create.isPending ? 'Saqlanmoqda…' : 'Filialni saqlash'}</button></div></form></div></div>}
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


function AppRoutes({ filters, setFilters }: { filters: Filters; setFilters: (v: Filters) => void }) {
  return <Switch>
    <Route path="/"><Show when="signed-in"><Shell filters={filters} setFilters={setFilters}><DashboardPage filters={filters} /></Shell></Show><Show when="signed-out"><SiteLayout><HomePage /></SiteLayout></Show></Route>
    <Route path="/imkoniyatlar"><SiteLayout><FeaturesPage /></SiteLayout></Route>
    <Route path="/yechimlar"><SiteLayout><SolutionsPage /></SiteLayout></Route>
    <Route path="/qanday-ishlaydi"><SiteLayout><HowPage /></SiteLayout></Route>
    <Route path="/integratsiya"><SiteLayout><IntegrationPage /></SiteLayout></Route>
    <Route path="/xavfsizlik"><SiteLayout><SecurityPage /></SiteLayout></Route>
    <Route path="/savollar"><SiteLayout><FaqPage /></SiteLayout></Route>
    <Route path="/branches"><Show when="signed-in"><Shell filters={filters} setFilters={setFilters}><BranchesPage filters={filters} /></Shell></Show><Show when="signed-out"><Redirect to="/" /></Show></Route>
    <Route path="/branches/:id">{params => <><Show when="signed-in"><Shell filters={filters} setFilters={setFilters}><BranchDetailPage id={Number(params.id)} filters={filters} /></Shell></Show><Show when="signed-out"><Redirect to="/" /></Show></>}</Route>
    <Route path="/sales"><Show when="signed-in"><Shell filters={filters} setFilters={setFilters}><SalesPage filters={filters} /></Shell></Show><Show when="signed-out"><Redirect to="/" /></Show></Route>
    <Route path="/purchases"><Show when="signed-in"><Shell filters={filters} setFilters={setFilters}><PurchasesPage filters={filters} /></Shell></Show><Show when="signed-out"><Redirect to="/" /></Show></Route>
    <Route path="/stock"><Show when="signed-in"><Shell filters={filters} setFilters={setFilters}><StockPage filters={filters} /></Shell></Show><Show when="signed-out"><Redirect to="/" /></Show></Route>
    <Route path="/stock/product/:id">{params => <><Show when="signed-in"><Shell filters={filters} setFilters={setFilters}><StockPage key={params.id} filters={filters} productId={Number(params.id)} /></Shell></Show><Show when="signed-out"><Redirect to="/" /></Show></>}</Route>
    <Route path="/trade"><Redirect to="/sales" /></Route>
    <Route path="/trade/product/:id">{params => <Redirect to={`/stock/product/${params.id}`} />}</Route>
    <Route path="/finance"><Show when="signed-in"><Shell filters={filters} setFilters={setFilters}><MoneyPage filters={filters} /></Shell></Show><Show when="signed-out"><Redirect to="/" /></Show></Route>
    <Route path="/debts"><Show when="signed-in"><Shell filters={filters} setFilters={setFilters}><DebtsPage filters={filters} /></Shell></Show><Show when="signed-out"><Redirect to="/" /></Show></Route>
    <Route path="/catalog"><Show when="signed-in"><Shell filters={filters} setFilters={setFilters}><CatalogPage /></Shell></Show><Show when="signed-out"><Redirect to="/" /></Show></Route>
    <Route path="/profit"><Show when="signed-in"><Shell filters={filters} setFilters={setFilters}><ProfitPage filters={filters} /></Shell></Show><Show when="signed-out"><Redirect to="/" /></Show></Route>
    <Route path="/reports"><Show when="signed-in"><Shell filters={filters} setFilters={setFilters}><ReportsPage filters={filters} /></Shell></Show><Show when="signed-out"><Redirect to="/" /></Show></Route>
    <Route path="/settings"><Show when="signed-in"><Shell filters={filters} setFilters={setFilters}><SettingsPage /></Shell></Show><Show when="signed-out"><Redirect to="/" /></Show></Route>
    <Route path="/users"><Show when="signed-in"><Shell filters={filters} setFilters={setFilters}><UsersPage /></Shell></Show><Show when="signed-out"><Redirect to="/" /></Show></Route>
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
  if (!clerkPubKey && !localAuth) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY');
  return <TooltipProvider><WouterRouter base={basePath}><AppRouter /></WouterRouter><Toaster /></TooltipProvider>;
}
export default App;
