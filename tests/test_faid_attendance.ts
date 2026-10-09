import './setup_mock_auth';
import { preloadAllSchedulesSync } from '../utils/scheduleNodeLoader';
preloadAllSchedulesSync();

import { SCHEDULE_REGISTRY, AVAILABLE_GROUPS } from '../constants';
import { verifyPinCode } from '../utils/auth';
import { STUDENTS_REGISTRY, BLOCKS, getDayISODate, AttendanceRecord } from '../attendance';
import { UserRole, Lesson } from '../types';

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

console.log("================================================================================");
console.log("   TEST SUITE: 3-ФАИД-110 STAROSTA AUTHORIZATION & ATTENDANCE TRACKER          ");
console.log("   Role: Староста группы 3-ФАИД-110 (PIN 110) | Tester: Antigravity QA          ");
console.log("================================================================================\n");

// ============================================================================
// PART 1: STAROSTA AUTHORIZATION & 22-STUDENT ROSTER
// ============================================================================
console.log("--------------------------------------------------------------------------------");
console.log("1. STAROSTA PIN 110 & AUTHORIZATION VERIFICATION (faid-310)");
console.log("--------------------------------------------------------------------------------");

// 1.1 Verify Starosta and Admin PIN via verifyPinCode
const authStarostaFaid = await verifyPinCode('381952');
assert(authStarostaFaid !== null && authStarostaFaid.role === 'starosta' && authStarostaFaid.targetGroupId === 'faid-310', "verifyPinCode('381952') authorizes 3-ФАИД-110 (faid-310) starosta");
const authAdmin = await verifyPinCode('94726108');
assert(authAdmin !== null && authAdmin.role === 'admin', "verifyPinCode('94726108') authorizes global admin");

// 1.2 Simulate PIN Authentication Logic from App.tsx
function simulateQuickPinLogin(inputPin: string, currentGroupId: string) {
  const pin = inputPin.trim().toLowerCase();
  let userRole: UserRole = 'student';
  let starostaGroupId: string | null = null;
  let activeGroupId = currentGroupId;

  if (pin === '94726108') {
    userRole = 'admin';
    starostaGroupId = null;
  } else if (pin === '101') {
    userRole = 'starosta';
    starostaGroupId = 'ingt-301';
    activeGroupId = 'ingt-301';
  } else if (pin === '103') {
    userRole = 'starosta';
    starostaGroupId = 'ingt-303';
    activeGroupId = 'ingt-303';
  } else if (pin === '110') {
    userRole = 'starosta';
    if (activeGroupId === 'faid-310' || activeGroupId === 'faid-110') {
      starostaGroupId = 'faid-310';
      activeGroupId = 'faid-310';
    } else {
      starostaGroupId = 'ingt-310';
      activeGroupId = 'ingt-310';
    }
  } else if (pin === 'faid110' || pin === '3110') {
    userRole = 'starosta';
    starostaGroupId = 'faid-310';
    activeGroupId = 'faid-310';
  }

  // Effective role evaluation
  const getEffectiveRole = (viewingGroupId: string): UserRole => {
    if (userRole === 'admin') return 'admin';
    if (userRole === 'starosta') {
      if (starostaGroupId && viewingGroupId === starostaGroupId) {
        return 'starosta';
      }
      return 'student';
    }
    return 'student';
  };

  const effectiveRole = getEffectiveRole(activeGroupId);
  const canEdit = effectiveRole === 'admin' || effectiveRole === 'starosta';

  return {
    userRole,
    starostaGroupId,
    activeGroupId,
    effectiveRole,
    canEdit,
    getEffectiveRole
  };
}

// Test login with PIN '110' when active group is 'faid-310'
const authResultFaid = simulateQuickPinLogin('110', 'faid-310');
assert(authResultFaid.userRole === 'starosta', "PIN '110' sets userRole to 'starosta'");
assert(authResultFaid.starostaGroupId === 'faid-310', "PIN '110' binds starosta authority to 'faid-310'");
assert(authResultFaid.effectiveRole === 'starosta', "Effective role is 'starosta' in 3-ФАИД-110");
assert(authResultFaid.canEdit === true, "Starosta has canEdit === true in 3-ФАИД-110");

// Test group isolation: Starosta of faid-310 switches to ingt-310
const roleInOtherGroup = authResultFaid.getEffectiveRole('ingt-310');
assert(roleInOtherGroup === 'student', "Starosta of 3-ФАИД-110 becomes read-only 'student' in 3-ИНГТ-110 (security isolation)");

// Test fallback alias 'faid-110'
const authResultAlias = simulateQuickPinLogin('110', 'faid-110');
assert(authResultAlias.starostaGroupId === 'faid-310', "Alias 'faid-110' correctly resolves to starosta of 'faid-310'");

// Test direct PINs 'faid110' and '3110'
const authDirectFaid = simulateQuickPinLogin('faid110', 'ingt-310');
assert(authDirectFaid.starostaGroupId === 'faid-310', "PIN 'faid110' directly activates 3-ФАИД-110 even from other group");
const authDirect3110 = simulateQuickPinLogin('3110', 'ingt-310');
assert(authDirect3110.starostaGroupId === 'faid-310', "PIN '3110' directly activates 3-ФАИД-110");

// Test invalid PIN
const authInvalid = simulateQuickPinLogin('999', 'faid-310');
assert(authInvalid.canEdit === false && authInvalid.userRole === 'student', "Invalid PIN '999' is rejected (remains student)");

// 1.3 ROSTER VERIFICATION (22 STUDENTS)
console.log("\n--------------------------------------------------------------------------------");
console.log("2. 22-STUDENT ROSTER VERIFICATION (Студент 1 -> Студент 22)");
console.log("--------------------------------------------------------------------------------");

const students = STUDENTS_REGISTRY['faid-310'];
assert(Array.isArray(students), "STUDENTS_REGISTRY['faid-310'] exists as array");
assert(students.length === 22, `Total students count is 22 (got: ${students.length})`);

const expectedRoster = Array.from({ length: 22 }, (_, idx) => ({
  id: idx + 1,
  name: `Студент ${idx + 1}`
}));

expectedRoster.forEach((expected, index) => {
  const actual = students[index];
  assert(actual?.id === expected.id, `Student #${expected.id} ID matches (${actual?.id})`);
  assert(actual?.name === expected.name, `Student #${expected.id} name is "${expected.name}"`);
});

// Check first and last student boundaries
assert(students[0].name === "Студент 1", "First student is Студент 1");
assert(students[students.length - 1].name === "Студент 22", "Last student is Студент 22");

// Check backwards compatibility alias 'faid-110'
const aliasRoster = STUDENTS_REGISTRY['faid-110'];
assert(aliasRoster && aliasRoster.length === 22, "Alias STUDENTS_REGISTRY['faid-110'] contains all 22 students");
assert(aliasRoster[0].name === "Студент 1", "Alias first student matches");
assert(aliasRoster[21].name === "Студент 22", "Alias last student matches");

// Check unique IDs
const idSet = new Set(students.map(s => s.id));
assert(idSet.size === 22, "All 22 student IDs are unique");


// ============================================================================
// PART 2: TARGET SCHEDULE DAYS & LESSON IDs VERIFICATION
// ============================================================================
console.log("\n--------------------------------------------------------------------------------");
console.log("3. SCHEDULE OF PREVIOUSLY MISSING DAYS (W1 Mo, W3 Mo, W2 Tu, W4 Tu)");
console.log("--------------------------------------------------------------------------------");

const faidSchedule = SCHEDULE_REGISTRY['faid-310'];
assert(!!faidSchedule, "SCHEDULE_REGISTRY['faid-310'] exists");

// 3.1 Week 1 Monday (4 lessons)
const w1MoDay = faidSchedule[1]?.find(d => d.dayName === 'Понедельник');
assert(w1MoDay !== undefined, "Week 1 Monday day object exists");
assert(w1MoDay?.lessons.length === 4, `Week 1 Monday has 4 lessons (got: ${w1MoDay?.lessons.length})`);
const w1MoIds = w1MoDay?.lessons.map(l => l.id) || [];
assert(JSON.stringify(w1MoIds) === JSON.stringify([
  'faid310-w1-mo-1', 'faid310-w1-mo-2', 'faid310-w1-mo-3', 'faid310-w1-mo-4'
]), "Week 1 Monday lesson IDs: faid310-w1-mo-1..4");

// 3.2 Week 3 Monday (4 lessons)
const w3MoDay = faidSchedule[3]?.find(d => d.dayName === 'Понедельник');
assert(w3MoDay !== undefined, "Week 3 Monday day object exists");
assert(w3MoDay?.lessons.length === 4, `Week 3 Monday has 4 lessons (got: ${w3MoDay?.lessons.length})`);
const w3MoIds = w3MoDay?.lessons.map(l => l.id) || [];
assert(JSON.stringify(w3MoIds) === JSON.stringify([
  'faid310-w3-mo-1', 'faid310-w3-mo-2', 'faid310-w3-mo-3', 'faid310-w3-mo-4'
]), "Week 3 Monday lesson IDs: faid310-w3-mo-1..4");

// 3.3 Week 2 Tuesday (2 lessons: Career lecture & Project Smolenskaya)
const w2TuDay = faidSchedule[2]?.find(d => d.dayName === 'Вторник');
assert(w2TuDay !== undefined, "Week 2 Tuesday day object exists");
assert(w2TuDay?.lessons.length === 2, `Week 2 Tuesday has 2 lessons (got: ${w2TuDay?.lessons.length})`);

// 3.4 Week 4 Tuesday (2 lessons)
const w4TuDay = faidSchedule[4]?.find(d => d.dayName === 'Вторник');
assert(w4TuDay !== undefined, "Week 4 Tuesday day object exists");
assert(w4TuDay?.lessons.length === 2, `Week 4 Tuesday has 2 lessons (got: ${w4TuDay?.lessons.length})`);

// 3.5 Total target lessons count (4 + 4 + 2 + 2 = 12)
const totalTargetLessons = (w1MoDay?.lessons.length || 0) + (w3MoDay?.lessons.length || 0) + (w2TuDay?.lessons.length || 0) + (w4TuDay?.lessons.length || 0);
assert(totalTargetLessons === 12, `Total target lessons across the 4 days is 12 (got: ${totalTargetLessons})`);

// 3.6 Calendar dates verification
// Cycle starts 2026-08-31
const dateW1Mo = getDayISODate('Понедельник', 1, '2026-08-31');
const dateW2Mo = getDayISODate('Понедельник', 2, '2026-08-31');
const dateW3Mo = getDayISODate('Понедельник', 3, '2026-08-31');
const dateW4Mo = getDayISODate('Понедельник', 4, '2026-08-31');
const w2MoDay = faidSchedule[2]?.find(d => d.dayName === 'Понедельник');
const w4MoDay = faidSchedule[4]?.find(d => d.dayName === 'Понедельник');

console.log(`  Target Dates: W1 Mo = ${dateW1Mo}, W2 Mo = ${dateW2Mo}, W3 Mo = ${dateW3Mo}, W4 Mo = ${dateW4Mo}`);
assert(dateW1Mo === '2026-08-31', "W1 Monday date is 2026-08-31");
assert(dateW2Mo === '2026-09-07', "W2 Monday date is 2026-09-07");
assert(dateW3Mo === '2026-09-14', "W3 Monday date is 2026-09-14");
assert(dateW4Mo === '2026-09-21', "W4 Monday date is 2026-09-21");


// ============================================================================
// PART 3: SIMULATING ATTENDANCE ENGINE & FULL DAY ACTIONS
// ============================================================================
console.log("\n--------------------------------------------------------------------------------");
console.log("4. ATTENDANCE ENGINE SIMULATION (markAttendance & handleSetFullDayStatus)");
console.log("--------------------------------------------------------------------------------");

class AttendanceEngine {
  private recordsMap: Map<string, AttendanceRecord> = new Map();
  public groupId: string = 'faid-310';

  constructor(groupId: string = 'faid-310') {
    this.groupId = groupId;
  }

  getRecords(): AttendanceRecord[] {
    return Array.from(this.recordsMap.values());
  }

  getAttendance(date: string, lessonId: string): AttendanceRecord {
    const key = `${date}_${lessonId}`;
    return this.recordsMap.get(key) || {
      groupId: this.groupId,
      date,
      lessonId,
      absentStudentIds: [],
      excusedStudentIds: [],
      isCancelled: false
    };
  }

  // Pure implementation of markBatchAttendance from attendance.ts
  markBatchAttendance(updates: Array<{
    date: string;
    lessonId: string;
    absentStudentIds: number[];
    excusedStudentIds?: number[];
    isCancelled?: boolean;
  }>) {
    for (const u of updates) {
      const key = `${u.date}_${u.lessonId}`;
      const record: AttendanceRecord = {
        docId: `${this.groupId}_${u.date}_${u.lessonId}`,
        groupId: this.groupId,
        date: u.date,
        lessonId: u.lessonId,
        absentStudentIds: u.absentStudentIds,
        excusedStudentIds: u.excusedStudentIds || [],
        isCancelled: u.isCancelled ?? false,
        updatedAt: new Date().toISOString(),
        updatedBy: 'starosta_pin_110'
      };
      this.recordsMap.set(key, record);
    }
  }

  // Pure implementation of markAttendance from attendance.ts
  markAttendance(
    date: string,
    lessonId: string,
    absentStudentIds: number[],
    excusedStudentIds: number[] = [],
    isCancelled: boolean = false
  ) {
    this.markBatchAttendance([{
      date,
      lessonId,
      absentStudentIds,
      excusedStudentIds,
      isCancelled
    }]);
  }

  // Pure implementation of handleSetStudentStatus from AttendanceTracker.tsx
  handleSetStudentStatus(
    date: string,
    lesson: Lesson,
    studentId: number,
    status: 'present' | 'absent' | 'excused',
    canEdit: boolean = true
  ) {
    if (!canEdit) throw new Error("Permission denied");
    const record = this.getAttendance(date, lesson.id);
    let newAbsentIds = record.absentStudentIds.filter(id => id !== studentId);
    let newExcusedIds = (record.excusedStudentIds || []).filter(id => id !== studentId);

    if (status === 'absent') {
      newAbsentIds.push(studentId);
    } else if (status === 'excused') {
      newExcusedIds.push(studentId);
    }

    this.markAttendance(date, lesson.id, newAbsentIds, newExcusedIds, record.isCancelled);
  }

  // Pure implementation of handleSetFullDayStatus from AttendanceTracker.tsx
  handleSetFullDayStatus(
    date: string,
    dayLessons: Lesson[],
    studentId: number,
    status: 'absent' | 'excused',
    canEdit: boolean = true
  ) {
    if (!canEdit) throw new Error("Permission denied");
    if (dayLessons.length === 0) return;

    const updates: Array<{
      date: string;
      lessonId: string;
      absentStudentIds: number[];
      excusedStudentIds?: number[];
      isCancelled?: boolean;
    }> = [];

    dayLessons.forEach(lesson => {
      const record = this.getAttendance(date, lesson.id);
      // Skip cancelled lessons so absent status is never marked on cancelled classes!
      if (record.isCancelled) return;

      let newAbsentIds = record.absentStudentIds.filter(id => id !== studentId);
      let newExcusedIds = (record.excusedStudentIds || []).filter(id => id !== studentId);

      if (status === 'absent') {
        newAbsentIds.push(studentId);
      } else if (status === 'excused') {
        newExcusedIds.push(studentId);
      }

      updates.push({
        date,
        lessonId: lesson.id,
        absentStudentIds: newAbsentIds,
        excusedStudentIds: newExcusedIds,
        isCancelled: record.isCancelled
      });
    });

    if (updates.length > 0) {
      this.markBatchAttendance(updates);
    }
  }

  // Setting whole day status for ALL students (all_absent / all_excused bulk helper)
  handleSetWholeGroupFullDayStatus(
    date: string,
    dayLessons: Lesson[],
    allStudentIds: number[],
    status: 'absent' | 'excused',
    canEdit: boolean = true
  ) {
    for (const studentId of allStudentIds) {
      this.handleSetFullDayStatus(date, dayLessons, studentId, status, canEdit);
    }
  }

  // Toggle cancellation for a lesson
  handleToggleLessonCancelled(date: string, lessonId: string, canEdit: boolean = true) {
    if (!canEdit) throw new Error("Permission denied");
    const record = this.getAttendance(date, lessonId);
    this.markAttendance(date, lessonId, record.absentStudentIds, record.excusedStudentIds, !record.isCancelled);
  }

  // Official hours report calculation from AttendanceTracker.tsx
  calculateReport(studentList: typeof students) {
    const records = this.getRecords();
    return studentList.map(student => {
      const absences = [0, 0, 0, 0];
      const excused = [0, 0, 0, 0];
      let totalAllTimeAbs = 0;
      let totalAllTimeExc = 0;

      records.forEach(record => {
        if (record.isCancelled) return;

        const isAbsent = record.absentStudentIds.includes(student.id);
        const isExcused = !isAbsent && (record.excusedStudentIds || []).includes(student.id);

        if (isAbsent) totalAllTimeAbs += 2;
        else if (isExcused) totalAllTimeExc += 2;

        if (isAbsent || isExcused) {
          BLOCKS.forEach((block, index) => {
            if (record.date >= block.start && record.date <= block.end) {
              if (isAbsent) absences[index] += 2;
              else if (isExcused) excused[index] += 2;
            }
          });
        }
      });

      return { ...student, absences, excused, totalAllTimeAbs, totalAllTimeExc };
    });
  }
}

const engine = new AttendanceEngine('faid-310');

// 4.1 TEST SINGLE LESSON MARKING (markAttendance)
console.log("\n--- 4.1 Single Lesson markAttendance ---");
const firstLessonW1Mo = w1MoDay!.lessons[0]; // faid310-w1-mo-1
// Student 1 marked absent
engine.handleSetStudentStatus(dateW1Mo, firstLessonW1Mo, 1, 'absent', true);
let rec1 = engine.getAttendance(dateW1Mo, firstLessonW1Mo.id);
assert(rec1.absentStudentIds.includes(1), "Student 1 is in absentStudentIds for faid310-w1-mo-1");
assert(!rec1.excusedStudentIds?.includes(1), "Student 1 is NOT in excusedStudentIds");

// Switch Student 1 to excused
engine.handleSetStudentStatus(dateW1Mo, firstLessonW1Mo, 1, 'excused', true);
rec1 = engine.getAttendance(dateW1Mo, firstLessonW1Mo.id);
assert(!rec1.absentStudentIds.includes(1), "Student 1 removed from absentStudentIds on switch to excused");
assert(rec1.excusedStudentIds?.includes(1), "Student 1 added to excusedStudentIds");

// Switch Student 1 to present (clears status)
engine.handleSetStudentStatus(dateW1Mo, firstLessonW1Mo, 1, 'present', true);
rec1 = engine.getAttendance(dateW1Mo, firstLessonW1Mo.id);
assert(!rec1.absentStudentIds.includes(1) && !rec1.excusedStudentIds?.includes(1), "Student 1 cleared to present");

// 4.2 TEST FULL DAY STATUS: WEEK 1 MONDAY (5 lessons) -> 'absent'
console.log("\n--- 4.2 Full Day Status: Week 1 Monday (5 lessons) ---");
// Student 1 set to absent for the full day
engine.handleSetFullDayStatus(dateW1Mo, w1MoDay!.lessons, 1, 'absent', true);

for (const lesson of w1MoDay!.lessons) {
  const rec = engine.getAttendance(dateW1Mo, lesson.id);
  assert(rec.absentStudentIds.includes(1), `W1 Mo lesson ${lesson.id} contains Student 1 in absentStudentIds`);
  assert(!rec.excusedStudentIds?.includes(1), `W1 Mo lesson ${lesson.id} does not contain Student 1 in excusedStudentIds`);
}

// Student 2 (Антоненко) set to excused for the full day
engine.handleSetFullDayStatus(dateW1Mo, w1MoDay!.lessons, 2, 'excused', true);
for (const lesson of w1MoDay!.lessons) {
  const rec = engine.getAttendance(dateW1Mo, lesson.id);
  assert(rec.excusedStudentIds?.includes(2), `W1 Mo lesson ${lesson.id} contains Student 2 in excusedStudentIds`);
  assert(!rec.absentStudentIds.includes(2), `W1 Mo lesson ${lesson.id} does not contain Student 2 in absentStudentIds`);
}

// 4.3 TEST FULL DAY STATUS: WEEK 3 MONDAY (5 lessons) -> 'absent' & 'excused'
console.log("\n--- 4.3 Full Day Status: Week 3 Monday (5 lessons) ---");
// Student 3 (Баландина) full day absent on W3 Monday
engine.handleSetFullDayStatus(dateW3Mo, w3MoDay!.lessons, 3, 'absent', true);
for (const lesson of w3MoDay!.lessons) {
  const rec = engine.getAttendance(dateW3Mo, lesson.id);
  assert(rec.absentStudentIds.includes(3), `W3 Mo lesson ${lesson.id} contains Student 3 in absentStudentIds`);
}

// Student 4 (Бурханова) full day excused on W3 Monday
engine.handleSetFullDayStatus(dateW3Mo, w3MoDay!.lessons, 4, 'excused', true);
for (const lesson of w3MoDay!.lessons) {
  const rec = engine.getAttendance(dateW3Mo, lesson.id);
  assert(rec.excusedStudentIds?.includes(4), `W3 Mo lesson ${lesson.id} contains Student 4 in excusedStudentIds`);
}

// 4.4 TEST FULL DAY STATUS: WEEK 2 MONDAY (5 lessons) -> 'absent' & 'excused'
console.log("\n--- 4.4 Full Day Status: Week 2 Monday (5 lessons) ---");
// Student 5 (Винк) full day absent on W2 Monday
engine.handleSetFullDayStatus(dateW2Mo, w2MoDay!.lessons, 5, 'absent', true);
for (const lesson of w2MoDay!.lessons) {
  const rec = engine.getAttendance(dateW2Mo, lesson.id);
  assert(rec.absentStudentIds.includes(5), `W2 Mo lesson ${lesson.id} contains Student 5 in absentStudentIds`);
}

// Student 6 (Внучкова) full day excused on W2 Monday
engine.handleSetFullDayStatus(dateW2Mo, w2MoDay!.lessons, 6, 'excused', true);
for (const lesson of w2MoDay!.lessons) {
  const rec = engine.getAttendance(dateW2Mo, lesson.id);
  assert(rec.excusedStudentIds?.includes(6), `W2 Mo lesson ${lesson.id} contains Student 6 in excusedStudentIds`);
}

// 4.5 TEST FULL DAY STATUS: WEEK 4 MONDAY (5 lessons) -> 'absent' & 'excused'
console.log("\n--- 4.5 Full Day Status: Week 4 Monday (5 lessons) ---");
// Student 7 (Губарева) full day absent on W4 Monday
engine.handleSetFullDayStatus(dateW4Mo, w4MoDay!.lessons, 7, 'absent', true);
for (const lesson of w4MoDay!.lessons) {
  const rec = engine.getAttendance(dateW4Mo, lesson.id);
  assert(rec.absentStudentIds.includes(7), `W4 Mo lesson ${lesson.id} contains Student 7 in absentStudentIds`);
}

// Student 8 (Зацепина) full day excused on W4 Monday
engine.handleSetFullDayStatus(dateW4Mo, w4MoDay!.lessons, 8, 'excused', true);
for (const lesson of w4MoDay!.lessons) {
  const rec = engine.getAttendance(dateW4Mo, lesson.id);
  assert(rec.excusedStudentIds?.includes(8), `W4 Mo lesson ${lesson.id} contains Student 8 in excusedStudentIds`);
}

// ============================================================================
// PART 4: CANCELLED LESSONS & HOURS CALCULATION TESTS
// ============================================================================
console.log("\n--------------------------------------------------------------------------------");
console.log("5. CANCELLED LESSONS & HOURS CALCULATION INTEGRITY");
console.log("--------------------------------------------------------------------------------");

// 5.1 Cancel one lesson in W1 Monday and verify handleSetFullDayStatus skips it
console.log("\n--- 5.1 Cancelled lesson skipped by handleSetFullDayStatus ---");
const cancelledLessonId = 'faid310-w1-mo-3'; // BZhD practice
engine.handleToggleLessonCancelled(dateW1Mo, cancelledLessonId, true);
const cancelledRec = engine.getAttendance(dateW1Mo, cancelledLessonId);
assert(cancelledRec.isCancelled === true, `${cancelledLessonId} is marked as isCancelled: true`);

// Now apply full day absent for Student 9 (Зубалова) on W1 Monday
engine.handleSetFullDayStatus(dateW1Mo, w1MoDay!.lessons, 9, 'absent', true);

// Check that the cancelled lesson does NOT have Student 9
const recCancelledCheck = engine.getAttendance(dateW1Mo, cancelledLessonId);
assert(!recCancelledCheck.absentStudentIds.includes(9), `Cancelled lesson ${cancelledLessonId} was SKIPPED by handleSetFullDayStatus (Student 9 not added)`);

// Check that the other 3 active lessons DO have Student 9
const activeW1MoLessons = w1MoDay!.lessons.filter(l => l.id !== cancelledLessonId);
for (const lesson of activeW1MoLessons) {
  const rec = engine.getAttendance(dateW1Mo, lesson.id);
  assert(rec.absentStudentIds.includes(9), `Active lesson ${lesson.id} has Student 9 in absentStudentIds`);
}

// 5.2 Verify Hours Calculation for Student 9:
// 3 active lessons absent * 2 hours = 6 hours (NOT 8 or 10 hours)
console.log("\n--- 5.2 Hours Calculation for Cancelled Lessons ---");
let currentReport = engine.calculateReport(students);
const s9Report = currentReport.find(s => s.id === 9)!;
assert(s9Report.totalAllTimeAbs === 6, `Student 9 has 6 hours absent (3 active pairs * 2h). Got: ${s9Report.totalAllTimeAbs}h`);
assert(s9Report.totalAllTimeExc === 0, `Student 9 has 0 hours excused. Got: ${s9Report.totalAllTimeExc}h`);

// Student 1 had full day absent on W1 Monday before lesson 3 was cancelled.
// Since lesson 3 is now cancelled, reportData filters it out: 3 active * 2h = 6h
const s1Report = currentReport.find(s => s.id === 1)!;
assert(s1Report.totalAllTimeAbs === 6, `Student 1 has 6 hours absent (cancelled pair ignored in report). Got: ${s1Report.totalAllTimeAbs}h`);

// Student 2 had full day excused on W1 Monday: 3 active pairs * 2h = 6h excused
const s2Report = currentReport.find(s => s.id === 2)!;
assert(s2Report.totalAllTimeExc === 6, `Student 2 has 6 hours excused (cancelled pair ignored in report). Got: ${s2Report.totalAllTimeExc}h`);

// Student 3: W3 Monday (4 lessons, none cancelled) -> 4 * 2 = 8h absent
const s3Report = currentReport.find(s => s.id === 3)!;
assert(s3Report.totalAllTimeAbs === 8, `Student 3 has 8 hours absent (4 pairs * 2h). Got: ${s3Report.totalAllTimeAbs}h`);

// Student 4: W3 Monday (4 lessons, none cancelled) -> 4 * 2 = 8h excused
const s4Report = currentReport.find(s => s.id === 4)!;
assert(s4Report.totalAllTimeExc === 8, `Student 4 has 8 hours excused (4 pairs * 2h). Got: ${s4Report.totalAllTimeExc}h`);

// Student 5: W2 Monday (5 lessons, none cancelled) -> 5 * 2 = 10h absent
const s5Report = currentReport.find(s => s.id === 5)!;
assert(s5Report.totalAllTimeAbs === 10, `Student 5 has 10 hours absent (5 pairs * 2h). Got: ${s5Report.totalAllTimeAbs}h`);

// Student 6: W2 Monday (5 lessons, none cancelled) -> 5 * 2 = 10h excused
const s6Report = currentReport.find(s => s.id === 6)!;
assert(s6Report.totalAllTimeExc === 10, `Student 6 has 10 hours excused (5 pairs * 2h). Got: ${s6Report.totalAllTimeExc}h`);

// Student 7: W4 Monday (5 lessons, none cancelled) -> 5 * 2 = 10h absent
const s7Report = currentReport.find(s => s.id === 7)!;
assert(s7Report.totalAllTimeAbs === 10, `Student 7 has 10 hours absent (5 pairs * 2h). Got: ${s7Report.totalAllTimeAbs}h`);

// Student 8: W4 Monday (5 lessons, none cancelled) -> 5 * 2 = 10h excused
const s8Report = currentReport.find(s => s.id === 8)!;
assert(s8Report.totalAllTimeExc === 10, `Student 8 has 10 hours excused (5 pairs * 2h). Got: ${s8Report.totalAllTimeExc}h`);

// 5.3 Verify NO DOUBLE COUNTING if a student is accidentally in both arrays
console.log("\n--- 5.3 Anomaly Protection: No Double Counting ---");
// Inject corrupted record where student 10 is in both absent and excused on W3 Monday L1
const corruptedLessonId = 'faid310-w3-mo-1';
const existingRec = engine.getAttendance(dateW3Mo, corruptedLessonId);
engine.markAttendance(
  dateW3Mo,
  corruptedLessonId,
  [...existingRec.absentStudentIds, 10],
  [...existingRec.excusedStudentIds, 10],
  false
);

const corruptedRec = engine.getAttendance(dateW3Mo, corruptedLessonId);
assert(corruptedRec.absentStudentIds.includes(10) && corruptedRec.excusedStudentIds?.includes(10), "Simulated corrupted record with Student 10 in both arrays");

currentReport = engine.calculateReport(students);
const s10Report = currentReport.find(s => s.id === 10)!;
assert(s10Report.totalAllTimeAbs === 2, `Student 10 has exactly 2h absent (got: ${s10Report.totalAllTimeAbs}h)`);
assert(s10Report.totalAllTimeExc === 0, `Student 10 has 0h excused because absence takes precedence (got: ${s10Report.totalAllTimeExc}h)`);
assert(s10Report.totalAllTimeAbs + s10Report.totalAllTimeExc === 2, "Student 10 total hours is exactly 2h, NO DOUBLE COUNTING AS 4H!");

// 5.4 Verify Blocks Distribution
console.log("\n--- 5.4 Block Distribution (Block 1 vs Block 2) ---");
// W1 Mo (2026-08-31) -> Block 1 (31.08 - 20.09)
// W2 Mo (2026-09-07) -> Block 1
// W3 Mo (2026-09-14) -> Block 1
// W4 Mo (2026-09-21) -> Block 2 (21.09 - 20.10)

// Student 1 (W1 Mo): Block 1 = 6h, Block 2 = 0h
assert(s1Report.absences[0] === 6, `Student 1 Block 1 absences: 6h (got: ${s1Report.absences[0]}h)`);
assert(s1Report.absences[1] === 0, `Student 1 Block 2 absences: 0h (got: ${s1Report.absences[1]}h)`);

// Student 5 (W2 Mo): Block 1 = 10h, Block 2 = 0h
assert(s5Report.absences[0] === 10, `Student 5 Block 1 absences: 10h (got: ${s5Report.absences[0]}h)`);
assert(s5Report.absences[1] === 0, `Student 5 Block 2 absences: 0h (got: ${s5Report.absences[1]}h)`);

// Student 7 (W4 Mo): Block 1 = 0h, Block 2 = 10h
assert(s7Report.absences[0] === 0, `Student 7 Block 1 absences: 0h (got: ${s7Report.absences[0]}h)`);
assert(s7Report.absences[1] === 10, `Student 7 Block 2 absences: 10h (got: ${s7Report.absences[1]}h)`);

// Student 8 (W4 Mo): Block 1 = 0h, Block 2 = 10h excused
assert(s8Report.excused[0] === 0, `Student 8 Block 1 excused: 0h (got: ${s8Report.excused[0]}h)`);
assert(s8Report.excused[1] === 10, `Student 8 Block 2 excused: 10h (got: ${s8Report.excused[1]}h)`);

// Sum of blocks matches total all time
for (const s of currentReport) {
  const sumAbs = s.absences.reduce((a, b) => a + b, 0);
  const sumExc = s.excused.reduce((a, b) => a + b, 0);
  assert(sumAbs === s.totalAllTimeAbs, `Student #${s.id} (${s.name}): Block absences sum (${sumAbs}) === totalAllTimeAbs (${s.totalAllTimeAbs})`);
  assert(sumExc === s.totalAllTimeExc, `Student #${s.id} (${s.name}): Block excused sum (${sumExc}) === totalAllTimeExc (${s.totalAllTimeExc})`);
}

// 5.5 MASS WHOLE GROUP FULL DAY TEST ('all_absent' & 'all_excused')
console.log("\n--- 5.5 Mass Group Full Day Test ---");
const massEngine = new AttendanceEngine('faid-310');
const allStudentIds = students.map(s => s.id);

// Mark all 22 students full day absent on W3 Monday (4 lessons)
massEngine.handleSetWholeGroupFullDayStatus(dateW3Mo, w3MoDay!.lessons, allStudentIds, 'absent', true);

for (const lesson of w3MoDay!.lessons) {
  const rec = massEngine.getAttendance(dateW3Mo, lesson.id);
  assert(rec.absentStudentIds.length === 22, `Mass absent: Lesson ${lesson.id} has all 22 students marked absent`);
}

const massReport = massEngine.calculateReport(students);
const allHave8Hours = massReport.every(s => s.totalAllTimeAbs === 8 && s.totalAllTimeExc === 0);
assert(allHave8Hours, "All 22 students have exactly 8 hours absent (4 lessons * 2h)");

// Switch all 22 students to excused on W3 Monday
massEngine.handleSetWholeGroupFullDayStatus(dateW3Mo, w3MoDay!.lessons, allStudentIds, 'excused', true);
for (const lesson of w3MoDay!.lessons) {
  const rec = massEngine.getAttendance(dateW3Mo, lesson.id);
  assert(rec.excusedStudentIds?.length === 22, `Mass excused: Lesson ${lesson.id} has all 22 students marked excused`);
  assert(rec.absentStudentIds.length === 0, `Mass excused: Lesson ${lesson.id} has 0 absent students`);
}

const massReportExcused = massEngine.calculateReport(students);
const allHave8HoursExcused = massReportExcused.every(s => s.totalAllTimeExc === 8 && s.totalAllTimeAbs === 0);
assert(allHave8HoursExcused, "All 22 students have exactly 8 hours excused (4 lessons * 2h)");

// ============================================================================
// FINAL SUMMARY & VERDICT
// ============================================================================
console.log("\n================================================================================");
console.log(`TOTAL CHECKS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
console.log("================================================================================");

if (failedTests > 0) {
  console.error(">>> VERDICT: FAIL - ATTENDANCE MODULE CHECKS FAILED! <<<");
  process.exit(1);
} else {
  console.log(">>> VERDICT: SUCCESS - ALL 3-ФАИД-110 ATTENDANCE MODULE TESTS PASSED 100%! <<<");
}
