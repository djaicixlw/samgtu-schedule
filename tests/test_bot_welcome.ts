/**
 * The bot used to stay silent on /start. It now greets the user and offers a button that opens the Mini App.
 */
import assert from 'node:assert';
import worker from '../cloudflare-worker.js';

let passed = 0;
const ok = (c: boolean, m: string) => { assert.ok(c, m); passed++; console.log(`  ✓ [PASS] ${m}`); };

const sent: any[] = [];
(globalThis as any).fetch = async (url: any, init?: any) => {
  const u = typeof url === 'string' ? url : url.url;
  if (u.startsWith('https://api.telegram.org/')) { sent.push({ url: u, body: JSON.parse(init.body) }); return new Response('{"ok":true}'); }
  throw new Error('unexpected network call ' + u);
};
const env: any = { APP_DATA: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) },
  TELEGRAM_BOT_TOKEN: '1:test', TG_WEBHOOK_SECRET: 'whsec', DEV_CHAT_ID: '999', ID_PEPPER: 'pepper-pepper-pepper-pepper-1234' };
const hook = (update: any, secret = 'whsec') => worker.fetch(new Request('https://w.test/tg/webhook', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret }, body: JSON.stringify(update)
}), env);
const priv = (text: string) => ({ message: { message_id: 1, from: { id: 5 }, chat: { id: 5, type: 'private' }, text } });

console.log('\n=== TEST SUITE: bot welcome ===');
sent.length = 0;
let r = await hook(priv('/start'));
ok(r.status === 200 && sent.length === 1 && sent[0].url.endsWith('/sendMessage') && sent[0].body.chat_id === 5, '/start in a private chat sends one message to that chat');
ok(sent[0].body.reply_markup.inline_keyboard[0][0].web_app.url === 'https://djaicixlw.github.io/samgtu-schedule/', 'with a button that opens the Mini App');
ok(sent[0].body.parse_mode === 'HTML' && /Неофициальный/.test(sent[0].body.text) && !/Староста:/.test(sent[0].body.text), 'the text says it is unofficial and /start has no extra help');

sent.length = 0;
await hook(priv('/help'));
ok(sent.length === 1 && /Староста:/.test(sent[0].body.text) && /значок жука/.test(sent[0].body.text), '/help adds the starosta and bug-report hints');

sent.length = 0;
await hook(priv('/start@samgtu_rasp_bot'));
ok(sent.length === 1, '/start@botname works as well');
sent.length = 0;
await hook(priv('/start g-ingt-310'));
ok(sent.length === 1, '/start with a payload (deep link) is answered too');

sent.length = 0;
await hook(priv('привет'));
await hook(priv('/startfoo'));
await hook({ message: { message_id: 2, from: { id: 5 }, chat: { id: -100, type: 'supergroup' }, text: '/start' } });
ok(sent.length === 0, 'ordinary text, look-alike commands and group chats are ignored');

r = await hook(priv('/start'), 'wrong');
ok(r.status === 401 && sent.length === 0, 'a wrong webhook secret is still rejected');

env.MINIAPP_URL = 'https://example.org/app/';
sent.length = 0;
await hook(priv('/start'));
ok(sent[0].body.reply_markup.inline_keyboard[0][0].web_app.url === 'https://example.org/app/', 'the Mini App URL can be overridden with MINIAPP_URL');

console.log(`\n=== RESULT: ${passed} passed ===`);
