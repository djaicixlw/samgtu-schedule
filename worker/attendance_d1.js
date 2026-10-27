/**
 * Attendance storage on Cloudflare D1.
 *
 * Why: KV has no atomic read-modify-write, a 1 write/s/key limit and only 1000 writes/day on the Free plan.
 * Here every mark is its own row, every write request is ONE atomic db.batch(), and conflicts are resolved
 * per cell by last-writer-wins on (hlc, dev). Applying the same ops twice, in any order, gives the same state
 * (idempotent + commutative), so retries and offline replays are safe.
 *
 * Contract kept for the existing client: GET/PUT /v3/att still speak the legacy month-document shape
 * ({ver, slots, cancelled, hours, updatedAt}); a group is served from D1 once it has a row in att_groups.
 * New endpoints (/v3/att/ops, /v3/att/changes) are the future protocol.
 *
 * The number of SQL statements per request is constant (<= 6) regardless of the number of marks: rows are passed
 * as one JSON text parameter and expanded with json_each(). That respects D1's limit of 100 bound parameters per
 * query and keeps the per-invocation query count low.
 */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const SLOT_RE = /^[0-9A-Za-z_-]{1,32}$/;
const KEY_RE = /^[0-9A-Za-z._-]{1,24}$/;

export const MAX_OPS = 500;
export const MAX_CHANGES_LIMIT = 5000;
export const MIN_CHANGES_LIMIT = 1000;
const WRITE_FUTURE_MS = 120 * 1000;           // a device clock running ahead cannot win forever
const MIGRATION_CHUNK = 800;

// ---------------------------------------------------------------------------------------------------------------
// Storage selection
// ---------------------------------------------------------------------------------------------------------------

export function hasD1(env) {
  return Boolean(env && env.DB && typeof env.DB.prepare === 'function' && typeof env.DB.batch === 'function');
}

/**
 * 'd1' when the group was cut over, otherwise 'kv'. Fails CLOSED: a transient D1 error throws, so a migrated group
 * can never silently fall back to the old store. Only "schema not applied yet" counts as not migrated.
 */
export async function attStorage(env, gid) {
  if (!hasD1(env)) return 'kv';
  try {
    const row = await env.DB.prepare('SELECT storage FROM att_groups WHERE gid = ?1').bind(gid).first();
    return row && row.storage === 'd1' ? 'd1' : 'kv';
  } catch (err) {
    if (/no such table/i.test(String(err && err.message))) return 'kv';
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Keys, days, timestamps
// ---------------------------------------------------------------------------------------------------------------

/** MM-DD.N (needs the month for the year) or YYYY-MM-DD.HHMM[.sub] -> YYYY-MM-DD, or null. */
export function dayFromKey(key, month = null) {
  const full = /^(\d{4}-\d{2}-\d{2})\./.exec(key);
  if (full) return DAY_RE.test(full[1]) ? full[1] : null;
  const short = /^(\d{2})-(\d{2})\./.exec(key);
  if (short && month && MONTH_RE.test(month) && short[1] === month.slice(5, 7)) {
    const day = `${month.slice(0, 4)}-${short[1]}-${short[2]}`;
    return DAY_RE.test(day) ? day : null;
  }
  return null;
}

/**
 * Only the FUTURE is clamped. An old offline edit keeps its real time, so it still loses against anything newer
 * (a late push can never resurrect a cell that was cleared afterwards), and a missing/invalid time means "now".
 */
export function clampAt(at, now) {
  const n = Number(at);
  if (!Number.isFinite(n) || n <= 0) return now;
  return Math.min(Math.trunc(n), now + WRITE_FUTURE_MS);
}

const monthRange = (month) => [`${month}-00`, `${month}-99`];

// ---------------------------------------------------------------------------------------------------------------
// Input normalisation
// ---------------------------------------------------------------------------------------------------------------

/**
 * Client ops -> normalised ops. Wire format:
 *   {t:'m', k:'2026-10-21.0945', s:'SLOT', v:'u'|'e'|'', at?}   mark (v '' = clear)
 *   {t:'c', k, on:true|false, at?}                              lesson cancelled
 *   {t:'h', k, h:1..12|null, at?}                               lesson length
 * `d` (YYYY-MM-DD) may be given explicitly; otherwise it is derived from the key.
 */
export function normalizeOps(rawOps, { month = null, now = Date.now() } = {}) {
  if (!Array.isArray(rawOps)) return { ok: false, error: 'ops must be an array' };
  if (rawOps.length === 0) return { ok: false, error: 'ops is empty' };
  if (rawOps.length > MAX_OPS) return { ok: false, error: `too many ops (max ${MAX_OPS})` };
  const ops = [];
  for (const raw of rawOps) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'invalid op' };
    const key = String(raw.k ?? '');
    if (!KEY_RE.test(key)) return { ok: false, error: 'invalid lesson key' };
    const day = raw.d !== undefined ? String(raw.d) : dayFromKey(key, month);
    if (!day || !DAY_RE.test(day)) return { ok: false, error: 'lesson key has no resolvable day' };
    const at = clampAt(raw.at, now);
    if (raw.t === 'm') {
      const slot = String(raw.s ?? '');
      if (!SLOT_RE.test(slot)) return { ok: false, error: 'invalid slot id' };
      const v = raw.v === null || raw.v === undefined ? '' : String(raw.v);
      if (v !== 'u' && v !== 'e' && v !== '') return { ok: false, error: 'invalid mark status' };
      ops.push({ kind: 'm', day, key, slot, v, at });
    } else if (raw.t === 'c') {
      ops.push({ kind: 'c', day, key, on: raw.on === true, at });
    } else if (raw.t === 'h') {
      const h = raw.h;
      if (h !== null && !(Number.isInteger(h) && h >= 1 && h <= 12)) return { ok: false, error: 'invalid hours (1..12 or null)' };
      ops.push({ kind: 'h', day, key, hours: h, at });
    } else {
      return { ok: false, error: 'unknown op type' };
    }
  }
  return { ok: true, ops };
}

/** Legacy PUT /v3/att body (patch/cancel/hours for one month) -> ops. cancel as an ARRAY means "replace the month's set". */
export function legacyToOps(month, patch, cancel, hours, now = Date.now()) {
  const ops = [];
  let cancelReplace = null;
  if (patch && typeof patch === 'object') {
    for (const [slot, slotMarks] of Object.entries(patch)) {
      if (!slotMarks || typeof slotMarks !== 'object') continue;
      for (const [key, val] of Object.entries(slotMarks)) {
        const day = dayFromKey(key, month);
        if (!day) return { ok: false, error: 'lesson key does not belong to the month' };
        if (val === null || val === undefined || val === '') ops.push({ kind: 'm', day, key, slot, v: '', at: now });
        else if (val === 'u' || val === 'e') ops.push({ kind: 'm', day, key, slot, v: val, at: now });
      }
    }
  }
  if (Array.isArray(cancel)) {
    const keys = cancel.map(String);
    cancelReplace = { month, keys };
    for (const key of keys) {
      const day = dayFromKey(key, month);
      if (!day) return { ok: false, error: 'cancelled lesson key does not belong to the month' };
      ops.push({ kind: 'c', day, key, on: true, at: now });
    }
  } else if (cancel && typeof cancel === 'object') {
    for (const [key, flag] of Object.entries(cancel)) {
      const day = dayFromKey(key, month);
      if (!day) return { ok: false, error: 'cancelled lesson key does not belong to the month' };
      if (flag === true) ops.push({ kind: 'c', day, key, on: true, at: now });
      else if (flag === false || flag === null) ops.push({ kind: 'c', day, key, on: false, at: now });
    }
  }
  if (hours && typeof hours === 'object' && !Array.isArray(hours)) {
    for (const [key, val] of Object.entries(hours)) {
      const day = dayFromKey(key, month);
      if (!day) return { ok: false, error: 'hours lesson key does not belong to the month' };
      if (val === null) ops.push({ kind: 'h', day, key, hours: null, at: now });
      else if (Number.isInteger(val) && val >= 1 && val <= 12) ops.push({ kind: 'h', day, key, hours: val, at: now });
    }
  }
  return { ok: true, ops, cancelReplace };
}

// ---------------------------------------------------------------------------------------------------------------
// Writes: ONE atomic batch per request
// ---------------------------------------------------------------------------------------------------------------

const BUMP_REV = `INSERT INTO group_rev (gid, rev) VALUES (?1, 1)
  ON CONFLICT (gid) DO UPDATE SET rev = rev + 1`;

// A row wins when its hlc is newer, or equal with a greater dev (or the same dev but a different value = later op).
// Replaying an identical op changes nothing, so it does not touch rev and does not show up in the change feed.
const UPSERT_MARKS = `INSERT INTO marks (gid, day, lesson_key, slot, status, hlc, dev, rev)
  SELECT ?1, json_extract(value, '$.d'), json_extract(value, '$.k'), json_extract(value, '$.s'),
         json_extract(value, '$.v'), json_extract(value, '$.h'), ?3, (SELECT rev FROM group_rev WHERE gid = ?1)
  FROM json_each(?2) WHERE 1
  ON CONFLICT (gid, day, lesson_key, slot) DO UPDATE SET
    status = excluded.status, hlc = excluded.hlc, dev = excluded.dev, rev = excluded.rev
  WHERE excluded.hlc > marks.hlc
     OR (excluded.hlc = marks.hlc AND excluded.dev > marks.dev)
     OR (excluded.hlc = marks.hlc AND excluded.dev = marks.dev AND excluded.status <> marks.status)`;

const UPSERT_CANCEL = `INSERT INTO lesson_state (gid, day, lesson_key, cancelled, cancel_hlc, hours, hours_hlc, rev)
  SELECT ?1, json_extract(value, '$.d'), json_extract(value, '$.k'), json_extract(value, '$.c'),
         json_extract(value, '$.h'), NULL, 0, (SELECT rev FROM group_rev WHERE gid = ?1)
  FROM json_each(?2) WHERE 1
  ON CONFLICT (gid, day, lesson_key) DO UPDATE SET
    cancelled = excluded.cancelled, cancel_hlc = excluded.cancel_hlc, rev = excluded.rev
  WHERE excluded.cancel_hlc > lesson_state.cancel_hlc
     OR (excluded.cancel_hlc = lesson_state.cancel_hlc AND excluded.cancelled <> lesson_state.cancelled)`;

const UPSERT_HOURS = `INSERT INTO lesson_state (gid, day, lesson_key, cancelled, cancel_hlc, hours, hours_hlc, rev)
  SELECT ?1, json_extract(value, '$.d'), json_extract(value, '$.k'), 0, 0,
         json_extract(value, '$.x'), json_extract(value, '$.h'), (SELECT rev FROM group_rev WHERE gid = ?1)
  FROM json_each(?2) WHERE 1
  ON CONFLICT (gid, day, lesson_key) DO UPDATE SET
    hours = excluded.hours, hours_hlc = excluded.hours_hlc, rev = excluded.rev
  WHERE excluded.hours_hlc > lesson_state.hours_hlc
     OR (excluded.hours_hlc = lesson_state.hours_hlc AND excluded.hours IS NOT lesson_state.hours)`;

const UNCANCEL_OTHERS = `UPDATE lesson_state
  SET cancelled = 0, cancel_hlc = ?4, rev = (SELECT rev FROM group_rev WHERE gid = ?1)
  WHERE gid = ?1 AND day >= ?2 AND day <= ?3 AND cancelled = 1 AND cancel_hlc <= ?4
    AND lesson_key NOT IN (SELECT value FROM json_each(?5))`;

/**
 * Apply normalised ops atomically. Returns the new group revision.
 * @param {{dev?: string, now?: number, cancelReplace?: {month: string, keys: string[]}|null}} opts
 */
export async function applyOps(env, gid, ops, opts = {}) {
  const { dev = '', now = Date.now(), cancelReplace = null } = opts;
  const db = env.DB;
  const marks = [], cancels = [], hoursRows = [];
  let maxAt = 0;
  for (const op of ops) {
    if (op.at > maxAt) maxAt = op.at;
    if (op.kind === 'm') marks.push({ d: op.day, k: op.key, s: op.slot, v: op.v, h: op.at });
    else if (op.kind === 'c') cancels.push({ d: op.day, k: op.key, c: op.on ? 1 : 0, h: op.at });
    else if (op.kind === 'h') hoursRows.push({ d: op.day, k: op.key, x: op.hours, h: op.at });
  }
  const stmts = [db.prepare(BUMP_REV).bind(gid)];
  if (marks.length) stmts.push(db.prepare(UPSERT_MARKS).bind(gid, JSON.stringify(marks), String(dev).slice(0, 32)));
  if (cancelReplace) {
    const [lo, hi] = monthRange(cancelReplace.month);
    stmts.push(db.prepare(UNCANCEL_OTHERS).bind(gid, lo, hi, now, JSON.stringify(cancelReplace.keys)));
  }
  if (cancels.length) stmts.push(db.prepare(UPSERT_CANCEL).bind(gid, JSON.stringify(cancels)));
  if (hoursRows.length) stmts.push(db.prepare(UPSERT_HOURS).bind(gid, JSON.stringify(hoursRows)));
  stmts.push(db.prepare('SELECT rev FROM group_rev WHERE gid = ?1').bind(gid));
  const results = await db.batch(stmts);
  const last = results[results.length - 1];
  const rev = Number(last && last.results && last.results[0] && last.results[0].rev) || 0;
  return { rev, updatedAt: maxAt || now };
}

/** Legacy PUT /v3/att on a D1 group. baseVer is ignored on purpose: cell-level ops never conflict. */
export async function applyLegacyPatch(env, gid, month, patch, cancel, hours, opts = {}) {
  const now = opts.now ?? Date.now();
  const conv = legacyToOps(month, patch, cancel, hours, now);
  if (!conv.ok) return conv;
  if (conv.ops.length === 0 && !conv.cancelReplace) {
    const rev = await currentRev(env, gid);
    return { ok: true, rev, updatedAt: now };
  }
  const res = await applyOps(env, gid, conv.ops, { dev: opts.dev, now, cancelReplace: conv.cancelReplace });
  return { ok: true, ...res };
}

export async function currentRev(env, gid) {
  const row = await env.DB.prepare('SELECT rev FROM group_rev WHERE gid = ?1').bind(gid).first();
  return row ? Number(row.rev) || 0 : 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------------------------

/** Month snapshot in the legacy document shape. */
export async function readMonth(env, gid, month) {
  const [lo, hi] = monthRange(month);
  const db = env.DB;
  const [m, s, r] = await db.batch([
    db.prepare("SELECT slot, lesson_key, status, hlc FROM marks WHERE gid = ?1 AND day >= ?2 AND day <= ?3 AND status <> ''").bind(gid, lo, hi),
    db.prepare('SELECT lesson_key, cancelled, cancel_hlc, hours, hours_hlc FROM lesson_state WHERE gid = ?1 AND day >= ?2 AND day <= ?3').bind(gid, lo, hi),
    db.prepare('SELECT rev FROM group_rev WHERE gid = ?1').bind(gid)
  ]);
  const slots = {};
  let updatedAt = 0;
  for (const row of m.results || []) {
    (slots[row.slot] = slots[row.slot] || {})[row.lesson_key] = row.status;
    if (row.hlc > updatedAt) updatedAt = row.hlc;
  }
  const cancelled = [];
  const hoursMap = {};
  for (const row of s.results || []) {
    if (row.cancelled === 1) { cancelled.push(row.lesson_key); if (row.cancel_hlc > updatedAt) updatedAt = row.cancel_hlc; }
    if (row.hours !== null && row.hours !== undefined) { hoursMap[row.lesson_key] = row.hours; if (row.hours_hlc > updatedAt) updatedAt = row.hours_hlc; }
  }
  const rev = Number(r.results && r.results[0] && r.results[0].rev) || 0;
  return { ver: rev, slots, cancelled, hours: hoursMap, updatedAt };
}

/**
 * Everything that changed after `since`. Rows of one revision are never split across pages.
 * marks:  [day, lessonKey, slot, status, hlc, rev]      status '' = cleared
 * states: [day, lessonKey, cancelled(0|1), cancelHlc, hours|null, hoursHlc, rev]
 */
export async function readChanges(env, gid, since, limit = MAX_CHANGES_LIMIT) {
  const lim = Math.max(MIN_CHANGES_LIMIT, Math.min(Number(limit) || MAX_CHANGES_LIMIT, MAX_CHANGES_LIMIT));
  const from = Math.max(0, Math.trunc(Number(since) || 0));
  const db = env.DB;
  const [m, s, r] = await db.batch([
    db.prepare('SELECT day, lesson_key, slot, status, hlc, rev FROM marks WHERE gid = ?1 AND rev > ?2 ORDER BY rev, day, lesson_key, slot LIMIT ?3').bind(gid, from, lim + 1),
    db.prepare('SELECT day, lesson_key, cancelled, cancel_hlc, hours, hours_hlc, rev FROM lesson_state WHERE gid = ?1 AND rev > ?2 ORDER BY rev, day, lesson_key LIMIT ?3').bind(gid, from, lim + 1),
    db.prepare('SELECT rev FROM group_rev WHERE gid = ?1').bind(gid)
  ]);
  let mRows = m.results || [];
  let sRows = s.results || [];
  const rev = Number(r.results && r.results[0] && r.results[0].rev) || 0;
  let more = false;
  let next = rev;
  // rows with rev < cut are complete in BOTH lists
  let cut = Infinity;
  if (mRows.length > lim) cut = Math.min(cut, mRows[lim].rev);
  if (sRows.length > lim) cut = Math.min(cut, sRows[lim].rev);
  if (cut !== Infinity) {
    more = true;
    mRows = mRows.filter(x => x.rev < cut);
    sRows = sRows.filter(x => x.rev < cut);
    next = cut - 1;
  }
  return {
    rev, since: from, next, more,
    marks: mRows.map(x => [x.day, x.lesson_key, x.slot, x.status, x.hlc, x.rev]),
    states: sRows.map(x => [x.day, x.lesson_key, x.cancelled, x.cancel_hlc, x.hours, x.hours_hlc, x.rev])
  };
}

/** A student's own marks over a month range (reads only that student's rows via idx_marks_slot). */
export async function readStudentMarks(env, gid, slot, firstMonth, lastMonth) {
  const lo = `${firstMonth}-00`;
  const hi = `${lastMonth}-99`;
  const db = env.DB;
  const [m, s] = await db.batch([
    db.prepare("SELECT lesson_key, status FROM marks WHERE gid = ?1 AND slot = ?2 AND day >= ?3 AND day <= ?4 AND status <> ''").bind(gid, slot, lo, hi),
    db.prepare('SELECT lesson_key FROM lesson_state WHERE gid = ?1 AND cancelled = 1 AND day >= ?2 AND day <= ?3').bind(gid, lo, hi)
  ]);
  const marks = {};
  for (const row of m.results || []) marks[row.lesson_key] = row.status;
  return { marks, cancelled: (s.results || []).map(x => x.lesson_key) };
}

/** Staff removed a student: drop that slot's marks (same behaviour as the KV path). */
export async function deleteSlotMarks(env, gid, slot) {
  const db = env.DB;
  await db.batch([
    db.prepare(BUMP_REV).bind(gid),
    db.prepare('DELETE FROM marks WHERE gid = ?1 AND slot = ?2').bind(gid, slot)
  ]);
}

// ---------------------------------------------------------------------------------------------------------------
// KV -> D1 migration (admin-driven, idempotent, reversible)
// ---------------------------------------------------------------------------------------------------------------

async function listKvMonths(env, gid) {
  const out = [];
  let cursor;
  for (let guard = 0; guard < 50; guard++) {
    const res = await env.APP_DATA.list(cursor ? { prefix: `a:${gid}:`, cursor } : { prefix: `a:${gid}:` });
    for (const k of res.keys || []) {
      const month = k.name.slice(`a:${gid}:`.length);
      if (MONTH_RE.test(month)) out.push(month);
    }
    if (res.list_complete !== false || !res.cursor) break;
    cursor = res.cursor;
  }
  return out.sort();
}

function kvDocToOps(month, doc) {
  const ops = [];
  let skipped = 0;
  const at = Number(doc && doc.updatedAt) > 0 ? Math.trunc(Number(doc.updatedAt)) : 1;
  const slots = doc && doc.slots && typeof doc.slots === 'object' ? doc.slots : {};
  for (const [slot, marks] of Object.entries(slots)) {
    if (!SLOT_RE.test(slot) || !marks || typeof marks !== 'object') { skipped++; continue; }
    for (const [key, val] of Object.entries(marks)) {
      const day = dayFromKey(key, month);
      if (!day || !KEY_RE.test(key) || (val !== 'u' && val !== 'e')) { skipped++; continue; }
      ops.push({ kind: 'm', day, key, slot, v: val, at });
    }
  }
  for (const key of Array.isArray(doc && doc.cancelled) ? doc.cancelled : []) {
    const day = dayFromKey(String(key), month);
    if (!day || !KEY_RE.test(String(key))) { skipped++; continue; }
    ops.push({ kind: 'c', day, key: String(key), on: true, at });
  }
  const hours = doc && doc.hours && typeof doc.hours === 'object' && !Array.isArray(doc.hours) ? doc.hours : {};
  for (const [key, val] of Object.entries(hours)) {
    const day = dayFromKey(key, month);
    if (!day || !KEY_RE.test(key) || !Number.isInteger(val) || val < 1 || val > 12) { skipped++; continue; }
    ops.push({ kind: 'h', day, key, hours: val, at });
  }
  return { ops, skipped };
}

/**
 * Copy every KV month of a group into D1. Rows get hlc = the KV document's updatedAt, so the copy never beats a
 * newer D1 write and can be re-run at any time (including AFTER the flip, to catch stragglers).
 */
export async function migrateCopy(env, gid) {
  const months = await listKvMonths(env, gid);
  const report = { months: [], skipped: 0 };
  for (const month of months) {
    const raw = await env.APP_DATA.get(`a:${gid}:${month}`);
    if (!raw) continue;
    let doc;
    try { doc = JSON.parse(raw); } catch { report.months.push({ month, error: 'unreadable' }); continue; }
    const { ops, skipped } = kvDocToOps(month, doc);
    report.skipped += skipped;
    for (let i = 0; i < ops.length; i += MIGRATION_CHUNK) {
      await applyOps(env, gid, ops.slice(i, i + MIGRATION_CHUNK), { dev: 'kv' });
    }
    report.months.push({
      month,
      marks: ops.filter(o => o.kind === 'm').length,
      cancelled: ops.filter(o => o.kind === 'c').length,
      hours: ops.filter(o => o.kind === 'h').length
    });
  }
  return report;
}

/** Row counts per month INCLUDING tombstones / cleared facts: "does D1 know about this cell at all?" */
async function monthKnownCounts(env, gid, month) {
  const [lo, hi] = monthRange(month);
  const db = env.DB;
  const [m, c, h] = await db.batch([
    db.prepare('SELECT COUNT(*) AS n FROM marks WHERE gid = ?1 AND day >= ?2 AND day <= ?3').bind(gid, lo, hi),
    db.prepare('SELECT COUNT(*) AS n FROM lesson_state WHERE gid = ?1 AND day >= ?2 AND day <= ?3 AND cancel_hlc > 0').bind(gid, lo, hi),
    db.prepare('SELECT COUNT(*) AS n FROM lesson_state WHERE gid = ?1 AND day >= ?2 AND day <= ?3 AND hours_hlc > 0').bind(gid, lo, hi)
  ]);
  return { marks: m.results[0].n, cancelled: c.results[0].n, hours: h.results[0].n };
}

/**
 * Compare KV document contents with D1, month by month.
 * exact (before the flip): live D1 content must equal the KV document.
 * lenient (after the flip): D1 may legitimately have fewer LIVE marks (staff cleared some), so only check
 * that every KV cell is known to D1 (as a live mark or as a tombstone), i.e. nothing was left behind.
 */
export async function migrateVerify(env, gid, { exact = true } = {}) {
  const months = await listKvMonths(env, gid);
  const details = [];
  let ok = true;
  for (const month of months) {
    const raw = await env.APP_DATA.get(`a:${gid}:${month}`);
    if (!raw) continue;
    let doc;
    try { doc = JSON.parse(raw); } catch { details.push({ month, error: 'unreadable' }); ok = false; continue; }
    const expected = kvDocToOps(month, doc).ops;
    const want = {
      marks: expected.filter(o => o.kind === 'm').length,
      cancelled: expected.filter(o => o.kind === 'c').length,
      hours: expected.filter(o => o.kind === 'h').length
    };
    let have;
    let good;
    if (exact) {
      const snap = await readMonth(env, gid, month);
      have = {
        marks: Object.values(snap.slots).reduce((n, m) => n + Object.keys(m).length, 0),
        cancelled: snap.cancelled.length,
        hours: Object.keys(snap.hours).length
      };
      good = want.marks === have.marks && want.cancelled === have.cancelled && want.hours === have.hours;
    } else {
      have = await monthKnownCounts(env, gid, month);
      good = have.marks >= want.marks && have.cancelled >= want.cancelled && have.hours >= want.hours;
    }
    if (!good) ok = false;
    details.push({ month, kv: want, d1: have });
  }
  return { ok, details };
}

export async function migrateFlip(env, gid, now = Date.now()) {
  await env.DB.prepare(
    "INSERT INTO att_groups (gid, storage, migrated_at) VALUES (?1, 'd1', ?2) ON CONFLICT (gid) DO NOTHING"
  ).bind(gid, now).run();
}

/** Emergency exit: write D1 content back into KV month documents, then switch the group back to KV. */
export async function migrateRollback(env, gid) {
  const db = env.DB;
  const rows = await db.prepare(
    `SELECT substr(day, 1, 7) AS m FROM marks WHERE gid = ?1
     UNION SELECT substr(day, 1, 7) FROM lesson_state WHERE gid = ?1`
  ).bind(gid).all();
  const months = (rows.results || []).map(r => r.m).filter(m => MONTH_RE.test(m)).sort();
  for (const month of months) {
    const snap = await readMonth(env, gid, month);
    await env.APP_DATA.put(`a:${gid}:${month}`, JSON.stringify(snap), { expirationTtl: 17280000 });
  }
  await db.prepare('DELETE FROM att_groups WHERE gid = ?1').bind(gid).run();
  return { months };
}
