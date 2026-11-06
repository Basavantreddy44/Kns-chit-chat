import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as authService from '../services/authService';

/**
 * Makes the current user and login/logout actions available anywhere in
 * the component tree via the `useAuth()` hook.
 */
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Restore a saved session on first load (e.g. after a page refresh).
  const [session, setSession] = useState(() => authService.getCurrentSession());

  // Log out of the UI if the provider ends the session (expired or revoked).
  useEffect(() => authService.subscribeToSessionEnd(() => setSession(null)), []);

  const login = useCallback(async (credentials) => {
    const newSession = await authService.login(credentials);
    setSession(newSession);
    return newSession;
  }, []);

  const logout = useCallback(async () => {
    await authService.logout();
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({
      user: session?.user ?? null,
      isAuthenticated: Boolean(session),
      authMode: authService.AUTH_MODE,
      login,
      logout,
    }),
    [session, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>.');
  return context;
}
