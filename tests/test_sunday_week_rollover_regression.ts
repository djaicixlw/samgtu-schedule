import assert from 'assert';
import {
  getSemesterWeek,
  getDayName,
  getDayCalendarDate,
  getWeekDateRange,
  getDayISODate,
  getSamaraDate,
  samaraISO
} from '../utils/samaraDate';
import * as att from '../attendance';

console.log('================================================================');
console.log('   REGRESSION TEST: SUNDAY NIGHT (23:08) VS MONDAY ROLLOVER     ');
console.log('================================================================\n');

// 1. Instant on Sunday 2026-09-27 at 23:08:40 Samara time (19:08:40 UTC)
const sunInstant = new Date('2026-09-27T19:08:40Z');
const sunSamara = getSamaraDate(sunInstant);

assert.strictEqual(samaraISO(sunInstant), '2026-09-27');
assert.strictEqual(samaraISO(sunSamara), '2026-09-27');
assert.strictEqual(getSemesterWeek(sunInstant), 4, 'Sunday night MUST be Week 4');
assert.strictEqual(getSemesterWeek(sunSamara), 4, 'Sunday night MUST be Week 4 via getSamaraDate');
assert.strictEqual(getDayName(sunInstant), 'Воскресенье', 'Day name MUST be Sunday');
assert.strictEqual(getDayName(sunSamara), 'Воскресенье', 'Day name MUST be Sunday via getSamaraDate');
assert.strictEqual(getWeekDateRange(4, sunSamara), '21 сент - 26 сент');
assert.strictEqual(getDayCalendarDate('Понедельник', 4, sunSamara), '21 сент');
assert.strictEqual(getDayISODate('Понедельник', 4, sunSamara), '2026-09-21');

// Verify that 'Сегодня' is FALSE for all days of Week 4 on Sunday:
const week4Days = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
for (const day of week4Days) {
  const dayIso = getDayISODate(day, 4, sunSamara);
  const isToday = dayIso === samaraISO(sunSamara);
  assert.strictEqual(isToday, false, `${day} of week 4 must NOT be marked as today on Sunday`);
}
console.log('✓ PASS: Sunday 23:08:40 correctly retains Week 4, 0 false "Сегодня" badges, 0 premature rollover');

// 2. Instant on Monday 2026-09-28 at 00:00:01 Samara time (20:00:01 UTC)
const monInstant = new Date('2026-09-27T20:00:01Z');
const monSamara = getSamaraDate(monInstant);

assert.strictEqual(samaraISO(monInstant), '2026-09-28');
assert.strictEqual(samaraISO(monSamara), '2026-09-28');
assert.strictEqual(getSemesterWeek(monInstant), 1, 'Monday morning MUST be Week 1');
assert.strictEqual(getSemesterWeek(monSamara), 1, 'Monday morning MUST be Week 1 via getSamaraDate');
assert.strictEqual(getDayName(monInstant), 'Понедельник', 'Day name MUST be Monday');
assert.strictEqual(getDayName(monSamara), 'Понедельник', 'Day name MUST be Monday via getSamaraDate');
assert.strictEqual(getWeekDateRange(1, monSamara), '28 сент - 3 окт');
assert.strictEqual(getDayCalendarDate('Понедельник', 1, monSamara), '28 сент');
assert.strictEqual(getDayISODate('Понедельник', 1, monSamara), '2026-09-28');

// Verify that 'Сегодня' is TRUE for Monday of Week 1:
const monIso = getDayISODate('Понедельник', 1, monSamara);
assert.strictEqual(monIso === samaraISO(monSamara), true, 'Monday of week 1 MUST be marked as today on Monday');
console.log('✓ PASS: Monday 00:00:01 correctly rolls over to Week 1 (28 сент - 3 окт), Monday marked as "Сегодня"');

// 3. Attendance re-exports match 100%
assert.strictEqual(att.getSemesterWeek(sunSamara), 4);
assert.strictEqual(att.getDayName(sunSamara), 'Воскресенье');
assert.strictEqual(att.getWeekDateRange(4, sunSamara), '21 сент - 26 сент');
assert.strictEqual(att.getDayISODate('Понедельник', 4, sunSamara), '2026-09-21');
console.log('✓ PASS: attendance.ts re-exports fully synchronized with utils/samaraDate.ts');
