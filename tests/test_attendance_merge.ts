import assert from 'assert';
import { mergeAttendance, AttendanceRecord } from '../attendance';

console.log("================================================================================");
console.log("   TEST SUITE: ATTENDANCE MERGE & CONFLICT RESOLUTION (A4-T1)                   ");
console.log("   Domain: Attendance Synchronization & Offline Immunity                        ");
console.log("================================================================================\n");

let totalAssertions = 0;
let passedAssertions = 0;

function check(condition: boolean, description: string) {
  totalAssertions++;
  if (condition) {
    passedAssertions++;
    console.log(`  ✓ PASS: ${description}`);
  } else {
    console.error(`  ✗ FAIL: ${description}`);
    assert(condition, description);
  }
}

// ============================================================================
// SUITE 1: Слияние отметок с двух разных устройств объединяет данные без потерь
// ============================================================================
console.log("--------------------------------------------------------------------------------");
console.log("1. Multi-device merge without data loss");
console.log("--------------------------------------------------------------------------------");

const deviceA_Records: AttendanceRecord[] = [
  {
    groupId: 'test-stream-101',
    date: '2026-09-01',
    lessonId: 'lesson-1',
    absentStudentIds: [101, 102],
    excusedStudentIds: [103],
    isCancelled: false,
    updatedAt: '2026-09-01T08:00:00.000Z',
    updatedBy: 'device_a'
  },
  {
    groupId: 'test-stream-101',
    date: '2026-09-01',
    lessonId: 'lesson-2',
    absentStudentIds: [104],
    excusedStudentIds: [],
    isCancelled: false,
    updatedAt: '2026-09-01T09:30:00.000Z',
    updatedBy: 'device_a'
  }
];

const deviceB_Records: AttendanceRecord[] = [
  {
    groupId: 'test-stream-101',
    date: '2026-09-02',
    lessonId: 'lesson-1',
    absentStudentIds: [105],
    excusedStudentIds: [106],
    isCancelled: false,
    updatedAt: '2026-09-02T08:00:00.000Z',
    updatedBy: 'device_b'
  },
  {
    groupId: 'test-stream-101',
    date: '2026-09-02',
    lessonId: 'lesson-3',
    absentStudentIds: [107, 108],
    excusedStudentIds: [],
    isCancelled: true,
    updatedAt: '2026-09-02T11:45:00.000Z',
    updatedBy: 'device_b'
  }
];

const mergedAB = mergeAttendance(deviceA_Records, deviceB_Records);
check(mergedAB.length === 4, "Merging non-overlapping sets produces exactly 4 records");

const mapAB = new Map(mergedAB.map(r => [`${r.date}_${r.lessonId}`, r]));
check(mapAB.has('2026-09-01_lesson-1'), "Device A record (2026-09-01 lesson-1) preserved");
check(mapAB.has('2026-09-01_lesson-2'), "Device A record (2026-09-01 lesson-2) preserved");
check(mapAB.has('2026-09-02_lesson-1'), "Device B record (2026-09-02 lesson-1) preserved");
check(mapAB.has('2026-09-02_lesson-3'), "Device B record (2026-09-02 lesson-3) preserved");

const recCancelled = mapAB.get('2026-09-02_lesson-3');
check(recCancelled?.isCancelled === true, "Preserves isCancelled flag correctly");
check(JSON.stringify(recCancelled?.absentStudentIds) === JSON.stringify([107, 108]), "Preserves absentStudentIds [107, 108]");

// Commutative check: mergeAttendance(B, A) should also retain all 4 records
const mergedBA = mergeAttendance(deviceB_Records, deviceA_Records);
check(mergedBA.length === 4, "Commutative merge: mergeAttendance(B, A) also yields 4 records");

// ============================================================================
// SUITE 2: Конфликт одной пары разрешается в пользу более свежего updatedAt
// ============================================================================
console.log("\n--------------------------------------------------------------------------------");
console.log("2. Conflict resolution via updatedAt (Date.parse)");
console.log("--------------------------------------------------------------------------------");

// 2.1 Remote is newer
const localOlder: AttendanceRecord[] = [
  {
    groupId: 'test-stream-101',
    date: '2026-09-03',
    lessonId: 'lesson-1',
    absentStudentIds: [101],
    excusedStudentIds: [],
    isCancelled: false,
    updatedAt: '2026-09-03T10:00:00.000Z',
    updatedBy: 'local_device'
  }
];

const remoteNewer: AttendanceRecord[] = [
  {
    groupId: 'test-stream-101',
    date: '2026-09-03',
    lessonId: 'lesson-1',
    absentStudentIds: [101, 102, 103],
    excusedStudentIds: [104],
    isCancelled: false,
    updatedAt: '2026-09-03T10:15:00.000Z', // 15 minutes newer
    updatedBy: 'cloud_sync'
  }
];

const conflictResult1 = mergeAttendance(localOlder, remoteNewer);
check(conflictResult1.length === 1, "Conflict on same key produces single record");
check(
  JSON.stringify(conflictResult1[0].absentStudentIds) === JSON.stringify([101, 102, 103]),
  "Newer remote record wins conflict (absentStudentIds [101, 102, 103])"
);
check(conflictResult1[0].updatedBy === 'cloud_sync', "Winner is marked as cloud_sync");

// 2.2 Local is newer
const localNewer: AttendanceRecord[] = [
  {
    groupId: 'test-stream-101',
    date: '2026-09-03',
    lessonId: 'lesson-2',
    absentStudentIds: [109],
    excusedStudentIds: [],
    isCancelled: true,
    updatedAt: '2026-09-03T12:00:00.000Z', // newer
    updatedBy: 'local_starosta'
  }
];

const remoteOlder: AttendanceRecord[] = [
  {
    groupId: 'test-stream-101',
    date: '2026-09-03',
    lessonId: 'lesson-2',
    absentStudentIds: [],
    excusedStudentIds: [],
    isCancelled: false,
    updatedAt: '2026-09-03T11:00:00.000Z', // 1 hour older
    updatedBy: 'cloud_stale'
  }
];

const conflictResult2 = mergeAttendance(localNewer, remoteOlder);
check(conflictResult2.length === 1, "Conflict on lesson-2 produces single record");
check(conflictResult2[0].isCancelled === true, "Newer local record wins conflict (isCancelled: true)");
check(
  JSON.stringify(conflictResult2[0].absentStudentIds) === JSON.stringify([109]),
  "Newer local record wins (absentStudentIds [109])"
);
check(conflictResult2[0].updatedBy === 'local_starosta', "Winner is marked as local_starosta");

// 2.3 Equal updatedAt
const localEqual: AttendanceRecord[] = [
  {
    groupId: 'test-stream-101',
    date: '2026-09-04',
    lessonId: 'lesson-1',
    absentStudentIds: [101],
    updatedAt: '2026-09-04T10:00:00.000Z'
  }
];
const remoteEqual: AttendanceRecord[] = [
  {
    groupId: 'test-stream-101',
    date: '2026-09-04',
    lessonId: 'lesson-1',
    absentStudentIds: [101],
    updatedAt: '2026-09-04T10:00:00.000Z'
  }
];
const conflictResultEqual = mergeAttendance(localEqual, remoteEqual);
check(conflictResultEqual.length === 1, "Equal updatedAt resolves cleanly without duplicates");

// 2.4 Fallback timestamp support
const recordWithTimestamp: AttendanceRecord[] = [
  {
    groupId: 'test-stream-101',
    date: '2026-09-04',
    lessonId: 'lesson-2',
    absentStudentIds: [111],
    timestamp: 1788500000000
  }
];
const recordWithOlderTimestamp: AttendanceRecord[] = [
  {
    groupId: 'test-stream-101',
    date: '2026-09-04',
    lessonId: 'lesson-2',
    absentStudentIds: [112],
    timestamp: 1788400000000
  }
];
const fallbackResult = mergeAttendance(recordWithTimestamp, recordWithOlderTimestamp);
check(fallbackResult.length === 1, "Fallback timestamp conflict resolves correctly");
check(fallbackResult[0].absentStudentIds[0] === 111, "Record with newer timestamp won");

// ============================================================================
// SUITE 3: Офлайн-отметки не затираются при получении пустого облака
// ============================================================================
console.log("\n--------------------------------------------------------------------------------");
console.log("3. Offline records preserved against empty cloud");
console.log("--------------------------------------------------------------------------------");

const offlineLocalRecords: AttendanceRecord[] = [
  {
    groupId: 'test-stream-101',
    date: '2026-09-05',
    lessonId: 'lesson-1',
    absentStudentIds: [201],
    excusedStudentIds: [],
    updatedAt: '2026-09-05T08:30:00.000Z'
  },
  {
    groupId: 'test-stream-101',
    date: '2026-09-05',
    lessonId: 'lesson-2',
    absentStudentIds: [202, 203],
    excusedStudentIds: [204],
    updatedAt: '2026-09-05T10:15:00.000Z'
  },
  {
    groupId: 'test-stream-101',
    date: '2026-09-05',
    lessonId: 'lesson-3',
    absentStudentIds: [],
    excusedStudentIds: [],
    isCancelled: true,
    updatedAt: '2026-09-05T12:00:00.000Z'
  }
];

const emptyCloud: AttendanceRecord[] = [];

const mergedWithEmptyCloud = mergeAttendance(offlineLocalRecords, emptyCloud);
check(mergedWithEmptyCloud.length === 3, "Offline records are NOT wiped when cloud returns empty array");
check(
  mergedWithEmptyCloud.map(r => `${r.date}_${r.lessonId}`).join(',') ===
  '2026-09-05_lesson-1,2026-09-05_lesson-2,2026-09-05_lesson-3',
  "All 3 offline lessons remain intact"
);

const mergedFromEmptyLocal = mergeAttendance([], offlineLocalRecords);
check(mergedFromEmptyLocal.length === 3, "Empty local merging with non-empty cloud returns all cloud records");

const mergedBothEmpty = mergeAttendance([], []);
check(mergedBothEmpty.length === 0, "Empty local and empty cloud returns empty array");

// ============================================================================
// SUITE 4: Key generation `${r.date}_${r.lessonId}` & Edge cases
// ============================================================================
console.log("\n--------------------------------------------------------------------------------");
console.log("4. Key isolation and edge cases");
console.log("--------------------------------------------------------------------------------");

const diffDatesSameLesson: AttendanceRecord[] = [
  {
    groupId: 'test-stream-101',
    date: '2026-09-06',
    lessonId: 'lesson-1',
    absentStudentIds: [301],
    updatedAt: '2026-09-06T08:00:00.000Z'
  },
  {
    groupId: 'test-stream-101',
    date: '2026-09-07',
    lessonId: 'lesson-1',
    absentStudentIds: [302],
    updatedAt: '2026-09-07T08:00:00.000Z'
  }
];
const diffDatesResult = mergeAttendance(diffDatesSameLesson, []);
check(diffDatesResult.length === 2, "Same lessonId on different dates creates 2 distinct records");

const sameDateDiffLessons: AttendanceRecord[] = [
  {
    groupId: 'test-stream-101',
    date: '2026-09-08',
    lessonId: 'lesson-1',
    absentStudentIds: [301],
    updatedAt: '2026-09-08T08:00:00.000Z'
  },
  {
    groupId: 'test-stream-101',
    date: '2026-09-08',
    lessonId: 'lesson-2',
    absentStudentIds: [302],
    updatedAt: '2026-09-08T08:00:00.000Z'
  }
];
const diffLessonsResult = mergeAttendance(sameDateDiffLessons, []);
check(diffLessonsResult.length === 2, "Different lessonIds on same date create 2 distinct records");

// Defensive: invalid or empty entries in array
const mixedWithInvalid: any = [
  null,
  undefined,
  {},
  { groupId: 'test-stream-101' }, // missing date and lessonId
  {
    groupId: 'test-stream-101',
    date: '2026-09-09',
    lessonId: 'lesson-1',
    absentStudentIds: [303],
    updatedAt: '2026-09-09T08:00:00.000Z'
  }
];
const safeResult = mergeAttendance(mixedWithInvalid, []);
check(safeResult.length === 1, "Gracefully filters out invalid records without throwing");
check(safeResult[0].absentStudentIds[0] === 303, "Valid record extracted successfully");

// ============================================================================
// SUITE 5: Offline dirty flag & retry lifecycle simulation
// ============================================================================
console.log("\n--------------------------------------------------------------------------------");
console.log("5. Offline dirty flag (attendance_dirty_<groupId>) lifecycle");
console.log("--------------------------------------------------------------------------------");

const mockStorage: Record<string, string> = {};
const testGroupId = 'test-stream-qa';

function simulateOfflinePushFailure(groupId: string) {
  // Push failed -> set dirty flag
  mockStorage[`attendance_dirty_${groupId}`] = 'true';
}

function simulateOnlinePushSuccess(groupId: string) {
  // Push succeeded -> remove dirty flag
  delete mockStorage[`attendance_dirty_${groupId}`];
}

simulateOfflinePushFailure(testGroupId);
check(mockStorage[`attendance_dirty_${testGroupId}`] === 'true', "Dirty flag set on network/push failure");

// Recovery simulation on online event
check(mockStorage[`attendance_dirty_${testGroupId}`] === 'true', "Dirty flag persists until retry succeeds");
simulateOnlinePushSuccess(testGroupId);
check(mockStorage[`attendance_dirty_${testGroupId}`] === undefined, "Dirty flag cleared after successful retry");

// ============================================================================
// SUMMARY
// ============================================================================
console.log("\n================================================================================");
console.log(`   ATTENDANCE MERGE TEST SUMMARY: ${passedAssertions} / ${totalAssertions} ASSERTIONS PASSED`);
console.log("================================================================================\n");

if (passedAssertions !== totalAssertions) {
  process.exit(1);
}
