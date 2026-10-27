/**
 * Client side of the D1 attendance protocol.
 *
 * PULL: instead of GET /v3/att for every month of the semester, keep a local MIRROR of the server's month
 * documents and bring it up to date with ONE request, GET /v3/att/changes?since=<rev> (only what changed).
 * The mirror has exactly the shape of the legacy month documents, so the existing record reconstruction,
 * the cell-level 3-way merge and the push diff keep working untouched.
 *
 * PUSH: POST /v3/att/ops with only the cells this device changed (one request per month, no read-modify-write,
 * no version conflicts). Every op carries the time of the local edit, so an old offline edit pushed late can
 * never override a newer edit made on another device.
 *
 * Mode detection: a group that is not on D1 answers /changes with 409 NOT_D1 (an old worker with 404). The client
 * then keeps using the legacy month protocol and re-probes after KV_REPROBE_MS, so a group switched to D1 is
 * picked up within minutes and a group rolled back to KV falls back immediately.
 *
 * No imports from attendanceStorage on purpose (it imports this file): callers pass the base URL and headers.
 */

export type AttendanceMode = 'd1' | 'kv';

export interface MirrorMonth {
  slots: Record<string, Record<string, 'u' | 'e'>>;
  cancelled: string[];
  hours: Record<string, number>;
  updatedAt: number;
}
export interface Mirror { rev: number; months: Record<string, MirrorMonth> }

export interface ApiCtx { base: string; headers: Record<string, string> }

export interface MonthDelta {
  patch: Record<string, Record<string, 'e' | 'u' | null>>;
  cancel: Record<string, true | null>;
  hours: Record<string, number | null>;
}

const KV_REPROBE_MS = 10 * 60 * 1000;
const MAX_PAGES = 60;
const MAX_OPS_PER_REQUEST = 500;
const MAX_MIRROR_MONTHS = 18;

// ---------------------------------------------------------------------------------------------------------------
// Mode cache
// ---------------------------------------------------------------------------------------------------------------

const modes = new Map<string, { mode: AttendanceMode; at: number }>();

/** 'd1' / 'kv' when known, null when unknown or when a 'kv' answer is old enough to be re-checked. */
export function getAttendanceMode(gid: string): AttendanceMode | null {
  const m = modes.get(gid);
  if (!m) return null;
  if (m.mode === 'kv' && Date.now() - m.at > KV_REPROBE_MS) return null;
  return m.mode;
}
export function setAttendanceMode(gid: string, mode: AttendanceMode): void {
  modes.set(gid, { mode, at: Date.now() });
}
export function resetAttendanceModeCache(): void { modes.clear(); }

// ---------------------------------------------------------------------------------------------------------------
// Device id (stable tie-break between devices)
// ---------------------------------------------------------------------------------------------------------------

export function getDeviceId(): string {
  const key = 'att_device_id';
  try {
    if (typeof localStorage !== 'undefined') {
      const existing = localStorage.getItem(key);
      if (existing && /^[0-9A-Za-z_-]{4,32}$/.test(existing)) return existing;
      const bytes = new Uint8Array(6);
      (globalThis.crypto || ({} as Crypto)).getRandomValues?.(bytes);
      const id = 'd' + Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('').slice(0, 10);
      localStorage.setItem(key, id);
      return id;
    }
  } catch {}
  return 'dev';
}

// ---------------------------------------------------------------------------------------------------------------
// Mirror persistence
// ---------------------------------------------------------------------------------------------------------------

const mirrorKey = (gid: string) => `attendance_mirror_${gid}`;
const emptyMirror = (): Mirror => ({ rev: 0, months: {} });

export function loadMirror(gid: string): Mirror {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(mirrorKey(gid));
      if (raw) {
        const p = JSON.parse(raw);
        if (p && typeof p.rev === 'number' && p.months && typeof p.months === 'object') return p as Mirror;
      }
    }
  } catch {}
  return emptyMirror();
}

export function saveMirror(gid: string, mirror: Mirror): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const months = Object.keys(mirror.months).sort();
    for (const m of months.slice(0, Math.max(0, months.length - MAX_MIRROR_MONTHS))) delete mirror.months[m];
    localStorage.setItem(mirrorKey(gid), JSON.stringify(mirror));
  } catch {}
}

export function clearMirror(gid: string): void {
  try { if (typeof localStorage !== 'undefined') localStorage.removeItem(mirrorKey(gid)); } catch {}
}

// ---------------------------------------------------------------------------------------------------------------
// Applying the change feed
// ---------------------------------------------------------------------------------------------------------------

const monthOf = (day: string) => day.slice(0, 7);
const monthDoc = (mirror: Mirror, month: string): MirrorMonth =>
  (mirror.months[month] = mirror.months[month] || { slots: {}, cancelled: [], hours: {}, updatedAt: 0 });

/** marks: [day, key, slot, status, hlc, rev]; states: [day, key, cancelled, cancelHlc, hours, hoursHlc, rev] */
export function applyChanges(mirror: Mirror, feed: { marks?: any[][]; states?: any[][] }): void {
  for (const row of feed.marks || []) {
    const [day, key, slot, status, hlc] = row;
    if (typeof day !== 'string' || typeof key !== 'string' || typeof slot !== 'string') continue;
    const doc = monthDoc(mirror, monthOf(day));
    if (status === 'u' || status === 'e') {
      (doc.slots[slot] = doc.slots[slot] || {})[key] = status;
    } else if (doc.slots[slot]) {
      delete doc.slots[slot][key];
      if (Object.keys(doc.slots[slot]).length === 0) delete doc.slots[slot];
    }
    if (Number(hlc) > doc.updatedAt) doc.updatedAt = Number(hlc);
  }
  for (const row of feed.states || []) {
    const [day, key, cancelled, cancelHlc, hours, hoursHlc] = row;
    if (typeof day !== 'string' || typeof key !== 'string') continue;
    const doc = monthDoc(mirror, monthOf(day));
    const has = doc.cancelled.includes(key);
    if (cancelled === 1 && !has) doc.cancelled.push(key);
    if (cancelled !== 1 && has) doc.cancelled = doc.cancelled.filter(k => k !== key);
    if (Number.isInteger(hours)) doc.hours[key] = hours; else delete doc.hours[key];
    const t = Math.max(Number(cancelHlc) || 0, Number(hoursHlc) || 0);
    if (t > doc.updatedAt) doc.updatedAt = t;
  }
}

export interface MirrorResult {
  ok: boolean;
  mode: AttendanceMode | null;
  status?: number;
  error?: string;
  /** Month document in the legacy shape (empty document when the server has nothing). */
  getMonth?: (month: string) => { ver: number; slots: MirrorMonth['slots']; cancelled: string[]; hours: Record<string, number>; updatedAt: number };
}

/**
 * Brings the local mirror up to date. One request when nothing changed; a few pages on first use.
 * Never throws. mode 'kv' means "this group is not on D1: use the legacy month protocol".
 */
export async function refreshServerMirror(ctx: ApiCtx, gid: string): Promise<MirrorResult> {
  try {
    let mirror = loadMirror(gid);
    let resetDone = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({ gid, since: String(mirror.rev), limit: '5000' });
      const res = await fetch(`${ctx.base}/v3/att/changes?${params.toString()}`, { method: 'GET', headers: ctx.headers });
      const json: any = await res.json().catch(() => ({}));
      if (res.status === 401) return { ok: false, mode: null, status: 401, error: json.error || 'Unauthorized' };
      if (res.status === 409 || res.status === 404) {
        setAttendanceMode(gid, 'kv'); // not on D1 (409 NOT_D1) or an old worker without the route (404)
        return { ok: true, mode: 'kv' };
      }
      if (!res.ok) return { ok: false, mode: null, status: res.status, error: json.error || `HTTP ${res.status}` };
      // A 200 that is not a change feed (captive portal, proxy, mock) must never be read as "the group is empty".
      if (typeof json.rev !== 'number' || !Array.isArray(json.marks) || !Array.isArray(json.states)) {
        return { ok: false, mode: null, status: res.status, error: 'Unexpected change feed response' };
      }

      // The server revision went backwards (rollback / restore / re-flip): our cursor is meaningless, start over.
      if (page === 0 && !resetDone && typeof json.rev === 'number' && json.rev < mirror.rev) {
        mirror = emptyMirror();
        resetDone = true;
        page = -1;
        continue;
      }
      applyChanges(mirror, json);
      mirror.rev = json.more ? Number(json.next) : Number(json.rev) || mirror.rev;
      if (!json.more) {
        saveMirror(gid, mirror);
        setAttendanceMode(gid, 'd1');
        const snapshot = mirror;
        return {
          ok: true,
          mode: 'd1',
          getMonth: (month: string) => {
            const d = snapshot.months[month];
            return { ver: snapshot.rev, slots: d?.slots || {}, cancelled: d?.cancelled || [], hours: d?.hours || {}, updatedAt: d?.updatedAt || 0 };
          }
        };
      }
    }
    return { ok: false, mode: null, error: 'Change feed did not finish' };
  } catch (err: any) {
    return { ok: false, mode: null, error: err?.message || 'Network error' };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------------------------------------------

export interface PushResult { ok: boolean; notD1?: boolean; status?: number; error?: string }

/**
 * Sends one month's delta as idempotent ops. `editedAt(lessonKey)` returns the local edit time (ms) or undefined.
 * Safe to retry unchanged after any failure.
 */
export async function pushMonthOps(
  ctx: ApiCtx,
  gid: string,
  month: string,
  delta: MonthDelta,
  editedAt: (lessonKey: string) => number | undefined
): Promise<PushResult> {
  const ops: any[] = [];
  for (const [slot, marks] of Object.entries(delta.patch)) {
    for (const [k, v] of Object.entries(marks)) ops.push({ t: 'm', k, s: slot, v: v ?? '', at: editedAt(k) });
  }
  for (const [k, v] of Object.entries(delta.cancel)) ops.push({ t: 'c', k, on: v === true, at: editedAt(k) });
  for (const [k, v] of Object.entries(delta.hours)) ops.push({ t: 'h', k, h: v === null ? null : Number(v), at: editedAt(k) });
  if (ops.length === 0) return { ok: true };

  const dev = getDeviceId();
  try {
    for (let i = 0; i < ops.length; i += MAX_OPS_PER_REQUEST) {
      const res = await fetch(`${ctx.base}/v3/att/ops`, {
        method: 'POST',
        headers: ctx.headers,
        body: JSON.stringify({ gid, month, dev, ops: ops.slice(i, i + MAX_OPS_PER_REQUEST) })
      });
      const json: any = await res.json().catch(() => ({}));
      if (res.ok) continue;
      if (res.status === 409 && json.code === 'NOT_D1') { setAttendanceMode(gid, 'kv'); return { ok: false, notD1: true, status: 409 }; }
      if (res.status === 404) { setAttendanceMode(gid, 'kv'); return { ok: false, notD1: true, status: 404 }; }
      return { ok: false, status: res.status, error: json.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Network error' };
  }
}
