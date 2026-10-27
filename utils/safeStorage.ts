/**
 * AUD-037: the single safe localStorage layer for quota-sensitive writers.
 *
 * Defect being fixed: QuotaExceededError (and any other Storage failure) was
 * swallowed by bare try/catch at every setItem site — when localStorage filled
 * up, attendance marks existed ONLY in React state and vanished on restart with
 * zero diagnostics (see master plan §5.1, cluster «тихие деградации»).
 *
 * What this module does:
 *   - safeSetItem: try/catch around setItem; on failure keeps the value in an
 *     in-memory fallback (survives for the SESSION, not across restarts — that
 *     is the honest limit without IndexedDB), marks the key degraded and sends
 *     a `quota_exceeded` telemetry event via the existing utils/telemetry.ts
 *     (key + size included; self-throttled, never throws).
 *   - safeGetItem: transparent read-through — localStorage first, then the
 *     in-memory fallback, so a degraded write is still visible to the same
 *     session's readers (marks are not lost mid-session).
 *   - safeRemoveItem / isStorageDegraded / quota counters for tests.
 *
 * Scope note (AUD-037): wired into the CRITICAL writers only — attendance
 * journal payload (attendance.ts), the attendance merge base
 * (utils/attendanceBase.ts) and the homework pending-push flag
 * (HomeworkTracker). Everything else keeps plain localStorage.
 */

import { sendCrashReport } from './telemetry';

/** In-memory session fallback: key -> last value that failed to persist. */
const memoryFallback = new Map<string, string>();

/** Keys whose latest write did NOT reach localStorage. */
const degradedKeys = new Set<string>();

/** Counters (exported for tests/telemetry consumers). */
export const safeStorageStats = {
  quotaErrors: 0,
  memoryHits: 0
};

export interface SafeSetResult {
  /** true when the value reached localStorage. */
  ok: boolean;
  /** true when the value is only in the in-memory fallback. */
  fromMemory: boolean;
}

export function safeSetItem(
  key: string,
  value: string,
  opts?: { component?: string }
): SafeSetResult {
  if (typeof localStorage === 'undefined') {
    memoryFallback.set(key, value);
    degradedKeys.add(key);
    return { ok: false, fromMemory: true };
  }
  try {
    localStorage.setItem(key, value);
    // A successful write heals the key (quota may have been freed).
    degradedKeys.delete(key);
    memoryFallback.delete(key);
    return { ok: true, fromMemory: false };
  } catch (e) {
    memoryFallback.set(key, value);
    degradedKeys.add(key);
    safeStorageStats.quotaErrors++;
    reportQuotaExceeded(key, value, e, opts);
    return { ok: false, fromMemory: true };
  }
}

export function safeGetItem(key: string): string | null {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    if (v !== null) return v;
  } catch {
    // localStorage unreadable — fall through to the in-memory copy
  }
  if (memoryFallback.has(key)) {
    safeStorageStats.memoryHits++;
    return memoryFallback.get(key) as string;
  }
  return null;
}

export function safeRemoveItem(key: string): void {
  memoryFallback.delete(key);
  degradedKeys.delete(key);
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  } catch {
    // removal failure is not degrading — nothing to keep alive
  }
}

/** True when the given key (or any key) is currently only in memory. */
export function isStorageDegraded(key?: string): boolean {
  return key ? degradedKeys.has(key) : degradedKeys.size > 0;
}

/** Keys currently served from the in-memory fallback (diagnostics/tests). */
export function getDegradedKeys(): string[] {
  return Array.from(degradedKeys);
}

/** Test hygiene: reset all module state. */
export function resetSafeStorageForTests(): void {
  memoryFallback.clear();
  degradedKeys.clear();
  safeStorageStats.quotaErrors = 0;
  safeStorageStats.memoryHits = 0;
  lastQuotaReportAt = 0;
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

const QUOTA_REPORT_COOLDOWN_MS = 30_000;
let lastQuotaReportAt = 0;

/**
 * Sends a `quota_exceeded` telemetry event (fire-and-forget, never throws).
 * The message carries the key and the payload size; sendCrashReport's own
 * 2-minute dedup plus this module's 30s cooldown keep a write-storm from
 * flooding /report-error.
 */
function reportQuotaExceeded(
  key: string,
  value: string,
  err: unknown,
  opts?: { component?: string }
): void {
  const now = Date.now();
  if (now - lastQuotaReportAt < QUOTA_REPORT_COOLDOWN_MS) return;
  lastQuotaReportAt = now;

  const sizeLabel = `${value.length} chars (~${Math.ceil(value.length / 1024)} KB)`;
  void sendCrashReport({
    message: `quota_exceeded: localStorage.setItem failed for key "${key}" (${sizeLabel}); value kept in memory for this session`,
    stack: err instanceof Error ? (err.stack || err.message) : String(err),
    component: opts?.component || 'safeStorage'
  }).catch(() => {
    // sendCrashReport already never throws; this is belt-and-suspenders
  });
}
