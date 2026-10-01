/**
 * In-App Logger & Diagnostics System for SamGTU Schedule TMA
 * Ring buffer capped at 150 entries with automatic error interception and system diagnostics.
 */

import { sendCrashReport } from './telemetry';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'ACTION';

export interface LogEntry {
  timestamp: string; // ISO-время по Самаре (UTC+4)
  level: LogLevel;
  category: string;  // 'SCHEDULE' | 'ATTENDANCE' | 'SYNC' | 'UI' | 'NETWORK' | 'SYSTEM'
  message: string;
  data?: any;
}

export interface SystemDiagnostics {
  timestamp: string;
  telegramPlatform: string;
  tgWebAppVersion: string;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight?: number;
  userAgent: string;
  onlineStatus: boolean;
  currentGroupId: string;
  selectedWeek: number;
  localStorageUsageBytes: number;
  totalLogsCount: number;
  errorLogsCount: number;
}

// Format ISO string in Samara time (UTC+4)
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

const MAX_LOGS = 150;

export class InAppLogger {
  private buffer: LogEntry[] = [];
  private listeners: Set<() => void> = new Set();
  private isInternalLogging = false;
  private isInterceptionInitialized = false;

  constructor() {
    this.initErrorInterception();
  }

  private pushEntry(entry: LogEntry): void {
    if (this.buffer.length >= MAX_LOGS) {
      this.buffer.shift();
    }
    this.buffer.push(entry);
    this.notifyListeners();
  }

  public log(level: LogLevel, category: string, message: string, data?: any): void {
    const entry: LogEntry = {
      timestamp: getSamaraTimestamp(),
      level,
      category,
      message,
      data: data !== undefined ? this.sanitizeData(data) : undefined
    };
    this.pushEntry(entry);
  }

  public info(category: string, message: string, data?: any): void {
    this.log('INFO', category, message, data);
  }

  public warn(category: string, message: string, data?: any): void {
    this.log('WARN', category, message, data);
  }

  public error(category: string, message: string, data?: any): void {
    this.log('ERROR', category, message, data);
  }

  public action(category: string, message: string, data?: any): void {
    this.log('ACTION', category, message, data);
  }

  public debug(category: string, message: string, data?: any): void {
    this.log('DEBUG', category, message, data);
  }

  public getLogs(): LogEntry[] {
    return [...this.buffer];
  }

  public clearLogs(): void {
    this.buffer = [];
    this.notifyListeners();
  }

  public exportLogsAsJSON(): string {
    return JSON.stringify(
      {
        exportedAt: getSamaraTimestamp(),
        diagnostics: getSystemDiagnostics(),
        logs: this.buffer
      },
      null,
      2
    );
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach(fn => {
      try {
        fn();
      } catch {}
    });
  }

  private sanitizeData(data: any): any {
    try {
      if (data instanceof Error) {
        return {
          name: data.name,
          message: data.message,
          stack: data.stack
        };
      }
      if (typeof data === 'object' && data !== null) {
        return JSON.parse(JSON.stringify(data, (key, val) => {
          if (val instanceof Error) {
            return { name: val.name, message: val.message, stack: val.stack };
          }
          if (typeof val === 'function') {
            return '[Function]';
          }
          return val;
        }));
      }
      return data;
    } catch {
      return String(data);
    }
  }

  public initErrorInterception(): void {
    if (this.isInterceptionInitialized) return;
    if (typeof window === 'undefined') return;

    this.isInterceptionInitialized = true;

    // 1. window.onerror
    window.addEventListener('error', (event: ErrorEvent) => {
      const isMutedScriptError =
        (!event.message || event.message === 'Script error.') &&
        (!event.filename || event.filename === '') &&
        (!event.lineno || event.lineno === 0);

      if (isMutedScriptError) {
        this.warn('SYSTEM', 'External/Injected script event (muted by browser CORS policy)', {
          filename: event.filename || '<external/injected>',
          lineno: event.lineno,
          colno: event.colno,
          note: 'Muted by browser security policy. Usually caused by Telegram WebView bridge injection or browser extension.'
        });
        return;
      }

      this.error('SYSTEM', event.message || 'Uncaught window error', {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack
      });
      try {
        sendCrashReport({
          component: 'window.onerror',
          message: event.message || 'Uncaught window error',
          stack: event.error?.stack || (event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined)
        });
      } catch {}
    });

    // 2. window.onunhandledrejection
    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const errorMsg = reason instanceof Error ? reason.message : (reason?.message || String(reason || 'Unhandled Promise Rejection'));
      const errorStack = reason instanceof Error ? reason.stack : reason?.stack;
      this.error('NETWORK', `Unhandled Promise Rejection: ${errorMsg}`, {
        reason: errorMsg,
        stack: errorStack
      });
      try {
        sendCrashReport({
          component: 'window.onunhandledrejection',
          message: errorMsg,
          stack: errorStack
        });
      } catch {}
    });

    // 3. Monkey-patch console.error and console.warn
    if (typeof console !== 'undefined') {
      const originalConsoleError = console.error;
      const originalConsoleWarn = console.warn;

      console.error = (...args: any[]) => {
        try {
          originalConsoleError.apply(console, args);
        } catch {}
        if (!this.isInternalLogging) {
          this.isInternalLogging = true;
          try {
            const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
            this.error('SYSTEM', msg);
          } catch {} finally {
            this.isInternalLogging = false;
          }
        }
      };

      console.warn = (...args: any[]) => {
        try {
          originalConsoleWarn.apply(console, args);
        } catch {}
        if (!this.isInternalLogging) {
          this.isInternalLogging = true;
          try {
            const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
            this.warn('SYSTEM', msg);
          } catch {} finally {
            this.isInternalLogging = false;
          }
        }
      };
    }
  }
}

export const logger = new InAppLogger();

/**
 * Calculates current localStorage usage in bytes.
 */
export const getLocalStorageUsage = (): number => {
  if (typeof window === 'undefined' || !window.localStorage) return 0;
  let totalBytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const val = localStorage.getItem(key) || '';
        totalBytes += (key.length + val.length) * 2;
      }
    }
  } catch {}
  return totalBytes;
};

/**
 * Gathers a full system diagnostic snapshot.
 */
export const getSystemDiagnostics = (): SystemDiagnostics => {
  const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;

  let currentGroupId = 'ingt-310';
  let selectedWeek = 1;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      currentGroupId = localStorage.getItem('my_group_id') || localStorage.getItem('selected_group_id') || 'ingt-310';
      selectedWeek = Number(localStorage.getItem('selected_week')) || 1;
    }
  } catch {}

  const logs = logger.getLogs();
  const errorLogsCount = logs.filter(l => l.level === 'ERROR').length;

  return {
    timestamp: getSamaraTimestamp(),
    telegramPlatform: tg?.platform || (typeof navigator !== 'undefined' ? (navigator.userAgent.includes('Android') ? 'android_browser' : navigator.userAgent.includes('iPhone') ? 'ios_browser' : 'desktop_browser') : 'unknown'),
    tgWebAppVersion: tg?.version || 'not_in_tg',
    isExpanded: tg?.isExpanded ?? false,
    viewportHeight: tg?.viewportHeight ?? (typeof window !== 'undefined' ? window.innerHeight : 0),
    viewportStableHeight: tg?.viewportStableHeight,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    onlineStatus: typeof navigator !== 'undefined' ? navigator.onLine : true,
    currentGroupId,
    selectedWeek,
    localStorageUsageBytes: getLocalStorageUsage(),
    totalLogsCount: logs.length,
    errorLogsCount
  };
};

export { sendCrashReport } from './telemetry';

