import assert from 'assert';
import {
  migrateLegacyGroupKeys,
  resolveCanonicalGroupId,
  LEGACY_GROUP_ALIASES
} from '../utils/groupMigration';
import { AttendanceRecord } from '../attendance';

/**
 * In-memory Mock Storage conforming to the Web Storage API (WindowLocalStorage).
 */
class MockStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    const keys = Array.from(this.store.keys());
    return index >= 0 && index < keys.length ? keys[index] : null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  // Helper for tests
  toObject(): Record<string, string> {
    const obj: Record<string, string> = {};
    for (const [k, v] of this.store.entries()) {
      obj[k] = v;
    }
    return obj;
  }
}

let passedAssertions = 0;
function check(description: string, condition: boolean, details?: string) {
  if (!condition) {
    console.error(`  FAIL: ${description}${details ? ' - ' + details : ''}`);
    assert(condition, `${description}: ${details || ''}`);
  }
  passedAssertions++;
  console.log(`  ✓ PASS: ${description}`);
}

console.log('='.repeat(80));
console.log('   TEST SUITE: IDEMPOTENT LEGACY GROUP MIGRATION (A4-T3)');
console.log('   Domain: Storage Migration & Backward Compatibility');
console.log('='.repeat(80));

// ============================================================================
// 1. Verification of resolveCanonicalGroupId
// ============================================================================
console.log('\n' + '-'.repeat(80));
console.log('1. Verification of resolveCanonicalGroupId mapping');
console.log('-'.repeat(80));

const testCases: Array<[string, string]> = [
  ['ingt-1', 'ingt-301'],
  ['faid-110', 'faid-310'],
  ['3-faid-110', 'faid-310'],
  ['3-фаид-110', 'faid-310'],
  ['24фаид-110', 'faid-310'],
  ['24фад-110', 'faid-310'],
  ['ingt-109', 'ingt-209'],
  ['2-ingt-109', 'ingt-209'],
  ['2-ингт-109', 'ingt-209'],
  ['htf-115', 'htf-215'],
  ['2-htf-115', 'htf-215'],
  ['2-хтф-115', 'htf-215'],
  ['3-ИНГТ-110', 'ingt-310'],
  ['3-ингт-110', 'ingt-310'],
  ['3-ИНГТ-101', 'ingt-301'],
  ['3-ингт-101', 'ingt-301'],
  ['3-ингт-113', 'ingt-313'],
  // Already canonical IDs must remain unchanged
  ['ingt-310', 'ingt-310'],
  ['ingt-301', 'ingt-301'],
  ['faid-310', 'faid-310'],
  ['htf-215', 'htf-215'],
  ['custom-project-group', 'custom-project-group']
];

for (const [raw, expected] of testCases) {
  const actual = resolveCanonicalGroupId(raw);
  check(`resolveCanonicalGroupId('${raw}') === '${expected}'`, actual === expected, `got '${actual}'`);
}

// ============================================================================
// 2. Migration of legacy group keys across all supported prefixes
// ============================================================================
console.log('\n' + '-'.repeat(80));
console.log('2. Migration of legacy keys across all supported prefixes');
console.log('-'.repeat(80));

const storage = new MockStorage();

// Synthetic mock attendance data using fictional student IDs (901, 902, 903)
const mockAttendanceIngt1: AttendanceRecord[] = [
  {
    groupId: 'ingt-1',
    date: '2026-09-01',
    lessonId: 'lesson-1',
    absentStudentIds: [901, 902],
    excusedStudentIds: [903],
    isCancelled: false,
    updatedAt: 1725177600000
  }
];

const mockOverridesFaid110 = {
  'slot-1': { location: 'Ауд. 210', teacher: 'Преподаватель И.И.' }
};

const mockTeachersHtf115 = {
  'Химия': 'Петров А.А.'
};

const mockCustomScheduleIngt109 = {
  1: [[{ subject: 'Геология' }]]
};

storage.setItem('attendance_ingt-1', JSON.stringify(mockAttendanceIngt1));
storage.setItem('schedule_overrides_faid-110', JSON.stringify(mockOverridesFaid110));
storage.setItem('subject_teachers_2-хтф-115', JSON.stringify(mockTeachersHtf115));
storage.setItem('custom_schedule_2-ингт-109', JSON.stringify(mockCustomScheduleIngt109));
storage.setItem('attendance_dirty_ingt-1', 'true');
storage.setItem('my_group_id', 'ingt-1');

const result1 = migrateLegacyGroupKeys(storage);

check('Migration result reports exactly 6 migrated keys', result1.migratedCount === 6, `got ${result1.migratedCount}`);

// Verify legacy keys are removed
check("Old key 'attendance_ingt-1' is deleted", storage.getItem('attendance_ingt-1') === null);
check("Old key 'schedule_overrides_faid-110' is deleted", storage.getItem('schedule_overrides_faid-110') === null);
check("Old key 'subject_teachers_2-хтф-115' is deleted", storage.getItem('subject_teachers_2-хтф-115') === null);
check("Old key 'custom_schedule_2-ингт-109' is deleted", storage.getItem('custom_schedule_2-ингт-109') === null);
check("Old key 'attendance_dirty_ingt-1' is deleted", storage.getItem('attendance_dirty_ingt-1') === null);

// Verify canonical keys are populated
check("Target key 'attendance_ingt-301' exists", storage.getItem('attendance_ingt-301') !== null);
check("Target key 'schedule_overrides_faid-310' exists", storage.getItem('schedule_overrides_faid-310') !== null);
check("Target key 'subject_teachers_htf-215' exists", storage.getItem('subject_teachers_htf-215') !== null);
check("Target key 'custom_schedule_ingt-209' exists", storage.getItem('custom_schedule_ingt-209') !== null);
check("Target key 'attendance_dirty_ingt-301' exists with 'true'", storage.getItem('attendance_dirty_ingt-301') === 'true');
check("my_group_id value migrated to 'ingt-301'", storage.getItem('my_group_id') === 'ingt-301');

// Verify attendance records inside canonical key have updated groupId
const migratedAttendance: AttendanceRecord[] = JSON.parse(storage.getItem('attendance_ingt-301')!);
check('Migrated attendance has 1 record', migratedAttendance.length === 1);
check("Record groupId updated to 'ingt-301'", migratedAttendance[0].groupId === 'ingt-301');
check('Record absentStudentIds [901, 902] preserved', JSON.stringify(migratedAttendance[0].absentStudentIds) === JSON.stringify([901, 902]));

// ============================================================================
// 3. Idempotency Verification
// ============================================================================
console.log('\n' + '-'.repeat(80));
console.log('3. Idempotency Verification (subsequent runs produce 0 migrations)');
console.log('-'.repeat(80));

const snapshotBefore = storage.toObject();
const result2 = migrateLegacyGroupKeys(storage);
const snapshotAfter = storage.toObject();

check('Second run reports 0 migrated keys', result2.migratedCount === 0, `got ${result2.migratedCount}`);
check('Storage snapshot is bit-for-bit identical after second run', JSON.stringify(snapshotBefore) === JSON.stringify(snapshotAfter));

const result3 = migrateLegacyGroupKeys(storage);
check('Third run also reports 0 migrated keys', result3.migratedCount === 0);

// ============================================================================
// 4. Preservation of Unrelated Keys
// ============================================================================
console.log('\n' + '-'.repeat(80));
console.log('4. Preservation of Unrelated Keys');
console.log('-'.repeat(80));

const storageUnrelated = new MockStorage();
storageUnrelated.setItem('user_role', 'starosta');
storageUnrelated.setItem('theme_pref', 'dark');
storageUnrelated.setItem('admin_pin_hash', 'hash_abc_123');
storageUnrelated.setItem('sched_cache_v1_ingt-310', JSON.stringify({ cachedAt: 12345678 }));
storageUnrelated.setItem('attendance_ingt-310', JSON.stringify([{ groupId: 'ingt-310', date: '2026-09-01', lessonId: 'l1' }]));

const resultUnrelated = migrateLegacyGroupKeys(storageUnrelated);

check('Zero migrations for storage with already-canonical and unrelated keys', resultUnrelated.migratedCount === 0);
check("user_role 'starosta' untouched", storageUnrelated.getItem('user_role') === 'starosta');
check("theme_pref 'dark' untouched", storageUnrelated.getItem('theme_pref') === 'dark');
check("admin_pin_hash untouched", storageUnrelated.getItem('admin_pin_hash') === 'hash_abc_123');
check('sched_cache_v1_ingt-310 untouched', storageUnrelated.getItem('sched_cache_v1_ingt-310') !== null);
check('attendance_ingt-310 untouched', storageUnrelated.getItem('attendance_ingt-310') !== null);

// ============================================================================
// 5. Target Key Conflict Collision & Safe Merging (No Data Loss)
// ============================================================================
console.log('\n' + '-'.repeat(80));
console.log('5. Target Key Conflict Collision & Safe Merging without Data Loss');
console.log('-'.repeat(80));

const storageConflict = new MockStorage();

// Scenario A: Existing canonical attendance has lesson-1, legacy attendance has lesson-2
const existingCanonicalAttendance: AttendanceRecord[] = [
  {
    groupId: 'ingt-301',
    date: '2026-09-01',
    lessonId: 'lesson-1',
    absentStudentIds: [910],
    excusedStudentIds: [],
    isCancelled: false,
    updatedAt: 1000
  }
];

const legacyAttendanceIngt1: AttendanceRecord[] = [
  {
    groupId: 'ingt-1',
    date: '2026-09-02',
    lessonId: 'lesson-2',
    absentStudentIds: [911, 912],
    excusedStudentIds: [913],
    isCancelled: true,
    updatedAt: 2000
  }
];

storageConflict.setItem('attendance_ingt-301', JSON.stringify(existingCanonicalAttendance));
storageConflict.setItem('attendance_ingt-1', JSON.stringify(legacyAttendanceIngt1));

// Scenario B: Overrides collision (target has slot-1, legacy has slot-2)
storageConflict.setItem(
  'schedule_overrides_faid-310',
  JSON.stringify({ 'slot-1': { location: 'Target Room 101' } })
);
storageConflict.setItem(
  'schedule_overrides_faid-110',
  JSON.stringify({ 'slot-2': { location: 'Legacy Room 202' } })
);

// Scenario C: Subject teachers collision (target has Math, legacy has Physics)
storageConflict.setItem(
  'subject_teachers_htf-215',
  JSON.stringify({ 'Высшая математика': 'Преподаватель А' })
);
storageConflict.setItem(
  'subject_teachers_2-хтф-115',
  JSON.stringify({ 'Общая физика': 'Преподаватель Б' })
);

const conflictResult = migrateLegacyGroupKeys(storageConflict);

check('Migrated 3 colliding legacy keys', conflictResult.migratedCount === 3);

// Verify merged attendance
const mergedAttendance: AttendanceRecord[] = JSON.parse(storageConflict.getItem('attendance_ingt-301')!);
check('attendance_ingt-301 contains BOTH records (total 2)', mergedAttendance.length === 2);
check('Lesson 1 from canonical target is preserved', mergedAttendance.some(r => r.lessonId === 'lesson-1' && r.absentStudentIds.includes(910)));
check('Lesson 2 from legacy is merged without loss', mergedAttendance.some(r => r.lessonId === 'lesson-2' && r.absentStudentIds.includes(911)));
check('Both records have groupId == ingt-301', mergedAttendance.every(r => r.groupId === 'ingt-301'));
check("Legacy key 'attendance_ingt-1' removed", storageConflict.getItem('attendance_ingt-1') === null);

// Verify merged overrides
const mergedOverrides = JSON.parse(storageConflict.getItem('schedule_overrides_faid-310')!);
check('schedule_overrides_faid-310 contains slot-1 from target', mergedOverrides['slot-1']?.location === 'Target Room 101');
check('schedule_overrides_faid-310 contains slot-2 from legacy', mergedOverrides['slot-2']?.location === 'Legacy Room 202');
check("Legacy key 'schedule_overrides_faid-110' removed", storageConflict.getItem('schedule_overrides_faid-110') === null);

// Verify merged teachers
const mergedTeachers = JSON.parse(storageConflict.getItem('subject_teachers_htf-215')!);
check('subject_teachers_htf-215 contains Math from target', mergedTeachers['Высшая математика'] === 'Преподаватель А');
check('subject_teachers_htf-215 contains Physics from legacy', mergedTeachers['Общая физика'] === 'Преподаватель Б');
check("Legacy key 'subject_teachers_2-хтф-115' removed", storageConflict.getItem('subject_teachers_2-хтф-115') === null);

// ============================================================================
// 6. Conflict on Identical Lesson (LWW - Last Write Wins via updatedAt)
// ============================================================================
console.log('\n' + '-'.repeat(80));
console.log('6. Attendance Conflict on Same Lesson Key (LWW via updatedAt)');
console.log('-'.repeat(80));

const storageLWW = new MockStorage();

const olderTargetRecord: AttendanceRecord = {
  groupId: 'ingt-301',
  date: '2026-09-01',
  lessonId: 'lesson-1',
  absentStudentIds: [920],
  updatedAt: 1000
};

const newerLegacyRecord: AttendanceRecord = {
  groupId: 'ingt-1',
  date: '2026-09-01',
  lessonId: 'lesson-1',
  absentStudentIds: [921, 922],
  updatedAt: 2000
};

storageLWW.setItem('attendance_ingt-301', JSON.stringify([olderTargetRecord]));
storageLWW.setItem('attendance_ingt-1', JSON.stringify([newerLegacyRecord]));

migrateLegacyGroupKeys(storageLWW);

const lwwResult: AttendanceRecord[] = JSON.parse(storageLWW.getItem('attendance_ingt-301')!);
check('Resolved to single record for date_lessonId', lwwResult.length === 1);
check('Newer legacy record won the conflict (absentStudentIds [921, 922])', JSON.stringify(lwwResult[0].absentStudentIds) === JSON.stringify([921, 922]));
check('Record groupId is canonical ingt-301', lwwResult[0].groupId === 'ingt-301');

// ============================================================================
// 7. Multiple Legacy Aliases Converging to Same Canonical Key
// ============================================================================
console.log('\n' + '-'.repeat(80));
console.log('7. Multiple Legacy Aliases Converging to Same Canonical Key');
console.log('-'.repeat(80));

const storageConverge = new MockStorage();

const rec1: AttendanceRecord = {
  groupId: 'ingt-1',
  date: '2026-09-01',
  lessonId: 'l1',
  absentStudentIds: [931],
  updatedAt: 100
};
const rec2: AttendanceRecord = {
  groupId: '3-ингт-101',
  date: '2026-09-02',
  lessonId: 'l2',
  absentStudentIds: [932],
  updatedAt: 200
};

storageConverge.setItem('attendance_ingt-1', JSON.stringify([rec1]));
storageConverge.setItem('attendance_3-ингт-101', JSON.stringify([rec2]));

const convergeResult = migrateLegacyGroupKeys(storageConverge);
check('Migrated both converging legacy keys', convergeResult.migratedCount === 2);

const convergedRecords: AttendanceRecord[] = JSON.parse(storageConverge.getItem('attendance_ingt-301')!);
check('Target key contains both records merged', convergedRecords.length === 2);
check('l1 preserved', convergedRecords.some(r => r.lessonId === 'l1' && r.absentStudentIds.includes(931)));
check('l2 preserved', convergedRecords.some(r => r.lessonId === 'l2' && r.absentStudentIds.includes(932)));
check("Old key 'attendance_ingt-1' removed", storageConverge.getItem('attendance_ingt-1') === null);
check("Old key 'attendance_3-ингт-101' removed", storageConverge.getItem('attendance_3-ингт-101') === null);

// ============================================================================
// 8. Global fallback and SSR / Empty Storage
// ============================================================================
console.log('\n' + '-'.repeat(80));
console.log('8. Global fallback and SSR / Empty Storage');
console.log('-'.repeat(80));

// Test with globalThis.localStorage
const mockGlobalStorage = new MockStorage();
mockGlobalStorage.setItem('my_group_id', 'faid-110');
(globalThis as any).localStorage = mockGlobalStorage;

const globalResult = migrateLegacyGroupKeys(); // no param
check('migrateLegacyGroupKeys() without args picks up globalThis.localStorage', globalResult.migratedCount === 1);
check("Global my_group_id updated to 'faid-310'", mockGlobalStorage.getItem('my_group_id') === 'faid-310');

// Test with empty storage
const emptyStorage = new MockStorage();
const emptyResult = migrateLegacyGroupKeys(emptyStorage);
check('Empty storage yields 0 migrations', emptyResult.migratedCount === 0);

console.log('\n' + '='.repeat(80));
console.log(`   GROUP MIGRATION TEST SUMMARY: ${passedAssertions} / ${passedAssertions} ASSERTIONS PASSED`);
console.log('='.repeat(80) + '\n');
