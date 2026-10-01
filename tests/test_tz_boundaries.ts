import { getSemesterWeek, getSamaraDate } from '../attendance';

console.log("--- Timezone Boundary Tests for getSemesterWeek ---");

// Test Monday 00:05 in Samara vs Sunday 23:55 in Samara
// On 2026-08-31 00:05 Samara time, UTC is 2026-08-30 20:05.
// In New York (EDT, UTC-4), local time is 2026-08-30 16:05.
// Let us test what getSemesterWeek calculates if run on a machine in NY, London, or Tokyo.

function testWeekForInstant(utcYear: number, utcMonth: number, utcDay: number, utcHour: number, utcMin: number, tzOffsetMin: number) {
  const utcMs = Date.UTC(utcYear, utcMonth, utcDay, utcHour, utcMin);
  // simulate getSamaraDate() on machine with tzOffsetMin:
  const samaraFakeDate = new Date(utcMs + (tzOffsetMin * 60000) + (4 * 3600000));
  
  // start created on machine with tzOffsetMin:
  // new Date(2026, 7, 31) represents local midnight:
  // local midnight in UTC ms is: Date.UTC(2026, 7, 31) + (tzOffsetMin * 60000)
  const startMs = Date.UTC(2026, 7, 31) + (tzOffsetMin * 60000);
  
  const diffTime = samaraFakeDate.getTime() - startMs;
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  const week = diffDays < 0 ? 1 : (Math.floor(diffDays / 7) % 4) + 1;
  return { diffDays, week };
}

console.log("Samara time: 2026-08-31 00:05 (Monday morning of Week 1, UTC: 2026-08-30 20:05)");
for (const tz of [{ name: 'Samara (-240)', offset: -240 }, { name: 'London (0)', offset: 0 }, { name: 'NY (240)', offset: 240 }, { name: 'Tokyo (-540)', offset: -540 }]) {
  const res = testWeekForInstant(2026, 7, 30, 20, 5, tz.offset);
  console.log(`  ${tz.name}: diffDays=${res.diffDays}, week=${res.week}`);
}

console.log("\nSamara time: 2026-08-30 23:55 (Sunday before Week 1, UTC: 2026-08-30 19:55)");
for (const tz of [{ name: 'Samara (-240)', offset: -240 }, { name: 'London (0)', offset: 0 }, { name: 'NY (240)', offset: 240 }, { name: 'Tokyo (-540)', offset: -540 }]) {
  const res = testWeekForInstant(2026, 7, 30, 19, 55, tz.offset);
  console.log(`  ${tz.name}: diffDays=${res.diffDays}, week=${res.week}`);
}

console.log("\nSamara time: 2026-09-06 23:55 (Sunday night of Week 1, UTC: 2026-09-06 19:55)");
for (const tz of [{ name: 'Samara (-240)', offset: -240 }, { name: 'London (0)', offset: 0 }, { name: 'NY (240)', offset: 240 }, { name: 'Tokyo (-540)', offset: -540 }]) {
  const res = testWeekForInstant(2026, 8, 6, 19, 55, tz.offset);
  console.log(`  ${tz.name}: diffDays=${res.diffDays}, week=${res.week}`);
}

console.log("\nSamara time: 2026-09-07 00:05 (Monday morning of Week 2, UTC: 2026-09-06 20:05)");
for (const tz of [{ name: 'Samara (-240)', offset: -240 }, { name: 'London (0)', offset: 0 }, { name: 'NY (240)', offset: 240 }, { name: 'Tokyo (-540)', offset: -540 }]) {
  const res = testWeekForInstant(2026, 8, 6, 20, 5, tz.offset);
  console.log(`  ${tz.name}: diffDays=${res.diffDays}, week=${res.week}`);
}
