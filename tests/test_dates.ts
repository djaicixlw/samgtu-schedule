import {
  getSamaraDate,
  getSamaraISODate,
  getSemesterWeek,
  getDayName,
  getDayCalendarDate,
  getWeekDateRange,
  getDayISODate
} from '../attendance';

console.log("=================================================");
console.log("           TEST SUITE 1: DATES & TIME            ");
console.log("=================================================");

// 1.1 getSamaraDate & getSamaraISODate analysis
console.log("\n--- 1.1 getSamaraDate & getSamaraISODate ---");
const samaraDate = getSamaraDate();
const samaraISO = getSamaraISODate();
console.log("Current System Date:", new Date().toString());
console.log("System Timezone Offset (min):", new Date().getTimezoneOffset());
console.log("getSamaraDate():", samaraDate.toString());
console.log("getSamaraDate().toISOString():", samaraDate.toISOString());
console.log("getSamaraISODate():", samaraISO);

// Test getTimezoneOffset issue:
// getSamaraDate implementation:
// const now = new Date();
// const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
// return new Date(utc + (4 * 3600000));
function simulateGetSamaraDate(mockNowUtcMs: number, mockTzOffsetMinutes: number) {
  // If the system timezone offset is mockTzOffsetMinutes
  const utc = mockNowUtcMs + (mockTzOffsetMinutes * 60000);
  return new Date(utc + (4 * 3600000));
}

console.log("\nSimulating getSamaraDate under different client timezones for instant 2026-09-03T18:00:00Z (Samara should be 22:00):");
const testInstantUtc = Date.UTC(2026, 8, 3, 18, 0, 0); // 18:00 UTC

const timezones = [
  { name: 'UTC+0 (London)', offset: 0 },
  { name: 'UTC+3 (Moscow)', offset: -180 },
  { name: 'UTC+4 (Samara)', offset: -240 },
  { name: 'UTC+5 (Yekaterinburg)', offset: -300 },
  { name: 'UTC-4 (New York EDT)', offset: 240 },
  { name: 'UTC+9 (Tokyo)', offset: -540 },
];

for (const tz of timezones) {
  const resultDate = simulateGetSamaraDate(testInstantUtc, tz.offset);
  // What would resultDate.getHours() return on that machine?
  // In that machine's timezone, local hours = resultDate.getUTCHours() - (offset / 60)
  const localHoursOnMachine = (resultDate.getUTCHours() - (tz.offset / 60) + 24) % 24;
  console.log(`Client in ${tz.name}:`);
  console.log(`  resultDate timestamp (ms diff from real UTC): ${(resultDate.getTime() - testInstantUtc) / 3600000} hours`);
  console.log(`  local hours on client machine: ${localHoursOnMachine} (Expected Samara: 22)`);
}

// Test midnight transitions
console.log("\nTesting midnight transitions in getSamaraISODate:");
const midnightTests = [
  { desc: "2026-08-31 23:59:59 Samara (19:59:59 UTC)", utc: Date.UTC(2026, 7, 31, 19, 59, 59), expectedISO: "2026-08-31" },
  { desc: "2026-09-01 00:00:01 Samara (20:00:01 UTC)", utc: Date.UTC(2026, 7, 31, 20, 0, 1), expectedISO: "2026-09-01" },
  { desc: "2026-12-31 23:59:59 Samara (19:59:59 UTC)", utc: Date.UTC(2026, 11, 31, 19, 59, 59), expectedISO: "2026-12-31" },
  { desc: "2027-01-01 00:00:01 Samara (20:00:01 UTC)", utc: Date.UTC(2026, 11, 31, 20, 0, 1), expectedISO: "2027-01-01" },
];

for (const t of midnightTests) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Samara',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const actualISO = formatter.format(new Date(t.utc));
  console.log(`${t.desc} -> ${actualISO} [${actualISO === t.expectedISO ? 'PASS' : 'FAIL'}]`);
}

// 1.2 getSemesterWeek analysis
console.log("\n--- 1.2 getSemesterWeek ---");
const semesterDates = [
  { desc: "Pre-semester (2026-08-20)", date: new Date(2026, 7, 20) },
  { desc: "Day before semester start (2026-08-30 Sun)", date: new Date(2026, 7, 30) },
  { desc: "Semester Start (2026-08-31 Mon)", date: new Date(2026, 7, 31) },
  { desc: "Sept 1 (2026-09-01 Tue)", date: new Date(2026, 8, 1) },
  { desc: "Sept 3 (2026-09-03 Thu)", date: new Date(2026, 8, 3) },
  { desc: "End of Week 1 (2026-09-06 Sun)", date: new Date(2026, 8, 6) },
  { desc: "Start of Week 2 (2026-09-07 Mon)", date: new Date(2026, 8, 7) },
  { desc: "Start of Week 3 (2026-09-14 Mon)", date: new Date(2026, 8, 14) },
  { desc: "Start of Week 4 (2026-09-21 Mon)", date: new Date(2026, 8, 21) },
  { desc: "Cycle 2 Week 1 (2026-09-28 Mon)", date: new Date(2026, 8, 28) },
  { desc: "Mid-October (2026-10-15 Thu)", date: new Date(2026, 9, 15) },
  { desc: "Mid-November (2026-11-15 Sun)", date: new Date(2026, 10, 15) },
  { desc: "End of Block 4 (2026-12-25 Fri)", date: new Date(2026, 11, 25) },
  { desc: "Exam session Jan 15 (2027-01-15 Fri)", date: new Date(2027, 0, 15) },
  { desc: "Winter vacation Feb 5 (2027-02-05 Fri)", date: new Date(2027, 1, 5) },
  { desc: "Far past date (2025-01-01)", date: new Date(2025, 0, 1) },
];

for (const t of semesterDates) {
  const week = getSemesterWeek(t.date);
  const day = getDayName(t.date);
  console.log(`${t.desc} [Day: ${day}] -> Semester Week: ${week}`);
}

// 1.3 getWeekDateRange & getDayISODate across semester cycles
console.log("\n--- 1.3 getWeekDateRange(weekNumber) & getDayISODate ---");
console.log("Current WeekDateRanges for weeks 1..4 when targetDate is TODAY (Cycle 0, Week 1):");
for (let w = 1; w <= 4; w++) {
  console.log(`  Week ${w} Date Range: ${getWeekDateRange(w)}`);
}

console.log("\nWhat happens when targetDate is in Week 5 (2026-09-28, Cycle 1)?");
const targetDateCycle1 = new Date(2026, 8, 28);
for (let w = 1; w <= 4; w++) {
  console.log(`  Week ${w} Date Range: ${getWeekDateRange(w, targetDateCycle1)}`);
}

console.log("\n1.4 Testing getDayISODate for all days (including Sunday) on Week 1 (Cycle 0):");
const daysToTest = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье', 'НеизвестныйДень'];
for (const day of daysToTest) {
  const iso = getDayISODate(day, 1, new Date(2026, 7, 31));
  const parsed = new Date(iso);
  console.log(`  Day '${day}' (Week 1) -> ISO: ${iso} (Day of week index in JS Date: ${parsed.getUTCDay()})`);
}
