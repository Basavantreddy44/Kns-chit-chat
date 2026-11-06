import { AuthError } from './AuthError';
import { DUPLICATE_MESSAGES } from './apiRegistrationService';
import { createUser, isEmailTaken, isUsernameTaken } from './mockUserStore';
import {
  validateEmail,
  validateFullName,
  validateNewPassword,
  validateUsername,
} from '../utils/validation';

/**
 * ⚠️  MOCK REGISTRATION PROVIDER — DEVELOPMENT ONLY ⚠️
 *
 * Behaves like the real API (see apiRegistrationService.js): same inputs,
 * same outputs, same AuthError codes. Like a real server, it re-validates
 * every field and re-checks uniqueness instead of trusting the browser.
 */

const CHECK_LATENCY_MS = 450;
const REGISTER_LATENCY_MS = 1300;

/** Resolves after `ms`, or rejects early if the caller aborts. */
function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new AuthError('Request cancelled.', 'ABORTED'));
    });
  });
}

export async function checkUsernameAvailability(username, signal) {
  await wait(CHECK_LATENCY_MS, signal);
  return { available: !(await isUsernameTaken(username)) };
}

export async function checkEmailAvailability(email, signal) {
  await wait(CHECK_LATENCY_MS, signal);
  return { available: !(await isEmailTaken(email)) };
}

export async function register({ fullName, username, email, password }) {
  if (import.meta.env.DEV) {
    console.warn('[KNS Chit-Chat] Using MOCK registration service (development only).');
  }
  await wait(REGISTER_LATENCY_MS);

  // 1. Server-side validation (never trust the client).
  const validationErrors = Object.fromEntries(
    [
      ['fullName', validateFullName(fullName)],
      ['username', validateUsername(username)],
      ['email', validateEmail(email)],
      ['password', validateNewPassword(password)],
    ].filter(([, message]) => message),
  );
  if (Object.keys(validationErrors).length) {
    throw new AuthError(
      'Please correct the highlighted fields and try again.',
      'VALIDATION_ERROR',
      422,
      validationErrors,
    );
  }

  // 2. Uniqueness — the authoritative check happens here, at write time.
  if (await isUsernameTaken(username)) {
    throw new AuthError('Some details are already in use.', 'CONFLICT', 409, {
      username: DUPLICATE_MESSAGES.username,
    });
  }
  if (await isEmailTaken(email)) {
    throw new AuthError('Some details are already in use.', 'CONFLICT', 409, {
      email: DUPLICATE_MESSAGES.email,
    });
  }

  // 3. Create the account (password is hashed inside the store).
  const user = await createUser({ fullName, username, email, password });
  return { user };
}
