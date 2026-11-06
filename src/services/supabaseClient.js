import { createClient } from '@supabase/supabase-js';
import { AuthError } from './AuthError';

/**
 * The one shared Supabase client. It is created on first use so that mock and
 * API modes keep working when no Supabase settings exist.
 *
 * Only the publishable key belongs here. It is designed to ship to browsers;
 * row level security in the database is what protects the data. Never put the
 * secret key in a VITE_ variable, because those are bundled into the page.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const AUTH_STORAGE_KEY = 'orbit.supabase.auth';

function browserStorage(type) {
  try {
    return window[type];
  } catch {
    return null; // storage blocked (private mode, browser settings…)
  }
}

// "Remember me" decides where Supabase keeps its tokens, matching sessionStorage.js:
// localStorage survives browser restarts, sessionStorage ends with the tab.
let activeStorageType = browserStorage('localStorage')?.getItem(AUTH_STORAGE_KEY)
  ? 'localStorage'
  : 'sessionStorage';

const rememberMeStorage = {
  getItem: (key) => browserStorage(activeStorageType)?.getItem(key) ?? null,
  setItem: (key, value) => browserStorage(activeStorageType)?.setItem(key, value),
  removeItem: (key) => {
    browserStorage('localStorage')?.removeItem(key);
    browserStorage('sessionStorage')?.removeItem(key);
  },
};

/** Call before signing in, so the new session is written to the right place. */
export function setSessionPersistence(rememberMe) {
  rememberMeStorage.removeItem(AUTH_STORAGE_KEY);
  activeStorageType = rememberMe ? 'localStorage' : 'sessionStorage';
}

/** For requests the client library doesn't cover, such as uploads with progress. */
export const getSupabaseSettings = () => ({ url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY });

export function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
}

let client = null;

export function getSupabase() {
  if (!isSupabaseConfigured()) {
    throw new AuthError(
      'Supabase mode is enabled but VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY is not set.',
      'CONFIG_ERROR',
    );
  }
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        storage: rememberMeStorage,
        storageKey: AUTH_STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        // Confirming an email must not log the user in: they log in on /login.
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}
