import { getSemesterWeek } from '../attendance';

console.log("=== BUG TEST: selectedDate string parsed as UTC vs new Date(2026, 7, 31) parsed as Local ===");

// When user selects "2026-09-07" (Monday of Week 2):
const dateStr = "2026-09-07";

// In standard JS:
// const dateObj = new Date(dateStr); // parsed as UTC: 2026-09-07T00:00:00.000Z

// If client timezone is West of UTC (e.g. UTC-4 NY or UTC-7 California):
// Local midnight of 2026-08-31 in UTC-4 is 2026-08-31T04:00:00.000Z.
const startNY = new Date(Date.UTC(2026, 7, 31, 4, 0, 0)); // 00:00 in NY
const dateObjUTC = new Date(dateStr); // 2026-09-07T00:00:00.000Z

const diffTime = dateObjUTC.getTime() - startNY.getTime();
const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
const week = Math.floor(diffDays / 7) % 4 + 1;

console.log(`dateStr: ${dateStr}`);
console.log(`dateObjUTC.toISOString(): ${dateObjUTC.toISOString()}`);
console.log(`startNY.toISOString(): ${startNY.toISOString()}`);
console.log(`diffTime in hours: ${diffTime / 3600000}h`);
console.log(`diffDays: ${diffDays}`);
console.log(`Calculated Week: ${week} (EXPECTED: 2)`);
if (week !== 2) {
  console.log(">>> CRITICAL BUG CONFIRMED: Monday of Week 2 is calculated as Week 1 for users in West-of-UTC timezones! <<<");
}
