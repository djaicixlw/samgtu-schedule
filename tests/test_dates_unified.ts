import assert from 'assert';
import {
  samaraISO,
  cycleWeek,
  getSemesterWeek,
  getSemesterConfig,
  getSamaraDate,
  DEFAULT_SEMESTER_CONFIG
} from '../utils/samaraDate';

console.log("================================================================================");
console.log("   TEST SUITE: UNIFIED SAMARA TIME (UTC+4) & SEMESTER CYCLE (A4-T2)             ");
console.log("   Specification: Appendix F7 | Intl TimeZone & Pure Date.UTC Arithmetic         ");
console.log("================================================================================\n");

let totalAssertions = 0;
let passedAssertions = 0;

function check(condition: boolean, description: string) {
  totalAssertions++;
  if (condition) {
    passedAssertions++;
    console.log(`  ✓ PASS: ${description}`);
  } else {
    console.error(`  ✗ FAIL: ${description}`);
    assert(condition, description);
  }
}

// ============================================================================
// SUITE 1: Проверка полночи и смены суток (23:59:59 -> 00:00:00 по Самаре)
// ============================================================================
console.log("--------------------------------------------------------------------------------");
console.log("1. Midnight and Day Rollover Verification in Europe/Samara (UTC+4)");
console.log("--------------------------------------------------------------------------------");

// Samara is UTC+4.
// 23:59:59 Samara = 19:59:59 UTC
// 00:00:00 Samara = 20:00:00 UTC
// 00:00:01 Samara = 20:00:01 UTC

const midnightCases = [
  {
    desc: "Start of semester: 2026-08-31 23:59:59 Samara (19:59:59 UTC)",
    utcISO: '2026-08-31T19:59:59.000Z',
    expectedDate: '2026-08-31'
  },
  {
    desc: "Start of semester: 2026-09-01 00:00:00 Samara (20:00:00 UTC)",
    utcISO: '2026-08-31T20:00:00.000Z',
    expectedDate: '2026-09-01'
  },
  {
    desc: "Start of semester: 2026-09-01 00:00:01 Samara (20:00:01 UTC)",
    utcISO: '2026-08-31T20:00:01.000Z',
    expectedDate: '2026-09-01'
  },
  {
    desc: "Mid-semester: 2026-10-15 23:59:59 Samara (19:59:59 UTC)",
    utcISO: '2026-10-15T19:59:59.000Z',
    expectedDate: '2026-10-15'
  },
  {
    desc: "Mid-semester: 2026-10-16 00:00:00 Samara (20:00:00 UTC)",
    utcISO: '2026-10-15T20:00:00.000Z',
    expectedDate: '2026-10-16'
  },
  {
    desc: "New Year Eve: 2026-12-31 23:59:59 Samara (19:59:59 UTC)",
    utcISO: '2026-12-31T19:59:59.000Z',
    expectedDate: '2026-12-31'
  },
  {
    desc: "New Year: 2027-01-01 00:00:00 Samara (20:00:00 UTC)",
    utcISO: '2026-12-31T20:00:00.000Z',
    expectedDate: '2027-01-01'
  }
];

for (const c of midnightCases) {
  const d = new Date(c.utcISO);
  const actual = samaraISO(d);
  check(actual === c.expectedDate, `${c.desc} -> ${actual}`);
}

// Verify getSamaraDate() creates exact Date matching Europe/Samara wall-clock
const rolloverD1 = new Date('2026-08-31T19:59:59.000Z');
const samaraD1 = getSamaraDate(rolloverD1);
check(samaraD1.getUTCDate() === 31 && samaraD1.getUTCHours() === 23, "getSamaraDate returns 23h on 2026-08-31");

const rolloverD2 = new Date('2026-08-31T20:00:00.000Z');
const samaraD2 = getSamaraDate(rolloverD2);
check(samaraD2.getUTCDate() === 1 && samaraD2.getUTCHours() === 0, "getSamaraDate returns 00h on 2026-09-01");

// ============================================================================
// SUITE 2: Симуляция клиентов в других часовых поясах (Berlin, NY, Tokyo, etc.)
// ============================================================================
console.log("\n--------------------------------------------------------------------------------");
console.log("2. Client Timezone Simulation (Berlin CEST/CET, New York EDT/EST, Tokyo JST)");
console.log("--------------------------------------------------------------------------------");

// An absolute UTC instant:
// 2026-08-31 20:00:00 UTC = 2026-09-01 00:00:00 in Samara
const instantSummerUtc = new Date('2026-08-31T20:00:00.000Z');

// Simulate client perspectives using Intl formatting:
// Berlin (CEST, UTC+2 in summer): local wall clock is 22:00:00 (Aug 31)
const berlinSummerLocal = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(instantSummerUtc);
// New York (EDT, UTC-4 in summer): local wall clock is 16:00:00 (Aug 31)
const nySummerLocal = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(instantSummerUtc);
// Tokyo (JST, UTC+9, no DST): local wall clock is 05:00:00 (Sep 1)
const tokyoSummerLocal = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(instantSummerUtc);

console.log(`  Client wall clock in Berlin (CEST):   ${berlinSummerLocal}`);
console.log(`  Client wall clock in New York (EDT):  ${nySummerLocal}`);
console.log(`  Client wall clock in Tokyo (JST):     ${tokyoSummerLocal}`);

// Regardless of where the client runs, samaraISO(instantSummerUtc) MUST resolve strictly in Europe/Samara:
const samaraFromAnyClient = samaraISO(instantSummerUtc);
check(samaraFromAnyClient === '2026-09-01', "Summer instant: Client anywhere in the world calculates Samara date as 2026-09-01");

// Now test Winter instant after DST transition in Berlin and New York:
// In 2026:
// Europe/Berlin switches to CET (UTC+1) on Sunday, Oct 25, 2026.
// America/New_York switches to EST (UTC-5) on Sunday, Nov 1, 2026.
// Europe/Samara does NOT switch (permanently UTC+4).

// Instant: 2026-11-15 20:00:00 UTC = 2026-11-16 00:00:00 in Samara
const instantWinterUtc = new Date('2026-11-15T20:00:00.000Z');

const berlinWinterLocal = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(instantWinterUtc);
const nyWinterLocal = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(instantWinterUtc);

console.log(`  Client wall clock in Berlin (CET winter):  ${berlinWinterLocal}`);
console.log(`  Client wall clock in New York (EST winter): ${nyWinterLocal}`);

const samaraFromWinterClient = samaraISO(instantWinterUtc);
check(samaraFromWinterClient === '2026-11-16', "Winter instant: Client in Berlin/NY after DST transition calculates Samara date as 2026-11-16");

// Elimination of getTimezoneOffset discrepancy demonstration:
function legacySkewedCalculation(d: Date, clientTzOffsetMinutes: number): string {
  // Legacy buggy method: adds local getTimezoneOffset() to UTC timestamp
  const utc = d.getTime() + (clientTzOffsetMinutes * 60000);
  const samara = new Date(utc + (4 * 3600000));
  const y = samara.getUTCFullYear();
  const m = String(samara.getUTCMonth() + 1).padStart(2, '0');
  const day = String(samara.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// In New York (EDT, offset +240 minutes):
const legacyNyResult = legacySkewedCalculation(instantSummerUtc, 240);
// In Tokyo (JST, offset -540 minutes):
const legacyTokyoResult = legacySkewedCalculation(instantSummerUtc, -540);

check(
  legacyNyResult !== '2026-09-01' || legacyTokyoResult !== '2026-09-01',
  `Legacy method demonstrated skew: NY gave ${legacyNyResult}, Tokyo gave ${legacyTokyoResult}`
);
check(
  samaraISO(instantSummerUtc) === '2026-09-01',
  "Unified samaraISO eliminates timezoneOffset skew and returns consistent 2026-09-01 everywhere"
);

// ============================================================================
// SUITE 3: Проверка циклического перехода недель (неделя 4 -> неделя 1)
// ============================================================================
console.log("\n--------------------------------------------------------------------------------");
console.log("3. 4-Week Cyclic Transition Verification (Week 4 -> Week 1)");
console.log("--------------------------------------------------------------------------------");

// Semester start: 2026-08-31 (Monday, Week 1)
const cycleTestCases = [
  // Pre-semester boundary
  { iso: '2026-08-20', expectedWeek: 1, note: 'Pre-semester fallback to 1' },
  { iso: '2026-08-30', expectedWeek: 1, note: 'Day before semester start' },

  // Cycle 1: Weeks 1..4
  { iso: '2026-08-31', expectedWeek: 1, note: 'Cycle 1: Week 1, Monday (semester start)' },
  { iso: '2026-09-02', expectedWeek: 1, note: 'Cycle 1: Week 1, Wednesday' },
  { iso: '2026-09-06', expectedWeek: 1, note: 'Cycle 1: Week 1, Sunday' },

  { iso: '2026-09-07', expectedWeek: 2, note: 'Cycle 1: Week 2, Monday' },
  { iso: '2026-09-13', expectedWeek: 2, note: 'Cycle 1: Week 2, Sunday' },

  { iso: '2026-09-14', expectedWeek: 3, note: 'Cycle 1: Week 3, Monday' },
  { iso: '2026-09-20', expectedWeek: 3, note: 'Cycle 1: Week 3, Sunday' },

  { iso: '2026-09-21', expectedWeek: 4, note: 'Cycle 1: Week 4, Monday' },
  { iso: '2026-09-26', expectedWeek: 4, note: 'Cycle 1: Week 4, Saturday' },
  { iso: '2026-09-27', expectedWeek: 4, note: 'Cycle 1: Week 4, Sunday (End of Cycle 1)' },

  // Critical Transition: Week 4 -> Week 1 (Cycle 2 begins)
  { iso: '2026-09-28', expectedWeek: 1, note: 'Cycle 2: Week 1, Monday (CYCLE ROLLOVER 4 -> 1)' },
  { iso: '2026-10-04', expectedWeek: 1, note: 'Cycle 2: Week 1, Sunday' },

  { iso: '2026-10-05', expectedWeek: 2, note: 'Cycle 2: Week 2, Monday' },
  { iso: '2026-10-12', expectedWeek: 3, note: 'Cycle 2: Week 3, Monday' },
  { iso: '2026-10-19', expectedWeek: 4, note: 'Cycle 2: Week 4, Monday' },
  { iso: '2026-10-25', expectedWeek: 4, note: 'Cycle 2: Week 4, Sunday (End of Cycle 2)' },

  // Critical Transition: Week 4 -> Week 1 (Cycle 3 begins)
  { iso: '2026-10-26', expectedWeek: 1, note: 'Cycle 3: Week 1, Monday (CYCLE ROLLOVER 4 -> 1)' },
  { iso: '2026-11-02', expectedWeek: 2, note: 'Cycle 3: Week 2, Monday' },
  { iso: '2026-11-09', expectedWeek: 3, note: 'Cycle 3: Week 3, Monday' },
  { iso: '2026-11-16', expectedWeek: 4, note: 'Cycle 3: Week 4, Monday' },

  // Critical Transition: Week 4 -> Week 1 (Cycle 4 begins)
  { iso: '2026-11-23', expectedWeek: 1, note: 'Cycle 4: Week 1, Monday (CYCLE ROLLOVER 4 -> 1)' }
];

for (const tc of cycleTestCases) {
  const w = cycleWeek(tc.iso, '2026-08-31');
  check(w === tc.expectedWeek, `${tc.iso} (${tc.note}) -> Week ${w}`);
}

// Test rollover directly between consecutive days:
const endWeek4 = cycleWeek('2026-09-27', '2026-08-31');
const startWeek1 = cycleWeek('2026-09-28', '2026-08-31');
check(endWeek4 === 4, "2026-09-27 is Week 4");
check(startWeek1 === 1, "2026-09-28 rolls over to Week 1");

// ============================================================================
// SUITE 4: Reading Configuration from public/semester.json
// ============================================================================
console.log("\n--------------------------------------------------------------------------------");
console.log("4. Reading Configuration from public/semester.json");
console.log("--------------------------------------------------------------------------------");

const config = getSemesterConfig();
check(config !== null && typeof config === 'object', "Successfully read semester configuration");
check(config.semesterStart === '2026-08-31', `semesterStart is '2026-08-31' (got: ${config.semesterStart})`);
check(config.cycleWeeks === 4, `cycleWeeks is 4 (got: ${config.cycleWeeks})`);
check(Array.isArray(config.blocks) && config.blocks.length === 4, `blocks has 4 academic blocks (got: ${config.blocks.length})`);

const b1 = config.blocks.find(b => b.id === 1);
check(b1 !== undefined, "Block 1 is present");
check(b1?.start === '2026-08-31', `Block 1 start is '2026-08-31' (got: ${b1?.start})`);
check(b1?.end === '2026-09-26', `Block 1 end is '2026-09-26' (got: ${b1?.end})`);

// getSemesterWeek() integration with loaded config
const weekFromConfig = getSemesterWeek('2026-09-01');
check(weekFromConfig === 1, "getSemesterWeek('2026-09-01') returns 1 via config");

const weekRolloverFromConfig = getSemesterWeek('2026-09-28');
check(weekRolloverFromConfig === 1, "getSemesterWeek('2026-09-28') returns 1 via config");

// Passing Date object to getSemesterWeek
const dateObj = new Date('2026-09-08T12:00:00.000Z');
const weekFromDateObj = getSemesterWeek(dateObj);
check(weekFromDateObj === 2, "getSemesterWeek(new Date('2026-09-08')) returns 2");

// ============================================================================
// SUMMARY
// ============================================================================
console.log("\n================================================================================");
console.log(`   UNIFIED DATES TEST SUMMARY: ${passedAssertions} / ${totalAssertions} ASSERTIONS PASSED`);
console.log("================================================================================\n");

if (passedAssertions !== totalAssertions) {
  process.exit(1);
}
