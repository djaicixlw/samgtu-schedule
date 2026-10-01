import assert from 'assert';
import {
  scheduleUrl,
  isScheduleLoaded,
  loadGroupSchedule,
  markScheduleLoaded,
  clearLoadedChunks,
  hasAnyLessons,
  getCanonicalScheduleId,
  registerScheduleAliases
} from '../utils/scheduleLoader';
import { SCHEDULE_REGISTRY, createEmptyWeek } from '../constants';
import { WeekData } from '../types';

console.log('=== TEST SUITE: Schedule URL Builder & isScheduleLoaded Fix ===\n');

// 1. URL Building Tests for various base paths
console.log('1. Testing scheduleUrl for various base paths...');

// Base '/'
assert.strictEqual(
  scheduleUrl('ingt-101', '/'),
  '/schedules/ingt-101.json',
  'Base / should produce /schedules/ingt-101.json'
);
assert.strictEqual(
  scheduleUrl('3-ИНГТ-110', '/'),
  '/schedules/ingt-310.json',
  'Alias 3-ИНГТ-110 should map to canonical ingt-310.json under base /'
);
console.log('  [PASS] Base "/" URL resolution correct.');

// Base './'
assert.strictEqual(
  scheduleUrl('ingt-101', './'),
  './schedules/ingt-101.json',
  'Base ./ should produce ./schedules/ingt-101.json'
);
assert.strictEqual(
  scheduleUrl('faid-310', './'),
  './schedules/faid-310.json',
  'Canonical faid-310 should produce ./schedules/faid-310.json'
);
console.log('  [PASS] Base "./" URL resolution correct.');

// Base '/samgtu-schedule/' (GitHub Pages subfolder)
assert.strictEqual(
  scheduleUrl('ingt-101', '/samgtu-schedule/'),
  '/samgtu-schedule/schedules/ingt-101.json',
  'Base /samgtu-schedule/ should produce /samgtu-schedule/schedules/ingt-101.json'
);
assert.strictEqual(
  scheduleUrl('3-ФАИД-110', '/samgtu-schedule/'),
  '/samgtu-schedule/schedules/faid-310.json',
  'Alias 3-ФАИД-110 should resolve to faid-310 under /samgtu-schedule/'
);
assert.strictEqual(
  scheduleUrl('ingt-209', '/samgtu-schedule'),
  '/samgtu-schedule/schedules/ingt-209.json',
  'Base without trailing slash (/samgtu-schedule) should normalize with trailing slash'
);
console.log('  [PASS] Base "/samgtu-schedule/" URL resolution correct.');

// Full document.baseURI (HTTP/HTTPS origin + path)
assert.strictEqual(
  scheduleUrl('ingt-101', 'https://aleblll.github.io/samgtu-schedule/'),
  'https://aleblll.github.io/samgtu-schedule/schedules/ingt-101.json',
  'Full base URI should resolve correctly'
);
assert.strictEqual(
  scheduleUrl('ingt-101', 'https://aleblll.github.io/samgtu-schedule/index.html'),
  'https://aleblll.github.io/samgtu-schedule/schedules/ingt-101.json',
  'Full base URI ending in index.html should strip filename and resolve correctly'
);
console.log('  [PASS] Full document.baseURI resolution correct.');

// 2. Logic Tests for isScheduleLoaded & Empty Week Exclusion
console.log('\n2. Testing isScheduleLoaded logic and createEmptyWeek() exclusion...');

clearLoadedChunks();

// Bundled group ingt-310 has real lessons in constants.ts
assert.strictEqual(
  isScheduleLoaded('ingt-310'),
  true,
  'Default bundled group ingt-310 with real lessons must be considered loaded'
);
assert.strictEqual(
  isScheduleLoaded('3-ИНГТ-110'),
  true,
  'Alias 3-ИНГТ-110 must be considered loaded'
);
console.log('  [PASS] Bundled group with lessons is recognized as loaded.');

// Unbundled group ingt-301 initialized with createEmptyWeek() in constants.ts
// MUST NOT be considered loaded!
assert.strictEqual(
  isScheduleLoaded('ingt-301'),
  false,
  'Empty weeks from createEmptyWeek() in ingt-301 must NOT be considered loaded'
);
assert.strictEqual(
  isScheduleLoaded('3-ИНГТ-101'),
  false,
  'Alias 3-ИНГТ-101 pointing to empty weeks must NOT be considered loaded'
);
console.log('  [PASS] Empty weeks from createEmptyWeek() correctly rejected as unbundled/unloaded.');

// Test hasAnyLessons helper directly
const emptyWeekData: WeekData = {
  1: createEmptyWeek(),
  2: createEmptyWeek(),
  3: createEmptyWeek(),
  4: createEmptyWeek()
};
assert.strictEqual(
  hasAnyLessons(emptyWeekData),
  false,
  'hasAnyLessons must return false for createEmptyWeek() structures'
);

const weekDataWithLesson: WeekData = {
  1: [
    {
      dayName: 'Понедельник',
      lessons: [
        {
          id: 'test-1',
          timeStart: '08:00',
          timeEnd: '09:35',
          subject: 'Высшая математика',
          type: 'Лекция',
          location: '1-100',
          teacher: 'Иванов И.И.'
        }
      ]
    }
  ],
  2: createEmptyWeek(),
  3: createEmptyWeek(),
  4: createEmptyWeek()
};
assert.strictEqual(
  hasAnyLessons(weekDataWithLesson),
  true,
  'hasAnyLessons must return true when at least one lesson exists'
);
console.log('  [PASS] hasAnyLessons helper correctly distinguishes empty and populated schedules.');

// 3. Mark schedule loaded & aliases
console.log('\n3. Testing registerScheduleAliases and markScheduleLoaded...');

registerScheduleAliases('test-sample-101', weekDataWithLesson);
assert.strictEqual(
  isScheduleLoaded('test-sample-101'),
  true,
  'Schedule registered with real lessons must be considered loaded'
);

clearLoadedChunks();
delete SCHEDULE_REGISTRY['test-sample-101'];

// 4. Testing loadGroupSchedule failure handling & retry capability
console.log('\n4. Testing loadGroupSchedule on failure (no permanent empty memory pollution)...');

async function testFailureRetry() {
  const result = await loadGroupSchedule('non-existent-999');
  assert(result, 'loadGroupSchedule must return fallback structure');
  assert.strictEqual(result[1].length, 6, 'Fallback must contain 6 days');
  assert.strictEqual(result[1][0].lessons.length, 0, 'Fallback day must have 0 lessons');

  // Verify memory was NOT permanently polluted with loaded status
  assert.strictEqual(
    isScheduleLoaded('non-existent-999'),
    false,
    'Failed chunk must NOT be marked as loaded in memory'
  );
  console.log('  [PASS] Failed chunk is not registered as loaded; retry remains possible.');
}

await testFailureRetry();

console.log('\n=================================================');
console.log('   ALL SCHEDULE URL & LOADER TESTS PASSED (100%)');
console.log('=================================================\n');
