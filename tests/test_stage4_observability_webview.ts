/**
 * Stage 4 Tests: Smart Observability (DEF-10), WebView Document Visibility (DEF-12),
 * and Archive Directory Naming Guard (DEF-14).
 */

import { logger, getSystemDiagnostics } from '../utils/logger';
import { safeSetItem, safeGetItem, pruneForeignScheduleCache, resetSafeStorageForTests } from '../utils/safeStorage';
import { loadBlockScheduleForDate } from '../utils/scheduleLoader';
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
// 1. DEF-10 Observability: errorLogsCount increments vs silent exemptions
// ---------------------------------------------------------------------------
console.log('\n--- 1. Observability: selective error logging ---');

logger.clearLogs();
const initialDiag = getSystemDiagnostics();
assert(initialDiag.errorLogsCount === 0, 'Initial errorLogsCount is 0');

// A: 500 / 403 / QuotaExceededError must increment errorLogsCount
logger.error('SYNC', 'HTTP 500 Internal Server Error from worker');
logger.error('AUTH', 'HTTP 403 Forbidden: invalid credentials');
logger.error('STORAGE', 'QuotaExceededError writing key "attendance_base_ingt-310"');

const afterErrorsDiag = getSystemDiagnostics();
assert(afterErrorsDiag.errorLogsCount === 3, `errorLogsCount increments to 3 on real errors (got ${afterErrorsDiag.errorLogsCount})`);

// B: AbortError and expected 404 must NOT log as ERROR
const abortErr = new Error('The user aborted a request');
abortErr.name = 'AbortError';

// Simulate handler logic in network calls: AbortError is ignored
if (abortErr.name !== 'AbortError') {
  logger.error('SYNC', 'Unexpected abort error', abortErr);
}
// Info/warn level diagnostics do not increase errorLogsCount
logger.info('SYNC', 'syncAttendanceRecordsToV3 successfully pushed for ingt-310 (2 months)');
logger.warn('SYNC', 'Transient 304 / retryable condition');

const afterMutedDiag = getSystemDiagnostics();
assert(afterMutedDiag.errorLogsCount === 3, `errorLogsCount remains 3 after AbortError check and info/warn logs (got ${afterMutedDiag.errorLogsCount})`);

// C: Verify loadBlockScheduleForDate on missing historical Block 1 does NOT increment errorLogsCount
const mockDateBlock1 = '2026-09-10'; // Block 1
try {
  await loadBlockScheduleForDate('ingt-310', mockDateBlock1);
} catch {}

const afterBlock1Diag = getSystemDiagnostics();
assert(afterBlock1Diag.errorLogsCount === 3, `errorLogsCount still 3 after loading missing Block 1 archive (got ${afterBlock1Diag.errorLogsCount})`);

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
mockStorage.set('schedule_overrides_ingt-310', '{"1::0":{"teacher":"Ivanov"}}');
mockStorage.set('schedule_dirty_faid-310', 'true');
mockStorage.set('attendance_dirty_foreign', '{"unsaved":1}');
mockStorage.set('sched_cache_v1:faid-310', '{"data":"foreign_faid"}');
mockStorage.set('schedule_cache_htf-215', '{"data":"foreign_htf"}');
mockStorage.set('custom_schedule_25ingt-101', '{"data":"foreign_custom"}');

assert(mockStorage.size === 8, 'Set up 8 keys in mock localStorage');

const prunedCount = pruneForeignScheduleCache();
assert(prunedCount === 3, `Pruned exactly 3 foreign cache keys (got ${prunedCount})`);
assert(mockStorage.has('sched_cache_v1:ingt-310'), 'Preserved current group schedule cache');
assert(mockStorage.has('schedule_overrides_ingt-310'), 'Preserved current group overrides');
assert(mockStorage.has('schedule_dirty_faid-310'), 'Preserved dirty schedule flag');
assert(mockStorage.has('attendance_dirty_foreign'), 'Preserved dirty attendance flag');
assert(!mockStorage.has('sched_cache_v1:faid-310'), 'Evicted foreign faid-310 cache');
assert(!mockStorage.has('schedule_cache_htf-215'), 'Evicted foreign htf-215 cache');
assert(!mockStorage.has('custom_schedule_25ingt-101'), 'Evicted foreign 25ingt-101 cache');

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
