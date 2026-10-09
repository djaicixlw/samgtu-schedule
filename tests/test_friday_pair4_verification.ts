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
console.log(`Friday Week 2 has ${fri2.lessons.length} lessons (expected: 4)`);
assert.strictEqual(fri2.lessons.length, 4, "Friday Week 2 must have exactly 4 lessons!");

const expectedFriLessons = [
  { timeStart: '09:45', timeEnd: '11:20', subject: 'Элективные курсы по физической культуре и спорту' },
  { timeStart: '11:50', timeEnd: '13:25', subject: 'Техника и технология бурения нефтегазовых скважин' },
  { timeStart: '13:35', timeEnd: '15:10', subject: 'Технологии ресурсоповышающей обработки', teacher: 'Ибатуллин Ильдар Дугласович' },
  { timeStart: '15:40', timeEnd: '17:15', subject: 'Технологии ресурсоповышающей обработки', teacher: 'Ибатуллин Ильдар Дугласович' }
];

expectedFriLessons.forEach((exp, idx) => {
  const actual = fri2.lessons[idx];
  assert.strictEqual(actual.timeStart, exp.timeStart, `Lesson ${idx + 1} timeStart must be ${exp.timeStart}`);
  assert.strictEqual(actual.timeEnd, exp.timeEnd, `Lesson ${idx + 1} timeEnd must be ${exp.timeEnd}`);
  assert(actual.subject.includes(exp.subject), `Lesson ${idx + 1} subject must include ${exp.subject}`);
  if (exp.teacher) {
    assert.strictEqual(actual.teacher, exp.teacher, `Lesson ${idx + 1} teacher must be ${exp.teacher}`);
  }
  console.log(`  ✓ [PASS] Lesson ${idx + 1}: [${actual.timeStart} - ${actual.timeEnd}] ${actual.subject} (${actual.teacher || 'без преподавателя'})`);
});

// Check Tuesday Week 2
const tue2 = w2.find(d => d.dayName === 'Вторник');
assert(!!tue2, "Tuesday Week 2 exists");
console.log(`Tuesday Week 2 has ${tue2.lessons.length} lessons (expected: 2)`);
assert.strictEqual(tue2.lessons.length, 2, "Tuesday Week 2 must have exactly 2 lessons!");

assert.strictEqual(tue2.lessons[0].timeStart, '09:45');
assert(tue2.lessons[0].subject.includes('Практико-ориентированный проект'));
assert.strictEqual(tue2.lessons[0].teacher, 'Колибасов Владимир Александрович');

assert.strictEqual(tue2.lessons[1].timeStart, '11:50');
assert(tue2.lessons[1].subject.includes('Актуальные вопросы'));

console.log("  ✓ [PASS] Tuesday Week 2: 09:45 (Колибасов) and 11:50 (Актуальные вопросы) verified!");

// 2. Check public/schedules/ingt-310.json
const chunkPath = path.resolve(__dirname, '../public/schedules/ingt-310.json');
const chunkData = JSON.parse(fs.readFileSync(chunkPath, 'utf8'));
const chunkFri2 = chunkData['2']['4'];
assert.strictEqual(chunkFri2.lessons.length, 4, "public/schedules/ingt-310.json Friday Week 2 must have 4 lessons!");
assert.strictEqual(chunkFri2.lessons[3].timeStart, '15:40');
assert(chunkFri2.lessons[3].subject.includes('Технологии ресурсоповышающей обработки'));
console.log("  ✓ [PASS] public/schedules/ingt-310.json verified with 4 lessons on Friday!");

console.log("==================================================================");
console.log("  ALL FRIDAY & TUESDAY CHECKS PASSED WITH 100% ACCURACY!          ");
console.log("==================================================================");
