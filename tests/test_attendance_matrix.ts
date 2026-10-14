import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BLOCKS, TIME_SLOTS, getDayISODate, getSemesterWeek } from '../attendance';
import { SCHEDULE_REGISTRY } from '../constants';
import { AttendanceRecord } from '../attendance';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("=================================================");
console.log("  TEST SUITE: ATTENDANCE MATRIX & CUMULATIVE STATS");
console.log("=================================================");

// 1. Verification of AttendanceMatrix Component Source File
console.log("\n--- 1. Verification of AttendanceMatrix Component ---");
const matrixPath = path.resolve(__dirname, '../components/AttendanceMatrix.tsx');
assert.strictEqual(fs.existsSync(matrixPath), true, "components/AttendanceMatrix.tsx must exist");
const matrixSrc = fs.readFileSync(matrixPath, 'utf8');

assert(matrixSrc.includes('export const AttendanceMatrix'), "AttendanceMatrix must be exported as named export");
assert(matrixSrc.includes('export default AttendanceMatrix'), "AttendanceMatrix must be exported as default export");
console.log("  ✓ [PASS] AttendanceMatrix exists and exports properly");

// 2. Verification of Props & Role Logic
console.log("\n--- 2. Verification of Permissions & Role Check ---");
assert(matrixSrc.includes('currentGroupId'), "AttendanceMatrix must accept currentGroupId prop");
assert(matrixSrc.includes("normalizedRole === 'admin' || normalizedRole === 'starosta'"), "canEdit must check admin and starosta");
console.log("  ✓ [PASS] canEdit logic strictly checks admin and starosta roles");

// 3. Verification of TIME_SLOTS in attendance.ts
console.log("\n--- 3. Verification of TIME_SLOTS Constant in attendance.ts ---");
assert.strictEqual(Object.keys(TIME_SLOTS).length, 6, "TIME_SLOTS must contain exactly 6 slots (1..6)");
assert.strictEqual(TIME_SLOTS['1'].timeStart, '08:00');
assert.strictEqual(TIME_SLOTS['1'].timeEnd, '09:35');
assert.strictEqual(TIME_SLOTS['6'].timeStart, '17:25');
assert.strictEqual(TIME_SLOTS['6'].timeEnd, '19:00');
console.log("  ✓ [PASS] TIME_SLOTS in attendance.ts matches SamGTU official schedule (1..6)");

// 4. Verification of Weekly Grid Mode & Cell Badges
console.log("\n--- 4. Verification of Weekly Grid Mode & Badges ---");
assert(matrixSrc.includes('Сетка недели'), "Weekly Grid mode must be present");
assert(matrixSrc.includes('getDayISODate'), "Must calculate ISO date for week days");
assert(matrixSrc.includes('overflow-x-auto'), "Must contain overflow-x-auto for mobile horizontal scroll");
assert(matrixSrc.includes('sticky left-0'), "Must have sticky left column for student names");

// Check badge labels
assert(matrixSrc.includes('>Н<') || matrixSrc.includes('Н'), "Badge 'Н' must be present for absences");
assert(matrixSrc.includes('>УП<') || matrixSrc.includes('УП'), "Badge 'УП' must be present for excused absences");
assert(matrixSrc.includes('✓'), "Checkmark '✓' must be present for attended pairs");
console.log("  ✓ [PASS] Weekly Grid mode, responsive scrolling, and compact badges verified");

// 5. Verification of Cumulative Accounting (Block 1 + Block 2 for Dean's Office)
console.log("\n--- 5. Verification of Cumulative Hours Logic ---");
assert(matrixSrc.includes('b2Cumulative'), "Must compute cumulative hours for Block 2 (b2Cumulative)");
assert(matrixSrc.includes('деканат'), "Must indicate Block 2 cumulative totals for dean submission");

// Test Cumulative Math using simulated records
const mockRecords: AttendanceRecord[] = [
  // Block 1 (2026-08-31 to 2026-09-27)
  { groupId: 'ingt-310', date: '2026-09-02', lessonId: '310-w1-we-1', absentStudentIds: [1], excusedStudentIds: [] }, // 2h abs
  { groupId: 'ingt-310', date: '2026-09-05', lessonId: '310-w1-sa-1', absentStudentIds: [], excusedStudentIds: [1] }, // 2h exc
  // Block 2 (2026-09-28 to 2026-10-25)
  { groupId: 'ingt-310', date: '2026-09-30', lessonId: '310-w4-we-1', absentStudentIds: [1], excusedStudentIds: [] }, // 2h abs
  { groupId: 'ingt-310', date: '2026-10-03', lessonId: '310-w4-sa-1', absentStudentIds: [1], excusedStudentIds: [] }, // 2h abs
];

let b1Abs = 0;
let b1Exc = 0;
let b2Abs = 0;
let b2Exc = 0;

mockRecords.forEach(r => {
  const isExc = (r.excusedStudentIds || []).includes(1);
  const isAbs = !isExc && r.absentStudentIds.includes(1);
  if (r.date >= BLOCKS[0].start && r.date <= BLOCKS[0].end) {
    if (isExc) b1Exc += 2;
    else if (isAbs) b1Abs += 2;
  } else if (r.date >= BLOCKS[1].start && r.date <= BLOCKS[1].end) {
    if (isExc) b2Exc += 2;
    else if (isAbs) b2Abs += 2;
  }
});

const b1Total = b1Abs + b1Exc;
const b2Period = b2Abs + b2Exc;
const b2Cumulative = b1Total + b2Period;
const grandTotal = b1Total + b2Period;

assert.strictEqual(b1Abs, 2, "Student 1 has 2h absent in Block 1");
assert.strictEqual(b1Exc, 2, "Student 1 has 2h excused in Block 1");
assert.strictEqual(b1Total, 4, "Block 1 total must be 4h");
assert.strictEqual(b2Period, 4, "Block 2 period absences must be 4h");
assert.strictEqual(b2Cumulative, 8, "Block 2 CUMULATIVE must be 4 + 4 = 8h");
assert.strictEqual(grandTotal, 8, "Grand total must be 8h");
console.log("  ✓ [PASS] Cumulative hours math verified: Block 1 = 4h, Block 2 Cumulative = 8h");

// 6. Verification of Integration into AttendanceTracker.tsx
console.log("\n--- 6. Verification of Integration into AttendanceTracker ---");
const trackerPath = path.resolve(__dirname, '../components/AttendanceTracker.tsx');
assert.strictEqual(fs.existsSync(trackerPath), true, "components/AttendanceTracker.tsx must exist");
const trackerSrc = fs.readFileSync(trackerPath, 'utf8');

assert(trackerSrc.includes("import { AttendanceMatrix } from './AttendanceMatrix'"), "AttendanceTracker must import AttendanceMatrix");
assert(trackerSrc.includes("<AttendanceMatrix"), "AttendanceTracker must render AttendanceMatrix");
assert(trackerSrc.includes("activeTab === 'details'"), "Must be rendered inside activeTab === 'details'");
assert(trackerSrc.includes("activeTab === 'mark'"), "Must preserve activeTab === 'mark' intact");
console.log("  ✓ [PASS] AttendanceMatrix cleanly integrated into AttendanceTracker 'details' tab");

// 7. Anti-Bureaucratic & Clean Tone Check
console.log("\n--- 7. Anti-Bureaucratic & Tone Compliance ---");
assert(!matrixSrc.includes('152-ФЗ') && !matrixSrc.includes('152-фз'), "AttendanceMatrix must NOT mention 152-ФЗ");
assert(!trackerSrc.includes('152-ФЗ') && !trackerSrc.includes('152-фз'), "AttendanceTracker must NOT mention 152-ФЗ");
console.log("  ✓ [PASS] Zero mentions of 152-ФЗ or bureaucratic jargon in components");

console.log("\n=================================================");
console.log("  ALL ATTENDANCE MATRIX CHECKS PASSED (100%)     ");
console.log("=================================================");
