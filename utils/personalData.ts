/**
 * AUD-025: "Удалить мои данные" — the complete, single-source cleanup list.
 *
 * The old inline implementation in App.tsx only removed four key families
 * (student_link_*, tg_user_*, user_role*, attendance_dirty_*), leaving auth
 * markers (auth_role, auth_group, staff_token*), the group binding
 * (my_group_id / selected_group_id), sync bookkeeping (attendance_base_*),
 * homework/useful caches and the pending-push queues on the device.
 *
 * Scope policy (matches the user-facing dialog):
 *   - REMOVED: everything PERSONAL to this device/user — auth and role markers,
 *     the group binding, staff tokens, access codes, student link + TG identity,
 *     sync bookkeeping of this device (dirty flags, merge bases, pending-push
 *     queues), and local caches of the user-authored content (homework/useful).
 *     The cloud journal is untouched (client-side deletion only).
 *   - KEPT: group-shared content that other people also use and this user still
 *     needs as a student after unlinking — the roster (students_*), the local
 *     attendance journal cache (attendance_*, WITHOUT the base bookkeeping),
 *     schedule caches/overrides/teachers, custom groups, device preferences
 *     (theme, notifications) and session UI flags.
 *   - NOTE: telemetry keeps no persistent identifier (in-memory dedup only), so
 *     there is nothing to wipe there by design.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

/** Exact personal keys (no wildcard families). */
export const MY_DATA_EXACT_KEYS: readonly string[] = [
  'auth_role',            // role marker written on staff claim (App.tsx)
  'auth_group',           // group bound to the role
  'user_role',            // legacy/current role key
  'starosta_group_id',    // group the starosta role is bound to
  'my_group_id',          // student's group binding
  'selected_group_id',    // last selected group (derived from the binding)
  'staff_token',          // legacy staff token without gid suffix
  'access_code',          // LEGACY disk copy of the group access code (now sessionStorage)
  'v3_student_linked',    // blind-server v3 student link (gid+slot)
  'submitted_useful_count', // anti-spam timestamps of this user's suggestions
  'bugreport_contact'     // contact the user typed into the bug-report form
];

/** Personal key families. Every entry must be an intentional, audited prefix. */
export const MY_DATA_KEY_PREFIXES: readonly string[] = [
  'student_link_',        // legacy per-group student links
  'tg_user_',             // cached Telegram user identity
  'attendance_dirty_',    // unsynced-marks flags (double-confirmed in the dialog)
  'staff_token_',         // per-group staff tokens
  'group_code_',          // LEGACY disk copies of group access codes
  'attendance_base_',     // sync bases: legacy attendance_base_* AND attendance_base_v2_*
  'homework_',            // local homework cache (cloud copy remains authoritative)
  'deleted_hw_',          // local homework tombstones (server union keeps deletions)
  'hw_pending_push_',     // AUD-012 homework pending-push queue flags
  'useful_',              // local "useful" cache (useful_<gid>, lowercase gid)
  'deleted_useful_',      // local useful tombstones
  'cloudsync_pending_'    // AUD-023 engine pending-push queue flags (all entities)
];

/** Group-shared keys that MUST survive the cleanup (documented, asserted in tests). */
export const GROUP_DATA_EXAMPLE_KEYS: readonly string[] = [
  'students_ingt-310',
  'attendance_ingt-310',
  'schedule_overrides_ingt-310',
  'subject_teachers_ingt-310',
  'custom_schedule_ingt-310',
  'sched_cache_v1:ingt-310',
  'custom_groups',
  'theme_pref',
  'notifications_enabled',
  'last_local_edit_ingt-310'
];

function isMyDataKey(key: string): boolean {
  if (MY_DATA_EXACT_KEYS.includes(key)) return true;
  for (const prefix of MY_DATA_KEY_PREFIXES) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

/** Collects (without deleting) all personal keys currently present in a storage. */
export function collectMyDataKeys(storage: StorageLike): string[] {
  const found: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && isMyDataKey(key)) found.push(key);
    }
  } catch { /* storage unavailable */ }
  return found.sort();
}

export interface DeleteMyDataResult {
  removed: string[];
}

/**
 * Removes every personal key from the given storages (localStorage-like and,
 * optionally, sessionStorage-like). Never throws: a partially unavailable
 * storage degrades to "skip that storage".
 */
export function deleteMyData(opts?: {
  storage?: StorageLike | null;
  session?: StorageLike | null;
}): DeleteMyDataResult {
  const removed: string[] = [];
  const storages = [opts?.storage, opts?.session].filter(Boolean) as StorageLike[];
  for (const storage of storages) {
    for (const key of collectMyDataKeys(storage)) {
      try {
        storage.removeItem(key);
        removed.push(key);
      } catch { /* keep going: partial cleanup beats none */ }
    }
  }
  return { removed: removed.sort() };
}

/** Safe accessors for the ambient storages (SSR/tests tolerate their absence). */
export function local_storage(): StorageLike | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* ignore */ }
  return null;
}

export function session_storage(): StorageLike | null {
  try {
    if (typeof sessionStorage !== 'undefined') return sessionStorage;
  } catch { /* ignore */ }
  return null;
}
