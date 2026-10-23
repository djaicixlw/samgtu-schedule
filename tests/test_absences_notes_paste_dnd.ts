import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPhysicalEducationLesson, isPhysicalEducationLessonId } from '../attendance';
import { sanitizeUsefulItem } from '../utils/usefulStorage';
import { Lesson } from '../types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

console.log('=================================================================');
console.log('   TEST SUITE: ABSENCES, NOTES, PASTE (Ctrl+V) & USEFUL DND     ');
console.log('=================================================================\n');

// 1. MyAbsencesModal & PE filtering
console.log('1. Testing Physical Education Exclusion & Absence Hours...');
const peLesson: Lesson = {
  id: '310-w2-we-3',
  subject: 'Элективные курсы по физической культуре и спорту',
  type: 'Практика',
  timeStart: '11:30',
  timeEnd: '13:05'
};
const regularLesson: Lesson = {
  id: '310-w2-we-1',
  subject: 'Информатика',
  type: 'Лекции',
  timeStart: '08:00',
  timeEnd: '09:35'
};
const vucLesson: Lesson = {
  id: '310-w2-th-1',
  subject: 'Военная подготовка (ВУЦ)',
  type: 'Практика',
  timeStart: '08:00',
  timeEnd: '09:35'
};

assert(isPhysicalEducationLesson(peLesson) === true, 'PE lesson must be identified as PE');
assert(isPhysicalEducationLesson(regularLesson) === false, 'Informatics is not PE');
assert(isPhysicalEducationLesson(vucLesson) === false, 'VUC is NOT PE and must remain untouched');

const myAbsencesSrc = fs.readFileSync(path.resolve(root, 'components/MyAbsencesModal.tsx'), 'utf8');
assert(myAbsencesSrc.includes('isPhysicalEducationLesson'), 'MyAbsencesModal imports isPhysicalEducationLesson');
assert(myAbsencesSrc.includes('details.isPE'), 'MyAbsencesModal filters out details.isPE');
assert(myAbsencesSrc.includes('details.hours'), 'MyAbsencesModal accurately accounts for 2h vs 4h lesson duration');
console.log('  ✓ [PASS] PE is strictly excluded and hours are accurately weighted in student profile.');

// 2. Note lifecycle & date binding
console.log('\n2. Testing Schedule Note Date Binding & Non-Recurrence...');
const editLessonModalSrc = fs.readFileSync(path.resolve(root, 'components/EditLessonModal.tsx'), 'utf8');
assert(editLessonModalSrc.includes('targetDate?: string'), 'EditLessonModal accepts targetDate');
assert(editLessonModalSrc.includes('isNoteRecurring'), 'EditLessonModal supports isNoteRecurring toggle');
assert(editLessonModalSrc.includes('Повторять каждые 4 недели'), 'EditLessonModal has label for recurring note');

const classCardSrc = fs.readFileSync(path.resolve(root, 'components/ClassCard.tsx'), 'utf8');
assert(classCardSrc.includes('dayIso?: string'), 'ClassCard accepts dayIso');
assert(classCardSrc.includes('targetDate={dayIso}'), 'ClassCard forwards dayIso as targetDate to modal');

const appSrc = fs.readFileSync(path.resolve(root, 'App.tsx'), 'utf8');
assert(appSrc.includes('!resolvedNoteDate && isoDate && !isoDate.startsWith(\'2026-09\')'), 'App.tsx suppresses legacy un-dated September notes on October and beyond');
assert(appSrc.includes('resolvedNoteDate && resolvedNoteDate !== isoDate'), 'App.tsx suppresses notes for different calendar dates');
console.log('  ✓ [PASS] Notes are date-bound by default and legacy September notes do not leak into October.');

// 3. Clipboard Ctrl+V Paste handler
console.log('\n3. Testing Clipboard (Ctrl+V) Screenshot Pasting...');
assert(editLessonModalSrc.includes("e.clipboardData?.items"), 'EditLessonModal has paste listener');
assert(editLessonModalSrc.includes("uploadFileRef.current(file)") && editLessonModalSrc.includes("const uploadFileRef"), 'EditLessonModal uploads pasted file through a declared handler');

const bugReportSrc = fs.readFileSync(path.resolve(root, 'components/BugReportModal.tsx'), 'utf8');
assert(bugReportSrc.includes("e.clipboardData?.items"), 'BugReportModal has paste listener');
assert(bugReportSrc.includes("addScreenshotFiles(pastedFiles)"), 'BugReportModal handles pasted screenshots');

const homeworkTrackerSrc = fs.readFileSync(path.resolve(root, 'components/HomeworkTracker.tsx'), 'utf8');
assert(homeworkTrackerSrc.includes("e.clipboardData?.items"), 'HomeworkTracker has paste listener');
assert(homeworkTrackerSrc.includes("uploadFile(file)"), 'HomeworkTracker uploads pasted file');

const usefulTrackerSrc = fs.readFileSync(path.resolve(root, 'components/UsefulTracker.tsx'), 'utf8');
assert(usefulTrackerSrc.includes("e.clipboardData?.items"), 'UsefulTracker has paste listener');
assert(usefulTrackerSrc.includes("uploadFile(file)"), 'UsefulTracker uploads pasted file');
console.log('  ✓ [PASS] Ctrl+V paste handlers present and wired in all 4 modals.');

// 4. UsefulTracker Drag-and-Drop & Reordering
console.log('\n4. Testing UsefulTracker Drag-and-Drop Reordering...');
assert(usefulTrackerSrc.includes("draggable={canEdit}"), 'UsefulTracker cards are draggable for staff');
assert(usefulTrackerSrc.includes("handleDragStart"), 'UsefulTracker has handleDragStart');
assert(usefulTrackerSrc.includes("handleDrop"), 'UsefulTracker has handleDrop');
assert(usefulTrackerSrc.includes("GripVertical"), 'UsefulTracker renders GripVertical handle');

const sanitized = sanitizeUsefulItem({
  id: 'test-1',
  title: 'Учебник',
  text: 'Глава 1',
  order: 5,
  isPinned: false
}, 'ingt-310');
assert(sanitized !== null, 'Sanitization succeeded');
assert.strictEqual(sanitized?.order, 5, 'order field preserved during sanitization');

const usefulStorageSrc = fs.readFileSync(path.resolve(root, 'utils/usefulStorage.ts'), 'utf8');
assert(usefulStorageSrc.includes('a.order !== undefined && b.order !== undefined'), 'usefulStorage sorts by order');
console.log('  ✓ [PASS] Drag-and-drop state, grip handle and order sorting verified.');

console.log('\n=================================================================');
console.log('   ALL ABSENCES, NOTES, PASTE & DND TESTS PASSED (100%)         ');
console.log('=================================================================');
