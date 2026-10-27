/**
 * AUD-023: unified cloud sync ENGINE — pure TypeScript, no React.
 *
 * Why this exists: the sync pattern (pull -> merge -> conditional push, plus
 * debounce / visibility throttling / failed-push queue) was hand-rolled in three
 * trackers with drift between them. This module is the single orchestration core;
 * the trackers (and the thin `useCloudSync` React hook) only supply adapters:
 *
 *   fetchState({ etag }) -> { status: 'ok' | 'not-modified' | 'error', data?, etag? }
 *       Performs the network GET. When the server answers 304 the adapter returns
 *       'not-modified' WITHOUT parsing or building the remote state — the engine
 *       then skips merge and setState entirely (no wasted work, no phantom writes).
 *   pushState(state) -> boolean
 *   mergeFn(local, remote) -> { state, hasLocalNewer? }
 *       Pure function. `hasLocalNewer` (auto-heal, AUD-012 semantics) makes the
 *       engine re-push the merged state because a local edit never reached the cloud.
 *   getState / setState — the engine never owns state; it only orchestrates it.
 *
 * Semantics preserved from the verified attendance pattern (AUD-004/010/012):
 *   - one in-flight flush per scope; a request made while a flush runs lets the
 *     running loop pick up the LATEST state afterwards (coalescing, like
 *     runCoalescedSync in attendance.ts);
 *   - visibility/online pulls are throttled (default 60s, AUD-010);
 *   - failed pushes leave a durable pending flag; the next visibility/online
 *     event or successful pull delivers them (queue of undelivered pushes).
 *
 * Attendance boundary (honest note): `syncAttendanceWithCloud` (attendance.ts)
 * keeps its own verified pull/push pipeline because /v3/att has NO server-side
 * ETag (If-None-Match is honored only by /sync/* GET in the worker) and its
 * debounce/throttle/merge3 semantics are pinned by four suites. Migrating it
 * would either duplicate the core's work or change verified behavior, so per the
 * Phase-2 criterion it stays as-is by design, not by omission.
 */

export type FetchStatus = 'ok' | 'not-modified' | 'error';

export interface FetchResult<TRemote> {
  status: FetchStatus;
  data?: TRemote;
  /** Fresh ETag from a 200 response (the adapter owns extraction from headers). */
  etag?: string;
}

/** Per-scope ETag cache. The default is in-memory for the session. */
export interface EtagStore {
  get(scope: string): string | undefined;
  set(scope: string, etag: string): void;
}

/**
 * Durable "push not delivered" flag per scope. The default binds to localStorage
 * so a failed push survives a reload; trackers may pass an adapter that reuses
 * their own legacy key (homework reuses `hw_pending_push_{gid}` from AUD-012).
 */
export interface PendingStore {
  has(scope: string): boolean;
  mark(scope: string): void;
  clear(scope: string): void;
}

export interface MergeOutcome<TState> {
  state: TState;
  /** true when the merged state contains local data the cloud has not seen yet. */
  hasLocalNewer?: boolean;
}

export interface CloudSyncEngineConfig<TRemote, TState> {
  /** Identity of the synced entity, e.g. `homework:ingt-310`. Keys all caches. */
  scope: string;
  fetchState: (req: { etag?: string }) => Promise<FetchResult<TRemote>>;
  pushState: (state: TState) => Promise<boolean>;
  mergeFn: (local: TState, remote: TRemote) => MergeOutcome<TState>;
  getState: () => TState;
  setState: (state: TState) => void;
  onMerged?: (state: TState, remote: TRemote | null) => void;
  /** Called after every flush attempt with its outcome (true = delivered). */
  onPushed?: (ok: boolean) => void;
  /** Minimum interval between visibility/online-triggered pulls. Default 60s. */
  throttleMs?: number;
  /** Push debounce window (coalesces bursts of edits). Default 400ms. */
  debounceMs?: number;
  etagStore?: EtagStore;
  pendingStore?: PendingStore;
  /** Injectable clock/timers for deterministic tests. */
  now?: () => number;
  setTimeoutFn?: (fn: () => void, ms: number) => any;
  clearTimeoutFn?: (id: any) => void;
}

export interface CloudSyncEngine<TRemote, TState> {
  readonly scope: string;
  /** Pull remote state, merge into local, queue auto-heal push when needed. */
  pull(opts?: { force?: boolean }): Promise<FetchStatus>;
  /** Debounced push of the latest local state (bursts coalesce into one flush). */
  requestPush(): void;
  /** Immediate push of the latest local state (bypasses the debounce timer). */
  flushPush(): Promise<boolean>;
  /** Visibility/focus gain: throttled pull; pending pushes are retried regardless. */
  notifyVisible(): void;
  /** Network restored: pending pushes are delivered immediately + throttled pull. */
  notifyOnline(): void;
  hasPendingPush(): boolean;
  /** Clears pending timers. Registered listeners (if any) are the hook's job. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Default adapters
// ---------------------------------------------------------------------------

const sessionEtagStore: EtagStore = (() => {
  const map = new Map<string, string>();
  return {
    get: (scope) => map.get(scope),
    set: (scope, etag) => { if (etag) map.set(scope, etag); }
  };
})();

const memoryPendingStore: PendingStore = (() => {
  const set = new Set<string>();
  return {
    has: (scope) => set.has(scope),
    mark: (scope) => { set.add(scope); },
    clear: (scope) => { set.delete(scope); }
  };
})();

/** Durable pending store on top of a Storage-like backend (localStorage in the app). */
export function createStoragePendingStore(storage: {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}): PendingStore {
  const keyOf = (scope: string) => `cloudsync_pending_${scope}`;
  return {
    has: (scope) => {
      try { return storage.getItem(keyOf(scope)) !== null; } catch { return false; }
    },
    mark: (scope) => {
      try { storage.setItem(keyOf(scope), String(Date.now())); } catch { /* quota */ }
    },
    clear: (scope) => {
      try { storage.removeItem(keyOf(scope)); } catch { /* quota */ }
    }
  };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function createCloudSyncEngine<TRemote, TState>(
  config: CloudSyncEngineConfig<TRemote, TState>
): CloudSyncEngine<TRemote, TState> {
  const scope = config.scope;
  const now = config.now || (() => Date.now());
  const setTimeoutFn = config.setTimeoutFn || ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimeoutFn = config.clearTimeoutFn || ((id: any) => clearTimeout(id));
  const throttleMs = config.throttleMs ?? 60000;
  const debounceMs = config.debounceMs ?? 400;
  const etagStore = config.etagStore || sessionEtagStore;
  const pendingStore = config.pendingStore || memoryPendingStore;

  // -Infinity = "never pulled": the first visibility/online event always pulls,
  // regardless of the injectable clock's origin (tests start the clock at 0).
  let lastPullStartedAt: number = -Infinity;
  let pushTimer: any = null;
  let flushRunning = false;
  let flushAgain = false; // a push was requested while a flush was in flight

  const scheduleFlush = (delayMs: number) => {
    if (pushTimer !== null) return; // already scheduled; it will read the latest state
    pushTimer = setTimeoutFn(() => {
      pushTimer = null;
      void flushPush();
    }, delayMs);
  };

  const flushPush = async (): Promise<boolean> => {
    if (flushRunning) {
      // Coalesce like attendance's runCoalescedSync: the running loop flushes
      // once more with the newest snapshot after the current attempt settles.
      flushAgain = true;
      return false;
    }
    flushRunning = true;
    let ok = false;
    try {
      do {
        flushAgain = false;
        const snapshot = config.getState();
        try {
          ok = await config.pushState(snapshot);
        } catch {
          ok = false;
        }
        if (ok) {
          // Clear the flag only if no newer request arrived during the push:
          // otherwise the newer edit still needs its delivery.
          if (!flushAgain) pendingStore.clear(scope);
        }
        if (config.onPushed) config.onPushed(ok);
      } while (ok && flushAgain);
      if (!ok) {
        // Undelivered: the pending flag stays (or is set) so visibility/online
        // events and the next successful pull keep retrying (queue delivery).
        // NOTE: no self-rescheduling retry loop — a down server must not be
        // hammered every debounce tick; retries ride external events.
        pendingStore.mark(scope);
      }
    } finally {
      flushRunning = false;
    }
    return ok;
  };

  const pull = async (_opts?: { force?: boolean }): Promise<FetchStatus> => {
    lastPullStartedAt = now();
    let res: FetchResult<TRemote>;
    try {
      res = await config.fetchState({ etag: etagStore.get(scope) });
    } catch {
      res = { status: 'error' };
    }

    if (res.status === 'ok' && res.data !== undefined) {
      if (res.etag) etagStore.set(scope, res.etag);
      try {
        const merged = config.mergeFn(config.getState(), res.data);
        config.setState(merged.state);
        if (config.onMerged) config.onMerged(merged.state, res.data);
        if (merged.hasLocalNewer || pendingStore.has(scope)) {
          scheduleFlush(debounceMs); // auto-heal (AUD-012): deliver what the cloud has not seen
        }
      } catch {
        // Merge must never break the sync loop; state stays as-is.
        return 'error';
      }
    } else if (res.status === 'not-modified') {
      // 304: no parsing, no merge, no setState — but an undelivered push still
      // deserves a retry even though the remote is unchanged.
      if (pendingStore.has(scope)) scheduleFlush(debounceMs);
    }
    return res.status;
  };

  return {
    scope,
    pull,
    requestPush() {
      pendingStore.mark(scope); // durable BEFORE scheduling: a crash must not lose the edit
      scheduleFlush(debounceMs);
    },
    flushPush,
    notifyVisible() {
      const t = now();
      if (t - lastPullStartedAt < throttleMs) {
        if (pendingStore.has(scope) && pushTimer === null && !flushRunning) {
          scheduleFlush(debounceMs);
        }
        return;
      }
      void pull();
    },
    notifyOnline() {
      // Delivery of queued pushes must not wait for the pull throttle.
      if (pendingStore.has(scope) && pushTimer === null && !flushRunning) {
        scheduleFlush(0);
      }
      const t = now();
      if (t - lastPullStartedAt >= throttleMs) void pull();
    },
    hasPendingPush() {
      return pendingStore.has(scope);
    },
    dispose() {
      if (pushTimer !== null) {
        clearTimeoutFn(pushTimer);
        pushTimer = null;
      }
    }
  };
}
