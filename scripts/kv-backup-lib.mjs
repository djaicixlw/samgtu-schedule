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

export async function listKeys(prefix, binding) {
  const r = await run(['kv', 'key', 'list', `--binding=${binding}`, `--prefix=${prefix}`, ...kvFlags()]);
  if (r.code !== 0) throw new Error(`Не удалось получить список ключей (${prefix}). Код ${r.code}. ${firstLine(r.stderr)}`);
  const start = r.stdout.indexOf('[');
  const end = r.stdout.lastIndexOf(']');
  if (start < 0 || end < start) return [];
  const parsed = JSON.parse(r.stdout.slice(start, end + 1));
  return Array.isArray(parsed) ? parsed : [];
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

export async function putValue(name, value, expiration, binding) {
  const tmp = path.join(os.tmpdir(), `kvb-${crypto.randomBytes(8).toString('hex')}`);
  fs.writeFileSync(tmp, value, { mode: 0o600 });
  try {
    const args = ['kv', 'key', 'put', name, `--binding=${binding}`, `--path=${tmp}`, ...kvFlags()];
    if (expiration && expiration > Math.floor(Date.now() / 1000) + 60) args.push(`--expiration=${expiration}`);
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

export async function createBackup({ prefixes, binding = 'APP_DATA', passphrase, outFile, concurrency = 4, log = () => {} }) {
  if (!passphrase || passphrase.length < 12) throw new Error('Парольная фраза должна быть не короче 12 знаков.');
  const entries = [];
  const perPrefix = {};
  for (const prefix of prefixes) {
    const keys = await listKeys(prefix, binding);
    perPrefix[prefix] = keys.length;
    log(`  ${prefix} ключей: ${keys.length}`);
    const values = await pool(keys, concurrency, async (k) => ({
      key: k.name,
      expiration: k.expiration || null,
      value: await getValue(k.name, binding),
    }));
    entries.push(...values);
  }
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

export async function restoreBackup({ file, passphrase, binding = 'APP_DATA', apply = false, onlyPrefixes = null, concurrency = 4, log = () => {} }) {
  const payload = readBackup(file, passphrase);
  const entries = onlyPrefixes ? payload.entries.filter((e) => onlyPrefixes.some((p) => e.key.startsWith(p))) : payload.entries;
  const perPrefix = {};
  for (const e of entries) {
    const p = e.key.includes(':') ? e.key.split(':')[0] + ':' : '(без префикса)';
    perPrefix[p] = (perPrefix[p] || 0) + 1;
  }
  log(`  В копии от ${payload.createdAt}: ключей ${entries.length}`);
  if (!apply) return { applied: false, count: entries.length, perPrefix, createdAt: payload.createdAt };
  await pool(entries, concurrency, (e) => putValue(e.key, e.value, e.expiration, binding));
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
