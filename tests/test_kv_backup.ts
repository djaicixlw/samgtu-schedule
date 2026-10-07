// Тест скриптов резервной копии KV на поддельном wrangler (без сети и без Cloudflare).
// Подключить в tests/run_all.ts: await import('./test_kv_backup');
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { createBackup, restoreBackup, readBackup, DEFAULT_PREFIXES, LEGACY_PREFIXES } from '../scripts/kv-backup-lib.mjs';

console.log('=== TEST SUITE: KV backup / restore (fake wrangler) ===\n');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kvb-test-'));
const storeA = path.join(tmp, 'storeA');
const storeB = path.join(tmp, 'storeB');
const fake = path.join(tmp, 'fake-wrangler.mjs');

// Поддельный wrangler: kv key list/get/put поверх каталога (FAKE_KV), один файл на ключ.
// Так параллельные записи не портят друг друга.
fs.writeFileSync(fake, `
import fs from 'node:fs';
import path from 'node:path';
const [, , a, b, op, ...rest] = process.argv;
const dir = process.env.FAKE_KV;
fs.mkdirSync(dir, { recursive: true });
const enc = (k) => path.join(dir, encodeURIComponent(k));
const flag = (n) => { const x = rest.find((s) => s.startsWith('--' + n + '=')); return x ? x.slice(n.length + 3) : null; };
if (a !== 'kv' || b !== 'key') { console.error('bad command'); process.exit(2); }
if (op === 'list') {
  const p = flag('prefix') || '';
  console.error('fake-wrangler banner');
  const names = fs.readdirSync(dir).map(decodeURIComponent).filter((k) => k.startsWith(p));
  console.log(JSON.stringify(names.map((k) => {
    const rec = JSON.parse(fs.readFileSync(enc(k), 'utf8'));
    return { name: k, ...(rec.exp ? { expiration: rec.exp } : {}) };
  })));
} else if (op === 'get') {
  const k = rest[0];
  if (!fs.existsSync(enc(k))) { console.error('not found'); process.exit(1); }
  console.log(JSON.parse(fs.readFileSync(enc(k), 'utf8')).v);
} else if (op === 'put') {
  const k = rest[0];
  const exp = flag('expiration');
  fs.writeFileSync(enc(k), JSON.stringify({ v: fs.readFileSync(flag('path'), 'utf8'), exp: exp ? Number(exp) : undefined }));
}
`);

const future = Math.floor(Date.now() / 1000) + 86400;
const seed = {
  'g:test-1': { v: JSON.stringify({ staff: ['b1'], slots: ['AAAA1111'], MARKER: 'СЕКРЕТНЫЙ-МАРКЕР-12345' }) },
  'u:blind1': { v: JSON.stringify({ gid: 'test-1', slot: 'AAAA1111' }) },
  'a:test-1:2026-10': { v: JSON.stringify({ ver: 3, slots: { AAAA1111: { '10-03.1': 'u' } } }), exp: future },
  'homework:test-1': { v: JSON.stringify({ items: [] }) },
  'rl:claim:x': { v: '3' },
  'inv:abc': { v: JSON.stringify({ gid: 'test-1' }) },
  'rm:42': { v: '{}' },
  'auth:111:test-1': { v: JSON.stringify({ role: 'starosta' }) },
  'attendance:test-1': { v: JSON.stringify({ records: [] }) },
};
const put = (dir: string, k: string, rec: any) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, encodeURIComponent(k)), JSON.stringify(rec));
};
const get = (dir: string, k: string) => JSON.parse(fs.readFileSync(path.join(dir, encodeURIComponent(k)), 'utf8'));
for (const [k, rec] of Object.entries(seed)) put(storeA, k, rec);
process.env.WRANGLER_CMD = `node ${fake}`;
process.env.WRANGLER_KV_FLAGS = '';

const PASS = 'тестовая-парольная-фраза-1';
const out = path.join(tmp, 'b', 'kv.kvbackup');

process.env.FAKE_KV = storeA;
const res = await createBackup({ prefixes: DEFAULT_PREFIXES, passphrase: PASS, outFile: out });
assert.strictEqual(res.count, 4, 'в обычной копии 4 ключа (g, u, a, homework)');
console.log('  [PASS] обычная копия берёт только нужные префиксы');

const raw = fs.readFileSync(out);
assert.ok(!raw.includes('СЕКРЕТНЫЙ-МАРКЕР-12345'), 'в файле нет открытого текста');
assert.ok(!raw.toString('utf8').includes('AAAA1111'), 'слоты не видны в открытом виде');
console.log('  [PASS] файл зашифрован (открытого текста нет)');

const payload = readBackup(out, PASS);
const keys = payload.entries.map((e: any) => e.key);
assert.ok(!keys.some((k: string) => k.startsWith('rl:') || k.startsWith('inv:') || k.startsWith('rm:')), 'временные ключи не копируются');
assert.ok(!keys.some((k: string) => k.startsWith('auth:') || k.startsWith('attendance:')), 'устаревшие ключи без --legacy не копируются');
console.log('  [PASS] временные и устаревшие ключи исключены');

assert.throws(() => readBackup(out, 'неверная-парольная-фраза'), /Неверная парольная фраза/);
const tampered = Buffer.from(raw); tampered[tampered.length - 20] ^= 0xff;
const tamperedPath = path.join(tmp, 'tampered.kvbackup'); fs.writeFileSync(tamperedPath, tampered);
assert.throws(() => readBackup(tamperedPath, PASS), /Неверная парольная фраза|повреждён/);
console.log('  [PASS] неверная фраза и подмена файла отклоняются');

await assert.rejects(() => createBackup({ prefixes: ['g:'], passphrase: 'коротко', outFile: out }), /не короче 12/);
console.log('  [PASS] короткая фраза отклоняется');

const legacy = await createBackup({ prefixes: [...DEFAULT_PREFIXES, ...LEGACY_PREFIXES], passphrase: PASS, outFile: path.join(tmp, 'l.kvbackup') });
assert.strictEqual(legacy.count, 6, 'с --legacy добавляются auth: и attendance:');
console.log('  [PASS] режим legacy добавляет устаревшие ключи');

// Пробный запуск не пишет
process.env.FAKE_KV = storeB;
const dry = await restoreBackup({ file: out, passphrase: PASS, apply: false });
assert.strictEqual(dry.applied, false);
assert.ok(!fs.existsSync(storeB), 'пробный запуск ничего не записал');
console.log('  [PASS] пробное восстановление ничего не пишет');

// Реальное восстановление в пустое хранилище
const real = await restoreBackup({ file: out, passphrase: PASS, apply: true });
assert.strictEqual(real.count, 4);
for (const k of ['g:test-1', 'u:blind1', 'a:test-1:2026-10', 'homework:test-1']) {
  assert.strictEqual(get(storeB, k).v, get(storeA, k).v, `значение ${k} совпало`);
}
assert.strictEqual(get(storeB, 'a:test-1:2026-10').exp, future, 'срок жизни сохранён');
console.log('  [PASS] восстановление возвращает значения и срок жизни');

// Выборочное восстановление
fs.rmSync(storeB, { recursive: true, force: true });
const only = await restoreBackup({ file: out, passphrase: PASS, apply: true, onlyPrefixes: ['g:'] });
assert.strictEqual(only.count, 1);
console.log('  [PASS] выборочное восстановление по префиксу');

// CLI: без backups/ в .gitignore останавливается; с ним работает и не печатает значения
process.env.FAKE_KV = storeA;
const script = path.resolve('scripts/kv-backup.mjs');
const cliOut = path.join(tmp, 'cli.kvbackup');
const env = { ...process.env, KV_BACKUP_PASSPHRASE: PASS };
const noIgnore = spawnSync('node', [script, '--out', cliOut], { cwd: tmp, env, encoding: 'utf8' });
assert.strictEqual(noIgnore.status, 3, 'без .gitignore скрипт останавливается');
assert.ok(!fs.existsSync(cliOut), 'файл не создан');
fs.writeFileSync(path.join(tmp, '.gitignore'), 'backups/\n');
const cli = spawnSync('node', [script, '--out', cliOut], { cwd: tmp, env, encoding: 'utf8' });
assert.strictEqual(cli.status, 0, cli.stderr);
assert.ok(fs.existsSync(cliOut), 'файл создан');
assert.ok(!(cli.stdout + cli.stderr).includes('СЕКРЕТНЫЙ-МАРКЕР-12345'), 'значения не печатаются');
assert.ok(!(cli.stdout + cli.stderr).includes('AAAA1111'), 'слоты не печатаются');
console.log('  [PASS] CLI: требует backups/ в .gitignore и не печатает значения');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\nKV backup: все проверки пройдены.');
