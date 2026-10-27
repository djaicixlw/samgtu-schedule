/**
 * AUD-041: health-ping online status.
 *
 * Verifies probeServerHealth truth table:
 *   - navigator.onLine === false -> offline (no request at all);
 *   - GET /status 200 -> online, cached for 60s (no extra request);
 *   - non-2xx / network error / timeout -> offline;
 * plus the client wiring (App consumes useOnlineStatus; worker /status keeps
 * its contract: 200 {ok:true}, no-store, no secrets/KV reads).
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const W = path.resolve(__dirname, '..');

let passed = 0;
function check(cond: any, label: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { console.error(`  ✗ FAIL ${label}`); process.exitCode = 1; }
}

const realFetch = globalThis.fetch;
const realNavigator = globalThis.navigator;
let fetchCount = 0;
let respond: () => Promise<any> = async () => ({ ok: true });

async function main() {
  const {
    probeServerHealth, resetHealthPingCache, getLastHealthCheck, HEALTH_PING_TTL_MS
  } = await import('../utils/useOnlineStatus');

  (globalThis as any).fetch = async (url: string, init: any) => {
    fetchCount++;
    return respond();
  };

  console.log('\n--- 1. Healthy server -> online, 60s client cache ---');
  resetHealthPingCache();
  respond = async () => ({ ok: true, json: async () => ({ ok: true }) });
  check(await probeServerHealth() === true, '200 /status -> online');
  check(fetchCount === 1, 'one request made');
  check(await probeServerHealth() === true, 'second call still online');
  check(fetchCount === 1, 'cached within TTL (no extra request)');
  check(getLastHealthCheck()?.ok === true, 'last check recorded');

  console.log('\n--- 2. Server alive but failing -> offline ---');
  resetHealthPingCache();
  respond = async () => ({ ok: false, status: 503 });
  check(await probeServerHealth() === false, 'non-2xx /status -> offline');
  // force=true bypasses the 60s cache (used by the radio/visibility listeners)
  respond = async () => ({ ok: true });
  check(await probeServerHealth(true) === true, 'force=true re-probes despite fresh negative cache');

  console.log('\n--- 3. No answer (dead worker) -> offline ---');
  resetHealthPingCache();
  (globalThis as any).fetch = async () => { fetchCount++; throw new TypeError('fetch failed'); };
  check(await probeServerHealth() === false, 'network error -> offline');

  console.log('\n--- 4. Radio offline is authoritative (navigator.onLine === false) ---');
  resetHealthPingCache();
  fetchCount = 0;
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
  check(await probeServerHealth() === false, 'navigator.onLine false -> offline');
  check(fetchCount === 0, 'no request spent when the radio is down');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });

  console.log('\n--- 5. TTL constant and client wiring ---');
  const mod: any = await import('../utils/useOnlineStatus');
  check(mod.HEALTH_PING_TTL_MS === 60000, 'client cache TTL is 60s');
  check(mod.HEALTH_PING_TIMEOUT_MS === 5000, 'probe has a timeout');
  const appSrc = fs.readFileSync(path.join(W, 'App.tsx'), 'utf8');
  check(appSrc.includes('const isOnline = useOnlineStatus()'), 'App indicator consumes useOnlineStatus');
  check(!appSrc.includes('const [isOnline, setIsOnline] = useState<boolean>(() => {'), 'old navigator-only state is gone');
  // The UI element itself must be unchanged (same classes/labels).
  check(appSrc.includes("title={isOnline ? 'В сети' : 'Офлайн (сохраненная копия)'}"), 'indicator labels unchanged');

  console.log('\n--- 6. Worker /status contract (source pins, AUD-041) ---');
  const workerSrc = fs.readFileSync(path.join(W, 'cloudflare-worker.js'), 'utf8');
  const statusIdx = workerSrc.indexOf('url.pathname === "/status"');
  check(statusIdx > 0, '/status endpoint exists');
  const statusBlock = workerSrc.slice(statusIdx, statusIdx + 900);
  check(statusBlock.includes('ok: true'), '/status returns 200 {ok:true}');
  check(statusBlock.includes('no-cache, no-store'), '/status is no-store');
  check(!statusBlock.includes('APP_DATA.get'), '/status performs no KV reads');
  check(!statusBlock.includes('APP_SECRET'), '/status leaks no secrets');
}

try {
  await main();
} finally {
  globalThis.fetch = realFetch;
  Object.defineProperty(globalThis, 'navigator', { value: realNavigator, configurable: true });
}

console.log(`\n[${passed} checks passed]`);
if (process.exitCode !== 1) console.log('=== AUD-041 ONLINE STATUS SUITE PASSED ===');
