import './setup_mock_auth';
import { preloadAllSchedulesSync } from '../utils/scheduleNodeLoader';
preloadAllSchedulesSync();
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

// 4. SCHEDULE REGISTRY WEEKS 1..4 (CONTRACT & SCHEMA VERIFICATION)
console.log("\n--- 4. Schedule Registry Weeks 1..4 (ingt-209) ---");
const schedule = SCHEDULE_REGISTRY['ingt-209'];
assert(!!schedule, "SCHEDULE_REGISTRY['ingt-209'] exists");
assert(!!schedule[1] && !!schedule[2] && !!schedule[3] && !!schedule[4], "All 4 weeks exist");

// Aliases
assert(SCHEDULE_REGISTRY['2-ингт-109'] === schedule, "Alias '2-ингт-109' points to ingt-209");
// AUD-028: the colliding alias is removed — 'ingt-109' belongs to the REAL 1-ИНГТ-109
assert(SCHEDULE_REGISTRY['ingt-109'] !== schedule, "AUD-028: 'ingt-109' is no longer aliased to ingt-209");
assert(SCHEDULE_REGISTRY['ingt-109'] !== undefined, "'ingt-109' holds the real 1-ИНГТ-109 chunk data");

const VALID_TYPES = ['Лекции', 'Практические занятия', 'Лабораторные работы'];
const VALID_START_TIMES = ['08:00', '09:45', '11:50', '13:35', '15:40', '17:25'];

let total209Lessons = 0;
for (let w = 1; w <= 4; w++) {
  const week = schedule[w];
  assert(Array.isArray(week) && week.length === 6, `Week ${w} exists and has 6 days`);
  for (const day of week) {
    total209Lessons += day.lessons.length;
    for (const l of day.lessons) {
      assert(typeof l.id === 'string' && l.id.length > 0, `Lesson id is non-empty (${l.id})`);
      assert(VALID_START_TIMES.includes(l.timeStart), `Lesson timeStart is valid (${l.timeStart})`);
      assert(typeof l.subject === 'string' && l.subject.trim().length > 2, `Lesson subject is valid (${l.subject})`);
      assert(VALID_TYPES.includes(l.type), `Lesson type is valid (${l.type})`);
      assert(!/аудитория.*корпус/i.test(l.location || ''), `Location does not contain raw text (${l.location})`);
    }
  }
}
assert(total209Lessons >= 30, `Total 2-ИНГТ-109 lessons across 4 weeks >= 30 (got ${total209Lessons})`);

// Zero Regression
console.log("\n--- Zero Regression Verification ---");
assert(STUDENTS_REGISTRY['ingt-310']?.length === 16, "3-ИНГТ-110 has 16 students");
assert(STUDENTS_REGISTRY['faid-310']?.length === 22, "3-ФАИД-110 has 22 students");
assert(SCHEDULE_REGISTRY['ingt-310'][1].find(d => d.dayName === 'Четверг')?.lessons.length === 2, "3-ИНГТ-110 Thursday has 2 lessons (military training)");
assert((SCHEDULE_REGISTRY['faid-310'][3].find(d => d.dayName === 'Понедельник')?.lessons.length || 0) >= 1, "3-ФАИД-110 W3 Monday has lessons");

console.log("\n=================================================");
console.log(`TOTAL: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
console.log("=================================================");

if (failedTests > 0) {
  process.exit(1);
} else {
  console.log(">>> ALL 2-ИНГТ-109 CHECKS PASSED SUCCESSFULLY! <<<");
}
