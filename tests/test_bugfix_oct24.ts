/**
 * Regression tests for the three bug reports of 24.10.2026:
 *  1. "Сверка": wrong portal weeks, and "0 pairs in the app" reported as 62 differences
 *  2. A teacher assigned in "Преподаватели" did not apply to a pair (frozen copy in the pair's override)
 */
import assert from 'node:assert';
import {
  currentOfficialWeek, officialWeeksForCycle, weekFallbackChain, cycleOf, officialWeekHasLessons, OFFICIAL_MAX_WEEK
} from '../utils/officialWeeks';
import { compareWithOfficial, countLessons } from '../utils/scheduleCompare';
import { clearFrozenTeachers, teacherWithoutOverride, buildLessonIndex, countPinnedTeachers, unpinTeachers, LessonRef } from '../utils/teacherOverrides';

let passed = 0;
const ok = (cond: boolean, msg: string) => { assert.ok(cond, msg); passed++; console.log(`  ✓ [PASS] ${msg}`); };
console.log('\n=== TEST SUITE: bug reports 24.10.2026 ===');

console.log('\n1. Which portal weeks are compared');
const START = '2026-08-31';
ok(currentOfficialWeek('2026-08-31', START) === 1, 'the first day of the semester is week 1');
ok(currentOfficialWeek('2026-09-06', START) === 1 && currentOfficialWeek('2026-09-07', START) === 2, 'Sunday still belongs to the week, Monday starts the next one');
ok(currentOfficialWeek('2026-10-24', START) === 8, 'Saturday 24 Oct 2026 is official week 8 (the screenshot shows "Нед. 4 ★")');
ok(cycleOf(8) === 4 && cycleOf(9) === 1 && cycleOf(12) === 4, 'the cycle position of week 8 is 4, of week 9 is 1');
ok(JSON.stringify(officialWeeksForCycle('2026-10-24', START)) === JSON.stringify({ 1: 9, 2: 10, 3: 11, 4: 8 }),
  'on 24 Oct the cycle weeks 1..4 map to official weeks 9, 10, 11, 8 (NOT 1..4 as before)');
ok(JSON.stringify(officialWeeksForCycle('2026-10-26', START)) === JSON.stringify({ 1: 9, 2: 10, 3: 11, 4: 12 }), 'on Monday 26 Oct the window moves to 9..12');
ok(JSON.stringify(officialWeeksForCycle('2026-08-20', START)) === JSON.stringify({ 1: 1, 2: 2, 3: 3, 4: 4 }), 'before the semester the window is 1..4');
for (const d of ['2026-09-01', '2026-10-24', '2026-12-31', '2027-01-20']) {
  const w = officialWeeksForCycle(d, START); const cur = currentOfficialWeek(d, START);
  ok(Object.values(w).every(x => x >= cur && x <= cur + 3) && new Set(Object.values(w).map(cycleOf)).size === 4, `every cycle position has a week inside [now, now+3] (${d})`);
}
ok(JSON.stringify(weekFallbackChain(11)) === '[11,7,3]' && JSON.stringify(weekFallbackChain(2)) === '[2]', 'fallback goes one and two cycles back and never below 1');
ok(weekFallbackChain(33).every(w => w <= OFFICIAL_MAX_WEEK) && weekFallbackChain(33)[0] === 29, 'weeks above the proxy limit (30) are skipped');
ok(officialWeekHasLessons({ wd: { '1': { at: { '2': { Cells: [{}] } } } } }) && !officialWeekHasLessons({ wd: { '1': { at: {} } } }) && !officialWeekHasLessons(null),
  'an unpublished (empty) portal week is recognised, so the fallback to the previous cycle kicks in');

console.log('\n2. Comparison never reports "62 differences" for an empty app');
const lesson = (timeStart: string, subject: string, location = '') => ({ timeStart, subject, location });
const official: any = { 1: [{ dayName: 'Понедельник', lessons: [lesson('08:00', 'Гидравлика'), lesson('09:45', 'Физика')] }], 2: [], 3: [], 4: [] };
const none = compareWithOfficial(undefined, official);
ok(none.status === 'no-local-data' && none.diffs.length === 0 && none.currentTotal === 0 && none.officialTotal === 2, 'no schedule loaded -> "no-local-data", zero fake differences');
ok(compareWithOfficial({ 1: [], 2: [], 3: [], 4: [] } as any, official).status === 'no-local-data', 'an empty week structure counts as not loaded too');
const same: any = { 1: [{ dayName: 'Понедельник', lessons: [lesson('08:00', 'Гидравлика'), lesson('09:45', 'Физика')] }] };
ok(compareWithOfficial(same, official).status === 'match', 'identical schedules match');
const changed: any = { 1: [{ dayName: 'Понедельник', lessons: [lesson('08:00', 'Гидравлика'), lesson('11:50', 'БЖД')] }] };
const diff = compareWithOfficial(changed, official);
ok(diff.status === 'diff' && diff.diffs.length === 2 && countLessons(changed) === 2, 'a real difference is still reported (both directions)');
const loc = compareWithOfficial({ 1: [{ dayName: 'Понедельник', lessons: [lesson('08:00', 'Гидравлика', 'Корпус № 1, 1'), lesson('09:45', 'Физика')] }] } as any,
  { 1: [{ dayName: 'Понедельник', lessons: [lesson('08:00', 'гидравлика', 'ауд. 1 корпус 1'), lesson('09:45', 'Физика')] }] } as any);
ok(loc.status === 'match', 'case, spaces and the way a room is written do not count as differences');

console.log('\n3. Frozen teacher overrides');
const bjd = (id: string, type: string, teacher: string): LessonRef => ({ id, subject: 'Безопасность жизнедеятельности', type, teacher });
const lessons = new Map<string, LessonRef>([
  ['p1', bjd('p1', 'Практические занятия', 'Кривова Маргарита Андреевна')],
  ['p2', bjd('p2', 'Практические занятия', 'Кривова Маргарита Андреевна')],
  ['l1', bjd('l1', 'Лекции', 'Сорокина Людмила Владимировна')]
]);
const prevTeachers = {};
const nextTeachers = { 'Безопасность жизнедеятельности::Практические занятия': 'Сидоров Артем Александрович' };
// p1 was edited (note) earlier: its override froze the official teacher. p2 has a deliberate pin. l1 is a frozen copy of a lecture.
const overrides: Record<string, any> = {
  p1: { teacher: 'Кривова Маргарита Андреевна', note: 'принести тетрадь' },
  p2: { teacher: 'Иванова Ирина Ивановна' },
  l1: { teacher: 'Сорокина Людмила Владимировна' }
};
const res = clearFrozenTeachers(overrides, lessons, prevTeachers, nextTeachers);
ok(res.cleared.join() === 'p1', 'only the frozen copy on the practical pair is cleared (the lecture is unaffected, nothing changes for it)');
ok(res.overrides.p1.teacher === undefined && res.overrides.p1.note === 'принести тетрадь', "the pair keeps its note, only the frozen teacher is dropped");
ok(res.overrides.p2.teacher === 'Иванова Ирина Ивановна', 'a deliberate per-pair teacher is kept');
ok(res.overrides.l1.teacher === 'Сорокина Людмила Владимировна', 'overrides that would not change anything are kept');
ok(teacherWithoutOverride(lessons.get('p1')!, nextTeachers) === 'Сидоров Артем Александрович', 'after the cleanup the pair resolves to the assigned teacher (as in the teachers dialog)');

const onlyTeacher = clearFrozenTeachers({ p1: { teacher: 'Кривова Маргарита Андреевна' } }, lessons, prevTeachers, nextTeachers);
ok(!('p1' in onlyTeacher.overrides), 'an override that had nothing but the frozen teacher disappears completely');

// subject-wide assignment replaces a previous type-level one
const prev2 = { 'Безопасность жизнедеятельности::Практические занятия': 'Сидоров Артем Александрович' };
const next2 = { ...prev2, 'Безопасность жизнедеятельности::Практические занятия': 'Петров Петр Петрович' };
const r2 = clearFrozenTeachers({ p1: { teacher: 'Сидоров Артем Александрович' } }, lessons, prev2, next2);
ok(r2.cleared.join() === 'p1', 'a copy of the PREVIOUS assignment is cleared when the assignment changes again');
const r3 = clearFrozenTeachers({ p1: { teacher: 'Сидоров Артем Александрович' } }, lessons, prev2, prev2);
ok(r3.cleared.length === 0, 'nothing is touched when the assignment did not change');
const r4 = clearFrozenTeachers({ ghost: { teacher: 'X' } } as any, lessons, prevTeachers, nextTeachers);
ok(r4.overrides.ghost.teacher === 'X', 'an override for a lesson that is not in the schedule is left alone');


console.log('\n4. "Reset pair" pins (official teacher) are visible and can be unpinned explicitly');
const pinned: Record<string, any> = {
  p1: { teacher: 'Кривова Маргарита Андреевна' },              // reset pin = official, type assignment says Сидоров
  p2: { teacher: 'Кривова Маргарита Андреевна', note: 'x' },
  l1: { teacher: 'Сорокина Людмила Владимировна' }              // equals what it would show anyway
};
const key = 'Безопасность жизнедеятельности::Практические занятия';
ok(JSON.stringify(countPinnedTeachers(pinned, lessons, nextTeachers)) === JSON.stringify({ [key]: 2 }), 'the dialog can show "2 pairs are pinned" for the practicals (and nothing for the lecture)');
const kept = clearFrozenTeachers(pinned, lessons, prevTeachers, nextTeachers);
ok(!('p1' in kept.overrides), 'a copy of the previous resolved teacher is still cleared automatically when the assignment changes');
const un = unpinTeachers({ p1: { teacher: 'Иванова Ирина Ивановна' }, p2: { teacher: 'Иванова Ирина Ивановна', note: 'x' }, l1: { teacher: 'Сорокина Людмила Владимировна' } }, lessons, key);
ok(un.cleared.sort().join() === 'p1,p2' && un.overrides.p2.note === 'x' && !('p1' in un.overrides) && un.overrides.l1.teacher === 'Сорокина Людмила Владимировна',
  'the explicit "Снять" removes the pin from every pair of that subject/type only, notes stay');
const idx = buildLessonIndex({ '1': [{ lessons: [bjd('a', 'Лекции', 'T')] }], '2': [{ lessons: [bjd('b', 'Лекции', 'T')] }] } as any);
ok(idx.size === 2 && idx.get('b')?.id === 'b' && buildLessonIndex(undefined).size === 0, 'the lesson index covers all weeks and tolerates a missing schedule');

console.log(`\n=== RESULT: ${passed} passed ===`);
