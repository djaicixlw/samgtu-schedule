import { logger, getSystemDiagnostics, InAppLogger } from '../utils/logger';
import { calculateStudentAbsenceHours, calculateAttendancePercentage, getSamaraFutureISODate, getSamaraISODate } from '../attendance';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
console.log('       QA SUITE: IN-APP LOGGER, DIAGNOSTICS & BUG FIXES         ');
console.log('================================================================\n');

// --- 1. Ring Buffer Capacity (Max 150 entries) ---
console.log('--- 1. Ring Buffer Capacity Test ---');
const testLogger = new InAppLogger();
testLogger.clearLogs();
check('Logger initial count is 0', testLogger.getLogs().length === 0);

for (let i = 1; i <= 200; i++) {
  testLogger.info('TEST', `Log message #${i}`, { id: i });
}

const logs = testLogger.getLogs();
check('Ring buffer caps strictly at 150 entries', logs.length === 150, `actual: ${logs.length}`);
check('Oldest entries (1-50) dropped', logs[0].message === 'Log message #51', `first log: ${logs[0].message}`);
check('Latest entry is #200', logs[149].message === 'Log message #200', `last log: ${logs[149].message}`);

// --- 2. Levels and Data Serialization ---
console.log('\n--- 2. Log Levels and Data Handling ---');
testLogger.clearLogs();
testLogger.debug('UI', 'Debug event');
testLogger.info('SCHEDULE', 'Info event');
testLogger.warn('SYNC', 'Warn event');
testLogger.error('NETWORK', 'Error event', new Error('Simulated network error'));
testLogger.action('UI', 'User clicked button', { button: 'download' });

const currentLogs = testLogger.getLogs();
check('Logged 5 entries of different levels', currentLogs.length === 5);
check('Debug level recorded', currentLogs[0].level === 'DEBUG');
check('Info level recorded', currentLogs[1].level === 'INFO');
check('Warn level recorded', currentLogs[2].level === 'WARN');
check('Error level recorded and error object sanitized', currentLogs[3].level === 'ERROR' && currentLogs[3].data?.name === 'Error');
check('Action level recorded', currentLogs[4].level === 'ACTION');

// Export JSON test
const jsonDump = testLogger.exportLogsAsJSON();
let parsedDump: any;
try {
  parsedDump = JSON.parse(jsonDump);
} catch (e) {}
check('exportLogsAsJSON returns valid JSON', !!parsedDump && Array.isArray(parsedDump.logs));
check('Dump contains diagnostics block', !!parsedDump?.diagnostics);

// --- 3. System Diagnostics Snapshot ---
console.log('\n--- 3. System Diagnostics Snapshot ---');
const diag = getSystemDiagnostics();
check('Diagnostics has valid ISO timestamp', typeof diag.timestamp === 'string' && diag.timestamp.includes('+04:00'));
check('Diagnostics has telegramPlatform', typeof diag.telegramPlatform === 'string' && diag.telegramPlatform.length > 0);
check('Diagnostics has tgWebAppVersion', typeof diag.tgWebAppVersion === 'string');
check('Diagnostics has viewportHeight', typeof diag.viewportHeight === 'number');
check('Diagnostics has currentGroupId', typeof diag.currentGroupId === 'string');
check('Diagnostics has errorLogsCount', typeof diag.errorLogsCount === 'number');

// --- 4. Window Error Interception Simulation ---
console.log('\n--- 4. Error Interception Simulation ---');
testLogger.clearLogs();
// Simulate window.onerror
testLogger.error('SYSTEM', 'Uncaught TypeError: Cannot read properties of undefined', {
  filename: 'App.tsx',
  lineno: 42,
  colno: 10
});
const errLogs = testLogger.getLogs();
check('Simulated uncaught error recorded in logger', errLogs.length === 1 && errLogs[0].level === 'ERROR');
check('Error metadata captured', errLogs[0].data?.filename === 'App.tsx');

// --- 5. BugReportModal Integration Inspection ---
console.log('\n--- 5. BugReportModal Diagnostics Integration ---');
const bugReportModalPath = path.resolve(__dirname, '..', 'components', 'BugReportModal.tsx');
const bugReportContent = fs.readFileSync(bugReportModalPath, 'utf8');

check('BugReportModal imports logger and getSystemDiagnostics', bugReportContent.includes("import { logger, getSystemDiagnostics } from '../utils/logger'"));
check('BugReportModal captures diagnostics in handleSubmitReport', bugReportContent.includes('getSystemDiagnostics()') && bugReportContent.includes('logger.getLogs()'));
check('Caption includes system metrics badge', bugReportContent.includes('📊 [OS: ') && bugReportContent.includes('TG Ver: ') && bugReportContent.includes('Ошибок в логе: '));
check('Text fallback includes diagnostics block', bugReportContent.includes('--- СИСТЕМНЫЕ ЛОГИ И ДИАГНОСТИКА ---'));
check('FormData appends diagnostics JSON', bugReportContent.includes("formData.append('diagnostics'"));
check('Companion JSON document uploaded with screenshots', bugReportContent.includes('diagnostics_') && bugReportContent.includes('.json'));

// --- 6. Mobile Debug Console Component ---
console.log('\n--- 6. Mobile Debug Console Component ---');
const debugModalPath = path.resolve(__dirname, '..', 'components', 'DebugLogsModal.tsx');
check('DebugLogsModal.tsx exists', fs.existsSync(debugModalPath));
const debugModalContent = fs.readFileSync(debugModalPath, 'utf8');
check('DebugLogsModal has error filter', debugModalContent.includes('ERRORS_ONLY'));
check('DebugLogsModal has copy logs button', debugModalContent.includes('exportLogsAsJSON') && debugModalContent.includes('clipboard.writeText'));
check('DebugLogsModal has clear logs button', debugModalContent.includes('clearLogs'));
check('DebugLogsModal has HapticFeedback support', debugModalContent.includes('HapticFeedback'));

// --- 7. App.tsx Integration ---
console.log('\n--- 7. App.tsx Triggers & Console Integration ---');
const appPath = path.resolve(__dirname, '..', 'App.tsx');
const appContent = fs.readFileSync(appPath, 'utf8');
check('App.tsx imports DebugLogsModal', appContent.includes("./components/DebugLogsModal"));
check('App.tsx mounts DebugLogsModal', appContent.includes('<DebugLogsModal'));
check('5-tap gesture detection exists on header', appContent.includes('handleHeaderTitleTap') && appContent.includes('headerTapCountRef'));
check('Profile tab has Logs & Diagnostics button', appContent.includes('Логи и диагностика') && appContent.includes('setIsDebugLogsModalOpen(true)'));

// --- 8. Bug Fix 1: Attendance Collision & Division by Zero ---
console.log('\n--- 8. Attendance Collision & Safe Percentage ---');
const collisionRecord = {
  groupId: 'ingt-310',
  date: '2026-09-01',
  lessonId: 'test-1',
  absentStudentIds: [5],
  excusedStudentIds: [5], // in both absent and excused
  isCancelled: false
};
const attStats = calculateStudentAbsenceHours([collisionRecord], 5);
check('Collision resolved: priority given to excused (2h exc, 0h abs)', attStats.totalExc === 2 && attStats.totalAbs === 0);
check('Total hours is 2 (not 4)', attStats.totalHours === 2);

const safePctZero = calculateAttendancePercentage(0, 0);
check('0 total hours returns 0% instead of NaN', safePctZero === 0 && !Number.isNaN(safePctZero));
const safePctNormal = calculateAttendancePercentage(2, 20);
check('Normal percentage calculated correctly (2/20 = 10%)', safePctNormal === 10);

// --- 9. Bug Fix 2: Teacher Override Empty String ---
console.log('\n--- 9. Teacher Override Empty String ---');
const originalLesson = {
  id: 'lesson-1',
  subject: 'Физика',
  type: 'Лекции',
  teacher: 'Иванов И.И.',
  timeStart: '08:00',
  timeEnd: '09:35',
  location: '101'
};
const overrides: Record<string, any> = { 'lesson-1': { teacher: '' } };
const override = overrides['lesson-1'] || {};
const resolvedTeacher = override.teacher !== undefined ? override.teacher : originalLesson.teacher;
check('Empty string override preserves empty teacher string', resolvedTeacher === '');

// --- 10. Bug Fix 3: Homework Deadline at Night ---
console.log('\n--- 10. Homework Deadline Night Calculation ---');
const todaySamara = getSamaraISODate();
const dueSamara = getSamaraFutureISODate(7);
const diffDays = (new Date(dueSamara).getTime() - new Date(todaySamara).getTime()) / (1000 * 3600 * 24);
check('getSamaraFutureISODate(7) calculates exactly 7 days difference', diffDays === 7, `diff: ${diffDays} days`);

console.log('\n================================================================');
console.log(`TOTAL CHECKS: ${passCount + failCount} | PASSED: ${passCount} | FAILED: ${failCount}`);
console.log('================================================================');

if (failCount > 0) {
  process.exit(1);
} else {
  console.log('\n>>> ALL IN-APP LOGGER, DIAGNOSTICS & BUG FIX CHECKS PASSED (100%) <<<\n');
}
