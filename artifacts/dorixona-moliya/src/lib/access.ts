import { useGetCurrentUser } from '@workspace/api-client-react';

export type Role = 'admin' | 'finance' | 'viewer';

export const roleLabels: Record<Role, string> = {
  admin: 'Administrator',
  finance: 'Moliya xodimi',
  viewer: 'Kuzatuvchi',
};

export function roleLabel(role: string | undefined): string {
  return roleLabels[role as Role] ?? 'Foydalanuvchi';
}

type MeExtra = { isOwner?: boolean };

export function useAccess() {
  const me = useGetCurrentUser();
  const role = me.data?.role as Role | undefined;
  const isOwner = !!(me.data as MeExtra | undefined)?.isOwner;
  return {
    role,
    loaded: !!me.data,
    isAdmin: role === 'admin',
    /** Platforma maʼlumotlarini kiritish / oʻzgartirish (kuzatuvchida yoʻq). */
    canEdit: role === 'admin' || role === 'finance',
    /** Faqat bosh admin — foydalanuvchi yaratish / oʻchirish / parol. */
    canManageUsers: isOwner,
    isOwner,
    readOnly: role === 'viewer',
  };
}
