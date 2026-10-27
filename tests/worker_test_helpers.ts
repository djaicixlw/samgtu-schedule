/**
 * AUD-038: test-only copy of the former worker export `createTelegramInitData`.
 *
 * The function generates SIGNED Telegram initData (a credential FORGERY helper
 * by nature) and belonged in the production bundle only as dead weight — the
 * worker only ever verifies initData. It was removed from cloudflare-worker.js;
 * suites that need to AUTHENTICATE against the worker import it from here.
 * The implementation is byte-identical to the removed export, so hash vectors
 * and all suite expectations are unchanged.
 */

export async function createTelegramInitData(paramsObj: Record<string, unknown>, botToken: string): Promise<string> {
  const enc = new TextEncoder();
  const searchParams = new URLSearchParams();
  for (const [k, v] of Object.entries(paramsObj)) {
    searchParams.set(k, String(v));
  }

  const checkKeys = Array.from(new Set(searchParams.keys()))
    .filter(k => k !== 'hash')
    .sort();
  const dataCheckString = checkKeys
    .map(k => `${k}=${searchParams.get(k)}`)
    .join('\n');

  const hmacKey = await crypto.subtle.importKey(
    "raw",
    enc.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const secretKeyBuffer = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    enc.encode(botToken)
  );

  const checkKey = await crypto.subtle.importKey(
    "raw",
    secretKeyBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const checkBuffer = await crypto.subtle.sign(
    "HMAC",
    checkKey,
    enc.encode(dataCheckString)
  );

  const hash = Array.from(new Uint8Array(checkBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  searchParams.set('hash', hash);
  return searchParams.toString();
}
