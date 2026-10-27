/**
 * AUD-023: thin React binding for the cloud sync engine (utils/cloudSyncEngine.ts).
 *
 * The hook owns NOTHING but the component lifecycle: it creates the engine for a
 * scope, pulls on mount, and forwards focus / visibility / online events to the
 * engine's throttled entry points. All sync logic (debounce, ETag cache, merge,
 * pending-push queue) lives in the pure core and is tested without React.
 *
 * Adapter closures (fetchState/pushState/mergeFn/getState/setState) are kept in a
 * ref refreshed on every render, so the engine always calls the latest closures
 * without re-subscribing listeners.
 */

import { useEffect, useRef } from 'react';
import {
  createCloudSyncEngine,
  createStoragePendingStore,
  type CloudSyncEngine,
  type CloudSyncEngineConfig,
  type EtagStore,
  type PendingStore,
  type FetchStatus
} from './cloudSyncEngine';

export interface UseCloudSyncOptions<TRemote, TState>
  extends Omit<CloudSyncEngineConfig<TRemote, TState>, 'now' | 'setTimeoutFn' | 'clearTimeoutFn'> {
  /** Sync is wired only when true (e.g. a group is selected). */
  enabled?: boolean;
  /** Changing this tears down and re-creates the engine (group switch, force refresh). */
  refreshKey?: string | number;
  /** Override the default localStorage-backed pending store (tests, legacy keys). */
  pendingStore?: PendingStore;
  etagStore?: EtagStore;
}

export interface UseCloudSyncHandle<TRemote, TState> {
  pull: (opts?: { force?: boolean }) => Promise<FetchStatus>;
  requestPush: () => void;
  flushPush: () => Promise<boolean>;
  hasPendingPush: () => boolean;
  engine: CloudSyncEngine<TRemote, TState> | null;
}

const storageLike = (): Storage | null => {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* SSR / tests */ }
  return null;
};

export function useCloudSync<TRemote, TState>(
  options: UseCloudSyncOptions<TRemote, TState>
): UseCloudSyncHandle<TRemote, TState> {
  const enabled = options.enabled !== false;
  const refreshKey = options.refreshKey;

  // Latest adapters without resubscribing the lifecycle listeners.
  const configRef = useRef(options);
  configRef.current = options;

  const engineRef = useRef<CloudSyncEngine<TRemote, TState> | null>(null);
  const handleRef = useRef<UseCloudSyncHandle<TRemote, TState>>({
    pull: async () => 'error',
    requestPush: () => {},
    flushPush: async () => false,
    hasPendingPush: () => false,
    engine: null
  });

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;

    const pendingStore = configRef.current.pendingStore
      || createStoragePendingStore(storageLike() || { getItem: () => null, setItem: () => {}, removeItem: () => {} });

    const engine = createCloudSyncEngine<TRemote, TState>({
      ...configRef.current,
      scope: configRef.current.scope,
      pendingStore,
      fetchState: (req) => configRef.current.fetchState(req),
      pushState: (state) => configRef.current.pushState(state),
      mergeFn: (local, remote) => configRef.current.mergeFn(local, remote),
      getState: () => configRef.current.getState(),
      setState: (state) => configRef.current.setState(state)
    });
    engineRef.current = engine;

    handleRef.current = {
      pull: (opts) => engine.pull(opts),
      requestPush: () => engine.requestPush(),
      flushPush: () => engine.flushPush(),
      hasPendingPush: () => engine.hasPendingPush(),
      engine
    };

    // Mount pull: initial state for the tab (full pull; the engine's ETag cache
    // degrades repeated pulls into 304 no-ops).
    void engine.pull();

    const handleActive = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      engine.notifyVisible();
    };
    const handleOnline = () => engine.notifyOnline();

    window.addEventListener('visibilitychange', handleActive);
    window.addEventListener('focus', handleActive);
    window.addEventListener('online', handleOnline);

    return () => {
      engine.dispose();
      engineRef.current = null;
      window.removeEventListener('visibilitychange', handleActive);
      window.removeEventListener('focus', handleActive);
      window.removeEventListener('online', handleOnline);
    };
  }, [enabled, refreshKey]);

  return handleRef.current;
}
