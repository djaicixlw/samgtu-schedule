/**
 * Comprehensive Test Suite for API v3 ("Blind Server" Architecture)
 * Tests all 8 routes + privacy isolation + optimistic locking.
 * Task: A5-3
 */

import worker, {
  blindId,
  sha256Hex,
  createTelegramInitData,
  pbkdf2,
  encryptChatId,
  decryptChatId,
  checkUserGroupAccess
} from '../cloudflare-worker.js';

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

const TEST_BOT_TOKEN = 'mock_bot_token_api_v3_test_fixture';
const TEST_PEPPER = 'mock_pepper_v3_fixture_32bytes!';
const kvStore = new Map<string, string>();

const mockAppData = {
  get: async (k: string) => kvStore.get(k) || null,
  put: async (k: string, v: string, _opts?: any) => { kvStore.set(k, v); },
  delete: async (k: string) => { kvStore.delete(k); }
};

const mockEnv = {
  TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN,
  ID_PEPPER: TEST_PEPPER,
  APP_DATA: mockAppData,
  DEV_CHAT_ID: '987654321'
};

async function makeInitData(userId: number, firstName: string = 'User') {
  return await createTelegramInitData({
    user: JSON.stringify({ id: userId, first_name: firstName }),
    auth_date: Math.floor(Date.now() / 1000)
  }, TEST_BOT_TOKEN);
}

async function callWorker(
  path: string,
  method: string,
  initData: string | null,
  body?: any
) {
  const headers: Record<string, string> = {};
  if (initData !== null) {
    headers['X-Telegram-Init-Data'] = initData;
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const req = new Request(`https://worker.test${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  return await worker.fetch(req, mockEnv);
}

console.log('\n============================================================');
console.log('       API v3 ("BLIND SERVER") END-TO-END TEST SUITE        ');
console.log('============================================================\n');

// ------------------------------------------------------------
// 1. Helper function: blindId and sha256Hex
// ------------------------------------------------------------
console.log('--- 1. Crypto & Helper Functions ---');
let pepperErrorThrown = false;
try {
  await blindId({}, 12345);
} catch (e: any) {
  pepperErrorThrown = e.message.includes('ID_PEPPER is not configured');
}
assert(pepperErrorThrown, 'blindId throws fail-closed error when ID_PEPPER is missing in env');

const elderUserId = 9001;
const student1UserId = 9101;
const student2UserId = 9102;
const strangerUserId = 9999;

const elderBlindId = await blindId(mockEnv, elderUserId);
const elderBlindId2 = await blindId(mockEnv, elderUserId);
const student1BlindId = await blindId(mockEnv, student1UserId);
const student2BlindId = await blindId(mockEnv, student2UserId);

assert(typeof elderBlindId === 'string' && elderBlindId.length === 64, 'blindId returns 64-character hex string');
assert(/^[0-9a-f]{64}$/.test(elderBlindId), 'blindId is valid lowercase hex');
assert(elderBlindId === elderBlindId2, 'blindId is deterministic for same tgId and pepper');
assert(elderBlindId !== student1BlindId, 'blindId is unique for different tgIds');

const otherPepperEnv = { ID_PEPPER: 'another_custom_pepper_value_32b_!' };
const otherPepperBlindId = await blindId(otherPepperEnv, elderUserId);
assert(typeof otherPepperBlindId === 'string' && otherPepperBlindId.length === 64, 'blindId works with custom pepper');
assert(otherPepperBlindId !== elderBlindId, 'different pepper produces different blindId');

const testHash = await sha256Hex('SAMPLE-CODE');
assert(/^[0-9a-f]{64}$/.test(testHash), 'sha256Hex returns 64-char lowercase hex');

// ------------------------------------------------------------
// 2. Authentication & Missing Headers for /v3/*
// ------------------------------------------------------------
console.log('\n--- 2. Auth & Protocol Checks ---');
const elderInitData = await makeInitData(elderUserId, 'ElderUser');
const student1InitData = await makeInitData(student1UserId, 'StudentOne');
const student2InitData = await makeInitData(student2UserId, 'StudentTwo');
const strangerInitData = await makeInitData(strangerUserId, 'Stranger');

const noHeaderRes = await callWorker('/v3/me', 'GET', null);
assert(noHeaderRes.status === 401, 'Request without X-Telegram-Init-Data returns 401');

const badHeaderRes = await callWorker('/v3/me', 'GET', 'user=%7B%22id%22%3A1%7D&hash=invalidhash');
assert(badHeaderRes.status === 401, 'Request with forged initData returns 401');

const unknownRouteRes = await callWorker('/v3/nonexistent', 'GET', elderInitData);
assert(unknownRouteRes.status === 404, 'Unknown /v3 route returns 404');

// ------------------------------------------------------------
// 3. Setup Test Group in KV
// ------------------------------------------------------------
console.log('\n--- 3. Seed Group in KV ---');
const testGid = 'test-grp-310';
const testCode = 'TEST-CODE-CLAIM-80BIT';
const testSalt = 'bW9ja19zYWx0XzMyYnl0ZXNfZml4dHVyZQ==';
const testCodeHash = await pbkdf2(testCode, testSalt);

await mockAppData.put(`g:${testGid}`, JSON.stringify({
  codeSalt: testSalt,
  codeHash: testCodeHash,
  codeVer: 1,
  staff: [],
  slots: []
}));
assert(kvStore.has(`g:${testGid}`), 'Test group seeded in KV');

// ------------------------------------------------------------
// 4. POST /v3/staff/claim
// ------------------------------------------------------------
console.log('\n--- 4. POST /v3/staff/claim ---');

// 4.1 Group not found
const claimMissingGroup = await callWorker('/v3/staff/claim', 'POST', elderInitData, {
  gid: 'nonexistent-grp',
  code: testCode
});
assert(claimMissingGroup.status === 404, 'Claiming nonexistent group returns 404');

// 4.2 Invalid code
const claimBadCode = await callWorker('/v3/staff/claim', 'POST', elderInitData, {
  gid: testGid,
  code: 'WRONG-CODE'
});
assert(claimBadCode.status === 401, 'Claiming with wrong code returns 401');

// 4.3 Rate limit on claim (simulate 5 failures)
for (let i = 0; i < 4; i++) {
  await callWorker('/v3/staff/claim', 'POST', elderInitData, { gid: testGid, code: 'WRONG-CODE' });
}
const claimThrottled = await callWorker('/v3/staff/claim', 'POST', elderInitData, {
  gid: testGid,
  code: testCode
});
assert(claimThrottled.status === 429, '5 failed claim attempts trigger 429 Too Many Requests');

// Reset rate limit key to test successful claim
await mockAppData.delete(`rl:claim:${testGid}`);

// 4.4 Successful claim
const claimSuccess = await callWorker('/v3/staff/claim', 'POST', elderInitData, {
  gid: testGid,
  code: testCode
});
assert(claimSuccess.status === 200, 'Claim with valid code returns 200 OK');
const claimBody = await claimSuccess.json();
assert(claimBody.ok === true, 'Claim response has ok: true');

// Check KV: elder's blindId added to staff
const groupAfterClaim = JSON.parse((await mockAppData.get(`g:${testGid}`))!);
assert(Array.isArray(groupAfterClaim.staff) && groupAfterClaim.staff.includes(elderBlindId), 'Elder userBlindId is recorded in g:{gid}.staff');
assert(!kvStore.has(`rl:claim:${testGid}`), 'Successful claim clears rate-limiting key');

// ------------------------------------------------------------
// 5. POST /v3/slots
// ------------------------------------------------------------
console.log('\n--- 5. POST /v3/slots ---');

// 5.1 Forbidden for non-staff
const slotsForbidden = await callWorker('/v3/slots', 'POST', strangerInitData, {
  gid: testGid,
  slots: ['SLOT-A1', 'SLOT-B2']
});
assert(slotsForbidden.status === 403, 'Non-staff user is forbidden from registering slots (403)');

// 5.2 Successful registration by elder
const testSlots = ['SLOT-A1', 'SLOT-B2', 'SLOT-C3'];
const slotsSuccess = await callWorker('/v3/slots', 'POST', elderInitData, {
  gid: testGid,
  slots: testSlots
});
assert(slotsSuccess.status === 200, 'Elder successfully registers slots (200 OK)');
const slotsBody = await slotsSuccess.json();
assert(slotsBody.ok === true && slotsBody.registered === 3, 'Response indicates 3 slots registered');

const groupWithSlots = JSON.parse((await mockAppData.get(`g:${testGid}`))!);
assert(groupWithSlots.slots.length === 3, 'KV contains 3 slots');

// 5.3 Deduplication (posting same slots again returns 0 newly registered)
const slotsDedupe = await callWorker('/v3/slots', 'POST', elderInitData, {
  gid: testGid,
  slots: ['SLOT-A1', 'SLOT-B2']
});
assert(slotsDedupe.status === 200, 'Deduplication request returns 200');
const dedupeBody = await slotsDedupe.json();
assert(dedupeBody.registered === 0, 'No duplicate slots registered');

// 5.4 Slot limit: maximum 60 slots per group
const tooManySlots = Array.from({ length: 65 }, (_, i) => `SLOT-EXTRA-${i}`);
const slotsOverLimit = await callWorker('/v3/slots', 'POST', elderInitData, {
  gid: testGid,
  slots: tooManySlots
});
assert(slotsOverLimit.status === 400, 'Registering > 60 slots returns 400 Bad Request');

// ------------------------------------------------------------
// 6. POST /v3/invites
// ------------------------------------------------------------
console.log('\n--- 6. POST /v3/invites ---');

const rawInviteCode1 = 'INV-CODE-ALPHA-1234';
const rawInviteCode2 = 'INV-CODE-BETA-5678';
const hash1 = (await sha256Hex(rawInviteCode1)).toLowerCase();
const hash2 = (await sha256Hex(rawInviteCode2)).toLowerCase();

// 6.1 Forbidden for non-staff
const invitesForbidden = await callWorker('/v3/invites', 'POST', strangerInitData, {
  gid: testGid,
  items: [{ slot: 'SLOT-A1', hash: hash1 }]
});
assert(invitesForbidden.status === 403, 'Non-staff user forbidden from posting invites (403)');

// 6.2 Successful invite registration
const invitesSuccess = await callWorker('/v3/invites', 'POST', elderInitData, {
  gid: testGid,
  items: [
    { slot: 'SLOT-A1', hash: hash1 },
    { slot: 'SLOT-B2', hash: hash2 }
  ]
});
assert(invitesSuccess.status === 200, 'Elder registers invites (200 OK)');
const invitesBody = await invitesSuccess.json();
assert(invitesBody.ok === true && invitesBody.count === 2, 'Response returns count: 2');

// Verify stored in KV
const storedInv1 = JSON.parse((await mockAppData.get(`inv:${hash1}`))!);
assert(storedInv1.gid === testGid && storedInv1.slot === 'SLOT-A1', 'Invite 1 stored in inv:{hash} with correct gid and slot');
const storedInv2 = JSON.parse((await mockAppData.get(`inv:${hash2}`))!);
assert(storedInv2.gid === testGid && storedInv2.slot === 'SLOT-B2', 'Invite 2 stored in inv:{hash} with correct gid and slot');

// ------------------------------------------------------------
// 7. GET /v3/att & PUT /v3/att (Optimistic Lock & Patch)
// ------------------------------------------------------------
console.log('\n--- 7. GET /v3/att & PUT /v3/att ---');

const testMonth = '2026-10';

// 7.1 GET uninitialized month returns ver: 0
const getEmptyAtt = await callWorker(`/v3/att?gid=${testGid}&month=${testMonth}`, 'GET', elderInitData);
assert(getEmptyAtt.status === 200, 'GET /v3/att returns 200 for empty month');
const emptyAttBody = await getEmptyAtt.json();
assert(emptyAttBody.ver === 0 && Object.keys(emptyAttBody.slots).length === 0, 'Empty month returns ver: 0 and empty slots');

// 7.2 Non-staff forbidden from GET /v3/att
const getAttForbidden = await callWorker(`/v3/att?gid=${testGid}&month=${testMonth}`, 'GET', strangerInitData);
assert(getAttForbidden.status === 403, 'Stranger forbidden from GET /v3/att (403)');

// 7.3 PUT /v3/att initial write (baseVer: 0 -> ver: 1)
const putInitial = await callWorker('/v3/att', 'PUT', elderInitData, {
  gid: testGid,
  month: testMonth,
  baseVer: 0,
  patch: {
    'SLOT-A1': { '10-02.1': 'u', '10-02.2': 'e' },
    'SLOT-B2': { '10-02.1': 'e' }
  },
  cancel: ['10-02.3']
});
assert(putInitial.status === 200, 'Initial PUT /v3/att returns 200 OK');
const putInitialBody = await putInitial.json();
assert(putInitialBody.ok === true && putInitialBody.ver === 1, 'Initial PUT increments version to 1');

// Verify GET returns version 1
const getAttV1 = await callWorker(`/v3/att?gid=${testGid}&month=${testMonth}`, 'GET', elderInitData);
const attV1Body = await getAttV1.json();
assert(attV1Body.ver === 1, 'GET returns ver: 1');
assert(attV1Body.slots['SLOT-A1']['10-02.1'] === 'u', 'SLOT-A1 mark 10-02.1 is "u"');
assert(attV1Body.slots['SLOT-A1']['10-02.2'] === 'e', 'SLOT-A1 mark 10-02.2 is "e"');
assert(attV1Body.slots['SLOT-B2']['10-02.1'] === 'e', 'SLOT-B2 mark 10-02.1 is "e"');
assert(attV1Body.cancelled.includes('10-02.3'), 'Cancelled lessons list includes 10-02.3');

// 7.4 Second update (baseVer: 1 -> ver: 2) with patch deletion
const putUpdate = await callWorker('/v3/att', 'PUT', elderInitData, {
  gid: testGid,
  month: testMonth,
  baseVer: 1,
  patch: {
    'SLOT-A1': { '10-02.2': null, '10-05.1': 'e' } // Delete 10-02.2, add 10-05.1
  },
  cancel: { '10-02.3': false, '10-05.2': true } // Uncancel 10-02.3, cancel 10-05.2
});
assert(putUpdate.status === 200, 'Second PUT returns 200 OK');
const putUpdateBody = await putUpdate.json();
assert(putUpdateBody.ver === 2, 'Version incremented to 2');

const getAttV2 = await callWorker(`/v3/att?gid=${testGid}&month=${testMonth}`, 'GET', elderInitData);
const attV2Body = await getAttV2.json();
assert(attV2Body.ver === 2, 'GET returns ver: 2');
assert(attV2Body.slots['SLOT-A1']['10-02.2'] === undefined, 'Mark 10-02.2 deleted via null patch');
assert(attV2Body.slots['SLOT-A1']['10-05.1'] === 'e', 'Mark 10-05.1 added');
assert(!attV2Body.cancelled.includes('10-02.3'), '10-02.3 uncancelled');
assert(attV2Body.cancelled.includes('10-05.2'), '10-05.2 cancelled');

// 7.5 Optimistic Lock Conflict (HTTP 409 Conflict)
const putConflict = await callWorker('/v3/att', 'PUT', elderInitData, {
  gid: testGid,
  month: testMonth,
  baseVer: 1, // Stale baseVer (current is 2)
  patch: { 'SLOT-A1': { '10-06.1': 'u' } }
});
assert(putConflict.status === 409, 'Stale baseVer triggers HTTP 409 Conflict');
const conflictBody = await putConflict.json();
assert(conflictBody.currentVer === 2, 'Conflict body reports currentVer: 2');
assert(conflictBody.slots !== undefined, 'Conflict body includes current slots snapshot for client merge');

// ------------------------------------------------------------
// 8. POST /v3/student/link
// ------------------------------------------------------------
console.log('\n--- 8. POST /v3/student/link ---');

// 8.1 Invalid invite code
const linkInvalid = await callWorker('/v3/student/link', 'POST', student1InitData, {
  code: 'INVALID-INVITE-CODE',
  consentVer: 1
});
assert(linkInvalid.status === 404, 'Invalid invite code returns 404 Not Found');

// 8.2 Rate limit on student link (simulate 5 failures)
for (let i = 0; i < 4; i++) {
  await callWorker('/v3/student/link', 'POST', student1InitData, { code: 'INVALID-INVITE-CODE' });
}
const linkThrottled = await callWorker('/v3/student/link', 'POST', student1InitData, {
  code: rawInviteCode1
});
assert(linkThrottled.status === 429, '5 failed student link attempts trigger 429 Too Many Requests');

// Reset student1 rate limit key
await mockAppData.delete(`rl:link:${student1BlindId}`);

// 8.3 Successful link for Student 1 (SLOT-A1)
const linkStudent1 = await callWorker('/v3/student/link', 'POST', student1InitData, {
  code: rawInviteCode1.toLowerCase(), // Case insensitive test
  consentVer: 1
});
assert(linkStudent1.status === 200, 'Student 1 successfully links via code (200 OK)');
const link1Body = await linkStudent1.json();
assert(link1Body.ok === true && link1Body.gid === testGid && link1Body.slot === 'SLOT-A1', 'Student 1 linked to testGid and SLOT-A1');

// 8.4 Single-use verification: invite code deleted from KV
assert(!kvStore.has(`inv:${hash1}`), 'Invite 1 deleted from KV upon successful link');
const linkReused = await callWorker('/v3/student/link', 'POST', student1InitData, {
  code: rawInviteCode1
});
assert(linkReused.status === 404, 'Reusing consumed invite code returns 404');

// 8.5 Link Student 2 (SLOT-B2)
const linkStudent2 = await callWorker('/v3/student/link', 'POST', student2InitData, {
  code: rawInviteCode2,
  consentVer: 1
});
assert(linkStudent2.status === 200, 'Student 2 links to SLOT-B2');

// ------------------------------------------------------------
// 9. GET /v3/me & Privacy Slot Isolation
// ------------------------------------------------------------
console.log('\n--- 9. GET /v3/me & Privacy Slot Isolation ---');

// 9.1 Unlinked stranger
const meStranger = await callWorker('/v3/me', 'GET', strangerInitData);
assert(meStranger.status === 200, 'GET /v3/me returns 200 for unlinked user');
const meStrangerBody = await meStranger.json();
assert(meStrangerBody.ok === true && meStrangerBody.linked === false, 'Unlinked user receives { ok: true, linked: false }');

// 9.2 Student 1 views their own marks
const meStudent1 = await callWorker(`/v3/me?month=${testMonth}`, 'GET', student1InitData);
assert(meStudent1.status === 200, 'Student 1 GET /v3/me returns 200 OK');
const meStudent1Body = await meStudent1.json();
assert(meStudent1Body.ok === true && meStudent1Body.linked === true, 'Student 1 is linked');
assert(meStudent1Body.gid === testGid && meStudent1Body.slot === 'SLOT-A1', 'Student 1 has correct gid and slot');
assert(meStudent1Body.marks['10-02.1'] === 'u' && meStudent1Body.marks['10-05.1'] === 'e', 'Student 1 receives their own marks');

// CRITICAL PRIVACY CHECK: Student 1 CANNOT see Student 2's marks!
assert((meStudent1Body.marks as any)['SLOT-B2'] === undefined, 'CRITICAL PRIVACY: Student 1 does NOT see other slot marks');
assert((meStudent1Body as any).slots === undefined, 'CRITICAL PRIVACY: Server does not return the raw slots map to students');

// 9.3 Student 2 views their marks
const meStudent2 = await callWorker(`/v3/me?month=${testMonth}`, 'GET', student2InitData);
const meStudent2Body = await meStudent2.json();
assert(meStudent2Body.slot === 'SLOT-B2', 'Student 2 views SLOT-B2');
assert(meStudent2Body.marks['10-02.1'] === 'e', 'Student 2 sees only their own mark (10-02.1: e)');
assert(meStudent2Body.marks['10-05.1'] === undefined, 'Student 2 does NOT see Student 1 marks');

// ------------------------------------------------------------
// 10. DELETE /v3/me (Consent Revocation & Right to be Forgotten)
// ------------------------------------------------------------
console.log('\n--- 10. DELETE /v3/me (Consent Revocation) ---');

// 10.1 Student 1 revokes consent
const deleteStudent1 = await callWorker(`/v3/me?month=${testMonth}`, 'DELETE', student1InitData);
assert(deleteStudent1.status === 200, 'DELETE /v3/me returns 200 OK');
const delete1Body = await deleteStudent1.json();
assert(delete1Body.ok === true && delete1Body.deleted === true, 'Response confirms deleted: true');

// 10.2 Verify user binding deleted from KV
assert(!kvStore.has(`u:${student1BlindId}`), 'User record u:{blindId} completely removed from KV');

// 10.3 Verify attendance marks for SLOT-A1 were wiped from month record
const monthAfterRevoke = JSON.parse((await mockAppData.get(`a:${testGid}:${testMonth}`))!);
assert(monthAfterRevoke.slots['SLOT-A1'] === undefined, 'Attendance marks for revoked slot purged from month record');
assert(monthAfterRevoke.slots['SLOT-B2'] !== undefined, 'Other students attendance records remain intact');

// 10.4 GET /v3/me for Student 1 now reports unlinked
const meStudent1AfterDelete = await callWorker('/v3/me', 'GET', student1InitData);
const me1AfterBody = await meStudent1AfterDelete.json();
assert(me1AfterBody.linked === false, 'Student 1 is now completely unlinked');

// 10.5 Calling DELETE /v3/me when not linked returns deleted: false (idempotent)
const deleteAgain = await callWorker('/v3/me', 'DELETE', student1InitData);
const deleteAgainBody = await deleteAgain.json();
assert(deleteAgainBody.ok === true && deleteAgainBody.deleted === false, 'Calling DELETE when unlinked returns deleted: false');

// ------------------------------------------------------------
// 11. DELETE /v3/slot/:id (Elder slot deletion)
// ------------------------------------------------------------
console.log('\n--- 11. DELETE /v3/slot/:id (Elder slot management) ---');

const deleteSlotForbidden = await callWorker(`/v3/slot/SLOT-B2?gid=${testGid}`, 'DELETE', strangerInitData);
assert(deleteSlotForbidden.status === 403, 'Non-staff forbidden from deleting slot (403)');

const deleteSlotElder = await callWorker(`/v3/slot/SLOT-B2?gid=${testGid}&month=${testMonth}`, 'DELETE', elderInitData);
assert(deleteSlotElder.status === 200, 'Elder successfully deletes SLOT-B2 (200 OK)');

const groupAfterSlotDelete = JSON.parse((await mockAppData.get(`g:${testGid}`))!);
assert(!groupAfterSlotDelete.slots.includes('SLOT-B2'), 'Slot SLOT-B2 removed from g:{gid}.slots');

const monthAfterSlotDelete = JSON.parse((await mockAppData.get(`a:${testGid}:${testMonth}`))!);
assert(monthAfterSlotDelete.slots['SLOT-B2'] === undefined, 'Marks for deleted slot removed from month attendance');

// ------------------------------------------------------------
// 12. AES-256-GCM Encryption & Decryption (A5-4)
// ------------------------------------------------------------
console.log('\n--- 12. AES-256-GCM Chat ID Encryption & Decryption ---');
const testChatId = 123456789;
const encResult1 = await encryptChatId(testChatId, TEST_PEPPER);
assert(typeof encResult1.enc === 'string' && encResult1.enc.length > 0, 'encryptChatId returns hex ciphertext');
assert(typeof encResult1.iv === 'string' && encResult1.iv.length === 24, 'encryptChatId returns 12-byte hex IV');

const decrypted1 = await decryptChatId(encResult1.enc, encResult1.iv, TEST_PEPPER);
assert(decrypted1 === String(testChatId), 'decryptChatId correctly recovers original chatId');

// Decrypt with wrong pepper fails
const wrongPepperDecrypted = await decryptChatId(encResult1.enc, encResult1.iv, 'wrong_pepper_key_for_test_fail!');
assert(wrongPepperDecrypted === null, 'decryptChatId fails safely (returns null) with incorrect pepper');

// Two encryptions of the same chatId use unique IVs (non-deterministic ciphertext)
const encResult2 = await encryptChatId(testChatId, TEST_PEPPER);
assert(encResult1.iv !== encResult2.iv, 'Two encryptions generate different random IVs');
assert(encResult1.enc !== encResult2.enc, 'Two encryptions produce different ciphertexts');

// ------------------------------------------------------------
// 13. POST /report Bug Report Relay Endpoint (A5-4)
// ------------------------------------------------------------
console.log('\n--- 13. POST /report Bug Report Relay ---');

// 13.1 Missing initData returns 401
const unauthReport = await worker.fetch(new Request('https://worker.test/report', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: 'Error occurred' })
}), mockEnv);
assert(unauthReport.status === 401, 'POST /report without initData returns 401 Unauthorized');

// 13.2 Empty text returns 400
const emptyTextReport = await callWorker('/report', 'POST', student1InitData, { text: '' });
assert(emptyTextReport.status === 400, 'POST /report with empty text returns 400 Bad Request');

// 13.3 Successful report without wantReply
let telegramCalls: any[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url: any, init?: any): Promise<any> => {
  telegramCalls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 77771 } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};

const reportNoReply = await callWorker('/report', 'POST', student1InitData, {
  text: 'Проблема с расписанием',
  diag: { browser: 'Chrome', ver: '1.0' },
  wantReply: false
});
assert(reportNoReply.status === 200, 'POST /report returns 200 OK');
const repNoReplyBody = await reportNoReply.json();
assert(repNoReplyBody.ok === true && repNoReplyBody.sent === true, 'POST /report response contains ok: true, sent: true');
assert(!kvStore.has('rm:77771'), 'When wantReply is false, rm:message_id is NOT stored in KV');
assert(telegramCalls.length === 1, 'Telegram sendMessage was called to notify developer');
assert(telegramCalls[0].body.text.includes('Проблема с расписанием'), 'Telegram message body contains report text');

// 13.4 Successful report with wantReply === true
telegramCalls = [];
globalThis.fetch = async (url: any, init?: any): Promise<any> => {
  telegramCalls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 88881 } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};

const reportWithReply = await callWorker('/report', 'POST', student2InitData, {
  text: 'Не отображается отметка',
  diag: 'Android 14, WebApp',
  wantReply: true
});
assert(reportWithReply.status === 200, 'POST /report with wantReply returns 200 OK');
assert(kvStore.has('rm:88881'), 'rm:88881 is stored in KV for reply relay');
const rmDataRaw = kvStore.get('rm:88881')!;
const rmData = JSON.parse(rmDataRaw);
assert(typeof rmData.enc === 'string' && typeof rmData.iv === 'string', 'rm:88881 stores AES-GCM encrypted payload');
const decryptedStudentId = await decryptChatId(rmData.enc, rmData.iv, TEST_PEPPER);
assert(decryptedStudentId === String(student2UserId), 'Decrypted chatId in rm:88881 accurately matches student2UserId');

// 13.5 Rate limiter on POST /report (max 5 reports per hour)
const spammerUserId = 9876;
const spammerInitData = await makeInitData(spammerUserId, 'Spammer');
for (let i = 1; i <= 4; i++) {
  const res = await callWorker('/report', 'POST', spammerInitData, { text: `Report #${i}` });
  assert(res.status === 200, `Report #${i} within rate limit returns 200`);
}
const report5 = await callWorker('/report', 'POST', spammerInitData, { text: 'Report #5' });
assert(report5.status === 200, 'Report #5 at rate limit returns 200');

// 6th report exceeds rate limit -> 429
const report6 = await callWorker('/report', 'POST', spammerInitData, { text: 'Report #6 (over limit)' });
assert(report6.status === 429, 'Report #6 returns 429 Too Many Requests');

// ------------------------------------------------------------
// 14. POST /tg/webhook Developer Reply Relay (A5-4)
// ------------------------------------------------------------
console.log('\n--- 14. POST /tg/webhook Developer Reply Relay ---');

const devChatId = 11223344;
const webhookEnv = {
  ...mockEnv,
  DEV_CHAT_ID: devChatId,
  TG_WEBHOOK_SECRET: 'super-secret-webhook-token-42'
};
const postWebhook = (path: string, headers: any, body: any) =>
  worker.fetch(new Request(`https://worker.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  }), webhookEnv);

// 14.1 Webhook rejects unauthorized requests
assert((await postWebhook('/tg/webhook', {}, {})).status === 401, 'Webhook without secret token returns 401 Unauthorized');
assert((await postWebhook('/tg/webhook', { 'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret' }, {})).status === 401, 'Webhook with wrong secret token returns 401 Unauthorized');

// 14.2 Webhook accepts secret via header or secret path
assert((await postWebhook('/tg/webhook', { 'X-Telegram-Bot-Api-Secret-Token': 'super-secret-webhook-token-42' }, { message: { text: 'Ignoring non-reply' } })).status === 200, 'Webhook with valid header returns 200 OK');
assert((await postWebhook('/tg/webhook/super-secret-webhook-token-42', {}, { message: { text: 'Ignoring non-reply' } })).status === 200, 'Webhook with secret in URL path returns 200 OK');

// 14.3 Developer replies to report (reply_to_message with rm:88881)
telegramCalls = [];
globalThis.fetch = async (url: any, init?: any): Promise<any> => {
  telegramCalls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};

const devReplyPayload = {
  update_id: 99991,
  message: {
    message_id: 555,
    from: { id: devChatId, first_name: 'Developer' },
    chat: { id: devChatId },
    text: 'Ошибка исправлена в обновлении 3.1.2!',
    reply_to_message: { message_id: 88881 }
  }
};

const replyResponse = await postWebhook('/tg/webhook', { 'X-Telegram-Bot-Api-Secret-Token': 'super-secret-webhook-token-42' }, devReplyPayload);
assert(replyResponse.status === 200, 'Developer reply via webhook returns 200 OK');
assert(telegramCalls.length === 1, 'Bot sent reply message to student');
assert(String(telegramCalls[0].body.chat_id) === String(student2UserId), 'Reply was directed to student2UserId');
assert(telegramCalls[0].body.text.includes('💬 Ответ разработчика на ваше обращение:'), 'Message formatted with developer reply prefix');
assert(telegramCalls[0].body.text.includes('Ошибка исправлена в обновлении 3.1.2!'), 'Message includes developer reply text');

// 14.4 Reply from non-owner does not dispatch to student
telegramCalls = [];
const strangerReplyPayload = {
  update_id: 99992,
  message: {
    message_id: 556,
    from: { id: 66666, first_name: 'Imposter' },
    text: 'Fake reply',
    reply_to_message: { message_id: 88881 }
  }
};
await postWebhook('/tg/webhook', { 'X-Telegram-Bot-Api-Secret-Token': 'super-secret-webhook-token-42' }, strangerReplyPayload);
assert(telegramCalls.length === 0, 'Reply from non-DEV_CHAT_ID is ignored (no message sent)');

// Restore global fetch
globalThis.fetch = originalFetch;

// ------------------------------------------------------------
// 15. Staff Write Restrictions on Schedule & Homework (A5-5)
// ------------------------------------------------------------
console.log('\n--- 15. Staff Write Restrictions (A5-5) ---');

const syncEnv = {
  ...mockEnv,
  APP_SECRET: 'ci-secret-key-999',
  ADMIN_BLIND_ID: 'admin-master-blind-id-001'
};

const adminInitData = await makeInitData(777, 'Admin');
const adminBlindIdCalculated = await blindId(syncEnv, 777);
const syncEnvWithAdmin = { ...syncEnv, ADMIN_BLIND_ID: adminBlindIdCalculated };

// Ensure test group exists in KV with elder as staff
await mockAppData.put(`g:${testGid}`, JSON.stringify({ slots: ['SLOT-A1'], staff: [elderBlindId] }));

const callSync = (method: string, endpoint: string, headers: any = {}, body?: any, env: any = syncEnv) =>
  worker.fetch(new Request(`https://worker.test/sync/${endpoint}?groupId=${testGid}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined
  }), env);

// 15.1 Public GET /sync/homework and /sync/schedule without auth returns 200
assert((await callSync('GET', 'homework')).status === 200, 'GET /sync/homework is open to all (200 OK)');
assert((await callSync('GET', 'schedule')).status === 200, 'GET /sync/schedule is open to all (200 OK)');

// 15.2 CI scripts with X-App-Key can write schedule and homework
assert((await callSync('PUT', 'homework', { 'X-App-Key': 'ci-secret-key-999' }, { items: [] })).status === 200, 'PUT /sync/homework with valid X-App-Key succeeds (200 OK)');
assert((await callSync('PUT', 'schedule', { 'X-App-Key': 'ci-secret-key-999' }, { scheduleOverrides: {} })).status === 200, 'PUT /sync/schedule with valid X-App-Key succeeds (200 OK)');

// 15.3 Write without X-App-Key and without initData returns 401
assert((await callSync('PUT', 'homework', {}, { items: [] })).status === 401, 'PUT /sync/homework without credentials returns 401 Unauthorized');

// 15.4 Non-staff student attempting to write returns 403 Forbidden
const studentPutHw = await callSync('PUT', 'homework', { 'X-Telegram-Init-Data': student1InitData }, { items: [] });
assert(studentPutHw.status === 403, 'PUT /sync/homework by student returns 403 Forbidden');
const studentHwBody = await studentPutHw.json();
assert(studentHwBody.error === 'Forbidden: Write permission requires verified staff or admin role', 'Error message matches exact specification');

assert((await callSync('POST', 'homework', { 'X-Telegram-Init-Data': student1InitData }, { items: [] })).status === 403, 'POST /sync/homework by student returns 403 Forbidden');
assert((await callSync('PUT', 'schedule', { 'X-Telegram-Init-Data': student1InitData }, { scheduleOverrides: {} })).status === 403, 'PUT /sync/schedule by student returns 403 Forbidden');

// 15.5 Verified group staff (elder) can write homework and schedule
assert((await callSync('PUT', 'homework', { 'X-Telegram-Init-Data': elderInitData }, { items: [] })).status === 200, 'PUT /sync/homework by verified staff (elder) returns 200 OK');
assert((await callSync('PUT', 'schedule', { 'X-Telegram-Init-Data': elderInitData }, { scheduleOverrides: {} })).status === 200, 'PUT /sync/schedule by verified staff (elder) returns 200 OK');

// 15.6 Admin (ADMIN_BLIND_ID) can write homework and schedule
assert((await callSync('PUT', 'homework', { 'X-Telegram-Init-Data': adminInitData }, { items: [] }, syncEnvWithAdmin)).status === 200, 'PUT /sync/homework by ADMIN_BLIND_ID returns 200 OK');

// ------------------------------------------------------------
// 16. User Group Access Control (checkUserGroupAccess) & Deprecated Endpoints
// ------------------------------------------------------------
console.log('\n--- 16. Access Control by userBlindId & Deprecated Routes ---');

// 16.1 checkUserGroupAccess checks g:{gid}.staff by userBlindId
await mockAppData.put('g:test-grp-access', JSON.stringify({ staff: [elderBlindId] }));
assert(await checkUserGroupAccess(mockAppData, elderBlindId, 'test-grp-access') === true, 'checkUserGroupAccess grants access to group staff member');
assert(await checkUserGroupAccess(mockAppData, student1BlindId, 'test-grp-access') === false, 'checkUserGroupAccess denies access to non-staff user');

// 16.2 checkUserGroupAccess checks g:admin.staff by userBlindId
await mockAppData.put('g:admin', JSON.stringify({ staff: [adminBlindIdCalculated] }));
assert(await checkUserGroupAccess(mockAppData, adminBlindIdCalculated, 'test-grp-access') === true, 'checkUserGroupAccess grants global admin access to any group');
assert(await checkUserGroupAccess(mockAppData, adminBlindIdCalculated, 'other-arbitrary-group') === true, 'checkUserGroupAccess grants global admin access to arbitrary groups');

// 16.3 checkUserGroupAccess fails safe on invalid inputs or missing group
assert(await checkUserGroupAccess(mockAppData, '', 'test-grp-access') === false, 'checkUserGroupAccess rejects empty userBlindId');
assert(await checkUserGroupAccess(mockAppData, elderBlindId, '') === false, 'checkUserGroupAccess rejects empty groupId');
assert(await checkUserGroupAccess(null as any, elderBlindId, 'test-grp-access') === false, 'checkUserGroupAccess rejects null appData');
assert(await checkUserGroupAccess(mockAppData, elderBlindId, 'nonexistent-group-xyz') === false, 'checkUserGroupAccess returns false for nonexistent group');

// 16.4 Verify PUT /sync/attendance returns 410 Gone (P0-01)
const putAttRes = await worker.fetch(new Request('https://worker.test/sync/attendance?groupId=test-grp-access', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'X-App-Key': 'ci-secret-key-999'
  },
  body: JSON.stringify({ byGroup: { 'test-grp-access': { records: [] } } })
}), syncEnv);
assert(putAttRes.status === 410, 'PUT /sync/attendance is deprecated and returns 410 Gone');

// 16.5 Verify POST /auth/pin returns 410 Gone (P0-02)
const postPinRes = await worker.fetch(new Request('https://worker.test/auth/pin', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ pin: '839124' })
}), mockEnv);
assert(postPinRes.status === 410, 'POST /auth/pin is deprecated and returns 410 Gone');

// ============================================================
// Summary
// ============================================================
console.log('\n============================================================');
console.log(`  API v3 TEST SUMMARY: ${passed} / ${total} assertions passed`);
if (passed === total) {
  console.log('  🎉 ALL API v3 ENDPOINTS & SECURITY CHECKS PASSED (100%)');
} else {
  console.error(`  ❌ ${total - passed} assertions failed`);
  process.exitCode = 1;
}
console.log('============================================================\n');
