import { WeekData, DaySchedule } from '../types';
import { SCHEDULE_REGISTRY, createEmptyWeek } from '../constants';
import { getCanonicalGroupKey } from './samgtuParser';
import {
  LoadResult,
  LoadFailReason,
  parseWeekData,
  hasAnyLessons,
  validateWeekData
} from './scheduleSchema';

export type { LoadResult, LoadFailReason };
export { parseWeekData, hasAnyLessons, validateWeekData };

export const CACHE_PREFIX_V1 = 'sched_cache_v1:';
export const LEGACY_CACHE_PREFIX = 'cached_schedule_';

export interface ScheduleCacheEntry {
  data: WeekData;
  cachedAt: number;
}

export interface LoadScheduleOptions {
  timeoutMs?: number;
  allowBackgroundRevalidate?: boolean; // default: true
}

/**
 * Returns the v1 localStorage key for a canonical schedule id.
 */
export function getScheduleCacheKey(canonicalId: string): string {
  return `${CACHE_PREFIX_V1}${canonicalId}`;
}

/**
 * Returns the legacy localStorage key for a canonical schedule id.
 */
export function getLegacyScheduleCacheKey(canonicalId: string): string {
  return `${LEGACY_CACHE_PREFIX}${canonicalId}`;
}

/**
 * Safely retrieves localStorage in browser or Node.js test environment.
 */
export function getLocalStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
    return (globalThis as any).localStorage;
  }
  return null;
}

/**
 * Tracks canonical IDs that were explicitly and successfully loaded from network/cache.
 */
const LOADED_CHUNKS = new Set<string>();

/**
 * Marks a schedule as loaded into memory/cache.
 */
export function markScheduleLoaded(groupId: string): void {
  const canonicalId = getCanonicalScheduleId(groupId);
  LOADED_CHUNKS.add(canonicalId);
}

/**
 * Resets the set of loaded chunks (used in tests).
 */
export function clearLoadedChunks(): void {
  LOADED_CHUNKS.clear();
}

/**
 * Safely clears all schedule caches from localStorage (v1 and legacy keys).
 * NEVER touches attendance, overrides, teachers, or roles.
 * Returns the count of deleted keys.
 */
export function clearScheduleCache(): number {
  let count = 0;
  clearLoadedChunks();

  const storage = getLocalStorage();
  if (storage) {
    const keysToRemove: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && (key.startsWith('sched_cache_') || key.startsWith('cached_schedule_'))) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      storage.removeItem(key);
      count++;
    }
  }

  return count;
}

/**
 * Retrieves cache metadata (timestamp) for a given group ID.
 */
export function getScheduleCacheMeta(groupId: string): { cachedAt: number } | null {
  const canonicalId = getCanonicalScheduleId(groupId);
  const storage = getLocalStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(getScheduleCacheKey(canonicalId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.cachedAt === 'number') {
        return { cachedAt: parsed.cachedAt };
      }
    }
  } catch (e) {}

  return null;
}

/**
 * Helper to extract WeekData and timestamp from stored cache JSON.
 */
export function extractCachedSchedule(rawJson: unknown): { data: WeekData; cachedAt: number } | null {
  if (!rawJson || typeof rawJson !== 'object') return null;

  const obj = rawJson as Record<string, unknown>;

  // Case A: Structured entry { data: WeekData, cachedAt: number }
  if ('data' in obj) {
    const parsedData = parseWeekData(obj.data);
    if (parsedData && hasAnyLessons(parsedData)) {
      const cachedAt = typeof obj.cachedAt === 'number' ? obj.cachedAt : Date.now();
      return { data: parsedData, cachedAt };
    }
  }

  // Case B: Direct WeekData (legacy cache format)
  const parsedDirect = parseWeekData(rawJson);
  if (parsedDirect && hasAnyLessons(parsedDirect)) {
    return { data: parsedDirect, cachedAt: Date.now() };
  }

  return null;
}

/**
 * Reads cached schedule from localStorage with automatic legacy migration.
 */
export function readCachedSchedule(canonicalId: string): { data: WeekData; cachedAt: number } | null {
  const storage = getLocalStorage();
  if (!storage) return null;

  // 1. Try v1 key
  const v1Key = getScheduleCacheKey(canonicalId);
  try {
    const rawV1 = storage.getItem(v1Key);
    if (rawV1) {
      const parsed = JSON.parse(rawV1);
      const extracted = extractCachedSchedule(parsed);
      if (extracted) {
        return extracted;
      }
    }
  } catch (e) {}

  // 2. Try legacy key and migrate if found
  const legacyKey = getLegacyScheduleCacheKey(canonicalId);
  try {
    const rawLegacy = storage.getItem(legacyKey);
    if (rawLegacy) {
      const parsed = JSON.parse(rawLegacy);
      const extracted = extractCachedSchedule(parsed);
      if (extracted) {
        // Migrate to v1 key and remove legacy key
        try {
          storage.setItem(v1Key, JSON.stringify({ data: extracted.data, cachedAt: extracted.cachedAt }));
          storage.removeItem(legacyKey);
        } catch (e) {}
        return extracted;
      }
    }
  } catch (e) {}

  return null;
}

/**
 * Writes schedule into v1 versioned localStorage cache.
 */
export function writeCachedSchedule(canonicalId: string, data: WeekData): void {
  const storage = getLocalStorage();
  if (!storage) return;

  const v1Key = getScheduleCacheKey(canonicalId);
  const entry: ScheduleCacheEntry = {
    data,
    cachedAt: Date.now()
  };

  try {
    storage.setItem(v1Key, JSON.stringify(entry));
  } catch (e) {}
}

/**
 * Maps any group string or alias into its canonical schedule key (e.g. '3-ИНГТ-110' -> 'ingt-310').
 */
export function getCanonicalScheduleId(groupId: string): string {
  return getCanonicalGroupKey(groupId);
}

/**
 * Builds the static chunk URL for a given group id or alias relative to document.baseURI or BASE_URL.
 * Supports explicit base overrides for unit testing.
 * Prevents 404 issues in subfolders such as /samgtu-schedule/ on GitHub Pages.
 */
export function scheduleUrl(id: string, base?: string): string {
  const canonicalId = getCanonicalScheduleId(id);
  let resolvedBase = base;

  if (!resolvedBase) {
    if (typeof document !== 'undefined' && document.baseURI) {
      resolvedBase = document.baseURI;
    } else if (typeof (import.meta as any).env?.BASE_URL === 'string') {
      resolvedBase = (import.meta as any).env.BASE_URL;
    } else {
      resolvedBase = './';
    }
  }

  // Handle absolute URLs (e.g. http:// or https://)
  if (/^https?:\/\//i.test(resolvedBase)) {
    try {
      const urlObj = new URL(resolvedBase);
      let pathname = urlObj.pathname;
      if (/\.[a-zA-Z0-9]+$/.test(pathname)) {
        pathname = pathname.substring(0, pathname.lastIndexOf('/') + 1);
      }
      if (!pathname.endsWith('/')) {
        pathname += '/';
      }
      urlObj.pathname = `${pathname}schedules/${canonicalId}.json`;
      urlObj.search = '';
      urlObj.hash = '';
      return urlObj.toString();
    } catch {
      // Fallback to relative formatting if URL parsing fails
    }
  }

  // Handle relative paths (e.g. '/', './', '/samgtu-schedule/', '/samgtu-schedule')
  let cleanBase = resolvedBase.trim();
  if (!cleanBase || cleanBase === './') {
    return `./schedules/${canonicalId}.json`;
  }
  if (!cleanBase.endsWith('/')) {
    cleanBase += '/';
  }
  return `${cleanBase}schedules/${canonicalId}.json`;
}

/**
 * Registers common aliases in SCHEDULE_REGISTRY for a loaded group schedule.
 */
export function registerScheduleAliases(canonicalId: string, data: WeekData): void {
  SCHEDULE_REGISTRY[canonicalId] = data;
  if (hasAnyLessons(data)) {
    markScheduleLoaded(canonicalId);
  }

  // Pattern: ingt-310 -> 3-ингт-110, 24ингт-110, etc.
  const ingtMatch = canonicalId.match(/^([a-z]+)-(\d)(\d{2})$/);
  if (ingtMatch) {
    const fac = ingtMatch[1];
    const course = ingtMatch[2];
    const num = ingtMatch[3];
    const facRuMap: Record<string, string> = {
      ingt: 'ингт',
      faid: 'фаид',
      htf: 'хтф',
      asa: 'аса',
      iait: 'иаит',
      itf: 'итф',
      etf: 'этф',
      tef: 'тэф',
      fmmt: 'фммт',
      fpp: 'фпп',
      iiego: 'ииэго'
    };
    const facRu = facRuMap[fac] || fac;

    SCHEDULE_REGISTRY[`${course}-${facRu}-1${num}`] = data;
    SCHEDULE_REGISTRY[`${course}-${facRu}-${num}`] = data;
    SCHEDULE_REGISTRY[`${course}-${fac}-1${num}`] = data;
    SCHEDULE_REGISTRY[`${course}-${fac}-${num}`] = data;
    SCHEDULE_REGISTRY[`24${facRu}-1${num}`] = data;
    SCHEDULE_REGISTRY[`25${facRu}-1${num}`] = data;
    SCHEDULE_REGISTRY[`${fac}-${course}${num}`] = data;
  }

  // Explicit legacy aliases
  if (canonicalId === 'faid-310') {
    SCHEDULE_REGISTRY['faid-110'] = data;
    SCHEDULE_REGISTRY['24фад-110'] = data;
    SCHEDULE_REGISTRY['24фаид-110'] = data;
    SCHEDULE_REGISTRY['3-фаид-110'] = data;
    SCHEDULE_REGISTRY['3-faid-110'] = data;
  } else if (canonicalId === 'ingt-209') {
    SCHEDULE_REGISTRY['2-ingt-109'] = data;
    SCHEDULE_REGISTRY['ingt-109'] = data;
    SCHEDULE_REGISTRY['2-ингт-109'] = data;
  } else if (canonicalId === 'htf-215') {
    SCHEDULE_REGISTRY['2-htf-115'] = data;
    SCHEDULE_REGISTRY['htf-115'] = data;
    SCHEDULE_REGISTRY['2-хтф-115'] = data;
  } else if (canonicalId === 'ingt-301') {
    SCHEDULE_REGISTRY['ingt-1'] = data;
  }
}

/**
 * Checks whether the schedule for the specified group is genuinely loaded into memory.
 * Empty weeks created via createEmptyWeek() do NOT count as loaded!
 * Returns true ONLY if:
 * 1. The chunk was explicitly loaded from network or cache, OR
 * 2. The registry contains at least one real lesson (e.g. bundled default group ingt-310).
 */
export function isScheduleLoaded(groupId: string): boolean {
  const canonicalId = getCanonicalScheduleId(groupId);
  if (LOADED_CHUNKS.has(canonicalId)) {
    return true;
  }
  const data = SCHEDULE_REGISTRY[canonicalId];
  return hasAnyLessons(data);
}

/**
 * Returns candidate URLs for fetching static JSON chunks, with scheduleUrl as primary.
 */
export function getCandidateUrls(canonicalId: string): string[] {
  const urls: string[] = [scheduleUrl(canonicalId)];

  if (typeof window !== 'undefined' && window.location) {
    const origin = window.location.origin;
    let path = window.location.pathname;
    if (/\.[a-zA-Z0-9]+$/.test(path)) {
      path = path.substring(0, path.lastIndexOf('/') + 1);
    }
    if (!path.endsWith('/')) {
      path += '/';
    }
    urls.push(`${origin}${path}schedules/${canonicalId}.json`);
    const basePath = (import.meta as any).env?.BASE_URL || './';
    const cleanBase = basePath.endsWith('/') ? basePath : `${basePath}/`;
    urls.push(`${cleanBase}schedules/${canonicalId}.json`);
    urls.push(`/samgtu-schedule/schedules/${canonicalId}.json`);
    urls.push(`/schedules/${canonicalId}.json`);
  }
  return [...new Set(urls)];
}

function createLoadSuccess(data: WeekData): LoadResult {
  return Object.assign({ ...data }, {
    ok: true as const,
    data
  });
}

function createLoadFailure(reason: LoadFailReason): LoadResult {
  const empty = {
    1: createEmptyWeek(),
    2: createEmptyWeek(),
    3: createEmptyWeek(),
    4: createEmptyWeek()
  };
  return Object.assign(empty, {
    ok: false as const,
    reason
  });
}

/**
 * Network fetcher and validator for a schedule chunk.
 */
async function fetchAndCacheChunk(
  canonicalId: string,
  options?: LoadScheduleOptions
): Promise<LoadResult> {
  if (typeof fetch !== 'function') {
    return createLoadFailure('network');
  }

  const candidateUrls = getCandidateUrls(canonicalId);
  let hadNetworkError = false;
  let hadInvalidJson = false;
  let hadTimeout = false;
  let had404 = false;

  for (const url of candidateUrls) {
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutMs = options?.timeoutMs ?? 8000;
      let timeoutId: any;
      if (controller) {
        timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      }

      let res: Response;
      try {
        res = await fetch(url, {
          cache: 'no-cache',
          ...(controller ? { signal: controller.signal } : {})
        });
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

      if (res.status === 404) {
        had404 = true;
        continue;
      }

      if (res.ok) {
        let rawData: unknown;
        try {
          rawData = await res.json();
        } catch {
          hadInvalidJson = true;
          continue;
        }

        const parsed = parseWeekData(rawData);
        if (!parsed) {
          hadInvalidJson = true;
          continue;
        }

        if (!hasAnyLessons(parsed)) {
          return createLoadFailure('empty');
        }

        // Successful fetch: register aliases, mark loaded, write to v1 versioned cache
        registerScheduleAliases(canonicalId, parsed);
        markScheduleLoaded(canonicalId);
        writeCachedSchedule(canonicalId, parsed);
        return createLoadSuccess(parsed);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        hadTimeout = true;
      } else {
        hadNetworkError = true;
      }
    }
  }

  let failureReason: LoadFailReason = 'not_found';
  if (hadTimeout) {
    failureReason = 'timeout';
  } else if (hadInvalidJson) {
    failureReason = 'invalid';
  } else if (hadNetworkError) {
    failureReason = 'network';
  } else if (had404) {
    failureReason = 'not_found';
  }

  return createLoadFailure(failureReason);
}

/**
 * Loads a group schedule on-demand using a multi-tier cache cascade:
 * 1. User custom imported schedule in localStorage (custom_schedule_${canonicalId})
 * 2. Client cached schedule in localStorage (v1 versioned, Stale-While-Revalidate)
 * 3. In-memory SCHEDULE_REGISTRY (0ms bundled cold boot + background revalidation)
 * 4. Static JSON chunk from schedules/<canonicalId>.json
 *
 * Returns structured LoadResult:
 * - { ok: true, data: WeekData } on success
 * - { ok: false, reason: 'not_found' | 'network' | 'invalid' | 'empty' | 'timeout' } on failure
 */
export async function loadGroupSchedule(
  groupId: string,
  options?: LoadScheduleOptions
): Promise<LoadResult> {
  const canonicalId = getCanonicalScheduleId(groupId);
  const allowRevalidate = options?.allowBackgroundRevalidate ?? true;

  // 1. Custom imported schedule check (localStorage custom_schedule_${canonicalId})
  const storage = getLocalStorage();
  if (storage) {
    try {
      const customSaved = storage.getItem(`custom_schedule_${canonicalId}`);
      if (customSaved) {
        const rawJson = JSON.parse(customSaved);
        const parsed = parseWeekData(rawJson);
        if (parsed && hasAnyLessons(parsed)) {
          registerScheduleAliases(canonicalId, parsed);
          markScheduleLoaded(canonicalId);
          return createLoadSuccess(parsed);
        }
      }
    } catch (e) {}
  }

  // 2. Cached schedule check in localStorage (sched_cache_v1:... or legacy cached_schedule_...)
  const cached = readCachedSchedule(canonicalId);
  if (cached) {
    registerScheduleAliases(canonicalId, cached.data);
    markScheduleLoaded(canonicalId);
    const cachedResult = createLoadSuccess(cached.data);

    // Stale-While-Revalidate: return cached result immediately, trigger background fetch
    if (allowRevalidate && typeof fetch === 'function') {
      fetchAndCacheChunk(canonicalId, options).catch(() => {
        // Background update failed (offline or unchanged), silently ignored
      });
    }

    return cachedResult;
  }

  // 3. In-memory check: genuine bundled schedule present (0ms cold start)
  if (isScheduleLoaded(canonicalId)) {
    const memData = SCHEDULE_REGISTRY[canonicalId];
    const parsed = parseWeekData(memData);
    if (parsed && hasAnyLessons(parsed)) {
      // Revalidate in background so bundle never stays permanently out of date
      if (allowRevalidate && typeof fetch === 'function') {
        fetchAndCacheChunk(canonicalId, options).catch(() => {
          // Silently ignored
        });
      }
      return createLoadSuccess(parsed);
    }
  }

  // 4. Fetch static JSON chunk synchronously if no cache and no memory
  const fetchResult = await fetchAndCacheChunk(canonicalId, options);
  if (fetchResult.ok === false) {
    console.warn(`[ScheduleLoader] Could not load chunk for ${canonicalId} (reason: ${fetchResult.reason})`);
  }
  return fetchResult;
}

/**
 * Force-reloads a group schedule from network, bypassing memory and local cache.
 * Updates SCHEDULE_REGISTRY and v1 localStorage cache.
 */
export async function reloadGroupSchedule(
  groupId: string,
  options?: LoadScheduleOptions
): Promise<LoadResult> {
  const canonicalId = getCanonicalScheduleId(groupId);
  LOADED_CHUNKS.delete(canonicalId);
  const storage = getLocalStorage();
  if (storage) {
    storage.removeItem(getScheduleCacheKey(canonicalId));
    storage.removeItem(getLegacyScheduleCacheKey(canonicalId));
    storage.removeItem(`custom_schedule_${canonicalId}`);
  }
  const result = await fetchAndCacheChunk(canonicalId, options);
  if (result.ok) {
    registerScheduleAliases(canonicalId, result.data);
    markScheduleLoaded(canonicalId);
  }
  return result;
}
