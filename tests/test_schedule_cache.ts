import assert from 'assert';
import {
  loadGroupSchedule,
  clearScheduleCache,
  getScheduleCacheKey,
  getLegacyScheduleCacheKey,
  getScheduleCacheMeta,
  clearLoadedChunks
} from '../utils/scheduleLoader';
import { createEmptyWeek } from '../constants';
import { WeekData } from '../types';

console.log('=== TEST SUITE: Versioned Schedule Caching & Safe Cache Clearing ===\n');

// 0. Setup Mock LocalStorage
const store = new Map<string, string>();
const mockStorage: Storage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, String(value)); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => { store.clear(); },
  get length() { return store.size; },
  key: (index: number) => Array.from(store.keys())[index] ?? null
};

(globalThis as any).localStorage = mockStorage;
if (typeof window === 'undefined') {
  (globalThis as any).window = {
    localStorage: mockStorage,
    location: { origin: 'http://localhost:3000', pathname: '/' }
  };
} else {
  (window as any).localStorage = mockStorage;
}

function buildSampleWeek(subject = 'Тестовый предмет'): WeekData {
  const w1 = createEmptyWeek();
  w1[0].lessons.push({
    id: 'lesson-cache-1',
    timeStart: '08:00',
    timeEnd: '09:35',
    subject,
    type: 'Лекция',
    location: '1-100',
    teacher: 'Преподаватель П.П.'
  });
  return {
    1: w1,
    2: createEmptyWeek(),
    3: createEmptyWeek(),
    4: createEmptyWeek()
  };
}

const sampleData = buildSampleWeek();
const originalFetch = globalThis.fetch;

// 1. Key Isolation Tests for clearScheduleCache()
console.log('1. Testing clearScheduleCache() key isolation (never touches attendance, overrides, roles)...');

store.clear();
clearLoadedChunks();

// Schedule cache keys (should be cleared)
store.set('sched_cache_v1:ingt-301', JSON.stringify({ data: sampleData, cachedAt: Date.now() }));
store.set('sched_cache_v1:faid-310', JSON.stringify({ data: sampleData, cachedAt: Date.now() }));
store.set('cached_schedule_htf-215', JSON.stringify(sampleData)); // legacy key

// Non-schedule critical keys (MUST BE PRESERVED)
store.set('attendance_ingt-310', JSON.stringify([{ id: 'att-1', present: true }]));
store.set('schedule_overrides_ingt-310', JSON.stringify({ 'lesson-1': { location: '1-101' } }));
store.set('subject_teachers_ingt-310', JSON.stringify({ 'Тестовый предмет': 'Преподаватель П.П.' }));
store.set('user_role', 'admin');
store.set('starosta_group_id', 'ingt-310');
store.set('custom_schedule_user-custom', JSON.stringify(sampleData));
store.set('theme_pref', 'dark');

const removedCount = clearScheduleCache();
assert.strictEqual(removedCount, 3, 'clearScheduleCache() must remove exactly the 3 schedule cache keys');

// Verify schedule caches were deleted
assert.strictEqual(store.has('sched_cache_v1:ingt-301'), false, 'sched_cache_v1:ingt-301 must be deleted');
assert.strictEqual(store.has('sched_cache_v1:faid-310'), false, 'sched_cache_v1:faid-310 must be deleted');
assert.strictEqual(store.has('cached_schedule_htf-215'), false, 'cached_schedule_htf-215 must be deleted');

// Verify critical keys were strictly preserved
assert.strictEqual(store.has('attendance_ingt-310'), true, 'attendance_* key must NOT be touched');
assert.strictEqual(store.has('schedule_overrides_ingt-310'), true, 'schedule_overrides_* key must NOT be touched');
assert.strictEqual(store.has('subject_teachers_ingt-310'), true, 'subject_teachers_* key must NOT be touched');
assert.strictEqual(store.get('user_role'), 'admin', 'user_role must NOT be touched');
assert.strictEqual(store.get('starosta_group_id'), 'ingt-310', 'starosta_group_id must NOT be touched');
assert.strictEqual(store.has('custom_schedule_user-custom'), true, 'custom_schedule_* must NOT be touched');
assert.strictEqual(store.get('theme_pref'), 'dark', 'theme_pref must NOT be touched');

console.log('  [PASS] Key isolation verified: attendance, overrides, teachers, and roles are 100% safe.');

// 2. Versioned Storage (v1) & Legacy Migration
console.log('\n2. Testing v1 key prefix writing, timestamp storage, and legacy migration...');

store.clear();
clearLoadedChunks();

globalThis.fetch = async () => {
  return {
    ok: true,
    status: 200,
    json: async () => sampleData
  } as any;
};

const loadRes = await loadGroupSchedule('mock-v1-grp');
assert.strictEqual(loadRes.ok, true, 'loadGroupSchedule must succeed');

// Check that sched_cache_v1:mock-v1-grp was written
const v1Key = getScheduleCacheKey('mock-v1-grp');
assert.strictEqual(v1Key, 'sched_cache_v1:mock-v1-grp', 'getScheduleCacheKey must return sched_cache_v1: prefix');
assert(store.has(v1Key), `Storage must contain ${v1Key}`);

const storedRaw = store.get(v1Key)!;
const storedObj = JSON.parse(storedRaw);
assert(storedObj.data, 'Cache entry must have data property');
assert(typeof storedObj.cachedAt === 'number', 'Cache entry must have cachedAt timestamp');

// Legacy key should not be created
assert.strictEqual(store.has('cached_schedule_mock-v1-grp'), false, 'Legacy key must not be written');

// Check getScheduleCacheMeta
const meta = getScheduleCacheMeta('mock-v1-grp');
assert(meta !== null && typeof meta.cachedAt === 'number', 'getScheduleCacheMeta must return cachedAt');

// Test legacy migration:
clearLoadedChunks();
const legacyKey = getLegacyScheduleCacheKey('mock-legacy-grp');
assert.strictEqual(legacyKey, 'cached_schedule_mock-legacy-grp');
store.set(legacyKey, JSON.stringify(sampleData));

const migRes = await loadGroupSchedule('mock-legacy-grp');
assert.strictEqual(migRes.ok, true);

// Verify migration occurred
assert(store.has('sched_cache_v1:mock-legacy-grp'), 'Legacy key must be migrated to sched_cache_v1');
assert.strictEqual(store.has(legacyKey), false, 'Legacy key must be removed after successful migration');

console.log('  [PASS] Versioned storage (v1) and legacy migration work correctly.');

// 3. Stale-While-Revalidate Behavior
console.log('\n3. Testing Stale-While-Revalidate (instant return + async background fetch)...');

clearLoadedChunks();
store.clear();

const versionA = buildSampleWeek('Первоначальная версия A');
const versionB = buildSampleWeek('Обновленная версия B');

// Put Version A in v1 cache
store.set('sched_cache_v1:mock-swr', JSON.stringify({
  data: versionA,
  cachedAt: Date.now() - 3600000
}));

let fetchCount = 0;
globalThis.fetch = async () => {
  fetchCount++;
  // Simulate network roundtrip delay
  await new Promise(resolve => setTimeout(resolve, 30));
  return {
    ok: true,
    status: 200,
    json: async () => versionB
  } as any;
};

// SWR Request with allowBackgroundRevalidate: true (default)
const swrRes = await loadGroupSchedule('mock-swr', { allowBackgroundRevalidate: true });
assert.strictEqual(swrRes.ok, true);

// Instant return MUST be Version A!
if (swrRes.ok) {
  assert.strictEqual(
    swrRes.data[1][0].lessons[0].subject,
    'Первоначальная версия A',
    'SWR must immediately return cached Version A without waiting for network'
  );
}
assert.strictEqual(fetchCount, 1, 'Background fetch must have been dispatched');

// Wait for background fetch to resolve and update cache
await new Promise(resolve => setTimeout(resolve, 80));

// Check that localStorage now contains Version B
const revalidatedRaw = store.get('sched_cache_v1:mock-swr')!;
const revalidatedObj = JSON.parse(revalidatedRaw);
assert.strictEqual(
  revalidatedObj.data[1][0].lessons[0].subject,
  'Обновленная версия B',
  'Cache must be refreshed with Version B after background revalidation'
);

// Test allowBackgroundRevalidate: false (no network call)
fetchCount = 0;
clearLoadedChunks();
const offlineRes = await loadGroupSchedule('mock-swr', { allowBackgroundRevalidate: false });
assert.strictEqual(offlineRes.ok, true);
assert.strictEqual(fetchCount, 0, 'No fetch should be made when allowBackgroundRevalidate is false');

// Restore fetch
globalThis.fetch = originalFetch;

console.log('  [PASS] Stale-while-revalidate accurately delivers instant cache and updates in background.');

console.log('\n=================================================');
console.log('  ALL SCHEDULE CACHE & SWR TESTS PASSED (100%)');
console.log('=================================================\n');
