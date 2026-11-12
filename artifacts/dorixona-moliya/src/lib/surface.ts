/** Public marketing + company cabinet (domain). Owner console is IP:9080. */

const configured = (import.meta.env.VITE_OWNER_HOSTS as string | undefined)
  ?.split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean) ?? [];

export const PUBLIC_APP_URL = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.replace(/\/$/, '')
  || 'https://pharmxs.uz';

export const OWNER_PUBLIC_URL = (import.meta.env.VITE_OWNER_PUBLIC_URL as string | undefined)?.replace(/\/$/, '')
  || 'http://138.249.7.30:9080';

export function isOwnerSurface(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  const port = window.location.port;
  if (port === '9080') return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (configured.includes(host)) return true;
  return false;
}

export function isPublicSurface(): boolean {
  return !isOwnerSurface();
}
