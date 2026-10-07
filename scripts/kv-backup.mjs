#!/usr/bin/env node
// Резервная копия Cloudflare KV (APP_DATA). Запускает владелец у себя на компьютере.
//   node scripts/kv-backup.mjs                  обычная копия (права, слоты, привязки, отметки, контент групп)
//   node scripts/kv-backup.mjs --legacy         + устаревшие ключи (только перед их очисткой!)
// Парольная фраза берётся из переменной KV_BACKUP_PASSPHRASE или запрашивается скрытым вводом.
import fs from 'node:fs';
import path from 'node:path';
import { createBackup, askHidden, DEFAULT_PREFIXES, LEGACY_PREFIXES } from './kv-backup-lib.mjs';

function parseArgs(argv) {
  const o = { legacy: false, binding: 'APP_DATA', out: null, prefixes: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--legacy') o.legacy = true;
    else if (a === '--binding') o.binding = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--prefixes') o.prefixes = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else { console.error(`Неизвестный параметр: ${a}`); process.exit(2); }
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const prefixes = o.prefixes || [...DEFAULT_PREFIXES, ...(o.legacy ? LEGACY_PREFIXES : [])];
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const outFile = o.out || path.join('backups', `kv-${stamp}${o.legacy ? '-legacy' : ''}.kvbackup`);

  try {
    const gi = fs.readFileSync('.gitignore', 'utf8');
    if (!/^\/?backups\/?$/m.test(gi) && !gi.includes('*.kvbackup')) {
      console.error('Остановка: в .gitignore нет строки "backups/". Добавьте её, чтобы копия не попала в git.');
      process.exit(3);
    }
  } catch { console.error('Остановка: не найден .gitignore. Запускайте из корня проекта.'); process.exit(3); }

  let pass = process.env.KV_BACKUP_PASSPHRASE;
  if (!pass) {
    pass = await askHidden('Парольная фраза для копии (не короче 12 знаков): ');
    const again = await askHidden('Повторите парольную фразу: ');
    if (pass !== again) { console.error('Фразы не совпали.'); process.exit(4); }
  }
  if (o.legacy) {
    console.log('ВНИМАНИЕ: в копию попадут устаревшие ключи, в том числе auth:* с сырыми Telegram ID.');
    console.log('Храните файл на своём компьютере и удалите его не позже чем через 7 дней после очистки.');
  }
  console.log(`Копирую префиксы: ${prefixes.join(' ')}`);
  const res = await createBackup({ prefixes, binding: o.binding, passphrase: pass, outFile, log: (m) => console.log(m) });
  console.log(`\nГотово. Ключей: ${res.count}`);
  console.log(`Файл: ${res.file}`);
  console.log(`SHA-256 файла: ${res.sha256}`);
  console.log('Значения ключей не выводились. Файл зашифрован. Не отправляйте его в git и в Telegram.');
}

main().catch((e) => { console.error('Ошибка:', e.message); process.exit(1); });
