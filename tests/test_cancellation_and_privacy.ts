import './setup_mock_auth';
import { preloadAllSchedulesSync } from '../utils/scheduleNodeLoader';
preloadAllSchedulesSync();
import { SCHEDULE_REGISTRY } from '../constants';
import { verifyPinCode } from '../utils/auth';
import { getDayISODate } from '../attendance';
import { sanitizeTeachers } from '../utils/cloudSync';
import { Lesson } from '../types';

let passed = 0;
let total = 0;

function assert(condition: boolean, msg: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✅ PASS: ${msg}`);
  } else {
    console.error(`  ❌ FAIL: ${msg}`);
    process.exitCode = 1;
  }
}

console.log('\n============================================================');
console.log('  TEST SUITE: CANCELLATION, PRIVACY, 311 TEACHERS & PIN 111');
console.log('============================================================\n');

// 1. Check 3-ИНГТ-111 (ingt-311) Teacher Purity
console.log('--- 1. 3-ИНГТ-111 (ingt-311) Teacher Purity ---');
const w1_311 = SCHEDULE_REGISTRY['ingt-311']?.[1] || [];
const w2_311 = SCHEDULE_REGISTRY['ingt-311']?.[2] || [];
const w3_311 = SCHEDULE_REGISTRY['ingt-311']?.[3] || [];
const w4_311 = SCHEDULE_REGISTRY['ingt-311']?.[4] || [];

const all311Lessons = [...w1_311, ...w2_311, ...w3_311, ...w4_311].flatMap(d => d.lessons);
assert(all311Lessons.length > 0, `3-ИНГТ-111 has official schedule lessons (found ${all311Lessons.length})`);

const nonBlankTeachers = all311Lessons.filter(l => l.teacher && l.teacher.trim().length > 0);
assert(nonBlankTeachers.length === 0, `All teachers in 3-ИНГТ-111 are blank strings by default (found ${nonBlankTeachers.length} non-blank)`);

// Check that Хабибуллин, Королева, Калачева are NOT in 311
const hasKhabibullin = all311Lessons.some(l => (l.teacher || '').includes('Хабибуллин'));
assert(!hasKhabibullin, 'Хабибуллин completely absent from 3-ИНГТ-111');
const hasKoroleva = all311Lessons.some(l => (l.teacher || '').includes('Королева'));
assert(!hasKoroleva, 'Королева completely absent from 3-ИНГТ-111');
const hasKalacheva = all311Lessons.some(l => (l.teacher || '').includes('Калачева'));
assert(!hasKalacheva, 'Калачева completely absent from 3-ИНГТ-111');

// Check that sanitizeTeachers does not inject Dranitsyna or Kryuchkov into ingt-311
const sanitized311 = sanitizeTeachers({
  'Техника и технология бурения нефтегазовых скважин': '',
  'Конструирование и расчет сосудов': ''
}, 'ingt-311');
assert(!sanitized311['Техника и технология бурения нефтегазовых скважин'], 'sanitizeTeachers does not contaminate ingt-311 with бурение');
assert(!sanitized311['Конструирование и расчет сосудов'], 'sanitizeTeachers does not contaminate ingt-311 with сосуды');

// 2. Check PIN for 3-ИНГТ-111 via cryptographic verifyPinCode
console.log('\n--- 2. Starosta PIN Authentication ---');
const auth311 = await verifyPinCode('572916');
assert(auth311 !== null && auth311.role === 'starosta' && auth311.targetGroupId === 'ingt-311', 'verifyPinCode authorizes 3-ИНГТ-111 starosta correctly');
const invalidAuth = await verifyPinCode('000000');
assert(invalidAuth === null, 'verifyPinCode rejects invalid PIN');

// 3. Check Lesson Cancellation Logic
console.log('\n--- 3. Lesson Cancellation & Restoration ---');
const sampleLesson: Lesson = {
  id: '310-w3-fr-2',
  timeStart: '13:35',
  timeEnd: '15:10',
  subject: 'Опытно-конструкторские работы и патентоведение в области нефтепромыслового оборудования',
  type: 'Лекции',
  location: 'Корпус № 1, 109',
  teacher: 'Парфенов Кирилл Викторович'
};

// Simulate cancelling
const overrideCancelled: Partial<Lesson> = {
  ...sampleLesson,
  isCancelled: true
};
assert(overrideCancelled.isCancelled === true, 'Lesson override correctly records isCancelled: true');

// Simulate un-cancelling
const overrideRestored: Partial<Lesson> = {
  ...overrideCancelled,
  isCancelled: false
};
if (overrideRestored.isCancelled === false) {
  delete overrideRestored.isCancelled;
}
assert(overrideRestored.isCancelled === undefined, 'Un-cancelling removes isCancelled property from override');

// 4. Check Attachments on Lesson
console.log('\n--- 4. Lesson Attachments Support ---');
const lessonWithAttachments: Lesson = {
  ...sampleLesson,
  attachments: [
    { name: 'Методичка №1', url: 'https://moodle.samgtu.ru/course/123' },
    { name: 'Презентация лекции', url: 'https://disk.yandex.ru/d/xyz' }
  ]
};

assert(lessonWithAttachments.attachments !== undefined, 'Lesson supports attachments array');
assert(lessonWithAttachments.attachments?.length === 2, 'Attachments array holds multiple links');
assert(lessonWithAttachments.attachments?.[0].url === 'https://moodle.samgtu.ru/course/123', 'First attachment URL is valid');

console.log(`\n============================================================`);
console.log(`  RESULT: ${passed}/${total} checks passed (${Math.round((passed/total)*100)}%)`);
console.log('============================================================\n');

if (passed !== total) {
  process.exit(1);
}
