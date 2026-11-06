import { useCallback, useEffect, useRef } from 'react';

/**
 * setTimeout that is automatically cancelled when the component unmounts,
 * so a delayed redirect can never fire after the user has left the page.
 *
 *   const schedule = useSafeTimeout();
 *   schedule(() => navigate('/dashboard'), 900);
 */
export function useSafeTimeout() {
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return useCallback((callback, delay) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(callback, delay);
  }, []);
}
