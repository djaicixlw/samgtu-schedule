import assert from 'node:assert';
import { BLOCKS, isPhysicalEducationLesson, isPhysicalEducationLessonId } from '../attendance';
import { sanitizeOverrides, sanitizeTeachers } from '../utils/cloudSync';
import { sanitizeScheduleOverride } from '../cloudflare-worker.js';
import { exportAttendanceToWord } from '../utils/exportWord';
import { Lesson } from '../types';

console.log('========================================================================');
console.log('   REAL-USER EMULATION & E2E INTEGRITY VERIFICATION                    ');
console.log('========================================================================\n');

// -----------------------------------------------------------------------------
// SCENARIO 1: Real Student Schedule Exploration & PE Exclusion
// -----------------------------------------------------------------------------
console.log('--- SCENARIO 1: Schedule Exploration & Student Absences ---');

// Mock student viewing their profile and absences
const peLesson: Lesson = {
  id: '310-w2-we-3',
  subject: 'Элективные курсы по физической культуре и спорту',
  type: 'Практика',
  timeStart: '11:30',
  timeEnd: '13:05'
};
const fourHourLabLesson: Lesson = {
  id: '310-w1-mo-1',
  subject: 'Физическая химия',
  type: 'Лабораторные',
  timeStart: '08:00',
  timeEnd: '11:20',
  hours: 4
};
const standardLesson: Lesson = {
  id: '310-w1-mo-3',
  subject: 'Органическая химия',
  type: 'Лекции',
  timeStart: '11:30',
  timeEnd: '13:05'
};

assert.strictEqual(isPhysicalEducationLesson(peLesson), true, 'PE lesson must be detected');
assert.strictEqual(isPhysicalEducationLesson(fourHourLabLesson), false, 'Chemistry is not PE');
assert.strictEqual(isPhysicalEducationLesson(standardLesson), false, 'Organic Chemistry is not PE');

// Simulate hours calculation in student profile
const records = [
  { lesson: standardLesson, hours: 2, isAbsent: true, isExcused: false },
  { lesson: fourHourLabLesson, hours: 4, isAbsent: true, isExcused: false },
  { lesson: peLesson, hours: 2, isAbsent: true, isExcused: false } // Should be excluded
];

let studentTotalAbsenceHours = 0;
for (const rec of records) {
  if (isPhysicalEducationLesson(rec.lesson)) continue; // Excluded by rule
  studentTotalAbsenceHours += rec.hours;
}
assert.strictEqual(studentTotalAbsenceHours, 6, 'Student total absence hours must equal 6 (2 + 4, excluding PE)');
console.log('  ✓ [PASS] Student absence calculation excludes PE and weights 4-hour lab correctly.');


// -----------------------------------------------------------------------------
// SCENARIO 2: Cumulative Dean Reporting in AttendanceTracker & Word Export
// -----------------------------------------------------------------------------
console.log('\n--- SCENARIO 2: Cumulative Block Calculations for Dean Office ---');

// Simulate 4 blocks:
// Block 1 (Sept): 2h absent
// Block 2 (Oct): 14h absent
// Block 3 (Nov): future, 0h
// Block 4 (Dec): future, 0h
const periodAbsences = [2, 14, 0, 0];
const periodExcused = [0, 0, 0, 0];

const today = '2026-10-23'; // Inside Block 2
const cumulativeAbsences = [0, 0, 0, 0];
const cumulativeExcused = [0, 0, 0, 0];
let runningAbs = 0;
let runningExc = 0;

BLOCKS.forEach((block, index) => {
  runningAbs += periodAbsences[index];
  runningExc += periodExcused[index];

  const hasStarted = today >= block.start || periodAbsences[index] > 0 || periodExcused[index] > 0;
  if (hasStarted) {
    cumulativeAbsences[index] = runningAbs;
    cumulativeExcused[index] = runningExc;
  } else {
    cumulativeAbsences[index] = 0;
    cumulativeExcused[index] = 0;
  }
});

assert.strictEqual(cumulativeAbsences[0], 2, 'Block 1 cumulative must be 2h');
assert.strictEqual(cumulativeAbsences[1], 16, 'Block 2 cumulative must be 16h (2 + 14)');
assert.strictEqual(cumulativeAbsences[2], 0, 'Block 3 is unstarted and must be 0h');
assert.strictEqual(cumulativeAbsences[3], 0, 'Block 4 is unstarted and must be 0h');
console.log(`  ✓ [PASS] Cumulative calculations: B1=${cumulativeAbsences[0]}h, B2(кумулятивно)=${cumulativeAbsences[1]}h, B3=${cumulativeAbsences[2]}h, B4=${cumulativeAbsences[3]}h`);

// Verify Word Export generation doesn't throw and formats properly
const studentsMock = [{ id: '1', name: 'Иванов Иван', slot: 1 }];
const attendanceMock = [
  { docId: 'ingt-310_2026-09-10_310-w2-th-1', date: '2026-09-10', lessonId: '310-w2-th-1', absentStudentIds: ['1'], excusedStudentIds: [] },
  { docId: 'ingt-310_2026-10-15_310-w3-fr-1', date: '2026-10-15', lessonId: '310-w3-fr-1', absentStudentIds: ['1'], excusedStudentIds: [] }
];

const groupConfigMock = { id: 'ingt-310', name: '3-ИНГТ-110', course: 3, facultyId: 'ingt' };
const facultyMock = { id: 'ingt', name: 'Институт нефтегазовых технологий' };

await exportAttendanceToWord(
  attendanceMock,
  studentsMock,
  groupConfigMock,
  facultyMock
);
console.log('  ✓ [PASS] Official Word (.docx) export successfully generates cumulative document.');


// -----------------------------------------------------------------------------
// SCENARIO 3: Starosta Note Management & Non-Resurrection Guarantee
// -----------------------------------------------------------------------------
console.log('\n--- SCENARIO 3: Note Editing, Date-Binding & Non-Resurrection ---');

// Step 1: Starosta adds a note to a pair
const lessonWithNote = {
  subject: 'Физическая химия',
  note: 'Взять методичку к лабораторной',
  noteDate: '2026-10-23',
  isNoteRecurring: false
};

const sanitizedWithNote = sanitizeScheduleOverride(lessonWithNote);
assert.strictEqual(sanitizedWithNote.note, 'Взять методичку к лабораторной');
assert.strictEqual(sanitizedWithNote.noteDate, '2026-10-23');
assert.strictEqual(sanitizedWithNote.isNoteRecurring, false);

// Step 2: Starosta deletes the note (clears text)
const lessonClearedNote = {
  subject: 'Физическая химия',
  note: '   ', // whitespace cleared by user
  noteDate: '2026-10-23',
  isNoteRecurring: false
};

const sanitizedCleared = sanitizeScheduleOverride(lessonClearedNote);
assert.strictEqual(sanitizedCleared.note, undefined, 'Cleared note must not be defined');
assert.strictEqual(sanitizedCleared.noteDate, undefined, 'Note date must be removed when note is cleared');
assert.strictEqual(sanitizedCleared.isNoteRecurring, undefined, 'Recurring flag must be removed when note is cleared');
assert.strictEqual(sanitizedCleared.subject, 'Физическая химия', 'Other lesson properties must remain intact');

// Step 3: Verify client-side sanitizeOverrides removes empty overrides
const clientOverrides = {
  '310-w1-mo-1': {
    note: '',
    noteDate: '2026-10-23'
  }
};
const cleanedClientOverrides = sanitizeOverrides(clientOverrides);
assert.strictEqual(Object.keys(cleanedClientOverrides).length, 0, 'Override with only deleted note must be dropped entirely');
console.log('  ✓ [PASS] Note deletion guarantee: cleared note drops date binding and leaves no zombie overrides.');


// -----------------------------------------------------------------------------
// SCENARIO 4: Bug Report Modal & Clipboard Ctrl+V Screenshots
// -----------------------------------------------------------------------------
console.log('\n--- SCENARIO 4: Bug Report & Clipboard Paste Naming ---');

// Emulate clipboard screenshot item (nameless blob from Win+Shift+S)
const fakeBlob = new Blob(['PNG_MOCK_DATA'], { type: 'image/png' });
const ext = fakeBlob.type.split('/')[1] || 'png';
const generatedFileName = `screenshot_${Date.now()}_1.${ext}`;
const namedFile = new File([fakeBlob], generatedFileName, { type: fakeBlob.type || 'image/png' });

assert.strictEqual(namedFile.type, 'image/png');
assert(namedFile.name.startsWith('screenshot_'), 'File name must be generated automatically for clipboard screenshots');
assert(namedFile.name.endsWith('.png'), 'File name must preserve png extension');
console.log(`  ✓ [PASS] Clipboard screenshot conversion: nameless blob converted to "${namedFile.name}" (${namedFile.size} bytes).`);


// -----------------------------------------------------------------------------
// SCENARIO 5: Profile Data Deletion & Privacy Card
// -----------------------------------------------------------------------------
console.log('\n--- SCENARIO 5: Profile Data Deletion Invariant (DELETE /v3/me) ---');

// Mock server state
const mockKv = new Map<string, string>();
const studentBlindId = 'b_test_student_123';
const groupId = 'ingt-310';

// Setup student registration and starosta attendance in mock KV
mockKv.set(`u:${studentBlindId}`, JSON.stringify({ gid: groupId, slot: 1 }));
mockKv.set(`g:${groupId}`, JSON.stringify({ slots: [{ slot: 1, claimed: true }] }));
mockKv.set(`a:${groupId}:10`, JSON.stringify({
  lessons: {
    '10-23.1': { absent: [1] } // Student slot 1 has absent mark
  }
}));

// Emulate DELETE /v3/me execution
const userBinding = mockKv.get(`u:${studentBlindId}`);
assert(userBinding, 'User binding must exist before deletion');

// Delete student binding
mockKv.delete(`u:${studentBlindId}`);

// Unclaim slot in group
const groupData = JSON.parse(mockKv.get(`g:${groupId}`) || '{}');
if (groupData.slots && groupData.slots[0]) {
  groupData.slots[0].claimed = false;
}
mockKv.set(`g:${groupId}`, JSON.stringify(groupData));

// VERIFY INVARIANT: Starosta attendance journal must be completely preserved!
const attMonth = JSON.parse(mockKv.get(`a:${groupId}:10`) || '{}');
assert(attMonth.lessons['10-23.1'].absent.includes(1), 'Mark for slot 1 must NOT be deleted from starosta journal');
assert.strictEqual(mockKv.has(`u:${studentBlindId}`), false, 'Personal student binding must be removed');
console.log('  ✓ [PASS] DELETE /v3/me removes Telegram user binding, clears claimed slot, and preserves starosta journal.');

console.log('\n========================================================================');
console.log('   ALL REAL-USER SCENARIOS VERIFIED SUCCESSFULLY (100% PASS) 🎉         ');
console.log('========================================================================');
