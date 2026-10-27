/**
 * Multi-device convergence of attendance: real worker.fetch, real client modules
 * (attendanceStorage, attendanceMerge3, attendanceCloudSync), KV mock with latency.
 *
 * The "tap" helper mirrors markBatchAttendance + runCoalescedSync in attendance.ts (the React hook
 * itself cannot run under tsx); the pull/merge/push path is the real utils/attendanceCloudSync.ts.
 */
import worker, { createStaffToken } from '../cloudflare-worker.js';
import {
  setAttendanceApiBase,
  saveStaffToken,
  saveLocalStudents,
  syncAttendanceRecordsToV3
} from '../utils/attendanceStorage';
import { pullMergePush, markSnapshotPushed } from '../utils/attendanceCloudSync';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✓ [PASS] ${msg}`); }
  else { failed++; console.error(`  ❌ [FAIL] ${msg}`); process.exitCode = 1; }
}

class LatencyKV {
  m = new Map<string, string>();
  stale = new Map<string, string>(); // simulates a lagging edge location: reads of these keys return an old value
  puts = 0;
  private wait() { return new Promise(r => setTimeout(r, 2)); }
  async get(k: string) { await this.wait(); if (this.stale.has(k)) return this.stale.get(k)!; return this.m.has(k) ? this.m.get(k)! : null; }
  async put(k: string, v: string, _o?: any) { await this.wait(); this.puts++; this.m.set(k, v); }
  async delete(k: string) { await this.wait(); this.m.delete(k); }
}
class MemoryStorage {
  private s = new Map<string, string>();
  getItem(k: string) { return this.s.has(k) ? this.s.get(k)! : null; }
  setItem(k: string, v: string) { this.s.set(k, String(v)); }
  removeItem(k: string) { this.s.delete(k); }
  clear() { this.s.clear(); }
  get length() { return this.s.size; }
  key(i: number) { return Array.from(this.s.keys())[i] ?? null; }
}

const BASE = 'http://worker.test';
const PEPPER = 'convergence-pepper-0123456789abcdef';
const kv = new LatencyKV();
const env: any = { APP_DATA: kv, ID_PEPPER: PEPPER, TELEGRAM_BOT_TOKEN: '1:convergence', APP_SECRET: 's' };
const realFetch = (globalThis as any).fetch;
const realLocalStorage = (globalThis as any).localStorage;
(globalThis as any).fetch = async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith(BASE)) return worker.fetch(new Request(url, init), env);
  throw new Error('Unexpected network call in test: ' + url);
};
setAttendanceApiBase(BASE);

const GID = 'ingt-310';
const MONTH_KEY = `a:${GID}:2026-10`;
kv.m.set(`g:${GID}`, JSON.stringify({ staff: [], slots: [] }));
const token = await createStaffToken(PEPPER, { gid: GID, role: 'starosta', exp: Date.now() + 86400000 });
const students = [
  { id: 1, name: 'Иванов', slot: 'SLOTAAA1' },
  { id: 2, name: 'Петров', slot: 'SLOTBBB2' },
  { id: 3, name: 'Сидоров', slot: 'SLOTCCC3' }
];
const makeDevice = () => {
  const d = new MemoryStorage();
  (globalThis as any).localStorage = d;
  saveLocalStudents(GID, students as any);
  saveStaffToken(token, GID);
  return d;
};
const use = (d: MemoryStorage) => { (globalThis as any).localStorage = d; };
const resetServer = () => {
  for (const k of Array.from(kv.m.keys())) if (k.startsWith('a:')) kv.m.delete(k);
  kv.stale.clear();
};

// Sunday: the schedule has no lessons, so reconstructed lesson ids equal the ones written here.
const rec = (absent: number[], opts: { pair?: number; cancelled?: boolean } = {}) => ({
  docId: `${GID}_2026-10-25_${GID}-${opts.pair ?? 2}`, groupId: GID, date: '2026-10-25',
  lessonId: `${GID}-${opts.pair ?? 2}`, absentStudentIds: absent, excusedStudentIds: [] as number[],
  isCancelled: Boolean(opts.cancelled), updatedAt: new Date().toISOString()
});
const attKey = `attendance_${GID}`;
const dirtyKey = `attendance_dirty_${GID}`;
const load = (d: MemoryStorage): any[] => JSON.parse(d.getItem(attKey) || '[]');
const view = (d: MemoryStorage, pair = 2) => {
  const r = load(d).find(x => x.lessonId.endsWith(`-${pair}`));
  return r ? { absent: [...r.absentStudentIds].sort(), cancelled: Boolean(r.isCancelled) } : null;
};

/** markBatchAttendance + runCoalescedSync (without the debounce delay). */
async function tap(d: MemoryStorage, recs: any[]) {
  use(d);
  d.setItem(attKey, JSON.stringify(recs));
  d.setItem(dirtyKey, 'true');
  const res = await syncAttendanceRecordsToV3(GID, recs as any);
  if (res.ok) { markSnapshotPushed(GID, recs as any); d.removeItem(dirtyKey); }
}
/** syncWithCloud effect. */
async function pullSync(d: MemoryStorage) {
  use(d);
  const out = await pullMergePush(GID, load(d));
  if (out.mergedWithRemote) d.setItem(attKey, JSON.stringify(out.merged));
}
const serverSlots = () => JSON.parse(kv.m.get(MONTH_KEY) || '{"slots":{}}').slots;
const serverMarks = (slot: string, lessonKey = '10-25.2') => serverSlots()[slot]?.[lessonKey];

console.log('\n=================================================');
console.log('   TEST SUITE: ATTENDANCE CONVERGENCE (multi-device)');
console.log('=================================================');

console.log('\n1. A marks, B removes the mark, A catches up');
{
  resetServer();
  const A = makeDevice(); const B = makeDevice();
  await pullSync(A);
  await tap(A, [rec([1])]);
  await pullSync(B);
  assert(JSON.stringify(view(B)?.absent) === '[1]', 'B receives the mark made on A');
  await tap(B, [rec([])]);
  assert(serverMarks('SLOTAAA1') === undefined, 'the removal reached the server');
  await pullSync(A);
  assert(JSON.stringify(view(A)?.absent) === '[]', "A learns about B's removal (no stale mark left)");
}

console.log('\n2. Concurrent marks on the same lesson from two devices');
{
  resetServer();
  const A = makeDevice(); const B = makeDevice();
  await pullSync(A); await pullSync(B);
  await tap(A, [rec([2])]);
  await tap(B, [rec([3])]);
  await pullSync(A); await pullSync(B);
  assert(serverMarks('SLOTBBB2') === 'u' && serverMarks('SLOTCCC3') === 'u', 'both marks are on the server');
  assert(JSON.stringify(view(A)?.absent) === '[2,3]', 'A shows both marks');
  assert(JSON.stringify(view(B)?.absent) === '[2,3]', 'B shows both marks');
}

console.log('\n3. Cancellation round trip');
{
  resetServer();
  const A = makeDevice(); const B = makeDevice();
  await pullSync(A); await pullSync(B);
  await tap(A, [rec([], { pair: 3, cancelled: true })]);
  await pullSync(B);
  assert(view(B, 3)?.cancelled === true, 'B sees the cancelled pair');
  await tap(B, [rec([], { pair: 3, cancelled: false })]);
  await pullSync(A);
  assert(view(A, 3)?.cancelled === false, "A sees B's un-cancel");
}

console.log('\n4. A lagging KV edge (older version) must not delete my marks');
{
  resetServer();
  const A = makeDevice();
  await pullSync(A);
  await tap(A, [rec([1])]);
  const oldBlob = kv.m.get(MONTH_KEY)!;            // version N
  await tap(A, [rec([1, 2])]);                      // version N+1, written by this device
  kv.stale.set(MONTH_KEY, oldBlob);                 // the next read is served by a lagging location
  await pullSync(A);
  assert(JSON.stringify(view(A)?.absent) === '[1,2]', 'the stale read did not remove the newer local mark');
  await tap(A, [rec([1, 2], { pair: 3, cancelled: true })]); // an unrelated push while the edge still lags
  assert(A.getItem(dirtyKey) === 'true', 'a push attempted on top of a stale read is postponed, not written');
  kv.stale.clear();
  assert(serverMarks('SLOTAAA1') === 'u' && serverMarks('SLOTBBB2') === 'u', 'no mark was deleted on the server because of the stale read');
  await pullSync(A);                                  // edge caught up: the postponed push goes through
  assert(A.getItem(dirtyKey) !== 'true' && JSON.parse(kv.m.get(MONTH_KEY)!).cancelled.includes('10-25.3'), 'the postponed change is delivered once the edge catches up');
  assert(serverMarks('SLOTAAA1') === 'u' && serverMarks('SLOTBBB2') === 'u', 'and the earlier marks are still intact');
}

console.log('\n5. Three devices, interleaved edits, everyone converges');
{
  resetServer();
  const A = makeDevice(); const B = makeDevice(); const C = makeDevice();
  for (const d of [A, B, C]) await pullSync(d);
  await tap(A, [rec([1])]);
  await tap(B, [rec([2])]);
  await tap(C, [rec([3])]);
  for (const d of [A, B, C]) await pullSync(d);
  assert([A, B, C].every(d => JSON.stringify(view(d)?.absent) === '[1,2,3]'), 'concurrent marks from three devices merge to [1,2,3] everywhere');
  await tap(B, [rec([1, 2])]);                       // B removes student 3
  for (const d of [C, A, B]) await pullSync(d);
  assert([A, B, C].every(d => JSON.stringify(view(d)?.absent) === '[1,2]'), 'a removal made on B reaches A and C');
  await tap(A, [rec([1])]);                          // A removes student 2
  for (const d of [B, C, A]) await pullSync(d);
  assert([A, B, C].every(d => JSON.stringify(view(d)?.absent) === '[1]'), 'the next removal converges as well');
  assert(serverMarks('SLOTAAA1') === 'u' && serverMarks('SLOTBBB2') === undefined && serverMarks('SLOTCCC3') === undefined, 'the server holds exactly the converged state');
}

console.log('\n6. Idle pulls do not write to KV');
{
  resetServer();
  const A = makeDevice();
  await pullSync(A);
  await tap(A, [rec([1])]);
  await pullSync(A);
  const before = kv.puts;
  await pullSync(A); await pullSync(A);
  assert(kv.puts === before, `repeated pulls without changes cause no KV writes (${kv.puts - before})`);
}

(globalThis as any).fetch = realFetch;
(globalThis as any).localStorage = realLocalStorage;
console.log(`\nTOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
if (failed > 0) process.exitCode = 1;
