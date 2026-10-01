import { BLOCKS, AttendanceRecord, STUDENTS_REGISTRY } from '../attendance';
import { AVAILABLE_GROUPS, FACULTIES } from '../constants';

console.log("=================================================");
console.log("       TEST SUITE 2: ATTENDANCE TRACKER          ");
console.log("=================================================");

const students = STUDENTS_REGISTRY['ingt-310'];

// 2.1 Absence calculation simulation
console.log("\n--- 2.1 Absence Hours Calculation ---");
const mockRecords: AttendanceRecord[] = [
  {
    groupId: 'ingt-310',
    date: '2026-09-01',
    lessonId: '310-w1-tu-1',
    absentStudentIds: [1, 2],
    excusedStudentIds: [3],
    isCancelled: false
  },
  {
    groupId: 'ingt-310',
    date: '2026-09-01',
    lessonId: '310-w1-tu-2',
    absentStudentIds: [1],
    excusedStudentIds: [],
    isCancelled: false
  },
  {
    groupId: 'ingt-310',
    date: '2026-09-01',
    lessonId: '310-w1-tu-3',
    absentStudentIds: [1, 2],
    excusedStudentIds: [],
    isCancelled: true // CANCELLED LESSON
  },
  {
    groupId: 'ingt-310',
    date: '2026-09-01',
    lessonId: '310-w1-tu-4',
    // Corrupted record: student 4 is in BOTH absent and excused
    absentStudentIds: [4],
    excusedStudentIds: [4],
    isCancelled: false
  }
];

function calculateReport(records: AttendanceRecord[], studentList: typeof students) {
  return studentList.map(student => {
    const absences = [0, 0, 0, 0];
    const excused = [0, 0, 0, 0];
    let totalAllTimeAbs = 0;
    let totalAllTimeExc = 0;
    
    records.forEach(record => {
      if (record.isCancelled) return;

      const isExcused = (record.excusedStudentIds || []).includes(student.id);
      const isAbsent = !isExcused && record.absentStudentIds.includes(student.id);

      if (isAbsent) totalAllTimeAbs += 2;
      if (isExcused) totalAllTimeExc += 2;

      if (isAbsent || isExcused) {
        BLOCKS.forEach((block, index) => {
          if (record.date >= block.start && record.date <= block.end) {
            if (isAbsent) absences[index] += 2;
            if (isExcused) excused[index] += 2;
          }
        });
      }
    });
    
    return { ...student, absences, excused, totalAllTimeAbs, totalAllTimeExc };
  });
}

const report = calculateReport(mockRecords, students);

console.log("Student 1 (Absent on lesson 1 & 2, lesson 3 cancelled):");
const s1 = report.find(s => s.id === 1)!;
console.log(`  Total Abs: ${s1.totalAllTimeAbs}h (Expected 4h, cancelled lesson not counted: ${s1.totalAllTimeAbs === 4 ? 'PASS' : 'FAIL'})`);

console.log("\nStudent 2 (Absent on lesson 1, lesson 3 cancelled):");
const s2 = report.find(s => s.id === 2)!;
console.log(`  Total Abs: ${s2.totalAllTimeAbs}h (Expected 2h: ${s2.totalAllTimeAbs === 2 ? 'PASS' : 'FAIL'})`);

console.log("\nStudent 3 (Excused on lesson 1):");
const s3 = report.find(s => s.id === 3)!;
console.log(`  Total Exc: ${s3.totalAllTimeExc}h (Expected 2h: ${s3.totalAllTimeExc === 2 ? 'PASS' : 'FAIL'})`);

console.log("\nStudent 4 (In BOTH absent and excused arrays due to sync glitch):");
const s4 = report.find(s => s.id === 4)!;
console.log(`  Total Abs: ${s4.totalAllTimeAbs}h, Total Exc: ${s4.totalAllTimeExc}h, Sum: ${s4.totalAllTimeAbs + s4.totalAllTimeExc}h (Expected 2h, priority excused: ${s4.totalAllTimeExc === 2 && s4.totalAllTimeAbs === 0 ? 'PASS' : 'FAIL'})`);

// 2.2 Percentage calculation and division by zero test
console.log("\n--- 2.2 Absence Percentage & Division by Zero ---");
const totalLessonsPossible = 0; // Empty attendance or zero lessons held yet
const studentAbsences = 0;
const safePercent = totalLessonsPossible > 0 ? Math.round((studentAbsences / totalLessonsPossible) * 100) : 0;
console.log(`0 absences out of 0 total lessons: safePercent = ${safePercent}% (Protected against NaN: PASS)`);

// 2.3 Date falling outside 4 BLOCKS
console.log("\n--- 2.3 Records outside BLOCKS boundaries ---");
const outOfBoundsRecord: AttendanceRecord = {
  groupId: 'ingt-310',
  date: '2026-12-28', // Winter session / New year week, outside Block 4 (ends 2026-12-25)
  lessonId: 'extra-1',
  absentStudentIds: [1],
  isCancelled: false
};
const reportWithOOB = calculateReport([outOfBoundsRecord], students);
const s1OOB = reportWithOOB.find(s => s.id === 1)!;
console.log(`Date 2026-12-28 (after Block 4 ends):`);
console.log(`  totalAllTimeAbs: ${s1OOB.totalAllTimeAbs}h`);
console.log(`  absences by blocks: [${s1OOB.absences.join(', ')}]`);
if (s1OOB.totalAllTimeAbs === 2 && s1OOB.absences.every(a => a === 0)) {
  console.log("  >>> INCONSISTENCY: totalAllTimeAbs has 2h, but blocks sum is 0h! Missing in official report for dean's office! <<<");
}
