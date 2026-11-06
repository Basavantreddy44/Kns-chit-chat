import { AuthError } from './AuthError';
import { request, rateLimitedError, serverError } from './httpClient';

/**
 * REAL registration provider — talks to your backend.
 *
 *   GET  /auth/check-username?username=...   200 { available: boolean }
 *   GET  /auth/check-email?email=...         200 { available: boolean }
 *   POST /auth/register                      201 { user: {...} }
 *        body: { fullName, username, email, password }
 *        409 { field: 'username' | 'email' }               duplicate
 *        422 { errors: { fieldName: 'message', ... } }     validation failed
 *
 * The availability checks are a UX convenience. The backend must still
 * enforce uniqueness in POST /auth/register (unique DB indexes), because two
 * people can pick the same name at the same moment.
 */

const KNOWN_FIELDS = ['fullName', 'username', 'email', 'password'];

export const DUPLICATE_MESSAGES = {
  username: 'This username is already taken. Please choose another.',
  email: 'An account with this email already exists. Try logging in instead.',
};

async function checkAvailability(path, query, signal) {
  const { ok, status, data } = await request(path, { query, signal });
  if (ok && typeof data?.available === 'boolean') return { available: data.available };
  if (status === 429) throw rateLimitedError(status);
  throw serverError(status);
}

export function checkUsernameAvailability(username, signal) {
  return checkAvailability('/auth/check-username', { username }, signal);
}

export function checkEmailAvailability(email, signal) {
  return checkAvailability('/auth/check-email', { email }, signal);
}

/** Keep only field errors we know how to display, so nothing unexpected leaks into the UI. */
function pickKnownFieldErrors(errors) {
  if (!errors || typeof errors !== 'object') return null;
  const picked = Object.fromEntries(
    Object.entries(errors).filter(
      ([field, message]) => KNOWN_FIELDS.includes(field) && typeof message === 'string',
    ),
  );
  return Object.keys(picked).length ? picked : null;
}

export async function register({ fullName, username, email, password }) {
  const { ok, status, data } = await request('/auth/register', {
    method: 'POST',
    body: { fullName, username, email, password },
  });

  if (ok) return { user: data?.user ?? null };

  if (status === 409) {
    const field = data?.field === 'email' ? 'email' : 'username';
    throw new AuthError(
      'Some details are already in use. Please review the highlighted fields.',
      'CONFLICT',
      status,
      { [field]: DUPLICATE_MESSAGES[field] },
    );
  }

  if (status === 400 || status === 422) {
    throw new AuthError(
      'Please correct the highlighted fields and try again.',
      'VALIDATION_ERROR',
      status,
      pickKnownFieldErrors(data?.errors),
    );
  }

  if (status === 429) throw rateLimitedError(status);
  throw serverError(status);
}
