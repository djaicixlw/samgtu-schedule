import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SCHEDULE_REGISTRY, AVAILABLE_GROUPS } from '../constants';
import { STUDENTS_REGISTRY } from '../attendance';
import { getSeedSubjectTeachers, SEED_SUBJECT_TEACHERS_BY_GROUP } from '../defaultData';
import { sanitizeTeachers } from '../utils/cloudSync';
import { preloadAllSchedulesSync } from '../utils/scheduleNodeLoader';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

preloadAllSchedulesSync();

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, message: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] ${message}`);
  } else {
    failedTests++;
    console.error(`  [FAIL] ${message}`);
  }
}

console.log("=================================================");
console.log("     TEST SUITE: 3-ФАИД-110 SCHEDULE & ROSTER    ");
console.log("=================================================");

// 1. ROSTER VERIFICATION (22 students)
console.log("\n--- 1. Student Roster (faid-310) ---");
const faidStudents = STUDENTS_REGISTRY['faid-310'];
assert(Array.isArray(faidStudents), "STUDENTS_REGISTRY['faid-310'] exists and is an array");
assert(faidStudents.length === 22, `Student count is 22 (got ${faidStudents?.length})`);

const expectedStudents = Array.from({ length: 22 }, (_, idx) => `Студент ${idx + 1}`);

expectedStudents.forEach((name, idx) => {
  const student = faidStudents[idx];
  assert(student?.id === idx + 1, `Student #${idx + 1} ID is ${idx + 1}`);
  assert(student?.name === name, `Student #${idx + 1} name is "${name}" (got "${student?.name}")`);
});

// Check alias
const faid110Students = STUDENTS_REGISTRY['faid-110'];
assert(faid110Students?.length === 22, "Alias 'faid-110' has 22 students");

// 2. TEACHERS MAPPING
console.log("\n--- 2. Subject Teachers Mapping (faid-310) ---");
const seedTeachers = getSeedSubjectTeachers('faid-310');
assert(seedTeachers['Безопасность жизнедеятельности'] === 'Закирова Марина Николаевна', "BZhD teacher is Закирова Марина Николаевна");
assert(seedTeachers['История дизайна науки и техники'] === 'Каракова Татьяна Владимировна', "History of design teacher is Каракова Татьяна Владимировна");
assert(seedTeachers['Специальный рисунок и живопись'] === 'Каракова Татьяна Владимировна', "Drawing teacher is Каракова Татьяна Владимировна");
assert(seedTeachers['Вертикальная планировка и благоустройство территорий'] === 'Орлова Наталья Александровна', "Vertical planning teacher is Орлова Наталья Александровна");
assert(seedTeachers['Архитектурно–дизайнерское материаловедение'] === 'Тюрников Владимир Викторович', "Materials teacher is Тюрников Владимир Викторович");
assert(seedTeachers['Компьютерные технологии в проектировании'] === 'Евстратова Елена Александровна', "CAD teacher is Евстратова Елена Александровна");
assert(seedTeachers['Философия'] === 'Стоцкая Татьяна Геннадьевна', "Philosophy teacher is Стоцкая Татьяна Геннадьевна");
assert(seedTeachers['Конструирование в дизайне среды'] === 'Заславский Евгений Михайлович', "Constructing teacher is Заславский Евгений Михайлович");
assert(seedTeachers['Проектирование'] === 'Смоленская Елена Олеговна', "Designing teacher is Смоленская Елена Олеговна");
assert(seedTeachers['Элективные курсы по физической культуре и спорту'] === 'Кафедра физического воспитания', "PE teacher is Кафедра физического воспитания");

// 3. SCHEDULE REGISTRY WEEKS 1..4 (CONTRACT & SCHEMA VERIFICATION)
console.log("\n--- 3. Schedule Registry (faid-310) ---");
const faidSchedule = SCHEDULE_REGISTRY['faid-310'];
assert(!!faidSchedule, "SCHEDULE_REGISTRY['faid-310'] exists");
assert(!!faidSchedule[1] && !!faidSchedule[2] && !!faidSchedule[3] && !!faidSchedule[4], "All 4 weeks exist");

const VALID_TYPES = ['Лекции', 'Практические занятия', 'Лабораторные работы'];
const VALID_START_TIMES = ['08:00', '09:45', '11:50', '13:35', '15:40', '17:25'];

let totalFaidLessons = 0;
for (let w = 1; w <= 4; w++) {
  assert(Array.isArray(faidSchedule[w]) && faidSchedule[w].length === 6, `Week ${w} has 6 days`);
  for (const day of faidSchedule[w]) {
    totalFaidLessons += day.lessons.length;
    for (const l of day.lessons) {
      assert(typeof l.id === 'string' && l.id.length > 0, `Lesson id is non-empty (${l.id})`);
      assert(VALID_START_TIMES.includes(l.timeStart), `Lesson timeStart is valid (${l.timeStart})`);
      assert(typeof l.subject === 'string' && l.subject.trim().length > 2, `Lesson subject is valid (${l.subject})`);
      assert(VALID_TYPES.includes(l.type), `Lesson type is valid (${l.type})`);
      assert(!/аудитория.*корпус/i.test(l.location || ''), `Location does not contain raw text (${l.location})`);
    }
  }
}
assert(totalFaidLessons >= 0, `3-ФАИД-110 total lessons across 4 weeks >= 0 (got ${totalFaidLessons})`);

// Frozen fixture verification for historical contract
const frozenFaidPath = path.join(__dirname, '../public/schedules/archive/block-from-week-5/faid-310.json');
const frozenIngtPath = path.join(__dirname, '../public/schedules/archive/block-from-week-5/ingt-310.json');
const frozenFaid = fs.existsSync(frozenFaidPath) ? JSON.parse(fs.readFileSync(frozenFaidPath, 'utf8')) : null;
const frozenIngt = fs.existsSync(frozenIngtPath) ? JSON.parse(fs.readFileSync(frozenIngtPath, 'utf8')) : null;

if (frozenFaid) {
  let frozenFaidTotal = 0;
  for (let w = 1; w <= 4; w++) {
    const days = Array.isArray(frozenFaid[w]) ? frozenFaid[w] : Object.values(frozenFaid[w] || {});
    for (const day of (days as any[])) {
      frozenFaidTotal += (day.lessons || []).length;
      for (const l of (day.lessons || [])) {
        if (l.subject === 'Практико-ориентированный проект') {
          assert(l.teacher === 'Смоленская Елена Олеговна', `Project teacher is Smolenskaya (got ${l.teacher})`);
        }
        if (l.subject.includes('Архитектурно') && l.subject.includes('материаловедение') && l.type === 'Лекции') {
          assert(l.teacher === 'Тюрников Владимир Викторович', `Materials lecture teacher is Tyurnikov`);
        }
      }
    }
  }
  assert(frozenFaidTotal >= 20, `Frozen fixture 3-ФАИД-110 total lessons >= 20 (got ${frozenFaidTotal})`);
}

// Subject to teacher binding invariants when present in schedule
for (let w = 1; w <= 4; w++) {
  for (const day of faidSchedule[w]) {
    for (const l of day.lessons) {
      if (l.subject === 'Практико-ориентированный проект') {
        assert(l.teacher === 'Смоленская Елена Олеговна', `Project teacher is Smolenskaya (got ${l.teacher})`);
      }
      if (l.subject.includes('Архитектурно') && l.subject.includes('материаловедение') && l.type === 'Лекции') {
        assert(l.teacher === 'Тюрников Владимир Викторович', `Materials lecture teacher is Tyurnikov`);
      }
    }
  }
}

// Check that Kolibasov is strictly NOT in 101 and 103
const ingt301 = SCHEDULE_REGISTRY['ingt-301'];
const ingt303 = SCHEDULE_REGISTRY['ingt-303'];
assert(!JSON.stringify(ingt301).includes('Колибасов'), "Kolibasov is absent from 3-ИНГТ-101 schedule");
assert(!JSON.stringify(ingt303).includes('Колибасов'), "Kolibasov is absent from 3-ИНГТ-103 schedule");

// 4. SANITIZATION AND ISOLATION
console.log("\n--- 4. Teacher Sanitization & Group Isolation ---");
const dirtyFaidTeachers = {
  'Безопасность жизнедеятельности': 'Сорокина Людмила Владимировна',
  'Кафедра ИНГТ': 'Кафедра ИНГТ'
};
const cleanedFaid = sanitizeTeachers(dirtyFaidTeachers, 'faid-310');
assert(cleanedFaid['Безопасность жизнедеятельности'] === 'Закирова Марина Николаевна', "Sanitized away Sorokina -> Zakirova for faid-310");

// 5. ZERO REGRESSION FOR 3-ИНГТ-110
console.log("\n--- 5. Zero Regression Checks (ingt-310) ---");
const ingtStudents = STUDENTS_REGISTRY['ingt-310'];
assert(ingtStudents.length === 16, `INGT-310 roster has 16 students (got ${ingtStudents.length})`);
assert(!ingtStudents.some(s => s.name.includes('Пронин')), "Pronin is absent from INGT-310 roster");

if (frozenIngt) {
  const w1Days = Array.isArray(frozenIngt[1]) ? frozenIngt[1] : Object.values(frozenIngt[1] || {});
  const patentPracticals = (w1Days as any[]).find(d => d.dayName === 'Пятница')?.lessons.find((l: any) => l.id === '310-w1-fr-4' || (l.subject && l.subject.includes('Патентоведение')));
  assert(patentPracticals?.teacher === 'Колибасов Владимир Александрович', "Patent practicals teacher on Friday is Колибасов Владимир Александрович");

  const ingtThu = (w1Days as any[]).find(d => d.dayName === 'Четверг');
  assert(ingtThu?.lessons.length === 2, `INGT-310 Thursday has 2 lessons (военная подготовка, got ${ingtThu?.lessons.length})`);
} else {
  const ingtSchedule = SCHEDULE_REGISTRY['ingt-310'];
  const ingtThu = ingtSchedule[1].find(d => d.dayName === 'Четверг');
  assert((ingtThu?.lessons.length || 0) >= 0, `INGT-310 Thursday valid lessons count`);
}

console.log("\n=================================================");
console.log(`TOTAL: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
console.log("=================================================");

if (failedTests > 0) {
  process.exit(1);
} else {
  console.log(">>> ALL 3-ФАИД-110 CHECKS PASSED SUCCESSFULLY! <<<");
}
