import * as clerk from '@clerk/react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// AUTH_MODE=local replaces Clerk with email/password, Google and admin-approved sessions served by the API.
export const localAuth = import.meta.env.VITE_AUTH_MODE === 'local';

type LocalUser = { id: number; username: string | null; email: string; displayName: string; role: string };
const LocalAuthContext = createContext<LocalUser | null>(null);
const homeUrl = import.meta.env.BASE_URL;

function LocalProvider({ children }: { children?: ReactNode }) {
  const [state, setState] = useState<{ loaded: boolean; user: LocalUser | null }>({ loaded: false, user: null });
  useEffect(() => {
    fetch('/api/auth/session', { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : null))
      .then(user => setState({ loaded: true, user }))
      .catch(() => setState({ loaded: true, user: null }));
  }, []);
  if (!state.loaded) return null;
  return <LocalAuthContext.Provider value={state.user}>{children}</LocalAuthContext.Provider>;
}

function LocalShow({ when, children }: { when: unknown; children?: ReactNode }) {
  const user = useContext(LocalAuthContext);
  const visible = when === 'signed-in' ? !!user : when === 'signed-out' ? !user : false;
  return visible ? <>{children}</> : null;
}

function useLocalUser() {
  const user = useContext(LocalAuthContext);
  return {
    isLoaded: true,
    isSignedIn: !!user,
    user: user && { id: String(user.id), firstName: user.displayName, fullName: user.displayName, primaryEmailAddress: { emailAddress: user.email || user.username || '' } },
  };
}

function useLocalClerk() {
  return {
    signOut: async (options?: { redirectUrl?: string }) => {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
      window.location.assign(options?.redirectUrl || homeUrl);
    },
    addListener: () => () => {},
  };
}

export const ClerkProvider = (localAuth ? LocalProvider : clerk.ClerkProvider) as unknown as typeof clerk.ClerkProvider;
export const Show = (localAuth ? LocalShow : clerk.Show) as unknown as typeof clerk.Show;
export const SignIn = clerk.SignIn;
export const SignUp = clerk.SignUp;
export const useUser = (localAuth ? useLocalUser : clerk.useUser) as unknown as typeof clerk.useUser;
export const useClerk = (localAuth ? useLocalClerk : clerk.useClerk) as unknown as typeof clerk.useClerk;
