/**
 * AUD-041: the «В сети» indicator with a health-ping source of truth.
 *
 * Defect being fixed: the indicator trusted only `navigator.onLine`, which is
 * a statement about the NETWORK INTERFACE, not about our worker. With Wi-Fi up
 * and the worker down the app showed «В сети» and silently accumulated
 * unsynced marks (master plan §5.1, cluster «обратная связь пользователю»).
 *
 * New truth: online = navigator.onLine !== false AND a lightweight GET /status
 * answered ok within PING_TIMEOUT_MS. The probe result is cached for
 * CACHE_TTL_MS (60s) module-wide (shared between mounts), re-probed on
 * visibility/focus/online events and on a slow visible-tab interval. The UI is
 * unchanged — same green/red dot in App.tsx; only the source of truth moved.
 */

import { useEffect, useState } from 'react';
import { WORKER_BASE } from './cloudSync';

export const HEALTH_PING_TTL_MS = 60_000;
export const HEALTH_PING_TIMEOUT_MS = 5_000;
const VISIBLE_RECHECK_MS = 60_000;

type CachedCheck = { at: number; ok: boolean };

let lastCheck: CachedCheck | null = null;
let inflight: Promise<boolean> | null = null;

/** Test seam: drop the module-level cache. */
export function resetHealthPingCache(): void {
  lastCheck = null;
  inflight = null;
}

/** Last probe result without triggering a network call (tests/diagnostics). */
export function getLastHealthCheck(): CachedCheck | null {
  return lastCheck;
}

/**
 * Probe the worker's health endpoint. Cached for HEALTH_PING_TTL_MS.
 * offline = no answer (network error / timeout / non-2xx) OR navigator.onLine === false.
 */
export async function probeServerHealth(force = false): Promise<boolean> {
  // Radio-level offline is authoritative and needs no request.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    lastCheck = { at: Date.now(), ok: false };
    return false;
  }

  const now = Date.now();
  if (!force && lastCheck && now - lastCheck.at < HEALTH_PING_TTL_MS) {
    return lastCheck.ok;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch(`${WORKER_BASE}/status`, {
        method: 'GET',
        cache: 'no-store',
        signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(HEALTH_PING_TIMEOUT_MS)
          : undefined
      });
      const ok = res.ok;
      lastCheck = { at: Date.now(), ok };
      return ok;
    } catch {
      lastCheck = { at: Date.now(), ok: false };
      return false;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Combined truth used by the indicator: radio online AND server answered. */
function computeOnline(): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  // Before the first probe resolves we keep the optimistic default (true) so
  // the indicator does not flash red on every cold start.
  return lastCheck ? lastCheck.ok : true;
}

/**
 * React hook feeding the App-header status dot. Same states as before
 * (boolean), same element — only the source of truth changed.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() => computeOnline());

  useEffect(() => {
    let disposed = false;
    let recheckTimer: ReturnType<typeof setInterval> | null = null;

    const apply = (v: boolean) => {
      if (!disposed) setOnline(v);
    };

    const refresh = async (force = false) => {
      apply(await probeServerHealth(force));
    };

    const onRadioEvent = () => {
      // navigator.onLine flipped: apply immediately (no wait for the probe).
      apply(computeOnline());
      void refresh(true);
    };

    const onVisible = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        void refresh(true);
      }
    };

    // First probe (async: a dead worker turns the dot red as soon as known).
    void refresh(true);

    if (typeof window !== 'undefined') {
      window.addEventListener('online', onRadioEvent);
      window.addEventListener('offline', onRadioEvent);
      window.addEventListener('focus', onVisible);
      document.addEventListener('visibilitychange', onVisible);
    }

    recheckTimer = setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) {
        void refresh(true);
      }
    }, VISIBLE_RECHECK_MS);

    return () => {
      disposed = true;
      if (recheckTimer) clearInterval(recheckTimer);
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onRadioEvent);
        window.removeEventListener('offline', onRadioEvent);
        window.removeEventListener('focus', onVisible);
        document.removeEventListener('visibilitychange', onVisible);
      }
    };
  }, []);

  return online;
}
