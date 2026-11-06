import { AuthError } from './AuthError';
import { DUPLICATE_MESSAGES } from './apiRegistrationService';
import { rateLimitedError, serverError } from './httpClient';
import { getSupabase, setSessionPersistence } from './supabaseClient';

/**
 * Supabase registration provider.
 *
 * The database is the final authority: the trigger in
 * supabase/migrations creates the profile and rejects invalid or duplicate
 * usernames. Availability checks are only for live feedback in the form.
 */

async function checkAvailability(fn, args, signal) {
  let query = getSupabase().rpc(fn, args);
  if (signal) query = query.abortSignal(signal);

  const { data, error } = await query;
  if (error) throw serverError();
  return { available: data === true };
}

export function checkUsernameAvailability(username, signal) {
  return checkAvailability('is_username_available', { p_username: username }, signal);
}

export function checkEmailAvailability(email, signal) {
  return checkAvailability('is_email_available', { p_email: email }, signal);
}

function conflict(field) {
  return new AuthError(
    'Some details are already in use. Please review the highlighted fields.',
    'CONFLICT',
    409,
    { [field]: DUPLICATE_MESSAGES[field] },
  );
}

async function toRegistrationError(error, username) {
  if (error.code === 'user_already_exists' || error.code === 'email_exists') return conflict('email');

  if (error.code === 'weak_password') {
    return new AuthError('Please correct the highlighted fields and try again.', 'VALIDATION_ERROR', 422, {
      password: error.message,
    });
  }

  if (error.status === 429 || error.code?.startsWith('over_')) return rateLimitedError(429);
  if (!error.status) {
    return new AuthError('Unable to reach the server. Check your internet connection.', 'NETWORK_ERROR');
  }

  // The trigger's failure reaches us only as a generic database error. The
  // usual cause is two people claiming one username at the same moment.
  const { available } = await checkUsernameAvailability(username).catch(() => ({ available: true }));
  return available ? serverError(error.status) : conflict('username');
}

export async function register({ fullName, username, email, password }) {
  const supabase = getSupabase();
  setSessionPersistence(false);

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, username },
      emailRedirectTo: `${window.location.origin}/login`,
    },
  });

  if (error) throw await toRegistrationError(error, username);

  // With email confirmation on, Supabase answers an existing address with a
  // placeholder user rather than an error. Its identities list is empty.
  if (data.user?.identities?.length === 0) throw conflict('email');

  // With email confirmation off, sign-up starts a session. The app's flow is
  // that registering does not log in, so end it and send them to Login.
  if (data.session) await supabase.auth.signOut({ scope: 'local' });

  return {
    user: { id: data.user?.id, name: fullName, username, email },
    needsEmailConfirmation: !data.session,
  };
}
