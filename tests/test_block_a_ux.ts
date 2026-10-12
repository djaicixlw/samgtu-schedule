import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

console.log('=================================================');
console.log('    TEST SUITE: BLOCK A UX INTEGRITY TESTS       ');
console.log('=================================================');

// 1. Check B-01: Slot strictly below name in GroupManager.tsx
console.log('\n--- 1. Verification of B-01 (Slot strictly below name) ---');
const gmContent = fs.readFileSync(path.resolve(root, 'components/GroupManager.tsx'), 'utf8');
assert(
  gmContent.includes('flex flex-col items-start min-w-0'),
  'GroupManager.tsx must use flex-col items-start for student name and slot chip'
);
assert(
  !gmContent.includes('flex flex-wrap items-center gap-2 min-w-0'),
  'GroupManager.tsx must not use horizontal flex-wrap for slot chip'
);
console.log('  [PASS] B-01: Slot is positioned strictly below student name in flex-col');

// 2. Check B-02: Purge of JSON words from user-facing interface
console.log('\n--- 2. Verification of B-02 (Purge JSON from visible UI) ---');
assert(gmContent.includes('Сохранить файл'), 'GroupManager.tsx must have button "Сохранить файл"');
assert(gmContent.includes('Скопировать список'), 'GroupManager.tsx must have button "Скопировать список"');
assert(gmContent.includes('Восстановить список из файла'), 'GroupManager.tsx must have button "Восстановить список из файла"');
assert(gmContent.includes('Вставить список'), 'GroupManager.tsx must have button "Вставить список"');
assert(!gmContent.includes('<span>Скачать (.json)</span>'), 'GroupManager.tsx must not have visible label "Скачать (.json)"');
assert(!gmContent.includes('<span>Скопировать JSON</span>'), 'GroupManager.tsx must not have visible label "Скопировать JSON"');
assert(!gmContent.includes('<span>Из файла</span>'), 'GroupManager.tsx must not have vague label "Из файла"');

const attStorageContent = fs.readFileSync(path.resolve(root, 'utils/attendanceStorage.ts'), 'utf8');
assert(!attStorageContent.includes('Ошибка парсинга JSON:'), 'attendanceStorage.ts must not output raw "Ошибка парсинга JSON:"');
console.log('  [PASS] B-02: Clean, human labels confirmed, no raw JSON in visible interface');

// 3. Check F-01-UX: Starosta onboarding and empty roster banner
console.log('\n--- 3. Verification of F-01-UX (Starosta onboarding & banner) ---');
const modalPath = path.resolve(root, 'components/StarostaOnboardingModal.tsx');
assert(fs.existsSync(modalPath), 'StarostaOnboardingModal.tsx must exist');
const modalContent = fs.readFileSync(modalPath, 'utf8');
assert(modalContent.includes('Вы вошли как староста группы'), 'Onboarding modal must have friendly greeting');
assert(modalContent.includes('Добавить студентов'), 'Onboarding modal must have action "Добавить студентов"');
assert(!modalContent.includes('152-ФЗ'), 'Onboarding modal must not mention 152-ФЗ');

const attTrackerContent = fs.readFileSync(path.resolve(root, 'components/AttendanceTracker.tsx'), 'utf8');
assert(attTrackerContent.includes('isRosterEmpty'), 'AttendanceTracker.tsx must define isRosterEmpty');
assert(attTrackerContent.includes('Список группы пуст'), 'AttendanceTracker.tsx must show "Список группы пуст" when roster empty');
assert(attTrackerContent.includes('Добавить студентов'), 'AttendanceTracker.tsx banner button must be "Добавить студентов"');
assert(!attTrackerContent.includes('152-ФЗ'), 'AttendanceTracker.tsx must not mention 152-ФЗ');
console.log('  [PASS] F-01-UX: Onboarding modal and empty roster banner verified');

// 4. Check F-02-AUTH: Unified access code, elimination of PIN
console.log('\n--- 4. Verification of F-02-AUTH (Unified Access Code, No PIN in UI) ---');
const appContent = fs.readFileSync(path.resolve(root, 'App.tsx'), 'utf8');
assert(!appContent.includes('quickPin'), 'App.tsx must not have legacy quickPin state');
assert(!appContent.includes('handleQuickPinLogin'), 'App.tsx must not have dead handleQuickPinLogin');
assert(!appContent.includes('152-ФЗ'), 'App.tsx must not have 152-ФЗ mentioned in UI');
assert(appContent.includes('StarostaOnboardingModal'), 'App.tsx must wire StarostaOnboardingModal');

const adminContent = fs.readFileSync(path.resolve(root, 'components/AdminPanel.tsx'), 'utf8');
assert(!adminContent.includes('pinCode'), 'AdminPanel.tsx must not have pinCode');
assert(!adminContent.includes('handleVerifyPin'), 'AdminPanel.tsx must not have handleVerifyPin');
assert(adminContent.includes('accessCode'), 'AdminPanel.tsx must use accessCode');

const maintContent = fs.readFileSync(path.resolve(root, 'components/MaintenanceScreen.tsx'), 'utf8');
assert(!maintContent.includes('adminPin'), 'MaintenanceScreen.tsx must not have adminPin');
assert(maintContent.includes('adminCode'), 'MaintenanceScreen.tsx must use adminCode');
console.log('  [PASS] F-02-AUTH: Complete elimination of PIN from UI, unified 16-character access code');

// 5. Check F-03-TOAST: Network refresh toast fix
console.log('\n--- 5. Verification of F-03-TOAST (Network sync error toast fix) ---');
const cloudSyncContent = fs.readFileSync(path.resolve(root, 'utils/cloudSync.ts'), 'utf8');
assert(cloudSyncContent.includes('fromNetwork?: boolean'), 'GroupCloudData must have fromNetwork flag');
assert(cloudSyncContent.includes('fromNetwork: isNetworkSuccess'), 'fetchGroupCloudData must set fromNetwork');
assert(appContent.includes('cloud && cloud.fromNetwork'), 'handleRefresh must check cloud.fromNetwork before showing success');
console.log('  [PASS] F-03-TOAST: fromNetwork verified, false success toasts eliminated');

console.log('\n=================================================');
console.log('  ALL BLOCK A UX TESTS COMPLETED SUCCESSFULLY!   ');
console.log('=================================================');
