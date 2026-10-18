import assert from 'assert';
import { 
  isPhysicalEducationLesson, 
  isPhysicalEducationLessonId 
} from '../utils/scheduleLoader';
import { 
  parseTimeToMinutes, 
  getSamaraTimeHM, 
  getDayName, 
  samaraISO 
} from '../utils/samaraDate';
import { 
  calculateStudentAbsenceHours, 
  AttendanceRecord 
} from '../attendance';
import { SCHEDULE_REGISTRY } from '../constants';

console.log('=================================================================');
console.log('   TEST SUITE: STAGE 2 - SCHEDULE, PE FILTER & AUTOSCROLL ENGINE ');
console.log('=================================================================\n');

// -----------------------------------------------------------------------------
// 1. Physical Education Detection & Safety Preservation
// -----------------------------------------------------------------------------
console.log('1. Testing isPhysicalEducationLesson...');

const peSubjects = [
  'Элективные курсы по физической культуре и спорту',
  'Элективные курсы по физической культуре',
  'Физическая культура и спорт',
  'Физическая культура',
  'Физкультура',
  'Прикладная физическая культура и спорт',
  'элективные курсы по физической культуре и спорту'
];

for (const subj of peSubjects) {
  assert.strictEqual(
    isPhysicalEducationLesson({ subject: subj }), 
    true, 
    `Should recognize "${subj}" as PE`
  );
}

// Ensure non-PE subjects, especially Physics and Military (VUC), are NEVER filtered:
const safeSubjects = [
  'Физика',
  'Физическая химия',
  'Физика горных пород',
  'Компьютерное моделирование физических процессов и систем',
  'Современные методы постановки физического эксперимента',
  'Основы военной подготовки',
  'Военная подготовка',
  'ВУЦ',
  'Математический анализ',
  'Технологии ресурсоповышающей обработки'
];

for (const subj of safeSubjects) {
  assert.strictEqual(
    isPhysicalEducationLesson({ subject: subj }), 
    false, 
    `"${subj}" MUST NOT be flagged as PE!`
  );
}
console.log('  ✓ [PASS] PE filter accurately recognizes PE while strictly preserving Physics and VUC.');

// -----------------------------------------------------------------------------
// 2. isPhysicalEducationLessonId resolution across registries
// -----------------------------------------------------------------------------
console.log('\n2. Testing isPhysicalEducationLessonId...');

// ingt-310 has PE lesson: '310-w2-fr-1'
const isPeLesson = isPhysicalEducationLessonId('310-w2-fr-1', 'ingt-310');
assert.strictEqual(isPeLesson, true, '310-w2-fr-1 must be identified as PE');

// ingt-310 has VUC lesson: '310-w2-th-1' (Основы военной подготовки)
const isVucLesson = isPhysicalEducationLessonId('310-w2-th-1', 'ingt-310');
assert.strictEqual(isVucLesson, false, '310-w2-th-1 (ВУЦ) must NOT be flagged as PE');

console.log('  ✓ [PASS] Lesson IDs accurately map to PE status without affecting VUC.');

// -----------------------------------------------------------------------------
// 3. Attendance Calculation Excludes PE
// -----------------------------------------------------------------------------
console.log('\n3. Testing attendance absence calculation exclusion for PE...');

const sampleRecords: AttendanceRecord[] = [
  {
    groupId: 'ingt-310',
    date: '2026-09-18', // Friday Week 2
    lessonId: '310-w2-fr-1', // PE lesson!
    absentStudentIds: [1, 2],
    excusedStudentIds: [],
    isCancelled: false
  },
  {
    groupId: 'ingt-310',
    date: '2026-09-17', // Thursday Week 2
    lessonId: '310-w2-th-1', // VUC lesson!
    absentStudentIds: [1],
    excusedStudentIds: [],
    isCancelled: false
  }
];

const statsStudent1 = calculateStudentAbsenceHours(sampleRecords, 1);
// Student 1 was absent on PE (should be ignored) and VUC (should count as 2 hours)
assert.strictEqual(statsStudent1.totalAbs, 2, 'Student 1 must have exactly 2h absence from VUC, 0h from PE');

const statsStudent2 = calculateStudentAbsenceHours(sampleRecords, 2);
// Student 2 was ONLY absent on PE
assert.strictEqual(statsStudent2.totalAbs, 0, 'Student 2 must have 0h absence because PE is excluded');

console.log('  ✓ [PASS] Attendance absence hours exclude PE while preserving VUC.');

// -----------------------------------------------------------------------------
// 4. Time Parsing & Current/Upcoming Pair Detection
// -----------------------------------------------------------------------------
console.log('\n4. Testing time parsing and HM utilities...');

assert.strictEqual(parseTimeToMinutes('08:00'), 480);
assert.strictEqual(parseTimeToMinutes('09:35'), 575);
assert.strictEqual(parseTimeToMinutes('11:50'), 710);
assert.strictEqual(parseTimeToMinutes(''), -1);
assert.strictEqual(parseTimeToMinutes(undefined), -1);

const [curH, curM] = getSamaraTimeHM();
assert(typeof curH === 'number' && curH >= 0 && curH <= 23, 'Valid Samara hour');
assert(typeof curM === 'number' && curM >= 0 && curM <= 59, 'Valid Samara minute');

console.log('  ✓ [PASS] Time helpers successfully parse HH:MM to minute offsets.');

// -----------------------------------------------------------------------------
// 5. Default Day Selection
// -----------------------------------------------------------------------------
console.log('\n5. Testing default today day name resolution...');

const todayDay = getDayName(samaraISO());
const validDays = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
assert(validDays.includes(todayDay), `Resolved todayDay "${todayDay}" must be a valid Russian day name`);

console.log(`  ✓ [PASS] getDayName(samaraISO()) returns: "${todayDay}".`);

console.log('\n=================================================================');
console.log('   ALL STAGE 2 TESTS PASSED (100%)');
console.log('=================================================================\n');
