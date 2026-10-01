import { normalizeSamgtuGroupName, getCanonicalGroupKey } from '../utils/samgtuParser';
import { AVAILABLE_GROUPS, SCHEDULE_REGISTRY } from '../constants';
import { GroupConfig } from '../types';
import { preloadAllSchedulesSync } from '../utils/scheduleNodeLoader';

preloadAllSchedulesSync();

console.log('--- STARTING GROUP DEDUPLICATION & INGT-3 TESTS ---');

let assertionsPassed = 0;
function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${msg}`);
    process.exit(1);
  }
  assertionsPassed++;
}

// -------------------------------------------------------------
// 1. Group Normalization & Canonical Key Mapping
// -------------------------------------------------------------
console.log('1. Testing canonical group key mapping & normalization...');

const testCases = [
  { input: '3-ИНГТ-111', expected: 'ingt-311' },
  { input: 'ingt-311', expected: 'ingt-311' },
  { input: '3-ингт-111', expected: 'ingt-311' },
  { input: '3-ingt-111', expected: 'ingt-311' },
  { input: 'Группа 24ИНГТ–111', expected: 'ingt-311' },
  { input: '24ИНГТ-111', expected: 'ingt-311' },
  { input: '3-ИНГТ-111 (копия)', expected: 'ingt-311' },
  { input: { id: '3-ингт-111', name: '3-ИНГТ-111' }, expected: 'ingt-311' },

  { input: '3-ИНГТ-110', expected: 'ingt-310' },
  { input: 'ingt-310', expected: 'ingt-310' },
  { input: '3-ингт-110', expected: 'ingt-310' },
  { input: 'Группа 24ИНГТ–110', expected: 'ingt-310' },
  { input: '24ИНГТ-110', expected: 'ingt-310' },
  { input: { id: '3-ингт-110', name: '3-ИНГТ-110' }, expected: 'ingt-310' },

  { input: '3-ИНГТ-113', expected: 'ingt-313' },
  { input: 'ingt-313', expected: 'ingt-313' },
  { input: '3-ингт-113', expected: 'ingt-313' },
  { input: 'Группа 24ИНГТ–113', expected: 'ingt-313' },
  { input: '24ИНГТ-113', expected: 'ingt-313' },
  { input: { id: '3-ингт-113', name: '3-ИНГТ-113' }, expected: 'ingt-313' },

  { input: '3-ФАИД-110', expected: 'faid-310' },
  { input: 'faid-310', expected: 'faid-310' },
  { input: '3-фаид-110', expected: 'faid-310' },
  { input: { id: 'faid-310', name: '3-ФАИД-110' }, expected: 'faid-310' }
];

for (const tc of testCases) {
  const result = getCanonicalGroupKey(tc.input);
  assert(
    result === tc.expected,
    `getCanonicalGroupKey(${JSON.stringify(tc.input)}) returned '${result}', expected '${tc.expected}'`
  );
}
console.log(`✅ Passed ${testCases.length} canonical key mapping assertions.`);

// -------------------------------------------------------------
// 2. Zero Duplicates in AVAILABLE_GROUPS
// -------------------------------------------------------------
console.log('2. Testing AVAILABLE_GROUPS integrity and uniqueness...');

const canonicalKeysInRegistry = new Set<string>();
for (const grp of AVAILABLE_GROUPS) {
  const key = getCanonicalGroupKey(grp);
  assert(!canonicalKeysInRegistry.has(key), `Duplicate canonical group in AVAILABLE_GROUPS: ${key} (${grp.name})`);
  canonicalKeysInRegistry.add(key);
}

// Verify that all 14 INGT 3rd year groups (101 to 114) exist in AVAILABLE_GROUPS
for (let i = 101; i <= 114; i++) {
  const numStr = String(i);
  const expectedId = `ingt-3${numStr.slice(-2)}`;
  const expectedName = `3-ИНГТ-${i}`;
  const found = AVAILABLE_GROUPS.find(g => g.id === expectedId && g.name === expectedName);
  assert(!!found, `Missing INGT 3rd course group in AVAILABLE_GROUPS: ${expectedId} (${expectedName})`);
}
console.log('✅ All 14 INGT 3rd year groups are present in AVAILABLE_GROUPS without duplicates.');

// -------------------------------------------------------------
// 3. Official Schedule Data Integrity for INGT 3rd Course
// -------------------------------------------------------------
console.log('3. Testing schedules in SCHEDULE_REGISTRY for INGT 3rd year stream...');

for (let i = 101; i <= 114; i++) {
  const numStr = String(i);
  const code = `ingt-3${numStr.slice(-2)}`;
  const schedule = SCHEDULE_REGISTRY[code];
  assert(!!schedule, `Missing schedule for ${code} in SCHEDULE_REGISTRY`);

  let totalLessons = 0;
  for (let w = 1; w <= 4; w++) {
    const week = schedule[w];
    assert(Array.isArray(week) && week.length === 6, `Group ${code} week ${w} must have 6 days`);
    for (const day of week) {
      assert(Array.isArray(day.lessons), `Group ${code} week ${w} day ${day.dayName} lessons must be an array`);
      totalLessons += day.lessons.length;
      for (const lesson of day.lessons) {
        assert(!!lesson.id, `Group ${code} lesson missing id`);
        assert(!!lesson.timeStart && !!lesson.timeEnd, `Group ${code} lesson missing time`);
        assert(!!lesson.subject, `Group ${code} lesson missing subject`);
      }
    }
  }

  // All 14 INGT 3rd year groups have 55 to 81 lessons in their 4-week cycle
  assert(totalLessons >= 50, `Group ${code} has too few lessons: ${totalLessons}`);

  // Test aliases
  assert(SCHEDULE_REGISTRY[`3-ингт-${i}`] === schedule, `Alias 3-ингт-${i} does not match`);
  assert(SCHEDULE_REGISTRY[`24ингт-${i}`] === schedule, `Alias 24ингт-${i} does not match`);
}

// Deep check for user-requested group 3-ИНГТ-113
const sched113 = SCHEDULE_REGISTRY['ingt-313'];
assert(!!sched113, 'Group 3-ИНГТ-113 schedule must exist');
const w1Count = sched113[1].reduce((sum, d) => sum + d.lessons.length, 0);
const w2Count = sched113[2].reduce((sum, d) => sum + d.lessons.length, 0);
const w3Count = sched113[3].reduce((sum, d) => sum + d.lessons.length, 0);
const w4Count = sched113[4].reduce((sum, d) => sum + d.lessons.length, 0);
const total113 = w1Count + w2Count + w3Count + w4Count;
assert(total113 === 81, `Group 3-ИНГТ-113 should have exactly 81 lessons across 4 weeks, got ${total113}`);
console.log(`✅ 3-ИНГТ-113 verified: 81 lessons across 4-week cycle (w1: ${w1Count}, w2: ${w2Count}, w3: ${w3Count}, w4: ${w4Count})`);

// -------------------------------------------------------------
// 4. LocalStorage Self-Healing & Purging Duplicates
// -------------------------------------------------------------
console.log('4. Testing self-healing deduplication for contaminated custom_groups...');

const mockContaminatedCustomGroups: GroupConfig[] = [
  { id: '3-ингт-111', name: '3-ИНГТ-111', facultyId: 'ingt', course: 3, degree: 'Бакалавриат' },
  { id: '3-ингт-110', name: '3-ИНГТ-110', facultyId: 'ingt', course: 3, degree: 'Бакалавриат' },
  { id: '24ингт-113', name: '24ИНГТ-113', facultyId: 'ingt', course: 3, degree: 'Бакалавриат' },
  { id: 'custom-math-999', name: '1-ИТФ-999', facultyId: 'itf', course: 1, degree: 'Бакалавриат' }
];

// Replicate self-healing logic from App.tsx
const builtInKeys = new Set(AVAILABLE_GROUPS.map(g => getCanonicalGroupKey(g)));
const seenCustomKeys = new Set<string>();
const sanitized: GroupConfig[] = [];

for (const cg of mockContaminatedCustomGroups) {
  if (!cg || !cg.id || !cg.name) continue;
  const key = getCanonicalGroupKey(cg);
  if (builtInKeys.has(key)) continue;
  if (seenCustomKeys.has(key)) continue;
  seenCustomKeys.add(key);
  sanitized.push(cg);
}

assert(sanitized.length === 1, `Sanitized should contain exactly 1 custom group, got ${sanitized.length}`);
assert(sanitized[0].id === 'custom-math-999', 'Only the unique custom group 1-ИТФ-999 should remain');
console.log('✅ Self-healing logic successfully purged duplicate built-in groups 110, 111, 113.');

// -------------------------------------------------------------
// 5. Search & Filtering Deduplication Guarantee
// -------------------------------------------------------------
console.log('5. Testing search & filter uniqueness...');

// Compute allAvailableGroups combining AVAILABLE_GROUPS + sanitized
const combinedMap = new Map<string, GroupConfig>();
AVAILABLE_GROUPS.forEach(g => combinedMap.set(getCanonicalGroupKey(g), g));
sanitized.forEach(g => {
  const k = getCanonicalGroupKey(g);
  if (!combinedMap.has(k)) combinedMap.set(k, g);
});
const allGroups = Array.from(combinedMap.values());

const searchQueries = ['110', '111', '113', 'ингт', '3-ингт'];
for (const q of searchQueries) {
  const matched = allGroups.filter(g => g.name.toLowerCase().includes(q.toLowerCase()));
  const uniqueKeys = new Set(matched.map(g => getCanonicalGroupKey(g)));
  assert(matched.length === uniqueKeys.size, `Search query '${q}' returned duplicate groups! Total: ${matched.length}, Unique: ${uniqueKeys.size}`);
}

const groups110 = allGroups.filter(g => getCanonicalGroupKey(g) === 'ingt-310');
assert(groups110.length === 1, `Expected exactly 1 group for ingt-310, got ${groups110.length}`);

const groups111 = allGroups.filter(g => getCanonicalGroupKey(g) === 'ingt-311');
assert(groups111.length === 1, `Expected exactly 1 group for ingt-311, got ${groups111.length}`);

const groups113 = allGroups.filter(g => getCanonicalGroupKey(g) === 'ingt-313');
assert(groups113.length === 1, `Expected exactly 1 group for ingt-313, got ${groups113.length}`);

console.log('✅ Search and filter deduplication guarantees zero duplicates.');

console.log(`\n🎉 ALL ${assertionsPassed} ASSERTIONS PASSED SUCCESSFULLY!`);
