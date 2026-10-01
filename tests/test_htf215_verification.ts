import './setup_mock_auth';
import { preloadAllSchedulesSync } from '../utils/scheduleNodeLoader';
preloadAllSchedulesSync();
import { AVAILABLE_GROUPS, SCHEDULE_REGISTRY, FACULTIES } from '../constants';
import { verifyPinCode } from '../utils/auth';
import { STUDENTS_REGISTRY } from '../attendance';
import { SEED_SUBJECT_TEACHERS_BY_GROUP } from '../defaultData';

let passCount = 0;
let failCount = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passCount++;
    console.log(`  [PASS] ${label}${detail ? ` (${detail})` : ''}`);
  } else {
    failCount++;
    console.error(`  [FAIL] ${label}${detail ? ` (${detail})` : ''}`);
  }
}

console.log('================================================================');
console.log('       QA VERIFICATION SUITE: 2-ХТФ-115 & REGRESSION CHECKS     ');
console.log('================================================================\n');

// 1. Faculty Check
console.log('--- 1. Faculty Registry ---');
const htfFaculty = FACULTIES.find(f => f.id === 'htf');
check('Faculty HTF exists in FACULTIES', !!htfFaculty && htfFaculty.shortName === 'ХТФ', htfFaculty?.name);

// 2. Group Config Check
console.log('\n--- 2. Group Config in AVAILABLE_GROUPS ---');
const htf215 = AVAILABLE_GROUPS.find(g => g.id === 'htf-215');
check('Group htf-215 exists', !!htf215);
check("Group name is '2-ХТФ-115'", htf215?.name === '2-ХТФ-115');
check("FacultyId is 'htf'", htf215?.facultyId === 'htf');
check("Course is 2", htf215?.course === 2);

// 3. Schedule Registry & Aliases
console.log('\n--- 3. Schedule Registry ---');
const sched = SCHEDULE_REGISTRY['htf-215'];
check('SCHEDULE_REGISTRY["htf-215"] exists', !!sched);
check("Alias '2-htf-115' points to schedule", SCHEDULE_REGISTRY['2-htf-115'] === sched);
check("Alias 'htf-115' points to schedule", SCHEDULE_REGISTRY['htf-115'] === sched);
check("Alias '2-хтф-115' points to schedule", SCHEDULE_REGISTRY['2-хтф-115'] === sched);

// 4. Week-by-Week Lesson Counts
console.log('\n--- 4. Lesson Counts by Week ---');
const w1Count = sched[1].reduce((acc, d) => acc + d.lessons.length, 0);
const w2Count = sched[2].reduce((acc, d) => acc + d.lessons.length, 0);
const w3Count = sched[3].reduce((acc, d) => acc + d.lessons.length, 0);
const w4Count = sched[4].reduce((acc, d) => acc + d.lessons.length, 0);

check('Week 1 has exactly 22 lessons (14-19 Sept parity)', w1Count === 22, `${w1Count} lessons`);
check('Week 2 has exactly 21 lessons (07-12 Sept current)', w2Count === 21, `${w2Count} lessons`);
check('Week 3 has exactly 22 lessons (14-19 Sept exact)', w3Count === 22, `${w3Count} lessons`);
check('Week 4 has exactly 21 lessons (07-12 Sept parity)', w4Count === 21, `${w4Count} lessons`);

// Check day-by-day lesson counts in Week 1 (14-19 Sept parity)
console.log('\n--- 5. Week 1 Day-by-Day Breakdown (14-19 Sept parity) ---');
const w1Days = sched[1];
const expectedW1 = [
  { day: 'Понедельник', count: 4 },
  { day: 'Вторник', count: 4 },
  { day: 'Среда', count: 3 },
  { day: 'Четверг', count: 4 },
  { day: 'Пятница', count: 4 },
  { day: 'Суббота', count: 3 }
];
expectedW1.forEach(({ day, count }, i) => {
  check(`Week 1 ${day} has ${count} lessons`, w1Days[i]?.lessons.length === count, `got ${w1Days[i]?.lessons.length}`);
});

// Check day-by-day lesson counts in Week 2 (07-12 Sept)
console.log('\n--- 6. Week 2 Day-by-Day Breakdown (07-12 Sept current) ---');
const w2Days = sched[2];
const expectedW2 = [
  { day: 'Понедельник', count: 4 },
  { day: 'Вторник', count: 2 },
  { day: 'Среда', count: 4 },
  { day: 'Четверг', count: 5 },
  { day: 'Пятница', count: 2 },
  { day: 'Суббота', count: 4 }
];
expectedW2.forEach(({ day, count }, i) => {
  check(`Week 2 ${day} has ${count} lessons`, w2Days[i]?.lessons.length === count, `got ${w2Days[i]?.lessons.length}`);
});

// Check specific date verification
console.log('\n--- 6b. Exact Date Verification: 08 Sept (Today) vs 15 Sept (Next Week) ---');
const todayLessons = w2Days[1].lessons; // Week 2 Tuesday (08 Sept)
check('08 Sept (Сегодня/Вт W2) has 2 lessons of Проектная практика', 
  todayLessons.length === 2 && todayLessons[0].subject.includes('проектная практика') && todayLessons[0].timeStart === '13:35'
);

const nextTueLessons = sched[3][1].lessons; // Week 3 Tuesday (15 Sept)
check('15 Sept (След. Вт W3) has 4 lessons: Физкультура, Аналитическая хим, Физхимия',
  nextTueLessons.length === 4 && nextTueLessons[1].subject.includes('Аналитическая') && nextTueLessons[1].timeStart === '11:50'
);

// 7. Student Roster (31 students)
console.log('\n--- 7. Student Roster in STUDENTS_REGISTRY ---');
const roster = STUDENTS_REGISTRY['htf-215'];
check('STUDENTS_REGISTRY["htf-215"] exists', Array.isArray(roster));
check('Roster contains exactly 31 students', roster?.length === 31, `${roster?.length} students`);
check('First student is Абаджян Нарек Барсегович', roster?.[0]?.name === 'Абаджян Нарек Барсегович');
check('Last student is Щербакова Вероника Сергеевна', roster?.[30]?.name === 'Щербакова Вероника Сергеевна');
check('Aliases point to same roster', 
  STUDENTS_REGISTRY['2-htf-115'] === roster && 
  STUDENTS_REGISTRY['htf-115'] === roster && 
  STUDENTS_REGISTRY['2-хтф-115'] === roster
);

// 8. Teacher Assignments
console.log('\n--- 8. Teachers in SEED_SUBJECT_TEACHERS_BY_GROUP ---');
const teachers = SEED_SUBJECT_TEACHERS_BY_GROUP['htf-215'];
check('SEED_SUBJECT_TEACHERS_BY_GROUP["htf-215"] exists', !!teachers);
check('Аналитическая химия -> Рублинецкая Юлия Вячеславовна', teachers?.['Аналитическая химия'] === 'Рублинецкая Юлия Вячеславовна');
check('Физическая химия -> Расщепкина Наталья Афанасьевна', teachers?.['Физическая химия'] === 'Расщепкина Наталья Афанасьевна');
check('Строение вещества -> Расщепкина Наталья Афанасьевна', teachers?.['Строение вещества'] === 'Расщепкина Наталья Афанасьевна');
check('Физика -> Косарева Евгения Александровна', teachers?.['Физика'] === 'Косарева Евгения Александровна');
check('Математика -> Арланова Екатерина Юрьевна', teachers?.['Математика'] === 'Арланова Екатерина Юрьевна');
check('Введение в информационные технологии -> Семенова Ирина Александровна', teachers?.['Введение в информационные технологии'] === 'Семенова Ирина Александровна');
check('Учебная практика: проектная практика -> Семенова Ирина Александровна', teachers?.['Учебная практика: проектная практика'] === 'Семенова Ирина Александровна');
check('Иностранный язык -> Ревина Е.В. / Гарифова О.А.', teachers?.['Иностранный язык'] === 'Ревина Е.В. / Гарифова О.А.');

// 9. Starosta PIN Codes
console.log('\n--- 9. Starosta PIN Codes ---');
const authHtf = await verifyPinCode('741639');
check("verifyPinCode('741639') authorizes starosta for 'htf-215'", authHtf !== null && authHtf.role === 'starosta' && authHtf.targetGroupId === 'htf-215');

// 10. Regression Check for Other Groups
console.log('\n--- 10. Regression Checks for Existing Groups ---');
// 3-ИНГТ-110
const ingt310Roster = STUDENTS_REGISTRY['ingt-310'];
check('3-ИНГТ-110 has 16 students (without Pronin)', ingt310Roster?.length === 16);
const ingt310Sched = SCHEDULE_REGISTRY['ingt-310'];
check('3-ИНГТ-110 Thursday has 0 lessons', ingt310Sched?.[1]?.[3]?.lessons.length === 0);
const patentLesson = ingt310Sched?.[1]?.[4]?.lessons.find(l => l.subject.includes('патентоведение') && l.type.includes('Практич'));
check('3-ИНГТ-110 Friday Patentoведение (практика) has teacher Колибасов В.А.', patentLesson?.teacher?.includes('Колибасов'));

// 3-ФАИД-110
const faid310Roster = STUDENTS_REGISTRY['faid-310'];
check('3-ФАИД-110 has 22 students', faid310Roster?.length === 22);
const faid310Sched = SCHEDULE_REGISTRY['faid-310'];
check('3-ФАИД-110 Week 3 Monday has 4 lessons', faid310Sched?.[3]?.[0]?.lessons.length === 4);
check('3-ФАИД-110 Week 4 Tuesday has 0 lessons', faid310Sched?.[4]?.[1]?.lessons.length === 0);

// 2-ИНГТ-109
const ingt209Sched = SCHEDULE_REGISTRY['ingt-209'];
check('2-ИНГТ-109 Week 1 has 16 lessons', ingt209Sched?.[1]?.reduce((acc, d) => acc + d.lessons.length, 0) === 16);
const authIngt209 = await verifyPinCode('925483');
check("2-ИНГТ-109 PIN authorizes via verifyPinCode", authIngt209 !== null && authIngt209.role === 'starosta' && authIngt209.targetGroupId === 'ingt-209');

console.log('\n================================================================');
console.log(`TOTAL CHECKS: ${passCount + failCount} | PASSED: ${passCount} | FAILED: ${failCount}`);
console.log('================================================================');

if (failCount > 0) {
  process.exit(1);
} else {
  console.log('\n>>> ALL 2-ХТФ-115 CHECKS & REGRESSION TESTS PASSED (100%) <<<\n');
}
