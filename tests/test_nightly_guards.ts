/**
 * The REAL scripts/nightly_sync.ts against a fake SamGTU portal (https.get is replaced; --dry-run writes nothing).
 * Covers what used to be silent: a partially failing portal wiped half of a group's schedule and the result
 * was committed and deployed.
 */
process.env.SYNC_REQUEST_DELAY_MS = '0';
// 20 October is block 2 (portal weeks 5..8), the same window the shipped data was built from (public/schedules/_sync-state.txt)
process.env.SYNC_TODAY = '2026-10-20';
import https from 'https';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SAMGTU_GROUP_MAP } from '../utils/samgtuGroupMap';

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✓ [PASS] ${msg}`); }
  else { failed++; console.error(`  ❌ [FAIL] ${msg}`); process.exitCode = 1; }
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const syncStatePath = path.join(ROOT, 'public/schedules/_sync-state.txt');
const originalSyncState = fs.existsSync(syncStatePath) ? fs.readFileSync(syncStatePath, 'utf-8') : null;
fs.writeFileSync(syncStatePath, JSON.stringify({ windowStart: 5, blockId: 2, updatedAt: '2026-10-25' }, null, 2) + '\n', 'utf-8');
const SLOT: Record<string, number> = { '08:00': 1, '09:45': 2, '11:50': 3, '13:35': 4, '15:40': 5, '17:25': 6 };
const TYPE_WORD: Record<string, string> = { 'Лекции': 'лекция', 'Практические занятия': 'практические занятия', 'Лабораторные работы': 'лабораторные работы' };
const DAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
const shipped: Record<string, any> = {};
for (const gid of Object.keys(SAMGTU_GROUP_MAP)) {
  const p = path.join(ROOT, 'public/schedules', `${gid}.json`);
  if (fs.existsSync(p)) shipped[gid] = JSON.parse(fs.readFileSync(p, 'utf-8'));
}
const cellName = (l: any) => {
  const m = /^Корпус № (\S+), (.+)$/.exec(l.location || '');
  return `<b>${l.subject}, ${TYPE_WORD[l.type] || 'практические занятия'}</b><br>${m ? `аудитория ${m[2]} корпус № ${m[1]}` : (l.location || '')}`;
};
type Mut = (n: number, dayName: string, lessons: any[]) => any[];
function officialWeek(sched: any, n: number, mutate?: Mut) {
  const cw = ((n - 1) % 4) + 1; const wd: any = {};
  for (const day of (sched[cw] || [])) {
    const idx = DAYS.indexOf(day.dayName) + 1;
    const lessons = mutate ? mutate(n, day.dayName, day.lessons.map((x: any) => ({ ...x }))) : day.lessons;
    if (!lessons.length) continue;
    const at: any = {};
    for (const l of lessons) (at[SLOT[l.timeStart]] = at[SLOT[l.timeStart]] || { Cells: [] }).Cells.push({ CellName: cellName(l) });
    wd[String(idx)] = { at };
  }
  return { wd };
}

type Provider = (gid: string, week: number) => any;
const byPortalId = new Map(Object.entries(SAMGTU_GROUP_MAP).map(([gid, c]) => [String(c.samgtuGroupId), gid]));
let provider: Provider = (gid, w) => officialWeek(shipped[gid], w);
const realGet = (https as any).get;
(https as any).get = (url: string, cb: any) => {
  const u = new URL(url);
  const gid = byPortalId.get(u.searchParams.get('GroupID') || '')!; const week = Number(u.searchParams.get('WeekNumber'));
  const req: any = new EventEmitter(); req.setTimeout = () => {}; req.destroy = () => {};
  const out = provider(gid, week);
  setImmediate(() => {
    if (out === 'ERROR') { req.emit('error', new Error('ECONNRESET')); return; }
    const res: any = new EventEmitter(); res.statusCode = 200; cb(res);
    res.emit('data', out === 'HTML' ? '<html>maintenance</html>' : JSON.stringify(out)); res.emit('end');
  });
  return req;
};

const realLog = console.log, realWarn = console.warn, realErr = console.error, realArgv = process.argv, realExit = process.exitCode;
async function sync() {
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  process.argv = ['node', 'nightly_sync.ts', '--dry-run'];
  try {
    const mod = await import('../scripts/nightly_sync');
    return await mod.runNightlySync();
  } finally { console.log = realLog; console.warn = realWarn; console.error = realErr; process.argv = realArgv; process.exitCode = realExit; }
}

console.log('\n=================================================');
console.log('   TEST SUITE: NIGHTLY SYNC GUARDS');
console.log('=================================================');

console.log('\n1. Steady state');
{
  const r = await sync();
  assert(Object.keys(shipped).length === Object.keys(SAMGTU_GROUP_MAP).length, 'every mapped group has a shipped schedule to build the fake portal from');
  assert(Object.keys(r.diffs).length === 0 && Object.keys(r.skipped).length === 0, 'an unchanged portal produces no differences and skips nothing');
}

console.log('\n2. Real change at the portal');
{
  provider = (g, w) => officialWeek(shipped[g], w, g === 'ingt-310' ? (n, day, ls) => (n === 6 && day === 'Среда' && ls.length ? [{ ...ls[0], location: 'Корпус № 9, 999' }, ...ls.slice(1)] : ls) : undefined);
  const r = await sync();
  assert(Object.keys(r.diffs).join() === 'ingt-310', `only the changed group is reported (${Object.keys(r.diffs).join()})`);
  provider = (g, w) => officialWeek(shipped[g], w);
}

console.log('\n3. Partial portal failure must not be applied');
{
  provider = (g, w) => (g === 'ingt-310' && [7, 8].includes(w)) ? {} : officialWeek(shipped[g], w);
  const r = await sync();
  assert(Boolean(r.skipped['ingt-310']) && /7, 8/.test(r.skipped['ingt-310']), `the group is skipped and the missing weeks are named (${r.skipped['ingt-310']})`);
  assert(!r.diffs['ingt-310'], 'no half-empty schedule is produced for the group');
  assert(Object.keys(r.skipped).length === 1, 'other groups are unaffected');
}

console.log('\n4. Maintenance page / network errors / shrink');
{
  provider = (g, w) => (g === 'ingt-310' ? 'HTML' : officialWeek(shipped[g], w));
  let r = await sync();
  assert(Boolean(r.skipped['ingt-310']), 'an HTML maintenance page instead of JSON skips the group');
  provider = (g, w) => (g === 'ingt-310' && w % 2 === 0 ? 'ERROR' : officialWeek(shipped[g], w));
  r = await sync();
  assert(Boolean(r.skipped['ingt-310']), 'intermittent network errors skip the group instead of rebuilding it from the remaining weeks');
  provider = (g, w) => officialWeek(shipped[g], w, g === 'ingt-310' ? (n, day, ls) => (day === 'Суббота' || n % 2 === 0 ? [] : ls.slice(0, 1)) : undefined);
  r = await sync();
  assert(Boolean(r.skipped['ingt-310']) && /меньше/.test(r.skipped['ingt-310']), `a portal answer with far fewer lessons is treated as truncated (${r.skipped['ingt-310']})`);
}

console.log('\n5. A new block: today is in block 3 (portal weeks 9..12)');
{
  const state = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/schedules/_sync-state.txt'), 'utf-8'));
  assert(state.windowStart === 5, 'the shipped data is marked as built from portal week 5 (block 2)');
  process.env.SYNC_TODAY = '2026-10-28';
  const asked: number[] = [];
  provider = (g, w) => { if (g === 'ingt-310') asked.push(w); return officialWeek(shipped[g], w); };
  let r = await sync();
  assert([...new Set(asked)].sort((a, b) => a - b).join() === '9,10,11,12', `the sync asks the portal for weeks 9..12 (asked ${[...new Set(asked)].sort((a, b) => a - b).join()})`);
  assert(Object.keys(r.skipped).length === 0, 'a complete answer for the new block is accepted');

  provider = (g, w) => officialWeek(shipped[g], w, g === 'ingt-310' ? (n, day, ls) => (day === 'Понедельник' ? ls.slice(0, 1) : []) : undefined);
  r = await sync();
  assert(!r.skipped['ingt-310'] && Boolean(r.diffs['ingt-310']), 'right after a block change a much smaller schedule is accepted (the new block may genuinely differ)');

  provider = (g, w) => (g === 'ingt-310' ? { wd: {} } : officialWeek(shipped[g], w));
  r = await sync();
  assert(Boolean(r.skipped['ingt-310']), 'but a completely empty answer is still refused');
  process.env.SYNC_TODAY = '2026-10-20';
}

(https as any).get = realGet;
console.log(`\nTOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
if (failed > 0) process.exitCode = 1;