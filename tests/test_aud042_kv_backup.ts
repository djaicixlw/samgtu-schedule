/**
 * AUD-042: kv-backup-lib — cursor pagination, TTL floor on restore, progress.
 *
 * Mock-KV scenario from the brief: 1500 keys are backed up and restored
 * COMPLETELY (the old single-page list silently truncated at 1000 keys), and
 * restore never CUTS a TTL: any key that had an expiration leaves restore with
 * >= 1 hour of TTL; keys without TTL stay permanent.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const W = path.resolve(__dirname, '..');

let passed = 0;
function check(cond: any, label: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { console.error(`  ✗ FAIL ${label}`); process.exitCode = 1; }
}

const lib = await import('../scripts/kv-backup-lib.mjs');
const {
  createBackup, restoreBackup, readBackup, listKeys, listKeysPage,
  KV_LIST_PAGE_SIZE, MIN_RESTORE_TTL_SEC
} = lib as any;

console.log('\n--- 1. Mock KV: 1500 keys, cursor pagination ---');

// Mock KV namespace: 'a:' -> 1200 keys (spans TWO pages), 'homework:' -> 300 keys.
interface MockKey { name: string; expiration?: number }
const mockKV = new Map<string, { value: string; expiration?: number }>();
const pageOf: Record<string, MockKey[]> = {};
for (let i = 0; i < 1200; i++) {
  const name = `a:ingt-${310 + Math.floor(i / 100)}:2026-${String((i % 12) + 1).padStart(2, '0')}:${i}`;
  const expiration = i === 5 ? Math.floor(Date.now() / 1000) + 120 : undefined; // one near-expiry key
  mockKV.set(name, { value: `value-for-${name}`, expiration });
}
for (let i = 0; i < 300; i++) {
  const name = `homework:ingt-310:item-${i}`;
  mockKV.set(name, { value: JSON.stringify({ id: `hw-${i}`, text: `текст ${i}` }) });
}

const LIST_PAGES: Record<string, MockKey[][]> = {};
function buildPages(prefix: string): MockKey[][] {
  if (LIST_PAGES[prefix]) return LIST_PAGES[prefix];
  const names = Array.from(mockKV.keys()).filter(n => n.startsWith(prefix)).sort();
  const pages: MockKey[][] = [];
  for (let i = 0; i < names.length; i += KV_LIST_PAGE_SIZE) {
    pages.push(names.slice(i, i + KV_LIST_PAGE_SIZE).map(n => ({ name: n, expiration: mockKV.get(n)!.expiration })));
  }
  LIST_PAGES[prefix] = pages;
  return pages;
}

const mockListPage = async (prefix: string, _binding: string, cursor: string | null) => {
  const pages = buildPages(prefix);
  const idx = cursor ? Number(cursor) : 0;
  const keys = pages[idx] || [];
  const next = idx + 1;
  return {
    keys,
    cursor: next < pages.length ? String(next) : null,
    listComplete: next >= pages.length
  };
};

const mockTransport = {
  listPage: mockListPage,
  get: async (name: string) => mockKV.get(name)?.value ?? null,
  put: async (name: string, value: string, expiration?: number | null, log?: (m: string) => void) => {
    restored.set(name, { value, expiration: expiration ?? undefined, log });
  }
};

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aud042-'));
const outFile = path.join(tmpDir, 'backup.kvbackup');
const PASSPHRASE = 'test-passphrase-12ch-min';

const logs: string[] = [];
const backup = await createBackup({
  prefixes: ['a:', 'homework:'],
  binding: 'APP_DATA',
  passphrase: PASSPHRASE,
  outFile,
  transport: mockTransport,
  concurrency: 4,
  log: (m: string) => logs.push(m)
});

check(backup.count === 1500, `backup contains all 1500 keys (got ${backup.count})`);
check(backup.perPrefix['a:'] === 1200 && backup.perPrefix['homework:'] === 300, `per-prefix counts exact (${JSON.stringify(backup.perPrefix)})`);
check(fs.existsSync(outFile) && fs.statSync(outFile).size > 0, 'encrypted backup file written');
check(logs.some(l => l.includes('прочитано значений: 1500')), `progress logs emitted (${logs.filter(l => l.includes('прочитано')).length} lines)`);

// Page walk proof: 'a:' required 2 pages (1000 + 200).
let pagesWalked = 0;
await listKeys('a:', 'APP_DATA', { fetchPage: mockListPage, onPage: () => { pagesWalked++; } });
check(pagesWalked === 2, `'a:' walked ${pagesWalked} pages by cursor (was 1 truncated list before AUD-042)`);

console.log('\n--- 2. Backup payload integrity ---');
const payload = readBackup(outFile, PASSPHRASE);
check(payload.version === 1 && payload.entries.length === 1500, 'payload decrypts and holds 1500 entries');
const sample = payload.entries.find((e: any) => e.key === 'homework:ingt-310:item-42');
check(sample && sample.value === JSON.stringify({ id: 'hw-42', text: 'текст 42' }), 'cyrillic values survive the roundtrip');

console.log('\n--- 3. Dry-run restore writes nothing ---');
const restored = new Map<string, { value: string; expiration?: number; log?: (m: string) => void }>();
const dry = await restoreBackup({ file: outFile, passphrase: PASSPHRASE, transport: mockTransport, apply: false, log: () => {} });
check(dry.applied === false && dry.count === 1500, 'dry-run reports 1500 keys without writing');
check(restored.size === 0, 'dry-run wrote 0 keys');

console.log('\n--- 4. Restore: 1500/1500, TTL floor >= 1h, progress logs ---');
const restoreLogs: string[] = [];
const applied = await restoreBackup({
  file: outFile, passphrase: PASSPHRASE, transport: mockTransport, apply: true,
  concurrency: 4, log: (m: string) => restoreLogs.push(m)
});
check(applied.applied === true && applied.count === 1500, 'applied count = 1500');
check(restored.size === 1500, `mock KV received all 1500 keys (got ${restored.size})`);

let mismatches = 0;
for (const [name, meta] of restored) {
  if (meta.value !== mockKV.get(name)!.value) mismatches++;
}
check(mismatches === 0, 'every restored value is byte-identical to the source');

const nearExpiry = restored.get(Array.from(mockKV.keys()).find(n => n.endsWith(':5'))!);
check(
  typeof nearExpiry?.expiration === 'number' &&
  nearExpiry.expiration >= Math.floor(Date.now() / 1000) + MIN_RESTORE_TTL_SEC - 5,
  `near-expiry key raised to >= now+1h (${nearExpiry?.expiration})`
);
const permanentKey = restored.get('homework:ingt-310:item-1');
check(permanentKey?.expiration === undefined, 'key without TTL stays permanent (no TTL invented)');
check(restoreLogs.some(l => l.includes('TTL поднят')), 'TTL raise is logged');
check(restoreLogs.some(l => l.includes('записано ключей: 1500')), `restore progress logged (${restoreLogs.filter(l => l.includes('записано')).length} lines)`);

console.log('\n--- 5. OnlyPrefixes filter still exact ---');
restored.clear();
const partial = await restoreBackup({
  file: outFile, passphrase: PASSPHRASE, transport: mockTransport, apply: true, onlyPrefixes: ['homework:'], log: () => {}
});
check(partial.count === 300 && restored.size === 300, `--only homework: restores exactly 300 keys (got ${restored.size})`);

console.log('\n--- 6. Legacy single-page shape still parses ---');
// Old wrangler prints a bare array: listComplete inferred, no cursor.
const legacy = await listKeys('x:', 'APP_DATA', {
  fetchPage: async () => ({ keys: [{ name: 'x:1' }, { name: 'x:2' }], cursor: null, listComplete: true })
});
check(legacy.length === 2, 'object-shaped page parse works');
const legacyArray = await listKeys('x:', 'APP_DATA', {
  fetchPage: (async () => ({ keys: [{ name: 'x:1' }], cursor: null, listComplete: true })) as any
});
check(legacyArray.length === 1, 'short pages stop the walk');

fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n[${passed} checks passed]`);
if (process.exitCode !== 1) console.log('=== AUD-042 KV BACKUP SUITE PASSED ===');
