import { useGetCurrentUser } from '@workspace/api-client-react';

export type Role = 'platform_admin' | 'admin' | 'finance' | 'viewer';

export const roleLabels: Record<Role, string> = {
  platform_admin: 'Platforma admin',
  admin: 'Administrator',
  finance: 'Moliya xodimi',
  viewer: 'Kuzatuvchi',
};

export function roleLabel(role: string | undefined): string {
  return roleLabels[role as Role] ?? 'Foydalanuvchi';
}

type MeExtra = { isOwner?: boolean; isPlatformAdmin?: boolean; organization?: { subscriptionStatus?: string } | null };

export function useAccess() {
  const me = useGetCurrentUser();
  const role = me.data?.role as Role | undefined;
  const extra = me.data as MeExtra | undefined;
  const isOwner = !!extra?.isOwner;
  const isPlatformAdmin = role === 'platform_admin' || !!extra?.isPlatformAdmin;
  const sub = extra?.organization?.subscriptionStatus;
  return {
    role,
    loaded: !!me.data,
    isAdmin: role === 'admin' || isPlatformAdmin,
    isPlatformAdmin,
    /** Platforma maʼlumotlarini kiritish / oʻzgartirish (kuzatuvchida yoʻq). */
    canEdit: role === 'admin' || role === 'finance' || isPlatformAdmin,
    /** Faqat bosh admin — foydalanuvchi yaratish / oʻchirish / parol. */
    canManageUsers: isOwner || isPlatformAdmin,
    isOwner,
    readOnly: role === 'viewer',
    subscriptionStatus: sub,
    subscriptionBlocked: sub === 'past_due' || sub === 'canceled',
  };
}
