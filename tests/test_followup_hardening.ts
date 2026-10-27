/**
 * Follow-up hardening: server-side tombstones (Useful + Homework), anonymous traffic without KV writes,
 * server sanitizers and size limits, and the Word export surfacing an explicit refusal.
 * Real worker.fetch + real client modules; no network.
 */
import worker, { createStaffToken, __resetRateLimiters } from '../cloudflare-worker.js';
import { WORKER_BASE } from '../utils/attendanceStorage';
import {
  fetchGroupUsefulData, pushGroupUsefulData, recordDeletedUsefulItem,
  getLocalUsefulItems, saveLocalUsefulItems
} from '../utils/usefulStorage';
import { exportAttendanceToWord } from '../utils/exportWord';
import { FACULTIES } from '../constants';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✓ [PASS] ${msg}`); }
  else { failed++; console.error(`  ❌ [FAIL] ${msg}`); process.exitCode = 1; }
}

class CountingKV {
  m = new Map<string, string>();
  puts = 0;
  async get(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  async put(k: string, v: string) { this.puts++; this.m.set(k, v); }
  async delete(k: string) { this.m.delete(k); }
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

const PEPPER = 'followup-pepper-0123456789abcdef-x';
const kv = new CountingKV();
const env: any = { APP_DATA: kv, ID_PEPPER: PEPPER, TELEGRAM_BOT_TOKEN: '1:followup', APP_SECRET: 's' };
const GID = 'ingt-310';
kv.m.set(`g:${GID}`, JSON.stringify({ staff: [], slots: [] }));
const staffToken = await createStaffToken(PEPPER, { gid: GID, role: 'starosta', exp: Date.now() + 86400000 });

const realFetch = (globalThis as any).fetch;
const realLocalStorage = (globalThis as any).localStorage;
const realWindow = (globalThis as any).window;
let upstreamInit: any = null;
let exportDocBehaviour: 'refuse' | 'network' = 'refuse';
(globalThis as any).fetch = async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith('https://samgtu.ru/')) {
    upstreamInit = init;
    return new Response('{"wd":{}}', { status: 200 });
  }
  if (url.endsWith('/export-doc') && url.startsWith(WORKER_BASE)) {
    if (exportDocBehaviour === 'network') throw new TypeError('network down');
    return new Response(JSON.stringify({ error: 'Не удалось отправить файл в личные сообщения. Откройте бота в Telegram, нажмите Start и повторите попытку.', code: 'PM_NOT_DELIVERED' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.startsWith(WORKER_BASE)) return worker.fetch(new Request(url, init), env);
  throw new Error('Unexpected network call in test: ' + url);
};
(globalThis as any).window = {};

const call = (path: string, method: string, headers: Record<string, string> = {}, body?: any, ip = '10.0.0.1') =>
  worker.fetch(new Request(`http://worker.test${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip, ...headers },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
  }), env);

console.log('\n=================================================');
console.log('   TEST SUITE: FOLLOW-UP HARDENING');
console.log('=================================================');

console.log('\n1. Anonymous traffic does not write to KV');
{
  __resetRateLimiters();
  const before = kv.puts;
  for (let i = 0; i < 100; i++) await call('/samgtu-schedule?groupId=123&week=1', 'GET', {}, undefined, `10.1.${i >> 8}.${i & 255}`);
  for (let i = 0; i < 100; i++) await call('/v3/staff/claim', 'POST', {}, { gid: `fake-${i}`, code: 'AAAA-BBBB-CCCC-DDDD' }, `10.2.${i >> 8}.${i & 255}`);
  assert(kv.puts === before, `200 anonymous requests cause zero KV writes (${kv.puts - before})`);
  assert(upstreamInit?.cf?.cacheTtl === 3600, 'the schedule proxy asks Cloudflare to cache upstream answers');

  __resetRateLimiters();
  let last = 0;
  for (let i = 0; i < 63; i++) last = (await call('/samgtu-schedule?groupId=123&week=1', 'GET', {}, undefined, '10.9.9.9')).status;
  assert(last === 429, 'one IP is still throttled by the in-memory limiter');
  const other = await call('/samgtu-schedule?groupId=123&week=1', 'GET', {}, undefined, '10.9.9.10');
  assert(other.status === 200, 'another IP is not affected');

  __resetRateLimiters();
  env.CLAIM_LIMITER = { limit: async () => ({ success: false }) };
  const limited = await call('/v3/staff/claim', 'POST', {}, { gid: GID, code: 'AAAA-BBBB-CCCC-DDDD' }, '10.7.7.7');
  assert(limited.status === 429, 'a configured Rate Limiting binding is honoured');
  delete env.CLAIM_LIMITER;
}

console.log('\n2. Useful: a stale device cannot resurrect a deleted item (real client + real worker)');
{
  const A = new MemoryStorage(), B = new MemoryStorage(), S = new MemoryStorage();
  for (const d of [A, B]) { d.setItem(`staff_token_${GID}`, staffToken); }
  const use = (d: MemoryStorage) => { (globalThis as any).localStorage = d; };
  const item = (id: string, title: string) => ({ id, groupId: GID, title, text: 't', createdAt: new Date().toISOString(), links: [], attachments: [], tags: [] } as any);
  const ids = async (d: MemoryStorage) => { use(d); return (await fetchGroupUsefulData(GID)).items.map(i => i.id).sort().join(','); };

  use(A); saveLocalUsefulItems(GID, [item('u1', 'Конспект 1')]);
  assert(await pushGroupUsefulData(GID, getLocalUsefulItems(GID)), 'A publishes u1');
  assert(await ids(B) === 'u1', 'B receives u1');
  use(A); recordDeletedUsefulItem(GID, 'u1'); saveLocalUsefulItems(GID, []);
  assert(await pushGroupUsefulData(GID, []), 'A deletes u1 and pushes');
  use(B);
  saveLocalUsefulItems(GID, [...getLocalUsefulItems(GID), item('u2', 'Конспект 2')]); // B still holds the stale u1
  assert(await pushGroupUsefulData(GID, getLocalUsefulItems(GID)), 'B (stale) pushes its list with u1 and u2');
  const studentSees = await ids(S);
  assert(studentSees === 'u2', `students never see the deleted item again (${studentSees})`);
  const stored = JSON.parse(kv.m.get(`useful:${GID}`)!);
  assert(Array.isArray(stored.deletedIds) && stored.deletedIds.includes('u1'), 'the server keeps the tombstone');
  assert(await ids(B) === 'u2', 'B drops u1 after the next fetch');
  assert(await ids(A) === 'u2', 'A and B converge');
}

console.log('\n3. Server-side sanitizers and limits');
{
  const h = { 'X-Staff-Token': staffToken };
  const many = Array.from({ length: 250 }, (_, i) => ({
    id: `m${i}`, title: `T${i}`, text: 'x'.repeat(2500), evil: 'dropped',
    links: [{ title: 'ok', url: 'https://example.org/a' }, { title: 'bad', url: 'http://example.org/b' }],
    attachments: [{ id: 'a', name: 'f.png', url: 'https://example.org/f.png', data: 'QUJD'.repeat(100) }]
  }));
  const r = await call('/sync/useful?groupId=' + GID, 'POST', h, { groupId: GID, items: many, updatedAt: Date.now() });
  assert(r.status === 200, `sanitized payload is accepted (${r.status})`);
  const stored = JSON.parse(kv.m.get(`useful:${GID}`)!);
  assert(stored.items.length === 200, `items are capped at 200 (${stored.items.length})`);
  assert(stored.items[0].text.length === 2000, 'text is trimmed to 2000 characters');
  assert(stored.items[0].evil === undefined, 'unknown fields are dropped');
  assert(stored.items[0].links.length === 1 && stored.items[0].links[0].url.startsWith('https://'), 'only https links are stored');
  assert(stored.items[0].attachments[0].data === undefined, 'attachment payloads (base64) are never stored');

  const huge = await call('/sync/useful?groupId=' + GID, 'POST', h, JSON.stringify({ groupId: GID, items: [], pad: 'x'.repeat(1_100_000) }));
  assert(huge.status === 413, `payloads over 1 MB are rejected (${huge.status})`);

  const ids = Array.from({ length: 1100 }, (_, i) => `d${String(i).padStart(4, '0')}`);
  await call('/sync/homework?groupId=' + GID, 'PUT', h, { byGroup: { [GID]: { items: [], deletedIds: ids } }, updatedAt: Date.now() });
  const hw = JSON.parse(kv.m.get(`homework:${GID}`)!);
  assert(hw.deletedIds.length === 1000 && hw.deletedIds.includes('d1099') && !hw.deletedIds.includes('d0000'), 'homework keeps the NEWEST 1000 tombstones');

  const hwItem = (id: string) => ({ id, groupId: GID, subject: 'Математика', title: 'Задача', description: 'x', createdAt: new Date().toISOString() });
  await call('/sync/homework?groupId=' + GID, 'PUT', h, { byGroup: { [GID]: { items: [hwItem('h1'), hwItem('h2')], deletedIds: [] } }, updatedAt: Date.now() });
  await call('/sync/homework?groupId=' + GID, 'PUT', h, { byGroup: { [GID]: { items: [hwItem('h2')], deletedIds: ['h1'] } }, updatedAt: Date.now() });
  await call('/sync/homework?groupId=' + GID, 'PUT', h, { byGroup: { [GID]: { items: [hwItem('h1'), hwItem('h2'), hwItem('h3')], deletedIds: [] } }, updatedAt: Date.now() }); // stale device
  const hw2 = JSON.parse(kv.m.get(`homework:${GID}`)!);
  assert(!hw2.items.some((i: any) => i.id === 'h1') && hw2.items.some((i: any) => i.id === 'h3'), 'a stale homework push cannot bring back a deleted item, new items still arrive');
}

console.log('\n4. Word export surfaces an explicit refusal');
{
  const groupConfig: any = { id: GID, name: '3-ИНГТ-110', facultyId: 'oil', degree: 'Бакалавриат', course: 3 };
  const faculty = FACULTIES[0];
  const tg = (platform: string) => ({ initData: 'query_id=x&user=%7B%22id%22%3A1%7D&auth_date=1&hash=abc', platform, initDataUnsafe: { user: { id: 1 } }, isVersionAtLeast: () => true });

  (globalThis as any).window = { Telegram: { WebApp: tg('android') } };
  exportDocBehaviour = 'refuse';
  const phone = await exportAttendanceToWord([], [], groupConfig, faculty);
  assert(phone.success === false && phone.errorCode === 'PM_NOT_DELIVERED' && /Start/.test(phone.error || ''), 'on a phone the refusal (open the bot, press Start) is returned, not swallowed');

  (globalThis as any).window = { Telegram: { WebApp: tg('tdesktop') } };
  const desktop = await exportAttendanceToWord([], [], groupConfig, faculty);
  assert(desktop.success === true, 'on desktop the document can still be delivered by the fallback tiers');

  (globalThis as any).window = { Telegram: { WebApp: tg('android') } };
  exportDocBehaviour = 'network';
  const offline = await exportAttendanceToWord([], [], groupConfig, faculty);
  assert(offline.success === true, 'a network failure keeps the previous fallback behaviour');
}

(globalThis as any).fetch = realFetch;
(globalThis as any).localStorage = realLocalStorage;
(globalThis as any).window = realWindow;
console.log(`\nTOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
if (failed > 0) process.exitCode = 1;
