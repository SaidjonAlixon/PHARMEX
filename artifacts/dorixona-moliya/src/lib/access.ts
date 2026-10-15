import { useGetCurrentUser } from '@workspace/api-client-react';

export type Role = 'admin' | 'finance' | 'viewer';

export const roleLabels: Record<Role, string> = { admin: 'Administrator', finance: 'Moliya xodimi', viewer: 'Kuzatuvchi' };

export function roleLabel(role: string | undefined): string {
  return roleLabels[role as Role] ?? 'Foydalanuvchi';
}

export function useAccess() {
  const me = useGetCurrentUser();
  const role = me.data?.role as Role | undefined;
  return {
    role,
    loaded: !!me.data,
    isAdmin: role === 'admin',
    canEdit: role === 'admin' || role === 'finance',
    readOnly: role === 'viewer',
  };
}
