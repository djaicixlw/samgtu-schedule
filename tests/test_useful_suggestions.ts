/**
 * Student suggestions for "Полезное": the real worker on a delayed in-memory KV, Telegram calls captured.
 *
 * Before: a student's suggestion never reached the starosta (the server answered 403 to a student's write and the app
 * ignored it). Now it goes to a queue with limits, moderation, a badge counter and an opt-in Telegram notification.
 */
import assert from 'node:assert';
import worker, { createStaffToken, createTelegramInitData, blindId } from '../cloudflare-worker.js';

let passed = 0;
const ok = (c: boolean, m: string) => { assert.ok(c, m); passed++; console.log(`  ✓ [PASS] ${m}`); };

class MemKV {
  m = new Map<string, string>();
  async get(k: string) { await new Promise(r => setTimeout(r, 1)); return this.m.has(k) ? this.m.get(k)! : null; }
  async put(k: string, v: string, _o?: any) { await new Promise(r => setTimeout(r, 1)); this.m.set(k, v); }
  async delete(k: string) { this.m.delete(k); }
  async list(o: { prefix?: string; limit?: number } = {}) {
    const keys = [...this.m.keys()].filter(k => k.startsWith(o.prefix || '')).sort().slice(0, o.limit || 1000).map(name => ({ name }));
    return { keys, list_complete: true };
  }
  keys(prefix = '') { return [...this.m.keys()].filter(k => k.startsWith(prefix)); }
}

const BOT = '1:test-bot-token';
const PEPPER = 'suggestions-suite-pepper-0123456789';
const BASE = 'https://w.test';
const kv = new MemKV();
const env: any = { APP_DATA: kv, ID_PEPPER: PEPPER, TELEGRAM_BOT_TOKEN: BOT, APP_SECRET: 's' };

// Telegram is captured; the next answer status can be forced
const tg: Array<{ url: string; body: any }> = [];
let tgStatus = 200;
(globalThis as any).fetch = async (url: any, init?: any) => {
  const u = typeof url === 'string' ? url : url.url;
  if (u.startsWith('https://api.telegram.org/')) { tg.push({ url: u, body: JSON.parse(init.body) }); return new Response('{"ok":true}', { status: tgStatus }); }
  throw new Error('unexpected network call ' + u);
};

const initFor = (id: number, extra: Record<string, any> = {}) =>
  createTelegramInitData({ user: JSON.stringify({ id, first_name: 'Иван', ...extra }), auth_date: String(Math.floor(Date.now() / 1000)) }, BOT);
const call = async (method: string, path: string, headers: Record<string, string>, body?: any) =>
  worker.fetch(new Request(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '10.0.0.1', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  }), env);
const j = async (r: Response) => r.json() as Promise<any>;

const GID = 'ingt-310';
const STUDENT = 7001, STUDENT2 = 7002, STAROSTA = 7100, STRANGER = 7200;
const studentInit = await initFor(STUDENT, { username: 'ivan_s' });
const student2Init = await initFor(STUDENT2, { username: 'petya' });
const starostaInit = await initFor(STAROSTA, { username: 'headman' });
const strangerInit = await initFor(STRANGER);
const starostaBlind = await blindId(env, STAROSTA);
kv.m.set(`g:${GID}`, JSON.stringify({ staff: [starostaBlind], slots: [] }));
kv.m.set('g:other-grp', JSON.stringify({ staff: [], slots: [] }));
const S = (init: string) => ({ 'X-Telegram-Init-Data': init });
const suggest = (init: string, extra: any = {}) => call('POST', '/v3/useful/suggest', S(init), { gid: GID, title: 'Конспект лекций', text: 'Ссылка на папку', subject: 'Физика', tags: ['#лабы'], ...extra });

console.log('\n=== TEST SUITE: useful suggestions ===');

console.log('\n1. A student suggests, the starosta sees it');
let r = await suggest(studentInit);
let b = await j(r);
ok(r.status === 200 && b.ok && /^sg_[0-9a-z]{12}$/.test(b.id) && b.remaining === 9, `the suggestion is accepted (id ${b.id}, ${b.remaining} left today)`);
const firstId = b.id;
const staffH = S(starostaInit);
let pend = await j(await call('GET', `/v3/useful/pending?gid=${GID}`, staffH));
ok(pend.count === 1 && pend.items[0].id === firstId && pend.items[0].author === '@ivan_s' && pend.items[0].title === 'Конспект лекций', 'the starosta sees it with the student\'s @username');
ok(!('ab' in pend.items[0]) && !JSON.stringify(pend).includes(String(STUDENT)), 'the list does not expose the pseudonymous author id or the numeric Telegram id');
ok((await j(await call('GET', `/v3/useful/pending?gid=${GID}&countOnly=1`, staffH))).count === 1, 'the badge counter answers with one cheap read');

console.log('\n2. Who may do what');
ok((await call('GET', `/v3/useful/pending?gid=${GID}`, S(studentInit))).status === 403, 'a student cannot read the queue');
ok((await call('GET', `/v3/useful/pending?gid=${GID}`, {})).status === 401, 'an anonymous caller gets 401');
ok((await call('GET', `/v3/useful/pending?gid=other-grp`, staffH)).status === 403, "another group's queue is closed to this starosta");
ok((await call('POST', '/v3/useful/decision', S(studentInit), { gid: GID, id: firstId, action: 'approve' })).status === 403, 'a student cannot approve their own suggestion');
const tokenOnly = { 'X-Staff-Token': await createStaffToken(PEPPER, { gid: GID, role: 'starosta', exp: Date.now() + 3600e3 }) };
ok((await call('POST', '/v3/useful/suggest', tokenOnly, { gid: GID, title: 'x' })).status === 401, 'suggesting needs Telegram initData (a staff token alone is not a student)');
ok((await call('POST', '/v3/useful/suggest', S(studentInit), { gid: 'no-such-group', title: 'x' })).status === 404, 'a group without a starosta in the app answers honestly instead of accepting into the void');
ok((await call('POST', '/v3/useful/suggest', S(studentInit), { gid: 'bad gid!', title: 'x' })).status === 400, 'a malformed group id is rejected');

console.log('\n3. Anonymous, and blocking an anonymous author');
r = await suggest(student2Init, { title: 'Спорный материал', anonymous: true });
const anonId = (await j(r)).id;
pend = await j(await call('GET', `/v3/useful/pending?gid=${GID}`, staffH));
const anon = pend.items.find((i: any) => i.id === anonId);
ok(anon.author === null && anon.anonymous === true && !JSON.stringify(kv.m.get(`us:${GID}:${anonId}`)).includes('petya'), 'an anonymous suggestion stores no name at all');
ok((await j(await call('POST', '/v3/useful/decision', staffH, { gid: GID, id: anonId, action: 'block' }))).ok, 'the starosta blocks the anonymous author');
r = await suggest(student2Init, { title: 'Ещё одно' });
ok(r.status === 403 && (await j(r)).code === 'BLOCKED', 'the blocked student can no longer suggest in this group (even without a name)');
ok((await suggest(studentInit, { title: 'Другой студент' })).status === 200, 'other students are not affected');
ok((await j(await call('POST', '/v3/useful/decision', staffH, { gid: GID, action: 'unblock_all' }))).unblocked === 1, 'unblock_all lifts the block');
ok((await suggest(student2Init, { title: 'Снова можно' })).status === 200, 'and the student can suggest again');

console.log('\n4. Decisions are idempotent and keep the counter honest');
const before = (await j(await call('GET', `/v3/useful/pending?gid=${GID}`, staffH))).count;
ok((await j(await call('POST', '/v3/useful/decision', staffH, { gid: GID, id: firstId, action: 'approve' }))).ok, 'approve removes the suggestion from the queue');
ok((await j(await call('POST', '/v3/useful/decision', staffH, { gid: GID, id: firstId, action: 'approve' }))).already === true, 'approving twice is harmless');
const after = (await j(await call('GET', `/v3/useful/pending?gid=${GID}&countOnly=1`, staffH))).count;
ok(after === before - 1, `the counter dropped by exactly one (${before} -> ${after})`);
ok((await call('POST', '/v3/useful/decision', staffH, { gid: GID, id: '../../x', action: 'approve' })).status === 400, 'a malformed id is rejected');
ok((await call('POST', '/v3/useful/decision', staffH, { gid: GID, id: firstId, action: 'delete-everything' })).status === 400, 'an unknown action is rejected');
const rejId = (await j(await suggest(studentInit, { title: 'Не подходит' }))).id;
await call('POST', '/v3/useful/decision', staffH, { gid: GID, id: rejId, action: 'reject' });
ok(kv.keys(`us:${GID}:${rejId}`).length === 0, 'a rejected suggestion (and the name in it) is deleted at once');

console.log('\n5. Limits');
{
  const lim = await initFor(7300, { username: 'spammer' });
  const kvBefore = kv.keys('us:').length;
  let last = 200; let n = 0;
  while (n < 12) { const rr = await suggest(lim, { title: `s${n}` }); last = rr.status; if (rr.status !== 200) break; n++; }
  ok(n === 10 && last === 429, `exactly 10 suggestions per day, the 11th is refused (accepted ${n})`);
  const code = (await j(await suggest(lim))).code;
  ok(code === 'DAILY_LIMIT', 'the answer says why (DAILY_LIMIT) so the app can show it');
  const realNow = Date.now;
  Date.now = () => realNow() + 24 * 3600 * 1000 + 1000;
  const limTomorrow = await initFor(7300, { username: 'spammer' });   // a fresh initData: the old one is more than a day old by then
  const tomorrow = await suggest(limTomorrow, { title: 'завтра' });
  Date.now = realNow;
  ok(tomorrow.status === 200, 'the limit resets the next (Samara) day');
  ok(kv.keys('us:').length === kvBefore + 11, 'refused requests stored nothing');
}
{
  kv.m.set('usc:other-q', JSON.stringify({ n: 50 }));
  kv.m.set('g:other-q', JSON.stringify({ staff: [], slots: [] }));
  const full = await call('POST', '/v3/useful/suggest', S(await initFor(7400)), { gid: 'other-q', title: 'x' });
  ok(full.status === 429 && (await j(full)).code === 'QUEUE_FULL', 'a group with 50 unreviewed suggestions stops accepting (QUEUE_FULL)');
}

console.log('\n6. Input is cleaned, nothing dangerous is stored');
{
  const evil = await initFor(7500, { username: 'x' });
  const r6 = await call('POST', '/v3/useful/suggest', S(evil), {
    gid: GID, title: '  Заголовок\u202Eevil\u0000  ', text: 'Т'.repeat(5000), subject: 'Ф'.repeat(500),
    links: [{ title: 'ok', url: 'https://example.com/a' }, { title: 'js', url: 'javascript:alert(1)' }, { title: 'http', url: 'http://example.com' },
      { title: 'cred', url: 'https://user:pw@example.com/' }, { title: 'nodot', url: 'https://localhost/' }, { title: 'ok2', url: 'https://t.me/c/1' }],
    attachments: [{ name: 'a.pdf', url: `${BASE}/file?file_id=abc&sig=1`, type: 'file' }, { name: 'evil', url: 'https://evil.example/x.exe' }, 'junk'],
    tags: Array.from({ length: 30 }, (_, i) => `#Тег${i}`)
  });
  ok(r6.status === 200, 'a hostile payload is accepted but cleaned');
  const stored = JSON.parse(kv.m.get(`us:${GID}:${(await j(r6)).id}`)!);
  ok(stored.title === 'Заголовокevil' && !/[\u202E\u0000]/.test(stored.title), 'invisible direction overrides and control characters are removed from text');
  ok(stored.text.length === 2000 && stored.subject.length === 100 && stored.tags.length === 10, 'lengths are capped (text 2000, subject 100, 10 tags)');
  ok(stored.links.map((l: any) => l.url).join() === 'https://example.com/a,https://t.me/c/1', 'only plain https links with a real host survive (javascript:, http:, credentials, hostless are dropped)');
  ok(stored.attachments.length === 1 && stored.attachments[0].url.startsWith(`${BASE}/file?`), 'files must come from this worker; arbitrary external URLs are dropped');
  ok((await call('POST', '/v3/useful/suggest', S(evil), { gid: GID })).status === 400, 'an empty suggestion is rejected');
  ok((await call('POST', '/v3/useful/suggest', S(evil), { gid: GID, title: '\u202E \u0000' })).status === 400, 'a title made only of invisible characters is empty');
}

console.log('\n7. Notifications to the starosta');
{
  tg.length = 0;
  ok((await call('POST', '/v3/notify/subscribe', S(studentInit), { gid: GID, enable: true })).status === 403, 'a student cannot subscribe to the starosta\'s notifications');
  ok((await call('POST', '/v3/notify/subscribe', tokenOnly, { gid: GID, enable: true })).status === 401, 'subscribing needs Telegram initData (the chat id comes from it)');
  r = await call('POST', '/v3/notify/subscribe', staffH, { gid: GID, enable: true });
  ok(r.status === 200 && (await j(r)).subscribed === true, 'the starosta subscribes');
  ok((await j(await call('GET', `/v3/notify/status?gid=${GID}`, staffH))).subscribed === true, 'status reports the subscription');
  const subRaw = kv.m.get(`ns:${GID}:${starostaBlind}`)!;
  ok(!subRaw.includes(String(STAROSTA)) && /"enc":"[0-9a-f]+"/.test(subRaw), 'the chat id is stored encrypted, never in clear');
  ok(!JSON.stringify([...kv.m.entries()].filter(([k]) => !k.startsWith('us:'))).includes(String(STUDENT)), 'a student\'s numeric Telegram id appears nowhere in KV');

  const a = await initFor(7601, { username: 'notif' });
  await call('POST', '/v3/useful/suggest', S(a), { gid: GID, title: '<b>Hack</b> & <script>x</script>' });
  ok(tg.length === 1 && String(tg[0].body.chat_id) === String(STAROSTA) && tg[0].url.endsWith(`bot${BOT}/sendMessage`), 'the starosta gets a Telegram message right after the suggestion');
  ok(tg[0].body.text.includes('&lt;b&gt;Hack&lt;/b&gt; &amp; &lt;script&gt;') && !tg[0].body.text.includes('<script>'), 'student text is HTML-escaped in the message');
  ok(tg[0].body.text.includes('@notif') && /Ждут проверки: \d+/.test(tg[0].body.text) && tg[0].body.reply_markup.inline_keyboard[0][0].web_app.url.startsWith('https://'), 'it names the author, the number waiting and has an "open" button');
  await call('POST', '/v3/useful/suggest', S(await initFor(7602)), { gid: GID, title: 'второе подряд' });
  ok(tg.length === 1, 'a second suggestion within 5 minutes does not send a second message (the badge covers it)');
  const realNow = Date.now;
  Date.now = () => realNow() + 6 * 60 * 1000;
  await call('POST', '/v3/useful/suggest', S(await initFor(7603)), { gid: GID, title: 'после паузы' });
  Date.now = realNow;
  ok(tg.length === 2, 'after the pause the next suggestion notifies again');

  // the starosta blocked the bot: the dead subscription is removed
  kv.m.delete(`nt:${GID}`); tgStatus = 403;
  await call('POST', '/v3/useful/suggest', S(await initFor(7604)), { gid: GID, title: 'бот заблокирован' });
  tgStatus = 200;
  ok(!kv.m.has(`ns:${GID}:${starostaBlind}`), 'a 403 from Telegram (bot blocked) removes the subscription');
  r = await call('POST', '/v3/notify/subscribe', staffH, { gid: GID, enable: false });
  ok((await j(r)).subscribed === false && !kv.m.has(`ns:${GID}:${starostaBlind}`), 'unsubscribing deletes it');

  // cap of 5 subscribers
  for (let i = 0; i < 5; i++) kv.m.set(`ns:${GID}:fake${i}`, '{"enc":"00","iv":"00"}');
  ok((await call('POST', '/v3/notify/subscribe', staffH, { gid: GID, enable: true })).status === 409, 'at most 5 people per group can subscribe');
}

console.log('\n8. The public "Полезное" never carries pending items or author ids');
{
  const staffPush = { ...staffH, 'X-Staff-Token': tokenOnly['X-Staff-Token'] };
  const dirty = {
    groupId: GID, updatedAt: Date.now(),
    items: [
      { id: 'u1', groupId: GID, title: 'Нормальный', text: 'ok', links: [{ title: 'l', url: 'https://example.com' }, { title: 'bad', url: 'javascript:alert(1)' }], tags: ['лабы'], isPending: false, createdAt: new Date().toISOString(),
        submittedBy: { id: 7001, username: 'ivan_s' } },
      { id: 'u2', groupId: GID, title: 'Ожидает', text: 'x', isPending: true, submittedBy: { id: 7002, username: 'petya' }, createdAt: new Date().toISOString() }
    ]
  };
  const put = await call('PUT', `/sync/useful?groupId=${GID}`, staffPush, dirty);
  ok(put.status === 200, 'the starosta can still publish the list');
  const stored = kv.m.get(`useful:${GID}`) || [...kv.m.entries()].find(([k]) => k.includes('useful') && k.includes(GID))?.[1] || '';
  ok(stored.length > 0 && !stored.includes('submittedBy') && !stored.includes('7001') && !stored.includes('petya') && !stored.includes('u2') && !stored.includes('javascript:'),
    'the stored document has no pending item, no submittedBy, no javascript: link');
  // a document written by the OLD code still sits in KV with student ids: reading it is safe too
  const key = [...kv.m.keys()].find(k => k.includes('useful') && k.includes(GID))!;
  kv.m.set(key, JSON.stringify({ updatedAt: 1, items: dirty.items }));
  const pub = await (await call('GET', `/sync/useful?groupId=${GID}`, {})).text();
  ok(!pub.includes('submittedBy') && !pub.includes('7001') && !pub.includes('petya') && !pub.includes('u2'), 'a legacy document is cleaned on the way out (public GET, no credentials)');
  ok(JSON.parse(pub).byGroup[GID].items.length === 1 && JSON.parse(pub).byGroup[GID].items[0].links.length === 1, 'the good item and its https link are intact');
}

console.log(`\n=== RESULT: ${passed} passed ===`);
