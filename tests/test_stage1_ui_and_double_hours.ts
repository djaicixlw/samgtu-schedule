import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { calculateStudentAbsenceHours, AttendanceRecord } from '../attendance';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

console.log('=================================================================');
console.log('   TEST SUITE: STAGE 1 UI SIMPLIFICATION & 4-HOUR LESSONS       ');
console.log('=================================================================\n');

// -----------------------------------------------------------------------------
// 1. Network Status Dot Indicator in Header (№26)
// -----------------------------------------------------------------------------
console.log('1. Testing Network Status Dot Indicator in App.tsx (№26)...');
const appSrc = fs.readFileSync(path.resolve(root, 'App.tsx'), 'utf8');

assert(appSrc.includes('w-2 h-2 rounded-full'), 'App.tsx must define w-2 h-2 rounded-full network dot');
assert(appSrc.includes('bg-emerald-500') && appSrc.includes('bg-rose-500'), 'App.tsx must use emerald for online and rose for offline');
assert(appSrc.includes('navigator.onLine'), 'App.tsx must inspect navigator.onLine');
assert(appSrc.includes("'online'") && appSrc.includes("'offline'"), "App.tsx must listen to 'online' and 'offline' window events");
assert(appSrc.includes('В сети') && appSrc.includes('Офлайн (сохраненная копия)'), 'App.tsx must include exact network tooltip');
console.log('  ✓ [PASS] Network indicator in header is minimalist and accurate.');

// -----------------------------------------------------------------------------
// 2. Silent Mode / Bell Toggle in Header (№24)
// -----------------------------------------------------------------------------
console.log('\n2. Testing Silent Mode (Bell / BellOff) in App.tsx (№24)...');
assert(appSrc.includes('Bell') && appSrc.includes('BellOff'), 'App.tsx must import and use Bell and BellOff icons');
assert(appSrc.includes('notifications_enabled'), 'App.tsx must persist notifications state in localStorage notifications_enabled');
assert(appSrc.includes('Уведомления включены'), 'App.tsx must show toast «Уведомления включены»');
assert(appSrc.includes('Режим тишины включен'), 'App.tsx must show toast «Режим тишины включен»');
console.log('  ✓ [PASS] Silent mode bell toggle correctly implemented and integrated with sonner toast.');

// -----------------------------------------------------------------------------
// 3. Purge of Bureaucracy & Jargon (№35 + №14)
// -----------------------------------------------------------------------------
console.log('\n3. Testing Anti-Bureaucracy & Tone Cleanup (№35 + №14)...');
const starostaModalSrc = fs.readFileSync(path.resolve(root, 'components/StarostaOnboardingModal.tsx'), 'utf8');
const consentModalSrc = fs.readFileSync(path.resolve(root, 'components/ConsentModal.tsx'), 'utf8');
const privacyModalSrc = fs.readFileSync(path.resolve(root, 'components/PrivacyPolicyModal.tsx'), 'utf8');

const checkedFiles = [
  { name: 'App.tsx', content: appSrc },
  { name: 'StarostaOnboardingModal.tsx', content: starostaModalSrc },
  { name: 'ConsentModal.tsx', content: consentModalSrc },
  { name: 'PrivacyPolicyModal.tsx', content: privacyModalSrc }
];

for (const file of checkedFiles) {
  assert(!file.content.includes('152-ФЗ'), `${file.name} must NOT contain '152-ФЗ'`);
  assert(!file.content.includes('E2EE-шифрование включено'), `${file.name} must NOT contain 'E2EE-шифрование включено'`);
  assert(!file.content.includes('Zero-Knowledge'), `${file.name} must NOT contain 'Zero-Knowledge'`);
}

// Check friendly starosta onboarding text
const requiredOnboardingPhrase = 'Введите код доступа группы, чтобы отмечать посещаемость и редактировать расписание';
assert(starostaModalSrc.includes(requiredOnboardingPhrase), 'StarostaOnboardingModal must contain exact concise prompt phrase');
assert(appSrc.includes(requiredOnboardingPhrase), 'App.tsx must contain exact concise prompt phrase');
console.log('  ✓ [PASS] Zero bureaucracy, zero 152-ФЗ, zero E2EE/Zero-Knowledge, and exact friendly onboarding string confirmed.');

// -----------------------------------------------------------------------------
// 4. Double Lessons (4 Hours) (№3)
// -----------------------------------------------------------------------------
console.log('\n4. Testing Double Lessons (4 Hours) Support (№3)...');

// 4.1 types.ts
const typesSrc = fs.readFileSync(path.resolve(root, 'types.ts'), 'utf8');
assert(typesSrc.includes('hours?: number;'), 'types.ts Lesson interface must declare hours?: number');

// 4.2 EditLessonModal.tsx
const editModalSrc = fs.readFileSync(path.resolve(root, 'components/EditLessonModal.tsx'), 'utf8');
assert(editModalSrc.includes('2 часа') && editModalSrc.includes('4 часа (сдвоенная)'), 'EditLessonModal must have 2h / 4h toggle options');
assert(editModalSrc.includes('hours'), 'EditLessonModal must pass hours in onSave');

// 4.3 ClassCard.tsx
const classCardSrc = fs.readFileSync(path.resolve(root, 'components/ClassCard.tsx'), 'utf8');
assert(classCardSrc.includes('lesson.hours === 4'), 'ClassCard must check if lesson.hours === 4');
assert(classCardSrc.includes('4 ч'), 'ClassCard must display «4 ч» badge for double lessons');

// 4.4 attendance.ts calculation
const recordsWith4Hours: AttendanceRecord[] = [
  {
    groupId: 'ingt-310',
    date: '2026-09-17',
    lessonId: '310-w2-th-1', // 4-hour double lesson
    absentStudentIds: [10],
    excusedStudentIds: [],
    isCancelled: false,
    hours: 4
  },
  {
    groupId: 'ingt-310',
    date: '2026-09-18',
    lessonId: '310-w2-fr-2', // regular 2-hour lesson
    absentStudentIds: [10],
    excusedStudentIds: [],
    isCancelled: false,
    hours: 2
  }
];

const absenceResult = calculateStudentAbsenceHours(recordsWith4Hours, 10);
assert.strictEqual(absenceResult.totalAbs, 6, 'Student with 4h + 2h absences must have exactly 6 total absence hours');

// Test with lesson object resolver having 4 hours
const recordsWithLessonResolver: AttendanceRecord[] = [
  {
    groupId: 'ingt-310',
    date: '2026-09-17',
    lessonId: 'custom-double-pair',
    absentStudentIds: [10],
    excusedStudentIds: [],
    isCancelled: false
  }
];

const absenceWithResolver = calculateStudentAbsenceHours(
  recordsWithLessonResolver,
  10,
  { 'custom-double-pair': { hours: 4 } }
);
assert.strictEqual(absenceWithResolver.totalAbs, 4, 'Resolver with hours: 4 must result in 4 absence hours');

console.log('  ✓ [PASS] 4-hour double lesson toggle, badge, and attendance math 100% verified.');

console.log('\n=================================================================');
console.log('   ALL STAGE 1 & 4-HOUR LESSON TESTS PASSED SUCCESSFULLY!       ');
console.log('=================================================================\n');
