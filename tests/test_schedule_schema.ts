import assert from 'assert';
import {
  parseWeekData,
  hasAnyLessons,
  validateWeekData,
  LoadResult
} from '../utils/scheduleSchema';
import {
  loadGroupSchedule,
  isScheduleLoaded,
  clearLoadedChunks
} from '../utils/scheduleLoader';
import { createEmptyWeek, SCHEDULE_REGISTRY } from '../constants';
import { WeekData } from '../types';

console.log('=== TEST SUITE: Schedule Validation Schema & LoadResult (Appendix F6) ===\n');

// Helper to build a valid sample schedule with 1 lesson
function buildSampleWeekData(lessonsCount = 1): WeekData {
  const w1 = createEmptyWeek();
  if (lessonsCount > 0) {
    w1[0].lessons.push({
      id: 'test-w1-mo-1',
      timeStart: '08:00',
      timeEnd: '09:35',
      subject: 'Прикладная математика',
      type: 'Лекции',
      location: '1-100',
      teacher: 'Профессор П.П.'
    });
  }
  return {
    1: w1,
    2: createEmptyWeek(),
    3: createEmptyWeek(),
    4: createEmptyWeek()
  };
}

// 1. Validation of valid structures
console.log('1. Testing parseWeekData with valid structures...');

const validSchedule = buildSampleWeekData(2);
const parsed = parseWeekData(validSchedule);
assert(parsed !== null, 'parseWeekData must return non-null for valid schedule');
assert.strictEqual(parsed[1].length, 6, 'Week 1 must contain 6 days');
assert.strictEqual(parsed[1][0].lessons.length, 1, 'Day 1 must contain 1 lesson');
assert.strictEqual(parsed[1][0].lessons[0].subject, 'Прикладная математика');
console.log('  [PASS] Valid WeekData parsed and sanitized correctly.');

// 2. Rejection of invalid structures (corrupt JSON, missing weeks, bad types)
console.log('\n2. Testing rejection of invalid structures by parseWeekData...');

// Primitives and non-objects
assert.strictEqual(parseWeekData(null), null, 'null must return null');
assert.strictEqual(parseWeekData(undefined), null, 'undefined must return null');
assert.strictEqual(parseWeekData('string'), null, 'string must return null');
assert.strictEqual(parseWeekData(123), null, 'number must return null');
assert.strictEqual(parseWeekData([]), null, 'array must return null');
assert.strictEqual(parseWeekData({}), null, 'empty object must return null');

// Missing week 4
assert.strictEqual(
  parseWeekData({ 1: createEmptyWeek(), 2: createEmptyWeek(), 3: createEmptyWeek() }),
  null,
  'Missing week 4 must return null'
);

// Week is not an array
assert.strictEqual(
  parseWeekData({ 1: {}, 2: [], 3: [], 4: [] }),
  null,
  'Non-array week must return null'
);

// Day missing dayName
assert.strictEqual(
  parseWeekData({
    1: [{ lessons: [] }],
    2: [],
    3: [],
    4: []
  }),
  null,
  'Day without dayName must return null'
);

// Day missing lessons array
assert.strictEqual(
  parseWeekData({
    1: [{ dayName: 'Понедельник', lessons: 'not-an-array' }],
    2: [],
    3: [],
    4: []
  }),
  null,
  'Day with non-array lessons must return null'
);

// Lesson missing id or subject
assert.strictEqual(
  parseWeekData({
    1: [{ dayName: 'Понедельник', lessons: [{ subject: 'Math' }] }],
    2: [],
    3: [],
    4: []
  }),
  null,
  'Lesson missing id must return null'
);
assert.strictEqual(
  parseWeekData({
    1: [{ dayName: 'Понедельник', lessons: [{ id: 'l-1' }] }],
    2: [],
    3: [],
    4: []
  }),
  null,
  'Lesson missing subject must return null'
);
console.log('  [PASS] All invalid structures correctly rejected with null.');

// 3. Testing validateWeekData (empty vs invalid vs valid)
console.log('\n3. Testing validateWeekData for empty and valid schedules...');

// 0 lessons across all 4 weeks -> reason: 'empty'
const emptySchedule = buildSampleWeekData(0);
const emptyVal = validateWeekData(emptySchedule);
assert.strictEqual(emptyVal.ok, false, 'Empty schedule must have ok: false');
if (!emptyVal.ok) {
  assert.strictEqual(emptyVal.reason, 'empty', 'Empty schedule must have reason: "empty"');
}

// Invalid JSON -> reason: 'invalid'
const invalidVal = validateWeekData({ broken: true });
assert.strictEqual(invalidVal.ok, false, 'Invalid structure must have ok: false');
if (!invalidVal.ok) {
  assert.strictEqual(invalidVal.reason, 'invalid', 'Invalid structure must have reason: "invalid"');
}

// Valid schedule with lessons -> ok: true
const validVal = validateWeekData(validSchedule);
assert.strictEqual(validVal.ok, true, 'Valid schedule with lessons must have ok: true');
if (validVal.ok) {
  assert(validVal.data, 'Valid result must include data');
}
console.log('  [PASS] validateWeekData correctly detects "empty", "invalid" and valid data.');

// 4. Testing loadGroupSchedule LoadResult integration and error reasons
console.log('\n4. Testing loadGroupSchedule with simulated fetch responses...');

const originalFetch = globalThis.fetch;

async function runMockFetchTests() {
  clearLoadedChunks();

  // Test 4.1: Bundled group ingt-310 (in-memory instant return)
  const bundledRes = await loadGroupSchedule('ingt-310');
  assert.strictEqual(bundledRes.ok, true, 'Bundled group ingt-310 must return ok: true');
  if (bundledRes.ok) {
    assert(hasAnyLessons(bundledRes.data), 'Bundled group must have lessons');
  }

  // Test 4.2: 404 Not Found -> reason: 'not_found'
  globalThis.fetch = async () => {
    return {
      ok: false,
      status: 404,
      json: async () => ({})
    } as any;
  };
  const res404 = await loadGroupSchedule('mock-group-404');
  assert.strictEqual(res404.ok, false, '404 must return ok: false');
  if (!res404.ok) {
    assert.strictEqual(res404.reason, 'not_found', '404 status must result in reason: "not_found"');
  }

  // Test 4.3: Network error -> reason: 'network'
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch (offline)');
  };
  const resNet = await loadGroupSchedule('mock-group-net');
  assert.strictEqual(resNet.ok, false, 'Network failure must return ok: false');
  if (!resNet.ok) {
    assert.strictEqual(resNet.reason, 'network', 'Fetch exception must result in reason: "network"');
  }

  // Test 4.4: Corrupt JSON / non-schema data -> reason: 'invalid'
  globalThis.fetch = async () => {
    return {
      ok: true,
      status: 200,
      json: async () => ({ message: 'Not a schedule', timestamp: 12345 })
    } as any;
  };
  const resInvalid = await loadGroupSchedule('mock-group-invalid');
  assert.strictEqual(resInvalid.ok, false, 'Corrupt JSON chunk must return ok: false');
  if (!resInvalid.ok) {
    assert.strictEqual(resInvalid.reason, 'invalid', 'Invalid schema must result in reason: "invalid"');
  }

  // Test 4.5: Structurally valid JSON with 0 lessons -> reason: 'empty'
  globalThis.fetch = async () => {
    return {
      ok: true,
      status: 200,
      json: async () => buildSampleWeekData(0)
    } as any;
  };
  const resEmpty = await loadGroupSchedule('mock-group-empty');
  assert.strictEqual(resEmpty.ok, false, 'Schedule with 0 lessons must return ok: false');
  if (!resEmpty.ok) {
    assert.strictEqual(resEmpty.reason, 'empty', 'Zero lessons must result in reason: "empty"');
  }

  // Test 4.6: Successful load with valid lessons -> ok: true
  const realData = buildSampleWeekData(5);
  globalThis.fetch = async () => {
    return {
      ok: true,
      status: 200,
      json: async () => realData
    } as any;
  };
  const resSuccess = await loadGroupSchedule('mock-group-success');
  assert.strictEqual(resSuccess.ok, true, 'Valid schedule with lessons must return ok: true');
  if (resSuccess.ok) {
    assert.strictEqual(resSuccess.data[1][0].lessons.length, 1);
  }

  // Test 4.7: Timeout error -> reason: 'timeout'
  globalThis.fetch = async () => {
    const err: any = new Error('The operation was aborted');
    err.name = 'AbortError';
    throw err;
  };
  const resTimeout = await loadGroupSchedule('mock-group-timeout');
  assert.strictEqual(resTimeout.ok, false, 'Timeout must return ok: false');
  if (!resTimeout.ok) {
    assert.strictEqual(resTimeout.reason, 'timeout', 'AbortError must result in reason: "timeout"');
  }

  // Restore fetch
  globalThis.fetch = originalFetch;
}

await runMockFetchTests();

console.log('  [PASS] loadGroupSchedule accurately returns typed reasons: not_found, network, invalid, empty, timeout, and success.');

console.log('\n=================================================');
console.log('  ALL SCHEDULE SCHEMA & LOAD RESULT TESTS PASSED ');
console.log('=================================================\n');
