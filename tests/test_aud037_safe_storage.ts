/**
 * AUD-037: safe storage layer.
 *
 * Acceptance criteria from the batch brief:
 *   - quota overflow (setItem throws) -> the mark is NOT lost for the session
 *     (in-memory fallback), telemetry IS sent (quota_exceeded with key+size),
 *     the app does not crash;
 *   - critical writers wired: attendance payload (attendance.ts), the merge
 *     base (utils/attendanceBase.ts), the homework pending-push flag
 *     (components/HomeworkTracker.tsx).
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './setup_mock_auth';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const W = path.resolve(__dirname, '..');

let passed = 0;
function check(cond: any, label: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { console.error(`  ✗ FAIL ${label}`); process.exitCode = 1; }
}

const realLocalStorage = globalThis.localStorage;
const realFetch = globalThis.fetch;

interface CapturedCall { url: string; body: string; }
let telemetryCalls: CapturedCall[] = [];

async function main() {
  console.log('\n--- 1. Quota overflow: value kept in memory, telemetry sent, no crash ---');
  // Mock: localStorage works for reads, setItem ALWAYS throws (quota exhausted).
  const backing = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (backing.has(k) ? (backing.get(k) as string) : null),
    setItem: (k: string, v: string) => { throw new Error('QuotaExceededError: mocked'); },
    removeItem: (k: string) => { backing.delete(k); },
    key: (i: number) => Array.from(backing.keys())[i] ?? null,
    get length() { return backing.size; },
    clear: () => backing.clear()
  };

  (globalThis as any).fetch = async (url: string, init: RequestInit) => {
    telemetryCalls.push({ url: String(url), body: String(init.body) });
    return { ok: true, json: async () => ({ ok: true }) };
  };

  const {
    safeSetItem, safeGetItem, safeRemoveItem,
    isStorageDegraded, getDegradedKeys, resetSafeStorageForTests, safeStorageStats
  } = await import('../utils/safeStorage');

  resetSafeStorageForTests();
  telemetryCalls = [];

  const journal = JSON.stringify([{ docId: 'r1', groupId: 'ingt-310', date: '2026-09-14', lessonId: 'l1', absentStudentIds: [3] }]);
  const res = safeSetItem('attendance_ingt-310', journal, { component: 'attendance' });

  check(res.ok === false && res.fromMemory === true, 'safeSetItem reports degraded write (no throw)');
  check(isStorageDegraded('attendance_ingt-310'), 'key marked degraded');
  check(safeGetItem('attendance_ingt-310') === journal, 'READ-THROUGH: the mark survives in memory for the session');
  check(safeStorageStats.quotaErrors === 1, 'quota error counted');

  // Telemetry: sendCrashReport is async — give the fire-and-forget a tick.
  await new Promise(r => setTimeout(r, 50));
  check(telemetryCalls.length === 1, `telemetry sent exactly once (cooldown), got ${telemetryCalls.length}`);
  check(telemetryCalls[0]?.url.includes('/report-error'), 'telemetry went to /report-error');
  const payload = JSON.parse(telemetryCalls[0]?.body || '{}');
  check(payload.message?.includes('quota_exceeded'), 'event quota_exceeded in message');
  check(payload.message?.includes('attendance_ingt-310'), 'key included in telemetry');
  check(payload.message?.includes('chars'), 'payload size included in telemetry');
  check(payload.component === 'attendance', 'component forwarded');

  // Cooldown: an immediate second failing write must NOT spam telemetry.
  safeSetItem('attendance_ingt-310', journal + 'x', { component: 'attendance' });
  await new Promise(r => setTimeout(r, 30));
  check(telemetryCalls.length === 1, '30s cooldown suppresses duplicate telemetry');

  console.log('\n--- 2. Recovery: freed quota heals the key ---');
  // "Free" the quota: from now on setItem works again.
  (globalThis as any).localStorage = {
    getItem: (k: string) => (backing.has(k) ? (backing.get(k) as string) : null),
    setItem: (k: string, v: string) => { backing.set(k, v); },
    removeItem: (k: string) => { backing.delete(k); },
    key: (i: number) => Array.from(backing.keys())[i] ?? null,
    get length() { return backing.size; },
    clear: () => backing.clear()
  };
  const healed = safeSetItem('attendance_ingt-310', journal, { component: 'attendance' });
  check(healed.ok === true && healed.fromMemory === false, 'write succeeds after quota freed');
  check(!isStorageDegraded('attendance_ingt-310') && getDegradedKeys().length === 0, 'degradation flag cleared');
  check(safeGetItem('attendance_ingt-310') === journal, 'read returns the persisted value');

  safeRemoveItem('attendance_ingt-310');
  check(safeGetItem('attendance_ingt-310') === null, 'safeRemoveItem clears both layers');

  console.log('\n--- 3. Writers are wired (source pins) ---');
  const attSrc = fs.readFileSync(path.join(W, 'attendance.ts'), 'utf8');
  const baseSrc = fs.readFileSync(path.join(W, 'utils/attendanceBase.ts'), 'utf8');
  const hwSrc = fs.readFileSync(path.join(W, 'components/HomeworkTracker.tsx'), 'utf8');

  check(attSrc.includes("safeSetItem(`attendance_${groupId}`, JSON.stringify(updatedRecords)"), 'attendance journal payload -> safeSetItem');
  check(attSrc.includes("safeSetItem(`attendance_${params.groupId}`, JSON.stringify(merged)"), 'post-merge journal write -> safeSetItem');
  check(attSrc.includes("safeGetItem(`attendance_${currentGroupId}`)"), 'attendance reads use read-through safeGetItem');
  check(baseSrc.includes("safeSetItem(key, value, { component: 'attendanceBase' })"), 'merge base -> safeSetItem');
  check(baseSrc.includes('return safeGetItem(key)'), 'merge base reads -> safeGetItem');
  check(hwSrc.includes("safeSetItem(`hw_pending_push_${currentGroupId}`"), 'hw_pending_push flag -> safeSetItem');
  check(hwSrc.includes("safeGetItem(`hw_pending_push_${currentGroupId}`) !== null"), 'hw_pending_push reads -> safeGetItem');

  console.log('\n--- 4. Honest limits (documented) ---');
  check(true, 'fallback is SESSION-scoped: a restart after quota loss still loses the value (IndexedDB is out of AUD-037 scope)');
}

try {
  await main();
} finally {
  (globalThis as any).localStorage = realLocalStorage;
  (globalThis as any).fetch = realFetch;
}

console.log(`\n[${passed} checks passed]`);
if (process.exitCode !== 1) console.log('=== AUD-037 SAFE STORAGE SUITE PASSED ===');
