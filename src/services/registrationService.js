import * as apiProvider from './apiRegistrationService';
import * as mockProvider from './mockRegistrationService';
import * as supabaseProvider from './supabaseRegistrationService';
import { AUTH_MODE } from './authService';
import { normalizeEmail, normalizeFullName, normalizeUsername } from '../utils/validation';

/**
 * Single entry point the UI uses for sign-up.
 *
 * Like authService, it hides whether the mock or the real API is running,
 * and it normalises input (trim, lowercase) the same way every time so the
 * availability checks and the final registration see identical values.
 *
 * Registration does NOT log the user in — they are sent to the Login page.
 */

const provider = { api: apiProvider, mock: mockProvider, supabase: supabaseProvider }[AUTH_MODE];

export function checkUsernameAvailability(username, signal) {
  return provider.checkUsernameAvailability(normalizeUsername(username), signal);
}

export function checkEmailAvailability(email, signal) {
  return provider.checkEmailAvailability(normalizeEmail(email), signal);
}

export function register({ fullName, username, email, password }) {
  return provider.register({
    fullName: normalizeFullName(fullName),
    username: normalizeUsername(username),
    email: normalizeEmail(email),
    password, // passwords are sent exactly as typed — never trimmed or altered
  });
}
