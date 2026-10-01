import * as fs from 'fs';
import * as path from 'path';
import assert from 'assert';
import { SCHEDULE_REGISTRY, AVAILABLE_GROUPS } from '../constants';
import {
  getCanonicalScheduleId,
  isScheduleLoaded,
  loadGroupSchedule,
  registerScheduleAliases
} from '../utils/scheduleLoader';
import { preloadAllSchedulesSync } from '../utils/scheduleNodeLoader';

console.log('=== TEST SUITE: On-Demand Schedule Chunking & Multi-Tier Cache ===\n');

// 1. Verify all 17 JSON files exist in public/schedules/
console.log('1. Verifying public/schedules/*.json files...');
const schedulesDir = path.resolve(process.cwd(), 'public', 'schedules');
assert(fs.existsSync(schedulesDir), 'public/schedules directory must exist');

const expectedGroups = [
  'ingt-301', 'ingt-302', 'ingt-303', 'ingt-304', 'ingt-305',
  'ingt-306', 'ingt-307', 'ingt-308', 'ingt-309', 'ingt-310',
  'ingt-311', 'ingt-312', 'ingt-313', 'ingt-314',
  'faid-310', 'ingt-209', 'htf-215', 'iait-308'
];

for (const gid of expectedGroups) {
  const filePath = path.join(schedulesDir, `${gid}.json`);
  assert(fs.existsSync(filePath), `Schedule file for ${gid} must exist at ${filePath}`);
  const content = fs.readFileSync(filePath, 'utf8');
  const json = JSON.parse(content);
  assert(json[1] && json[2] && json[3] && json[4], `${gid}.json must have weeks 1, 2, 3, 4`);
  assert(Array.isArray(json[1]), `Week 1 in ${gid}.json must be an array of days`);
  assert(json[1].length === 6, `Week 1 in ${gid}.json must contain 6 days (Mon-Sat)`);
}
console.log(`[PASS] All ${expectedGroups.length} JSON chunks exist and are structurally valid.`);

// 2. Canonical mapping verification
console.log('\n2. Testing getCanonicalScheduleId mapping...');
assert.strictEqual(getCanonicalScheduleId('3-ИНГТ-110'), 'ingt-310');
assert.strictEqual(getCanonicalScheduleId('3-ингт-113'), 'ingt-313');
assert.strictEqual(getCanonicalScheduleId('3-ФАИД-110'), 'faid-310');
assert.strictEqual(getCanonicalScheduleId('2-ИНГТ-109'), 'ingt-209');
assert.strictEqual(getCanonicalScheduleId('2-ХТФ-115'), 'htf-215');
assert.strictEqual(getCanonicalScheduleId('faid-310'), 'faid-310');
console.log('[PASS] Canonical schedule ID mapping works correctly.');

// 3. In-memory check for default bundled group
console.log('\n3. Testing in-memory status of default bundled group...');
assert(isScheduleLoaded('ingt-310'), 'ingt-310 must be bundled in-memory for instant cold boot');
assert(isScheduleLoaded('3-ИНГТ-110'), 'Alias 3-ИНГТ-110 must be resolved in-memory');
console.log('[PASS] Default bundled group is instantly available.');

// 4. On-demand loading of unbundled schedule (async)
console.log('\n4. Testing on-demand async loading of unbundled schedule (ingt-313)...');
async function testAsyncLoading() {
  const weekData = await loadGroupSchedule('3-ингт-113');
  assert(weekData, 'loadGroupSchedule must return week data');
  assert(Array.isArray(weekData[1]), 'Week 1 must be an array');
  assert(isScheduleLoaded('ingt-313'), 'ingt-313 must now be marked as loaded in memory');
  assert(SCHEDULE_REGISTRY['ingt-313'], 'SCHEDULE_REGISTRY[ingt-313] must be populated');
  assert(SCHEDULE_REGISTRY['3-ингт-113'], 'Alias 3-ингт-113 must be registered in SCHEDULE_REGISTRY');
  assert(SCHEDULE_REGISTRY['3-ingt-113'], 'Alias 3-ingt-113 must be registered in SCHEDULE_REGISTRY');
  
  // Total lessons count in week 1 of ingt-313
  const w1Lessons = weekData[1].flatMap(d => d.lessons);
  assert(w1Lessons.length > 0, 'ingt-313 week 1 must have lessons');
  console.log(`[PASS] On-demand loaded ingt-313 successfully with ${w1Lessons.length} lessons in Week 1.`);
}

// 5. Fallback safety
console.log('\n5. Testing fallback for unknown/custom empty group...');
async function testFallback() {
  const fallback = await loadGroupSchedule('unknown-999');
  assert(fallback[1] && fallback[2] && fallback[3] && fallback[4], 'Fallback must have all 4 weeks');
  assert(fallback[1].length === 6, 'Fallback week 1 must have 6 days');
  assert(fallback[1][0].lessons.length === 0, 'Fallback day must have 0 lessons');
  console.log('[PASS] Fallback safely handled unknown group without crashing.');
}

// 6. PreloadAllSchedulesSync verification
console.log('\n6. Testing preloadAllSchedulesSync for test suites...');
preloadAllSchedulesSync();
for (const gid of expectedGroups) {
  assert(isScheduleLoaded(gid), `Schedule for ${gid} must be loaded after preloadAllSchedulesSync`);
  assert(SCHEDULE_REGISTRY[gid], `SCHEDULE_REGISTRY[${gid}] must be present`);
}
console.log('[PASS] preloadAllSchedulesSync synchronously loads all 17 schedules.');

await testAsyncLoading();
await testFallback();

console.log('\n=================================================');
console.log('  ALL ON-DEMAND SCHEDULE TESTS PASSED (100%)');
console.log('=================================================\n');
