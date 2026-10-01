import './setup_mock_auth';
import { SCHEDULE_REGISTRY, AVAILABLE_GROUPS } from '../constants';
import { verifyPinCode } from '../utils/auth';
import { STUDENTS_REGISTRY } from '../attendance';

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
console.log("     TEST SUITE: 2-ИНГТ-109 SCHEDULE & CONFIG    ");
console.log("=================================================");

// 1. GROUP CONFIGURATION IN AVAILABLE_GROUPS
console.log("\n--- 1. Group Configuration in AVAILABLE_GROUPS ---");
const groupConfig = AVAILABLE_GROUPS.find(g => g.id === 'ingt-209');
assert(!!groupConfig, "Group 'ingt-209' exists in AVAILABLE_GROUPS");
assert(groupConfig?.name === '2-ИНГТ-109', "Group name is '2-ИНГТ-109'");
assert(groupConfig?.facultyId === 'ingt', "Group faculty is 'ingt'");
assert(groupConfig?.course === 2, "Group course is 2");

// 2. STAROSTA PIN
console.log("\n--- 2. Starosta PIN Code ---");
const auth209 = await verifyPinCode('925483');
assert(auth209 !== null && auth209.role === 'starosta' && auth209.targetGroupId === 'ingt-209', "verifyPinCode for '925483' authorizes as starosta for 'ingt-209'");

// 3. STUDENT ROSTER (Empty as requested)
console.log("\n--- 3. Student Roster ---");
const roster = STUDENTS_REGISTRY['ingt-209'];
assert(Array.isArray(roster), "STUDENTS_REGISTRY['ingt-209'] is an array");
assert(roster.length === 0, `Roster is empty (got ${roster.length}) as user stated 'списка пока нет'`);

// 4. SCHEDULE REGISTRY WEEKS 1..4
console.log("\n--- 4. Schedule Registry Weeks 1..4 (ingt-209) ---");
const schedule = SCHEDULE_REGISTRY['ingt-209'];
assert(!!schedule, "SCHEDULE_REGISTRY['ingt-209'] exists");
assert(!!schedule[1] && !!schedule[2] && !!schedule[3] && !!schedule[4], "All 4 weeks exist");

// Aliases
assert(SCHEDULE_REGISTRY['2-ingt-109'] === schedule, "Alias '2-ingt-109' points to ingt-209");
assert(SCHEDULE_REGISTRY['ingt-109'] === schedule, "Alias 'ingt-109' points to ingt-209");

// Check Week 1 (Numerator / 14-19 Sept)
console.log("\n--- Week 1 Details (Numerator) ---");
const w1 = schedule[1];
const w1Total = w1.reduce((acc, d) => acc + d.lessons.length, 0);
assert(w1Total === 16, `Week 1 total lessons is 16 (got ${w1Total})`);

const w1Mon = w1.find(d => d.dayName === 'Понедельник');
assert(w1Mon?.lessons.length === 3, `W1 Monday has 3 lessons (got ${w1Mon?.lessons.length})`);
assert(w1Mon?.lessons[0].subject === 'Физика' && w1Mon?.lessons[0].timeStart === '11:50', "W1 Mo L1: Physics prac (11:50-13:25)");
assert(w1Mon?.lessons[1].subject === 'Защита информации' && w1Mon?.lessons[1].timeStart === '13:35', "W1 Mo L2: InfoSec prac (13:35-15:10)");
assert(w1Mon?.lessons[2].subject === 'Математика' && w1Mon?.lessons[2].timeStart === '15:40', "W1 Mo L3: Math prac (15:40-17:15)");

const w1Tue = w1.find(d => d.dayName === 'Вторник');
assert(w1Tue?.lessons.length === 2, `W1 Tuesday has 2 lessons (got ${w1Tue?.lessons.length})`);
assert(w1Tue?.lessons[0].subject === 'Защита информации' && w1Tue?.lessons[0].timeStart === '11:50', "W1 Tu L1: InfoSec lec (11:50-13:25)");
assert(w1Tue?.lessons[1].subject === 'Математика' && w1Tue?.lessons[1].timeStart === '13:35', "W1 Tu L2: Math lec (13:35-15:10)");

const w1Wed = w1.find(d => d.dayName === 'Среда');
assert(w1Wed?.lessons.length === 3, `W1 Wednesday has 3 lessons (got ${w1Wed?.lessons.length})`);
assert(w1Wed?.lessons[0].subject.includes('физической культуре') && w1Wed?.lessons[0].timeStart === '11:50', "W1 We L1: PE prac (11:50-13:25)");
assert(w1Wed?.lessons[1].subject === 'Теория механизмов и машин' && w1Wed?.lessons[1].timeStart === '13:35', "W1 We L2: TMM lec (13:35-15:10)");
assert(w1Wed?.lessons[2].subject === 'Прикладная механика' && w1Wed?.lessons[2].timeStart === '15:40', "W1 We L3: Applied Mechanics lec (15:40-17:15)");

const w1Thu = w1.find(d => d.dayName === 'Четверг');
assert(w1Thu?.lessons.length === 4, `W1 Thursday has 4 lessons (got ${w1Thu?.lessons.length})`);
assert(w1Thu?.lessons[0].subject === 'Физика' && w1Thu?.lessons[0].timeStart === '09:45', "W1 Th L1: Physics lec (09:45-11:20)");
assert(w1Thu?.lessons[1].subject === 'Основы нефтегазопромыслового дела' && w1Thu?.lessons[1].timeStart === '11:50', "W1 Th L2: Oil&Gas lec (11:50-13:25)");
assert(w1Thu?.lessons[2].subject === 'Социология и право' && w1Thu?.lessons[2].timeStart === '13:35', "W1 Th L3: Sociology prac (13:35-15:10)");
assert(w1Thu?.lessons[3].subject === 'Иностранный язык' && w1Thu?.lessons[3].timeStart === '15:40', "W1 Th L4: Foreign Lang prac (15:40-17:15)");

const w1Fri = w1.find(d => d.dayName === 'Пятница');
assert(w1Fri?.lessons.length === 2, `W1 Friday has 2 lessons (got ${w1Fri?.lessons.length})`);
assert(w1Fri?.lessons[0].subject.includes('Материаловедение') && w1Fri?.lessons[0].timeStart === '15:40', "W1 Fr L1: Materials lab (15:40-17:15)");
assert(w1Fri?.lessons[1].subject.includes('Материаловедение') && w1Fri?.lessons[1].timeStart === '17:25', "W1 Fr L2: Materials lab (17:25-19:00)");

const w1Sat = w1.find(d => d.dayName === 'Суббота');
assert(w1Sat?.lessons.length === 2, `W1 Saturday has 2 lessons (got ${w1Sat?.lessons.length})`);
assert(w1Sat?.lessons[0].subject === 'Иностранный язык' && w1Sat?.lessons[0].timeStart === '11:50', "W1 Sa L1: Foreign Lang prac (11:50-13:25)");
assert(w1Sat?.lessons[1].subject === 'Иностранный язык' && w1Sat?.lessons[1].timeStart === '13:35', "W1 Sa L2: Foreign Lang prac (13:35-15:10)");

// Check Week 2 (Denominator / 07-12 Sept)
console.log("\n--- Week 2 Details (Denominator) ---");
const w2 = schedule[2];
const w2Total = w2.reduce((acc, d) => acc + d.lessons.length, 0);
assert(w2Total === 18, `Week 2 total lessons is 18 (got ${w2Total})`);

const w2Mon = w2.find(d => d.dayName === 'Понедельник');
assert(w2Mon?.lessons.length === 4, `W2 Monday has 4 lessons (got ${w2Mon?.lessons.length})`);
assert(w2Mon?.lessons[0].subject === 'Математика' && w2Mon?.lessons[0].timeStart === '08:00', "W2 Mo L1: Math lec (08:00-09:35)");
assert(w2Mon?.lessons[1].subject.includes('Материаловедение') && w2Mon?.lessons[1].timeStart === '09:45', "W2 Mo L2: Materials lec (09:45-11:20)");
assert(w2Mon?.lessons[2].subject === 'Физика' && w2Mon?.lessons[2].timeStart === '11:50', "W2 Mo L3: Physics lab (11:50-13:25)");
assert(w2Mon?.lessons[3].subject === 'Физика' && w2Mon?.lessons[3].timeStart === '13:35', "W2 Mo L4: Physics lab (13:35-15:10)");

const w2Tue = w2.find(d => d.dayName === 'Вторник');
assert(w2Tue?.lessons.length === 2, `W2 Tuesday has 2 lessons (got ${w2Tue?.lessons.length})`);
assert(w2Tue?.lessons[0].subject.includes('проектная практика') && w2Tue?.lessons[0].timeStart === '09:45', "W2 Tu L1: Project prac (09:45-11:20)");
assert(w2Tue?.lessons[1].subject.includes('проектная практика') && w2Tue?.lessons[1].timeStart === '11:50', "W2 Tu L2: Project prac (11:50-13:25)");

const w2Wed = w2.find(d => d.dayName === 'Среда');
assert(w2Wed?.lessons.length === 4, `W2 Wednesday has 4 lessons (got ${w2Wed?.lessons.length})`);
assert(w2Wed?.lessons[0].subject.includes('физической культуре') && w2Wed?.lessons[0].timeStart === '11:50', "W2 We L1: PE prac (11:50-13:25)");
assert(w2Wed?.lessons[1].subject === 'Теория механизмов и машин' && w2Wed?.lessons[1].timeStart === '13:35', "W2 We L2: TMM lab (13:35-15:10)");
assert(w2Wed?.lessons[2].subject === 'Прикладная механика' && w2Wed?.lessons[2].timeStart === '15:40', "W2 We L3: Applied Mechanics lab (15:40-17:15)");
assert(w2Wed?.lessons[3].subject === 'Иностранный язык' && w2Wed?.lessons[3].timeStart === '17:25', "W2 We L4: Foreign Lang prac (17:25-19:00)");

const w2Thu = w2.find(d => d.dayName === 'Четверг');
assert(w2Thu?.lessons.length === 3, `W2 Thursday has 3 lessons (got ${w2Thu?.lessons.length})`);
assert(w2Thu?.lessons[0].subject.includes('физической культуре') && w2Thu?.lessons[0].timeStart === '11:50', "W2 Th L1: PE prac (11:50-13:25)");
assert(w2Thu?.lessons[1].subject === 'Теория механизмов и машин' && w2Thu?.lessons[1].timeStart === '13:35', "W2 Th L2: TMM prac (13:35-15:10)");
assert(w2Thu?.lessons[2].subject === 'Прикладная механика' && w2Thu?.lessons[2].timeStart === '15:40', "W2 Th L3: Applied Mechanics prac (15:40-17:15)");

const w2Fri = w2.find(d => d.dayName === 'Пятница');
assert(w2Fri?.lessons.length === 3, `W2 Friday has 3 lessons (got ${w2Fri?.lessons.length})`);
assert(w2Fri?.lessons[0].subject === 'Прикладная механика' && w2Fri?.lessons[0].timeStart === '09:45', "W2 Fr L1: Applied Mechanics lec (09:45-11:20)");
assert(w2Fri?.lessons[1].subject === 'Социология и право' && w2Fri?.lessons[1].timeStart === '11:50', "W2 Fr L2: Sociology lec (11:50-13:25)");
assert(w2Fri?.lessons[2].subject === 'Основы нефтегазопромыслового дела' && w2Fri?.lessons[2].timeStart === '13:35', "W2 Fr L3: Oil&Gas lec (13:35-15:10)");

const w2Sat = w2.find(d => d.dayName === 'Суббота');
assert(w2Sat?.lessons.length === 2, `W2 Saturday has 2 lessons (got ${w2Sat?.lessons.length})`);
assert(w2Sat?.lessons[0].subject === 'Философия' && w2Sat?.lessons[0].timeStart === '11:50', "W2 Sa L1: Philosophy prac (11:50-13:25)");
assert(w2Sat?.lessons[1].subject === 'Математика' && w2Sat?.lessons[1].timeStart === '13:35', "W2 Sa L2: Math prac (13:35-15:10)");

// Check Week 3 (16 lessons) and Week 4 (18 lessons)
console.log("\n--- Week 3 & 4 Verification ---");
const w3Total = schedule[3].reduce((acc, d) => acc + d.lessons.length, 0);
assert(w3Total === 16, `Week 3 total lessons is 16 (got ${w3Total})`);

const w4Total = schedule[4].reduce((acc, d) => acc + d.lessons.length, 0);
assert(w4Total === 18, `Week 4 total lessons is 18 (got ${w4Total})`);

// Zero Regression
console.log("\n--- Zero Regression Verification ---");
assert(STUDENTS_REGISTRY['ingt-310']?.length === 16, "3-ИНГТ-110 has 16 students");
assert(STUDENTS_REGISTRY['faid-310']?.length === 22, "3-ФАИД-110 has 22 students");
assert(SCHEDULE_REGISTRY['ingt-310'][1].find(d => d.dayName === 'Четверг')?.lessons.length === 2, "3-ИНГТ-110 Thursday has 2 lessons (military training)");
assert(SCHEDULE_REGISTRY['faid-310'][3].find(d => d.dayName === 'Понедельник')?.lessons.length === 4, "3-ФАИД-110 W3 Monday has 4 lessons");

console.log("\n=================================================");
console.log(`TOTAL: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
console.log("=================================================");

if (failedTests > 0) {
  process.exit(1);
} else {
  console.log(">>> ALL 2-ИНГТ-109 CHECKS PASSED SUCCESSFULLY! <<<");
}
