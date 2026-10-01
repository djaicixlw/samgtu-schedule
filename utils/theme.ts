declare global {
  interface Window {
    Telegram?: any;
  }
}

export type ThemePref = 'auto' | 'light' | 'dark';

/**
 * Reads user theme preference from localStorage.
 * Defaults to 'auto' if not explicitly set by the user.
 */
export function getThemePref(): ThemePref {
  if (typeof window === 'undefined') return 'auto';
  try {
    const saved = localStorage.getItem('theme_pref');
    if (saved === 'light' || saved === 'dark' || saved === 'auto') {
      return saved;
    }
  } catch (e) {}
  return 'auto';
}

/**
 * Persists user theme preference to localStorage.
 * Must only be called upon explicit manual user toggle.
 */
export function setThemePref(pref: ThemePref): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('theme_pref', pref);
  } catch (e) {}
}

/**
 * Synchronizes Telegram WebApp header and background colors with current theme.
 */
export function syncTelegramTheme(darkMode: boolean): void {
  if (typeof window === 'undefined') return;
  const tg = window.Telegram?.WebApp;
  if (!tg) return;

  try {
    tg.setHeaderColor?.(darkMode ? '#0f172a' : '#ffffff');
    tg.setBackgroundColor?.(darkMode ? '#020617' : '#eaeff5');
  } catch (e) {}
}
