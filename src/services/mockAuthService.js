import { AuthError } from './AuthError';
import { verifyCredentials } from './mockUserStore';

/**
 * ⚠️  MOCK AUTHENTICATION PROVIDER — DEVELOPMENT ONLY ⚠️
 *
 * Simulates a backend so the UI can be built and tested without a server.
 * It is only used when VITE_AUTH_MODE=mock. Accounts come from the mock user
 * store: the demo account in .env.development plus anyone who registers.
 *
 * It mirrors the real API contract exactly (same inputs, same output shape,
 * same AuthError codes), so switching to the real backend is a config change.
 */

const SIMULATED_LATENCY_MS = 1200;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Creates a random, obviously-fake token so nobody mistakes it for a real JWT. */
function createMockToken() {
  const random = crypto.getRandomValues(new Uint32Array(4));
  return `mock.${Array.from(random, (n) => n.toString(16)).join('')}`;
}

export async function login({ identifier, password }) {
  if (import.meta.env.DEV) {
    console.warn('[KNS Chit-Chat] Using MOCK authentication service (development only).');
  }

  await wait(SIMULATED_LATENCY_MS);
  const user = await verifyCredentials(identifier, password);

  if (!user) {
    // Same vague message the real API returns — never reveal which part was wrong.
    throw new AuthError(
      'Incorrect email/username or password. Please try again.',
      'INVALID_CREDENTIALS',
      401,
    );
  }

  return { token: createMockToken(), user };
}

export async function logout() {
  await wait(200);
}
