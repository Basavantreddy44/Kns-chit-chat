import { useCallback, useEffect, useState } from 'react';

/**
 * Debounced "is this value available?" check (username, email…).
 *
 *   const check = useAvailabilityCheck(username, {
 *     enabled: isFormatValid,            // only ask the server about valid values
 *     checkFn: checkUsernameAvailability, // (value, signal) => Promise<{ available }>
 *     takenMessage: 'Username is taken.',
 *   });
 *
 * - Waits `delay` ms after the user stops typing before calling the server.
 * - Cancels the in-flight request when the value changes, so a slow old
 *   response can never overwrite a newer one.
 * - status: 'idle' | 'checking' | 'available' | 'taken' | 'error'
 * - markTaken(message): lets the form apply a "taken" result that came back
 *   from the final registration request (the authoritative check).
 *
 * Pass a stable `checkFn` (a module-level import), not an inline arrow.
 */
export function useAvailabilityCheck(value, { enabled, checkFn, takenMessage, delay = 500 }) {
  const [result, setResult] = useState({ status: 'idle', message: '', checkedValue: '' });

  useEffect(() => {
    if (!enabled) {
      setResult({ status: 'idle', message: '', checkedValue: '' });
      return undefined;
    }

    const controller = new AbortController();
    setResult({ status: 'checking', message: '', checkedValue: value });

    const timerId = setTimeout(async () => {
      try {
        const { available } = await checkFn(value, controller.signal);
        if (controller.signal.aborted) return;
        setResult({
          status: available ? 'available' : 'taken',
          message: available ? '' : takenMessage,
          checkedValue: value,
        });
      } catch {
        if (controller.signal.aborted) return;
        // Not fatal: the backend re-checks on submit anyway.
        setResult({
          status: 'error',
          message: "Couldn't check availability right now. We'll verify it when you sign up.",
          checkedValue: value,
        });
      }
    }, delay);

    return () => {
      clearTimeout(timerId);
      controller.abort();
    };
  }, [value, enabled, checkFn, takenMessage, delay]);

  const markTaken = useCallback(
    (message) => setResult({ status: 'taken', message: message || takenMessage, checkedValue: value }),
    [takenMessage, value],
  );

  return { ...result, markTaken };
}
