/**
 * Comprehensive Test Suite for API v3 ("Blind Server" Architecture)
 * Tests all 8 routes + privacy isolation + optimistic locking.
 * Task: A5-3
 */

import worker, {
  blindId,
  sha256Hex,
  createTelegramInitData,
  pbkdf2
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
  APP_DATA: mockAppData
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

const defaultPepperBlindId = await blindId({}, elderUserId);
assert(typeof defaultPepperBlindId === 'string' && defaultPepperBlindId.length === 64, 'blindId works with default pepper');
assert(defaultPepperBlindId !== elderBlindId, 'different pepper produces different blindId');

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
