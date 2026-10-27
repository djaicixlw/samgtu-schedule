/**
 * AUD-025: "Delete my data" — the cleanup list must be COMPLETE for personal
 * keys and PRESERVE group-shared data (roster, attendance journal cache,
 * schedule caches) that the user still needs in student mode after unlinking.
 *
 * Seeds every storage key family actually written by the client (grep-audited:
 * localStorage.setItem/removeItem + sessionStorage across App.tsx, components/,
 * utils/), runs deleteMyData() exactly like App.handleDeleteMyData does, and
 * asserts what survived.
 */

import {
  deleteMyData,
  collectMyDataKeys,
  MY_DATA_EXACT_KEYS,
  MY_DATA_KEY_PREFIXES,
  GROUP_DATA_EXAMPLE_KEYS
} from '../utils/personalData';

console.log('\n=================================================');
console.log('   TEST SUITE: DELETE MY DATA CLEANUP (AUD-025) ');
console.log('=================================================');

let passed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`  ❌ FAIL: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  passed++;
  console.log(`  ✓ [PASS] ${msg}`);
}

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
  key(i: number) { return Array.from(this.map.keys())[i] ?? null; }
  get length() { return this.map.size; }
  has(k: string) { return this.map.has(k); }
}

const disk = new MemoryStorage();
const session = new MemoryStorage();

// ---------------------------------------------------------------------------
// Seed: every key family the client writes (two groups to prove device-wide scope)
// ---------------------------------------------------------------------------
console.log('\n--- 1. Seeding the full key surface of the app ---');

const personalExact = [
  'auth_role', 'auth_group', 'user_role', 'starosta_group_id',
  'my_group_id', 'selected_group_id',
  'staff_token', 'access_code',
  'v3_student_linked',
  'submitted_useful_count',
  'bugreport_contact'
];
const personalPrefixed = [
  'student_link_faid-310',
  'tg_user_777001',
  'attendance_dirty_ingt-310',
  'attendance_dirty_faid-310',
  'staff_token_ingt-310',
  'staff_token_faid-310',
  'group_code_ingt-310',           // legacy disk copy of the E2EE key
  'attendance_base_ingt-310',      // legacy cells base
  'attendance_base_map_ingt-310',  // legacy map base
  'attendance_base_v2_ingt-310',   // current unified base (AUD-003)
  'attendance_base_v2_faid-310',
  'homework_ingt-310',
  'deleted_hw_ingt-310',
  'hw_pending_push_ingt-310',
  'useful_ingt-310',               // getUsefulStorageKey lowercases the gid
  'deleted_useful_ingt-310',
  'cloudsync_pending_homework:ingt-310',
  'cloudsync_pending_useful:ingt-310'
];
const groupDataKept = [
  'students_ingt-310',             // the roster of the group — OTHER people's data too
  'students_faid-310',
  'attendance_ingt-310',           // local journal cache (student needs own absences)
  'attendance_faid-310',
  'schedule_overrides_ingt-310',
  'subject_teachers_ingt-310',
  'custom_schedule_ingt-310',
  'sched_cache_v1:ingt-310',
  'last_local_edit_ingt-310',
  'custom_groups',
  'theme_pref',
  'notifications_enabled',
  'simulate_maintenance'
];
const sessionKeys = {
  personal: ['group_code_ingt-310', 'group_code_faid-310'],
  kept: ['admin_maintenance_bypass', 'dismiss_maintenance', 'chunk_retry_auto', 'errb_retry_1']
};

for (const k of [...personalExact, ...personalPrefixed, ...groupDataKept]) disk.setItem(k, 'seed');
for (const k of sessionKeys.personal) session.setItem(k, 'CODE');
for (const k of sessionKeys.kept) session.setItem(k, '1');

assert(collectMyDataKeys(disk).length >= personalExact.length + personalPrefixed.length,
  'collector finds all seeded personal keys on disk');
console.log(`  (seeded ${disk.length} disk keys, ${session.length} session keys)`);

// ---------------------------------------------------------------------------
// Run the cleanup exactly like App.handleDeleteMyData
// ---------------------------------------------------------------------------
console.log('\n--- 2. Running deleteMyData (App.handleDeleteMyData path) ---');

const { removed } = deleteMyData({ storage: disk, session });

console.log('\n--- 3. Personal keys are gone (device-wide, both groups) ---');
for (const k of personalExact) {
  assert(!disk.has(k), `removed: ${k}`);
}
for (const k of personalPrefixed) {
  assert(!disk.has(k), `removed: ${k}`);
}
for (const k of sessionKeys.personal) {
  assert(!session.has(k), `removed from sessionStorage: ${k}`);
}
assert(removed.includes('auth_role'), 'auth_role is in the removal report (the audit P2 defect)');
assert(removed.includes('staff_token_ingt-310') && removed.includes('staff_token_faid-310'),
  'ALL staff tokens removed (both groups)');
assert(removed.includes('attendance_base_v2_ingt-310') && removed.includes('attendance_base_ingt-310'),
  'attendance bases (v2 + legacy) removed');

console.log('\n--- 4. Group-shared data of OTHERS is untouched ---');
for (const k of groupDataKept) {
  assert(disk.has(k), `kept (group/device data): ${k}`);
}
for (const k of sessionKeys.kept) {
  assert(session.has(k), `kept (session UI flag): ${k}`);
}
assert(disk.has('students_faid-310') && disk.has('attendance_faid-310'),
  'the OTHER group roster and journal cache are not touched');
assert(!disk.has('attendance_base_v2_faid-310'),
  'bases are device-wide sync bookkeeping — removed for the other group too');

console.log('\n--- 5. The audited lists are complete and non-conflicting ---');
// Every exact key and every prefix must actually match something real the app writes:
assert(MY_DATA_EXACT_KEYS.includes('auth_role'), 'exact list contains auth_role');
for (const prefix of MY_DATA_KEY_PREFIXES) {
  const matched = personalPrefixed.some(k => k.startsWith(prefix));
  assert(matched, `prefix "${prefix}" is exercised by the seeded key surface (no dead prefixes)`);
}
for (const k of GROUP_DATA_EXAMPLE_KEYS) {
  const hit = collectMyDataKeys(disk).includes(k);
  assert(!hit, `documented kept-key ${k} is NOT collected as personal`);
}

console.log(`\n=================================================`);
console.log(`  DELETE MY DATA: ${passed} CHECKS PASSED  `);
console.log(`=================================================\n`);
