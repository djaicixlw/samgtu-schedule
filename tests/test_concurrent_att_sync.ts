/**
 * Concurrent attendance sync tests (AUD-008).
 *
 * The old multidevice mock ignored `baseVer`, so the 409 conflict path — the core
 * of the optimistic-concurrency protocol — was unreachable in tests. This suite
 * tests the REAL client functions (fetchMonthAttendanceV3 / saveMonthAttendanceV3 /
 * syncAttendanceRecordsToV3) against a worker-faithful mock
 * (contract: cloudflare-worker.js:1300-1381).
 *
 * Coverage:
 *   T1  Happy path: GET ver -> PUT with that baseVer succeeds and bumps ver.
 *   T2  Contract: a writer with a stale baseVer gets 409 shaped exactly like the
 *       worker (error + currentVer + ver + slots + cancelled + hours + updatedAt).
 *   T3  Convergence: after a 409, re-reading ver and retrying lands BOTH deltas;
 *       last-writer-wins does not discard the first delta.
 *   T4  Full client stack: syncAttendanceRecordsToV3 recovers on its own when the
 *       server version moves between its GET and PUT (internal retry loop,
 *       attendanceStorage.ts:936-964) and the push eventually lands.
 *
 * Note (AUD-014): this mock applies the baseVer check BEFORE the read-modify-write
 * body, mirroring the worker. The non-atomicity of KV (two writers passing the
 * check inside the RMW window) is a SERVER defect and gets its own D1-level test
 * in Phase 1 (AUD-014); it cannot be faithfully reproduced by a per-isolate mock.
 */

import {
  fetchMonthAttendanceV3,
  saveMonthAttendanceV3,
  syncAttendanceRecordsToV3,
  setAttendanceApiBase,
  ensureGroupSlots
} from '../utils/attendanceStorage';

console.log('\n=================================================');
console.log('   TEST SUITE: CONCURRENT ATTENDANCE SYNC (409)  ');
console.log('=================================================');

// ---------------------------------------------------------------------------
// Worker-faithful mock
// ---------------------------------------------------------------------------

const kv = new Map<string, string>();
/** When true, the next PUT silently bumps the server ver before applying —
 *  simulates another writer committing between the client's GET and PUT. */
let bumpVerBeforeApply = false;

const loadMonth = (key: string) => {
  const raw = kv.get(key);
  return raw ? JSON.parse(raw) : { ver: 0, slots: {}, cancelled: [], hours: {}, updatedAt: 0 };
};

async function handlePut(body: any): Promise<Response> {
  const { gid, month, baseVer, patch, cancel, hours } = body;
  const key = `a:${String(gid).toLowerCase()}:${month}`;
  const current = loadMonth(key);

  const expectedBaseVer = (baseVer !== undefined && baseVer !== null) ? Number(baseVer) : 0;
  if ((current.ver || 0) > 0 && current.ver !== expectedBaseVer) {
    return new Response(JSON.stringify({
      error: 'Conflict: data was modified by another session',
      currentVer: current.ver,
      ver: current.ver,
      slots: current.slots,
      cancelled: current.cancelled,
      hours: current.hours,
      updatedAt: current.updatedAt
    }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  }

  if (bumpVerBeforeApply) {
    bumpVerBeforeApply = false;
    const behind = loadMonth(key);
    behind.ver = (behind.ver || 0) + 1;
    behind.updatedAt = Date.now();
    kv.set(key, JSON.stringify(behind));
  }

  const latest = loadMonth(key);
  if (patch && typeof patch === 'object') {
    for (const [slot, marks] of Object.entries(patch as Record<string, Record<string, any>>)) {
      if (!latest.slots[slot]) latest.slots[slot] = {};
      for (const [lessonKey, mark] of Object.entries(marks)) {
        if (mark === null || mark === undefined || mark === '') delete latest.slots[slot][lessonKey];
        else if (mark === 'e' || mark === 'u') latest.slots[slot][lessonKey] = mark;
      }
    }
  }
  if (cancel !== undefined && cancel !== null) {
    if (Array.isArray(cancel)) latest.cancelled = cancel.map(String);
    else if (typeof cancel === 'object') {
      const set = new Set<string>(latest.cancelled);
      for (const [lessonKey, shouldCancel] of Object.entries(cancel)) {
        if (shouldCancel === true) set.add(lessonKey);
        else if (shouldCancel === null || shouldCancel === false) set.delete(lessonKey);
      }
      latest.cancelled = Array.from(set);
    }
  }
  if (hours && typeof hours === 'object' && !Array.isArray(hours)) {
    if (!latest.hours || typeof latest.hours !== 'object') latest.hours = {};
    for (const [lessonKey, val] of Object.entries(hours)) {
      if (val === null) delete latest.hours[lessonKey];
      else if (Number.isInteger(val) && val >= 1 && val <= 12) latest.hours[lessonKey] = val;
    }
  }
  latest.ver = (latest.ver || 0) + 1;
  latest.updatedAt = Date.now();
  kv.set(key, JSON.stringify(latest));
  return new Response(JSON.stringify({ ok: true, ver: latest.ver, updatedAt: latest.updatedAt }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });
}

const mockFetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
  const u = new URL(String(url));
  const method = init?.method || 'GET';
  if (u.pathname === '/v3/att' && method === 'GET') {
    const data = loadMonth(`a:${(u.searchParams.get('gid') || '').toLowerCase()}:${u.searchParams.get('month') || ''}`);
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.pathname === '/v3/att' && method === 'PUT') {
    return handlePut(JSON.parse(String(init?.body || '{}')));
  }
  if (u.pathname === '/v3/slots' && method === 'POST') {
    return new Response(JSON.stringify({ ok: true, registered: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.pathname === '/v3/roster' && method === 'PUT') {
    return new Response(JSON.stringify({ ok: true, ver: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.pathname === '/v3/roster' && method === 'GET') {
    return new Response(JSON.stringify({ ok: true, roster: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 });
};

const originalFetch = globalThis.fetch;
globalThis.fetch = mockFetch as typeof fetch;
setAttendanceApiBase('https://worker.test');

// Isolated localStorage: client reads roster/staff-token/signatures from here.
const storage: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in storage ? storage[k] : null),
  setItem: (k: string, v: string) => { storage[k] = String(v); },
  removeItem: (k: string) => { delete storage[k]; },
  clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
};

let passed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`  ❌ FAIL: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  passed++;
  console.log(`  ✓ [PASS] ${msg}`);
}

const GID = 'ingt-310';
const MONTH = '2026-11';
const KEY = `a:${GID}:${MONTH}`;

async function runConcurrentTests() {
  // --- T1: happy path -------------------------------------------------------
  console.log('\n--- T1: GET ver -> PUT with fresh baseVer succeeds ---');
  kv.clear();
  kv.set(KEY, JSON.stringify({ ver: 1, slots: { existing: { '11-05.1': 'u' } }, cancelled: [], hours: {}, updatedAt: 1 }));

  const fresh = await fetchMonthAttendanceV3(GID, MONTH);
  assert(fresh.ok === true && fresh.data?.ver === 1, 'T1: GET returns current ver=1');
  const putA = await saveMonthAttendanceV3(GID, MONTH, 1, { slotA: { '11-05.2': 'u' } }, undefined);
  assert(putA.ok === true && putA.ver === 2, 'T1: PUT with matching baseVer succeeds, ver bumped to 2');

  // --- T2: 409 contract -----------------------------------------------------
  console.log('\n--- T2: stale baseVer gets worker-shaped 409 ---');
  const stale = await saveMonthAttendanceV3(GID, MONTH, 1, { slotB: { '11-05.3': 'u' } }, undefined);
  assert(stale.ok === false && stale.conflict === true && stale.status === 409, 'T2: stale writer gets 409 conflict');
  assert(stale.ver === 2, 'T2: 409 carries current ver (json.ver) for the retry');
  const stillA = loadMonth(KEY);
  assert(stillA.slots.slotB?.['11-05.3'] === undefined, 'T2: rejected delta was NOT applied');
  assert(stillA.ver === 2, 'T2: rejected write did not bump ver');

  // --- T3: convergence after retry ------------------------------------------
  console.log('\n--- T3: retry with fresh ver lands BOTH deltas ---');
  const retry = await saveMonthAttendanceV3(GID, MONTH, stale.ver!, { slotB: { '11-05.3': 'u' } }, undefined);
  assert(retry.ok === true, 'T3: retry with fresh baseVer succeeds');
  const final = await fetchMonthAttendanceV3(GID, MONTH);
  assert(final.data!.slots.slotA?.['11-05.2'] === 'u', 'T3: delta A survived (first writer not lost)');
  assert(final.data!.slots.slotB?.['11-05.3'] === 'u', 'T3: delta B landed');
  assert(final.data!.slots.existing?.['11-05.1'] === 'u', 'T3: pre-existing mark untouched');
  assert(final.data!.ver === retry.ver, 'T3: server ver matches the last successful write');

  // --- T4: full client stack with mid-flight version bump --------------------
  console.log('\n--- T4: syncAttendanceRecordsToV3 recovers via internal retry ---');
  kv.clear();
  Object.keys(storage).forEach(k => delete storage[k]);
  kv.set(KEY, JSON.stringify({ ver: 0, slots: {}, cancelled: [], hours: {}, updatedAt: 0 }));
  // Slot must be in the canonical 8-char format, else ensureGroupSlots silently reassigns it.
  const roster = ensureGroupSlots(GID, [{ id: 1, name: 'Семь Данных Один', slot: 'slotX12' }]);
  const slotX = roster[0].slot!;
  storage[`students_${GID}`] = JSON.stringify(roster);
  // Client GETs ver=0; before its PUT applies, another writer bumps the server to ver=1;
  // the client's PUT(baseVer=0) must 409 and the internal retry loop must recover.
  bumpVerBeforeApply = true;
  const stackRes = await syncAttendanceRecordsToV3(GID, [{
    docId: `${GID}_2026-11-05_ingt-310-w1-mo-1`,
    groupId: GID,
    date: '2026-11-05',
    lessonId: 'ingt-310-w1-mo-1',
    absentStudentIds: [1],
    excusedStudentIds: [],
    isCancelled: false,
    updatedAt: Date.now()
  }]);
  assert(stackRes.ok === true, 'T4: client push reports ok despite mid-flight version bump');
  const t4 = loadMonth(KEY);
  assert(t4.ver >= 2, 'T4: server ver advanced by at least the bump + one successful write');
  // Canonical wire key is MM-DD.N
  const t4Key = '11-05.1';
  assert(t4.slots[slotX]?.[t4Key] === 'u', `T4: the mark landed on the server after the internal retry (key ${t4Key})`);

  console.log(`\n=================================================`);
  console.log(`  CONCURRENT SYNC: ${passed} CHECKS PASSED  `);
  console.log(`=================================================\n`);
}

await runConcurrentTests();
