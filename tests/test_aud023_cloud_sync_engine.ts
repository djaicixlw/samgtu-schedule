/**
 * AUD-023: unified cloud sync engine.
 *
 * PART A (characterization, written BEFORE the refactor): pins the exact network
 * contracts (request method/URL/headers/body) of the three trackers' cloud calls:
 *   - homework  : fetchGroupCloudData / pushGroupCloudData  (GET+PUT /sync/{schedule,homework})
 *   - useful    : fetchGroupUsefulData / pushGroupUsefulData (GET+POST /sync/useful)
 *   - attendance: fetchMonthAttendanceV3 / saveMonthAttendanceV3 (GET+PUT /v3/att)
 * After HomeworkTracker/UsefulTracker move onto cloudSyncEngine, these requests
 * must stay byte-compatible: the engine orchestrates the SAME adapter functions.
 *
 * PART B: engine unit tests (no React): debounce, visibility throttling, ETag 304
 * (no parse / no merge), merge conflicts, push queue on network failure + delivery
 * after recovery (online).
 */

// Isolated storage + window mocking for this suite (restored in finally).
const mockStore = new Map<string, string>();
const mockSession = new Map<string, string>();
const origLs = (globalThis as any).localStorage;
const origSs = (globalThis as any).sessionStorage;
const origWindow = (globalThis as any).window;

(globalThis as any).localStorage = {
  getItem: (k: string) => (mockStore.has(k) ? mockStore.get(k)! : null),
  setItem: (k: string, v: string) => { mockStore.set(k, String(v)); },
  removeItem: (k: string) => { mockStore.delete(k); },
  clear: () => mockStore.clear(),
  key: (i: number) => Array.from(mockStore.keys())[i] ?? null,
  get length() { return mockStore.size; }
};
(globalThis as any).sessionStorage = {
  getItem: (k: string) => (mockSession.has(k) ? mockSession.get(k)! : null),
  setItem: (k: string, v: string) => { mockSession.set(k, String(v)); },
  removeItem: (k: string) => { mockSession.delete(k); },
  clear: () => mockSession.clear(),
  key: (i: number) => Array.from(mockSession.keys())[i] ?? null,
  get length() { return mockSession.size; }
};
// usefulStorage.pushGroupUsefulData reads `window.Telegram` without a typeof guard.
(globalThis as any).window = { Telegram: { WebApp: { initData: 'aud023-init-data' } } };

interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: any;
}

const calls: RecordedRequest[] = [];
const origFetch = globalThis.fetch;

const jsonResponse = (obj: any, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...extraHeaders }
  });

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : (input as any).url);
  const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const headerObj: Record<string, string> = {};
  const h = init?.headers as any;
  if (h) {
    if (typeof h.forEach === 'function') h.forEach((v: string, k: string) => { headerObj[k] = v; });
    else if (typeof h.get === 'function') { /* Headers instance without forEach */ }
    else Object.assign(headerObj, h);
  }
  let body: any = undefined;
  if (init?.body && typeof init.body === 'string') {
    try { body = JSON.parse(init.body); } catch { body = init.body; }
  }
  calls.push({ method, url, headers: headerObj, body });

  if (url.includes('/sync/schedule')) return jsonResponse({ byGroup: { [GROUP_A]: { overrides: { ov1: { teacher: 'Т1' } }, teachers: { t: 'Т1' }, updatedAt: 111 } } }, { ETag: '"sched-etag-1"' });
  if (url.includes('/sync/homework')) {
    if (method === 'PUT') return jsonResponse({ ok: true });
    return jsonResponse({ byGroup: { [GROUP_A]: { items: [{ id: 'hw-1', groupId: GROUP_A, subject: 'S', title: 'T', description: '', assignedDate: '2026-09-01', dueDate: '2026-09-08', attachments: [], createdAt: '2026-09-01T00:00:00Z', updatedAt: 500 }], deletedIds: ['hw-old'], updatedAt: 222 } } }, { ETag: '"hw-etag-1"' });
  }
  if (url.includes('/sync/useful')) {
    if (method === 'POST' || method === 'PUT') return jsonResponse({ ok: true });
    return jsonResponse({ byGroup: { [GROUP_B]: { items: [{ id: 'u-1', groupId: GROUP_B, title: 'Заметка', text: 'Т', isPinned: false, createdAt: '2026-10-01T10:00:00.000Z' }], deletedIds: ['u-old'] } } }, { ETag: '"useful-etag-1"' });
  }
  if (url.includes('/v3/att') && method === 'GET') return jsonResponse({ ver: 7, slots: {}, cancelled: [] });
  if (url.includes('/v3/att') && method === 'PUT') return jsonResponse({ ver: 8 });
  return new Response('{}', { status: 200 });
}) as any;

import { fetchGroupCloudData, pushGroupCloudData } from '../utils/cloudSync';
import { fetchGroupUsefulData, pushGroupUsefulData } from '../utils/usefulStorage';
import { fetchMonthAttendanceV3, saveMonthAttendanceV3 } from '../utils/attendanceStorage';

const GROUP_A = 'aud023-hw';
const GROUP_B = 'aud023-useful';
const GROUP_C = 'aud023-att';

console.log('\n=================================================');
console.log('  TEST SUITE: CLOUD SYNC ENGINE (AUD-023) ');
console.log('=================================================');

let passed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`  ❌ FAIL: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  passed++;
  console.log(`  ✓ [PASS] ${msg}`);
}

async function runCharacterization() {
  console.log('\n--- A1. Homework tracker network contract (GET /sync/schedule + /sync/homework, PUT /sync/homework) ---');
  calls.length = 0;
  const cloud = await fetchGroupCloudData(true, GROUP_A);
  assert(Boolean(cloud), 'fetchGroupCloudData returned data');
  const hwGet = calls.find(c => c.method === 'GET' && c.url.includes(`/sync/homework?groupId=${encodeURIComponent(GROUP_A)}`));
  assert(Boolean(hwGet), 'GET /sync/homework?groupId=<gid> issued (cache-busting query style preserved)');
  const schedGet = calls.find(c => c.method === 'GET' && c.url.includes(`/sync/schedule?groupId=${encodeURIComponent(GROUP_A)}`));
  assert(Boolean(schedGet), 'GET /sync/schedule?groupId=<gid> issued in parallel');
  assert(hwGet!.headers['Accept'] === 'application/json', 'homework GET sends Accept: application/json');
  assert(!hwGet!.headers['X-Telegram-Init-Data'], 'homework GET sends NO init-data header (non-attendance /sync GET)');

  calls.length = 0;
  const pushOk = await pushGroupCloudData({
    homework: [{ id: 'hw-9', groupId: GROUP_A, subject: 'Физика', title: 'Задача 1', description: '', assignedDate: '2026-09-01', dueDate: '2026-09-10', attachments: [], createdAt: '2026-09-01T00:00:00Z' }],
    deletedIds: ['hw-old']
  }, GROUP_A);
  assert(pushOk === true, 'pushGroupCloudData resolved ok');
  const hwPut = calls.find(c => c.method === 'PUT' && c.url.includes(`/sync/homework?groupId=${encodeURIComponent(GROUP_A)}`));
  assert(Boolean(hwPut), 'PUT /sync/homework?groupId=<gid> issued');
  assert(hwPut!.headers['Content-Type'] === 'application/json', 'homework PUT sends Content-Type: application/json');
  assert(typeof hwPut!.headers['X-Telegram-Init-Data'] === 'string' && hwPut!.headers['X-Telegram-Init-Data'].length > 0, 'homework PUT forwards X-Telegram-Init-Data');
  const hwBody = hwPut!.body;
  assert(Boolean(hwBody && hwBody.byGroup && hwBody.byGroup[GROUP_A]), 'homework PUT body shape is { byGroup: { [gid]: {...} } }');
  const hwSlice = hwBody.byGroup[GROUP_A];
  assert(Array.isArray(hwSlice.items) && hwSlice.items.length === 1 && hwSlice.items[0].id === 'hw-9', 'homework PUT body carries items array');
  assert(hwSlice.items[0].groupId === GROUP_A, 'homework PUT items are stamped with groupId');
  assert(Array.isArray(hwSlice.deletedIds) && hwSlice.deletedIds.includes('hw-old'), 'homework PUT body carries deletedIds (tombstones)');
  assert(typeof hwSlice.updatedAt === 'number', 'homework PUT body carries updatedAt stamp');

  console.log('\n--- A2. Useful tracker network contract (GET+POST /sync/useful, lowercase gid) ---');
  calls.length = 0;
  const useful = await fetchGroupUsefulData(GROUP_B.toUpperCase());
  assert(Boolean(useful), 'fetchGroupUsefulData returned data');
  const usefulGet = calls.find(c => c.method === 'GET' && c.url.includes('/sync/useful?groupId=' + GROUP_B));
  assert(Boolean(usefulGet), 'GET /sync/useful?groupId=<lowercased gid> issued');

  calls.length = 0;
  const usefulPush = await pushGroupUsefulData(GROUP_B.toUpperCase(), [{
    id: 'u-9', groupId: GROUP_B, title: 'Новая заметка', text: 'Текст', isPinned: true,
    createdAt: '2026-10-02T10:00:00.000Z', links: [], attachments: [], tags: []
  } as any]);
  assert(usefulPush === true, 'pushGroupUsefulData resolved ok');
  const usefulPost = calls.find(c => c.method === 'POST' && c.url.includes('/sync/useful?groupId=' + GROUP_B));
  assert(Boolean(usefulPost), 'POST /sync/useful?groupId=<lowercased gid> issued');
  const uBody = usefulPost!.body;
  assert(uBody && uBody.groupId === GROUP_B, 'useful POST body has lowercased groupId field');
  assert(Array.isArray(uBody.items) && uBody.items.length === 1 && uBody.items[0].id === 'u-9', 'useful POST body carries items');
  assert(Array.isArray(uBody.deletedIds), 'useful POST body carries deletedIds (AUD-011 tombstones)');
  assert(typeof uBody.updatedAt === 'number', 'useful POST body carries updatedAt');
  assert(typeof usefulPost!.headers['X-Telegram-Init-Data'] === 'string', 'useful POST forwards X-Telegram-Init-Data');

  console.log('\n--- A3. Attendance network contract (GET+PUT /v3/att with auth headers) ---');
  calls.length = 0;
  const month = await fetchMonthAttendanceV3(GROUP_C, '2026-09');
  assert(month.ok === true, 'fetchMonthAttendanceV3 ok');
  const attGet = calls.find(c => c.method === 'GET' && c.url.includes('/v3/att?') && c.url.includes('month=2026-09'));
  assert(Boolean(attGet), 'GET /v3/att?gid=...&month=... issued');
  assert(typeof attGet!.headers['X-Telegram-Init-Data'] === 'string', 'attendance GET forwards X-Telegram-Init-Data');

  calls.length = 0;
  const saved = await saveMonthAttendanceV3(GROUP_C, '2026-09', 7, { '2026-09-14|A1|2026-09-14.0940': 'u' }, ['2026-09-21.1'], { '2026-09|h|2026-09-21.1': '4' });
  assert(saved.ok === true, 'saveMonthAttendanceV3 ok');
  const attPut = calls.find(c => c.method === 'PUT' && c.url.includes('/v3/att'));
  assert(Boolean(attPut), 'PUT /v3/att issued');
  const aBody = attPut!.body;
  assert(aBody.gid === GROUP_C && aBody.month === '2026-09' && aBody.baseVer === 7, 'attendance PUT body carries { gid, month, baseVer }');
  assert('patch' in aBody && 'cancel' in aBody && 'hours' in aBody, 'attendance PUT body carries patch/cancel/hours');
}

async function runEngineTests() {
  const { createCloudSyncEngine, createStoragePendingStore } = await import('../utils/cloudSyncEngine');

  // Deterministic clock + timers
  let clock = 0;
  type FakeTimer = { id: number; at: number; fn: () => void };
  let timers: FakeTimer[] = [];
  let nextId = 1;
  const setTimeoutFn = (fn: () => void, ms: number) => {
    const t: FakeTimer = { id: nextId++, at: clock + ms, fn };
    timers.push(t);
    return t;
  };
  const clearTimeoutFn = (t: any) => { timers = timers.filter(x => x !== t); };
  const advance = async (ms: number) => {
    clock += ms;
    const due = timers.filter(t => t.at <= clock);
    timers = timers.filter(t => t.at > clock);
    for (const t of due) t.fn();
    // drain microtasks of the triggered async chains
    for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0));
  };
  const tick = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); };

  interface TestItem { id: string; title: string; updatedAt?: number }

  const makeHarness = (opts?: {
    fetchImpl?: (etag?: string) => Promise<any>;
    pushImpl?: (state: TestItem[]) => Promise<boolean>;
    initialState?: TestItem[];
    throttleMs?: number;
    debounceMs?: number;
  }) => {
    let state: TestItem[] = opts?.initialState || [];
    const log = { pulls: 0, merges: 0, setStates: 0, parses: 0, pushes: 0, pushedStates: [] as TestItem[][] };
    const pending = { flag: 0 };
    const pendingStore = {
      has: () => pending.flag > 0,
      mark: () => { pending.flag++; },
      clear: () => { pending.flag = 0; }
    };
    const etagStore = (() => { const m = new Map<string, string>(); return { get: (s: string) => m.get(s), set: (s: string, e: string) => m.set(s, e) }; })();
    const engine = createCloudSyncEngine<TestItem[], TestItem[]>({
      scope: 'test:entity',
      fetchState: async ({ etag }) => {
        log.pulls++;
        if (!opts?.fetchImpl) return { status: 'error' };
        return opts.fetchImpl(etag);
      },
      pushState: async (s) => {
        log.pushes++;
        log.pushedStates.push(s);
        return opts?.pushImpl ? opts.pushImpl(s) : true;
      },
      mergeFn: (local, remote) => {
        log.merges++;
        // per-id arbitration like mergeHomeworkItems: newer updatedAt wins
        const map = new Map<string, TestItem>();
        (remote || []).forEach(r => map.set(r.id, r));
        let hasLocalNewer = false;
        (local || []).forEach(l => {
          const cloud = map.get(l.id);
          if (!cloud) { map.set(l.id, l); hasLocalNewer = true; }
          else if ((l.updatedAt || 0) > (cloud.updatedAt || 0)) { map.set(l.id, l); hasLocalNewer = true; }
        });
        return { state: Array.from(map.values()), hasLocalNewer };
      },
      getState: () => state,
      setState: (s) => { log.setStates++; state = s; },
      throttleMs: opts?.throttleMs ?? 60000,
      debounceMs: opts?.debounceMs ?? 400,
      pendingStore,
      etagStore,
      now: () => clock,
      setTimeoutFn,
      clearTimeoutFn
    });
    return { engine, state: () => state, log, pendingStore };
  };

  console.log('\n--- B1. Debounce: a burst of edits collapses into ONE push of the latest state ---');
  {
    const h = makeHarness({ debounceMs: 400 });
    h.engine.requestPush();
    h.engine.requestPush();
    h.engine.requestPush();
    await tick();
    assert(h.log.pushes === 0, 'no push before the debounce window elapses');
    await advance(400);
    assert(h.log.pushes === 1, 'exactly one push after the debounce window');
    assert(h.pendingStore.has() === false, 'pending flag cleared after successful delivery');
    h.engine.dispose();
  }

  console.log('\n--- B2. Visibility throttling: repeated foreground events pull at most once per window ---');
  {
    const remote: TestItem[] = [{ id: 'r1', title: 'cloud' }];
    const h = makeHarness({
      throttleMs: 60000,
      fetchImpl: async () => ({ status: 'ok', data: remote, etag: '"e1"' })
    });
    await h.engine.notifyVisible();
    await tick();
    assert(h.log.pulls === 1, 'first visibility pull runs');
    h.engine.notifyVisible();
    await tick();
    assert(h.log.pulls === 1, 'pull within the throttle window is skipped');
    await advance(60000);
    await h.engine.notifyVisible();
    await tick();
    assert(h.log.pulls === 2, 'pull after the throttle window runs');
    h.engine.dispose();
  }

  console.log('\n--- B3. ETag 304: no parsing, no merge, no setState ---');
  {
    const h = makeHarness({
      fetchImpl: async (etag) => {
        if (etag) return { status: 'not-modified', etag };
        h.log.parses++; // parse happens only on a 200 body
        return { status: 'ok', data: [{ id: 'r1', title: 'cloud' }] as TestItem[], etag: '"v1"' };
      }
    });
    await h.engine.pull();
    await tick();
    assert(h.log.merges === 1 && h.log.setStates === 1, 'first pull parses and merges (no ETag known yet)');
    await advance(60000);
    await h.engine.notifyVisible();
    await tick();
    assert(h.log.parses === 1, '304 pull did NOT parse the payload again');
    assert(h.log.merges === 1 && h.log.setStates === 1, '304 pull skipped merge and setState');
    h.engine.dispose();
  }

  console.log('\n--- B4. Merge conflicts: local edit newer than cloud survives and triggers auto-heal push ---');
  {
    const h = makeHarness({
      initialState: [{ id: 'a', title: 'Локальная правка', updatedAt: 2000 }],
      fetchImpl: async () => ({ status: 'ok', data: [{ id: 'a', title: 'Старый облако', updatedAt: 1000 }] as TestItem[] })
    });
    await h.engine.pull();
    await tick();
    assert(h.state().length === 1 && h.state()[0].title === 'Локальная правка', 'newer local edit wins the merge (cloud stale)');
    await advance(400);
    assert(h.log.pushes >= 1, 'auto-heal: hasLocalNewer scheduled a push');
    assert(h.log.pushedStates[0][0].title === 'Локальная правка', 'auto-heal pushed the merged (local-newer) state');
    assert(h.pendingStore.has() === false, 'auto-heal delivery cleared the pending flag');
    h.engine.dispose();
  }

  console.log('\n--- B5. Push queue: network failure keeps the flag; recovery delivers and clears it ---');
  {
    let networkUp = false;
    const h = makeHarness({
      initialState: [{ id: 'local-1', title: 'автономная правка', updatedAt: 5000 }],
      fetchImpl: async () => ({ status: 'ok', data: [{ id: 'r1', title: 'cloud' }] as TestItem[] }),
      pushImpl: async () => networkUp
    });
    await h.engine.pull(); // merge flags the unsynced local item -> auto-heal push
    await tick();
    await advance(400); // auto-heal push attempt while offline
    assert(h.log.pushes >= 1, 'auto-heal push attempted');
    assert(h.pendingStore.has() === true, 'failed push left the durable pending flag (queue)');
    const pushesWhileDown = h.log.pushes;
    await advance(5000);
    assert(h.log.pushes === pushesWhileDown, 'failed push is NOT retried on a timer — only on external events');
    // Recover the network: online event must deliver the queued push WITHOUT
    // waiting for the pull throttle.
    networkUp = true;
    await advance(60000);
    h.engine.notifyOnline();
    await advance(1); // fire the immediate (0ms) delivery timer
    await tick();
    assert(h.log.pushes >= 2, 'queued push was re-delivered after recovery (online)');
    assert(h.pendingStore.has() === false, 'pending flag cleared after successful delivery');
    h.engine.dispose();
  }

  console.log('\n--- B6. Coalescing: a push requested during an in-flight flush runs once more with the latest state ---');
  {
    let releaseFirstPush: (() => void) | null = null;
    let pushCount = 0;
    let latestPushed: TestItem[] = [];
    const gate = new Promise<void>(resolve => { releaseFirstPush = resolve; });
    const h = makeHarness({
      initialState: [{ id: 'a', title: 'v1' }],
      pushImpl: async (s) => {
        pushCount++;
        if (pushCount === 1) await gate; // hold the first flush in flight
        latestPushed = s;
        return true;
      }
    });
    h.engine.requestPush();
    await advance(400); // fire the debounce timer -> first push starts and blocks on the gate
    assert(pushCount === 1, 'first push started');
    h.state()[0].title = 'v2'; // user edits while the push is in flight
    h.engine.requestPush();
    releaseFirstPush!();
    await tick();
    await advance(400);
    await tick();
    assert(pushCount === 2, 'second flush ran after the in-flight one settled');
    assert(latestPushed[0].title === 'v2', 'second flush carried the LATEST state, not the stale snapshot');
    assert(h.pendingStore.has() === false, 'no pending flag after both deliveries');
    h.engine.dispose();
  }

  console.log('\n--- B7. dispose() cancels the scheduled debounce push ---');
  {
    const h = makeHarness({});
    h.engine.requestPush();
    h.engine.dispose();
    await advance(1000);
    assert(h.log.pushes === 0, 'no push after dispose (no leaked timers)');
  }

  console.log('\n--- B8. createStoragePendingStore: durable flag on a Storage-like backend ---');
  {
    const backend = new Map<string, string>();
    const store = createStoragePendingStore({
      getItem: (k) => backend.get(k) ?? null,
      setItem: (k, v) => { backend.set(k, v); },
      removeItem: (k) => { backend.delete(k); }
    });
    const scope = 'homework:ingt-310';
    assert(store.has(scope) === false, 'fresh scope has no pending flag');
    store.mark(scope);
    assert(store.has(scope) === true && backend.get(`cloudsync_pending_${scope}`) !== undefined, 'flag persisted under cloudsync_pending_<scope>');
    store.clear(scope);
    assert(store.has(scope) === false && !backend.has(`cloudsync_pending_${scope}`), 'clear removes the persisted flag');
  }
}

async function main() {
  try {
    await runCharacterization();
    await runEngineTests();
    console.log(`\n=================================================`);
    console.log(`  CLOUD SYNC ENGINE (AUD-023): ${passed} CHECKS PASSED`);
    console.log(`=================================================\n`);
  } finally {
    globalThis.fetch = origFetch;
    (globalThis as any).localStorage = origLs;
    (globalThis as any).sessionStorage = origSs;
    if (origWindow === undefined) delete (globalThis as any).window; else (globalThis as any).window = origWindow;
  }
}

await main();
