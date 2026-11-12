import {
  BadgePercent, Bell, Building2, ClipboardList, CreditCard, FileBarChart2, LayoutDashboard,
  Loader2, LogOut, ScrollText, Settings2, Users, type LucideIcon,
} from 'lucide-react';
import { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Redirect, useLocation } from 'wouter';
import { BrandLogo } from '@/components/brand-logo';
import { useAccess } from '@/lib/access';
import { useClerk } from '@/lib/auth';
import { ownerApi } from './shared';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  match?: (path: string) => boolean;
  badgeKey?: 'companies' | 'requests' | 'alerts';
  group?: 'main' | 'more';
};

const nav: NavItem[] = [
  { href: '/owner', label: 'Umumiy dashboard', icon: LayoutDashboard, match: (p) => p === '/owner' || p === '/owner/', group: 'main' },
  { href: '/owner/companies', label: 'Kompaniyalar', icon: Building2, match: (p) => p.startsWith('/owner/companies'), badgeKey: 'companies', group: 'main' },
  { href: '/owner/payments', label: 'Toʻlovlar', icon: CreditCard, match: (p) => p.startsWith('/owner/payments'), group: 'main' },
  { href: '/owner/requests', label: 'Arizalar', icon: ClipboardList, match: (p) => p.startsWith('/owner/requests'), badgeKey: 'requests', group: 'main' },
  { href: '/owner/plans', label: 'Tariflar va rejalar', icon: BadgePercent, match: (p) => p.startsWith('/owner/plans'), group: 'more' },
  { href: '/owner/users', label: 'Foydalanuvchilar', icon: Users, match: (p) => p.startsWith('/owner/users'), group: 'more' },
  { href: '/owner/reports', label: 'Hisobotlar', icon: FileBarChart2, match: (p) => p.startsWith('/owner/reports'), group: 'more' },
  { href: '/owner/alerts', label: 'Bildirishnomalar', icon: Bell, match: (p) => p.startsWith('/owner/alerts'), badgeKey: 'alerts', group: 'more' },
  { href: '/owner/audit', label: 'Audit jurnali', icon: ScrollText, match: (p) => p.startsWith('/owner/audit'), group: 'more' },
  { href: '/owner/settings', label: 'Tizim sozlamalari', icon: Settings2, match: (p) => p.startsWith('/owner/settings'), group: 'more' },
];

function titleFor(path: string) {
  const hit = nav.find((n) => (n.match ? n.match(path) : path === n.href));
  return hit?.label || 'Owner CRM';
}

export function OwnerShell({ children }: { children: ReactNode }) {
  const access = useAccess();
  const { signOut } = useClerk();
  const [location] = useLocation();

  const dash = useQuery({
    queryKey: ['owner-crm-dashboard'],
    queryFn: () => ownerApi<{ kpis: { companies: number; pendingApplications: number } }>('/api/platform/crm/dashboard'),
    staleTime: 20_000,
    enabled: access.loaded && access.isPlatformAdmin && !access.actingAsCompany,
  });
  const alerts = useQuery({
    queryKey: ['owner-crm-alerts'],
    queryFn: () => ownerApi<{ unread: number }>('/api/platform/crm/alerts'),
    staleTime: 20_000,
    enabled: access.loaded && access.isPlatformAdmin && !access.actingAsCompany,
  });

  const badges = {
    companies: dash.data?.kpis.companies || 0,
    requests: dash.data?.kpis.pendingApplications || 0,
    alerts: alerts.data?.unread || 0,
  };

  if (!access.loaded) {
    return (
      <div className="ocrm-boot">
        <Loader2 className="spin" size={28} />
        <p>Owner panel yuklanmoqda…</p>
      </div>
    );
  }
  if (!access.isPlatformAdmin) return <Redirect to="/owner/kirish" />;
  if (access.actingAsCompany) return <Redirect to="/" />;

  const main = nav.filter((n) => n.group === 'main');
  const more = nav.filter((n) => n.group === 'more');

  return (
    <div className="ocrm-shell" data-testid="page-owner-console">
      <aside className="ocrm-sidebar">
        <div className="ocrm-side-brand">
          <BrandLogo />
          <div>
            <b>PHARMXS</b>
            <span className="ocrm-role-pill">Platforma egasi · Super Admin</span>
          </div>
        </div>

        <div className="ocrm-nav-group">
          <span className="ocrm-nav-label">Asosiy modullar</span>
          <nav className="ocrm-nav">
            {main.map((item) => {
              const on = item.match ? item.match(location) : location === item.href;
              const badge = item.badgeKey ? badges[item.badgeKey] : 0;
              return (
                <Link key={item.href} href={item.href} className={`ocrm-nav-link ${on ? 'on' : ''}`}>
                  <item.icon size={16} />
                  <span>{item.label}</span>
                  {badge > 0 && <em className="ocrm-nav-badge">{badge > 99 ? '99+' : badge}</em>}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="ocrm-nav-group">
          <span className="ocrm-nav-label">Qoʻshimcha</span>
          <nav className="ocrm-nav">
            {more.map((item) => {
              const on = item.match ? item.match(location) : location === item.href;
              const badge = item.badgeKey ? badges[item.badgeKey] : 0;
              return (
                <Link key={item.href} href={item.href} className={`ocrm-nav-link ${on ? 'on' : ''}`}>
                  <item.icon size={16} />
                  <span>{item.label}</span>
                  {badge > 0 && <em className={`ocrm-nav-badge ${item.badgeKey === 'alerts' ? 'dot' : ''}`}>{item.badgeKey === 'alerts' ? '' : (badge > 99 ? '99+' : badge)}</em>}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="ocrm-side-foot">
          <div className="ocrm-side-pulse">
            <b>Platforma holati</b>
            <span>{dash.data ? `${dash.data.kpis.companies} kompaniya · ${dash.data.kpis.pendingApplications} ariza` : 'Yangilanmoqda…'}</span>
          </div>
          <button type="button" className="ocrm-logout" onClick={() => void signOut({ redirectUrl: '/owner/kirish' })}>
            <LogOut size={15} /> Chiqish
          </button>
        </div>
      </aside>

      <div className="ocrm-workspace">
        <header className="ocrm-topbar">
          <div>
            <p className="ocrm-top-eyebrow">PHARMXS Owner CRM</p>
            <h1>{titleFor(location)}</h1>
          </div>
          <div className="ocrm-top-actions">
            <Link href="/owner/alerts" className="ocrm-icon-btn" title="Bildirishnomalar">
              <Bell size={16} />
              {badges.alerts > 0 && <i />}
            </Link>
            <Link href="/owner/settings" className="ocrm-icon-btn" title="Sozlamalar">
              <Settings2 size={16} />
            </Link>
          </div>
        </header>
        <main className="ocrm-main">{children}</main>
      </div>
    </div>
  );
}
