import { AuthError } from './AuthError';
import { rateLimitedError, serverError } from './httpClient';
import { getSupabase, isSupabaseConfigured, setSessionPersistence } from './supabaseClient';

/**
 * Supabase authentication provider.
 *
 * Email logins go straight to Supabase Auth. Supabase can only sign in by
 * email, so username logins go through the login-with-username Edge Function,
 * which looks up the email on the server. A browser-callable lookup would let
 * anyone turn a public username into a private email address.
 */

// The Supabase client owns the real tokens and refreshes them. orbit.session
// only caches the user for the UI, so a copy of the token would just go stale.
const MANAGED_TOKEN = 'managed-by-supabase';

const NOT_FOUND = 404;

function invalidCredentials(status) {
  // Deliberately vague: never reveal whether the account exists.
  return new AuthError(
    'Incorrect email/username or password. Please try again.',
    'INVALID_CREDENTIALS',
    status,
  );
}

function toAuthError(code, status) {
  switch (code) {
    case 'invalid_credentials':
      return invalidCredentials(status);
    case 'email_not_confirmed':
      return new AuthError(
        'Please confirm your email first. Use the link we sent when you signed up.',
        'EMAIL_NOT_CONFIRMED',
        status,
      );
    case 'user_banned':
      return new AuthError('Your account is locked. Please contact support.', 'ACCOUNT_LOCKED', status);
    case 'over_request_rate_limit':
      return rateLimitedError(status);
    default:
      if (status === 429) return rateLimitedError(status);
      if (!status) {
        return new AuthError('Unable to reach the server. Check your internet connection.', 'NETWORK_ERROR');
      }
      return serverError(status);
  }
}

async function signInWithEmail(supabase, email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw toAuthError(error.code, error.status);
  return data.user;
}

async function signInWithUsername(supabase, username, password) {
  const { data, error } = await supabase.functions.invoke('login-with-username', {
    body: { username, password },
  });

  if (error) {
    const status = error.context?.status;
    // An undeployed function's 404 has no CORS headers, so browsers report it
    // as a failed request with no status, the same as being offline.
    if (status === NOT_FOUND || !status) {
      throw new AuthError(
        'Username login is unavailable right now. Check your connection, or log in with your email address.',
        'SERVER_ERROR',
        status ?? null,
      );
    }
    const body = await error.context?.json?.().catch(() => null);
    throw toAuthError(body?.code, status);
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
  if (sessionError) throw toAuthError(sessionError.code, sessionError.status);
  return sessionData.user;
}

async function toSessionUser(supabase, authUser) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('username, full_name, avatar_url')
    .eq('id', authUser.id)
    .maybeSingle();

  // A failed profile read shouldn't block login: fall back to the sign-up details.
  const metadata = authUser.user_metadata ?? {};
  return {
    id: authUser.id,
    name: profile?.full_name ?? metadata.full_name ?? '',
    username: profile?.username ?? metadata.username ?? '',
    email: authUser.email,
    avatarUrl: profile?.avatar_url ?? null,
  };
}

export async function login({ identifier, password, rememberMe }) {
  const supabase = getSupabase();
  setSessionPersistence(rememberMe);

  const value = identifier.toLowerCase();
  const authUser = value.includes('@')
    ? await signInWithEmail(supabase, value, password)
    : await signInWithUsername(supabase, value, password);

  return { token: MANAGED_TOKEN, user: await toSessionUser(supabase, authUser) };
}

export async function logout() {
  // Local scope clears this browser even if the server is unreachable.
  await getSupabase().auth.signOut({ scope: 'local' });
}

/** Calls back when the session is gone, e.g. it expired or was revoked. Returns an unsubscribe. */
export function onSessionEnded(callback) {
  if (!isSupabaseConfigured()) return () => {};

  const { data } = getSupabase().auth.onAuthStateChange((event, session) => {
    if (!session && (event === 'INITIAL_SESSION' || event === 'SIGNED_OUT')) callback();
  });
  return () => data.subscription.unsubscribe();
}
