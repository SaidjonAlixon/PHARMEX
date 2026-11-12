import { FormEvent, useState } from 'react';
import { Loader2, Shield } from 'lucide-react';
import { Redirect } from 'wouter';
import { BrandLogo } from '@/components/brand-logo';
import { useAccess } from '@/lib/access';

export { OwnerDashboardPage } from './owner/dashboard';
export { OwnerCompaniesPage } from './owner/companies';
export { OwnerCompanyDetailPage } from './owner/company-detail';
export { OwnerPaymentsPage } from './owner/payments';
export { OwnerRequestsPage } from './owner/requests';

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Xatolik');
  return data as T;
}

export function OwnerLoginPage() {
  const access = useAccess();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  if (access.loaded && access.isPlatformAdmin) {
    return <Redirect to={access.actingAsCompany ? '/' : '/owner'} />;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError('');
    try {
      const user = await api<{ role: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      });
      if (user.role !== 'platform_admin') {
        setError('Bu sahifa faqat platforma egasi uchun. Kompaniya kabineti: https://pharmxs.uz/sign-in');
        await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
        setPending(false);
        return;
      }
      window.location.replace('/owner');
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  };

  return (
    <div className="owner-auth">
      <form className="owner-auth-card" onSubmit={submit} data-testid="form-owner-login">
        <BrandLogo />
        <h1>Platforma egasi</h1>
        <p>Kompaniyalar, toʻlovlar va arizalar — toʻliq CRM boshqaruv.</p>
        {error && <div className="notice error">{error}</div>}
        <label>
          <span>Login</span>
          <input required autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="admin" data-testid="input-owner-login" />
        </label>
        <label>
          <span>Parol</span>
          <input required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-owner-password" />
        </label>
        <button type="submit" className="button primary plan-buy" disabled={pending}>
          {pending ? <Loader2 className="spin" size={16} /> : <Shield size={16} />}
          {pending ? 'Tekshirilmoqda…' : 'Kirish'}
        </button>
      </form>
    </div>
  );
}
