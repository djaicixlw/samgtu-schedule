import { SCHEDULE_REGISTRY, AVAILABLE_GROUPS } from '../constants';
import { STUDENTS_REGISTRY } from '../attendance';
import { getSeedSubjectTeachers, SEED_SUBJECT_TEACHERS_BY_GROUP } from '../defaultData';
import { sanitizeTeachers } from '../utils/cloudSync';

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

const expectedStudents = [
  "Аверьянова Дарья",
  "Антоненко Георгий",
  "Баландина Валерия",
  "Бурханова Виктория",
  "Винк Полина",
  "Внучкова Мария",
  "Губарева Алёна",
  "Зацепина Полина",
  "Зубалова Мария",
  "Иванов Никита",
  "Кирина Варвара",
  "Левина Валерия",
  "Манасыпов Даниил",
  "Петрова Полина",
  "Пивоварова Дарья",
  "Сафонова Виктория",
  "Романова Дарья",
  "Селиванова Юлия",
  "Ушмаева Дарья",
  "Хведчик Вера",
  "Юрьева Ангелина",
  "Яблонская Полина"
];

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

// 3. SCHEDULE REGISTRY WEEKS 1..4
console.log("\n--- 3. Schedule Registry (faid-310) ---");
const faidSchedule = SCHEDULE_REGISTRY['faid-310'];
assert(!!faidSchedule, "SCHEDULE_REGISTRY['faid-310'] exists");
assert(!!faidSchedule[1] && !!faidSchedule[2] && !!faidSchedule[3] && !!faidSchedule[4], "All 4 weeks exist");

// Week 1: Mon 4, Tue 4, Wed 5, Thu 5 (18 lessons)
const w1Mon = faidSchedule[1].find(d => d.dayName === 'Понедельник');
assert(w1Mon?.lessons.length === 4, `Week 1 Monday has 4 lessons (got ${w1Mon?.lessons.length})`);
assert(w1Mon?.lessons[0].timeStart === '11:50', "W1 Mo L1: PE (11:50-13:25)");

// Week 1 Tuesday: 4 lessons
const w1Tue = faidSchedule[1].find(d => d.dayName === 'Вторник');
assert(w1Tue?.lessons.length === 4, `Week 1 Tuesday has 4 lessons (got ${w1Tue?.lessons.length})`);
assert(w1Tue?.lessons[0].timeStart === '09:45' && w1Tue?.lessons[0].teacher === 'Закирова Марина Николаевна', "W1 Tu L1: BZhD (09:45-11:20) Zakirova");
assert(w1Tue?.lessons[1].timeStart === '11:50' && w1Tue?.lessons[1].teacher === 'Каракова Татьяна Владимировна', "W1 Tu L2: History of design (11:50-13:25) Karakova");
assert(w1Tue?.lessons[2].timeStart === '13:35' && w1Tue?.lessons[2].teacher === 'Орлова Наталья Александровна', "W1 Tu L3: Vertical planning (13:35-15:10) Orlova");
assert(w1Tue?.lessons[3].timeStart === '15:40' && w1Tue?.lessons[3].teacher === 'Орлова Наталья Александровна', "W1 Tu L4: Vertical planning practice (15:40-17:15) Orlova");

// Week 1 Wednesday: 5 lessons
const w1Wed = faidSchedule[1].find(d => d.dayName === 'Среда');
assert(w1Wed?.lessons.length === 5, `Week 1 Wednesday has 5 lessons (got ${w1Wed?.lessons.length})`);
assert(w1Wed?.lessons[0].subject.includes('Архитектурно') && w1Wed?.lessons[0].subject.includes('материаловедение'), "W1 We L1: Materials lecture");
assert(w1Wed?.lessons[1].type === 'Лабораторные работы', "W1 We L2: Materials lab");
assert(w1Wed?.lessons[2].subject === 'Компьютерные технологии в проектировании', "W1 We L3: Computer tech practice 1");
assert(w1Wed?.lessons[3].subject === 'Компьютерные технологии в проектировании', "W1 We L4: Computer tech practice 2");
assert(w1Wed?.lessons[4].subject === 'Элективные курсы по физической культуре и спорту', "W1 We L5: PE practice");

// Week 1 Thursday: 5 lessons
const w1Thu = faidSchedule[1].find(d => d.dayName === 'Четверг');
assert(w1Thu?.lessons.length === 5, `Week 1 Thursday has 5 lessons (got ${w1Thu?.lessons.length})`);
assert(w1Thu?.lessons[0].subject === 'Специальный рисунок и живопись', "W1 Th L1: Drawing 1");
assert(w1Thu?.lessons[1].subject === 'Специальный рисунок и живопись', "W1 Th L2: Drawing 2");
assert(w1Thu?.lessons[2].subject === 'Проектирование' && w1Thu?.lessons[2].teacher === 'Смоленская Елена Олеговна', "W1 Th L3: Design 1 Smolenskaya");
assert(w1Thu?.lessons[3].subject === 'Проектирование' && w1Thu?.lessons[3].teacher === 'Смоленская Елена Олеговна', "W1 Th L4: Design 2 Smolenskaya");
assert(w1Thu?.lessons[4].subject === 'Философия' && w1Thu?.lessons[4].teacher === 'Стоцкая Татьяна Геннадьевна', "W1 Th L5: Philosophy Stotskaya");

// Week 2 Monday: 5 lessons
const w2Mon = faidSchedule[2].find(d => d.dayName === 'Понедельник');
assert(w2Mon?.lessons.length === 5, `Week 2 Monday has 5 lessons (got ${w2Mon?.lessons.length})`);
assert(w2Mon?.lessons[0].subject === 'Проектирование', "W2 Mo L1: Design 1");
assert(w2Mon?.lessons[1].subject === 'Проектирование', "W2 Mo L2: Design 2");
assert(w2Mon?.lessons[2].subject === 'Безопасность жизнедеятельности' && w2Mon?.lessons[2].location.includes('462'), "W2 Mo L3: BZhD practice room 462");
assert(w2Mon?.lessons[3].subject === 'Конструирование в дизайне среды' && w2Mon?.lessons[3].teacher === 'Заславский Евгений Михайлович', "W2 Mo L4: Constructing lecture Zaslavsky");
assert(w2Mon?.lessons[4].subject === 'Конструирование в дизайне среды' && w2Mon?.lessons[4].teacher === 'Заславский Евгений Михайлович', "W2 Mo L5: Constructing practice Zaslavsky");

// Week 2 Tuesday: 1 lesson (Практико-ориентированный проект)
const w2Tue = faidSchedule[2].find(d => d.dayName === 'Вторник');
assert(w2Tue?.lessons.length === 1, `Week 2 Tuesday has 1 lesson (got ${w2Tue?.lessons.length})`);
assert(w2Tue?.lessons[0].subject === 'Практико-ориентированный проект' && w2Tue?.lessons[0].teacher === 'Смоленская Елена Олеговна', "W2 Tu L1: Project Smolenskaya");

// Week 2 Wednesday: 5 lessons
const w2Wed = faidSchedule[2].find(d => d.dayName === 'Среда');
assert(w2Wed?.lessons.length === 5, `Week 2 Wednesday has 5 lessons (got ${w2Wed?.lessons.length})`);

// Week 2 Thursday: 5 lessons
const w2Thu = faidSchedule[2].find(d => d.dayName === 'Четверг');
assert(w2Thu?.lessons.length === 5, `Week 2 Thursday has 5 lessons (got ${w2Thu?.lessons.length})`);
assert(w2Thu?.lessons[0].type === 'Лабораторные работы' && w2Thu?.lessons[0].subject === 'Безопасность жизнедеятельности', "W2 Th L1: BZhD lab");
assert(w2Thu?.lessons[1].subject === 'История дизайна науки и техники', "W2 Th L2: History of design");
assert(w2Thu?.lessons[2].subject === 'Вертикальная планировка и благоустройство территорий', "W2 Th L3: Vertical planning practice");
assert(w2Thu?.lessons[3].subject === 'Проектирование' && w2Thu?.lessons[3].timeStart === '15:40', "W2 Th L4: Design 1");
assert(w2Thu?.lessons[4].subject === 'Проектирование' && w2Thu?.lessons[4].timeStart === '17:25', "W2 Th L5: Design 2");

// Week 3 Monday: 4 lessons
const w3Mon = faidSchedule[3].find(d => d.dayName === 'Понедельник');
assert(w3Mon?.lessons.length === 4, `Week 3 Monday has 4 lessons (got ${w3Mon?.lessons.length})`);
assert(w3Mon?.lessons[0].subject === 'Элективные курсы по физической культуре и спорту' && w3Mon?.lessons[0].timeStart === '11:50', "W3 Mo L1: PE practice");
assert(w3Mon?.lessons[1].subject === 'Философия' && w3Mon?.lessons[1].timeStart === '13:35' && w3Mon?.lessons[1].teacher === 'Стоцкая Татьяна Геннадьевна', "W3 Mo L2: Philosophy Moodle Stotskaya");
assert(w3Mon?.lessons[2].subject === 'Проектирование' && w3Mon?.lessons[2].timeStart === '15:40' && w3Mon?.lessons[2].teacher === 'Смоленская Елена Олеговна', "W3 Mo L3: Design practice 1");
assert(w3Mon?.lessons[3].subject === 'Проектирование' && w3Mon?.lessons[3].timeStart === '17:25' && w3Mon?.lessons[3].teacher === 'Смоленская Елена Олеговна', "W3 Mo L4: Design practice 2");

// Week 3 Tuesday: 4 lessons
const w3Tue = faidSchedule[3].find(d => d.dayName === 'Вторник');
assert(w3Tue?.lessons.length === 4, `Week 3 Tuesday has 4 lessons (got ${w3Tue?.lessons.length})`);

// Week 4 Monday: 5 lessons
const w4Mon = faidSchedule[4].find(d => d.dayName === 'Понедельник');
assert(w4Mon?.lessons.length === 5, `Week 4 Monday has 5 lessons (got ${w4Mon?.lessons.length})`);

// Week 4 Tuesday: 2 lessons (Актуальные вопросы... and Практико-ориентированный проект)
const w4Tue = faidSchedule[4].find(d => d.dayName === 'Вторник');
assert(w4Tue?.lessons.length === 2, `Week 4 Tuesday has 2 lessons (got ${w4Tue?.lessons.length})`);
assert(w4Tue?.lessons[1].subject === 'Практико-ориентированный проект' && w4Tue?.lessons[1].teacher === 'Смоленская Елена Олеговна', "W4 Tu L2: Project Smolenskaya");

// Check total lessons across all 4 weeks = 69 (18 + 16 + 18 + 17)
let totalFaidLessons = 0;
for (let w = 1; w <= 4; w++) {
  faidSchedule[w].forEach(day => totalFaidLessons += day.lessons.length);
}
assert(totalFaidLessons === 69, `3-ФАИД-110 total lessons across 4 weeks is 69 (got ${totalFaidLessons})`);

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

const ingtSchedule = SCHEDULE_REGISTRY['ingt-310'];
const patentPracticals = ingtSchedule[1].find(d => d.dayName === 'Пятница')?.lessons.find(l => l.id === '310-w1-fr-4');
assert(patentPracticals?.teacher === 'Колибасов Владимир Александрович', "Patent practicals teacher on Friday is Колибасов Владимир Александрович");

const ingtThu = ingtSchedule[1].find(d => d.dayName === 'Четверг');
assert(ingtThu?.lessons.length === 2, `INGT-310 Thursday has 2 lessons (военная подготовка, got ${ingtThu?.lessons.length})`);

console.log("\n=================================================");
console.log(`TOTAL: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
console.log("=================================================");

if (failedTests > 0) {
  process.exit(1);
} else {
  console.log(">>> ALL 3-ФАИД-110 CHECKS PASSED SUCCESSFULLY! <<<");
}
