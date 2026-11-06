import { useCallback, useState } from 'react';

const STORAGE_KEY = 'kns.theme';

function readStoredTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    return null; // storage blocked (private mode, browser settings…)
  }
}

function preferredTheme() {
  return readStoredTheme() ?? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

/** Call once before the first render so the page never flashes the wrong theme. */
export function initTheme() {
  applyTheme(preferredTheme());
}

export function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || preferredTheme());

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Not saved: the choice still applies until the page reloads.
      }
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
