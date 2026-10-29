/**
 * Replays REAL portal answers captured with scripts/capture_official_sample.ts (tests/fixtures/official/<group>/week1..8.json).
 * Without fixtures the test is skipped (no failure). With fixtures it checks the real feed against the parser.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { convertOfficialSamgtuToWeekData } from '../utils/samgtuParser';
import { parseCellName } from '../utils/officialSchedule';

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✓ [PASS] ${msg}`); }
  else { failed++; console.error(`  ❌ [FAIL] ${msg}`); process.exitCode = 1; }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(root, 'tests/fixtures/official');
const groups = fs.existsSync(base) ? fs.readdirSync(base).filter(d => fs.readdirSync(path.join(base, d)).some(f => /^week\d+\.json$/.test(f))) : [];

console.log('\n=================================================');
console.log('   TEST SUITE: REAL PORTAL FIXTURES');
console.log('=================================================');

if (groups.length === 0) {
  console.log('  (skipped: no fixtures. Capture them with: npx tsx scripts/capture_official_sample.ts ingt-310)');
}
const KNOWN_TYPES = new Set(['Лекции', 'Практические занятия', 'Лабораторные работы']);
for (const gid of groups) {
  console.log(`\nGroup ${gid}`);
  const raw: Record<number, any> = {};
  for (const f of fs.readdirSync(path.join(base, gid))) {
    const m = /^week(\d+)\.json$/.exec(f);
    if (m) raw[Number(m[1])] = JSON.parse(fs.readFileSync(path.join(base, gid, f), 'utf-8').replace(/^\uFEFF/, '').trim());
  }
  const weekNumbers = Object.keys(raw).map(Number).sort((a, b) => a - b);
  console.log(`  weeks: ${weekNumbers.join(', ')}`);
  assert(Object.values(raw).every(r => r && typeof r === 'object' && r.wd && typeof r.wd === 'object'), 'every week has a "wd" object');

  const cellList: any[] = [];
  for (const wk of Object.values<any>(raw)) for (const day of Object.values<any>(wk.wd)) for (const slot of Object.values<any>(day.at || {})) for (const c of slot.Cells || []) cellList.push(c);
  assert(cellList.length > 0, `the feed contains lessons (${cellList.length} cells)`);
  assert(cellList.every(c => typeof c.CellName === 'string' && c.CellName.trim().length > 0), 'every cell has a non-empty CellName');
  const parsed = cellList.map(c => parseCellName(c.CellName));
  assert(parsed.every(p => p.subject.length > 2), 'every cell has a subject');
  assert(parsed.every(p => KNOWN_TYPES.has(p.type)), `every cell has a known type (${[...new Set(parsed.map(p => p.type))].join(', ')})`);
  const noRoom = parsed.filter(p => !p.location).length;
  assert(noRoom <= parsed.length * 0.1, `at most 10% of cells have no room (${noRoom}/${parsed.length})`);
  const unparsedRoom = parsed.filter(p => /корпус/i.test(p.location) && !/^Корпус № [\p{L}\d]+, /u.test(p.location));
  assert(unparsedRoom.length === 0, `no room is left as raw text (${unparsedRoom.map(p => p.location).slice(0, 2).join(' | ')})`);
  const extraKeys = new Set(cellList.flatMap(c => Object.keys(c)).filter(k => k !== 'CellName'));
  console.log(`  info: cell fields besides CellName: ${[...extraKeys].join(', ') || '(none)'}`);

  // a full block (4 consecutive portal weeks starting at 4k+1) can be turned into the cycle
  const start = weekNumbers.find(n => (n - 1) % 4 === 0 && [1, 2, 3].every(i => raw[n + i]));
  if (start !== undefined) {
    const shippedPath = path.join(root, 'public/schedules', `${gid}.json`);
    const existing = fs.existsSync(shippedPath) ? JSON.parse(fs.readFileSync(shippedPath, 'utf-8')) : undefined;
    const { weekData, totalLessons } = convertOfficialSamgtuToWeekData(gid, raw, {}, existing, start);
    const lessons = [1, 2, 3, 4].flatMap(w => (weekData as any)[w].flatMap((d: any) => d.lessons));
    assert(totalLessons > 0 && totalLessons === lessons.length, `weeks ${start}..${start + 3} become a cycle of ${totalLessons} lessons`);
    assert(new Set(lessons.map((l: any) => l.id)).size === lessons.length, 'lesson ids are unique');
    if (existing) {
      const key = (l: any) => `${l.timeStart}|${l.subject}|${l.type}`;
      const mine = new Set([1, 2, 3, 4].flatMap(w => existing[w].flatMap((d: any) => d.lessons.map(key))));
      const theirs = new Set(lessons.map(key));
      console.log(`  info: against the shipped schedule: ${[...theirs].filter(k => !mine.has(k)).length} kinds of lessons only in the feed, ${[...mine].filter(k => !theirs.has(k)).length} only in the app`);
    }
  } else {
    console.log('  info: fewer than 4 consecutive block weeks captured, the cycle check is skipped');
  }
}

console.log(`\nTOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
if (failed > 0) process.exitCode = 1;