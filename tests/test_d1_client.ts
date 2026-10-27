/**
 * Client side of the D1 protocol: the REAL attendanceStorage.ts / attendanceD1Client.ts against the REAL worker and a
 * SQLite-backed D1 shim. Counts requests, so the savings are measured, not promised.
 *
 * Covered: mode detection (KV group vs D1 group vs old worker), incremental pull through the change feed and the mirror,
 * ops push (one request per month, no GET/PUT of the month), two devices, offline edit ordering by edit time, tombstone
 * propagation, fallback to the legacy protocol after a rollback, server revision going backwards, outages (503),
 * 401 propagation, multi-page feeds.
 */
import worker, { createStaffToken } from '../cloudflare-worker.js';
import { migrateFlip, migrateRollback, applyOps } from '../worker/attendance_d1.js';
import {
  setAttendanceApiBase, saveStaffToken, saveLocalStudents, syncAttendanceRecordsToV3, pullAttendanceRecordsFromV3
} from '../utils/attendanceStorage';
import { resetAttendanceModeCache, getAttendanceMode, loadMirror } from '../utils/attendanceD1Client';
import { merge3, snapshotBase } from '../utils/attendanceMerge3';
import { D1Shim } from './helpers/d1_shim';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✓ [PASS] ${msg}`); }
  else { failed++; console.error(`  ❌ [FAIL] ${msg}`); process.exitCode = 1; }
}

class MemKV {
  m = new Map<string, string>();
  constructor(private latencyMs = 2) {}
  private wait() { return new Promise(r => setTimeout(r, this.latencyMs)); }
  async get(k: string) { await this.wait(); return this.m.has(k) ? this.m.get(k)! : null; }
  async put(k: string, v: string) { await this.wait(); this.m.set(k, v); }
  async delete(k: string) { await this.wait(); this.m.delete(k); }
  async list(o: { prefix?: string } = {}) {
    await this.wait();
    return { keys: [...this.m.keys()].filter(k => k.startsWith(o.prefix || '')).sort().map(name => ({ name })), list_complete: true };
  }
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
const PEPPER = 'd1-client-suite-pepper-0123456789';
const kv = new MemKV();
const d1 = new D1Shim(1);
d1.exec((await import('node:fs')).readFileSync(new URL('../migrations/0001_attendance.sql', import.meta.url), 'utf8'));
const env: any = { APP_DATA: kv, DB: d1, ID_PEPPER: PEPPER, TELEGRAM_BOT_TOKEN: '1:test', APP_SECRET: 's' };

// request counter: "METHOD /path" -> n
let counts: Record<string, number> = {};
let failChangesWith: number | null = null;
const tally = () => ({ ...counts });
const n = (k: string) => counts[k] || 0;
const monthGets = () => Object.entries(counts).filter(([k]) => k.startsWith('GET /v3/att?')).reduce((a, [, v]) => a + v, 0);
(globalThis as any).fetch = async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith(BASE)) throw new Error('Unexpected network call: ' + url);
  const u = new URL(url);
  const method = (init?.method || 'GET').toUpperCase();
  const key = `${method} ${u.pathname}${u.pathname === '/v3/att' && method === 'GET' ? '?' : ''}`;
  counts[key] = (counts[key] || 0) + 1;
  if (failChangesWith && u.pathname === '/v3/att/changes') return new Response(JSON.stringify({ error: 'boom' }), { status: failChangesWith });
  return worker.fetch(new Request(url, init), env);
};
setAttendanceApiBase(BASE);

const mkGroup = (gid: string) => kv.m.set(`g:${gid}`, JSON.stringify({ staff: [], slots: [] }));
const tokenFor = (gid: string) => createStaffToken(PEPPER, { gid, role: 'starosta', exp: Date.now() + 86400000 });
const students = [{ id: 1, name: 'Иванов', slot: 'SLOTAAA1' }, { id: 2, name: 'Петров', slot: 'SLOTBBB2' }, { id: 3, name: 'Сидоров', slot: 'SLOTCCC3' }];

// a date in the CURRENT Samara month, so the client's month window always contains it
const sam = new Date(Date.now() + 4 * 3600_000);
const YM = `${sam.getUTCFullYear()}-${String(sam.getUTCMonth() + 1).padStart(2, '0')}`;
const DATE = `${YM}-15`;
const LK = (pair: number) => `${DATE.slice(5)}.${pair}`;
const rec = (gid: string, absent: number[], o: { pair?: number; excused?: number[]; cancelled?: boolean; at?: number } = {}) => ({
  docId: `${gid}_${DATE}_${gid}-${o.pair ?? 2}`, groupId: gid, date: DATE, lessonId: `${gid}-${o.pair ?? 2}`,
  absentStudentIds: absent, excusedStudentIds: o.excused ?? [], isCancelled: Boolean(o.cancelled),
  updatedAt: new Date(o.at ?? Date.now()).toISOString()
});
const use = (s: MemoryStorage) => { (globalThis as any).localStorage = s; };
async function device(gid: string, withToken = true) {
  const s = new MemoryStorage();
  use(s);
  saveLocalStudents(gid, students as any);
  if (withToken) saveStaffToken(await tokenFor(gid), gid);
  return s;
}
const ids = (r: any) => (r ? r.absentStudentIds.slice().sort().join(',') : 'none');
const findRec = (rs: any[], pair = 2) => rs.find(r => r.date === DATE && r.lessonId.endsWith(`-${pair}`));

console.log('\n=================================================');
console.log('   TEST SUITE: D1 CLIENT PROTOCOL (feed + ops)');
console.log('=================================================');

// 1. Mode detection
console.log('\n1. A KV group keeps using the legacy protocol; the probe is cached');
{
  resetAttendanceModeCache(); counts = {};
  const gid = 'cl-kv'; mkGroup(gid);
  const A = await device(gid); use(A);
  await syncAttendanceRecordsToV3(gid, [rec(gid, [1])] as any);
  assert(n('PUT /v3/att') === 1 && n('POST /v3/att/ops') === 0, 'push to a KV group uses PUT /v3/att (no ops)');
  counts = {};
  await pullAttendanceRecordsFromV3(gid);
  assert(n('GET /v3/att/changes') === 1 && getAttendanceMode(gid) === 'kv', 'the first pull probes the feed once and learns "kv" (409 NOT_D1)');
  assert(monthGets() >= 4, `and then reads the months the legacy way (${monthGets()} GETs)`);
  counts = {};
  await pullAttendanceRecordsFromV3(gid);
  assert(n('GET /v3/att/changes') === 0, 'the next pull does not probe again (cached for 10 minutes)');
}

// 2. D1 group: request budget
console.log('\n2. D1 group: measured request budget');
{
  resetAttendanceModeCache(); counts = {};
  const gid = 'cl-d1'; mkGroup(gid); await migrateFlip(env, gid);
  const A = await device(gid); use(A);
  const first = await syncAttendanceRecordsToV3(gid, [rec(gid, [1]), rec(gid, [], { pair: 3, cancelled: true })] as any);
  assert(first.ok && n('PUT /v3/att') === 1, 'while the mode is still unknown the legacy PUT is used (it also works on D1)');
  counts = {};
  const pulled = await pullAttendanceRecordsFromV3(gid);
  assert(n('GET /v3/att/changes') === 1 && monthGets() === 0, `a pull on a D1 group = 1 request and 0 month GETs (${JSON.stringify(tally())})`);
  assert(ids(findRec(pulled)) === '1' && findRec(pulled, 3)?.isCancelled === true, 'records are rebuilt correctly from the mirror');
  counts = {};
  await pullAttendanceRecordsFromV3(gid);
  assert(n('GET /v3/att/changes') === 1 && monthGets() === 0, 'an unchanged pull is still just 1 request');
  const mirror = loadMirror(gid);
  assert(mirror.rev > 0 && Object.keys(mirror.months[YM]?.slots || {}).length === 1, `the mirror is persisted (rev ${mirror.rev})`);
  counts = {};
  const second = await syncAttendanceRecordsToV3(gid, [rec(gid, [1, 2]), rec(gid, [], { pair: 3, cancelled: true })] as any);
  assert(second.ok && n('POST /v3/att/ops') === 1 && n('PUT /v3/att') === 0 && monthGets() === 0, `a push = 1 ops request, no GET/PUT of the month (${JSON.stringify(tally())})`);
  counts = {};
  const again = await syncAttendanceRecordsToV3(gid, [rec(gid, [1, 2]), rec(gid, [], { pair: 3, cancelled: true })] as any);
  assert(again.ok && Object.keys(counts).length === 0, 'nothing changed -> no requests at all');
}

// 3. Two devices through the feed
console.log('\n3. Two devices: incremental pull, unmark propagation');
{
  resetAttendanceModeCache(); counts = {};
  const gid = 'cl-two'; mkGroup(gid); await migrateFlip(env, gid);
  const A = await device(gid); const B = await device(gid);
  use(A); await syncAttendanceRecordsToV3(gid, [rec(gid, [1])] as any); await pullAttendanceRecordsFromV3(gid); // A learns mode d1
  use(A); await syncAttendanceRecordsToV3(gid, [rec(gid, [1, 3])] as any);
  use(B); const bFirst = await pullAttendanceRecordsFromV3(gid);
  assert(ids(findRec(bFirst)) === '1,3', "B sees A's marks after a single feed request");
  use(B); await syncAttendanceRecordsToV3(gid, [rec(gid, [1, 3, 2])] as any);   // B marks student 2 (mode known after its pull)
  counts = {};
  use(A); const aPull = await pullAttendanceRecordsFromV3(gid);
  assert(ids(findRec(aPull)) === '1,2,3' && n('GET /v3/att/changes') === 1, "A sees B's mark through an incremental feed");
  use(B); await syncAttendanceRecordsToV3(gid, [rec(gid, [1, 2])] as any);      // B unmarks student 3
  use(A); const aAfter = await pullAttendanceRecordsFromV3(gid);
  assert(ids(findRec(aAfter)) === '1,2', "A sees B's unmark (tombstone propagated through the feed)");
}

// 4. Offline edit ordering
console.log('\n4. An old offline edit pushed late does not override a newer edit');
{
  resetAttendanceModeCache(); counts = {};
  const gid = 'cl-time'; mkGroup(gid); await migrateFlip(env, gid);
  const A = await device(gid); const B = await device(gid);
  use(A); await syncAttendanceRecordsToV3(gid, [rec(gid, [])] as any); await pullAttendanceRecordsFromV3(gid);
  use(B); await syncAttendanceRecordsToV3(gid, [rec(gid, [])] as any); await pullAttendanceRecordsFromV3(gid);
  use(B); await syncAttendanceRecordsToV3(gid, [rec(gid, [3], { at: Date.now() })] as any);                         // B: student 3 absent NOW
  use(A);
  const aLocal = [rec(gid, [], { excused: [3], at: Date.now() - 90_000 })];                                          // A: excused, edited 90 s ago, offline
  const push = await syncAttendanceRecordsToV3(gid, aLocal as any);
  assert(push.ok, "A's late push is accepted by the server");
  const baseMap = snapshotBase(aLocal as any);
  const remote = await pullAttendanceRecordsFromV3(gid);
  const merged = merge3(aLocal as any, baseMap, remote as any, [YM]);
  const m = findRec(merged.merged as any);
  assert(ids(m) === '3' && (m as any).excusedStudentIds.length === 0, "the server kept B's newer value and A converges to it after the next pull");
}

// 5. Fallback after rollback to KV
console.log('\n5. Rollback to KV: the client falls back in the same call');
{
  resetAttendanceModeCache(); counts = {};
  const gid = 'cl-rb'; mkGroup(gid); await migrateFlip(env, gid);
  const A = await device(gid); use(A);
  await syncAttendanceRecordsToV3(gid, [rec(gid, [1])] as any);
  await pullAttendanceRecordsFromV3(gid);
  assert(getAttendanceMode(gid) === 'd1', 'mode is d1');
  await migrateRollback(env, gid);
  counts = {};
  const r = await syncAttendanceRecordsToV3(gid, [rec(gid, [1, 2])] as any);
  assert(r.ok && n('POST /v3/att/ops') === 1 && n('PUT /v3/att') === 1, `ops -> 409 NOT_D1 -> legacy PUT in the same call (${JSON.stringify(tally())})`);
  const doc = JSON.parse(kv.m.get(`a:${gid}:${YM}`) || '{}');
  assert(doc.slots?.SLOTBBB2?.[LK(2)] === 'u', 'the mark landed in the KV document');
  counts = {};
  await pullAttendanceRecordsFromV3(gid);
  assert(getAttendanceMode(gid) === 'kv' && monthGets() >= 4, 'the next pull learns "kv" and reads months again');
}

// 6. Revision going backwards
console.log('\n6. Server revision goes backwards (restore / re-flip)');
{
  resetAttendanceModeCache(); counts = {};
  const gid = 'cl-rev'; mkGroup(gid); await migrateFlip(env, gid);
  const A = await device(gid); const B = await device(gid);
  use(A);
  for (let i = 0; i < 4; i++) await syncAttendanceRecordsToV3(gid, [rec(gid, i % 2 ? [1] : [1, 2])] as any); // several revisions
  await pullAttendanceRecordsFromV3(gid);
  const oldRev = loadMirror(gid).rev;
  d1.db.exec(`DELETE FROM marks WHERE gid='${gid}'; DELETE FROM lesson_state WHERE gid='${gid}'; DELETE FROM group_rev WHERE gid='${gid}'`);
  use(B); await pullAttendanceRecordsFromV3(gid);                                    // B learns d1
  use(B); await syncAttendanceRecordsToV3(gid, [rec(gid, [3], { pair: 4 })] as any);  // revision 1 again
  use(A);
  const after = await pullAttendanceRecordsFromV3(gid);
  assert(oldRev > 1 && loadMirror(gid).rev < oldRev, `A noticed the revision went from ${oldRev} back to ${loadMirror(gid).rev} and rebuilt its mirror`);
  assert(findRec(after, 2) === undefined && ids(findRec(after, 4)) === '3', 'stale marks of the old state are gone, the new state is present');
}

// 7. Outages and auth
console.log('\n7. Outages never corrupt the mirror; 401 is reported');
{
  resetAttendanceModeCache(); counts = {};
  const gid = 'cl-out'; mkGroup(gid); await migrateFlip(env, gid);
  const A = await device(gid); use(A);
  await syncAttendanceRecordsToV3(gid, [rec(gid, [1])] as any);
  await pullAttendanceRecordsFromV3(gid);
  const revBefore = loadMirror(gid).rev;
  failChangesWith = 503;
  const down = await pullAttendanceRecordsFromV3(gid);
  failChangesWith = null;
  assert(down.length === 0 && loadMirror(gid).rev === revBefore, 'a 503 on the feed returns nothing and leaves the mirror untouched');
  const back = await pullAttendanceRecordsFromV3(gid);
  assert(ids(findRec(back)) === '1', 'the next pull recovers');

  d1.failNext = true;
  const failedPush = await syncAttendanceRecordsToV3(gid, [rec(gid, [1, 2])] as any);
  assert(!failedPush.ok, 'a D1 outage during a push is reported (the flag stays dirty on the caller side)');
  const retried = await syncAttendanceRecordsToV3(gid, [rec(gid, [1, 2])] as any);
  const rows = (d1.db.prepare(`SELECT COUNT(*) c FROM marks WHERE gid=? AND status<>''`).get(gid) as any).c;
  assert(retried.ok && rows === 2, `the retry succeeds and creates no duplicates (${rows} rows)`);

  const noTokenGid = 'cl-out';
  const U = new MemoryStorage(); use(U); saveLocalStudents(noTokenGid, students as any);
  const unauthPull = await pullAttendanceRecordsFromV3(noTokenGid);
  assert(unauthPull.length === 0, 'a pull without credentials returns nothing (no crash)');
  const unauthPush = await syncAttendanceRecordsToV3(noTokenGid, [rec(noTokenGid, [1, 2, 3])] as any);
  assert(!unauthPush.ok && unauthPush.status === 401, 'a push without credentials reports 401');
}

// 8. Multi-page feed
console.log('\n8. A feed larger than one page');
{
  resetAttendanceModeCache(); counts = {};
  const gid = 'cl-big'; mkGroup(gid); await migrateFlip(env, gid);
  const ops: any[] = [];
  for (let s = 0; s < 52; s++) for (let d = 1; d <= 25; d++) for (const p of [1, 2, 3, 4]) {
    ops.push({ kind: 'm', day: `${YM}-${String(d).padStart(2, '0')}`, key: `${YM.slice(5)}-${String(d).padStart(2, '0')}.${p}`, slot: `BIG${String(s).padStart(5, '0')}`, v: 'u', at: Date.now() });
  }
  for (let i = 0; i < ops.length; i += 500) await applyOps(env, gid, ops.slice(i, i + 500), { dev: 'seed' });
  const A = await device(gid); use(A);
  counts = {};
  await pullAttendanceRecordsFromV3(gid);
  const mirror = loadMirror(gid);
  const cells = Object.values(mirror.months[YM].slots).reduce((a, m) => a + Object.keys(m).length, 0);
  assert(ops.length === 5200 && n('GET /v3/att/changes') >= 2, `${ops.length} marks needed ${n('GET /v3/att/changes')} feed pages`);
  assert(cells === ops.length, `the mirror holds all ${cells} cells`);
  counts = {};
  await pullAttendanceRecordsFromV3(gid);
  assert(n('GET /v3/att/changes') === 1, 'afterwards an update is a single small request');
}

// 9. Garbage 200
console.log('\n9. A 200 that is not a change feed is not "an empty group"');
{
  resetAttendanceModeCache(); counts = {};
  const gid = 'cl-portal'; mkGroup(gid); await migrateFlip(env, gid);
  const A = await device(gid); use(A);
  await syncAttendanceRecordsToV3(gid, [rec(gid, [1])] as any);
  await pullAttendanceRecordsFromV3(gid);
  const keep = (globalThis as any).fetch;
  (globalThis as any).fetch = async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/v3/att/changes')) return new Response('<html>Wi-Fi login</html>', { status: 200 });
    return keep(input, init);
  };
  const before = loadMirror(gid);
  const res = await pullAttendanceRecordsFromV3(gid);
  (globalThis as any).fetch = keep;
  assert(res.length === 0 && loadMirror(gid).rev === before.rev, 'a captive-portal page is treated as a failed pull, the mirror is untouched');
}

console.log('\n=================================================');
console.log(`   RESULT: ${passed} passed, ${failed} failed`);
console.log('=================================================');
