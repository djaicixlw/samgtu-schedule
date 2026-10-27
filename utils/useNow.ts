import { useState, useEffect } from 'react';
import { samaraISO } from './samaraDate';

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

/**
 * Pure predicate: has the Samara calendar day changed between two Dates?
 * Exported for unit tests (AUD-031).
 */
export function samaraDayChanged(prev: Date, next: Date): boolean {
  const a = samaraISO(prev);
  const b = samaraISO(next);
  return a !== b;
}

/**
 * AUD-031: day-granularity ticker for tree-level consumers.
 *
 * App.tsx derives only day-stable values from the live clock (semester week,
 * week date range, today's day name) — none of them can change within a single
 * Samara calendar day. The plain `useNow(60000)` at the App level therefore
 * re-rendered the whole component tree every minute for no visible effect.
 *
 * This hook checks the clock at the same 60s cadence (plus visibility/focus,
 * same as useNow) but calls setState ONLY when the Samara day actually rolled
 * over. Visible behavior is identical (day/week/date-range still update at
 * midnight); the per-minute full-tree re-render is gone. Minute-precision
 * consumers (the "current pair" indicator) keep their own `useNow` locally.
 */
export function useSamaraDayTick(intervalMs: number = 60000): Date {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const rollIfDayChanged = () => {
      setNow(prev => (samaraDayChanged(prev, new Date()) ? new Date() : prev));
    };

    const timer = setInterval(rollIfDayChanged, intervalMs);

    const handleVisibilityOrFocus = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        rollIfDayChanged();
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
