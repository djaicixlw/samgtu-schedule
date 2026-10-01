import assert from 'node:assert';
import { getLocalBackup, fetchGroupCloudData, pushGroupCloudData } from '../utils/cloudSync';
import { sanitizeSyncPayload, sanitizeStudent, sanitizeAttendanceRecord } from '../cloudflare-worker.js';
import { Student } from '../types';

console.log('====================================================');
console.log('   STARTING ROSTER (STUDENTS) CLOUD SYNC TESTS');
console.log('====================================================\n');

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string): void { this.store.set(k, String(v)); }
  removeItem(k: string): void { this.store.delete(k); }
  clear(): void { this.store.clear(); }
}

const deviceAdmin = new MemoryStorage();
const deviceStarosta = new MemoryStorage();
let activeStorage = deviceAdmin;

const storageWrapper = {
  getItem: (k: string) => activeStorage.getItem(k),
  setItem: (k: string, v: string) => activeStorage.setItem(k, v),
  removeItem: (k: string) => activeStorage.removeItem(k),
  clear: () => activeStorage.clear()
};

(globalThis as any).localStorage = storageWrapper;
if (typeof window !== 'undefined') {
  (window as any).localStorage = storageWrapper;
}

// Mock Cloud Bin
let mockCloudAttendanceBin: any = {
  byGroup: {
    'ingt-310': {
      records: [{ docId: 'rec_1', groupId: 'ingt-310', date: '2026-09-01', lessonId: 'l1' }],
      updatedAt: 1000
    }
  }
};

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url: any, opts: any) => {
  const urlStr = String(url);
  const method = (opts?.method || 'GET').toUpperCase();

  if (urlStr.includes('/sync/attendance') || urlStr.includes('cdaacff')) {
    if (method === 'PUT') {
      const body = JSON.parse(opts.body);
      const payload = typeof body.payload === 'string' ? JSON.parse(body.payload) : body;
      if (payload.byGroup) {
        for (const [gid, incoming] of Object.entries(payload.byGroup as Record<string, any>)) {
          const existing = mockCloudAttendanceBin.byGroup[gid] || {};
          mockCloudAttendanceBin.byGroup[gid] = {
            ...existing,
            ...incoming,
            records: incoming.records !== undefined ? incoming.records : existing.records,
            students: incoming.students !== undefined ? incoming.students : existing.students,
            updatedAt: Date.now()
          };
        }
      } else {
        mockCloudAttendanceBin = payload;
      }
      return new Response(JSON.stringify({ status: 0, data: 'OK' }), { status: 200 });
    }
    return new Response(JSON.stringify({ byGroup: mockCloudAttendanceBin.byGroup, payload: JSON.stringify(mockCloudAttendanceBin), updatedAt: Date.now() }), { status: 200 });
  }

  // Fallback for schedule / homework
  return new Response(JSON.stringify({ payload: JSON.stringify({ byGroup: {} }), updatedAt: Date.now() }), { status: 200 });
};

async function runTests() {
  const testGroupId = 'ingt-313';

  // ----------------------------------------------------
  // TEST 1: Sanitizer validates student structure
  // ----------------------------------------------------
  console.log('>>> 1. Testing Worker Sanitizer for Roster/Students');
  const validStudent = sanitizeStudent({ id: 1, name: '  Тестовый Студент Один  ', maliciousField: true });
  assert.strictEqual(validStudent?.id, 1, 'Valid student ID retained');
  assert.strictEqual(validStudent?.name, 'Тестовый Студент Один', 'Valid student name trimmed');
  assert.strictEqual((validStudent as any)?.maliciousField, undefined, 'Injected field dropped');

  const invalidStudent = sanitizeStudent({ id: 'bad', name: '' });
  assert.strictEqual(invalidStudent, null, 'Invalid student dropped');

  const cleanPayload = sanitizeSyncPayload('attendance', {
    byGroup: {
      'ingt-313': {
        records: [],
        students: [
          { id: 1, name: 'Студент А', injected: 'hack' },
          { id: 'wrong', name: '' }
        ],
        updatedAt: 12345
      }
    }
  });

  const groupStudents = cleanPayload.byGroup['ingt-313'].students;
  assert.strictEqual(groupStudents.length, 1, 'Sanitizer retained only valid students');
  assert.strictEqual(groupStudents[0].name, 'Студент А', 'Student name cleaned');
  assert.strictEqual(groupStudents[0].injected, undefined, 'Hacked field stripped');
  console.log('✅ PASS: Worker sanitization correctly protects student roster.\n');

  // ----------------------------------------------------
  // TEST 1b: Sanitizer validates attendance record DTO
  // ----------------------------------------------------
  console.log('>>> 1b. Testing Worker Sanitizer for Attendance Record (A5-B1)');
  const cleanAttRecord = sanitizeAttendanceRecord({
    docId: 'custom-doc-1',
    groupId: 'ingt-313',
    date: '2026-09-25',
    lessonId: 'l1',
    absentStudentIds: [1, 2, 'invalid', -3, 0],
    excusedStudentIds: [3, 4],
    isCancelled: true,
    updatedAt: 1727280000000,
    updatedBy: 'starosta',
    injectedKey: 'malicious'
  } as any);

  assert(cleanAttRecord !== null, 'Attendance record sanitized successfully');
  assert.strictEqual(cleanAttRecord.docId, 'custom-doc-1', 'docId preserved');
  assert.strictEqual(cleanAttRecord.groupId, 'ingt-313', 'groupId preserved');
  assert.strictEqual(cleanAttRecord.date, '2026-09-25', 'date preserved');
  assert.strictEqual(cleanAttRecord.lessonId, 'l1', 'lessonId preserved');
  assert.deepStrictEqual(cleanAttRecord.absentStudentIds, [1, 2], 'absentStudentIds filtered to positive integers');
  assert.deepStrictEqual(cleanAttRecord.excusedStudentIds, [3, 4], 'excusedStudentIds filtered to positive integers');
  assert.strictEqual(cleanAttRecord.isCancelled, true, 'isCancelled boolean preserved');
  assert.strictEqual(cleanAttRecord.updatedAt, 1727280000000, 'updatedAt preserved');
  assert.strictEqual(cleanAttRecord.updatedBy, 'starosta', 'updatedBy preserved');
  assert.strictEqual((cleanAttRecord as any).injectedKey, undefined, 'injectedKey stripped');

  const autoGeneratedDocIdAtt = sanitizeAttendanceRecord({
    groupId: 'ingt-313',
    date: '2026-09-25',
    lessonId: 'l2',
    absentStudentIds: [1]
  } as any);
  assert.strictEqual(autoGeneratedDocIdAtt?.docId, 'ingt-313_2026-09-25_l2', 'docId generated from groupId_date_lessonId when absent');
  console.log('✅ PASS: Worker sanitization correctly protects AttendanceRecord DTO.\n');

  // ----------------------------------------------------
  // TEST 2: Device A (Admin) creates and pushes students
  // ----------------------------------------------------
  console.log('>>> 2. Device A (Admin) saves roster locally and pushes to cloud');
  activeStorage = deviceAdmin;

  const initialStudents: Student[] = [
    { id: 1, name: 'Тестовый Студент 1' },
    { id: 2, name: 'Тестовый Студент 2' },
    { id: 3, name: 'Тестовый Студент 3' }
  ];

  deviceAdmin.setItem(`students_${testGroupId}`, JSON.stringify(initialStudents));

  const localBackup = getLocalBackup(testGroupId);
  assert.strictEqual(localBackup.students?.length, 3, 'getLocalBackup returns saved students');

  const pushOk = await pushGroupCloudData({ students: initialStudents }, testGroupId);
  assert.strictEqual(pushOk, true, 'pushGroupCloudData returned true');

  // Verify cloud received students and preserved other groups
  assert(mockCloudAttendanceBin.byGroup['ingt-310'] !== undefined, 'Group ingt-310 was preserved');
  assert(mockCloudAttendanceBin.byGroup[testGroupId] !== undefined, 'Group ingt-313 exists in cloud');
  assert.strictEqual(mockCloudAttendanceBin.byGroup[testGroupId].students.length, 3, 'Cloud has 3 students for ingt-313');
  console.log('✅ PASS: Device A successfully synced roster to cloud.\n');

  // ----------------------------------------------------
  // TEST 3: Device B (Starosta) fetches roster from cloud
  // ----------------------------------------------------
  console.log('>>> 3. Device B (Starosta) cold-starts and fetches roster from cloud');
  activeStorage = deviceStarosta;
  assert.strictEqual(deviceStarosta.getItem(`students_${testGroupId}`), null, 'Device B starts with empty storage');

  const fetched = await fetchGroupCloudData(true, testGroupId);
  assert(fetched !== null, 'fetchGroupCloudData returned data');
  assert.strictEqual(fetched.students?.length, 3, 'fetched.students has 3 students');
  assert.strictEqual(fetched.students[0].name, 'Тестовый Студент 1', 'First student name matches');

  // Verify Device B localStorage was automatically populated
  const savedOnDeviceB = JSON.parse(deviceStarosta.getItem(`students_${testGroupId}`) || '[]');
  assert.strictEqual(savedOnDeviceB.length, 3, 'Device B localStorage was populated from cloud');
  console.log('✅ PASS: Device B successfully received and persisted roster from cloud.\n');

  // ----------------------------------------------------
  // TEST 4: Device B edits a student, pushes, Device A receives
  // ----------------------------------------------------
  console.log('>>> 4. Device B edits student name, pushes, Device A pulls update');
  const updatedStudents: Student[] = [
    { id: 1, name: 'Тестовый Студент 1 (Обновлен)' },
    { id: 2, name: 'Тестовый Студент 2' },
    { id: 3, name: 'Тестовый Студент 3' }
  ];

  deviceStarosta.setItem(`students_${testGroupId}`, JSON.stringify(updatedStudents));
  await pushGroupCloudData({ students: updatedStudents }, testGroupId);

  // Switch to Device A
  activeStorage = deviceAdmin;
  const adminFetched = await fetchGroupCloudData(true, testGroupId);
  assert.strictEqual(adminFetched?.students?.[0].name, 'Тестовый Студент 1 (Обновлен)', 'Device A sees updated name');
  const adminLocal = JSON.parse(deviceAdmin.getItem(`students_${testGroupId}`) || '[]');
  assert.strictEqual(adminLocal[0].name, 'Тестовый Студент 1 (Обновлен)', 'Device A localStorage updated with new name');
  console.log('✅ PASS: Roster edits propagate bidirectionally without data loss.\n');

  // ----------------------------------------------------
  // TEST 5: Pushing attendance records does NOT wipe students
  // ----------------------------------------------------
  console.log('>>> 5. Pushing attendance records preserves existing students in cloud');
  await pushGroupCloudData({
    attendance: [{
      docId: 'rec_att_1',
      groupId: testGroupId,
      date: '2026-09-25',
      lessonId: 'l1',
      absentStudentIds: [1],
      excusedStudentIds: [],
      isCancelled: false
    }]
  }, testGroupId);

  assert.strictEqual(mockCloudAttendanceBin.byGroup[testGroupId].records.length, 1, 'Attendance record saved');
  assert.strictEqual(mockCloudAttendanceBin.byGroup[testGroupId].students.length, 3, 'Students preserved when attendance was pushed');
  // ----------------------------------------------------
  // TEST 6: AttendanceTracker cold start roster hydration
  // ----------------------------------------------------
  console.log('>>> 6. AttendanceTracker cold start loads group roster from cloud');
  const deviceC = new MemoryStorage();
  activeStorage = deviceC;
  assert.strictEqual(deviceC.getItem(`students_${testGroupId}`), null, 'Device C has empty localStorage on cold start');

  // Simulate AttendanceTracker mount lifecycle
  const cloudData = await fetchGroupCloudData(false, testGroupId);
  assert(cloudData !== null, 'fetchGroupCloudData returned cloud payload');
  assert(Array.isArray(cloudData.students) && cloudData.students.length > 0, 'Cloud returned non-empty students');
  deviceC.setItem(`students_${testGroupId}`, JSON.stringify(cloudData.students));

  const loadedStudents: Student[] = JSON.parse(deviceC.getItem(`students_${testGroupId}`) || '[]');
  assert.strictEqual(loadedStudents.length, 3, 'Device C successfully hydrated 3 students for ingt-313');
  assert.strictEqual(loadedStudents[0].name, 'Тестовый Студент 1 (Обновлен)', 'Student name preserved');
  console.log('✅ PASS: AttendanceTracker cold start hydration loads and persists roster from cloud.\n');

  console.log('====================================================');
  console.log('   ALL ROSTER CLOUD SYNC TESTS PASSED (6/6) 🎉');
  console.log('====================================================\n');
}

try {
  await runTests();
} catch (err) {
  console.error('Test failed:', err);
  process.exit(1);
} finally {
  globalThis.fetch = originalFetch;
}
