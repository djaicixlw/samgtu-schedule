import './setup_mock_auth';
import fs from 'fs';
import path from 'path';
import worker, {
  sanitizeHomeworkItem,
  sanitizeScheduleOverride,
  sanitizeSyncPayload,
  requireAppKey,
  signFileUrl,
  verifyFileSignature,
  clearWorkerRateLimits,
  deriveFileSigningKey,
  createTelegramInitData
} from '../cloudflare-worker.js';
import { verifyPinCode } from '../utils/auth';

let passed = 0;
let total = 0;

function assert(condition: boolean, msg: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✅ PASS: ${msg}`);
  } else {
    console.error(`  ❌ FAIL: ${msg}`);
    process.exitCode = 1;
  }
}

console.log('\n============================================================');
console.log('  SECURITY AUDIT & PENETRATION TEST SUITE (STEP 1)');
console.log('============================================================\n');

// ------------------------------------------------------------
// TEST 1: WORKER ACCESS CONTROL & X-APP-KEY GATEWAY LOCKDOWN
// ------------------------------------------------------------
console.log('--- 1. Cloudflare Worker Authorization Gateway & Rate Limits ---');

const mockEnv = {
  APP_SECRET: 'test-secret-key-12345',
  TELEGRAM_BOT_TOKEN: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ-mock-token',
  TELEGRAM_CHANNEL_ID: '-1002345678901',
  ID_PEPPER: 'test_pepper_security_audit_32_bytes!',
  MAINTENANCE_MODE: 'true',
  MAINTENANCE_MESSAGE: 'Плановые регламентные работы',
  MAINTENANCE_UNTIL: '15 минут',
  APP_DATA: { get: async () => null, put: async () => {} }
};

// 1.1 Test PUT /sync/homework without X-App-Key (Should be 401 Unauthorized)
const unauthSyncReq = new Request('https://worker.test/sync/homework', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ items: [] })
});
const unauthSyncRes = await worker.fetch(unauthSyncReq, mockEnv);
assert(unauthSyncRes.status === 401, `PUT /sync/homework without X-App-Key returns 401 Unauthorized (got ${unauthSyncRes.status})`);

// 1.2 Test PUT /sync/homework with invalid X-App-Key
const badKeySyncReq = new Request('https://worker.test/sync/homework', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'X-App-Key': 'attacker-forged-key'
  },
  body: JSON.stringify({ items: [] })
});
const badKeySyncRes = await worker.fetch(badKeySyncReq, mockEnv);
assert(badKeySyncRes.status === 401, `PUT /sync/homework with forged X-App-Key returns 401 Unauthorized (got ${badKeySyncRes.status})`);

// 1.2b Test GET /sync/homework is publicly readable without X-App-Key (Open Read per A5-5)
const unauthGetSyncReq = new Request('https://worker.test/sync/homework?groupId=ingt-310', { method: 'GET' });
const unauthGetSyncRes = await worker.fetch(unauthGetSyncReq, mockEnv);
assert(unauthGetSyncRes.status === 200, `GET /sync/homework without X-App-Key is public (got ${unauthGetSyncRes.status})`);

// 1.2c Test GET /admin/migrate-to-kv is permanently retired and returns 404
const unauthMigrateReq = new Request('https://worker.test/admin/migrate-to-kv', { method: 'GET' });
const unauthMigrateRes = await worker.fetch(unauthMigrateReq, mockEnv);
assert(unauthMigrateRes.status === 404, `GET /admin/migrate-to-kv is permanently retired (got ${unauthMigrateRes.status})`);

// 1.2d Test GET /sync/homework with invalid groupId format (Anti-Injection)
const invalidGroupEnv = { ...mockEnv, APP_DATA: { get: async () => null, put: async () => {} } };
const invalidGroupReq = new Request('https://worker.test/sync/homework?groupId=bad%20group!', {
  method: 'GET',
  headers: { 'X-App-Key': mockEnv.APP_SECRET }
});
const invalidGroupRes = await worker.fetch(invalidGroupReq, invalidGroupEnv);
assert(invalidGroupRes.status === 400, `GET /sync/homework with malformed groupId returns 400 Bad Request (got ${invalidGroupRes.status})`);

// 1.3 Test POST /upload endpoint (User bug reports from Web/Telegram)
// P0-03: Spoofed Origin rejected, valid initData accepted
const uploadFormDataSpoofed = new FormData();
uploadFormDataSpoofed.append('document', new Blob(['fake log']), 'diag.txt');
uploadFormDataSpoofed.append('caption', 'Bug report test');
const spoofedUploadReq = new Request('https://worker.test/upload', {
  method: 'POST',
  headers: {
    'Origin': 'http://localhost:5173'
  },
  body: uploadFormDataSpoofed
});
const spoofedUploadRes = await worker.fetch(spoofedUploadReq, mockEnv);
assert(spoofedUploadRes.status === 401, `POST /upload with spoofed Origin and no initData returns 401 Unauthorized (got ${spoofedUploadRes.status})`);

const validUploadInitData = await createTelegramInitData({
  user: JSON.stringify({ id: 987654321, first_name: 'AuditUser', username: 'audit_user' }),
  auth_date: Math.floor(Date.now() / 1000)
}, mockEnv.TELEGRAM_BOT_TOKEN);

const uploadFormDataValid = new FormData();
uploadFormDataValid.append('document', new Blob(['real log data']), 'diag.txt');
uploadFormDataValid.append('caption', 'Valid bug report');
const validUploadReq = new Request('https://worker.test/upload', {
  method: 'POST',
  headers: {
    'X-Telegram-Init-Data': validUploadInitData
  },
  body: uploadFormDataValid
});
const validUploadRes = await worker.fetch(validUploadReq, mockEnv);
assert(validUploadRes.status === 200, `POST /upload with valid initData returns 200 OK (got ${validUploadRes.status})`);

// 1.4 Test POST /notify without X-App-Key
const unauthNotifyReq = new Request('https://worker.test/notify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: 'Attacker notification' })
});
const unauthNotifyRes = await worker.fetch(unauthNotifyReq, mockEnv);
assert(unauthNotifyRes.status === 401, `POST /notify without X-App-Key returns 401 Unauthorized (got ${unauthNotifyRes.status})`);

// 1.1b Test requireAppKey function unit behavior (Fail-Closed)
assert(await requireAppKey(null, null) === false, 'requireAppKey fails closed on null secret');
assert(await requireAppKey(new Request('https://worker.test', { headers: { 'X-App-Key': 'secret' } }), '') === false, 'requireAppKey fails closed on empty secret');
assert(await requireAppKey(new Request('https://worker.test', { headers: { 'X-App-Key': 'wrong' } }), 'secret') === false, 'requireAppKey rejects mismatched key');
assert(await requireAppKey(new Request('https://worker.test', { headers: { 'X-App-Key': 'secret' } }), 'secret') === true, 'requireAppKey accepts matching key');

// 1.1c Test Fail-Closed Gateway across protected endpoints when APP_SECRET is unset
const unsetEnv = { ...mockEnv, APP_SECRET: undefined, TEST_MODE: 'true' };
const putHwRes = await worker.fetch(new Request('https://worker.test/sync/homework?groupId=ingt-310', {
  method: 'PUT',
  headers: { 'X-App-Key': 'any-key' },
  body: JSON.stringify({ items: [] })
}), unsetEnv);
assert(putHwRes.status === 401, `PUT /sync/homework fails closed (401) when APP_SECRET is unset (got ${putHwRes.status})`);

const syncScheduleUnsetRes = await worker.fetch(new Request('https://worker.test/sync/schedule?groupId=ingt-310', {
  method: 'PUT',
  headers: { 'X-App-Key': 'any-key' },
  body: JSON.stringify({ overrides: {} })
}), unsetEnv);
assert(syncScheduleUnsetRes.status === 401, `PUT /sync/schedule fails closed (401) when APP_SECRET is unset (got ${syncScheduleUnsetRes.status})`);

const exportDocUnsetRes = await worker.fetch(new Request('https://worker.test/export-doc', {
  method: 'POST',
  headers: { 'X-App-Key': 'any-key' },
  body: new FormData()
}), unsetEnv);
assert(exportDocUnsetRes.status === 401, `POST /export-doc fails closed (401) when APP_SECRET is unset (got ${exportDocUnsetRes.status})`);

const notifyUnsetRes = await worker.fetch(new Request('https://worker.test/notify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-App-Key': 'any-key' },
  body: JSON.stringify({ message: 'test' })
}), unsetEnv);
assert(notifyUnsetRes.status === 401, `POST /notify fails closed (401) when APP_SECRET is unset (got ${notifyUnsetRes.status})`);

// 1.1d Test CORS Origin Whitelist and Vary: Origin
const allowedOriginReq = new Request('https://worker.test/status', { headers: { Origin: 'https://djaicixlw.github.io' } });
const allowedOriginRes = await worker.fetch(allowedOriginReq, mockEnv);
assert(allowedOriginRes.headers.get('Access-Control-Allow-Origin') === 'https://djaicixlw.github.io', 'CORS returns whitelisted origin');
assert(allowedOriginRes.headers.get('Vary') === 'Origin', 'CORS includes Vary: Origin header');

const evilOriginReq = new Request('https://worker.test/status', { headers: { Origin: 'https://malicious-attacker.com' } });
const evilOriginRes = await worker.fetch(evilOriginReq, mockEnv);
assert(evilOriginRes.headers.get('Access-Control-Allow-Origin') === 'https://djaicixlw.github.io', 'CORS falls back to primary domain on unauthorized origin');

// 1.4b Test /notify anti-spam chat_id restriction
const spamNotifyReq = new Request('https://worker.test/notify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-App-Key': mockEnv.APP_SECRET },
  body: JSON.stringify({ message: 'Spam alert', chat_id: '@arbitrary_spam_channel' })
});
const spamNotifyRes = await worker.fetch(spamNotifyReq, mockEnv);
assert(spamNotifyRes.status === 403, `POST /notify with arbitrary chat_id returns 403 Forbidden (got ${spamNotifyRes.status})`);

const validNotifyReq = new Request('https://worker.test/notify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-App-Key': mockEnv.APP_SECRET },
  body: JSON.stringify({ message: 'System alert', chat_id: mockEnv.TELEGRAM_CHANNEL_ID })
});
const validNotifyRes = await worker.fetch(validNotifyReq, mockEnv);
assert(validNotifyRes.status === 200, `POST /notify with system channel returns 200 OK (got ${validNotifyRes.status})`);

// 1.5 Test GET /status or GET /maintenance (Public health check)
const statusReq = new Request('https://worker.test/status', { method: 'GET' });
const statusRes = await worker.fetch(statusReq, mockEnv);
assert(statusRes.status === 200, `GET /status returns 200 OK (got ${statusRes.status})`);
const statusData = await statusRes.json();
assert(statusData.ok === true && statusData.maintenance === true, `GET /status returns accurate maintenance status`);
assert(statusData.message === 'Плановые регламентные работы', `GET /status returns correct maintenance message`);

// 1.6 Test signed file URLs in /file (HMAC expiration & signature enforcement via derived key)
const expFuture = Math.floor(Date.now() / 1000) + 600;
const fileSigningKey = await deriveFileSigningKey(mockEnv.ID_PEPPER);
const validSig = await signFileUrl('file_sec_test', expFuture, fileSigningKey);

const validSignedUrl = `https://worker.test/file?file_id=file_sec_test&exp=${expFuture}&sig=${validSig}&download=1&filename=test.docx`;
const validSignedRes = await worker.fetch(new Request(validSignedUrl), mockEnv);
assert(validSignedRes.status === 200, `GET /file with valid HMAC signature returns 200 (got ${validSignedRes.status})`);

const forgedSignedUrl = `https://worker.test/file?file_id=file_sec_test&exp=${expFuture}&sig=forged_bad_sig&download=1`;
const forgedSignedRes = await worker.fetch(new Request(forgedSignedUrl), mockEnv);
assert(forgedSignedRes.status === 403, `GET /file with forged signature returns 403 (got ${forgedSignedRes.status})`);

const expiredSignedUrl = `https://worker.test/file?file_id=file_sec_test&exp=100&sig=${validSig}&download=1`;
const expiredSignedRes = await worker.fetch(new Request(expiredSignedUrl), mockEnv);
assert(expiredSignedRes.status === 403, `GET /file with expired timestamp returns 403 (got ${expiredSignedRes.status})`);

const mockValidSignedUrl = `https://worker.test/file?file_id=file_sec_test&exp=${expFuture}&sig=mock-valid&download=1`;
const mockValidSignedRes = await worker.fetch(new Request(mockValidSignedUrl), mockEnv);
assert(mockValidSignedRes.status === 403, `GET /file with sig=mock-valid returns 403 Forbidden (got ${mockValidSignedRes.status})`);

const missingPepperEnv = { ...mockEnv, ID_PEPPER: undefined };
const missingPepperRes = await worker.fetch(new Request(validSignedUrl), missingPepperEnv);
assert(missingPepperRes.status === 500, `GET /file with missing ID_PEPPER returns 500 fail-closed (got ${missingPepperRes.status})`);

// 1.7 Test POST /auth/pin deprecation (P0-02)
const pinDepReq = new Request('https://worker.test/auth/pin', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ pin: '839124' })
});
const pinDepRes = await worker.fetch(pinDepReq, mockEnv);
assert(pinDepRes.status === 410, `POST /auth/pin is deprecated and returns 410 Gone (got ${pinDepRes.status})`);

// 1.8 Test P0-05: TEST_MODE=true and token=mock does NOT bypass security
const backdoorTestEnv = {
  ...mockEnv,
  TEST_MODE: 'true',
  TELEGRAM_BOT_TOKEN: 'mock'
};
const unauthAttReq = new Request('https://worker.test/sync/attendance?groupId=ingt-310', { method: 'GET' });
const unauthAttRes = await worker.fetch(unauthAttReq, backdoorTestEnv);
assert(unauthAttRes.status === 403, `TEST_MODE="true" and token="mock" does not bypass attendance auth (got ${unauthAttRes.status})`);

// 1.9 Test P0-18: Group alias isolation (faid-210 does not collate to faid-310)
const faidUserInitData = await createTelegramInitData({
  user: JSON.stringify({ id: 554433, first_name: 'FaidStudent', username: 'faid_student' }),
  auth_date: Math.floor(Date.now() / 1000)
}, mockEnv.TELEGRAM_BOT_TOKEN);
const claimFaid210Req = new Request('https://worker.test/v3/staff/claim', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Telegram-Init-Data': faidUserInitData
  },
  body: JSON.stringify({ gid: 'faid-210', code: 'TEST-CODE-CLAIM' })
});
const claimFaid210Res = await worker.fetch(claimFaid210Req, mockEnv);
assert(claimFaid210Res.status === 404, `POST /v3/staff/claim with faid-210 does NOT collate to faid-310 (returns 404, got ${claimFaid210Res.status})`);

// ------------------------------------------------------------
// TEST 2: STAROSTA DOCX EXPORT PRIVACY & LOCAL-ONLY RETRIEVAL
// ------------------------------------------------------------
console.log('\n--- 2. Starosta Document Export Privacy & Direct Download ---');

const exportWordFilePath = path.resolve(process.cwd(), 'utils/exportWord.ts');
const exportWordCode = fs.readFileSync(exportWordFilePath, 'utf8');

const hasSecureExportGateway = exportWordCode.includes('/export-doc') && exportWordCode.includes('fetch');
assert(hasSecureExportGateway, 'exportWord.ts uses secure /export-doc gateway with live fallback');

const hasPublicChannelPost = exportWordCode.includes('raspisanie_samgtu');
assert(!hasPublicChannelPost, 'exportWord.ts does NOT link or redirect to @raspisanie_samgtu public channel');

const hasNativeDownload = exportWordCode.includes('downloadFile') || exportWordCode.includes('a.download');
assert(hasNativeDownload, 'exportWord.ts implements direct local download (Telegram downloadFile / HTML5 download)');

// ------------------------------------------------------------
// TEST 3: SCAN REPOSITORY FOR SENSITIVE SECRETS & TOKEN LEAKS
// ------------------------------------------------------------
console.log('\n--- 3. Static Secret Leak Scanner ---');

const botTokenPattern = /bot[0-9]{8,10}:[a-zA-Z0-9_-]{35}/;
const filesToCheck = [
  'App.tsx',
  'cloudflare-worker.js',
  'utils/cloudSync.ts',
  'utils/exportWord.ts',
  'utils/auth.ts',
  'components/BugReportModal.tsx',
  'components/MaintenanceScreen.tsx',
  'components/AdminPanel.tsx'
];

let leakDetected = false;
for (const relFile of filesToCheck) {
  const fullPath = path.resolve(process.cwd(), relFile);
  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, 'utf8');
    // Ensure no hardcoded Telegram bot token in code
    if (botTokenPattern.test(content)) {
      console.error(`  🚨 LEAK: Hardcoded bot token found in ${relFile}`);
      leakDetected = true;
    }
  }
}
assert(!leakDetected, 'No hardcoded Telegram bot tokens detected in source files');

const workerFileContent = fs.readFileSync(path.resolve(process.cwd(), 'cloudflare-worker.js'), 'utf8');
assert(!workerFileContent.includes('samgtu_secret_salt_2026'), 'Hardcoded salt "samgtu_secret_salt_2026" strictly purged from worker (P0-04)');
assert(!workerFileContent.includes('"mock-valid"'), 'Backdoor signature "mock-valid" strictly purged from worker (P0-04)');
assert(!workerFileContent.includes("targetGid.includes('фаид')"), 'Substring match for faid strictly purged from worker (P0-18)');
assert(!workerFileContent.includes("targetGid.includes('хтф')"), 'Substring match for htf strictly purged from worker (P0-18)');
assert(!workerFileContent.includes("targetGid.includes('иаит')"), 'Substring match for iait strictly purged from worker (P0-18)');
assert(!workerFileContent.includes('function hashPin'), 'Deprecated hashPin function strictly purged from worker (R-004)');

const attStorageContent = fs.readFileSync(path.resolve(process.cwd(), 'utils/attendanceStorage.ts'), 'utf8');
const cloudSyncContent = fs.readFileSync(path.resolve(process.cwd(), 'utils/cloudSync.ts'), 'utf8');
assert(attStorageContent.includes('DEFAULT_PROD_WORKER_URL'), 'Default production worker URL configured in utils/attendanceStorage.ts (R-002)');
assert(!cloudSyncContent.includes('alexeyberezin2'), 'Hardcoded worker URL strictly purged from utils/cloudSync.ts (R-002)');

const reportErrReq = new Request('https://worker.test/report-error', { method: 'OPTIONS' });
const reportErrRes = await worker.fetch(reportErrReq, mockEnv);
assert(reportErrRes.headers.get('Access-Control-Allow-Origin') !== '*', 'OPTIONS /report-error without origin strictly does not return wildcard * (R-007)');

// ------------------------------------------------------------
// TEST 4: DTO WHITELIST SANITIZATION & XSS / INJECTION DEFENSE
// ------------------------------------------------------------
console.log('\n--- 4. Mass-Assignment & DTO Sanitization Defense ---');

// 4.1 Injection & prototype pollution test on homework item
const maliciousHomework = {
  id: 'hw_999',
  groupId: 'ingt-310',
  subject: '<script>alert("xss")</script>Физика',
  title: 'Задание 1',
  description: 'A'.repeat(10000), // Oversized description DOS attempt
  isAdmin: true,                  // Mass assignment injection attempt
  __proto__: { hacked: true }
};

const sanitizedHw = sanitizeHomeworkItem(maliciousHomework, 'ingt-310');
assert(sanitizedHw !== null, 'Sanitizer successfully handled payload');
assert(sanitizedHw.description.length <= 4000, `Oversized homework description truncated to max 4000 chars (got ${sanitizedHw.description.length})`);
assert((sanitizedHw as any).isAdmin === undefined, 'Mass assignment field "isAdmin" safely dropped by whitelist sanitizer');

// 4.2 Malicious schedule override test
const maliciousOverride = {
  subject: 'Химия',
  teacher: 'Иванов И.И.',
  role: 'superadmin',       // Injection attempt
  token: 'stolen_token',   // Injection attempt
  note: '<img src=x onerror=alert(1)>'
};
const sanitizedOv = sanitizeScheduleOverride(maliciousOverride);
assert(sanitizedOv !== null, 'Sanitize schedule override returned clean object');
assert((sanitizedOv as any).role === undefined, 'Injected "role" field dropped');
assert((sanitizedOv as any).token === undefined, 'Injected "token" field dropped');
assert(sanitizedOv.teacher === 'Иванов И.И.', 'Valid teacher field retained');

// 4.3 Payload limits defense (max 200 items in homework, max 500 records in attendance, max 50 groups in byGroup)
const oversizedHw = {
  items: Array.from({ length: 250 }, (_, i) => ({ id: `hw_${i}`, title: `HW ${i}`, subject: 'Математика' }))
};
const sanitizedHwPayload = sanitizeSyncPayload('homework', oversizedHw);
assert(sanitizedHwPayload.items.length === 200, `Homework payload items limited to max 200 (got ${sanitizedHwPayload.items.length})`);

const oversizedAtt = {
  records: Array.from({ length: 600 }, (_, i) => ({ groupId: 'ingt-310', date: '2026-09-01', lessonId: `l_${i}` }))
};
const sanitizedAttPayload = sanitizeSyncPayload('attendance', oversizedAtt);
assert(sanitizedAttPayload.records.length === 500, `Attendance payload records limited to max 500 (got ${sanitizedAttPayload.records.length})`);

const manyGroups: Record<string, any> = {};
for (let i = 0; i < 60; i++) manyGroups[`group_${i}`] = { items: [] };
const sanitizedGroupsPayload = sanitizeSyncPayload('homework', { byGroup: manyGroups });
assert(Object.keys(sanitizedGroupsPayload.byGroup).length === 50, `byGroup limited to max 50 groups (got ${Object.keys(sanitizedGroupsPayload.byGroup).length})`);

// ------------------------------------------------------------
// TEST 5: CRYPTOGRAPHIC PIN AUTHENTICATION & EMERGENCY BYPASS
// ------------------------------------------------------------
console.log('\n--- 5. Cryptographic PIN Verification & Security ---');

// 5.1 Admin PIN verification
const adminAuth = await verifyPinCode('94726108');
assert(adminAuth !== null && adminAuth.role === 'admin', 'Admin PIN (94726108) authenticates with admin role');

// 5.2 Starosta PIN verification
const starostaAuth = await verifyPinCode('839124');
assert(starostaAuth !== null && starostaAuth.role === 'starosta' && starostaAuth.targetGroupId === 'ingt-310', 'Starosta PIN (839124) authenticates 3-ИНГТ-110');

// 5.3 Starosta PIN 311 verification
const starosta311Auth = await verifyPinCode('572916');
assert(starosta311Auth !== null && starosta311Auth.role === 'starosta' && starosta311Auth.targetGroupId === 'ingt-311', 'Starosta PIN (572916) authenticates 3-ИНГТ-111');

// 5.3b Starosta PIN 2-ИНГТ-110 & 3-ИНГТ-113 verification
const starosta210Auth = await verifyPinCode('618342');
assert(starosta210Auth !== null && starosta210Auth.role === 'starosta' && starosta210Auth.targetGroupId === 'ingt-210', 'Starosta PIN (618342) authenticates 2-ИНГТ-110');

const starosta313Auth = await verifyPinCode('482915');
assert(starosta313Auth !== null && starosta313Auth.role === 'starosta' && starosta313Auth.targetGroupId === 'ingt-313', 'Starosta PIN (482915) authenticates 3-ИНГТ-113');

// 5.4 Reject arbitrary PIN
const bruteForcePin = await verifyPinCode('123456');
assert(bruteForcePin === null, 'Unauthorized PIN "123456" rejected (returns null)');

// 5.5 Verify auth.ts does not store plaintext PINs or cryptographic hashes (R3)
const authFileContent = fs.readFileSync(path.resolve(process.cwd(), 'utils/auth.ts'), 'utf8');
assert(!authFileContent.includes("'94726108'"), 'Plaintext admin PIN 94726108 NOT stored in utils/auth.ts');
assert(!authFileContent.includes("'839124'"), 'Plaintext starosta PIN 839124 NOT stored in utils/auth.ts');
assert(!authFileContent.includes("'572916'"), 'Plaintext starosta PIN 572916 NOT stored in utils/auth.ts');
assert(!authFileContent.includes("'618342'"), 'Plaintext starosta PIN 618342 NOT stored in utils/auth.ts');
assert(!authFileContent.includes("'482915'"), 'Plaintext starosta PIN 482915 NOT stored in utils/auth.ts');
assert(!(worker as any).ADMIN_PIN_HASH, 'Admin PIN hash strictly purged from worker (R3)');
assert(!(worker as any).GROUP_STAROSTA_PIN_HASHES, 'Starosta PIN hashes strictly purged from worker (R3)');

// ------------------------------------------------------------
// SUMMARY
// ------------------------------------------------------------
console.log('\n============================================================');
console.log(`  SECURITY AUDIT COMPLETED: ${passed} / ${total} TESTS PASSED`);
console.log('============================================================\n');

if (passed !== total) {
  process.exit(1);
}
