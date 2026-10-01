/**
 * Telegram Telemetry & Error Reporting System
 * Provides silent, background fire-and-forget crash reporting to developer Telegram channel.
 */

import { WORKER_BASE } from './cloudSync';

export interface CrashReportPayload {
  message: string;
  stack?: string;
  component?: string;
  group?: string;
  platform?: string;
  userAgent?: string;
  timestamp?: string;
}

// Local in-memory deduplication cache: errorKey -> timestamp (ms)
const localErrorCache = new Map<string, number>();
export const LOCAL_DEDUP_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Format ISO string in Samara time (UTC+4)
 */
export const getSamaraTimestamp = (date: Date = new Date()): string => {
  try {
    const samaraMs = date.getTime() + (date.getTimezoneOffset() * 60000) + (4 * 3600000);
    const d = new Date(samaraMs);
    const pad = (n: number) => String(n).padStart(2, '0');
    const padMs = (n: number) => String(n).padStart(3, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${padMs(d.getMilliseconds())}+04:00`;
  } catch {
    return date.toISOString();
  }
};

/**
 * Detect client platform for telemetry reporting.
 */
export function getTelemetryPlatform(): string {
  if (typeof window === 'undefined' && typeof globalThis === 'undefined') return 'NodeJS/Environment';
  const tg = (typeof window !== 'undefined' && (window as any).Telegram?.WebApp) ||
             (typeof globalThis !== 'undefined' && (globalThis as any).Telegram?.WebApp);
  if (tg?.platform) {
    return `Telegram (${tg.platform}${tg.version ? ` v${tg.version}` : ''})`;
  }
  const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';
  if (/Android/i.test(ua)) return 'Android Browser';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS Browser';
  if (/Windows/i.test(ua)) return 'Windows Desktop';
  if (/Macintosh/i.test(ua)) return 'macOS Desktop';
  if (/Linux/i.test(ua)) return 'Linux Desktop';
  return 'Web Browser';
}

/**
 * Gets currently active student group ID from storage.
 */
export function getCurrentGroup(): string {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return localStorage.getItem('my_group_id') ||
             localStorage.getItem('selected_group_id') ||
             'ingt-310';
    }
  } catch {}
  return 'ingt-310';
}

/**
 * Clear the local telemetry deduplication cache (useful for testing).
 */
export function clearTelemetryCache(): void {
  localErrorCache.clear();
}

/**
 * Checks if the error is locally throttled / deduplicated.
 */
export function isLocallyThrottled(message: string, component?: string, now = Date.now()): boolean {
  const key = `${component || 'general'}::${(message || '').trim()}`;
  const lastSent = localErrorCache.get(key);
  if (lastSent !== undefined && (now - lastSent < LOCAL_DEDUP_COOLDOWN_MS)) {
    return true;
  }
  return false;
}

/**
 * Fire-and-forget telemetry crash report sender.
 * Never throws an error outside, handles local deduplication (2 min), and sends POST to ${WORKER_BASE}/report-error.
 */
export async function sendCrashReport(errorData: {
  message: string;
  stack?: string;
  component?: string;
  group?: string;
}): Promise<void> {
  try {
    const rawMessage = errorData.message || 'Unknown error';
    const component = errorData.component || 'Unknown component';

    // 1. Local deduplication check: no duplicate errors within 2 minutes
    const now = Date.now();
    if (isLocallyThrottled(rawMessage, component, now)) {
      return;
    }

    const key = `${component}::${rawMessage.trim()}`;
    localErrorCache.set(key, now);

    // 2. Prepare payload
    const payload: CrashReportPayload = {
      message: rawMessage,
      stack: errorData.stack,
      component: component,
      group: errorData.group || getCurrentGroup(),
      platform: getTelemetryPlatform(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown UA',
      timestamp: getSamaraTimestamp()
    };

    // 3. Fire-and-forget POST to Cloudflare Worker
    const endpoint = `${WORKER_BASE}/report-error`;
    
    await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    }).catch(() => {
      // Quietly ignore network failures in fire-and-forget
    });
  } catch {
    // Absolutely never throw out of sendCrashReport
  }
}
