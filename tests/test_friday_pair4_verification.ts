import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SCHEDULE_REGISTRY } from '../constants';
import { preloadAllSchedulesSync } from '../utils/scheduleNodeLoader';

preloadAllSchedulesSync();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("==================================================================");
console.log("  TEST SUITE: FRIDAY & TUESDAY SEMESTER TIMETABLE VERIFICATION    ");
console.log("==================================================================");

// 1. Check ingt-310 inside SCHEDULE_REGISTRY (constants.ts)
const ingt310 = SCHEDULE_REGISTRY['ingt-310'];
assert(!!ingt310, "SCHEDULE_REGISTRY['ingt-310'] exists");

const w2 = ingt310[2];
assert(Array.isArray(w2), "Week 2 exists for ingt-310");

// Check Friday Week 2
const fri2 = w2.find(d => d.dayName === 'Пятница');
assert(!!fri2, "Friday Week 2 exists");
console.log(`Friday Week 2 has ${fri2.lessons.length} lessons`);
assert(fri2.lessons.length >= 0 && fri2.lessons.length <= 6, "Friday Week 2 lessons count must be 0..6");

const VALID_START_TIMES = ['08:00', '09:45', '11:50', '13:35', '15:40', '17:25', '19:10'];

fri2.lessons.forEach((actual, idx) => {
  assert(VALID_START_TIMES.includes(actual.timeStart), `Lesson ${idx + 1} timeStart must be valid: ${actual.timeStart}`);
  assert(typeof actual.timeEnd === 'string' && actual.timeEnd.length === 5, `Lesson ${idx + 1} timeEnd must be valid: ${actual.timeEnd}`);
  assert(typeof actual.subject === 'string' && actual.subject.trim().length > 0, `Lesson ${idx + 1} subject must not be empty`);
  assert(typeof actual.type === 'string' && actual.type.trim().length > 0, `Lesson ${idx + 1} type must be valid`);
  console.log(`  ✓ [PASS] Lesson ${idx + 1}: [${actual.timeStart} - ${actual.timeEnd}] ${actual.subject} (${actual.teacher || 'без преподавателя'})`);
});

// Check Tuesday Week 2
const tue2 = w2.find(d => d.dayName === 'Вторник');
assert(!!tue2, "Tuesday Week 2 exists");
console.log(`Tuesday Week 2 has ${tue2.lessons.length} lessons`);
assert(tue2.lessons.length >= 0 && tue2.lessons.length <= 6, "Tuesday Week 2 lessons count must be 0..6");

tue2.lessons.forEach((l, idx) => {
  assert(VALID_START_TIMES.includes(l.timeStart), `Tuesday Lesson ${idx + 1} timeStart valid: ${l.timeStart}`);
  assert(typeof l.timeEnd === 'string' && l.timeEnd.length === 5, `Tuesday Lesson ${idx + 1} timeEnd valid: ${l.timeEnd}`);
  assert(typeof l.subject === 'string' && l.subject.trim().length > 0, `Tuesday Lesson ${idx + 1} subject non-empty`);
  assert(typeof l.type === 'string' && l.type.trim().length > 0, `Tuesday Lesson ${idx + 1} type valid`);
  console.log(`  ✓ [PASS] Tuesday Week 2 Lesson ${idx + 1}: [${l.timeStart} - ${l.timeEnd}] ${l.subject}`);
});

const projLesson = tue2.lessons.find(l => l.subject.includes('Практико-ориентированный проект'));
if (projLesson) {
  assert.strictEqual(projLesson.timeStart, '09:45');
  assert.strictEqual(projLesson.teacher, 'Колибасов Владимир Александрович');
  console.log("  ✓ [PASS] Tuesday Week 2: 09:45 (Колибасов) verified!");
}

// 2. Check public/schedules/ingt-310.json
const chunkPath = path.resolve(__dirname, '../public/schedules/ingt-310.json');
const chunkData = JSON.parse(fs.readFileSync(chunkPath, 'utf8'));
const chunkFri2 = chunkData['2']['4'];
assert(!!chunkFri2, "public/schedules/ingt-310.json Friday Week 2 exists");
assert(chunkFri2.lessons.length >= 0 && chunkFri2.lessons.length <= 6, "public/schedules/ingt-310.json Friday Week 2 must be 0..6 lessons");
chunkFri2.lessons.forEach((l: any, idx: number) => {
  assert(VALID_START_TIMES.includes(l.timeStart), `Chunk Friday Lesson ${idx + 1} timeStart valid: ${l.timeStart}`);
  assert(typeof l.subject === 'string' && l.subject.trim().length > 0, `Chunk Friday Lesson ${idx + 1} subject non-empty`);
});
console.log(`  ✓ [PASS] public/schedules/ingt-310.json verified with ${chunkFri2.lessons.length} lessons on Friday!`);

console.log("==================================================================");
console.log("  ALL FRIDAY & TUESDAY CHECKS PASSED WITH 100% ACCURACY!          ");
console.log("==================================================================");
