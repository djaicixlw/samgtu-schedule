/**
 * AUD-021: authorized GET responses carry Cache-Control: private, no-store.
 *
 * Coverage:
 *   C1  GET /sync/*: "public, max-age=60, stale-while-revalidate=300" is replaced
 *       by "private, no-store" on both the 200 and the 304 (If-None-Match) —
 *       ETag logic preserved.
 *   C2  GET /v3/att and GET /v3/me now send "private, no-store" — under BOTH
 *       backends (kv and d1), so the header does not depend on DATA_BACKEND.
 *   C3  Public endpoints keep their headers: /status keeps no-cache; the samgtu
 *       proxy header is untouched code (not asserted over network).
 */

import { readFileSync } from 'node:fs';
import worker, { blindId } from '../cloudflare-worker.js';
import { createTelegramInitData } from './worker_test_helpers';
import { D1Shim } from './helpers/d1_shim';

console.log('\n============================================================');
console.log('      TEST SUITE: CACHE HEADERS (AUD-021)                    ');
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

const TEST_BOT_TOKEN = 'mock_bot_token_cache_fixture';
const TEST_PEPPER = 'mock_pepper_cache_32bytes!!';
const GID = 'cache-310';

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

const kv = makeKv();
const SQL = readFileSync(new URL('../migrations/0001_attendance.sql', import.meta.url), 'utf8');
const db = new D1Shim(0);
db.exec(SQL);
db.exec(`INSERT INTO att_groups (gid, storage, migrated_at) VALUES ('${GID}', 'd1', ${Date.now()})`);

const envKv: any = { TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN, ID_PEPPER: TEST_PEPPER, APP_DATA: kv.kv };
const envD1: any = { TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN, ID_PEPPER: TEST_PEPPER, APP_DATA: kv.kv, DATA_BACKEND: 'd1', DB: db };

const ELDER_TG_ID = 5151;
const elderBlind = await blindId({ ID_PEPPER: TEST_PEPPER } as any, ELDER_TG_ID);
const initData = await createTelegramInitData({
  user: JSON.stringify({ id: ELDER_TG_ID, first_name: 'CacheElder' }),
  auth_date: Math.floor(Date.now() / 1000)
}, TEST_BOT_TOKEN);

await kv.kv.put(`g:${GID}`, JSON.stringify({ staff: [elderBlind], slots: [] }));
await kv.kv.put(`u:${elderBlind}`, JSON.stringify({ gid: GID, slot: 'slotA', consentVer: 1, consentAt: 1758000000000 }));
await kv.kv.put(`homework:${GID}`, JSON.stringify({ updatedAt: 1759000000000, items: [] }));

// --- C1: /sync GET private,no-store + ETag/304 ------------------------------
console.log('--- C1: GET /sync/* is private,no-store; ETag/304 preserved ---');
{
  const res1 = await worker.fetch(new Request(`https://worker.test/sync/homework?groupId=${GID}`), envKv);
  assert(res1.status === 200, `GET /sync/homework returns 200 (got ${res1.status})`);
  assert(res1.headers.get('Cache-Control') === 'private, no-store',
    `C1: 200 Cache-Control is "private, no-store" (got ${res1.headers.get('Cache-Control')})`);
  const etag = res1.headers.get('ETag');
  assert(typeof etag === 'string' && etag.startsWith('"'), `C1: 200 carries a strong ETag (got ${etag})`);
  await res1.text();

  const res304 = await worker.fetch(new Request(`https://worker.test/sync/homework?groupId=${GID}`, {
    headers: { 'If-None-Match': etag! }
  }), envKv);
  assert(res304.status === 304, `If-None-Match with the current ETag returns 304 (got ${res304.status})`);
  assert(res304.headers.get('Cache-Control') === 'private, no-store',
    'C1: 304 Cache-Control is "private, no-store"');
  assert(res304.headers.get('ETag') === etag, 'C1: 304 carries the same ETag');
  await res304.text();

  const resWeak = await worker.fetch(new Request(`https://worker.test/sync/homework?groupId=${GID}`, {
    headers: { 'If-None-Match': `W/${etag}` }
  }), envKv);
  assert(resWeak.status === 304, 'C1: weak validator W/"..." also hits the 304');
  await resWeak.text();

  const resMiss = await worker.fetch(new Request(`https://worker.test/sync/homework?groupId=${GID}`, {
    headers: { 'If-None-Match': '"stale-etag"' }
  }), envKv);
  assert(resMiss.status === 200, 'C1: non-matching If-None-Match returns a fresh 200');
  await resMiss.text();
}

// --- C2: /v3 authorized GETs on both backends --------------------------------
console.log('\n--- C2: GET /v3/att and GET /v3/me are private,no-store under both backends ---');
{
  const attUrl = `https://worker.test/v3/att?gid=${GID}&month=2026-09`;
  const attKv = await worker.fetch(new Request(attUrl, { headers: { 'X-Telegram-Init-Data': initData } }), envKv);
  assert(attKv.status === 200, `GET /v3/att (kv) -> 200 (got ${attKv.status})`);
  assert(attKv.headers.get('Cache-Control') === 'private, no-store',
    `C2: /v3/att (kv) Cache-Control private,no-store (got ${attKv.headers.get('Cache-Control')})`);
  await attKv.text();

  const attD1 = await worker.fetch(new Request(attUrl, { headers: { 'X-Telegram-Init-Data': initData } }), envD1);
  assert(attD1.status === 200, `GET /v3/att (d1) -> 200 (got ${attD1.status})`);
  assert(attD1.headers.get('Cache-Control') === 'private, no-store',
    'C2: /v3/att (d1) Cache-Control private,no-store');
  await attD1.text();

  const meUrl = 'https://worker.test/v3/me';
  const meKv = await worker.fetch(new Request(meUrl, { headers: { 'X-Telegram-Init-Data': initData } }), envKv);
  assert(meKv.status === 200, `GET /v3/me (kv) -> 200 (got ${meKv.status})`);
  assert(meKv.headers.get('Cache-Control') === 'private, no-store',
    'C2: /v3/me (kv) Cache-Control private,no-store');
  await meKv.text();

  const meD1 = await worker.fetch(new Request(meUrl, { headers: { 'X-Telegram-Init-Data': initData } }), envD1);
  assert(meD1.status === 200, `GET /v3/me (d1) -> 200 (got ${meD1.status})`);
  assert(meD1.headers.get('Cache-Control') === 'private, no-store',
    'C2: /v3/me (d1) Cache-Control private,no-store');
  await meD1.text();

  const meUnlinked = await worker.fetch(new Request(meUrl, { headers: { 'X-Telegram-Init-Data': initData } }),
    { ...envKv, APP_DATA: ((): any => {
        const store = new Map<string, string>();
        return { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => { store.set(k, v); }, delete: async (k: string) => { store.delete(k); } };
      })() });
  assert(meUnlinked.status === 200 && meUnlinked.headers.get('Cache-Control') === 'private, no-store',
    'C2: /v3/me linked:false response is also private,no-store');
  await meUnlinked.text();

  const roster = await worker.fetch(new Request(`https://worker.test/v3/roster?gid=${GID}`, { headers: { 'X-Telegram-Init-Data': initData } }), envKv);
  assert(roster.status === 200 && roster.headers.get('Cache-Control') === 'private, no-store',
    'C2: /v3/roster (authorized GET) is private,no-store');
  await roster.text();
}

// --- C3: public endpoints unchanged ------------------------------------------
console.log('\n--- C3: public endpoints keep their cache policy ---');
{
  const status = await worker.fetch(new Request('https://worker.test/status'), envKv);
  assert(status.status === 200 && status.headers.get('Cache-Control') === 'no-cache, no-store, must-revalidate',
    'C3: /status keeps no-cache, no-store, must-revalidate');
  await status.text();
}

console.log(`\n============================================================`);
console.log(`  CACHE HEADERS: ${passed} CHECKS PASSED`);
console.log(`============================================================\n`);
