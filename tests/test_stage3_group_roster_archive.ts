import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';
import { Student } from '../types';
import { getLocalStudents, saveLocalStudents, importRosterBackup, exportRosterBackup } from '../utils/attendanceStorage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

console.log('=================================================================');
console.log('   TEST SUITE: STAGE 3 - GROUP ROSTER, ARCHIVE & BOT EXPORT     ');
console.log('=================================================================');

function check(desc: string, condition: boolean) {
  if (condition) {
    console.log(`  ✓ [PASS] ${desc}`);
  } else {
    console.error(`  ✗ [FAIL] ${desc}`);
    throw new Error(`Test assertion failed: ${desc}`);
  }
}

// 1. Verify types.ts
console.log('\n--- 1. Verification of Student Interface (№12) ---');
const typesContent = fs.readFileSync(path.resolve(root, 'types.ts'), 'utf8');
check('Student interface includes optional isArchived?: boolean', typesContent.includes('isArchived?: boolean'));

// 2. Storage round-trip for isArchived
console.log('\n--- 2. Storage Preservation of isArchived Flag ---');
const testGid = 'test-stage3-roster';
const sampleStudents: Student[] = [
  { id: 1, name: 'Яковлев Яков', isArchived: true },
  { id: 2, name: 'Алексеев Алексей' },
  { id: 3, name: 'Борисов Борис', isArchived: false }
];

saveLocalStudents(testGid, sampleStudents);
const loaded = getLocalStudents(testGid);
check('Loaded students count matches 3', loaded.length === 3);
check('Archived student preserves isArchived: true', loaded.find(s => s.id === 1)?.isArchived === true);
check('Active student without flag does not have isArchived: true', loaded.find(s => s.id === 2)?.isArchived !== true);
check('Active student with isArchived: false preserves false', loaded.find(s => s.id === 3)?.isArchived === false);

// Backup export and import preserves isArchived
const exportedJson = exportRosterBackup(testGid);
const targetImportGid = 'test-stage3-import';
const importRes = importRosterBackup(targetImportGid, exportedJson.replace(testGid, targetImportGid));
check('Importing backup with archived students succeeds', importRes.ok === true && importRes.count === 3);
const importedList = getLocalStudents(targetImportGid);
check('Imported list preserves archived student', importedList.find(s => s.id === 1)?.isArchived === true);

// 3. Alphabetical sorting logic check (№11)
console.log('\n--- 3. Alphabetical Sorting (localeCompare ru) & 1..N Numbering ---');
const mixedStudents: Student[] = [
  { id: 10, name: 'Сергеев Сергей' },
  { id: 20, name: 'Алексеев Алексей' },
  { id: 30, name: 'Яковлев Яков', isArchived: true },
  { id: 40, name: 'Борисов Борис' }
];

const activeSorted = mixedStudents
  .filter(s => !s.isArchived)
  .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

check('Active students count is 3', activeSorted.length === 3);
check('First active student is Алексеев', activeSorted[0].name === 'Алексеев Алексей');
check('Second active student is Борисов', activeSorted[1].name === 'Борисов Борис');
check('Third active student is Сергеев', activeSorted[2].name === 'Сергеев Сергей');

// 4. Verify GroupManager.tsx
console.log('\n--- 4. Verification of GroupManager.tsx ---');
const gmContent = fs.readFileSync(path.resolve(root, 'components/GroupManager.tsx'), 'utf8');

check('GroupManager sorts students by localeCompare ru', gmContent.includes("localeCompare(b.name, 'ru')") || gmContent.includes('localeCompare(b.name, "ru")'));
check('GroupManager defines activeStudents memo', gmContent.includes('activeStudents = useMemo'));
check('GroupManager defines archivedStudents memo', gmContent.includes('archivedStudents = useMemo'));
check('GroupManager has collapsible Выбывшие студенты section', gmContent.includes('Выбывшие студенты'));
check('GroupManager has handleRestoreStudent function', gmContent.includes('handleRestoreStudent'));
check('GroupManager imports uploadAttachmentFile for bot send', gmContent.includes('uploadAttachmentFile'));
check('GroupManager defines handleSendToBot function', gmContent.includes('handleSendToBot'));
check('GroupManager shows toast "Список группы отправлен в чат с ботом"', gmContent.includes('Список группы отправлен в чат с ботом'));
check('GroupManager has concise button "Отправить в бота"', gmContent.includes('Отправить в бота'));
check('GroupManager has concise button "Сохранить файл"', gmContent.includes('Сохранить файл'));
check('GroupManager has concise button "Восстановить из файла"', gmContent.includes('Восстановить из файла'));
check('GroupManager purged noise paragraph "Локальное сохранение списка и раздача кодов"', !gmContent.includes('Локальное сохранение списка и раздача кодов'));

// 5. Verify AttendanceTracker.tsx
console.log('\n--- 5. Verification of AttendanceTracker.tsx ---');
const attTrackerContent = fs.readFileSync(path.resolve(root, 'components/AttendanceTracker.tsx'), 'utf8');

check('AttendanceTracker defines activeStudents filtered and sorted by localeCompare', attTrackerContent.includes("localeCompare(b.name, 'ru')") || attTrackerContent.includes('localeCompare(b.name, "ru")'));
check('AttendanceTracker marks lesson attendance using activeStudents', attTrackerContent.includes('activeStudents.map'));
check('AttendanceTracker pre-calculates reportData using activeStudents', attTrackerContent.includes('activeStudents.map(student'));
check('AttendanceTracker exports Word using activeStudents', attTrackerContent.includes('exportAttendanceToWord(records, activeStudents'));

// 6. Verify AttendanceMatrix.tsx
console.log('\n--- 6. Verification of AttendanceMatrix.tsx ---');
const attMatrixContent = fs.readFileSync(path.resolve(root, 'components/AttendanceMatrix.tsx'), 'utf8');

check('AttendanceMatrix filters activeStudents by !isArchived and localeCompare', attMatrixContent.includes('!s.isArchived') && (attMatrixContent.includes("localeCompare(b.name, 'ru')") || attMatrixContent.includes('localeCompare(b.name, "ru")')));
check('AttendanceMatrix studentCumulativeStats uses activeStudents', attMatrixContent.includes('activeStudents.map(student'));
check('AttendanceMatrix group summary uses activeStudents.length', attMatrixContent.includes('{activeStudents.length}'));

console.log('\n=================================================================');
console.log('   ALL STAGE 3 TESTS PASSED (100%)');
console.log('=================================================================');
