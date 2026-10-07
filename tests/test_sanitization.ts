/**
 * QA Suite: Mass Assignment Protection, Strict DTO Whitelisting & Upload Rate Limiting
 * Tests that unexpected/injected fields (e.g., 'role', 'is_admin', backdoor properties)
 * are strictly stripped from all cloud payloads before saving to the database.
 */

import worker, {
  sanitizeHomeworkItem,
  sanitizeAttendanceRecord,
  sanitizeScheduleOverride,
  sanitizeSyncPayload,
  isUploadRateLimited,
  recordUploadSent,
  clearWorkerRateLimits
} from '../cloudflare-worker.js';

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
console.log('     QA SUITE: MASS ASSIGNMENT & STRICT DTO SANITIZATION        ');
console.log('================================================================\n');

async function runSanitizationTests() {
  // --- 1. Homework Item Sanitization (Stripping Injected Fields) ---
  console.log('--- 1. Homework DTO Validation ---');
  const maliciousHw = {
    id: 'hw-101',
    groupId: 'ingt-310',
    subject: 'Математика',
    title: 'ДЗ №1',
    description: 'Решить задачи',
    assignedDate: '2026-09-20',
    dueDate: '2026-09-25',
    attachments: [
      { name: 'task.pdf', type: 'pdf', size: 1024, url: 'https://example.com/file', backdoor: 'malicious' }
    ],
    createdAt: '2026-09-20T04:00:00.000Z',
    // Injected fields (Mass Assignment attempt)
    role: 'admin',
    isAdmin: true,
    secretToken: 'stolen_token',
    __proto__: { polluted: true }
  };

  const cleanHw = sanitizeHomeworkItem(maliciousHw);
  check('Valid fields preserved in homework', cleanHw !== null && cleanHw.title === 'ДЗ №1' && cleanHw.subject === 'Математика');
  check('Injected "role" stripped from homework', (cleanHw as any).role === undefined);
  check('Injected "isAdmin" stripped from homework', (cleanHw as any).isAdmin === undefined);
  check('Injected "secretToken" stripped from homework', (cleanHw as any).secretToken === undefined);
  check('Attachment extra fields stripped', (cleanHw as any).attachments[0].backdoor === undefined);

  // --- 2. Attendance Record Sanitization ---
  console.log('\n--- 2. Attendance DTO Validation ---');
  const maliciousAtt = {
    docId: 'ingt-310_2026-09-20_310-w1-mo-1',
    groupId: 'ingt-310',
    date: '2026-09-20',
    lessonId: '310-w1-mo-1',
    absentStudentIds: [1, 2, 'bad' as any, 0, -5, 3],
    excusedStudentIds: [4, 'evil' as any, 5],
    isCancelled: true,
    updatedAt: 1726800000000,
    updatedBy: 'starosta',
    // Injected fields
    isSuperuser: true,
    bypassPayment: true,
    fakeGrade: 5
  };

  const cleanAtt = sanitizeAttendanceRecord(maliciousAtt);
  check('Valid attendance fields preserved',
    cleanAtt !== null &&
    cleanAtt.docId === 'ingt-310_2026-09-20_310-w1-mo-1' &&
    cleanAtt.groupId === 'ingt-310' &&
    cleanAtt.date === '2026-09-20' &&
    cleanAtt.lessonId === '310-w1-mo-1' &&
    cleanAtt.isCancelled === true &&
    cleanAtt.updatedAt === 1726800000000 &&
    cleanAtt.updatedBy === 'starosta'
  );
  check('Absent student IDs sanitized to positive integers',
    Array.isArray(cleanAtt?.absentStudentIds) &&
    JSON.stringify(cleanAtt.absentStudentIds) === JSON.stringify([1, 2, 3])
  );
  check('Excused student IDs sanitized to positive integers',
    Array.isArray(cleanAtt?.excusedStudentIds) &&
    JSON.stringify(cleanAtt.excusedStudentIds) === JSON.stringify([4, 5])
  );
  check('Injected "isSuperuser" stripped from attendance', (cleanAtt as any).isSuperuser === undefined);
  check('Injected "bypassPayment" stripped from attendance', (cleanAtt as any).bypassPayment === undefined);
  check('Injected "fakeGrade" stripped from attendance', (cleanAtt as any).fakeGrade === undefined);

  // Auto-generation of docId test when omitted
  const autoDocAtt = sanitizeAttendanceRecord({
    groupId: 'ingt-310',
    date: '2026-09-20',
    lessonId: '310-w1-mo-2',
    absentStudentIds: [1],
    excusedStudentIds: []
  });
  check('docId auto-generated from groupId_date_lessonId when omitted',
    autoDocAtt !== null && autoDocAtt.docId === 'ingt-310_2026-09-20_310-w1-mo-2'
  );

  // String updatedAt preservation test
  const stringUpdatedAtt = sanitizeAttendanceRecord({
    groupId: 'ingt-310',
    date: '2026-09-20',
    lessonId: '310-w1-mo-2',
    updatedAt: '2026-09-20T12:00:00.000Z'
  });
  check('String updatedAt preserved correctly',
    stringUpdatedAtt !== null && stringUpdatedAtt.updatedAt === '2026-09-20T12:00:00.000Z'
  );

  // --- 3. Schedule Override Sanitization ---
  console.log('\n--- 3. Schedule Override DTO Validation ---');
  const maliciousOverride = {
    subject: 'Высшая математика',
    location: 'Корпус № 1, 401',
    teacher: 'Иванов И.И.',
    isCancelled: true,
    note: 'Перенос пары',
    // Injected fields
    deleteWholeDatabase: true,
    executeCommand: 'rm -rf /'
  };

  const cleanOv = sanitizeScheduleOverride(maliciousOverride);
  check('Valid override fields preserved', cleanOv !== null && cleanOv.subject === 'Высшая математика' && cleanOv.isCancelled === true);
  check('Injected "deleteWholeDatabase" stripped', (cleanOv as any).deleteWholeDatabase === undefined);
  check('Injected "executeCommand" stripped', (cleanOv as any).executeCommand === undefined);

  // --- 4. Full Sync Payload Structure Sanitization ---
  console.log('\n--- 4. Full Sync Payload Structure Sanitization ---');
  const fullPayload = {
    students: [{ id: 1, name: 'Alice' }],
    byGroup: {
      'ingt-310': {
        students: [{ id: 1, name: 'Alice' }],
        items: [maliciousHw],
        deletedIds: ['del-1', 'del-2'],
        unauthorizedField: 'attacker_value'
      }
    },
    injectedTopLevel: 'malicious'
  };

  const cleanFull = sanitizeSyncPayload('homework', fullPayload);
  check('Top level injected field stripped', (cleanFull as any).injectedTopLevel === undefined);
  check('Top level students stripped from homework', (cleanFull as any).students === undefined);
  check('byGroup students stripped from homework', cleanFull.byGroup['ingt-310'] && (cleanFull.byGroup['ingt-310'] as any).students === undefined);
  check('byGroup group preserved', cleanFull.byGroup && cleanFull.byGroup['ingt-310'] !== undefined);
  check('Group level unauthorizedField stripped', (cleanFull.byGroup['ingt-310'] as any).unauthorizedField === undefined);
  check('Inner item stripped of injection', (cleanFull.byGroup['ingt-310'].items[0] as any).role === undefined);

  const cleanAttPayload = sanitizeSyncPayload('attendance', {
    students: [{ id: 2, name: 'Bob' }],
    byGroup: {
      'ingt-310': {
        students: [{ id: 2, name: 'Bob' }],
        records: [maliciousAtt]
      }
    }
  });
  check('Top level students stripped from attendance', (cleanAttPayload as any).students === undefined);
  check('byGroup students stripped from attendance', cleanAttPayload.byGroup['ingt-310'] && (cleanAttPayload.byGroup['ingt-310'] as any).students === undefined);

  // --- 5. Upload Rate Limiting (Anti-DoS) ---
  console.log('\n--- 5. Upload Rate Limiting (Anti-DoS) ---');
  clearWorkerRateLimits();

  const t0 = 1000000;
  for (let i = 0; i < 29; i++) {
    recordUploadSent(t0 + i * 1000);
  }
  check('29 uploads allowed', !isUploadRateLimited(t0 + 29000));
  recordUploadSent(t0 + 29000);

  check('31st upload throttled (exceeded max 30/min)', isUploadRateLimited(t0 + 30000));

  // After cooldown window expires
  check('Upload allowed after cooldown window', !isUploadRateLimited(t0 + 62000));

  // --- 6. End-to-End Worker PUT /sync Test ---
  console.log('\n--- 6. End-to-End Worker PUT /sync Request Handling ---');
  const mockKvStore = new Map<string, string>();
  const mockWorkerEnv = {
    APP_SECRET: 'test_secret_sanitization_123',
    TELEGRAM_BOT_TOKEN: 'test_token',
    ID_PEPPER: 'test_pepper_sanitization_32b_!',
    APP_DATA: {
      get: async (k: string) => mockKvStore.get(k) || null,
      put: async (k: string, v: string) => { mockKvStore.set(k, v); }
    }
  };

  // Deprecated PUT /sync/attendance -> 410 Gone (P0-01)
  const attReq = new Request('https://worker.test/sync/attendance?groupId=ingt-310', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-App-Key': 'test_secret_sanitization_123'
    },
    body: JSON.stringify({
      byGroup: {
        'ingt-310': {
          records: [maliciousAtt],
          hackField: 'evil'
        }
      },
      topHack: 'evil'
    })
  });

  const attRes = await worker.fetch(attReq, mockWorkerEnv);
  check('Worker PUT /sync/attendance returns HTTP 410 Gone', attRes.status === 410);

  // Active PUT /sync/homework -> 200 with whitelist DTO sanitization
  const hwReq = new Request('https://worker.test/sync/homework?groupId=ingt-310', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-App-Key': 'test_secret_sanitization_123'
    },
    body: JSON.stringify({
      students: [{ id: 10, name: 'Student' }],
      byGroup: {
        'ingt-310': {
          students: [{ id: 10, name: 'Student' }],
          items: [maliciousHw],
          hackField: 'evil'
        }
      },
      topHack: 'evil'
    })
  });

  const hwRes = await worker.fetch(hwReq, mockWorkerEnv);
  check('Worker PUT /sync/homework returns HTTP 200', hwRes.status === 200);

  const storedRaw = mockKvStore.get('homework:ingt-310');
  const storedData = storedRaw ? JSON.parse(storedRaw) : null;
  check('KV store received group slice for homework', storedData !== null);
  check('Stored data stripped of hackField in group', storedData && storedData.hackField === undefined);
  check('Stored data stripped of students in group', storedData && storedData.students === undefined);
  check('Stored homework item stripped of role', storedData && storedData.items[0].role === undefined);
  check('Stored homework item preserved title', storedData && storedData.items[0].title === 'ДЗ №1');
  check('Stored homework item preserved attachments', storedData && storedData.items[0].attachments.length === 1);

  // Test GET isolation from KV
  const getReq = new Request('https://worker.test/sync/homework?groupId=ingt-310', {
    method: 'GET',
    headers: {
      'X-App-Key': 'test_secret_sanitization_123'
    }
  });
  const getRes = await worker.fetch(getReq, mockWorkerEnv);
  check('Worker GET /sync returns HTTP 200', getRes.status === 200);
  const getBody = await getRes.json();
  check('GET returns isolated byGroup[groupId]', getBody && getBody.byGroup && getBody.byGroup['ingt-310'] !== undefined);
  check('GET returns matching items', getBody.byGroup['ingt-310'].items.length === 1);

  // --- 7. Admin Migration Route (/admin/migrate-to-kv) Deprecation ---
  console.log('\n--- 7. Verification: Legacy Migration Route Deprecated ---');
  const adminEnv = {
    APP_SECRET: 'admin-secret',
    APP_DATA: {
      get: async (k: string) => mockKvStore.get(k) || null,
      put: async (k: string, v: string) => { mockKvStore.set(k, v); }
    }
  };

  const unauthMigrate = new Request('https://worker.test/admin/migrate-to-kv', { method: 'GET' });
  const unauthMigrateRes = await worker.fetch(unauthMigrate, adminEnv);
  check('GET /admin/migrate-to-kv is safely disabled and returns 404', unauthMigrateRes.status === 404);

  console.log('\n================================================================');
  console.log(`TOTAL SANITIZATION TESTS: ${passCount + failCount}`);
  console.log(`PASSED: ${passCount}`);
  console.log(`FAILED: ${failCount}`);
  console.log('================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runSanitizationTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
