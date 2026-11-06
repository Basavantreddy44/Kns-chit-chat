import { AuthError } from './AuthError';
import { request, rateLimitedError, serverError } from './httpClient';

/**
 * REAL authentication provider — talks to your backend.
 *
 * Expected backend contract (see docs/BACKEND_API.md):
 *   POST {VITE_API_BASE_URL}/auth/login
 *   body:     { identifier: string, password: string, rememberMe: boolean }
 *   200 OK:   { token: string, user: { id, name, username, email, avatarUrl? } }
 *   4xx/5xx:  { message?: string }
 */

function mapResponseToSession(data) {
  if (!data || typeof data.token !== 'string' || !data.user) {
    throw new AuthError('Unexpected response from the server.', 'SERVER_ERROR');
  }
  return { token: data.token, user: data.user };
}

export async function login({ identifier, password, rememberMe }) {
  const { ok, status, data } = await request('/auth/login', {
    method: 'POST',
    body: { identifier, password, rememberMe },
  });

  if (ok) return mapResponseToSession(data);

  switch (status) {
    case 400:
    case 401:
      // Deliberately vague: never reveal whether the account exists.
      throw new AuthError(
        'Incorrect email/username or password. Please try again.',
        'INVALID_CREDENTIALS',
        status,
      );
    case 403:
      throw new AuthError(
        data?.message || 'Your account is locked. Please contact support.',
        'ACCOUNT_LOCKED',
        status,
      );
    case 429:
      throw rateLimitedError(status);
    default:
      throw serverError(status);
  }
}

export async function logout() {
  try {
    await request('/auth/logout', { method: 'POST' });
  } catch {
    // Logging out locally must still succeed even if the server is unreachable.
  }
}
