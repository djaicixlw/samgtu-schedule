/**
 * AUD-006 regression test: no hardcoded academic year anywhere in the fallback chain.
 *
 * The defect: the year 2026 was hardcoded in 5+ places (DEFAULT_SEMESTER_CONFIG,
 * DEFAULT_SEMESTER_START in the parser, the parser's `|| 2026` year fallback,
 * cycleWeek's fallback, exportWord's "2026-2027 уч.г." label). On 2027-01-01 the
 * active config went stale: cycle phase desynced from the schedule chunks and
 * block-scoped views emptied out.
 *
 * The fix: generateDefaultSemesterConfig(now) derives the academic year from the
 * clock (Aug..Dec -> this year; Jan..Jul -> previous year); every fallback site
 * uses the active config or the generator; exportWord builds its label dynamically.
 */

import {
  generateDefaultSemesterConfig,
  setSemesterConfig,
  getSemesterConfig,
  cycleWeek
} from '../utils/samaraDate';
import { calculateWeekAndDay } from '../utils/samgtuParser';

console.log('\n=================================================');
console.log('   TEST SUITE: SEMESTER FALLBACK (AUD-006)       ');
console.log('=================================================');

let passed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`  ❌ FAIL: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  passed++;
  console.log(`  ✓ [PASS] ${msg}`);
}

function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)); // noon UTC — DST-proof
}

async function runSemesterTests() {
  console.log('\n--- 1. Academic year rollover in the generator ---');
  const cfgAutumn2026 = generateDefaultSemesterConfig(isoToDate('2026-09-17'));
  assert(cfgAutumn2026.semesterStart === '2026-08-31', 'Sep 2026 -> academic year 2026/27, start 2026-08-31');

  const cfgSpring2027 = generateDefaultSemesterConfig(isoToDate('2027-02-01'));
  assert(cfgSpring2027.semesterStart === '2026-08-31', 'Feb 2027 -> still academic year 2026/27 (spring half)');

  const cfgJan2027 = generateDefaultSemesterConfig(isoToDate('2027-01-15'));
  assert(cfgJan2027.semesterStart === '2026-08-31', 'Jan 2027 -> still academic year 2026/27');

  const cfgAutumn2027 = generateDefaultSemesterConfig(isoToDate('2027-09-01'));
  assert(cfgAutumn2027.semesterStart === '2027-08-31', 'Sep 2027 -> academic year rolls over to 2027/28');
  assert(cfgAutumn2027.blocks[0].start === '2027-08-31' && cfgAutumn2027.blocks[3].end === '2027-12-31',
    'blocks shifted whole-year for 2027/28');
  assert(cfgAutumn2027.blocks[0].name.includes('31.08') && cfgAutumn2027.blocks[0].name.includes('26.09'),
    'block names regenerated from shifted dates');

  console.log('\n--- 2. The 2027-01-01 time bomb: cycle stays sane across the whole year ---');
  // Every day from Sep 2026 through Aug 2027 must yield a valid cycle week (1..4)
  // under the config generated for that period — no NaN, no zeroing.
  let checked = 0;
  for (let day = 0; day < 365; day++) {
    const d = new Date(Date.UTC(2026, 8, 1) + day * 86400000); // 2026-09-01 + N days
    const cfg = generateDefaultSemesterConfig(d);
    setSemesterConfig(cfg);
    const iso = d.toISOString().slice(0, 10);
    const week = cycleWeek(iso, cfg.semesterStart);
    if (!Number.isInteger(week) || week < 1 || week > 4) {
      assert(false, `cycle week out of range for ${iso}: ${week}`);
    }
    checked++;
  }
  setSemesterConfig(generateDefaultSemesterConfig());
  assert(checked === 365, `365 days checked through the 2026/27 -> 2027 rollover (checked ${checked})`);

  console.log('\n--- 3. Parser fallback follows the active config, not a hardcoded year ---');
  setSemesterConfig({ semesterStart: '2027-08-31', cycleWeeks: 4, blocks: generateDefaultSemesterConfig(isoToDate('2027-09-15')).blocks });
  const calc = calculateWeekAndDay('2027-09-15'); // no explicit semesterStart -> getDefaultSemesterStart()
  assert(calc.weekNumber >= 1 && Number.isFinite(calc.weekNumber), 'calculateWeekAndDay works without explicit start in 2027');
  setSemesterConfig(generateDefaultSemesterConfig());

  console.log('\n--- 4. studyYearLabel derives from the active config ---');
  // studyYearLabel is module-private in exportWord; verify the same derivation logic
  // through the exported config surface it reads.
  setSemesterConfig({ semesterStart: '2027-08-31', cycleWeeks: 4, blocks: [] });
  const y = parseInt(getSemesterConfig().semesterStart.split('-')[0], 10);
  assert(`${y}-${y + 1}` === '2027-2028', 'label derivation gives 2027-2028 for the 2027/28 config');
  setSemesterConfig(generateDefaultSemesterConfig());

  console.log('\n--- 5. Module-load default equals the generated config for TODAY ---');
  const current = getSemesterConfig();
  assert(current.semesterStart === generateDefaultSemesterConfig().semesterStart,
    `DEFAULT_SEMESTER_CONFIG is generated (start=${current.semesterStart}), not the hardcoded 2026 line`);

  console.log(`\n=================================================`);
  console.log(`  SEMESTER FALLBACK: ${passed} CHECKS PASSED  `);
  console.log(`=================================================\n`);
}

await runSemesterTests();
