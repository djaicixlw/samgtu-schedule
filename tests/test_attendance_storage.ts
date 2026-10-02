/**
 * Unit Test Suite for utils/attendanceStorage.ts (A4-2a)
 * Tests Crockford Base32 slot generation, invite code generation & hashing,
 * local roster storage, auto-slot assignment, JSON backup export/import,
 * and Blind Server API v3 adapter functions.
 */

import './setup_mock_auth';
import assert from 'node:assert';
import {
  CROCKFORD_BASE32_ALPHABET,
  generateSlotId,
  generateInviteCode,
  hashInviteCode,
  getLocalStudents,
  saveLocalStudents,
  ensureGroupSlots,
  createGroupInvites,
  exportRosterBackup,
  importRosterBackup,
  registerSlotsWithServer,
  publishInvitesWithServer,
  fetchMonthAttendanceV3,
  saveMonthAttendanceV3,
  linkStudentWithInvite,
  fetchMyAttendanceV3,
  unlinkStudentV3,
  getLocalStudentLink,
  clearLocalStudentLink,
  setAttendanceApiBase,
  getTelegramInitData
} from '../utils/attendanceStorage';
import { Student } from '../types';

let passed = 0;
let total = 0;

function check(msg: string, condition: boolean) {
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
console.log('       ATTENDANCE STORAGE v3 & STUDENT ADAPTER TESTS        ');
console.log('============================================================\n');

// ------------------------------------------------------------------
// 1. Slot ID Generation (8-character Crockford Base32)
// ------------------------------------------------------------------
console.log('--- 1. Slot Identifier Generation ---');

const singleSlot = generateSlotId();
check('Slot ID has length 8', singleSlot.length === 8);
check(
  'Slot ID contains only Crockford Base32 characters',
  [...singleSlot].every(ch => CROCKFORD_BASE32_ALPHABET.includes(ch))
);

const generatedSlots = new Set<string>();
for (let i = 0; i < 150; i++) {
  generatedSlots.add(generateSlotId());
}
check('150 generated slots are all unique', generatedSlots.size === 150);

// ------------------------------------------------------------------
// 2. Invite Code Generation & SHA-256 Hashing
// ------------------------------------------------------------------
console.log('\n--- 2. Invite Code Generation & Hashing ---');

const inviteCode = generateInviteCode();
check('Invite code matches pattern XXXX-XXXXXX', /^[0-9A-Z]{4}-[0-9A-Z]{6}$/.test(inviteCode));
check('Invite code length is 11 (10 base32 chars + 1 hyphen)', inviteCode.length === 11);

const generatedCodes = new Set<string>();
for (let i = 0; i < 50; i++) {
  generatedCodes.add(generateInviteCode());
}
check('50 generated invite codes are all unique', generatedCodes.size === 50);

const hash1 = await hashInviteCode('K7P2-9XQM4T');
check('Hash of invite code is 64 hex characters', /^[0-9a-f]{64}$/.test(hash1));

const hashUpper = await hashInviteCode('K7P2-9XQM4T');
const hashLower = await hashInviteCode('k7p2-9xqm4t');
const hashNoHyphen = await hashInviteCode('K7P29XQM4T');
const hashSpaces = await hashInviteCode('  k7p2 - 9xqm4t  ');

check('hashInviteCode is case-insensitive', hashUpper === hashLower);
check('hashInviteCode normalizes hyphens correctly', hashUpper === hashNoHyphen);
check('hashInviteCode ignores extraneous whitespace', hashUpper === hashSpaces);

// Verify SHA-256 with known test vector: SHA-256("A") in lowercase hex
const knownHash = await hashInviteCode('a');
const expectedHexA = '559aead08264d5795d3909718cdd05abd49572e84fe55590eef31a88a08fdffd';
check('hashInviteCode matches standard SHA-256 test vector', knownHash === expectedHexA);

// ------------------------------------------------------------------
// 3. Local Roster Storage (localStorage)
// ------------------------------------------------------------------
console.log('\n--- 3. Local Roster Storage ---');

const testGroupId = 'test-group-a4';
const testStudents: Student[] = [
  { id: 1, name: 'Тестовый Студент 1' },
  { id: 2, name: 'Тестовый Студент 2' }
];

saveLocalStudents(testGroupId, testStudents);
const loadedStudents = getLocalStudents(testGroupId);

check('Saved and loaded students count matches', loadedStudents.length === 2);
check('First student name matches', loadedStudents[0].name === 'Тестовый Студент 1');
check('Second student id matches', loadedStudents[1].id === 2);

const nonExistent = getLocalStudents('non-existent-group-999');
check('Non-existent group returns empty array', Array.isArray(nonExistent) && nonExistent.length === 0);

if (typeof localStorage !== 'undefined') {
  localStorage.setItem('students_corrupted-group', '{invalid json---');
  const corrupted = getLocalStudents('corrupted-group');
  check('Corrupted localStorage JSON returns empty array without throwing', corrupted.length === 0);
}

// ------------------------------------------------------------------
// 4. Slot Auto-Assignment (ensureGroupSlots)
// ------------------------------------------------------------------
console.log('\n--- 4. Slot Auto-Assignment (ensureGroupSlots) ---');

const preAssignedSlot = 'EXIST001';
const unslottedStudents: Student[] = [
  { id: 1, name: 'Тестовый Студент 1', slot: preAssignedSlot },
  { id: 2, name: 'Тестовый Студент 2' },
  { id: 3, name: 'Тестовый Студент 3' }
];

const slotted = ensureGroupSlots(testGroupId, unslottedStudents);

check('ensureGroupSlots returns same number of students', slotted.length === 3);
check('Pre-assigned slot is preserved', slotted[0].slot === preAssignedSlot);
check('Student 2 received an 8-char slot', typeof slotted[1].slot === 'string' && slotted[1].slot.length === 8);
check('Student 3 received an 8-char slot', typeof slotted[2].slot === 'string' && slotted[2].slot.length === 8);
check('All slots in group are unique', new Set(slotted.map(s => s.slot)).size === 3);

// Verify automatic saving to localStorage
const autoSaved = getLocalStudents(testGroupId);
check('ensureGroupSlots automatically saved updated slots to localStorage', autoSaved[1].slot === slotted[1].slot);

// ------------------------------------------------------------------
// 5. Creating Group Invites (createGroupInvites)
// ------------------------------------------------------------------
console.log('\n--- 5. Group Invite Generation ---');

const invites = await createGroupInvites(testGroupId, slotted);

check('createGroupInvites returns an invite for each student', invites.length === slotted.length);
check('Invite contains studentId, slot, code, and hash', Boolean(
  invites[0].studentId === 1 &&
  invites[0].slot === preAssignedSlot &&
  invites[0].code &&
  invites[0].hash
));
check('Invite code matches pattern', /^[0-9A-Z]{4}-[0-9A-Z]{6}$/.test(invites[0].code));
const recalculatedHash = await hashInviteCode(invites[0].code);
check('Invite hash matches SHA-256 of generated invite code', invites[0].hash === recalculatedHash);

// ------------------------------------------------------------------
// 6. JSON Backup Export & Import (exportRosterBackup / importRosterBackup)
// ------------------------------------------------------------------
console.log('\n--- 6. JSON Backup Export & Import ---');

const backupJson = exportRosterBackup(testGroupId);
check('Backup produces valid non-empty string', typeof backupJson === 'string' && backupJson.length > 0);

const parsedBackup = JSON.parse(backupJson);
check('Backup version is 3', parsedBackup.version === 3);
check('Backup groupId matches', parsedBackup.groupId === testGroupId);
check('Backup exportedAt is valid ISO date', !isNaN(Date.parse(parsedBackup.exportedAt)));
check('Backup contains 3 students', parsedBackup.students.length === 3);

// Test import into another group
const targetGroupId = 'test-target-group';
const importResult = importRosterBackup(targetGroupId, backupJson.replace(testGroupId, targetGroupId));
check('Importing backup into target group succeeds', importResult.ok === true && importResult.count === 3);

const importedStudents = getLocalStudents(targetGroupId);
check('Target group students match imported count', importedStudents.length === 3);
check('Target group students preserved slots', importedStudents[0].slot === preAssignedSlot);

// Validation error cases
const badJsonResult = importRosterBackup(targetGroupId, '{malformed json');
check('Importing malformed JSON returns error', badJsonResult.ok === false);

const wrongGroupResult = importRosterBackup('different-group', backupJson);
check('Importing backup with mismatched groupId returns error', wrongGroupResult.ok === false);

const wrongVerResult = importRosterBackup(testGroupId, JSON.stringify({ version: 2, groupId: testGroupId, students: [] }));
check('Importing backup with unsupported version returns error', wrongVerResult.ok === false);

// Sanitization of injected fields
const backupWithInjectedFields = JSON.stringify({
  version: 3,
  groupId: testGroupId,
  exportedAt: new Date().toISOString(),
  students: [
    { id: 10, name: 'Тестовый Студент Защищенный', slot: 'SLOT-999', injectedField: 'malicious', phone: '123' }
  ]
});
const sanitizeImport = importRosterBackup(testGroupId, backupWithInjectedFields);
check('Import with extra fields succeeds', sanitizeImport.ok === true && sanitizeImport.count === 1);
const sanitizedStudent = getLocalStudents(testGroupId)[0] as any;
check('Injected field was stripped during import', sanitizedStudent.injectedField === undefined);
check('Deprecated phone field was stripped during import', sanitizedStudent.phone === undefined);

// New features: Trim, Case-insensitive groupId, Direct array
const untrimmedBackup = `  \n\r  ${backupWithInjectedFields}   \n  `;
const untrimmedImport = importRosterBackup(testGroupId, untrimmedBackup);
check('Importing with leading/trailing whitespace and newlines succeeds', untrimmedImport.ok === true && untrimmedImport.count === 1);

const caseMismatchBackup = JSON.stringify({
  version: 3,
  groupId: 'INGT-310',
  exportedAt: new Date().toISOString(),
  students: [{ id: 1, name: 'Студент Регистра' }]
});
const caseMismatchImport = importRosterBackup('ingt-310', caseMismatchBackup);
check('Importing with case-insensitive groupId succeeds', caseMismatchImport.ok === true && caseMismatchImport.count === 1);

const directArrayBackup = JSON.stringify([
  { id: 1, name: 'Студент Прямой 1', slot: 'DIRSLOT1' },
  { id: 2, name: 'Студент Прямой 2' }
]);
const directArrayImport = importRosterBackup('direct-array-group', directArrayBackup);
check('Importing direct Student[] array succeeds', directArrayImport.ok === true && directArrayImport.count === 2);
const directLoaded = getLocalStudents('direct-array-group');
check('Direct array students loaded correctly', directLoaded[0].name === 'Студент Прямой 1' && directLoaded[0].slot === 'DIRSLOT1');
check('Direct array second student auto-received slot', typeof directLoaded[1].slot === 'string' && directLoaded[1].slot.length === 8);

// UTF-8 BOM test
const bomBackup = '\uFEFF' + JSON.stringify([{ id: 1, name: 'Студент с BOM' }]);
const bomImport = importRosterBackup('bom-group', bomBackup);
check('Importing JSON with UTF-8 BOM succeeds', bomImport.ok === true && bomImport.count === 1);

// Markdown code fence test
const markdownBackup = '```json\n' + JSON.stringify([{ id: 1, name: 'Студент из Markdown' }]) + '\n```';
const markdownImport = importRosterBackup('md-group', markdownBackup);
check('Importing JSON wrapped in markdown code fence succeeds', markdownImport.ok === true && markdownImport.count === 1);

// ------------------------------------------------------------------
// 7. Cloudflare Worker API v3 Client Methods
// ------------------------------------------------------------------
console.log('\n--- 7. Blind Server API v3 Client Methods ---');

const originalFetch = globalThis.fetch;
setAttendanceApiBase('https://mock-worker.test');

let lastInterceptedRequest: { url: string; method: string; headers: Record<string, string>; body?: any } | null = null;
let mockResponseHandler: (url: string, method: string, body?: any) => Response = () => new Response('{}', { status: 200 });

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const urlStr = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);
  const method = init?.method || 'GET';
  const headers: Record<string, string> = {};
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((v, k) => { headers[k] = v; });
    } else if (Array.isArray(init.headers)) {
      init.headers.forEach(([k, v]) => { headers[k] = v; });
    } else {
      Object.assign(headers, init.headers);
    }
  }
  let body: any = undefined;
  if (init?.body) {
    try {
      body = JSON.parse(typeof init.body === 'string' ? init.body : init.body.toString());
    } catch {}
  }
  lastInterceptedRequest = { url: urlStr, method, headers, body };
  return mockResponseHandler(urlStr, method, body);
};

try {
  // 7.1 registerSlotsWithServer
  mockResponseHandler = () => new Response(JSON.stringify({ ok: true, registered: 2 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });

  const regRes = await registerSlotsWithServer('test-api-group', ['SLOT-A1', 'SLOT-B2']);
  check('registerSlotsWithServer returns ok: true', regRes.ok === true && regRes.registered === 2);
  check('registerSlotsWithServer used POST /v3/slots', lastInterceptedRequest?.method === 'POST' && lastInterceptedRequest.url.endsWith('/v3/slots'));
  check('registerSlotsWithServer passed X-Telegram-Init-Data', Boolean(lastInterceptedRequest?.headers['X-Telegram-Init-Data']));
  check('registerSlotsWithServer body contained gid and slots', lastInterceptedRequest?.body?.gid === 'test-api-group' && lastInterceptedRequest?.body?.slots?.length === 2);

  // 7.2 registerSlotsWithServer error handling
  mockResponseHandler = () => new Response(JSON.stringify({ error: 'Forbidden: not a group staff member' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' }
  });
  const regErr = await registerSlotsWithServer('test-api-group', ['SLOT-A1']);
  check('registerSlotsWithServer handles 403 error gracefully', regErr.ok === false && regErr.error?.includes('Forbidden'));

  // 7.3 publishInvitesWithServer
  mockResponseHandler = () => new Response(JSON.stringify({ ok: true, count: 2 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
  const pubRes = await publishInvitesWithServer('test-api-group', [
    { slot: 'SLOT-A1', hash: 'hash1' },
    { slot: 'SLOT-B2', hash: 'hash2' }
  ]);
  check('publishInvitesWithServer returns ok: true with count: 2', pubRes.ok === true && pubRes.count === 2);
  check('publishInvitesWithServer used POST /v3/invites', lastInterceptedRequest?.method === 'POST' && lastInterceptedRequest.url.endsWith('/v3/invites'));
  check('publishInvitesWithServer payload contains only slot and hash', Boolean(
    lastInterceptedRequest?.body?.items?.[0]?.slot === 'SLOT-A1' &&
    lastInterceptedRequest?.body?.items?.[0]?.hash === 'hash1' &&
    lastInterceptedRequest?.body?.items?.[0]?.name === undefined
  ));

  // 7.4 fetchMonthAttendanceV3
  mockResponseHandler = () => new Response(JSON.stringify({
    ver: 3,
    slots: { 'SLOT-A1': { '10-02.1': 'u' } },
    cancelled: ['10-02.3']
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
  const fetchAttRes = await fetchMonthAttendanceV3('test-api-group', '2026-10');
  check('fetchMonthAttendanceV3 returns ok: true with data', fetchAttRes.ok === true && fetchAttRes.data?.ver === 3);
  check('fetchMonthAttendanceV3 queries /v3/att with params', Boolean(
    lastInterceptedRequest?.method === 'GET' &&
    lastInterceptedRequest?.url.includes('/v3/att?') &&
    lastInterceptedRequest?.url.includes('gid=test-api-group') &&
    lastInterceptedRequest?.url.includes('month=2026-10')
  ));

  // 7.5 saveMonthAttendanceV3 success
  mockResponseHandler = () => new Response(JSON.stringify({ ok: true, ver: 4 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
  const saveAttRes = await saveMonthAttendanceV3(
    'test-api-group',
    '2026-10',
    3,
    { 'SLOT-A1': { '10-02.1': 'e' } },
    ['10-02.2']
  );
  check('saveMonthAttendanceV3 returns ok: true and ver: 4', saveAttRes.ok === true && saveAttRes.ver === 4);
  check('saveMonthAttendanceV3 uses PUT /v3/att', lastInterceptedRequest?.method === 'PUT' && lastInterceptedRequest.url.endsWith('/v3/att'));

  // 7.6 saveMonthAttendanceV3 conflict (HTTP 409)
  mockResponseHandler = () => new Response(JSON.stringify({
    error: 'Conflict: data was modified by another session',
    currentVer: 5,
    ver: 5
  }), {
    status: 409,
    headers: { 'Content-Type': 'application/json' }
  });
  const conflictRes = await saveMonthAttendanceV3('test-api-group', '2026-10', 3, {}, []);
  check('saveMonthAttendanceV3 detects conflict', conflictRes.ok === false && conflictRes.conflict === true);
  check('saveMonthAttendanceV3 returns current version on conflict', conflictRes.ver === 5);

  // 7.7 linkStudentWithInvite success & localStorage persistence
  clearLocalStudentLink();
  check('getLocalStudentLink is initially null', getLocalStudentLink() === null);

  mockResponseHandler = () => new Response(JSON.stringify({
    ok: true,
    gid: 'ingt-310',
    slot: 'SLOT-A1'
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });

  const linkRes = await linkStudentWithInvite('k7p2-9xqm4t', 1);
  check('linkStudentWithInvite returns ok: true', linkRes.ok === true && linkRes.gid === 'ingt-310' && linkRes.slot === 'SLOT-A1');
  check('linkStudentWithInvite uses POST /v3/student/link', Boolean(lastInterceptedRequest?.method === 'POST' && lastInterceptedRequest.url.endsWith('/v3/student/link')));
  check('linkStudentWithInvite uppercases code', lastInterceptedRequest?.body?.code === 'K7P2-9XQM4T' && lastInterceptedRequest?.body?.consentVer === 1);
  check('linkStudentWithInvite passed X-Telegram-Init-Data', Boolean(lastInterceptedRequest?.headers['X-Telegram-Init-Data']));

  const storedLink = getLocalStudentLink();
  check('linkStudentWithInvite saved link to localStorage', Boolean(
    storedLink &&
    storedLink.gid === 'ingt-310' &&
    storedLink.slot === 'SLOT-A1' &&
    storedLink.consentVer === 1 &&
    typeof storedLink.linkedAt === 'number'
  ));

  // 7.8 linkStudentWithInvite 404 error handling
  mockResponseHandler = () => new Response(JSON.stringify({ error: 'Invalid or expired invite code' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
  const link404 = await linkStudentWithInvite('EXPIRED-CODE', 1);
  check('linkStudentWithInvite handles 404 with Russian error message', link404.ok === false && link404.error === 'Неверный или истекший код приглашения');

  // 7.9 linkStudentWithInvite 429 error handling
  mockResponseHandler = () => new Response(JSON.stringify({ error: 'Too many attempts' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json' }
  });
  const link429 = await linkStudentWithInvite('RATE-LIMIT', 1);
  check('linkStudentWithInvite handles 429 with Russian error message', link429.ok === false && link429.error === 'Слишком много попыток, подождите 15 минут');

  // 7.10 fetchMyAttendanceV3
  mockResponseHandler = () => new Response(JSON.stringify({
    ok: true,
    linked: true,
    gid: 'ingt-310',
    slot: 'SLOT-A1',
    consentVer: 1,
    consentAt: 1727788800000,
    marks: { '10-02.1': 'e', '10-02.2': 'u' },
    cancelled: ['10-02.3']
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });

  const myAtt = await fetchMyAttendanceV3();
  check('fetchMyAttendanceV3 returns student marks and cancelled lessons', Boolean(
    myAtt.ok === true &&
    myAtt.linked === true &&
    myAtt.gid === 'ingt-310' &&
    myAtt.slot === 'SLOT-A1' &&
    myAtt.marks?.['10-02.1'] === 'e' &&
    myAtt.marks?.['10-02.2'] === 'u' &&
    myAtt.cancelled?.[0] === '10-02.3'
  ));
  check('fetchMyAttendanceV3 uses GET /v3/me', Boolean(lastInterceptedRequest?.method === 'GET' && lastInterceptedRequest.url.endsWith('/v3/me')));

  // Test fetchMyAttendanceV3 with month parameter
  await fetchMyAttendanceV3('2026-10');
  check('fetchMyAttendanceV3 passes month parameter if provided', Boolean(
    lastInterceptedRequest?.url.includes('/v3/me?month=2026-10')
  ));

  // 7.11 unlinkStudentV3
  mockResponseHandler = () => new Response(JSON.stringify({ ok: true, deleted: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });

  const unlinkRes = await unlinkStudentV3();
  check('unlinkStudentV3 returns ok: true, deleted: true', unlinkRes.ok === true && unlinkRes.deleted === true);
  check('unlinkStudentV3 uses DELETE /v3/me', Boolean(lastInterceptedRequest?.method === 'DELETE' && lastInterceptedRequest.url.includes('/v3/me')));
  check('unlinkStudentV3 clears localStorage link', getLocalStudentLink() === null);

  // 7.12 clearLocalStudentLink helper
  localStorage.setItem('v3_student_linked', JSON.stringify({ gid: 'g1', slot: 's1', linkedAt: 123, consentVer: 1 }));
  check('getLocalStudentLink reads manually set link', getLocalStudentLink()?.gid === 'g1');
  clearLocalStudentLink();
  check('clearLocalStudentLink clears localStorage', getLocalStudentLink() === null);

} finally {
  globalThis.fetch = originalFetch;
  setAttendanceApiBase(null);
}

// ------------------------------------------------------------------
// Summary
// ------------------------------------------------------------------
console.log('\n============================================================');
console.log(`RESULTS: ${passed} / ${total} tests passed.`);
console.log('============================================================\n');

assert.strictEqual(passed, total, `All ${total} tests must pass`);
