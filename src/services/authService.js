import * as apiProvider from './apiAuthService';
import * as mockProvider from './mockAuthService';
import * as supabaseProvider from './supabaseAuthService';
import { saveSession, loadSession, clearSession } from './sessionStorage';

/**
 * Single entry point the UI uses for authentication.
 *
 * The UI never imports a provider directly — it only calls these functions.
 * Which provider runs is decided by VITE_AUTH_MODE, so moving to a real
 * backend needs no UI changes.
 */

const PROVIDERS = { api: apiProvider, mock: mockProvider, supabase: supabaseProvider };

export const AUTH_MODE = PROVIDERS[import.meta.env.VITE_AUTH_MODE] ? import.meta.env.VITE_AUTH_MODE : 'mock';

const provider = PROVIDERS[AUTH_MODE];

export async function login({ identifier, password, rememberMe = false }) {
  const session = await provider.login({
    identifier: identifier.trim(),
    password,
    rememberMe,
  });
  saveSession(session, rememberMe);
  return session;
}

export async function logout() {
  try {
    await provider.logout();
  } finally {
    clearSession();
  }
}

export function getCurrentSession() {
  return loadSession();
}

/** For providers that can end a session on their own. Returns an unsubscribe. */
export function subscribeToSessionEnd(callback) {
  if (!provider.onSessionEnded) return () => {};
  return provider.onSessionEnded(() => {
    clearSession();
    callback();
  });
}

/** Placeholder hooks for OAuth providers — wire these to your backend later. */
export const SOCIAL_PROVIDERS = {
  google: { label: 'Google', enabled: false },
  facebook: { label: 'Facebook', enabled: false },
};
