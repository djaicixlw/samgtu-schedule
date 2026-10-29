/**
 * The app side of student suggestions: the REAL client module against the REAL worker.
 * What the user sees: honest errors instead of "Староста проверит" when nothing was sent, the daily limit,
 * the pending list, moderation and the notification switch.
 */
import assert from 'node:assert';
import worker, { createTelegramInitData, blindId } from '../cloudflare-worker.js';
import { setAttendanceApiBase } from '../utils/attendanceStorage';
import {
  submitSuggestion, fetchPendingCount, fetchPendingSuggestions, decideSuggestion, setNotifications, getNotificationStatus, toPendingItem
} from '../utils/suggestionsClient';

let passed = 0;
const ok = (c: boolean, m: string) => { assert.ok(c, m); passed++; console.log(`  ✓ [PASS] ${m}`); };

class MemKV {
  m = new Map<string, string>();
  async get(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  async put(k: string, v: string) { this.m.set(k, v); }
  async delete(k: string) { this.m.delete(k); }
  async list(o: { prefix?: string; limit?: number } = {}) {
    return { keys: [...this.m.keys()].filter(k => k.startsWith(o.prefix || '')).sort().slice(0, o.limit || 1000).map(name => ({ name })), list_complete: true };
  }
}
const BOT = '1:client-suite';
const PEPPER = 'client-suggestions-pepper-0123456789';
const BASE = 'https://w.test';
const kv = new MemKV();
const env: any = { APP_DATA: kv, ID_PEPPER: PEPPER, TELEGRAM_BOT_TOKEN: BOT, APP_SECRET: 's' };
let offline = false;
const telegramCalls: any[] = [];
(globalThis as any).fetch = async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith('https://api.telegram.org/')) { telegramCalls.push(JSON.parse(init.body)); return new Response('{"ok":true}'); }
  if (offline) throw new TypeError('Failed to fetch');
  if (!url.startsWith(BASE)) throw new Error('unexpected ' + url);
  return worker.fetch(new Request(url, init), env);
};
class MemoryStorage {
  private s = new Map<string, string>();
  getItem(k: string) { return this.s.has(k) ? this.s.get(k)! : null; }
  setItem(k: string, v: string) { this.s.set(k, String(v)); }
  removeItem(k: string) { this.s.delete(k); }
}
(globalThis as any).localStorage = new MemoryStorage();
setAttendanceApiBase(BASE);
const actAs = async (id: number, username?: string) => {
  const initData = await createTelegramInitData({ user: JSON.stringify({ id, first_name: 'Имя', username }), auth_date: String(Math.floor(Date.now() / 1000)) }, BOT);
  (globalThis as any).window = { Telegram: { WebApp: { initData } } };
};

const GID = 'ingt-310';
const STAROSTA = 8100;
kv.m.set(`g:${GID}`, JSON.stringify({ staff: [await blindId(env, STAROSTA)], slots: [] }));

console.log('\n=== TEST SUITE: suggestions client ===');

await actAs(8001, 'anna');
let r = await submitSuggestion({ gid: GID, title: 'Шпаргалка по физике', text: 'ссылка', subject: 'Физика', tags: ['сессия'], links: [{ title: 'Диск', url: 'https://example.com/d' }] });
ok(r.ok && !!r.id && r.remaining === 9, `a suggestion is sent (id ${r.id}, ${r.remaining} left today)`);

r = await submitSuggestion({ gid: 'nobody-here', title: 'x', text: '' });
ok(!r.ok && r.code === 'NO_STAROSTA' && /нет старосты/.test(r.error || ''), 'a group without a starosta gives a clear Russian error, not a fake success');
r = await submitSuggestion({ gid: GID, title: '', text: '' });
ok(!r.ok && /Заполните/.test(r.error || ''), 'an empty suggestion is explained');

offline = true;
r = await submitSuggestion({ gid: GID, title: 'без сети', text: 'x' });
offline = false;
ok(!r.ok && /Нет связи/.test(r.error || ''), 'no network: the student is told it was NOT sent (the old app said "Староста проверит")');

(globalThis as any).window = {};
r = await submitSuggestion({ gid: GID, title: 'вне Telegram', text: 'x' });
ok(!r.ok && r.status === 401 && /Telegram/.test(r.error || ''), 'outside Telegram (no initData) the student gets a clear message');

await actAs(8002, 'boris');
for (let i = 0; i < 9; i++) await submitSuggestion({ gid: GID, title: `s${i}`, text: 't' });
r = await submitSuggestion({ gid: GID, title: 'десятое', text: 't' });
ok(r.ok && r.remaining === 0, 'the 10th suggestion of the day goes through, 0 left');
r = await submitSuggestion({ gid: GID, title: 'одиннадцатое', text: 't' });
ok(!r.ok && r.code === 'DAILY_LIMIT' && /10/.test(r.error || ''), 'the 11th is refused with the reason (limit 10 a day)');

console.log('\nStarosta side');
await actAs(8003);
ok((await fetchPendingSuggestions(GID)).ok === false, 'a student cannot load the queue');
ok((await fetchPendingCount(GID)).ok === false, 'nor the counter');

await actAs(STAROSTA, 'headman');
const cnt = await fetchPendingCount(GID);
ok(cnt.ok && cnt.count === 11, `the badge counter shows ${cnt.count} waiting`);
const pend = await fetchPendingSuggestions(GID);
const anna = pend.items.find(i => i.title === 'Шпаргалка по физике')!;
ok(pend.ok && pend.items.length === 11 && anna.isPending === true && anna.submittedBy?.username === 'anna' && anna.links?.[0].url === 'https://example.com/d',
  'the queue arrives in the shape the Useful tab already renders (pending item, "от @anna", links kept)');
ok(!JSON.stringify(pend).includes('8001') && !JSON.stringify(pend).includes('"ab"'), 'no Telegram ids or internal author ids reach the app');

const anon = toPendingItem({ id: 'sg_x', title: 't', text: '', author: null }, GID);
const named = toPendingItem({ id: 'sg_y', title: 't', text: '', author: 'Мария' }, GID);
ok(anon.submittedBy === undefined && named.submittedBy?.name === 'Мария', 'anonymous suggestions have no author; a name without @ becomes a plain name');

let d = await decideSuggestion(GID, anna.id, 'approve');
ok(d.ok, 'approve');
d = await decideSuggestion(GID, anna.id, 'approve');
ok(d.ok, 'approving again is harmless (the app can retry safely)');
ok((await fetchPendingCount(GID)).count === 10, 'the counter went down by one');
d = await decideSuggestion(GID, pend.items[1].id, 'block');
ok(d.ok, 'block the author');
await actAs(8002, 'boris');
r = await submitSuggestion({ gid: GID, title: 'после блокировки', text: 't' });
ok(!r.ok && r.code === 'BLOCKED', 'the blocked student sees a clear refusal');
await actAs(STAROSTA, 'headman');
ok((await decideSuggestion(GID, '', 'unblock_all')).ok, 'unblock everyone');
d = await decideSuggestion(GID, 'bad id', 'approve');
ok(!d.ok && !!d.error, 'a malformed id is reported');

console.log('\nNotifications');
ok((await getNotificationStatus(GID)).subscribed === false, 'not subscribed at first');
let n = await setNotifications(GID, true);
ok(n.ok && n.subscribed === true && (await getNotificationStatus(GID)).subscribed === true, 'the starosta turns notifications on');
telegramCalls.length = 0;
await actAs(8200, 'carol');
await submitSuggestion({ gid: GID, title: 'Пара слов', text: 't' });
ok(telegramCalls.length === 1 && String(telegramCalls[0].chat_id) === String(STAROSTA), 'the next suggestion reaches the starosta in Telegram');
await actAs(STAROSTA, 'headman');
n = await setNotifications(GID, false);
ok(n.ok && n.subscribed === false, 'and they can turn it off');
await actAs(8200, 'carol');
const st = await setNotifications(GID, true);
ok(!st.ok && st.status === 403, 'a student cannot turn on the starosta\'s notifications');

console.log(`\n=== RESULT: ${passed} passed ===`);
