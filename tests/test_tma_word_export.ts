import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import worker, { createTelegramInitData } from '../cloudflare-worker.js';

let passed = 0;
let total = 0;

function check(msg: string, condition: boolean) {
  total++;
  if (condition) {
    passed++;
    console.log(`  [PASS] ${msg}`);
  } else {
    console.error(`  [FAIL] ${msg}`);
    process.exitCode = 1;
  }
}

console.log('\n============================================================');
console.log('  TEST SUITE: TELEGRAM MINI APP WORD DOWNLOAD & PRIVACY');
console.log('============================================================\n');

const root = process.cwd();
const exportWordCode = fs.readFileSync(path.resolve(root, 'utils/exportWord.ts'), 'utf8');
const workerCode = fs.readFileSync(path.resolve(root, 'cloudflare-worker.js'), 'utf8');
const attendanceTrackerCode = fs.readFileSync(path.resolve(root, 'components/AttendanceTracker.tsx'), 'utf8');

// ------------------------------------------------------------
// 1. TMA CLIENT DOWNLOAD PIPELINE IN exportWord.ts
// ------------------------------------------------------------
console.log('--- 1. TMA Client Download Architecture (exportWord.ts) ---');
check('Imports WORKER_BASE from cloudSync', exportWordCode.includes("import { WORKER_BASE } from './cloudSync'"));
check('Exports ExportWordResult interface', exportWordCode.includes('export interface ExportWordResult'));
check('Detects Telegram WebApp environment', exportWordCode.includes('Telegram?.WebApp') && exportWordCode.includes('initDataUnsafe'));
check('Routes document export via secure /export-doc endpoint', exportWordCode.includes('/export-doc'));
check('Attaches starosta Telegram user id to request', exportWordCode.includes('tg.initDataUnsafe?.user?.id'));
check('Implements Telegram 8.0+ native tg.downloadFile dialog', exportWordCode.includes('tg.downloadFile'));
check('Implements tg.openLink fallback to external browser', exportWordCode.includes('tg.openLink'));
check('Implements Web Share API level 3 fallback', exportWordCode.includes('navigator.canShare'));
check('Implements Desktop HTML5 Blob fallback', exportWordCode.includes('createObjectURL'));
check('Never leaks to public channel @raspisanie_samgtu', !exportWordCode.includes('raspisanie_samgtu'));

// ------------------------------------------------------------
// 2. EDGE WORKER ENDPOINT & PRIVACY (cloudflare-worker.js)
// ------------------------------------------------------------
console.log('\n--- 2. Edge Gateway Security & Storage (/export-doc) ---');
check('Worker has /export-doc endpoint', workerCode.includes('/export-doc'));
check('Worker enforces X-App-Key authorization for /export-doc', workerCode.includes('/export-doc') && workerCode.includes('requireAppKey'));
check('Worker attempts direct PM delivery to user via verified initData', workerCode.includes('userFormData.append("chat_id", String(targetUserId))'));
check('Worker does not extract chat_id from formData', !workerCode.includes('formData.get("chat_id")'));
check('Worker falls back to private storage chat (never public)', workerCode.includes('PRIVATE_STORAGE_CHAT'));
check('Worker /file sets Content-Disposition attachment with RFC 5987', workerCode.includes("filename*=UTF-8''"));
check('Worker /file sets OpenXML docx Content-Type', workerCode.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
check('Worker signs directUrl with HMAC exp and sig', workerCode.includes('&exp=') && workerCode.includes('&sig='));

// ------------------------------------------------------------
// 3. UI FEEDBACK IN AttendanceTracker.tsx
// ------------------------------------------------------------
console.log('\n--- 3. AttendanceTracker Feedback & Multi-Group ---');
check('Provides clear toast when sent to bot PM', attendanceTrackerCode.includes('sentToTelegramChat') && attendanceTrackerCode.includes('диалог с ботом'));
check('Handles custom groups without fallback to hardcoded 310', attendanceTrackerCode.includes('AVAILABLE_GROUPS.find(g => g.id === currentGroupId) || {'));

// ------------------------------------------------------------
// 4. WORKER FUNCTIONAL TESTS VIA MOCK FETCH
// ------------------------------------------------------------
console.log('\n--- 4. Worker Endpoint Simulation Tests ---');
const mockEnv = {
  APP_SECRET: 'super-secret-key-xyz',
  TELEGRAM_BOT_TOKEN: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ-token',
  TELEGRAM_DEV_CHAT_ID: '-10099998888',
  TELEGRAM_CHANNEL_ID: '-1002345678901',
  TEST_MODE: 'true'
};

// 4.1 Unauthorized call without X-App-Key
const unauthReq = new Request('https://worker.test/export-doc', {
  method: 'POST',
  body: new FormData()
});
const unauthRes = await worker.fetch(unauthReq, mockEnv);
check('POST /export-doc without X-App-Key returns 401 Unauthorized', unauthRes.status === 401);

// 4.2 Fail-closed test when APP_SECRET is unset in env
const noSecretEnv = { ...mockEnv, APP_SECRET: undefined };
const noSecretReq = new Request('https://worker.test/export-doc', {
  method: 'POST',
  headers: { 'X-App-Key': 'any-key' },
  body: new FormData()
});
const noSecretRes = await worker.fetch(noSecretReq, noSecretEnv);
check('POST /export-doc fails closed (401) when APP_SECRET is unset', noSecretRes.status === 401);

// 4.3 Authorized export with valid initData delivering to user PM
const testInitData = await createTelegramInitData({
  auth_date: Math.floor(Date.now() / 1000),
  user: JSON.stringify({ id: 987654321, first_name: 'Starosta' })
}, mockEnv.TELEGRAM_BOT_TOKEN);

const validFormData = new FormData();
validFormData.append('document', new Blob(['test-docx-content']), 'Ведомость.docx');
validFormData.append('filename', 'Ведомость.docx');

const authExportReq = new Request('https://worker.test/export-doc', {
  method: 'POST',
  headers: {
    'X-App-Key': mockEnv.APP_SECRET,
    'X-Telegram-Init-Data': testInitData
  },
  body: validFormData
});

const authExportRes = await worker.fetch(authExportReq, mockEnv);
check('POST /export-doc with X-App-Key & initData returns 200 OK', authExportRes.status === 200);
const exportData = await authExportRes.json();
check('Export response marks sent_to_pm: true', exportData.ok === true && exportData.sent_to_pm === true);
check('Export response returns HMAC-signed direct_url with exp and sig', Boolean(exportData.direct_url && exportData.direct_url.includes('&exp=') && exportData.direct_url.includes('&sig=')));

// 4.4 Verify signed URL validation in /file
if (exportData.direct_url) {
  const fileUrl = new URL(exportData.direct_url);

  // Valid signed URL access
  const validFileReq = new Request(fileUrl.toString(), { method: 'GET' });
  const validFileRes = await worker.fetch(validFileReq, mockEnv);
  check('GET /file with valid signed URL returns 200 OK', validFileRes.status === 200);

  // Tampered signature access
  const tamperedUrl = new URL(fileUrl.toString());
  tamperedUrl.searchParams.set('sig', 'forged-tampered-signature');
  const tamperedFileReq = new Request(tamperedUrl.toString(), { method: 'GET' });
  const tamperedFileRes = await worker.fetch(tamperedFileReq, mockEnv);
  check('GET /file with forged signature returns 403 Forbidden', tamperedFileRes.status === 403);

  // Expired URL access
  const expiredUrl = new URL(fileUrl.toString());
  expiredUrl.searchParams.set('exp', String(Math.floor(Date.now() / 1000) - 60)); // expired 1 minute ago
  const expiredFileReq = new Request(expiredUrl.toString(), { method: 'GET' });
  const expiredFileRes = await worker.fetch(expiredFileReq, mockEnv);
  check('GET /file with expired exp timestamp returns 403 Forbidden', expiredFileRes.status === 403);
}

console.log(`\n============================================================`);
console.log(`  RESULT: ${passed}/${total} checks passed (${Math.round((passed / total) * 100)}%)`);
console.log('============================================================\n');

if (passed !== total) {
  process.exit(1);
}
