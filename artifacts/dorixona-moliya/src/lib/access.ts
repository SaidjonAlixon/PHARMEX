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

export type OrgBrief = {
  id: number;
  name: string;
  planCode?: string;
  planName?: string;
  subscriptionStatus?: string;
  trialEndsAt?: string | null;
  planExpiresAt?: string | null;
  endsAt?: string | null;
  daysLeft?: number | null;
};

type MeExtra = {
  isOwner?: boolean;
  isPlatformAdmin?: boolean;
  actingAsCompany?: boolean;
  actingAsOrgId?: number | null;
  organization?: OrgBrief | null;
};

export function useAccess() {
  const me = useGetCurrentUser();
  const role = me.data?.role as Role | undefined;
  const extra = me.data as MeExtra | undefined;
  const isOwner = !!extra?.isOwner;
  const isPlatformAdmin = role === 'platform_admin' || !!extra?.isPlatformAdmin;
  const organization = extra?.organization ?? null;
  const actingAsCompany = isPlatformAdmin && (!!extra?.actingAsCompany || !!organization);
  const sub = organization?.subscriptionStatus;
  return {
    role,
    loaded: !!me.data,
    loading: me.isLoading || me.isFetching,
    isAdmin: role === 'admin' || isPlatformAdmin,
    isPlatformAdmin,
    /** Platforma maʼlumotlarini kiritish / oʻzgartirish (kuzatuvchida yoʻq). */
    canEdit: role === 'admin' || role === 'finance' || isPlatformAdmin,
    /** Kompaniya admini — faqat oʻz org foydalanuvchilari; platforma admini — hammasi. */
    canManageUsers: role === 'admin' || isPlatformAdmin,
    isOwner,
    readOnly: role === 'viewer' && !actingAsCompany,
    organization,
    actingAsCompany,
    subscriptionStatus: sub,
    // Platforma egasi kompaniyaga kirganda cheklov yoʻq — boshqaruv uchun.
    subscriptionBlocked: (sub === 'past_due' || sub === 'canceled') && !actingAsCompany,
  };
}
