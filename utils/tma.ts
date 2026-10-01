declare global {
  interface Window {
    Telegram?: any;
  }
}

// Protect against dynamic chunk loading failures after new deployments
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', () => {
    window.location.reload();
  });
}

/**
 * Initializes Telegram Mini App SDK.
 * Calls tg.ready(), tg.expand(), and for Telegram >= 7.7 disables vertical swipes
 * to prevent accidental sheet collapse during schedule scrolling.
 * Must be invoked before React render() in index.tsx.
 */
export function initTelegram(): void {
  if (typeof window === 'undefined') return;

  const tg = window.Telegram?.WebApp;
  if (!tg) return;

  try {
    tg.ready?.();
    tg.expand?.();
    if (tg.isVersionAtLeast?.('7.7')) {
      tg.disableVerticalSwipes?.();
    }
  } catch (err) {
    console.warn('[TMA] Failed to initialize Telegram WebApp SDK:', err);
  }
}

/**
 * Toggles vertical swipe gestures for closing the Telegram Mini App sheet.
 * Useful for modal dialogs and gesture-driven UI components.
 *
 * @param on - If true, sheet vertical swipes are locked/disabled. If false, re-enabled.
 */
export const lockVerticalSwipes = (on: boolean): void => {
  if (typeof window === 'undefined') return;

  const tg = window.Telegram?.WebApp;
  if (!tg?.isVersionAtLeast?.('7.7')) return;

  try {
    if (on) {
      tg.disableVerticalSwipes?.();
    } else {
      tg.enableVerticalSwipes?.();
    }
  } catch (err) {
    console.warn('[TMA] Failed to toggle vertical swipes:', err);
  }
};
