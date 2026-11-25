/**
 * Stage 4 Tests: Smart Observability (DEF-10), WebView Document Visibility (DEF-12),
 * and Archive Directory Naming Guard (DEF-14).
 */

import { logger, getSystemDiagnostics } from '../utils/logger';
import { safeSetItem, safeGetItem, pruneForeignScheduleCache, resetSafeStorageForTests } from '../utils/safeStorage';
import { loadBlockScheduleForDate } from '../utils/scheduleLoader';
import { fetchJsonMeta } from '../utils/cloudSync';
import { pushGroupUsefulData } from '../utils/usefulStorage';
import { submitSuggestion } from '../utils/suggestionsClient';
import { refreshServerMirror, resetAttendanceModeCache } from '../utils/attendanceD1Client';
import { pullAttendanceSnapshotFromV3, setAttendanceApiBase } from '../utils/attendanceStorage';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ [PASS] ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ [FAIL] ${msg}`);
    process.exitCode = 1;
  }
}

console.log('=== Running Stage 4 Tests: Observability, WebView & Archive Guard ===');

// ---------------------------------------------------------------------------
// 1. DEF-10 Observability: real client calls increment errorLogsCount vs exemptions
// ---------------------------------------------------------------------------
console.log('\n--- 1. Observability: selective error logging (real client modules) ---');

logger.clearLogs();
const initialDiag = getSystemDiagnostics();
assert(initialDiag.errorLogsCount === 0, 'Initial errorLogsCount is 0');

const origFetchForObs = (globalThis as any).fetch;
const origLsForObs = (globalThis as any).localStorage;
const obsLsMap = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => obsLsMap.get(k) ?? null,
  setItem: (k: string, v: string) => { obsLsMap.set(k, String(v)); },
  removeItem: (k: string) => { obsLsMap.delete(k); },
  key: (i: number) => Array.from(obsLsMap.keys())[i] ?? null,
  get length() { return obsLsMap.size; },
  clear: () => obsLsMap.clear()
};
setAttendanceApiBase('http://obs.test');

try {
  // A: Real 500 / 403 / D1 failure across client modules MUST increment errorLogsCount
  (globalThis as any).fetch = async () => new Response(JSON.stringify({ error: 'Internal Server Error' }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' }
  });
  await fetchJsonMeta('http://obs.test/sync/schedule?groupId=ingt-310');
  await pushGroupUsefulData('ingt-310', []);
  await submitSuggestion({ gid: 'ingt-310', title: 'T', text: 'B' });

  resetAttendanceModeCache();
  await refreshServerMirror({ base: 'http://obs.test', headers: {} }, 'ingt-310');

  resetAttendanceModeCache();
  await pullAttendanceSnapshotFromV3('ingt-310');

  const afterErrorsDiag = getSystemDiagnostics();
  assert(
    afterErrorsDiag.errorLogsCount >= 5,
    `errorLogsCount increments across real 500 responses (got ${afterErrorsDiag.errorLogsCount})`
  );
  const countBeforeMuted = afterErrorsDiag.errorLogsCount;

  // B: AbortError must NOT increment errorLogsCount
  (globalThis as any).fetch = async () => {
    const e = new Error('The user aborted a request');
    e.name = 'AbortError';
    throw e;
  };
  await fetchJsonMeta('http://obs.test/sync/schedule?groupId=ingt-310');
  await pushGroupUsefulData('ingt-310', []);
  await submitSuggestion({ gid: 'ingt-310', title: 'T', text: 'B' });
  resetAttendanceModeCache();
  await refreshServerMirror({ base: 'http://obs.test', headers: {} }, 'ingt-310');

  // C: Expected 404 / D1 409 NOT_D1 fallback must NOT increment errorLogsCount
  (globalThis as any).fetch = async () => new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 });
  await fetchJsonMeta('http://obs.test/sync/schedule?groupId=ingt-310');

  (globalThis as any).fetch = async () => new Response(JSON.stringify({ code: 'NOT_D1' }), { status: 409 });
  resetAttendanceModeCache();
  const d1Fallback = await refreshServerMirror({ base: 'http://obs.test', headers: {} }, 'ingt-310');
  assert(d1Fallback.ok && d1Fallback.mode === 'kv', '409 NOT_D1 cleanly falls back to kv mode');

  // D: loadBlockScheduleForDate on missing historical Block 1 must NOT increment errorLogsCount
  try {
    await loadBlockScheduleForDate('ingt-310', '2026-09-10');
  } catch {}

  const afterMutedDiag = getSystemDiagnostics();
  assert(
    afterMutedDiag.errorLogsCount === countBeforeMuted,
    `errorLogsCount stays ${countBeforeMuted} after AbortError, 404, and 409 NOT_D1 (got ${afterMutedDiag.errorLogsCount})`
  );
} finally {
  (globalThis as any).fetch = origFetchForObs;
  if (origLsForObs) (globalThis as any).localStorage = origLsForObs;
  else delete (globalThis as any).localStorage;
  setAttendanceApiBase(null);
  resetAttendanceModeCache();
}

// ---------------------------------------------------------------------------
// 2. DEF-10 Storage self-healing: pruneForeignScheduleCache
// ---------------------------------------------------------------------------
console.log('\n--- 2. Storage self-healing: pruneForeignScheduleCache ---');

// Mock localStorage in Node
const mockStorage = new Map<string, string>();
const origLocalStorage = (globalThis as any).localStorage;

(globalThis as any).localStorage = {
  getItem: (k: string) => mockStorage.get(k) ?? null,
  setItem: (k: string, v: string) => { mockStorage.set(k, String(v)); },
  removeItem: (k: string) => { mockStorage.delete(k); },
  key: (i: number) => Array.from(mockStorage.keys())[i] ?? null,
  get length() { return mockStorage.size; },
  clear: () => mockStorage.clear()
};

mockStorage.clear();
resetSafeStorageForTests();

// Set current group
mockStorage.set('my_group_id', 'ingt-310');

// Set keys: current group, foreign group, and dirty keys
mockStorage.set('sched_cache_v1:ingt-310', '{"data":"current"}');
mockStorage.set('cached_schedule_ingt-310', '{"data":"current_legacy"}');
mockStorage.set('schedule_overrides_ingt-310', '{"1::0":{"teacher":"Ivanov"}}');
mockStorage.set('schedule_dirty_faid-310', 'true');
mockStorage.set('attendance_dirty_foreign', '{"unsaved":1}');
mockStorage.set('sched_cache_v1:faid-310', '{"data":"foreign_faid"}');
mockStorage.set('schedule_cache_htf-215', '{"data":"foreign_htf"}');
mockStorage.set('cached_schedule_htf-215', '{"data":"foreign_legacy"}');
mockStorage.set('custom_schedule_25ingt-101', '{"data":"foreign_custom"}');

assert(mockStorage.size === 10, 'Set up 10 keys in mock localStorage');

const prunedCount = pruneForeignScheduleCache();
assert(prunedCount === 4, `Pruned exactly 4 foreign cache keys including cached_schedule_ (got ${prunedCount})`);
assert(mockStorage.has('sched_cache_v1:ingt-310'), 'Preserved current group schedule cache');
assert(mockStorage.has('cached_schedule_ingt-310'), 'Preserved current group legacy cache');
assert(mockStorage.has('schedule_overrides_ingt-310'), 'Preserved current group overrides');
assert(mockStorage.has('schedule_dirty_faid-310'), 'Preserved dirty schedule flag');
assert(mockStorage.has('attendance_dirty_foreign'), 'Preserved dirty attendance flag');
assert(!mockStorage.has('sched_cache_v1:faid-310'), 'Evicted foreign faid-310 cache');
assert(!mockStorage.has('schedule_cache_htf-215'), 'Evicted foreign htf-215 cache');
assert(!mockStorage.has('cached_schedule_htf-215'), 'Evicted foreign cached_schedule_htf-215 cache');
assert(!mockStorage.has('custom_schedule_25ingt-101'), 'Evicted foreign 25ingt-101 cache');

// Test end-to-end quota recovery in safeSetItem
mockStorage.set('cached_schedule_other-grp', '{"data":"heavy"}');
const realMockSetItem = (globalThis as any).localStorage.setItem;
(globalThis as any).localStorage.setItem = (k: string, v: string) => {
  if (mockStorage.has('cached_schedule_other-grp')) {
    const qErr = new Error('QuotaExceededError');
    qErr.name = 'QuotaExceededError';
    throw qErr;
  }
  realMockSetItem(k, v);
};
const recovered = safeSetItem('attendance_ingt-310', '{"ok":1}', { component: 'test' });
assert(recovered.ok === true && recovered.fromMemory === false, 'safeSetItem recovers after pruning cached_schedule_ foreign cache');
assert(!mockStorage.has('cached_schedule_other-grp'), 'safeSetItem evicted cached_schedule_other-grp during recovery');
assert(safeGetItem('attendance_ingt-310') === '{"ok":1}', 'safeGetItem reads recovered value');

// Clean up mock localStorage
if (origLocalStorage) {
  (globalThis as any).localStorage = origLocalStorage;
} else {
  delete (globalThis as any).localStorage;
}

// ---------------------------------------------------------------------------
// 3. DEF-12 DOM listeners: visibilitychange strictly on document
// ---------------------------------------------------------------------------
console.log('\n--- 3. WebView event listeners: visibilitychange on document ---');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const filesToCheck = [
  'App.tsx',
  'attendance.ts',
  'components/UsefulTracker.tsx',
  'utils/useCloudSync.ts',
  'utils/useNow.ts',
  'utils/useOnlineStatus.ts'
];

for (const relPath of filesToCheck) {
  const content = fs.readFileSync(path.join(ROOT, relPath), 'utf-8');
  assert(
    !content.includes("window.addEventListener('visibilitychange'"),
    `${relPath} does NOT attach visibilitychange to window`
  );
  assert(
    !content.includes('window.addEventListener("visibilitychange"'),
    `${relPath} does NOT attach visibilitychange to window (double quotes)`
  );
  if (content.includes('visibilitychange')) {
    assert(
      content.includes("document.addEventListener('visibilitychange'") ||
      content.includes('document.addEventListener("visibilitychange"'),
      `${relPath} correctly attaches visibilitychange to document`
    );
    assert(
      content.includes("document.removeEventListener('visibilitychange'") ||
      content.includes('document.removeEventListener("visibilitychange"'),
      `${relPath} has matching document.removeEventListener cleanup`
    );
  }
}

// Check attendance.ts top-level listener is named and not anonymous
const attendanceContent = fs.readFileSync(path.join(ROOT, 'attendance.ts'), 'utf-8');
assert(
  attendanceContent.includes('const onVisibilityChange ='),
  'attendance.ts top-level visibilitychange listener is named onVisibilityChange'
);

// ---------------------------------------------------------------------------
// 4. DEF-14 Archive directory naming in nightly_sync.ts
// ---------------------------------------------------------------------------
console.log('\n--- 4. Archive naming guard in nightly_sync.ts ---');

const nightlySyncContent = fs.readFileSync(path.join(ROOT, 'scripts/nightly_sync.ts'), 'utf-8');
assert(
  nightlySyncContent.includes('block-from-week-${previousWindowStart}'),
  'nightly_sync.ts names archive directory using previousWindowStart (outgoing block)'
);
assert(
  !nightlySyncContent.includes('block-from-week-${window.start}'),
  'nightly_sync.ts does NOT name archive directory using new incoming window.start'
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nStage 4 Observability & WebView test results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
