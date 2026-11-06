/**
 * Persists the logged-in session.
 *  - "Remember me" checked   -> localStorage  (survives browser restarts)
 *  - "Remember me" unchecked -> sessionStorage (cleared when the tab closes)
 *
 * Note: for production, prefer an httpOnly cookie set by the backend for the
 * token, and store only non-sensitive user info here.
 */

const SESSION_KEY = 'orbit.session';

function safeStorage(type) {
  try {
    const storage = window[type];
    const probe = '__orbit_probe__';
    storage.setItem(probe, probe);
    storage.removeItem(probe);
    return storage;
  } catch {
    return null; // storage blocked (private mode, browser settings…)
  }
}

export function saveSession(session, rememberMe) {
  clearSession();
  const storage = safeStorage(rememberMe ? 'localStorage' : 'sessionStorage');
  storage?.setItem(SESSION_KEY, JSON.stringify(session));
}

export function loadSession() {
  for (const type of ['localStorage', 'sessionStorage']) {
    const raw = safeStorage(type)?.getItem(SESSION_KEY);
    if (!raw) continue;
    try {
      const session = JSON.parse(raw);
      if (session?.token && session?.user) return session;
    } catch {
      // Corrupted entry — ignore and fall through.
    }
  }
  return null;
}

export function clearSession() {
  safeStorage('localStorage')?.removeItem(SESSION_KEY);
  safeStorage('sessionStorage')?.removeItem(SESSION_KEY);
}
