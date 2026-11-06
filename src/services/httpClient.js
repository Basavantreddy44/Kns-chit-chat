import { AuthError } from './AuthError';

/**
 * Tiny fetch wrapper shared by every API service.
 *  - Prefixes VITE_API_BASE_URL
 *  - JSON in / JSON out
 *  - 15 s timeout + optional caller AbortSignal (used to cancel stale
 *    username/email availability checks)
 *  - Network problems become AuthErrors; HTTP status handling is left to
 *    each service, because "409" means different things per endpoint.
 */

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = 15000;

export async function request(path, { method = 'GET', body, query, signal } = {}) {
  if (!API_BASE_URL) {
    throw new AuthError('API mode is enabled but VITE_API_BASE_URL is not set.', 'CONFIG_ERROR');
  }

  const queryString = query ? `?${new URLSearchParams(query).toString()}` : '';
  const url = `${API_BASE_URL}${path}${queryString}`;

  // One controller for both our timeout and the caller's signal.
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort);

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
      },
      credentials: 'include', // allows httpOnly session/refresh cookies
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      if (timedOut) {
        throw new AuthError('The server took too long to respond. Please try again.', 'TIMEOUT');
      }
      throw new AuthError('Request cancelled.', 'ABORTED');
    }
    throw new AuthError('Unable to reach the server. Check your internet connection.', 'NETWORK_ERROR');
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', forwardAbort);
  }

  // Body may be empty or not JSON — parse defensively.
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  return { ok: response.ok, status: response.status, data };
}

export function rateLimitedError(status = 429) {
  return new AuthError('Too many attempts. Please wait a moment and try again.', 'RATE_LIMITED', status);
}

export function serverError(status = 500) {
  return new AuthError('Something went wrong on our side. Please try again later.', 'SERVER_ERROR', status);
}
