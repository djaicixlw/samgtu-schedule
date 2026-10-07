#!/usr/bin/env node
// Восстановление KV из копии. По умолчанию ПРОБНЫЙ запуск: ничего не записывает.
//   node scripts/kv-restore.mjs --file backups/kv-....kvbackup            пробный запуск (покажет счётчики)
//   node scripts/kv-restore.mjs --file ... --apply                        реальная запись (спросит подтверждение)
//   node scripts/kv-restore.mjs --file ... --apply --only g:,u:           только указанные префиксы
import readline from 'node:readline';
import { restoreBackup, askHidden } from './kv-backup-lib.mjs';

function parseArgs(argv) {
  const o = { file: null, apply: false, binding: 'APP_DATA', only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') o.file = argv[++i];
    else if (a === '--apply') o.apply = true;
    else if (a === '--binding') o.binding = argv[++i];
    else if (a === '--only') o.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else { console.error(`Неизвестный параметр: ${a}`); process.exit(2); }
  }
  if (!o.file) { console.error('Укажите --file <путь к .kvbackup>'); process.exit(2); }
  return o;
}

function ask(q) {
  return new Promise((r) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); r(a); }); });
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const pass = process.env.KV_BACKUP_PASSPHRASE || (await askHidden('Парольная фраза от копии: '));
  const dry = await restoreBackup({ file: o.file, passphrase: pass, binding: o.binding, apply: false, onlyPrefixes: o.only, log: (m) => console.log(m) });
  console.log('Что будет записано:', JSON.stringify(dry.perPrefix));
  if (!o.apply) { console.log('Пробный запуск: ничего не записано. Для записи добавьте --apply.'); return; }
  console.log('ВНИМАНИЕ: существующие ключи с теми же именами будут ПЕРЕЗАПИСАНЫ значениями из копии.');
  const confirm = process.env.KV_RESTORE_CONFIRM || (await ask('Для подтверждения введите слово RESTORE: '));
  if (confirm !== 'RESTORE') { console.log('Отменено.'); return; }
  const res = await restoreBackup({ file: o.file, passphrase: pass, binding: o.binding, apply: true, onlyPrefixes: o.only });
  console.log(`Записано ключей: ${res.count}`);
}

main().catch((e) => { console.error('Ошибка:', e.message); process.exit(1); });
