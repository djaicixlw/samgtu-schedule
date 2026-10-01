import { useState, useEffect } from 'react';

/**
 * Custom React hook that provides a reactive current Date object,
 * ticking at the specified interval (default: 60s) and refreshing
 * immediately when the document becomes visible or gains focus.
 */
export function useNow(intervalMs: number = 60000): Date {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const updateNow = () => {
      setNow(new Date());
    };

    const timer = setInterval(updateNow, intervalMs);

    const handleVisibilityOrFocus = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        updateNow();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleVisibilityOrFocus);
    }

    return () => {
      clearInterval(timer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleVisibilityOrFocus);
      }
    };
  }, [intervalMs]);

  return now;
}
