/**
 * "Полезное": a student's suggestion must reach the starosta (it used to stay on the student's phone),
 * be moderated, published for the group, and optionally announced in Telegram.
 * Real worker.fetch + real client functions; Telegram API stubbed.
 */
import worker, { createStaffToken, createTelegramInitData, __resetRateLimiters } from '../cloudflare-worker.js';
import { WORKER_BASE } from '../utils/attendanceStorage';
import {
  submitUsefulSuggestion, fetchPendingSuggestions, resolveSuggestion, setSuggestionNotifications, fetchGroupUsefulData
} from '../utils/usefulStorage';

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✓ [PASS] ${msg}`); }
  else { failed++; console.error(`  ❌ [FAIL] ${msg}`); process.exitCode = 1; }
}

class KV {
  m = new Map<string, string>();
  async get(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  async put(k: string, v: string) { this.m.set(k, v); }
  async delete(k: string) { this.m.delete(k); }
  async list(o: { prefix?: string }) { return { keys: [...this.m.keys()].filter(k => k.startsWith(o.prefix || '')).map(name => ({ name })) }; }
}
class Mem {
  s = new Map<string, string>();
  getItem(k: string) { return this.s.get(k) ?? null; }
  setItem(k: string, v: string) { this.s.set(k, String(v)); }
  removeItem(k: string) { this.s.delete(k); }
  clear() { this.s.clear(); }
  get length() { return this.s.size; }
  key(i: number) { return [...this.s.keys()][i] ?? null; }
}

const PEPPER = 'suggest-pepper-0123456789abcdef-xx';
const BOT = '123456789:suggest-test-token';
const kv = new KV();
const env: any = { APP_DATA: kv, ID_PEPPER: PEPPER, TELEGRAM_BOT_TOKEN: BOT, APP_SECRET: 's' };
const GID = 'ingt-310';
kv.m.set(`g:${GID}`, JSON.stringify({ staff: [], slots: [] }));
const staffToken = await createStaffToken(PEPPER, { gid: GID, role: 'starosta', exp: Date.now() + 86400000 });
const now = () => String(Math.floor(Date.now() / 1000));
const initFor = (id: number, username: string) => createTelegramInitData({ user: JSON.stringify({ id, first_name: 'Имя', last_name: 'Фамилия', username }), auth_date: now() }, BOT);
const studentInit = await initFor(555001, 'student_one');
const staffInit = await initFor(777001, 'starosta_user');

const tgCalls: Array<{ chat_id: any; text: string }> = [];
let tgStatus = 200;
const realFetch = (globalThis as any).fetch;
const realWindow = (globalThis as any).window;
const realStorage = (globalThis as any).localStorage;
(globalThis as any).fetch = async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.includes('api.telegram.org')) {
    const body = JSON.parse(init.body);
    tgCalls.push({ chat_id: body.chat_id, text: body.text });
    return new Response(JSON.stringify({ ok: tgStatus === 200 }), { status: tgStatus });
  }
  if (url.startsWith(WORKER_BASE)) return worker.fetch(new Request(url, init), env);
  throw new Error('Unexpected network call: ' + url);
};

const asStudent = (init = studentInit) => { (globalThis as any).window = { Telegram: { WebApp: { initData: init } } }; (globalThis as any).localStorage = new Mem(); };
const asStarosta = (withInit = true) => {
  (globalThis as any).window = { Telegram: { WebApp: { initData: withInit ? staffInit : '' } } };
  const st = new Mem(); st.setItem(`staff_token_${GID}`, staffToken); (globalThis as any).localStorage = st;
};
const raw = (path: string, method: string, headers: Record<string, string>, body?: any) =>
  worker.fetch(new Request(`${WORKER_BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env);

console.log('\n=================================================');
console.log('   TEST SUITE: USEFUL SUGGESTIONS');
console.log('=================================================');

console.log('\n1. Delivery');
let suggestionId = '';
{
  __resetRateLimiters();
  asStudent();
  const res = await submitUsefulSuggestion(GID, { title: 'Конспект по БЖД', text: 'Ссылка на лекции', subject: 'Безопасность жизнедеятельности', tags: ['лабы'], links: [{ title: 'Диск', url: 'https://example.org/bzd' }] } as any);
  assert(res.ok === true && Boolean(res.id), 'a student suggestion is accepted by the server');
  suggestionId = res.id || '';
  const stored = JSON.parse(kv.m.get(`useful-pending:${GID}`)!);
  assert(stored.items.length === 1 && stored.items[0].isPending === true, 'it waits in the group queue');
  assert(stored.items[0].submittedBy.id === 555001 && stored.items[0].submittedBy.username === 'student_one', 'the author is the verified Telegram user');

  const spoof = await raw('/v3/useful/suggest', 'POST', { 'X-Telegram-Init-Data': studentInit }, { gid: GID, item: { title: 'Подделка', text: 'x', submittedBy: { id: 1, username: 'someone_else' }, isPending: false } });
  const spoofItem = JSON.parse(kv.m.get(`useful-pending:${GID}`)!).items[0];
  assert(spoof.status === 200 && spoofItem.submittedBy.id === 555001 && spoofItem.isPending === true, 'a client cannot claim another author or skip moderation');
}

console.log('\n2. Access control');
{
  const anon = await raw('/v3/useful/suggest', 'POST', {}, { gid: GID, item: { title: 'x', text: 'y' } });
  assert(anon.status === 401, `an anonymous request is rejected (${anon.status})`);
  const read = await raw(`/v3/useful/pending?gid=${GID}`, 'GET', { 'X-Telegram-Init-Data': studentInit });
  assert(read.status === 403, `a student cannot read the queue (${read.status})`);
  const act = await raw('/v3/useful/resolve', 'POST', { 'X-Telegram-Init-Data': studentInit }, { gid: GID, id: suggestionId, action: 'approve' });
  assert(act.status === 403, `a student cannot approve (${act.status})`);
  const noGroup = await raw('/v3/useful/suggest', 'POST', { 'X-Telegram-Init-Data': studentInit }, { gid: 'ingt-399', item: { title: 'x', text: 'y' } });
  const noGroupBody = await noGroup.json();
  assert(noGroup.status === 404 && noGroupBody.code === 'NO_STAROSTA', 'a group without a starosta says so');
}

console.log('\n3. Limits');
{
  __resetRateLimiters();
  const other = await initFor(555002, 'student_two');
  const statuses: number[] = [];
  for (let i = 0; i < 11; i++) statuses.push((await raw('/v3/useful/suggest', 'POST', { 'X-Telegram-Init-Data': other }, { gid: GID, item: { title: `M${i}`, text: 'text' } })).status);
  const expected = [...Array(10).fill(200), 429].join();
  assert(statuses.join() === expected, `10 suggestions per user per hour (${statuses.join()})`);
}

console.log('\n4. Moderation');
{
  asStarosta(false);
  const pending = await fetchPendingSuggestions(GID);
  assert(pending.ok && pending.items.some(i => i.id === suggestionId), 'the starosta sees the suggestion in the app');
  assert(pending.items.every(i => i.isPending), 'queue items are marked as pending');
  assert(await resolveSuggestion(GID, suggestionId, 'approve'), 'approve succeeds');
  const after = await fetchPendingSuggestions(GID);
  assert(!after.items.some(i => i.id === suggestionId), 'an approved suggestion leaves the queue');

  asStudent();
  const published = (await fetchGroupUsefulData(GID)).items.find(i => i.id === suggestionId);
  assert(Boolean(published) && !published!.isPending, 'students see the approved material as published');

  asStarosta(false);
  const other = after.items[0];
  assert(await resolveSuggestion(GID, other.id, 'reject'), 'reject succeeds');
  asStudent();
  assert(!(await fetchGroupUsefulData(GID)).items.some(i => i.id === other.id), 'a rejected suggestion is never published');
}

console.log('\n5. Telegram ping (opt-in)');
{
  __resetRateLimiters();
  asStarosta(true);
  tgCalls.length = 0;
  const quiet = await initFor(555003, 'student_three');
  await raw('/v3/useful/suggest', 'POST', { 'X-Telegram-Init-Data': quiet }, { gid: GID, item: { title: 'Без пинга', text: 'text' } });
  assert(tgCalls.length === 0, 'nobody is messaged before they opt in');

  const on = await setSuggestionNotifications(GID, true);
  assert(on.ok, 'a starosta can opt in');
  const stored = [...kv.m.entries()].find(([k]) => k.startsWith(`un:${GID}:`));
  assert(Boolean(stored) && !stored![1].includes('777001'), 'the chat id is stored encrypted');
  assert((await fetchPendingSuggestions(GID)).notify === true, 'the app shows the setting as enabled');

  const loud = await initFor(555004, 'student_four');
  await raw('/v3/useful/suggest', 'POST', { 'X-Telegram-Init-Data': loud }, { gid: GID, item: { title: 'Новый конспект', text: 'text' } });
  assert(tgCalls.length === 1 && String(tgCalls[0].chat_id) === '777001' && tgCalls[0].text.includes('Новый конспект'), 'the opted-in starosta gets a Telegram message with the title');

  tgStatus = 403; tgCalls.length = 0;
  const blocked = await initFor(555005, 'student_five');
  await raw('/v3/useful/suggest', 'POST', { 'X-Telegram-Init-Data': blocked }, { gid: GID, item: { title: 'Еще', text: 'text' } });
  tgStatus = 200;
  assert(![...kv.m.keys()].some(k => k.startsWith(`un:${GID}:`)), 'when the bot cannot write (not started / blocked) the registration is dropped');

  await setSuggestionNotifications(GID, true);
  const off = await setSuggestionNotifications(GID, false);
  assert(off.ok && ![...kv.m.keys()].some(k => k.startsWith(`un:${GID}:`)), 'opting out removes the stored chat id');
}

(globalThis as any).fetch = realFetch;
(globalThis as any).window = realWindow;
(globalThis as any).localStorage = realStorage;
console.log(`\nTOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
if (failed > 0) process.exitCode = 1;
