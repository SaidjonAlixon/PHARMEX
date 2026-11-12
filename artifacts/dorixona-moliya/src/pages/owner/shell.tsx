import { Building2, ClipboardList, CreditCard, LayoutDashboard, LogOut, type LucideIcon } from 'lucide-react';
import { ReactNode } from 'react';
import { Link, Redirect, useLocation } from 'wouter';
import { BrandLogo } from '@/components/brand-logo';
import { useAccess } from '@/lib/access';
import { useClerk } from '@/lib/auth';
import { Loader2 } from 'lucide-react';

const nav: { href: string; label: string; icon: LucideIcon; match?: (path: string) => boolean }[] = [
  { href: '/owner', label: 'Dashboard', icon: LayoutDashboard, match: (p) => p === '/owner' || p === '/owner/' },
  { href: '/owner/companies', label: 'Kompaniyalar', icon: Building2, match: (p) => p.startsWith('/owner/companies') },
  { href: '/owner/payments', label: 'Toʻlovlar', icon: CreditCard, match: (p) => p.startsWith('/owner/payments') },
  { href: '/owner/requests', label: 'Arizalar', icon: ClipboardList, match: (p) => p.startsWith('/owner/requests') },
];

export function OwnerShell({ children }: { children: ReactNode }) {
  const access = useAccess();
  const { signOut } = useClerk();
  const [location] = useLocation();

  if (!access.loaded) {
    return (
      <div className="owner-auth">
        <div className="owner-auth-card" style={{ alignItems: 'center' }}>
          <Loader2 className="spin" size={28} />
          <p className="muted-line">Owner panel yuklanmoqda…</p>
        </div>
      </div>
    );
  }
  if (!access.isPlatformAdmin) return <Redirect to="/owner/kirish" />;
  if (access.actingAsCompany) return <Redirect to="/" />;

  return (
    <div className="ocrm-shell" data-testid="page-owner-console">
      <aside className="ocrm-sidebar">
        <div className="ocrm-side-brand">
          <BrandLogo />
          <div>
            <b>Platforma egasi</b>
            <span>CRM boshqaruv</span>
          </div>
        </div>
        <nav className="ocrm-nav">
          {nav.map((item) => {
            const on = item.match ? item.match(location) : location === item.href;
            return (
              <Link key={item.href} href={item.href} className={`ocrm-nav-link ${on ? 'on' : ''}`}>
                <item.icon size={16} /> {item.label}
              </Link>
            );
          })}
        </nav>
        <button type="button" className="ocrm-logout" onClick={() => void signOut({ redirectUrl: '/owner/kirish' })}>
          <LogOut size={15} /> Chiqish
        </button>
      </aside>
      <main className="ocrm-main">{children}</main>
    </div>
  );
}
