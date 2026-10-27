// Общая часть скриптов резервной копии и восстановления Cloudflare KV.
// Запускается ТОЛЬКО на компьютере владельца (у агентов нет доступа к Cloudflare).
// Значения ключей нигде не печатаются: только счётчики по префиксам.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

export const MAGIC = Buffer.from('KVB1');
export const PBKDF2_ITERATIONS = 600000;
// Что копируем по умолчанию: права старост и слоты, привязки, отметки, контент групп.
export const DEFAULT_PREFIXES = ['g:', 'u:', 'a:', 'homework:', 'schedule:', 'useful:', 'lessonfiles:'];
// Устаревшие ключи. Копия нужна ТОЛЬКО перед их очисткой. В auth:* лежат сырые Telegram ID,
// поэтому такой файл хранить не дольше 7 дней и потом удалить.
export const LEGACY_PREFIXES = ['attendance:', 'students:', 'auth:'];
// Намеренно не копируем: rl: (счётчики), inv: (временные приглашения), rm: (временная связка ответов).

export function wranglerCommand() {
  const raw = process.env.WRANGLER_CMD;
  if (raw) return raw.split(' ').filter(Boolean);
  return [process.platform === 'win32' ? 'npx.cmd' : 'npx', 'wrangler'];
}

export function run(args) {
  const [cmd, ...base] = wranglerCommand();
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...base, ...args], {
      shell: process.platform === 'win32' && !process.env.WRANGLER_CMD,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = [];
    const err = [];
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') })
    );
  });
}

// Флаги доступа к боевому KV. В wrangler 4 нужен --remote; если у вас другая версия, задайте WRANGLER_KV_FLAGS.
export function kvFlags() {
  const raw = process.env.WRANGLER_KV_FLAGS;
  return raw === undefined ? ['--remote'] : raw.split(' ').filter(Boolean);
}

// AUD-042: wrangler's kv key list returns at most 1000 keys per call and
// supports cursor continuation. Older code fetched ONE page and silently
// truncated the backup at 1000 keys per prefix.
// One page as reported by the wrangler CLI: { keys, cursor, listComplete }.
// Output format tolerance: newer wrangler may print a JSON object with
// keys/cursor/list_complete; older versions print a bare array. For a bare
// array we infer listComplete = (page < 1000); a full page without a cursor is
// reported loudly (best-effort stop, never an infinite loop).
export const KV_LIST_PAGE_SIZE = 1000;

export async function listKeysPage(prefix, binding, cursor) {
  const args = ['kv', 'key', 'list', `--binding=${binding}`, `--prefix=${prefix}`, ...kvFlags()];
  if (cursor) args.push(`--cursor=${cursor}`);
  const r = await run(args);
  if (r.code !== 0) throw new Error(`Не удалось получить список ключей (${prefix}). Код ${r.code}. ${firstLine(r.stderr)}`);

  const arrStart = r.stdout.indexOf('[');
  const objStart = r.stdout.indexOf('{');
  let sliceStart = -1;
  let sliceEnd = -1;
  if (objStart >= 0 && (arrStart < 0 || objStart < arrStart)) {
    sliceStart = objStart;
    sliceEnd = r.stdout.lastIndexOf('}');
  } else if (arrStart >= 0) {
    sliceStart = arrStart;
    sliceEnd = r.stdout.lastIndexOf(']');
  }
  if (sliceStart < 0 || sliceEnd < sliceStart) return { keys: [], cursor: null, listComplete: true };

  const parsed = JSON.parse(r.stdout.slice(sliceStart, sliceEnd + 1));
  if (Array.isArray(parsed)) {
    const keys = parsed.filter((k) => k && k.name);
    return { keys, cursor: null, listComplete: keys.length < KV_LIST_PAGE_SIZE };
  }
  if (parsed && Array.isArray(parsed.keys)) {
    return {
      keys: parsed.keys.filter((k) => k && k.name),
      cursor: parsed.cursor || null,
      listComplete: parsed.list_complete !== false
    };
  }
  return { keys: [], cursor: null, listComplete: true };
}

/**
 * Full key listing for a prefix: walks pages by cursor until the end.
 * Deduplicates by key name defensively. onPage is the progress hook.
 */
export async function listKeys(prefix, binding, opts = {}) {
  const fetchPage = opts.fetchPage || listKeysPage;
  const onPage = opts.onPage || (() => {});
  const all = [];
  const seen = new Set();
  let cursor = null;
  let pages = 0;
  let warnedNoCursor = false;

  while (true) {
    const page = await fetchPage(prefix, binding, cursor);
    pages++;
    for (const k of page.keys || []) {
      if (!seen.has(k.name)) {
        seen.add(k.name);
        all.push(k);
      }
    }
    onPage({ prefix, page: pages, keysSoFar: all.length, cursor: page.cursor || null });

    if (page.listComplete) break;
    if (!page.cursor) {
      // Full page but the CLI did not give us a continuation cursor.
      if (!warnedNoCursor) {
        warnedNoCursor = true;
        console.warn(`⚠️ [AUD-042] ${prefix}: страница заполнена (${page.keys.length} ключей), но wrangler не вернул cursor. Список может быть неполным — обновите wrangler.`);
      }
      break;
    }
    cursor = page.cursor;
    if (pages > 1000) throw new Error(`Слишком много страниц list для ${prefix} — прерывание (защита от зацикливания).`);
  }
  return all;
}

export async function getValue(name, binding) {
  const r = await run(['kv', 'key', 'get', name, `--binding=${binding}`, ...kvFlags()]);
  if (r.code !== 0) throw new Error(`Не удалось прочитать ключ (код ${r.code}). ${firstLine(r.stderr)}`);
  let v = r.stdout;
  // wrangler может добавить завершающий перевод строки; убираем его только для JSON-значений
  if (v.endsWith('\n')) {
    const trimmed = v.slice(0, -1);
    try { JSON.parse(trimmed); v = trimmed; } catch { /* не JSON, оставляем как есть */ }
  }
  return v;
}

// AUD-042: restore must not CUT the TTL. KV requires expiration >= now+60s, so
// the old code silently DROPPED --expiration for keys expiring within a minute
// (they became permanent) and wrote soon-expiring keys as-is. Now any key that
// HAS a TTL gets at least MIN_RESTORE_TTL_SEC (1 hour) on restore; keys without
// TTL stay permanent. `log` reports raised TTLs.
export const MIN_RESTORE_TTL_SEC = 3600;

export async function putValue(name, value, expiration, binding, log = () => {}) {
  const tmp = path.join(os.tmpdir(), `kvb-${crypto.randomBytes(8).toString('hex')}`);
  fs.writeFileSync(tmp, value, { mode: 0o600 });
  try {
    const args = ['kv', 'key', 'put', name, `--binding=${binding}`, `--path=${tmp}`, ...kvFlags()];
    if (expiration) {
      const minExpiration = Math.floor(Date.now() / 1000) + MIN_RESTORE_TTL_SEC;
      const effective = Math.max(expiration, minExpiration);
      if (effective !== expiration && log) {
        log(`  ⏱ ${name}: TTL поднят с ${expiration} до ${effective} (минимум восстановления — 1 час).`);
      }
      if (effective > Math.floor(Date.now() / 1000) + 60) args.push(`--expiration=${effective}`);
    }
    const r = await run(args);
    if (r.code !== 0) throw new Error(`Не удалось записать ключ (код ${r.code}). ${firstLine(r.stderr)}`);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ничего */ }
  }
}

function firstLine(s) {
  return String(s || '').split('\n').find((l) => l.trim()) || '';
}

export function encrypt(plain, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const iter = Buffer.alloc(4);
  iter.writeUInt32BE(PBKDF2_ITERATIONS);
  const key = crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, 32, 'sha256');
  const header = Buffer.concat([MAGIC, iter, salt, iv]);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(header);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([header, ct, cipher.getAuthTag()]);
}

export function decrypt(file, passphrase) {
  if (file.length < 4 + 4 + 16 + 12 + 16 || !file.subarray(0, 4).equals(MAGIC)) {
    throw new Error('Это не файл резервной копии KV или он повреждён.');
  }
  const iter = file.readUInt32BE(4);
  if (iter < 100000 || iter > 5000000) throw new Error('Файл повреждён (параметры шифрования).');
  const salt = file.subarray(8, 24);
  const iv = file.subarray(24, 36);
  const header = file.subarray(0, 36);
  const tag = file.subarray(file.length - 16);
  const ct = file.subarray(36, file.length - 16);
  const key = crypto.pbkdf2Sync(passphrase, salt, iter, 32, 'sha256');
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAAD(header);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
  } catch {
    throw new Error('Неверная парольная фраза или файл повреждён.');
  }
}

async function pool(items, size, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, lane));
  return results;
}

// AUD-042: transport is injectable for tests (mock KV); default = wrangler CLI.
function defaultTransport(binding) {
  return {
    listPage: (prefix, cursor) => listKeysPage(prefix, binding, cursor),
    get: (name) => getValue(name, binding),
    put: (name, value, expiration, log) => putValue(name, value, expiration, binding, log),
  };
}

export async function createBackup({ prefixes, binding = 'APP_DATA', passphrase, outFile, concurrency = 4, log = () => {}, transport = null, progressEvery = 250 }) {
  if (!passphrase || passphrase.length < 12) throw new Error('Парольная фраза должна быть не короче 12 знаков.');
  const t = transport || defaultTransport(binding);
  const entries = [];
  const perPrefix = {};
  let valuesRead = 0;
  for (const prefix of prefixes) {
    // AUD-042: cursor pagination until the end of the listing.
    const keys = await listKeys(prefix, binding, {
      fetchPage: t.listPage,
      onPage: ({ page, keysSoFar }) => {
        if (page > 1) log(`  ${prefix}: страница ${page}, ключей накоплено ${keysSoFar}...`);
      },
    });
    perPrefix[prefix] = keys.length;
    log(`  ${prefix} ключей: ${keys.length}`);
    const values = await pool(keys, concurrency, async (k) => ({
      key: k.name,
      expiration: k.expiration || null,
      value: await t.get(k.name),
    }));
    valuesRead += values.length;
    if (valuesRead % progressEvery === 0 || values.length === 0) {
      log(`  … прочитано значений: ${valuesRead}`);
    }
    entries.push(...values);
  }
  log(`  … всего прочитано значений: ${valuesRead}`);
  const payload = Buffer.from(
    JSON.stringify({ version: 1, createdAt: new Date().toISOString(), binding, prefixes, count: entries.length, entries }),
    'utf8'
  );
  const blob = encrypt(payload, passphrase);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, blob, { mode: 0o600 });
  const sha256 = crypto.createHash('sha256').update(blob).digest('hex');
  return { count: entries.length, perPrefix, file: outFile, sha256 };
}

export function readBackup(file, passphrase) {
  const payload = JSON.parse(decrypt(fs.readFileSync(file), passphrase).toString('utf8'));
  if (payload.version !== 1 || !Array.isArray(payload.entries)) throw new Error('Неизвестная версия копии.');
  return payload;
}

export async function restoreBackup({ file, passphrase, binding = 'APP_DATA', apply = false, onlyPrefixes = null, concurrency = 4, log = () => {}, transport = null, progressEvery = 250 }) {
  const payload = readBackup(file, passphrase);
  const entries = onlyPrefixes ? payload.entries.filter((e) => onlyPrefixes.some((p) => e.key.startsWith(p))) : payload.entries;
  const perPrefix = {};
  for (const e of entries) {
    const p = e.key.includes(':') ? e.key.split(':')[0] + ':' : '(без префикса)';
    perPrefix[p] = (perPrefix[p] || 0) + 1;
  }
  log(`  В копии от ${payload.createdAt}: ключей ${entries.length}`);
  if (!apply) return { applied: false, count: entries.length, perPrefix, createdAt: payload.createdAt };
  const t = transport || defaultTransport(binding);
  // AUD-042: the TTL floor is transport-agnostic — computed HERE so custom
  // transports (tests, future APIs) get the same guarantee as wrangler.
  const nowSec = Math.floor(Date.now() / 1000);
  const minExpiration = nowSec + MIN_RESTORE_TTL_SEC;
  let written = 0;
  await pool(entries, concurrency, async (e) => {
    let expiration = e.expiration || null;
    if (expiration !== null && expiration < minExpiration) {
      log(`  ⏱ ${e.key}: TTL поднят с ${expiration} до ${minExpiration} (минимум восстановления — 1 час).`);
      expiration = minExpiration;
    }
    await t.put(e.key, e.value, expiration, log);
    written++;
    if (written % progressEvery === 0) log(`  … записано ключей: ${written}/${entries.length}`);
  });
  log(`  … всего записано ключей: ${written}`);
  return { applied: true, count: entries.length, perPrefix, createdAt: payload.createdAt };
}

export function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const orig = rl._writeToOutput;
    rl._writeToOutput = function (s) { if (s.includes(question)) orig.call(rl, s); };
    rl.question(question, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}
