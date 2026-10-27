/**
 * AUD-020: secret separation — no TG_WEBHOOK_SECRET -> APP_SECRET fallback.
 *
 * Coverage:
 *   W1  POST /tg/webhook without TG_WEBHOOK_SECRET fails CLOSED with 503 and a
 *       generic message (must not disclose WHICH secret is missing), even when
 *       APP_SECRET is configured — the old fallback is gone.
 *   W2  With TG_WEBHOOK_SECRET set: wrong secret -> 401; correct header secret or
 *       path secret -> the handler proceeds (200 on an empty update).
 *   W3  APP_SECRET semantics elsewhere are unchanged: X-App-Key still guards
 *       /sync/* PUT and /notify; /v3 initData auth is untouched.
 */

import worker, {
  requireAppKey
} from '../cloudflare-worker.js';
// AUD-038: the initData FORGERY helper moved out of the production worker.
import { createTelegramInitData } from './worker_test_helpers';

console.log('\n============================================================');
console.log('      TEST SUITE: WORKER SECRETS (AUD-020)                   ');
console.log('============================================================\n');

let passed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`  ❌ FAIL: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  passed++;
  console.log(`  ✓ [PASS] ${msg}`);
}

const TEST_BOT_TOKEN = 'mock_bot_token_secrets_fixture';
const TEST_PEPPER = 'mock_pepper_secrets_32bytes!!';
const APP_SECRET = 'app-secret-value-12345';

function makeKv() {
  const store = new Map<string, string>();
  return {
    store,
    kv: {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string, _o?: any) => { store.set(k, v); },
      delete: async (k: string) => { store.delete(k); }
    }
  };
}

const baseKv = makeKv();
const baseEnv: any = {
  TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN,
  ID_PEPPER: TEST_PEPPER,
  APP_SECRET,
  APP_DATA: baseKv.kv,
  DEV_CHAT_ID: '987654321',
  TELEGRAM_CHANNEL_ID: '-1002345678901'
};

function webhookRequest(secret?: string, pathSuffix = ''): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret !== undefined) headers['X-Telegram-Bot-Api-Secret-Token'] = secret;
  return new Request(`https://worker.test/tg/webhook${pathSuffix}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({})
  });
}

// --- W1: no fallback to APP_SECRET ------------------------------------------
console.log('--- W1: webhook without TG_WEBHOOK_SECRET fails closed (503) ---');
{
  const res = await worker.fetch(webhookRequest('app-secret-value-12345'), baseEnv);
  assert(res.status === 503, `webhook with APP_SECRET as the header secret returns 503 (got ${res.status})`);
  const body = await res.json() as any;
  assert(typeof body.error === 'string' && body.error.length > 0, '503 body carries a generic error field');
  assert(!body.error.toLowerCase().includes('app_secret') && !body.error.toLowerCase().includes('tg_webhook'),
    '503 message does not disclose which secret is missing');

  const resNoHeader = await worker.fetch(webhookRequest(), baseEnv);
  assert(resNoHeader.status === 503, `webhook without any secret header returns 503 (got ${resNoHeader.status})`);
  await resNoHeader.text();

  const resNoAppSecretEnv: any = { ...baseEnv, APP_SECRET: undefined };
  const resClean = await worker.fetch(webhookRequest('anything'), resNoAppSecretEnv);
  assert(resClean.status === 503, 'webhook without TG_WEBHOOK_SECRET and without APP_SECRET also returns 503');
  await resClean.text();
}

// --- W2: dedicated webhook secret works -------------------------------------
console.log('\n--- W2: TG_WEBHOOK_SECRET is the only accepted webhook secret ---');
{
  const envWithHook: any = { ...baseEnv, TG_WEBHOOK_SECRET: 'whsec-correct-9999' };

  const bad = await worker.fetch(webhookRequest('whsec-wrong'), envWithHook);
  assert(bad.status === 401, `wrong webhook secret returns 401 (got ${bad.status})`);
  await bad.text();

  const okHeader = await worker.fetch(webhookRequest('whsec-correct-9999'), envWithHook);
  assert(okHeader.status === 200, `correct header secret -> handler runs (got ${okHeader.status})`);
  await okHeader.text();

  const okPath = await worker.fetch(webhookRequest(undefined, '/whsec-correct-9999'), envWithHook);
  assert(okPath.status === 200, `correct path secret (/tg/webhook/{secret}) -> handler runs (got ${okPath.status})`);
  await okPath.text();
}

// --- W3: APP_SECRET semantics elsewhere unchanged ---------------------------
console.log('\n--- W3: APP_SECRET / X-App-Key semantics are not affected ---');
{
  const putRes = await worker.fetch(new Request('https://worker.test/sync/homework?groupId=ingt-310', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-App-Key': APP_SECRET },
    body: JSON.stringify({ items: [] })
  }), baseEnv);
  assert(putRes.status === 200, `PUT /sync/homework with correct X-App-Key still works (got ${putRes.status})`);
  await putRes.text();

  const badKey = await worker.fetch(new Request('https://worker.test/sync/homework?groupId=ingt-310', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-App-Key': 'forged' },
    body: JSON.stringify({ items: [] })
  }), baseEnv);
  assert(badKey.status === 401, `PUT /sync/homework with forged X-App-Key still 401 (got ${badKey.status})`);
  await badKey.text();

  assert(await requireAppKey(new Request('https://worker.test/', { headers: { 'X-App-Key': APP_SECRET } }), APP_SECRET) === true,
    'requireAppKey unit behavior unchanged (accepts matching key)');
  assert(await requireAppKey(new Request('https://worker.test/', { headers: { 'X-App-Key': APP_SECRET } }), 'other') === false,
    'requireAppKey unit behavior unchanged (rejects other key)');

  const initData = await createTelegramInitData({
    user: JSON.stringify({ id: 777, first_name: 'SecretUser' }),
    auth_date: Math.floor(Date.now() / 1000)
  }, TEST_BOT_TOKEN);
  const v3me = await worker.fetch(new Request('https://worker.test/v3/me', {
    headers: { 'X-Telegram-Init-Data': initData }
  }), baseEnv);
  assert(v3me.status === 200, `/v3/me with valid initData still works (got ${v3me.status})`);
  await v3me.text();

  const v3noauth = await worker.fetch(new Request('https://worker.test/v3/me'), baseEnv);
  assert(v3noauth.status === 401, `/v3/me without auth still 401 (got ${v3noauth.status})`);
  await v3noauth.text();
}

console.log(`\n============================================================`);
console.log(`  WORKER SECRETS: ${passed} CHECKS PASSED`);
console.log(`============================================================\n`);
