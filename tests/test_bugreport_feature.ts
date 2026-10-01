import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectDir = path.resolve(__dirname, '..');
let passCount = 0;
let failCount = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passCount++;
    console.log(`  [PASS] ${label}${detail ? ` (${detail})` : ''}`);
  } else {
    failCount++;
    console.error(`  [FAIL] ${label}${detail ? ` (${detail})` : ''}`);
  }
}

console.log('================================================================');
console.log('       QA VERIFICATION SUITE: BUG REPORT & SUPPORT FEATURE       ');
console.log('================================================================\n');

// 1. Check BugReportModal file
console.log('--- 1. Component File Check ---');
const modalPath = path.join(projectDir, 'components', 'BugReportModal.tsx');
check('components/BugReportModal.tsx exists', fs.existsSync(modalPath));
const modalContent = fs.readFileSync(modalPath, 'utf8');

// 2. Check fields in BugReportModal
console.log('\n--- 2. Required Fields in BugReportModal ---');
check('Course field exists (state and select)', modalContent.includes('course') && modalContent.includes('Курс'));
check('Group field exists (state and input)', modalContent.includes('groupName') && modalContent.includes('Группа'));
check('Contact field exists (Telegram or phone)', modalContent.includes('contact') && modalContent.includes('Ваш контакт'));
check('Description field exists (textarea)', modalContent.includes('description') && modalContent.includes('Описание проблемы'));
check('Screenshot attachment exists (file picker and preview)', modalContent.includes('screenshotFile') && modalContent.includes('screenshotPreview'));

// 3. Check Telegram sending and tag
console.log('\n--- 3. Telegram Submission & Tag ---');
check('Tag #bugreport included in caption', modalContent.includes('#bugreport'));
check('Group tag included in caption', modalContent.includes('groupTag'));
check('Direct upload via WORKER_BASE /upload', modalContent.includes('WORKER_BASE') && modalContent.includes('/upload'));
check('Fallback document created when no screenshot attached', modalContent.includes('new Blob') && modalContent.includes('report_'));
check('Rate limit 429 handled with friendly wait advice', modalContent.includes('429') && modalContent.includes('Слишком много запросов') && modalContent.includes('подождите'));

// 4. Check Developer Contact Info
console.log('\n--- 4. Developer Contact Info ---');
check('Developer username @A_le_BL present in modal', modalContent.includes('@A_le_BL'));
check('Telegram link https://t.me/A_le_BL present in modal', modalContent.includes('https://t.me/A_le_BL'));

// 5. Check App.tsx integration
console.log('\n--- 5. App.tsx Integration ---');
const appPath = path.join(projectDir, 'App.tsx');
const appContent = fs.readFileSync(appPath, 'utf8');
check('BugReportModal imported in App.tsx', appContent.includes("./components/BugReportModal"));
check('Header bug report button exists', appContent.includes('title="Сообщить об ошибке / Баг-репорт"'));
check('Profile tab bug report card exists', appContent.includes('Поддержка и баг-репорт'));
check('Profile tab direct developer contact @A_le_BL exists', appContent.includes('https://t.me/A_le_BL') && appContent.includes('@A_le_BL'));
check('BugReportModal mounted at bottom of App.tsx', appContent.includes('<BugReportModal'));

console.log('\n================================================================');
console.log(`TOTAL CHECKS: ${passCount + failCount} | PASSED: ${passCount} | FAILED: ${failCount}`);
console.log('================================================================');

if (failCount > 0) {
  process.exit(1);
} else {
  console.log('\n>>> ALL BUG REPORT FEATURE CHECKS PASSED (100%) <<<\n');
}
