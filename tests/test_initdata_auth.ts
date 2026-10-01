/**
 * Comprehensive Test Suite for Telegram WebApp initData HMAC-SHA256 Validation,
 * Server-Side PIN Authentication (/auth/pin), and Attendance Group Isolation.
 * Task: A5-B2
 */

import worker, {
  verifyTelegramInitData,
  createTelegramInitData,
  hashPin,
  checkUserGroupAccess,
  safeEqual,
  pbkdf2
} from '../cloudflare-worker.js';
import {
  TEST_ADMIN_PIN,
  TEST_STAROSTA_310_PIN,
  TEST_STAROSTA_311_PIN
} from './setup_mock_auth';

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

const BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ-mock-token';
const kvStore = new Map<string, string>();

const mockAppData = {
  get: async (k: string) => kvStore.get(k) || null,
  put: async (k: string, v: string, _opts?: any) => { kvStore.set(k, v); },
  delete: async (k: string) => { kvStore.delete(k); }
};

const mockEnv = {
  TELEGRAM_BOT_TOKEN: BOT_TOKEN,
  APP_DATA: mockAppData
};

// Seed test KV data for PBKDF2 verification
const salt310 = 'MDEyMzQ1Njc4OWFiY2RlZg==';
const salt311 = 'ZmVkY2JhOTg3NjU0MzIxMA==';
const saltAdmin = 'MTIzNDU2Nzg5MGFiY2RlZg==';

await Promise.all([
  mockAppData.put('g:ingt-310', JSON.stringify({ codeSalt: salt310, codeHash: await pbkdf2(TEST_STAROSTA_310_PIN, salt310), codeVer: 1, staff: [], slots: [] })),
  mockAppData.put('g:ingt-311', JSON.stringify({ codeSalt: salt311, codeHash: await pbkdf2(TEST_STAROSTA_311_PIN, salt311), codeVer: 1, staff: [], slots: [] })),
  mockAppData.put('g:admin', JSON.stringify({ codeSalt: saltAdmin, codeHash: await pbkdf2(TEST_ADMIN_PIN, saltAdmin), codeVer: 1 }))
]);

console.log('\n============================================================');
console.log('  TEST SUITE: TELEGRAM INITDATA HMAC VALIDATION & PIN AUTH');
console.log('============================================================\n');

// ------------------------------------------------------------
// 1. CRYPTOGRAPHIC HMAC-SHA256 INITDATA VALIDATION
// ------------------------------------------------------------
console.log('--- 1. Cryptographic HMAC-SHA256 initData Validation ---');

const nowSec = Math.floor(Date.now() / 1000);
const starostaUser = { id: 777001, first_name: 'Alex', username: 'starosta_alex' };
const regularUser = { id: 888002, first_name: 'Ivan', username: 'student_ivan' };
const adminUser = { id: 999003, first_name: 'Dmitry', username: 'admin_dmitry' };

// 1.1 Generate valid initData with correct HMAC signature
const validInitData = await createTelegramInitData({
  user: JSON.stringify(starostaUser),
  auth_date: nowSec,
  query_id: 'AAHdF6IQAAAAAN0XohDhrOrc'
}, BOT_TOKEN);

const validRes = await verifyTelegramInitData(validInitData, BOT_TOKEN);
assert(validRes.ok === true, 'Valid initData successfully passes HMAC-SHA256 verification');
assert(validRes.user?.id === starostaUser.id, 'User ID correctly parsed from validated initData');
assert(validRes.authDate === nowSec, 'auth_date correctly extracted from initData');

// 1.2 Tampered initData: modify a parameter without updating the hash
const tamperedParams = new URLSearchParams(validInitData);
tamperedParams.set('user', JSON.stringify({ id: 666666, first_name: 'Hacker' }));
const tamperedInitData = tamperedParams.toString();

const tamperedRes = await verifyTelegramInitData(tamperedInitData, BOT_TOKEN);
assert(tamperedRes.ok === false, 'Tampered parameter is strictly rejected by HMAC verification');
assert(tamperedRes.error?.includes('Invalid HMAC signature'), 'Correct error returned for tampered HMAC signature');

// 1.3 Tampered hash: change the hash parameter
const badHashParams = new URLSearchParams(validInitData);
badHashParams.set('hash', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
const badHashInitData = badHashParams.toString();

const badHashRes = await verifyTelegramInitData(badHashInitData, BOT_TOKEN);
assert(badHashRes.ok === false, 'Forged hash parameter is rejected');

// 1.4 Expired auth_date (> 24 hours = 86400 seconds)
const expiredSec = nowSec - (86400 + 3600); // 25 hours ago
const expiredInitData = await createTelegramInitData({
  user: JSON.stringify(starostaUser),
  auth_date: expiredSec,
  query_id: 'AAHdF6IQAAAAAN0XohDhrOrc'
}, BOT_TOKEN);

const expiredRes = await verifyTelegramInitData(expiredInitData, BOT_TOKEN, { isTestMode: false });
assert(expiredRes.ok === false, 'Expired initData (> 24h) is strictly rejected');
assert(expiredRes.error?.includes('expired'), 'Error message indicates expired initData');

// 1.5 Expired auth_date ignored in test mode
const expiredIgnoredInTest = await verifyTelegramInitData(expiredInitData, BOT_TOKEN, { isTestMode: true });
assert(expiredIgnoredInTest.ok === true, 'Expired auth_date is tolerated when isTestMode is explicitly enabled');

// 1.6 Missing hash or empty initData
const missingHashRes = await verifyTelegramInitData('user=%7B%22id%22%3A1%7D&auth_date=100', BOT_TOKEN);
assert(missingHashRes.ok === false, 'Missing hash parameter returns error');

const emptyRes = await verifyTelegramInitData('', BOT_TOKEN);
assert(emptyRes.ok === false, 'Empty initData string returns error');

// ------------------------------------------------------------
// 2. SERVER-SIDE PIN AUTHENTICATION (POST /auth/pin)
// ------------------------------------------------------------
console.log('\n--- 2. Server-side PIN Authentication (POST /auth/pin) ---');

// 2.1 Starosta code for 3-ИНГТ-110
const starostaAuthReq = new Request('https://worker.test/auth/pin', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    pin: TEST_STAROSTA_310_PIN,
    initData: validInitData,
    targetGroupId: 'ingt-310'
  })
});
const starostaAuthRes = await worker.fetch(starostaAuthReq, mockEnv);
assert(starostaAuthRes.status === 200, `POST /auth/pin returns 200 OK for valid starosta code (got ${starostaAuthRes.status})`);
const starostaAuthBody = await starostaAuthRes.json();
assert(starostaAuthBody.ok === true, 'Response has ok: true');
assert(starostaAuthBody.role === 'starosta', 'Response has role: starosta');
assert(starostaAuthBody.groupId === 'ingt-310', 'Response has groupId: ingt-310');
assert(starostaAuthBody.userId === starostaUser.id, 'Response has correct userId');

// Verify session was stored in Cloudflare KV
const starostaKvSessionRaw = kvStore.get(`auth:${starostaUser.id}:ingt-310`);
assert(starostaKvSessionRaw !== null && starostaKvSessionRaw !== undefined, 'Session is stored in KV at auth:${userId}:${groupId}');
const starostaKvSession = JSON.parse(starostaKvSessionRaw!);
assert(starostaKvSession.role === 'starosta' && starostaKvSession.groupId === 'ingt-310', 'Stored KV session has valid role and group');

// 2.2 Starosta code for 3-ИНГТ-111
const starosta311InitData = await createTelegramInitData({
  user: JSON.stringify({ id: 777002, first_name: 'Pavel' }),
  auth_date: nowSec
}, BOT_TOKEN);

const starosta311Req = new Request('https://worker.test/auth/pin', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    pin: TEST_STAROSTA_311_PIN,
    initData: starosta311InitData,
    targetGroupId: 'ingt-311'
  })
});
const starosta311Res = await worker.fetch(starosta311Req, mockEnv);
assert(starosta311Res.status === 200, 'POST /auth/pin resolves starosta role and groupId ingt-311');
const starosta311Body = await starosta311Res.json();
assert(starosta311Body.groupId === 'ingt-311', 'groupId in response matches code mapping');

// 2.3 Admin code
const adminInitData = await createTelegramInitData({
  user: JSON.stringify(adminUser),
  auth_date: nowSec
}, BOT_TOKEN);

const adminAuthReq = new Request('https://worker.test/auth/pin', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    pin: TEST_ADMIN_PIN,
    initData: adminInitData
  })
});
const adminAuthRes = await worker.fetch(adminAuthReq, mockEnv);
assert(adminAuthRes.status === 200, 'POST /auth/pin returns 200 OK for valid admin code');
const adminAuthBody = await adminAuthRes.json();
assert(adminAuthBody.role === 'admin', 'Admin role issued');
assert(kvStore.has(`auth:${adminUser.id}:admin`), 'Admin session stored in KV with auth:${userId}:admin');
assert(kvStore.has(`auth:${adminUser.id}:*`), 'Admin wildcard session stored in KV with auth:${userId}:*');

// 2.4 Wrong code
const wrongPinReq = new Request('https://worker.test/auth/pin', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    pin: 'WRONG-MOCK-CODE-000',
    initData: validInitData,
    targetGroupId: 'ingt-310'
  })
});
const wrongPinRes = await worker.fetch(wrongPinReq, mockEnv);
assert(wrongPinRes.status === 401, `Invalid code returns 401 Unauthorized (got ${wrongPinRes.status})`);

// 2.5 Tampered initData to /auth/pin
const tamperedPinReq = new Request('https://worker.test/auth/pin', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    pin: TEST_STAROSTA_310_PIN,
    initData: tamperedInitData,
    targetGroupId: 'ingt-310'
  })
});
const tamperedPinRes = await worker.fetch(tamperedPinReq, mockEnv);
assert(tamperedPinRes.status === 401, 'Tampered initData to /auth/pin returns 401 Unauthorized');

// 2.6 Expired initData to /auth/pin
const expiredPinReq = new Request('https://worker.test/auth/pin', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    pin: TEST_STAROSTA_310_PIN,
    initData: expiredInitData,
    targetGroupId: 'ingt-310'
  })
});
const expiredPinRes = await worker.fetch(expiredPinReq, mockEnv);
assert(expiredPinRes.status === 401, 'Expired initData (> 24h) to /auth/pin returns 401 Unauthorized');

// 2.7 Starosta claiming another group's targetGroupId
const hijackReq = new Request('https://worker.test/auth/pin', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    pin: TEST_STAROSTA_310_PIN, // Code for ingt-310
    initData: validInitData,
    targetGroupId: 'ingt-311' // Target ingt-311
  })
});
const hijackRes = await worker.fetch(hijackReq, mockEnv);
assert(hijackRes.status === 401, `Starosta entering code for wrong group returns 401 Unauthorized (got ${hijackRes.status})`);

// 2.8 Rate-limiting on /auth/pin (429 after 5 failed attempts)
const rlScope = 'rl-worker-test';
const testSalt = 'MDEyMzQ1Njc4OWFiY2RlZg==';
const testHash = await pbkdf2('CORRECT-CODE', testSalt);
await mockAppData.put(`g:${rlScope}`, JSON.stringify({
  codeSalt: testSalt,
  codeHash: testHash,
  codeVer: 1
}));
for (let i = 0; i < 5; i++) {
  const badReq = new Request('https://worker.test/auth/pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pin: 'WRONG-CODE-' + i,
      initData: validInitData,
      targetGroupId: rlScope
    })
  });
  const res = await worker.fetch(badReq, mockEnv);
  assert(res.status === 401, `Failed attempt ${i + 1} returns 401 (got ${res.status})`);
}
const rateLimitedReq = new Request('https://worker.test/auth/pin', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    pin: 'WRONG-CODE-6',
    initData: validInitData,
    targetGroupId: rlScope
  })
});
const rateLimitedRes = await worker.fetch(rateLimitedReq, mockEnv);
assert(rateLimitedRes.status === 429, `6th attempt returns 429 Too Many Requests (got ${rateLimitedRes.status})`);

// 2.9 Cryptographic primitives safeEqual and pbkdf2
assert(await safeEqual('secret_hash_a', 'secret_hash_a') === true, 'safeEqual returns true for identical strings');
assert(await safeEqual('secret_hash_a', 'secret_hash_b') === false, 'safeEqual returns false for different strings');
const derivedHash = await pbkdf2('test_password', testSalt);
assert(typeof derivedHash === 'string' && derivedHash.length === 44, 'pbkdf2 returns 256-bit base64 string (44 chars)');

// 2.10 Absence of hardcoded ADMIN_PIN_HASH in worker
assert((worker as any).ADMIN_PIN_HASH === undefined, 'ADMIN_PIN_HASH is NOT exported by worker');
assert((worker as any).GROUP_STAROSTA_PIN_HASHES === undefined, 'GROUP_STAROSTA_PIN_HASHES is NOT exported by worker');

// ------------------------------------------------------------
// 3. ATTENDANCE GROUP ISOLATION & ACCESS CONTROL
// ------------------------------------------------------------
console.log('\n--- 3. Attendance Access Control & Group Isolation ---');

// 3.1 Unauthenticated GET /sync/attendance without X-Telegram-Init-Data (Should be 403 Forbidden)
const unauthAttendanceReq = new Request('https://worker.test/sync/attendance?groupId=ingt-310', {
  method: 'GET'
});
const unauthAttendanceRes = await worker.fetch(unauthAttendanceReq, mockEnv);
assert(unauthAttendanceRes.status === 403, `Unauthenticated GET /sync/attendance returns 403 Forbidden (got ${unauthAttendanceRes.status})`);
const unauthAttendanceBody = await unauthAttendanceRes.json();
assert(unauthAttendanceBody.error === 'Access denied to group attendance', 'Error matches "Access denied to group attendance"');

// 3.2 Unauthenticated PUT /sync/attendance without X-Telegram-Init-Data (Should be 403 Forbidden)
const unauthPutReq = new Request('https://worker.test/sync/attendance?groupId=ingt-310', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ records: [] })
});
const unauthPutRes = await worker.fetch(unauthPutReq, mockEnv);
assert(unauthPutRes.status === 403, `Unauthenticated PUT /sync/attendance returns 403 Forbidden (got ${unauthPutRes.status})`);

// 3.3 Request with tampered initData header
const tamperedHeaderReq = new Request('https://worker.test/sync/attendance?groupId=ingt-310', {
  method: 'GET',
  headers: { 'X-Telegram-Init-Data': tamperedInitData }
});
const tamperedHeaderRes = await worker.fetch(tamperedHeaderReq, mockEnv);
assert(tamperedHeaderRes.status === 401, `Tampered initData header returns 401 Unauthorized (got ${tamperedHeaderRes.status})`);

// 3.4 Request with expired initData header (> 24h)
const expiredHeaderReq = new Request('https://worker.test/sync/attendance?groupId=ingt-310', {
  method: 'GET',
  headers: { 'X-Telegram-Init-Data': expiredInitData }
});
const expiredHeaderRes = await worker.fetch(expiredHeaderReq, mockEnv);
assert(expiredHeaderRes.status === 401, `Expired initData header returns 401 Unauthorized (got ${expiredHeaderRes.status})`);

// 3.5 Regular student (valid initData, but no starosta/admin role in KV) -> 403 Forbidden
const regularInitData = await createTelegramInitData({
  user: JSON.stringify(regularUser),
  auth_date: nowSec
}, BOT_TOKEN);

const studentReq = new Request('https://worker.test/sync/attendance?groupId=ingt-310', {
  method: 'GET',
  headers: { 'X-Telegram-Init-Data': regularInitData }
});
const studentRes = await worker.fetch(studentReq, mockEnv);
assert(studentRes.status === 403, `Regular student without starosta role gets 403 Forbidden (got ${studentRes.status})`);

// 3.6 Starosta of group 3-ИНГТ-110 attempting to access 3-ИНГТ-111 -> 403 Forbidden
const crossGroupReq = new Request('https://worker.test/sync/attendance?groupId=ingt-311', {
  method: 'GET',
  headers: { 'X-Telegram-Init-Data': validInitData } // validInitData belongs to ingt-310 starosta
});
const crossGroupRes = await worker.fetch(crossGroupReq, mockEnv);
assert(crossGroupRes.status === 403, `Cross-group attendance access blocked with 403 Forbidden (got ${crossGroupRes.status})`);

// 3.7 Authorized starosta of group 3-ИНГТ-110 accessing own group -> 200 OK
const starostaGetReq = new Request('https://worker.test/sync/attendance?groupId=ingt-310', {
  method: 'GET',
  headers: { 'X-Telegram-Init-Data': validInitData }
});
const starostaGetRes = await worker.fetch(starostaGetReq, mockEnv);
assert(starostaGetRes.status === 200, `Authorized starosta GET returns 200 OK (got ${starostaGetRes.status})`);

// 3.8 Authorized starosta saving attendance records via PUT -> 200 OK
const starostaPutReq = new Request('https://worker.test/sync/attendance?groupId=ingt-310', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'X-Telegram-Init-Data': validInitData
  },
  body: JSON.stringify({
    records: [
      {
        docId: 'ingt-310_2026-09-27_l1',
        groupId: 'ingt-310',
        date: '2026-09-27',
        lessonId: 'l1',
        absentStudentIds: [1, 2],
        excusedStudentIds: [3],
        updatedAt: Date.now(),
        updatedBy: 'starosta'
      }
    ]
  })
});
const starostaPutRes = await worker.fetch(starostaPutReq, mockEnv);
assert(starostaPutRes.status === 200, `Authorized starosta PUT returns 200 OK (got ${starostaPutRes.status})`);
const savedAttendanceRaw = kvStore.get('attendance:ingt-310');
assert(savedAttendanceRaw !== null, 'Attendance record saved in KV');

// 3.9 Authorization via Authorization: Bearer <initData> header
const bearerReq = new Request('https://worker.test/sync/attendance?groupId=ingt-310', {
  method: 'GET',
  headers: { 'Authorization': `Bearer ${validInitData}` }
});
const bearerRes = await worker.fetch(bearerReq, mockEnv);
assert(bearerRes.status === 200, `Authorization via "Bearer <initData>" returns 200 OK (got ${bearerRes.status})`);

// 3.10 Admin can access any group's attendance
const adminGetReq = new Request('https://worker.test/sync/attendance?groupId=ingt-310', {
  method: 'GET',
  headers: { 'X-Telegram-Init-Data': adminInitData }
});
const adminGetRes = await worker.fetch(adminGetReq, mockEnv);
assert(adminGetRes.status === 200, `Admin accessing ingt-310 returns 200 OK (got ${adminGetRes.status})`);

const adminOtherGroupReq = new Request('https://worker.test/sync/attendance?groupId=faid-310', {
  method: 'GET',
  headers: { 'X-Telegram-Init-Data': adminInitData }
});
const adminOtherGroupRes = await worker.fetch(adminOtherGroupReq, mockEnv);
assert(adminOtherGroupRes.status === 200, `Admin accessing faid-310 returns 200 OK (got ${adminOtherGroupRes.status})`);

// 3.11 Backwards compatibility in local test mode (isTestMode = true)
const localTestEnv = {
  ...mockEnv,
  TEST_MODE: 'true'
};
const legacyLocalReq = new Request('https://worker.test/sync/attendance?groupId=ingt-310', {
  method: 'GET'
});
const legacyLocalRes = await worker.fetch(legacyLocalReq, localTestEnv);
assert(legacyLocalRes.status === 200, `Legacy local test without initData header succeeds in test mode (got ${legacyLocalRes.status})`);

// ------------------------------------------------------------
// SUMMARY
// ------------------------------------------------------------
console.log('\n============================================================');
console.log(`  INITDATA AUTH TEST SUITE: ${passed} / ${total} TESTS PASSED`);
console.log('============================================================\n');

if (passed !== total) {
  process.exit(1);
}
