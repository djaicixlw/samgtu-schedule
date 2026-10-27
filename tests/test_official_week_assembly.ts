/**
 * The official-schedule converter used by the admin "Сверка"/"Синхронизировать" buttons must build the
 * same cycle the nightly sync builds: later weeks (5..8) win, ids keep the group's prefix, unknown bell
 * slots are ignored, teachers come from the group's assignments.
 */
import { convertOfficialSamgtuToWeekData, deriveLessonIdPrefix } from '../utils/samgtuParser';

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✓ [PASS] ${msg}`); }
  else { failed++; console.error(`  ❌ [FAIL] ${msg}`); process.exitCode = 1; }
}

const cell = (name: string) => ({ Cells: [{ CellName: name }] });
const day = (slots: Record<number, string>) => ({ at: Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, cell(v)])) });
const wd = (days: Record<number, any>) => ({ wd: Object.fromEntries(Object.entries(days).map(([k, v]) => [k, v])) });

const BJD = 'Безопасность жизнедеятельности';
const VESSELS = 'Конструирование и расчет сосудов';
const sept = (n: number) => wd({ 1: day({ 4: `${BJD}, практические занятия, аудитория 704 корпус № 7` }) });
const oct = (n: number) => wd({ 1: day({ 4: `${VESSELS}, практические занятия, аудитория 423 корпус № 9` }) });

const raw: Record<number, any> = {};
for (let w = 1; w <= 4; w++) raw[w] = sept(w);      // September block
for (let w = 5; w <= 8; w++) raw[w] = oct(w);       // current block
raw[2] = wd({ 2: day({ 1: `${BJD}, лекция` }) });   // Tuesday exists only in the early week of the cycle
raw[6] = wd({ 1: day({ 4: `${VESSELS}, практические занятия, аудитория 423 корпус № 9`, 7: 'Лишняя 7-я пара, лекция' }) });

console.log('\n=================================================');
console.log('   TEST SUITE: OFFICIAL WEEK ASSEMBLY');
console.log('=================================================');

const existing: any = { 1: [{ dayName: 'Понедельник', lessons: [{ id: '310-w1-mo-1', timeStart: '13:35', timeEnd: '15:10', subject: BJD, type: 'Практические занятия', location: '', teacher: 'Кривова Маргарита Андреевна' }] }], 2: [], 3: [], 4: [] };

console.log('\n1. Later weeks win');
{
  const { weekData } = convertOfficialSamgtuToWeekData('ingt-310', raw, {}, existing);
  const mon1 = weekData[1][0].lessons;
  assert(mon1.length === 1 && mon1[0].subject === VESSELS, 'Monday of cycle week 1 comes from official week 5 (the current block), not week 1');
  assert(weekData[2][0].lessons[0]?.subject === VESSELS, 'cycle week 2 Monday comes from official week 6');
  assert(weekData[2][1].lessons.length === 1 && weekData[2][1].lessons[0].subject === BJD, 'a day that only exists in the early week still uses the early data');
}

console.log('\n2. Ids, slots and teachers');
{
  const { weekData } = convertOfficialSamgtuToWeekData('ingt-310', raw, { [`${BJD}::Практические занятия`]: 'Сидоров Артем Александрович' }, existing);
  assert(deriveLessonIdPrefix(existing, 'ingt-310') === '310', 'the id prefix is taken from the existing schedule');
  assert(weekData[1][0].lessons[0].id === '310-w1-mo-1', 'ids keep the group prefix (notes, rooms and attendance stay attached)');
  assert(weekData[2][0].lessons.length === 1, 'the 7th slot (no bell) is ignored instead of being squeezed into 08:00');
  assert(weekData[2][0].lessons[0].timeStart === '13:35', 'times come from the bell schedule');
  const noMapping = convertOfficialSamgtuToWeekData('ingt-310', { ...raw, 5: wd({ 1: day({ 4: `${BJD}, практические занятия, аудитория 704 корпус № 7` }) }) }, { [`${BJD}::Практические занятия`]: 'Сидоров Артем Александрович' }, existing);
  assert(noMapping.weekData[1][0].lessons[0].teacher === 'Сидоров Артем Александрович', 'the group assignment (subject + lesson type) is applied');
  const fallback = convertOfficialSamgtuToWeekData('ingt-310', { ...raw, 5: wd({ 1: day({ 4: `${BJD}, практические занятия, аудитория 704 корпус № 7` }) }) }, {}, existing);
  assert(fallback.weekData[1][0].lessons[0].teacher === 'Кривова Маргарита Андреевна', 'without an assignment the teacher already in the schedule is kept');
}

console.log('\n3. Empty Monday of week 1');
{
  const r: Record<number, any> = { ...raw };
  r[5] = wd({}); r[1] = wd({});
  r[7] = wd({ 1: day({ 2: `${VESSELS}, практические занятия, аудитория 423 корпус № 9` }) });
  const { weekData } = convertOfficialSamgtuToWeekData('ingt-310', r, {}, existing);
  assert(weekData[1][0].lessons.length === 1 && weekData[1][0].lessons[0].timeStart === '09:45', 'an empty Monday of week 1 is taken from Monday of the cycle week 3 (week 7)');
}

console.log(`\nTOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
if (failed > 0) process.exitCode = 1;
