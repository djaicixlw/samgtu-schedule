/**
 * D1 attendance suite: the REAL cloudflare-worker.js + worker/attendance_d1.js on a REAL SQLite engine
 * (node:sqlite behind a D1-shaped shim), plus the REAL client sync code. No network.
 *
 * Covered: schema, legacy API on D1 groups (no 409, cancel/hours), parallel writes (the KV race that loses data),
 * LWW + tombstones + tie-break + clock clamp, idempotent replay, change feed + pagination, input validation and
 * authorization, student reads, slot removal, two devices through the real client, KV->D1 migration
 * (copy / verify / flip / re-copy / rollback), fail-closed on D1 outage, constant statement count.
 */
import { readFileSync } from 'node:fs';
import worker, { createStaffToken, createTelegramInitData, blindId } from '../cloudflare-worker.js';
import { migrateFlip, readMonth, attStorage } from '../worker/attendance_d1.js';
import {
  setAttendanceApiBase, saveStaffToken, saveLocalStudents, syncAttendanceRecordsToV3, pullAttendanceRecordsFromV3
} from '../utils/attendanceStorage';
import { D1Shim } from './helpers/d1_shim';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✓ [PASS] ${msg}`); }
  else { failed++; console.error(`  ❌ [FAIL] ${msg}`); process.exitCode = 1; }
}

class MemKV {
  m = new Map<string, string>();
  puts = 0;
  constructor(private latencyMs = 3) {}
  private wait() { return new Promise(r => setTimeout(r, this.latencyMs)); }
  async get(k: string) { await this.wait(); return this.m.has(k) ? this.m.get(k)! : null; }
  async put(k: string, v: string, _o?: any) { await this.wait(); this.puts++; this.m.set(k, v); }
  async delete(k: string) { await this.wait(); this.m.delete(k); }
  async list(o: { prefix?: string } = {}) {
    await this.wait();
    return { keys: [...this.m.keys()].filter(k => k.startsWith(o.prefix || '')).sort().map(name => ({ name })), list_complete: true };
  }
  keysWith(prefix: string) { return [...this.m.keys()].filter(k => k.startsWith(prefix)); }
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
const BOT_TOKEN = '123456789:test-token-for-d1-suite';
const PEPPER = 'd1-suite-pepper-0123456789abcdef';
const SQL = readFileSync(new URL('../migrations/0001_attendance.sql', import.meta.url), 'utf8');

const kv = new MemKV(3);
const d1 = new D1Shim(2);
d1.exec(SQL);
const env: any = { APP_DATA: kv, DB: d1, ID_PEPPER: PEPPER, TELEGRAM_BOT_TOKEN: BOT_TOKEN, APP_SECRET: 'd1-app-secret', DEV_CHAT_ID: '424242' };
const envNoDb: any = { APP_DATA: kv, ID_PEPPER: PEPPER, TELEGRAM_BOT_TOKEN: BOT_TOKEN, APP_SECRET: 'd1-app-secret' };

(globalThis as any).fetch = async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith(BASE)) return worker.fetch(new Request(url, init), env);
  throw new Error('Unexpected network call in test: ' + url);
};
setAttendanceApiBase(BASE);

const api = (path: string, method: string, headers: Record<string, string> = {}, body?: any, e: any = env) =>
  worker.fetch(new Request(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '10.1.1.1', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  }), e);
const json = async (r: Response) => r.json() as Promise<any>;

const mkGroup = (gid: string) => kv.m.set(`g:${gid}`, JSON.stringify({ staff: [], slots: [] }));
const tokenFor = (gid: string, role = 'starosta') => createStaffToken(PEPPER, { gid, role, exp: Date.now() + 86400000 });
const auth = (t: string) => ({ 'X-Staff-Token': t });
const rowsOf = (gid: string, table = 'marks') => (d1.db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE gid = ?`).get(gid) as any).c as number;

console.log('\n=================================================');
console.log('   TEST SUITE: D1 ATTENDANCE (real worker + SQLite)');
console.log('=================================================');

// 1. Schema and storage selection
console.log('\n1. Schema, migration file idempotence, storage selection');
{
  let threw = false;
  try { d1.exec(SQL); } catch { threw = true; }
  assert(!threw, 'the migration file can be applied twice (IF NOT EXISTS everywhere)');
  mkGroup('sel-kv'); mkGroup('sel-d1');
  await migrateFlip(env, 'sel-d1');
  assert((await attStorage(env, 'sel-kv')) === 'kv', 'a group without a row in att_groups is served from KV');
  assert((await attStorage(env, 'sel-d1')) === 'd1', 'a flipped group is served from D1');
  assert((await attStorage(envNoDb, 'sel-d1')) === 'kv', 'without the DB binding everything stays on KV (safe to deploy before the DB exists)');
  const t = await tokenFor('sel-kv');
  const r = await api('/v3/att?gid=sel-kv&month=2026-10', 'GET', auth(t), undefined, envNoDb);
  assert(r.status === 200, 'KV-only deployment (no DB binding) still serves /v3/att');
}

// 2. Legacy API on a D1 group
console.log('\n2. Legacy GET/PUT /v3/att on a D1 group');
{
  const gid = 'leg-d1';
  mkGroup(gid); await migrateFlip(env, gid);
  const h = auth(await tokenFor(gid));
  let r = await api('/v3/att', 'PUT', h, { gid, month: '2026-10', baseVer: 0, patch: { SLOTAAA1: { '10-21.2': 'u' }, SLOTBBB2: { '10-21.2': 'e' } }, cancel: { '10-21.3': true }, hours: { '10-21.4': 4 } });
  let b = await json(r);
  assert(r.status === 200 && b.ok && b.ver >= 1, `PUT is accepted (ver ${b.ver})`);
  r = await api('/v3/att', 'PUT', h, { gid, month: '2026-10', baseVer: 999, patch: { SLOTCCC3: { '10-21.2': 'u' } } });
  assert(r.status === 200, 'a stale baseVer does NOT produce a 409 on D1 (cell-level ops cannot conflict)');
  const snap = await json(await api(`/v3/att?gid=${gid}&month=2026-10`, 'GET', h));
  assert(snap.slots.SLOTAAA1['10-21.2'] === 'u' && snap.slots.SLOTBBB2['10-21.2'] === 'e' && snap.slots.SLOTCCC3['10-21.2'] === 'u', 'GET returns every mark in the legacy shape');
  assert(JSON.stringify(snap.cancelled) === '["10-21.3"]' && snap.hours['10-21.4'] === 4, 'cancelled and hours are returned');
  assert(snap.ver >= 2 && snap.updatedAt > 0, 'ver is the group revision and updatedAt is set');

  await api('/v3/att', 'PUT', h, { gid, month: '2026-10', patch: { SLOTAAA1: { '10-21.2': null } } });
  const afterClear = await json(await api(`/v3/att?gid=${gid}&month=2026-10`, 'GET', h));
  assert(afterClear.slots.SLOTAAA1 === undefined && afterClear.slots.SLOTBBB2['10-21.2'] === 'e', 'null clears exactly one cell');

  await api('/v3/att', 'PUT', h, { gid, month: '2026-10', cancel: ['10-22.1'] });
  const arr = await json(await api(`/v3/att?gid=${gid}&month=2026-10`, 'GET', h));
  assert(JSON.stringify(arr.cancelled) === '["10-22.1"]', 'legacy cancel ARRAY still means "replace the month\'s set"');
  await api('/v3/att', 'PUT', h, { gid, month: '2026-10', cancel: { '10-22.1': false }, hours: { '10-21.4': null } });
  const del = await json(await api(`/v3/att?gid=${gid}&month=2026-10`, 'GET', h));
  assert(del.cancelled.length === 0 && del.hours['10-21.4'] === undefined, 'cancel:false and hours:null remove the facts');

  r = await api('/v3/att', 'PUT', h, { gid, month: '2026-10', patch: { SLOTAAA1: { '11-02.1': 'u' } } });
  assert(r.status === 400, 'a lesson key from another month is rejected');
  const other = await json(await api(`/v3/att?gid=${gid}&month=2026-09`, 'GET', h));
  assert(Object.keys(other.slots).length === 0, 'months are isolated from each other');
}

// 3. The race that KV loses and D1 does not
console.log('\n3. 30 parallel writers with the SAME stale baseVer');
{
  const N = 30;
  const writers = (gid: string, h: Record<string, string>) => Promise.all(Array.from({ length: N }, (_, i) =>
    api('/v3/att', 'PUT', h, { gid, month: '2026-10', baseVer: 0, patch: { [`SLOT${String(i).padStart(4, '0')}`]: { '10-21.2': 'u' } } })));

  mkGroup('par-d1'); await migrateFlip(env, 'par-d1');
  const res = await writers('par-d1', auth(await tokenFor('par-d1')));
  const okCount = res.filter(r => r.status === 200).length;
  const snap = await readMonth(env, 'par-d1', '2026-10');
  assert(okCount === N, `all ${N} parallel writes are accepted on D1 (got ${okCount})`);
  assert(Object.keys(snap.slots).length === N, `all ${N} marks are stored on D1 (got ${Object.keys(snap.slots).length})`);

  mkGroup('par-kv');
  await writers('par-kv', auth(await tokenFor('par-kv')));
  const kvDoc = JSON.parse(kv.m.get('a:par-kv:2026-10') || '{"slots":{}}');
  const kvMarks = Object.keys(kvDoc.slots).length;
  assert(kvMarks < N, `(documented) the same burst on the KV path keeps only ${kvMarks} of ${N} marks`);
}

// 4. LWW, tombstones, tie-break, clock clamp
console.log('\n4. Last-writer-wins per cell');
{
  const gid = 'lww-d1';
  mkGroup(gid); await migrateFlip(env, gid);
  const h = auth(await tokenFor(gid));
  const t0 = Date.now();
  const put = (ops: any[], dev?: string) => api('/v3/att/ops', 'POST', h, { gid, dev, ops });
  const cell = async (slot: string, key: string) => (await readMonth(env, gid, '2026-10')).slots[slot]?.[key] ?? '';
  const K = '2026-10-21.0945';

  await put([{ t: 'm', k: K, s: 'SLOTAAA1', v: 'u', at: t0 }]);
  await put([{ t: 'm', k: K, s: 'SLOTAAA1', v: '', at: t0 - 5000 }]);
  assert((await cell('SLOTAAA1', K)) === 'u', 'an OLDER clear arriving later does not erase a newer mark');
  await put([{ t: 'm', k: K, s: 'SLOTAAA1', v: '', at: t0 + 10 }]);
  assert((await cell('SLOTAAA1', K)) === '', 'a newer clear wins');
  await put([{ t: 'm', k: K, s: 'SLOTAAA1', v: 'u', at: t0 + 5 }]);
  assert((await cell('SLOTAAA1', K)) === '', 'an older offline mark cannot resurrect a cleared cell (tombstone)');

  await put([{ t: 'm', k: K, s: 'SLOTBBB2', v: 'u', at: t0 }], 'aaa');
  await put([{ t: 'm', k: K, s: 'SLOTBBB2', v: 'e', at: t0 }], 'bbb');
  await put([{ t: 'm', k: K, s: 'SLOTCCC3', v: 'e', at: t0 }], 'bbb');
  await put([{ t: 'm', k: K, s: 'SLOTCCC3', v: 'u', at: t0 }], 'aaa');
  assert((await cell('SLOTBBB2', K)) === 'e' && (await cell('SLOTCCC3', K)) === 'e', 'equal timestamps resolve deterministically (greater device id wins, order-independent)');

  await put([{ t: 'm', k: K, s: 'SLOTDDD4', v: 'u', at: t0 + 3600_000 }]);
  const feed = await json(await api(`/v3/att/changes?gid=${gid}&since=0`, 'GET', h));
  const stored = feed.marks.find((m: any) => m[2] === 'SLOTDDD4');
  assert(!!stored && stored[4] <= Date.now() + 121_000, `a device clock one hour ahead is clamped to now+2min (stored ${stored ? stored[4] - Date.now() : '?'} ms ahead)`);

  await put([{ t: 'c', k: K, on: true, at: t0 }, { t: 'h', k: K, h: 4, at: t0 }]);
  await put([{ t: 'c', k: K, on: false, at: t0 - 1 }, { t: 'h', k: K, h: null, at: t0 - 1 }]);
  const st = await readMonth(env, gid, '2026-10');
  assert(st.cancelled.includes(K) && st.hours[K] === 4, 'cancel and hours are independent LWW registers and ignore older writes');
}

// 5. Idempotent replay and the change feed
console.log('\n5. Idempotent replay and /v3/att/changes');
{
  const gid = 'feed-d1';
  mkGroup(gid); await migrateFlip(env, gid);
  const h = auth(await tokenFor(gid));
  const ops = [{ t: 'm', k: '2026-10-21.0945', s: 'SLOTAAA1', v: 'u', at: Date.now() }, { t: 'm', k: '2026-10-21.0945', s: 'SLOTBBB2', v: 'e', at: Date.now() }];
  const first = await json(await api('/v3/att/ops', 'POST', h, { gid, ops }));
  assert(first.ok && first.applied === 2, 'ops are applied');
  const replay = await json(await api('/v3/att/ops', 'POST', h, { gid, ops }));
  assert(replay.rev > first.rev, 'every request bumps the group revision');
  const feed = await json(await api(`/v3/att/changes?gid=${gid}&since=${first.rev}`, 'GET', h));
  assert(feed.marks.length === 0, 'replaying the same ops changes no rows, so the feed is empty');
  const all = await json(await api(`/v3/att/changes?gid=${gid}&since=0`, 'GET', h));
  assert(all.marks.length === 2 && all.rev === replay.rev && all.more === false, 'since=0 returns the full state');
  await api('/v3/att/ops', 'POST', h, { gid, ops: [{ t: 'm', k: '2026-10-21.0945', s: 'SLOTAAA1', v: '', at: Date.now() + 5 }] });
  const inc = await json(await api(`/v3/att/changes?gid=${gid}&since=${replay.rev}`, 'GET', h));
  assert(inc.marks.length === 1 && inc.marks[0][2] === 'SLOTAAA1' && inc.marks[0][3] === '', 'an incremental pull returns only the cleared cell (as a tombstone)');
}

// 6. Pagination never splits one revision
console.log('\n6. Change feed pagination');
{
  const gid = 'page-d1';
  mkGroup(gid); await migrateFlip(env, gid);
  const h = auth(await tokenFor(gid));
  const keys: string[] = [];
  for (let d = 1; d <= 28; d++) for (const hhmm of ['0800', '0945', '1150', '1335']) keys.push(`2026-10-${String(d).padStart(2, '0')}.${hhmm}`);
  const cells: any[] = [];
  for (let s = 0; s < 30 && cells.length < 1300; s++) for (const k of keys) { if (cells.length < 1300) cells.push({ t: 'm', k, s: `SLOT${String(s).padStart(4, '0')}`, v: 'u', at: Date.now() }); }
  for (let i = 0; i < cells.length; i += 500) {
    const r = await api('/v3/att/ops', 'POST', h, { gid, ops: cells.slice(i, i + 500) });
    if (r.status !== 200) assert(false, 'bulk ops accepted');
  }
  let since = 0; const seen = new Set<string>(); const pageOfRev = new Map<number, number>(); let pages = 0; let split = false;
  for (let guard = 0; guard < 20; guard++) {
    const p = await json(await api(`/v3/att/changes?gid=${gid}&since=${since}&limit=1000`, 'GET', h));
    pages++;
    for (const m of p.marks) {
      seen.add(`${m[0]}|${m[1]}|${m[2]}`);
      if (pageOfRev.has(m[5]) && pageOfRev.get(m[5]) !== pages) split = true;
      pageOfRev.set(m[5], pages);
    }
    if (!p.more) break;
    since = p.next;
  }
  assert(seen.size === 1300, `paging with limit=1000 yields all 1300 marks exactly once (got ${seen.size} in ${pages} pages)`);
  assert(pages >= 2 && !split, 'several pages, and no revision is split across two pages');
}

// 7. Validation and authorization
console.log('\n7. Validation and authorization');
{
  const gid = 'val-d1';
  mkGroup(gid); await migrateFlip(env, gid); mkGroup('val-other'); mkGroup('val-kv');
  const h = auth(await tokenFor(gid));
  const before = rowsOf(gid);
  const bad = async (ops: any, label: string) => {
    const r = await api('/v3/att/ops', 'POST', h, { gid, ops });
    assert(r.status === 400, `${label} -> 400 (got ${r.status})`);
  };
  await bad([{ t: 'm', k: '2026-10-21.0945', s: 'bad slot!', v: 'u' }], 'a slot id with illegal characters');
  await bad([{ t: 'm', k: '2026-10-21.0945', s: 'SLOTAAA1', v: 'x' }], 'an unknown mark status');
  await bad([{ t: 'm', k: 'no-day', s: 'SLOTAAA1', v: 'u' }], 'a key without a resolvable day');
  await bad([{ t: 'm', k: '10-21.2', s: 'SLOTAAA1', v: 'u' }], 'a short MM-DD key without a month');
  await bad([{ t: 'h', k: '2026-10-21.0945', h: 99 }], 'hours out of range');
  await bad([{ t: 'zzz', k: '2026-10-21.0945' }], 'an unknown op type');
  await bad([], 'an empty ops array');
  await bad(Array.from({ length: 501 }, (_, i) => ({ t: 'm', k: '2026-10-21.0945', s: `S${i}`, v: 'u' })), '501 ops');
  assert(rowsOf(gid) === before, 'rejected requests wrote nothing');

  const ok = { gid, ops: [{ t: 'm', k: '2026-10-21.0945', s: 'SLOTAAA1', v: 'u' }] };
  assert((await api('/v3/att/ops', 'POST', {}, ok)).status === 401, 'no credentials -> 401');
  assert((await api('/v3/att/ops', 'POST', auth(await tokenFor('val-other')), ok)).status === 403, "another group's starosta -> 403");
  assert((await api('/v3/att/changes?gid=' + gid + '&since=0', 'GET', auth(await tokenFor('val-other')))).status === 403, "another group's starosta cannot read the change feed");
  assert((await api('/v3/att/ops', 'POST', auth(await tokenFor('val-kv')), { gid: 'val-kv', ops: ok.ops })).status === 409, 'ops on a group that is still on KV -> 409 NOT_D1');
  assert((await api('/v3/att/ops', 'POST', h, { gid: 'x:y', ops: ok.ops })).status === 400, 'a gid with a colon is rejected');
}

// 8. Student reads and the journal stays intact
console.log('\n8. Student "my absences" and DELETE /v3/me');
{
  const gid = 'stu-d1';
  mkGroup(gid); await migrateFlip(env, gid);
  const h = auth(await tokenFor(gid));
  await api('/v3/att', 'PUT', h, { gid, month: '2026-10', patch: { SLOTSTU1: { '10-21.2': 'u', '10-22.1': 'e' }, SLOTOTH2: { '10-21.2': 'u' } }, cancel: { '10-23.1': true } });
  const uid = 777001;
  const blind = await blindId(env, uid);
  kv.m.set('u:' + blind, JSON.stringify({ gid, slot: 'SLOTSTU1', consentVer: 1, consentAt: Date.now() }));
  const initData = await createTelegramInitData({ user: JSON.stringify({ id: uid }), auth_date: String(Math.floor(Date.now() / 1000)) }, BOT_TOKEN);
  const me = await json(await api('/v3/me?month=2026-10', 'GET', { 'X-Telegram-Init-Data': initData }));
  assert(me.linked && me.marks['10-21.2'] === 'u' && me.marks['10-22.1'] === 'e' && Object.keys(me.marks).length === 2, 'a student sees exactly their own marks');
  assert(JSON.stringify(me.cancelled) === '["10-23.1"]', 'and the cancelled lessons');
  const del = await api('/v3/me', 'DELETE', { 'X-Telegram-Init-Data': initData });
  assert(del.status === 200, 'the student unlinks the account');
  const snap = await readMonth(env, gid, '2026-10');
  assert(snap.slots.SLOTSTU1?.['10-21.2'] === 'u', 'the group journal keeps the marks after DELETE /v3/me');
}

// 9. Slot removal
console.log('\n9. Staff removes a student slot');
{
  const gid = 'del-d1';
  mkGroup(gid); await migrateFlip(env, gid);
  const h = auth(await tokenFor(gid));
  await api('/v3/att', 'PUT', h, { gid, month: '2026-10', patch: { SLOTAAA1: { '10-21.2': 'u' }, SLOTBBB2: { '10-21.2': 'u' } } });
  const r = await api(`/v3/slot/SLOTAAA1?gid=${gid}`, 'DELETE', h);
  const snap = await readMonth(env, gid, '2026-10');
  assert(r.status === 200 && snap.slots.SLOTAAA1 === undefined && snap.slots.SLOTBBB2?.['10-21.2'] === 'u', "only the removed student's rows disappear");
}

// 10. Real client, two devices, D1 group
console.log('\n10. Two devices through the real client sync code');
{
  const gid = 'dev-d1';
  mkGroup(gid); await migrateFlip(env, gid);
  const token = await tokenFor(gid);
  const A = new MemoryStorage(); const B = new MemoryStorage();
  const students = [{ id: 1, name: 'Иванов', slot: 'SLOTAAA1' }, { id: 2, name: 'Петров', slot: 'SLOTBBB2' }, { id: 3, name: 'Сидоров', slot: 'SLOTCCC3' }];
  const rec = (absent: number[], opts: { cancelled?: boolean; pair?: number } = {}) => ({
    docId: `${gid}_2026-10-21_${gid}-${opts.pair ?? 2}`, groupId: gid, date: '2026-10-21', lessonId: `${gid}-${opts.pair ?? 2}`,
    absentStudentIds: absent, excusedStudentIds: [] as number[], isCancelled: Boolean(opts.cancelled), updatedAt: new Date().toISOString()
  });
  const use = (s: MemoryStorage) => { (globalThis as any).localStorage = s; };
  for (const dev of [A, B]) { use(dev); saveLocalStudents(gid, students as any); saveStaffToken(token, gid); }

  use(A);
  const a1 = await syncAttendanceRecordsToV3(gid, [rec([1]), rec([], { pair: 3, cancelled: true })] as any);
  use(B);
  const b1 = await syncAttendanceRecordsToV3(gid, [rec([2]), rec([], { pair: 3 })] as any);
  assert(a1.ok && b1.ok, 'both devices push');
  const snap = await readMonth(env, gid, '2026-10');
  assert(snap.slots.SLOTAAA1?.['10-21.2'] === 'u' && snap.slots.SLOTBBB2?.['10-21.2'] === 'u', "both marks are in D1: B's stale record did not erase A's mark");
  assert(snap.cancelled.includes('10-21.3'), "A's cancellation survived B's stale record");

  const pulled = await pullAttendanceRecordsFromV3(gid);
  const lesson = pulled.find(r => r.lessonId.endsWith('-2'));
  assert(!!lesson && lesson.absentStudentIds.slice().sort().join() === '1,2', 'pulling from D1 reconstructs the lesson with both students');

  d1.resetCounters();
  use(B);
  await syncAttendanceRecordsToV3(gid, [rec([2]), rec([], { pair: 3 })] as any);
  assert(d1.batches === 0, `an unchanged re-sync costs no D1 round trips (${d1.batches})`);

  use(A);
  const a2 = await syncAttendanceRecordsToV3(gid, [rec([]), rec([], { pair: 3, cancelled: true })] as any);
  const snap2 = await readMonth(env, gid, '2026-10');
  assert(a2.ok && snap2.slots.SLOTAAA1 === undefined && snap2.slots.SLOTBBB2?.['10-21.2'] === 'u', 'an unmark on A removes only A\'s cell');
}

// 11. KV -> D1 migration
console.log('\n11. Migration: copy, verify, flip, re-copy, rollback');
{
  const gid = 'mig-grp';
  mkGroup(gid);
  const T1 = Date.now() - 3600_000;
  kv.m.set(`a:${gid}:2026-10`, JSON.stringify({ ver: 7, updatedAt: T1, slots: { SLOTAAA1: { '10-21.2': 'u', '10-22.1': 'e' }, SLOTBBB2: { '10-21.2': 'u' } }, cancelled: ['10-21.3'], hours: { '10-21.4': 4 } }));
  kv.m.set(`a:${gid}:2026-09`, JSON.stringify({ ver: 2, updatedAt: T1 - 86400_000, slots: { SLOTAAA1: { '09-15.1': 'u' } }, cancelled: [], hours: {} }));
  const admin = auth(await tokenFor('admin', 'admin'));
  const starosta = auth(await tokenFor(gid));
  const mig = (mode: string, h = admin, g = gid) => api('/v3/admin/att/migrate', 'POST', h, { gid: g, mode });

  assert((await mig('copy', starosta)).status === 403, 'a starosta cannot run the migration');
  assert((await mig('bogus')).status === 400, 'an unknown mode is rejected');
  let r = await json(await mig('status'));
  assert(r.storage === 'kv' && r.verify.ok === false, 'before the copy: still on KV and D1 does not match');

  // flip without copy must be refused
  mkGroup('mig-nocopy');
  kv.m.set('a:mig-nocopy:2026-10', JSON.stringify({ ver: 1, updatedAt: T1, slots: { SLOTAAA1: { '10-21.2': 'u' } }, cancelled: [], hours: {} }));
  const refused = await mig('flip', admin, 'mig-nocopy');
  assert(refused.status === 409 && (await attStorage(env, 'mig-nocopy')) === 'kv', 'flip is refused (409) until D1 matches KV');

  r = await json(await mig('copy'));
  assert(r.ok && r.verify.ok && r.copied.months.length === 2, 'copy imports both months and verifies exactly');
  const again = await json(await mig('copy'));
  assert(again.verify.ok && rowsOf(gid) === 4, 'copy is idempotent (no duplicate rows)');
  assert((await attStorage(env, gid)) === 'kv', 'copying alone does not switch the group');

  const kvPutsBefore = kv.puts;
  r = await json(await mig('flip'));
  assert(r.ok && r.storage === 'd1', 'flip switches the group to D1');

  const h = starosta;
  const snap = await json(await api(`/v3/att?gid=${gid}&month=2026-10`, 'GET', h));
  assert(snap.slots.SLOTAAA1['10-21.2'] === 'u' && snap.slots.SLOTAAA1['10-22.1'] === 'e' && snap.slots.SLOTBBB2['10-21.2'] === 'u' && snap.cancelled[0] === '10-21.3' && snap.hours['10-21.4'] === 4,
    'after the flip the client reads the migrated month unchanged');

  await api('/v3/att', 'PUT', h, { gid, month: '2026-10', patch: { SLOTAAA1: { '10-21.2': null } } });
  assert(kv.puts === kvPutsBefore, 'writes after the flip do not touch KV');

  // straggler: a KV write that was only visible after the first copy (older than the flip)
  kv.m.set(`a:${gid}:2026-10`, JSON.stringify({ ver: 8, updatedAt: T1 + 1000, slots: { SLOTAAA1: { '10-21.2': 'u', '10-22.1': 'e' }, SLOTBBB2: { '10-21.2': 'u', '10-22.1': 'u' } }, cancelled: ['10-21.3'], hours: { '10-21.4': 4 } }));
  r = await json(await mig('copy'));
  const after = await readMonth(env, gid, '2026-10');
  assert(after.slots.SLOTBBB2?.['10-22.1'] === 'u', 'a straggler mark written to KV before the flip is picked up by a second copy');
  assert(after.slots.SLOTAAA1?.['10-21.2'] === undefined, "the second copy does NOT resurrect a cell cleared in D1 after the flip");
  assert(r.verify.ok, 'post-flip verification only requires D1 >= KV');

  const rb = await json(await mig('rollback'));
  const kvDoc = JSON.parse(kv.m.get(`a:${gid}:2026-10`)!);
  assert(rb.ok && rb.storage === 'kv' && (await attStorage(env, gid)) === 'kv', 'rollback switches the group back to KV');
  assert(kvDoc.slots.SLOTBBB2['10-22.1'] === 'u' && kvDoc.slots.SLOTAAA1?.['10-21.2'] === undefined && kvDoc.cancelled.includes('10-21.3'),
    'rollback exports the CURRENT D1 state (including post-flip edits) back into KV');
  const putsBeforeKvWrite = kv.puts;
  await api('/v3/att', 'PUT', h, { gid, month: '2026-10', baseVer: kvDoc.ver, patch: { SLOTBBB2: { '10-23.1': 'u' } } });
  assert(kv.puts === putsBeforeKvWrite + 1, 'after the rollback writes go to KV again');
}

// 12. Fail closed
console.log('\n12. D1 outage must never fall back to KV for a migrated group');
{
  const gid = 'fc-d1';
  mkGroup(gid); await migrateFlip(env, gid);
  const h = auth(await tokenFor(gid));
  const kvKeysBefore = kv.keysWith('a:').length;
  d1.failNext = true;
  const r1 = await api('/v3/att', 'PUT', h, { gid, month: '2026-10', patch: { SLOTAAA1: { '10-21.2': 'u' } } });
  assert(r1.status === 503 && r1.headers.get('Retry-After') === '5', 'PUT during a D1 outage -> 503 with Retry-After');
  d1.failNext = true;
  const r2 = await api(`/v3/att?gid=${gid}&month=2026-10`, 'GET', h);
  assert(r2.status === 503, 'GET during a D1 outage -> 503');
  assert(kv.keysWith('a:').length === kvKeysBefore && kv.keysWith(`a:${gid}`).length === 0, 'nothing was written to KV');
  const r3 = await api('/v3/att', 'PUT', h, { gid, month: '2026-10', patch: { SLOTAAA1: { '10-21.2': 'u' } } });
  assert(r3.status === 200, 'the next request works again');
}

// 13. Constant statement count
console.log('\n13. Cost of one request does not grow with the number of marks');
{
  const gid = 'cost-d1';
  mkGroup(gid); await migrateFlip(env, gid);
  const h = auth(await tokenFor(gid));
  const patch: Record<string, Record<string, string>> = {};
  for (let s = 0; s < 20; s++) { patch[`SLOT${String(s).padStart(4, '0')}`] = {}; for (let d = 1; d <= 20; d++) patch[`SLOT${String(s).padStart(4, '0')}`][`10-${String(d).padStart(2, '0')}.2`] = 'u'; }
  d1.resetCounters();
  const r = await api('/v3/att', 'PUT', h, { gid, month: '2026-10', patch });
  assert(r.status === 200 && rowsOf(gid) === 400, '400 marks are stored by one request');
  assert(d1.batches === 2 && d1.statements <= 6, `1 storage lookup + 1 atomic batch, ${d1.statements} SQL statements in total`);
  d1.resetCounters();
  await api('/v3/att', 'PUT', h, { gid, month: '2026-10', patch: { SLOT0000: { '10-01.2': null } } });
  assert(d1.statements <= 6, `a single-cell write costs the same ${d1.statements} statements`);
}

console.log('\n=================================================');
console.log(`   RESULT: ${passed} passed, ${failed} failed`);
console.log('=================================================');
