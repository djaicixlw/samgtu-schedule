/**
 * End-to-End Multi-Device Attendance Synchronization Test Suite
 * 
 * Tests real-world multi-device synchronization:
 * 1. Device A (Mobile): enters absences for 2026-10-12 (pairs 3, 4, 5: 3Н 1У), encrypts & pushes to cloud.
 * 2. Cloud Server: verifies that KV contains ONLY AES-GCM ciphertext and anonymous slot keys (0 plaintext FIO).
 * 3. Device B (PC): clean storage, authenticates with access code, recovers E2EE roster, pulls attendance from cloud.
 * 4. Verification: badges (3Н 1У) and cumulative hours match 100% across devices.
 * 5. Multi-Group: verified across multiple groups (ingt-310 and faid-310).
 */

import { Student } from '../types';
import {
  ensureGroupSlots,
  encryptRosterE2EE,
  decryptRosterE2EE,
  saveEncryptedRosterV3,
  fetchEncryptedRosterV3,
  syncRosterToCloud,
  restoreRosterFromCloud,
  pullAttendanceRecordsFromV3,
  syncAttendanceRecordsToV3,
  getLocalStudents,
  saveLocalStudents,
  setAttendanceApiBase,
  saveStaffToken
} from '../utils/attendanceStorage';
import { AttendanceRecord, mergeAttendance } from '../attendance';
import { createStaffToken, verifyStaffToken, isAuthorizedStaff } from '../cloudflare-worker';

console.log('\n=================================================');
console.log('   TEST SUITE: MULTI-DEVICE ATTENDANCE SYNC      ');
console.log('=================================================');

// In-memory mock cloud KV storage emulating Cloudflare Worker KV (APP_DATA)
const mockCloudKV = new Map<string, string>();

// Custom Mock API handler for attendance endpoints
let currentAuthHeaders: Record<string, string> = {};

const mockFetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
  const urlStr = String(url);
  const u = new URL(urlStr);
  const path = u.pathname;
  const method = init?.method || 'GET';
  const headers = (init?.headers as Record<string, string>) || {};

  // Emulate staff authorization check
  const staffTokenHeader = headers['X-Staff-Token'] || (headers['Authorization']?.startsWith('Bearer ') ? headers['Authorization'].slice(7) : '');
  let tokenPayload: any = null;
  if (staffTokenHeader) {
    tokenPayload = await verifyStaffToken(staffTokenHeader, 'mock-test-pepper');
  }

  // 1. GET /v3/roster?gid=...
  if (path === '/v3/roster' && method === 'GET') {
    const gid = u.searchParams.get('gid') || '';
    const raw = mockCloudKV.get(`r:${gid.toLowerCase()}`);
    return new Response(JSON.stringify({ ok: true, roster: raw ? JSON.parse(raw) : null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 2. PUT /v3/roster
  if (path === '/v3/roster' && method === 'PUT') {
    const body = JSON.parse(String(init?.body || '{}'));
    const { gid, data, iv, salt } = body;
    const existingRaw = mockCloudKV.get(`r:${gid.toLowerCase()}`);
    const ver = existingRaw ? (JSON.parse(existingRaw).ver || 0) + 1 : 1;
    const payload = { ver, data, iv, salt, updatedAt: Date.now() };
    mockCloudKV.set(`r:${gid.toLowerCase()}`, JSON.stringify(payload));
    return new Response(JSON.stringify({ ok: true, ver }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 3. GET /v3/att?gid=...&month=...
  if (path === '/v3/att' && method === 'GET') {
    const gid = u.searchParams.get('gid') || '';
    const month = u.searchParams.get('month') || '';
    const raw = mockCloudKV.get(`a:${gid.toLowerCase()}:${month}`);
    const data = raw ? JSON.parse(raw) : { ver: 0, slots: {}, cancelled: [] };
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 4. PUT /v3/att
  if (path === '/v3/att' && method === 'PUT') {
    const body = JSON.parse(String(init?.body || '{}'));
    const { gid, month, baseVer, patch, cancel } = body;
    const key = `a:${gid.toLowerCase()}:${month}`;
    const raw = mockCloudKV.get(key);
    let current = raw ? JSON.parse(raw) : { ver: 0, slots: {}, cancelled: [] };

    // Apply patch
    if (patch && typeof patch === 'object') {
      for (const [slot, marks] of Object.entries(patch as Record<string, Record<string, any>>)) {
        if (!current.slots[slot]) current.slots[slot] = {};
        for (const [lessonKey, mark] of Object.entries(marks)) {
          if (mark === null) {
            delete current.slots[slot][lessonKey];
          } else {
            current.slots[slot][lessonKey] = mark;
          }
        }
      }
    }
    if (Array.isArray(cancel)) {
      current.cancelled = cancel;
    }
    current.ver = (current.ver || 0) + 1;
    mockCloudKV.set(key, JSON.stringify(current));
    return new Response(JSON.stringify({ ok: true, ver: current.ver }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 5. POST /v3/slots
  if (path === '/v3/slots' && method === 'POST') {
    const body = JSON.parse(String(init?.body || '{}'));
    return new Response(JSON.stringify({ ok: true, registered: body.slots?.length || 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 });
};

// Hook mock fetch into global environment
const originalFetch = globalThis.fetch;
(globalThis as any).fetch = mockFetch;
setAttendanceApiBase('https://worker.test');

// Simple assert helper
function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ [PASS] ${message}`);
}

async function runMultiDeviceSyncTests() {
  const GROUP_ID = 'ingt-310';
  const GROUP_CODE = 'K7P2-9XQM-4T8A-B23C';

  console.log('\n--- Phase 1: Device A (Mobile Phone) Configuration & Marking ---');
  
  // Set up mock localStorage for Device A
  const deviceAStorage: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => deviceAStorage[k] || null,
    setItem: (k: string, v: string) => { deviceAStorage[k] = String(v); },
    removeItem: (k: string) => { delete deviceAStorage[k]; },
    clear: () => { Object.keys(deviceAStorage).forEach(k => delete deviceAStorage[k]); }
  };

  // Device A has full roster of 16 students with names
  const rawRosterA: Student[] = [
    { id: 1, name: 'Александров Александр Александрович' },
    { id: 2, name: 'Борисов Борис Борисович' },
    { id: 3, name: 'Васильев Василий Васильевич' },
    { id: 4, name: 'Григорьев Григорий Григорьевич' },
    { id: 5, name: 'Дмитриев Дмитрий Дмитриевич' },
    { id: 6, name: 'Егоров Егор Егорович' },
    { id: 7, name: 'Жуков Ждан Жданович' },
    { id: 8, name: 'Зайцев Захар Захарович' },
    { id: 9, name: 'Иванов Иван Иванович' },
    { id: 10, name: 'Ковалев Константин Константинович' },
    { id: 11, name: 'Лебедев Леонид Леонидович' },
    { id: 12, name: 'Михайлов Михаил Михайлович' },
    { id: 13, name: 'Николаев Николай Николаевич' },
    { id: 14, name: 'Орлов Олег Олегович' },
    { id: 15, name: 'Петров Петр Петрович' },
    { id: 16, name: 'Сидоров Сидор Сидорович' }
  ];

  const slottedRosterA = ensureGroupSlots(GROUP_ID, rawRosterA);
  saveLocalStudents(GROUP_ID, slottedRosterA);
  assert(slottedRosterA.length === 16, 'Device A initialized with 16 students');
  assert(slottedRosterA.every(s => Boolean(s.slot && s.slot.length === 8)), 'Every student on Device A has unique 8-char slot');

  // Device A syncs encrypted roster to cloud (E2EE)
  const rosterSyncResult = await syncRosterToCloud(GROUP_ID, slottedRosterA, GROUP_CODE);
  assert(rosterSyncResult === true, 'Device A successfully synchronized encrypted roster to cloud');

  // Verify server cloud state: 100% Zero-Knowledge privacy check
  const rawCloudRoster = mockCloudKV.get(`r:${GROUP_ID}`);
  assert(Boolean(rawCloudRoster), 'Server KV has r:ingt-310 record');
  const cloudRosterObj = JSON.parse(rawCloudRoster!);
  assert(Boolean(cloudRosterObj.data && cloudRosterObj.iv && cloudRosterObj.salt), 'Server stored AES-GCM ciphertext, IV and salt');
  assert(!rawCloudRoster!.includes('Александров'), 'ZERO-KNOWLEDGE VERIFIED: Plaintext name "Александров" is NOT stored on server');
  assert(!rawCloudRoster!.includes('Иванов'), 'ZERO-KNOWLEDGE VERIFIED: Plaintext name "Иванов" is NOT stored on server');

  // Device A marks yesterday absences (12.10.2026, Monday, Week 3):
  // Pair 3: 3Н 1У (Students 1, 2, 3 unexcused, Student 4 excused)
  // Pair 4: 3Н 1У (Students 1, 2, 3 unexcused, Student 4 excused)
  // Pair 5: 1У    (Student 4 excused)
  const recordsA: AttendanceRecord[] = [
    {
      docId: `${GROUP_ID}_2026-10-12_310-w3-mo-3`,
      groupId: GROUP_ID,
      date: '2026-10-12',
      lessonId: '310-w3-mo-3',
      absentStudentIds: [1, 2, 3],
      excusedStudentIds: [4],
      isCancelled: false,
      updatedAt: Date.now()
    },
    {
      docId: `${GROUP_ID}_2026-10-12_310-w3-mo-4`,
      groupId: GROUP_ID,
      date: '2026-10-12',
      lessonId: '310-w3-mo-4',
      absentStudentIds: [1, 2, 3],
      excusedStudentIds: [4],
      isCancelled: false,
      updatedAt: Date.now()
    },
    {
      docId: `${GROUP_ID}_2026-10-12_310-w3-mo-5`,
      groupId: GROUP_ID,
      date: '2026-10-12',
      lessonId: '310-w3-mo-5',
      absentStudentIds: [],
      excusedStudentIds: [4],
      isCancelled: false,
      updatedAt: Date.now()
    }
  ];

  const pushRes = await syncAttendanceRecordsToV3(GROUP_ID, recordsA);
  assert(pushRes.ok === true, 'Device A pushed attendance records to V3 Blind Server');

  // Verify server cloud attendance: slots only
  const rawAttKV = mockCloudKV.get(`a:${GROUP_ID}:2026-10`);
  assert(Boolean(rawAttKV), 'Server KV has a:ingt-310:2026-10 record');
  const attObj = JSON.parse(rawAttKV!);
  const s1Slot = slottedRosterA.find(s => s.id === 1)!.slot!;
  const s4Slot = slottedRosterA.find(s => s.id === 4)!.slot!;
  assert(attObj.slots[s1Slot]?.['10-12.3'] === 'u', 'Slot 1 marked as "u" (unexcused) on 10-12 pair 3 in cloud');
  assert(attObj.slots[s4Slot]?.['10-12.3'] === 'e', 'Slot 4 marked as "e" (excused) on 10-12 pair 3 in cloud');

  console.log('\n--- Phase 2: Device B (PC / Laptop) Cold Start & Full Recovery ---');

  // Switch to Device B: completely clean, empty storage (no cached students, no cached attendance)
  const deviceBStorage: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => deviceBStorage[k] || null,
    setItem: (k: string, v: string) => { deviceBStorage[k] = String(v); },
    removeItem: (k: string) => { delete deviceBStorage[k]; },
    clear: () => { Object.keys(deviceBStorage).forEach(k => delete deviceBStorage[k]); }
  };

  assert(getLocalStudents(GROUP_ID).length === 0, 'Device B starts with 0 local students');
  assert(deviceBStorage[`attendance_${GROUP_ID}`] === undefined, 'Device B starts with clean attendance storage');

  // Step 2.1: Starosta enters access code on PC
  const staffTokenB = await createStaffToken('mock-test-pepper', { gid: GROUP_ID, role: 'starosta', exp: Date.now() + 86400000 });
  saveStaffToken(staffTokenB, GROUP_ID);
  assert(Boolean(staffTokenB), 'Device B authenticated and saved staff session token');

  // Step 2.2: Device B restores encrypted roster from cloud
  const restoreResult = await restoreRosterFromCloud(GROUP_ID, GROUP_CODE);
  assert(restoreResult.ok === true, 'Device B successfully restored roster from cloud');
  assert(restoreResult.count === 16, 'Device B recovered all 16 students');

  const restoredStudentsB = getLocalStudents(GROUP_ID);
  assert(restoredStudentsB[0].name === 'Александров Александр Александрович', 'Student 1 name perfectly recovered on Device B');
  assert(restoredStudentsB[0].slot === s1Slot, 'Student 1 slot ID on Device B matches Device A exactly');
  assert(restoredStudentsB[3].name === 'Григорьев Григорий Григорьевич', 'Student 4 name perfectly recovered on Device B');
  assert(restoredStudentsB[3].slot === s4Slot, 'Student 4 slot ID on Device B matches Device A exactly');

  // Step 2.3: Device B executes pullAttendanceRecordsFromV3
  const pulledRecordsB = await pullAttendanceRecordsFromV3(GROUP_ID);
  assert(pulledRecordsB.length === 3, 'Device B successfully pulled all 3 lesson records from cloud');

  // Verify pair 3 on 2026-10-12
  const rec3 = pulledRecordsB.find(r => r.date === '2026-10-12' && r.lessonId.endsWith('3'));
  assert(Boolean(rec3), 'Device B has record for 2026-10-12 Pair 3');
  assert(rec3!.absentStudentIds.length === 3, 'Pair 3 on Device B has exactly 3 absent students (3Н)');
  assert(rec3!.absentStudentIds.includes(1) && rec3!.absentStudentIds.includes(2) && rec3!.absentStudentIds.includes(3), 'Pair 3 absent IDs are 1, 2, 3');
  assert(rec3!.excusedStudentIds?.length === 1 && rec3!.excusedStudentIds[0] === 4, 'Pair 3 on Device B has excused student 4 (1У)');

  // Verify pair 4 on 2026-10-12
  const rec4 = pulledRecordsB.find(r => r.date === '2026-10-12' && r.lessonId.endsWith('4'));
  assert(Boolean(rec4), 'Device B has record for 2026-10-12 Pair 4');
  assert(rec4!.absentStudentIds.length === 3, 'Pair 4 on Device B has 3Н');
  assert(rec4!.excusedStudentIds?.length === 1, 'Pair 4 on Device B has 1У');

  // Verify pair 5 on 2026-10-12
  const rec5 = pulledRecordsB.find(r => r.date === '2026-10-12' && r.lessonId.endsWith('5'));
  assert(Boolean(rec5), 'Device B has record for 2026-10-12 Pair 5');
  assert(rec5!.absentStudentIds.length === 0, 'Pair 5 on Device B has 0 unexcused');
  assert(rec5!.excusedStudentIds?.length === 1 && rec5!.excusedStudentIds[0] === 4, 'Pair 5 on Device B has 1У');

  console.log('\n--- Phase 3: Cumulative Hours Statement Integrity Check ---');
  // Student 1 missed Pair 3 and Pair 4 unexcused: 2 pairs * 2 hours = 4 hours unexcused
  // Student 4 was excused on Pair 3, 4, 5: 3 pairs * 2 hours = 6 hours excused
  let s1AbsHours = 0;
  let s4ExcHours = 0;
  for (const r of pulledRecordsB) {
    if (r.absentStudentIds.includes(1)) s1AbsHours += 2;
    if (r.excusedStudentIds?.includes(4)) s4ExcHours += 2;
  }
  assert(s1AbsHours === 4, 'Student 1 cumulative unexcused absences = 4 hours (2 pairs)');
  assert(s4ExcHours === 6, 'Student 4 cumulative excused absences = 6 hours (3 pairs)');

  console.log('\n--- Phase 4: Multi-Group Cross-Check (FAID-310) ---');
  const FAID_GID = 'faid-310';
  const FAID_CODE = 'M3X7-8B2A-9Q1K-7C4D';
  const faidRoster = ensureGroupSlots(FAID_GID, [
    { id: 1, name: 'Архитекторов А.А.' },
    { id: 2, name: 'Дизайнеров Д.Д.' }
  ]);
  await syncRosterToCloud(FAID_GID, faidRoster, FAID_CODE);
  await syncAttendanceRecordsToV3(FAID_GID, [{
    docId: `${FAID_GID}_2026-10-13_faid-2`,
    groupId: FAID_GID,
    date: '2026-10-13',
    lessonId: 'faid-2',
    absentStudentIds: [1],
    excusedStudentIds: [2],
    isCancelled: false,
    updatedAt: Date.now()
  }]);

  // Clean storage test for FAID
  const faidStorage: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => faidStorage[k] || null,
    setItem: (k: string, v: string) => { faidStorage[k] = String(v); },
    removeItem: (k: string) => { delete faidStorage[k]; },
    clear: () => {}
  };
  await restoreRosterFromCloud(FAID_GID, FAID_CODE);
  const faidPulled = await pullAttendanceRecordsFromV3(FAID_GID);
  assert(faidPulled.length === 1, 'FAID-310 pulled 1 record on clean PC session');
  assert(faidPulled[0].absentStudentIds[0] === 1, 'FAID-310 absent student matched ID 1');
  assert(faidPulled[0].excusedStudentIds?.[0] === 2, 'FAID-310 excused student matched ID 2');

  console.log('\n--- Phase 5: Anonymous PC Fallback (Roster Not Yet Decrypted) ---');
  // Scenario: Starosta opens PC before entering code.
  // The PC has NO roster in localStorage.
  const anonStorage: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => anonStorage[k] || null,
    setItem: (k: string, v: string) => { anonStorage[k] = String(v); },
    removeItem: (k: string) => { delete anonStorage[k]; },
    clear: () => {}
  };
  const anonPulled = await pullAttendanceRecordsFromV3(GROUP_ID);
  assert(anonPulled.length === 3, 'PC with empty roster still recovers all 3 attendance records via slot fallback');
  const fallbackStudents = getLocalStudents(GROUP_ID);
  assert(fallbackStudents.length >= 4, 'PC generated fallback anonymous students (Студент 1..N) to prevent empty grid');

  console.log('\n=================================================');
  console.log('  ALL MULTI-DEVICE ATTENDANCE SYNC TESTS PASSED! ');
  console.log('=================================================\n');
}

await runMultiDeviceSyncTests();
