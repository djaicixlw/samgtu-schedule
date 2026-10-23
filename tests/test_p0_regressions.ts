/**
 * P0 regression suite: exercises the REAL cloudflare-worker.js (worker.fetch) and the REAL client
 * sync code (utils/attendanceStorage.ts) against a KV mock with artificial latency.
 * Nothing here talks to the network: global fetch is routed into the worker or a Telegram stub.
 *
 * Covered: PC staff-token auth, long-lived initData, claim rate limiting / CPU bound, report-error
 * and upload response leaks, roster size + compare-and-swap, /v3/att input validation, and the
 * two-device attendance scenario that used to lose marks.
 */
import worker, { createStaffToken, createTelegramInitData, pbkdf2, blindId } from '../cloudflare-worker.js';
import { merge3, snapshotBase, toBase, diffRecord } from '../utils/attendanceMerge3';
import {
  setAttendanceApiBase,
  saveStaffToken,
  saveLocalStudents,
  syncAttendanceRecordsToV3,
  pullAttendanceRecordsFromV3
} from '../utils/attendanceStorage';
import { mergeAttendance, STUDENTS_REGISTRY } from '../attendance';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✓ [PASS] ${msg}`); }
  else { failed++; console.error(`  ❌ [FAIL] ${msg}`); process.exitCode = 1; }
}

class LatencyKV {
  m = new Map<string, string>();
  puts = 0;
  constructor(private latencyMs = 3) {}
  private wait() { return new Promise(r => setTimeout(r, this.latencyMs)); }
  async get(k: string) { await this.wait(); return this.m.has(k) ? this.m.get(k)! : null; }
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
const BOT_TOKEN = '123456789:test-token-for-p0-regressions';
const PEPPER = 'p0-regression-pepper-0123456789ab';
const kv = new LatencyKV(3);
const env: any = { APP_DATA: kv, ID_PEPPER: PEPPER, TELEGRAM_BOT_TOKEN: BOT_TOKEN, APP_SECRET: 'p0-app-secret', DEV_CHAT_ID: '424242' };

const telegramCalls: string[] = [];
const realFetch = (globalThis as any).fetch;
const realLocalStorage = (globalThis as any).localStorage;
(globalThis as any).fetch = async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith(BASE)) return worker.fetch(new Request(url, init), env);
  if (url.includes('api.telegram.org')) {
    telegramCalls.push(url);
    // Shape of a real Bot API sendMessage / sendDocument reply for a private chat.
    return new Response(JSON.stringify({
      ok: true,
      result: {
        message_id: 7,
        from: { id: 1, is_bot: true, first_name: 'Bot', username: 'some_bot' },
        chat: { id: 424242, first_name: 'Dev', last_name: 'Private', username: 'dev_handle', type: 'private' },
        document: { file_id: 'FILEID-123456', file_unique_id: 'u1', file_name: 'a.txt', file_size: 3, mime_type: 'text/plain' }
      }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  throw new Error('Unexpected network call in test: ' + url);
};
setAttendanceApiBase(BASE);

const call = (path: string, method: string, headers: Record<string, string> = {}, body?: any, ip = '10.0.0.1') =>
  worker.fetch(new Request(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  }), env);

const GID = 'ingt-310';
kv.m.set(`g:${GID}`, JSON.stringify({ staff: [], slots: [] }));
kv.m.set('g:ingt-311', JSON.stringify({ staff: [], slots: [] }));
const staffToken = await createStaffToken(PEPPER, { gid: GID, role: 'starosta', exp: Date.now() + 86400000 });

console.log('\n=================================================');
console.log('   TEST SUITE: P0 REGRESSIONS (real worker + client)');
console.log('=================================================');

// 1. PC browser sends both X-Staff-Token and Authorization: Bearer (no initData)
console.log('\n1. Staff token on PC (no Telegram initData)');
{
  const r = await call(`/v3/att?gid=${GID}&month=2026-10`, 'GET', { 'X-Staff-Token': staffToken, Authorization: `Bearer ${staffToken}` });
  assert(r.status === 200, `GET /v3/att with X-Staff-Token + Bearer returns 200 (got ${r.status})`);
  const r2 = await call(`/v3/att?gid=${GID}&month=2026-10`, 'GET', { Authorization: `Bearer ${staffToken}` });
  assert(r2.status === 200, `GET /v3/att with Bearer staff token only returns 200 (got ${r2.status})`);
}

// 2. initData older than 24h must not break a request that carries a valid staff token
console.log('\n2. Expired initData + valid staff token');
{
  const old = await createTelegramInitData({ user: JSON.stringify({ id: 1 }), auth_date: String(Math.floor(Date.now() / 1000) - 25 * 3600) }, BOT_TOKEN);
  const r = await call(`/v3/att?gid=${GID}&month=2026-10`, 'GET', { 'X-Telegram-Init-Data': old, 'X-Staff-Token': staffToken });
  assert(r.status === 200, `valid staff token wins over expired initData (got ${r.status})`);
  const r2 = await call(`/v3/att?gid=${GID}&month=2026-10`, 'GET', { 'X-Telegram-Init-Data': old });
  assert(r2.status === 401, `expired initData alone is still rejected (got ${r2.status})`);
}

// 3. Claim: bounded work and no unbounded KV keys when group ids are rotated
console.log('\n3. /v3/staff/claim cost and rate limiting');
{
  const salt = btoa('p0-claim-salt-0123');
  kv.m.set('g:admin', JSON.stringify({ staff: [], codeSalt: salt, codeHash: await pbkdf2('ZZZZ-ZZZZ-ZZZZ-ZZZZ', salt) }));
  const before = [...kv.m.keys()].filter(k => k.startsWith('rl:')).length;
  const statuses = new Set<number>();
  for (let i = 0; i < 12; i++) {
    const r = await call('/v3/staff/claim', 'POST', {}, { gid: `fake-group-${i}`, code: 'S0O1-5S0O-1I5S-0O1I' }, '10.9.9.9');
    statuses.add(r.status);
  }
  const created = [...kv.m.keys()].filter(k => k.startsWith('rl:')).length - before;
  assert(statuses.size === 1 && statuses.has(404), 'unknown groups answer 404');
  assert(created <= 1, `rotating fake group ids creates at most 1 rate-limit key (created ${created})`);

  const real = globalThis.crypto.subtle;
  let derivations = 0;
  const orig = real.deriveBits.bind(real);
  (real as any).deriveBits = (...a: any[]) => { derivations++; return (orig as any)(...a); };
  const groupSalt = btoa('p0-group-salt-0123');
  kv.m.set('g:ingt-312', JSON.stringify({ staff: [], slots: [], codeSalt: groupSalt, codeHash: await pbkdf2('AAAA-BBBB-CCCC-DDDD', groupSalt) }));
  derivations = 0;
  await call('/v3/staff/claim', 'POST', {}, { gid: 'ingt-312', code: 'S0O1-5S0O-1I5S-0O1I' }, '10.8.8.8');
  (real as any).deriveBits = orig;
  assert(derivations <= 10, `one wrong claim costs at most 10 PBKDF2 derivations (was 40), got ${derivations}`);

  let last = 0;
  for (let i = 0; i < 7; i++) last = (await call('/v3/staff/claim', 'POST', {}, { gid: 'ingt-312', code: 'WRONG-CODE-' + i }, '10.7.7.7')).status;
  assert(last === 429, 'repeated wrong codes for a real group end in 429');
}

// 4. /report-error and /upload must not echo Telegram's raw response
console.log('\n4. Telegram response leaks');
{
  const r = await call('/report-error', 'POST', { Origin: 'https://evil.example' }, { message: 'probe ' + Math.random() });
  const text = await r.text();
  assert(!/dev_handle|"chat"|424242|"from"/.test(text), '/report-error response contains no chat/user details');

  const fd = new FormData();
  fd.append('document', new Blob(['abc'], { type: 'text/plain' }), 'a.txt');
  const up = await worker.fetch(new Request(BASE + '/upload', { method: 'POST', headers: { 'X-App-Key': 'p0-app-secret' }, body: fd }), env);
  const upText = await up.text();
  assert(up.status === 200, `/upload with app key returns 200 (got ${up.status})`);
  assert(!/dev_handle|"chat"|424242|"from"/.test(upText), '/upload response contains no chat/user details');
  const upJson = JSON.parse(upText);
  assert(upJson.result?.document?.file_id === 'FILEID-123456' && typeof upJson.direct_url === 'string', '/upload still returns document.file_id and direct_url');
}

// 5. Roster: size limit and optional compare-and-swap
console.log('\n5. /v3/roster');
{
  const h = { 'X-Staff-Token': staffToken };
  const tooBig = await call('/v3/roster', 'PUT', h, { gid: GID, data: 'x'.repeat(60000), iv: 'i', salt: 's' });
  assert(tooBig.status === 413, `oversized roster is rejected with 413 (got ${tooBig.status})`);
  const first = await (await call('/v3/roster', 'PUT', h, { gid: GID, data: 'AAA', iv: 'i', salt: 's' })).json();
  await call('/v3/roster', 'PUT', h, { gid: GID, data: 'BBB', iv: 'i', salt: 's', ver: first.ver });
  const stale = await call('/v3/roster', 'PUT', h, { gid: GID, data: 'CCC', iv: 'i', salt: 's', ver: first.ver });
  assert(stale.status === 409, `stale ver gets 409 (got ${stale.status})`);
  const stored = JSON.parse(kv.m.get(`r:${GID}`)!);
  assert(stored.data === 'BBB', 'the stale write did not overwrite the newer roster');
}

// 6. /v3/att input validation
console.log('\n6. /v3/att validation');
{
  const h = { 'X-Staff-Token': staffToken };
  const keysBefore = kv.m.size;
  const badMonth = await call('/v3/att', 'PUT', h, { gid: GID, month: 'ANYTHING', baseVer: 0, patch: {} });
  assert(badMonth.status === 400, `invalid month is rejected (got ${badMonth.status})`);
  const badKey = await call('/v3/att', 'PUT', h, { gid: GID, month: '2026-10', baseVer: 0, patch: { SLOT1: { 'x/../y': 'u' } } });
  assert(badKey.status === 400, `invalid lesson key is rejected (got ${badKey.status})`);
  assert(kv.m.size === keysBefore, 'rejected requests create no KV keys');
  const idor = await call('/v3/att', 'PUT', h, { gid: 'ingt-311', month: '2026-10', baseVer: 0, patch: {} });
  assert(idor.status === 403, `starosta of one group cannot write another group (got ${idor.status})`);
}

// 7. Two devices marking different students on the same lesson: nobody's marks may be lost
console.log('\n7. Two-device attendance (real client sync + real worker)');
{
  const A = new MemoryStorage();
  const B = new MemoryStorage();
  const students = [
    { id: 1, name: 'Иванов', slot: 'SLOTAAA1' },
    { id: 2, name: 'Петров', slot: 'SLOTBBB2' },
    { id: 3, name: 'Сидоров', slot: 'SLOTCCC3' }
  ];
  const rec = (absent: number[], opts: { cancelled?: boolean; pair?: number } = {}) => ({
    docId: `${GID}_2026-10-21_${GID}-${opts.pair ?? 2}`,
    groupId: GID,
    date: '2026-10-21',
    lessonId: `${GID}-${opts.pair ?? 2}`,
    absentStudentIds: absent,
    excusedStudentIds: [] as number[],
    isCancelled: Boolean(opts.cancelled),
    updatedAt: new Date().toISOString()
  });
  const useDevice = (s: MemoryStorage) => { (globalThis as any).localStorage = s; };
  const monthBlob = () => JSON.parse(kv.m.get(`a:${GID}:2026-10`) || '{"slots":{},"cancelled":[]}');

  for (const dev of [A, B]) {
    useDevice(dev);
    saveLocalStudents(GID, students as any);
    saveStaffToken(staffToken, GID);
  }

  // Device A: student 1 absent on pair 2; pair 3 cancelled
  useDevice(A);
  const a1 = await syncAttendanceRecordsToV3(GID, [rec([1]), rec([], { pair: 3, cancelled: true })] as any);
  assert(a1.ok, 'device A pushes its marks');

  // Device B has not pulled anything. It marks student 2 on the same lesson and has a plain record for pair 3.
  useDevice(B);
  const b1 = await syncAttendanceRecordsToV3(GID, [rec([2]), rec([], { pair: 3 })] as any);
  assert(b1.ok, 'device B pushes its marks');

  let blob = monthBlob();
  assert(blob.slots.SLOTAAA1?.['10-21.2'] === 'u', "A's mark for student 1 survived B's sync");
  assert(blob.slots.SLOTBBB2?.['10-21.2'] === 'u', "B's mark for student 2 is stored");
  assert(Array.isArray(blob.cancelled) && blob.cancelled.includes('10-21.3'), "A's cancellation of pair 3 survived B's stale record");

  // An unchanged re-sync must not write anything
  const putsBefore = kv.puts;
  useDevice(B);
  await syncAttendanceRecordsToV3(GID, [rec([2]), rec([], { pair: 3 })] as any);
  assert(kv.puts === putsBefore, `re-sync without changes performs no KV writes (${kv.puts - putsBefore} writes)`);

  // A genuine unmark on A removes only that cell
  useDevice(A);
  const a2 = await syncAttendanceRecordsToV3(GID, [rec([]), rec([], { pair: 3, cancelled: true })] as any);
  assert(a2.ok, 'device A pushes an unmark');
  blob = monthBlob();
  assert(blob.slots.SLOTAAA1?.['10-21.2'] === undefined, 'an explicit unmark removes the cell');
  assert(blob.slots.SLOTBBB2?.['10-21.2'] === 'u', "an unmark of student 1 leaves student 2's mark alone");
}

// 8. Lesson length (double pairs) must travel through the server, and the merge must never drop it
console.log('\n8. Lesson hours across devices');
{
  const A = new MemoryStorage();
  const B = new MemoryStorage();
  const students = [
    { id: 1, name: 'Иванов', slot: 'SLOTAAA1' },
    { id: 2, name: 'Петров', slot: 'SLOTBBB2' }
  ];
  for (const dev of [A, B]) {
    (globalThis as any).localStorage = dev;
    saveLocalStudents(GID, students as any);
    saveStaffToken(staffToken, GID);
  }
  const doublePair = {
    docId: `${GID}_2026-10-21_${GID}-4`, groupId: GID, date: '2026-10-21', lessonId: `${GID}-4`,
    absentStudentIds: [1], excusedStudentIds: [] as number[], isCancelled: false, hours: 4,
    updatedAt: new Date().toISOString()
  };
  (globalThis as any).localStorage = A;
  const res = await syncAttendanceRecordsToV3(GID, [doublePair] as any);
  assert(res.ok, 'device A pushes a 4-hour lesson');
  assert(JSON.parse(kv.m.get(`a:${GID}:2026-10`)!).hours?.['10-21.4'] === 4, 'server stores the lesson length');

  (globalThis as any).localStorage = B;
  const pulled = await pullAttendanceRecordsFromV3(GID);
  const rec4 = pulled.find(r => r.date === '2026-10-21' && /-4$/.test(r.lessonId));
  assert(rec4?.hours === 4, `device B restores hours=4 from the server (got ${rec4?.hours})`);

  const merged = mergeAttendance(
    [{ ...doublePair, updatedAt: '2026-10-21T10:00:00.000Z' }] as any,
    [{ ...doublePair, hours: undefined, updatedAt: '2026-10-21T12:00:00.000Z' }] as any,
    GID
  );
  assert(merged[0]?.hours === 4, 'a newer remote record without hours does not erase the local lesson length');

  (globalThis as any).localStorage = A;
  const bad = await call('/v3/att', 'PUT', { 'X-Staff-Token': staffToken }, { gid: GID, month: '2026-10', baseVer: 0, patch: {}, hours: { '10-21.4': 99 } });
  assert(bad.status === 400, `out-of-range hours are rejected (got ${bad.status})`);
}

// 9. Orphan server slots must not be bound to a newly added student
console.log('\n9. Slot binding safety');
{
  kv.m.set(`a:${GID}:2026-10`, JSON.stringify({
    ver: 50, cancelled: [], hours: {}, updatedAt: Date.now(),
    slots: { SLOTAAA1: {}, SLOTBBB2: {}, SLOTORPH: { '10-22.1': 'u' } }
  }));
  const C = new MemoryStorage();
  (globalThis as any).localStorage = C;
  saveLocalStudents(GID, [
    { id: 1, name: 'Иванов', slot: 'SLOTAAA1' },
    { id: 2, name: 'Петров', slot: 'SLOTBBB2' },
    { id: 3, name: 'Новиков' }
  ] as any);
  saveStaffToken(staffToken, GID);
  const pulled = await pullAttendanceRecordsFromV3(GID);
  const orphanRec = pulled.find(r => r.date === '2026-10-22');
  assert(!orphanRec || !orphanRec.absentStudentIds.includes(3), "a removed student's orphan slot is not inherited by a new student");

  const D = new MemoryStorage();
  (globalThis as any).localStorage = D;
  saveLocalStudents(GID, [{ id: 1, name: 'Иванов' }, { id: 2, name: 'Петров' }, { id: 3, name: 'Новиков' }] as any);
  saveStaffToken(staffToken, GID);
  kv.m.set(`a:${GID}:2026-10`, JSON.stringify({
    ver: 51, cancelled: [], hours: {}, updatedAt: Date.now(),
    slots: { SLOTAAA1: {}, SLOTBBB2: {}, SLOTCCC3: { '10-22.1': 'u' } }
  }));
  const cold = await pullAttendanceRecordsFromV3(GID);
  const coldRec = cold.find(r => r.date === '2026-10-22');
  assert(Boolean(coldRec) && coldRec!.absentStudentIds.length === 1, 'a completely unslotted roster with matching counts still binds on a cold start');
}

// 10. The bundle must not ship real names
console.log('\n10. Built-in roster is anonymous');
{
  const names = (STUDENTS_REGISTRY['ingt-310'] || []).map(st => st.name);
  assert(names.length === 16 && names.every(n => /^Студент \d+$/.test(n)), 'ingt-310 built-in roster contains placeholders only');
}

// 11. DELETE /v3/me does not erase attendance marks in a:{gid}:{month}
console.log('\n11. DELETE /v3/me does not erase attendance marks');
{
  const testUserId = 777123;
  const userInit = await createTelegramInitData({
    user: JSON.stringify({ id: testUserId }),
    auth_date: String(Math.floor(Date.now() / 1000))
  }, BOT_TOKEN);
  const uBlind = await blindId(env, testUserId);
  const testSlot = 'SLOTTEST77';

  // Seed group slots, student binding, and attendance marks
  kv.m.set(`u:${uBlind}`, JSON.stringify({ gid: GID, slot: testSlot }));
  kv.m.set(`s:${GID}`, JSON.stringify({ slots: { [testSlot]: { claimed: true, claimedAt: Date.now() } } }));
  kv.m.set(`a:${GID}:2026-10`, JSON.stringify({
    ver: 60,
    cancelled: [],
    slots: {
      [testSlot]: { '10-21.1': 'u', '10-21.2': 'e' },
      SLOTBBB2: { '10-21.1': 'u' }
    }
  }));

  const delRes = await call('/v3/me', 'DELETE', { 'X-Telegram-Init-Data': userInit });
  assert(delRes.status === 200, `DELETE /v3/me returns 200 (got ${delRes.status})`);
  const delJson = await delRes.json();
  assert(delJson.ok === true && delJson.deleted === true, 'DELETE /v3/me reports ok: true, deleted: true');
  assert(!kv.m.has(`u:${uBlind}`), 'student binding u:{blindId} is deleted');

  // Verify group slot claimed flag is cleared
  const slotsData = JSON.parse(kv.m.get(`s:${GID}`)!);
  assert(slotsData.slots[testSlot].claimed === undefined, 'slot claimed status is cleared');

  // Verify attendance records in a:{gid}:{month} were NOT touched (P7 invariant)
  const attData = JSON.parse(kv.m.get(`a:${GID}:2026-10`)!);
  assert(attData.slots[testSlot]?.['10-21.1'] === 'u', 'attendance mark 10-21.1 for slot is preserved in starosta journal');
  assert(attData.slots[testSlot]?.['10-21.2'] === 'e', 'attendance mark 10-21.2 for slot is preserved in starosta journal');
  assert(attData.slots.SLOTBBB2?.['10-21.1'] === 'u', 'other students marks are untouched');
}

// 12. 3-way merge (merge3) test cases
console.log('\n12. 3-way merge (merge3) tests');
{
  // 12.1. Concurrent marks on the same lesson (Device A marks student 1, Device B marks student 2)
  const baseLesson = {
    docId: `${GID}_2026-10-25_${GID}-1`,
    groupId: GID,
    date: '2026-10-25',
    lessonId: `${GID}-1`,
    absentStudentIds: [] as number[],
    excusedStudentIds: [] as number[],
    isCancelled: false,
    hours: 2
  };
  const baseMap = snapshotBase([baseLesson]);

  const localA = [{ ...baseLesson, absentStudentIds: [1] }];
  const remoteB = [{ ...baseLesson, excusedStudentIds: [2] }];

  const res1 = merge3(localA, baseMap, remoteB, ['2026-10']);
  assert(res1.merged.length === 1, 'merge3 produces 1 merged lesson');
  const m1 = res1.merged[0];
  assert(m1.absentStudentIds.includes(1), 'Device A mark (student 1 absent) is preserved');
  assert(m1.excusedStudentIds?.includes(2), 'Device B mark (student 2 excused) is merged');

  // 12.2. Conflict resolution: local edit overrides untouched remote
  const baseWith1 = snapshotBase([{ ...baseLesson, absentStudentIds: [1] }]);
  const localUnmarked = [{ ...baseLesson, absentStudentIds: [] }]; // local unmarked student 1
  const remoteStale = [{ ...baseLesson, absentStudentIds: [1] }]; // remote unchanged from base

  const res2 = merge3(localUnmarked, baseWith1, remoteStale, ['2026-10']);
  assert(!res2.merged[0].absentStudentIds.includes(1), 'local unmarking wins when remote did not change');

  // 12.3. Cancellation and lesson hours preservation
  const localCancelled = [{ ...baseLesson, isCancelled: true, hours: 4 }];
  const remoteUncancelled = [{ ...baseLesson, isCancelled: false, hours: 2 }];

  const res3 = merge3(localCancelled, baseMap, remoteUncancelled, ['2026-10']);
  assert(res3.merged[0].isCancelled === true, 'local cancellation is preserved');
  assert(res3.merged[0].hours === 4, 'local custom hours (4h) are preserved');

  // 12.4. Remote new lesson added in fetched month
  const remoteNewLesson = {
    docId: `${GID}_2026-10-26_${GID}-2`,
    groupId: GID,
    date: '2026-10-26',
    lessonId: `${GID}-2`,
    absentStudentIds: [3],
    excusedStudentIds: [] as number[],
    isCancelled: false,
    hours: 2
  };
  const res4 = merge3([], baseMap, [remoteNewLesson], ['2026-10']);
  assert(res4.merged.length === 1 && res4.merged[0].absentStudentIds.includes(3), 'new remote lesson in fetched month is added to local');
}

(globalThis as any).fetch = realFetch;
(globalThis as any).localStorage = realLocalStorage;

console.log(`\nTOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
if (failed > 0) process.exitCode = 1;
