/**
 * AUD-033: per-week guard of nightly_sync (mock official-API source).
 *
 * Defect: a PARTIAL API failure (one week lost/empty while others parsed fine)
 * passed the old group-level guard and was written as an EMPTY week over the
 * existing non-empty week — a silent data wipe. The guard is now per-week:
 *   - empty API week over non-empty existing week -> NOT written (warning);
 *   - identical week -> not rewritten (write only when really changed);
 *   - changed week -> written.
 *
 * The test drives the same exported functions the CLI path uses
 * (buildOfficialWeeks -> applyPerWeekGuards -> groupHasChangedWeek) with a mock
 * source in the official JSON shape (wd/at/Cells).
 */
import assert from 'node:assert';
import {
  buildOfficialWeeks,
  resolveWeekWrite,
  applyPerWeekGuards,
  groupHasChangedWeek,
  countWeekLessons,
  weeksEqual,
  WeekWriteDecision
} from '../scripts/nightly_sync';
import { DaySchedule } from '../types';

let passed = 0;
function check(cond: any, label: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { console.error(`  ✗ FAIL ${label}`); process.exitCode = 1; }
}

// ---------------------------------------------------------------------------
// Mock source in the official API shape
// ---------------------------------------------------------------------------

const cell = (subject: string) => ({ CellName: `<b>${subject} (практические занятия)</b><br>аудитория 301 корпус № 1` });
const day = (slots: number[][], subjects: string[][]) => {
  const at: Record<string, any> = {};
  slots.forEach((slotList, i) => {
    at[String(slotList[0])] = { Cells: subjects[i].map(cell) };
  });
  return { at };
};
/** Official week payload: wd['1'..'6'] (Mon..Sat), Sunday absent. */
const officialWeek = (perDay: Array<any | null>) => {
  const wd: Record<string, any> = {};
  for (let d = 1; d <= 6; d++) {
    if (perDay[d - 1]) wd[String(d)] = perDay[d - 1];
  }
  return { wd };
};

const existingWeek3: DaySchedule[] = [
  { dayName: 'Понедельник', lessons: [{ id: 'ingt209-w3-mo-1', timeStart: '08:00', timeEnd: '09:35', subject: 'Физика', type: 'Практические занятия', location: 'Корпус № 1, 320', teacher: '' }] },
  { dayName: 'Вторник', lessons: [{ id: 'ingt209-w3-tu-1', timeStart: '11:50', timeEnd: '13:25', subject: 'Математика', type: 'Практические занятия', location: 'Корпус № 1, 320', teacher: 'Иванов' }] },
  { dayName: 'Среда', lessons: [] },
  { dayName: 'Четверг', lessons: [] },
  { dayName: 'Пятница', lessons: [] },
  { dayName: 'Суббота', lessons: [] }
];

console.log('\n--- 1. buildOfficialWeeks on a mock source ---');
// Weeks 1 and 2 have data; week 3 FETCH FAILED (absent from raw maps -> empty);
// week 4 has data. This is exactly what the fetch loop produces on a partial outage.
const rawEarly: Record<number, any> = {
  1: officialWeek([day([[1]], [['Математика']]), day([[2]], [['Физика']]), null, null, null, null]),
  2: officialWeek([day([[1]], [['Химия']]), null, null, null, null, null]),
  4: officialWeek([day([[3]], [['История']]), null, null, null, null, null])
};
const rawLate: Record<number, any> = {
  1: officialWeek([day([[1]], [['Математика']]), day([[2]], [['Физика']]), null, null, null, null]),
  2: officialWeek([day([[1]], [['Химия']]), null, null, null, null, null]),
  4: officialWeek([day([[3]], [['История']]), null, null, null, null, null])
};

const existingGroupSchedule: Record<number, DaySchedule[]> = {
  1: [], 2: [],
  3: existingWeek3,
  4: []
};

const built = buildOfficialWeeks({ rawEarly, rawLate, prefix: 'ingt209', groupId: 'ingt-209', existingGroupSchedule });
check(countWeekLessons(built.weeks[1]) === 2, 'week 1 parsed 2 lessons from mock source');
check(countWeekLessons(built.weeks[2]) === 1, 'week 2 parsed 1 lesson');
check(countWeekLessons(built.weeks[3]) === 0, 'week 3 (fetch failed) parsed 0 lessons — the dangerous case');
check(countWeekLessons(built.weeks[4]) === 1, 'week 4 parsed 1 lesson');
check(built.weeks[1][0].lessons[0].id === 'ingt209-w1-mo-1', 'lesson ids follow the production scheme');

console.log('\n--- 2. resolveWeekWrite decisions ---');
const guardDecision = resolveWeekWrite(built.weeks[3], existingWeek3);
check(guardDecision.reason === 'empty-api-guard' && guardDecision.write === false, 'empty API week over non-empty existing -> guard, no write');
check(guardDecision.apiLessons === 0 && guardDecision.existingLessons === 2, 'decision reports both lesson counts');

const okDecision = resolveWeekWrite(built.weeks[1], []);
check(okDecision.reason === 'ok' && okDecision.write === true, 'new data over empty week -> write');

const sameWeek = JSON.parse(JSON.stringify(existingWeek3));
const unchangedDecision = resolveWeekWrite(sameWeek, existingWeek3);
check(unchangedDecision.reason === 'unchanged' && unchangedDecision.write === false, 'identical week -> no rewrite');
check(weeksEqual(sameWeek, existingWeek3), 'weeksEqual true for identical content');
check(!weeksEqual(existingWeek3, [existingWeek3[0]]), 'weeksEqual false for different content');

console.log('\n--- 3. applyPerWeekGuards: partial outage keeps the existing week ---');
const guarded = applyPerWeekGuards(built.weeks, existingGroupSchedule);
check(guarded.decisions[3]?.reason === 'empty-api-guard', 'week 3 decision recorded as empty-api-guard');
check(
  JSON.stringify(guarded.weeks[3]) === JSON.stringify(existingWeek3),
  'week 3 in the output IS the existing schedule (nothing wiped)'
);
check(countWeekLessons(guarded.weeks[3]) === 2, 'week 3 kept its 2 lessons');
check(guarded.warnings.length === 1 && guarded.warnings[0].includes('Неделя 3'), 'warning logged for week 3');
check(guarded.decisions[1]?.write === true && guarded.decisions[2]?.write === true && guarded.decisions[4]?.write === true, 'healthy weeks still write');

console.log('\n--- 4. groupHasChangedWeek (write only when really changed) ---');
check(groupHasChangedWeek('ingt-209', { 'ingt-209': guarded.decisions }), 'group with changed weeks -> write');
const noChangeDecisions: Record<number, WeekWriteDecision> = {
  1: { write: false, reason: 'unchanged', apiLessons: 2, existingLessons: 2 },
  2: { write: false, reason: 'unchanged', apiLessons: 1, existingLessons: 1 },
  3: { write: false, reason: 'unchanged', apiLessons: 2, existingLessons: 2 },
  4: { write: false, reason: 'unchanged', apiLessons: 1, existingLessons: 1 }
};
check(!groupHasChangedWeek('g', { g: noChangeDecisions }), 'group with all-unchanged weeks -> no chunk rewrite');
check(groupHasChangedWeek('g', {}) === true, 'no guard info -> legacy behavior (write)');

console.log('\n--- 5. Empty API over empty existing stays writable-but-harmless ---');
const emptyOverEmpty = resolveWeekWrite(built.weeks[3], []);
check(emptyOverEmpty.reason === 'ok' || emptyOverEmpty.reason === 'unchanged', 'no guard triggered when both sides empty');

console.log(`\n[${passed} checks passed]`);
if (process.exitCode !== 1) console.log('=== AUD-033 NIGHTLY PER-WEEK GUARD SUITE PASSED ===');
