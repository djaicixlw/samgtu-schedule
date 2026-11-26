/**
 * The REAL scripts/nightly_sync.ts against a fake SamGTU portal (https.get is replaced; --dry-run writes nothing).
 * Covers what used to be silent: a partially failing portal wiped half of a group's schedule and the result
 * was committed and deployed.
 */
process.env.SYNC_REQUEST_DELAY_MS = '0';
process.env.SYNC_TODAY = '2026-10-20';
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.DEV_CHAT_ID;
delete process.env.TELEGRAM_DEV_CHAT_ID;
delete process.env.TELEGRAM_CHANNEL_ID;

import https from 'https';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { SAMGTU_GROUP_MAP } from '../utils/samgtuGroupMap';

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✓ [PASS] ${msg}`); }
  else { failed++; console.error(`  ❌ [FAIL] ${msg}`); process.exitCode = 1; }
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP_SYNC_STATE_PATH = path.join(os.tmpdir(), `samgtu-sync-state-${process.pid}-${Date.now()}.txt`);
const TMP_SEMESTER_PATH = path.join(os.tmpdir(), `samgtu-semester-${process.pid}-${Date.now()}.json`);
process.env.SYNC_STATE_PATH = TMP_SYNC_STATE_PATH;
process.env.SEMESTER_CONFIG_PATH = TMP_SEMESTER_PATH;

fs.writeFileSync(
  TMP_SEMESTER_PATH,
  JSON.stringify({
    semesterName: 'Осенний семестр 2026/2027',
    semesterStart: '2026-08-31',
    cycleWeeks: 4,
    sessionStart: '2027-01-01',
    sessionEnd: '2027-01-31',
    blocks: [
      { id: 1, name: 'Блок 1 (31.08 - 27.09)', start: '2026-08-31', end: '2026-09-27' },
      { id: 2, name: 'Блок 2 (28.09 - 25.10)', start: '2026-09-28', end: '2026-10-25' },
      { id: 3, name: 'Блок 3 (26.10 - 22.11)', start: '2026-10-26', end: '2026-11-22' },
      { id: 4, name: 'Блок 4 (23.11 - 31.12)', start: '2026-11-23', end: '2026-12-31' }
    ]
  }, null, 2),
  'utf-8'
);

function resetSyncStateToBlock2() {
  fs.writeFileSync(
    TMP_SYNC_STATE_PATH,
    JSON.stringify({ windowStart: 5, blockId: 2, updatedAt: '2026-10-25' }, null, 2) + '\n',
    'utf-8'
  );
}

function cleanupTempSyncState() {
  try {
    if (fs.existsSync(TMP_SYNC_STATE_PATH)) {
      fs.unlinkSync(TMP_SYNC_STATE_PATH);
    }
    if (fs.existsSync(TMP_SEMESTER_PATH)) {
      fs.unlinkSync(TMP_SEMESTER_PATH);
    }
  } catch {}
}

process.on('exit', cleanupTempSyncState);
process.on('SIGINT', () => { cleanupTempSyncState(); process.exit(1); });
process.on('uncaughtException', (err) => { cleanupTempSyncState(); console.error(err); process.exit(1); });

// Ensure base Block 2 state is active for tests 1-4
resetSyncStateToBlock2();

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

const realRequest = https.request;
(https as any).request = (options: any, cb: any) => {
  const req: any = new EventEmitter();
  req.write = () => {};
  req.end = () => {
    if (cb) {
      const res: any = new EventEmitter();
      res.statusCode = 200;
      setImmediate(() => {
        cb(res);
        res.emit('data', JSON.stringify({ ok: true }));
        res.emit('end');
      });
    }
  };
  req.setTimeout = () => {};
  req.destroy = () => {};
  return req;
};

const realLog = console.log, realWarn = console.warn, realErr = console.error, realArgv = process.argv, realExit = process.exitCode;
async function sync(args = ['node', 'nightly_sync.ts', '--dry-run']) {
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  process.argv = args;
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
  provider = (g, w) => officialWeek(shipped[g], w, g === 'ingt-310' ? (n, day, ls) => (n === 6 && (day === 'Понедельник' || day === 'Четверг') && ls.length ? [{ ...ls[0], location: 'Корпус № 9, 999' }, ...ls.slice(1)] : ls) : undefined);
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
  resetSyncStateToBlock2();
  const state = JSON.parse(fs.readFileSync(TMP_SYNC_STATE_PATH, 'utf-8'));
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

console.log('\n6. Auto-apply mode (--apply) handles on-demand architecture without errors');
{
  const constantsPath = path.join(ROOT, 'constants.ts');
  const originalConstants = fs.readFileSync(constantsPath, 'utf-8');
  const schedulesDir = path.join(ROOT, 'public/schedules');
  const originalFiles: Record<string, string> = {};
  for (const f of fs.readdirSync(schedulesDir)) {
    const p = path.join(schedulesDir, f);
    if (fs.statSync(p).isFile() && f !== '_sync-state.txt') originalFiles[f] = fs.readFileSync(p, 'utf-8');
  }

  provider = (g, w) => officialWeek(shipped[g], w, g === 'ingt-310' ? (n, day, ls) => (n === 6 && (day === 'Понедельник' || day === 'Четверг') && ls.length ? [{ ...ls[0], location: 'Корпус № 9, 999' }, ...ls.slice(1)] : ls) : undefined);
  try {
    const r = await sync(['node', 'nightly_sync.ts', '--apply']);
    assert(r.applied === true, '--apply successfully applies changes when changes exist');
    assert(Boolean(r.diffs['ingt-310']), 'ingt-310 change was detected and applied');
    assert(Object.keys(r.skipped).length === 0, 'no groups skipped during apply');
  } finally {
    fs.writeFileSync(constantsPath, originalConstants, 'utf-8');
    for (const [f, content] of Object.entries(originalFiles)) {
      fs.writeFileSync(path.join(schedulesDir, f), content, 'utf-8');
    }
    resetSyncStateToBlock2();
    provider = (g, w) => officialWeek(shipped[g], w);
  }
}

console.log('\n7. January session pause (2027-01-05) exits cleanly with 0 portal calls');
{
  const prevToday = process.env.SYNC_TODAY;
  let portalCalls = 0;
  provider = (g, w) => { portalCalls++; return officialWeek(shipped[g], w); };
  try {
    process.env.SYNC_TODAY = '2027-01-05';
    const r = await sync(['node', 'nightly_sync.ts', '--apply']);
    assert(r.applied === false, 'Session period nightly sync returns applied=false');
    assert(Object.keys(r.skipped).length === 0, 'Session period nightly sync produces no skipped-group alert spam');
    assert(portalCalls === 0, `Session period nightly sync makes 0 portal calls (got ${portalCalls})`);
  } finally {
    process.env.SYNC_TODAY = prevToday;
    provider = (g, w) => officialWeek(shipped[g], w);
  }
}

cleanupTempSyncState();
delete process.env.SYNC_STATE_PATH;
delete process.env.SEMESTER_CONFIG_PATH;
(https as any).get = realGet;
(https as any).request = realRequest;

console.log(`\nTOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
if (failed > 0) process.exitCode = 1;
