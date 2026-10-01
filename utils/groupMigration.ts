import { getCanonicalGroupKey } from './samgtuParser';
import { mergeAttendance, AttendanceRecord } from '../attendance';

/**
 * Known legacy and alternate group ID mappings to canonical group IDs.
 */
export const LEGACY_GROUP_ALIASES: Record<string, string> = {
  // Explicit legacy short IDs from early prototype releases
  'ingt-1': 'ingt-301',
  'faid-110': 'faid-310',
  '24фад-110': 'faid-310',
  '24фаид-110': 'faid-310',
  '3-фаид-110': 'faid-310',
  '3-faid-110': 'faid-310',
  'ingt-109': 'ingt-209',
  '2-ingt-109': 'ingt-209',
  '2-ингт-109': 'ingt-209',
  'htf-115': 'htf-215',
  '2-htf-115': 'htf-215',
  '2-хтф-115': 'htf-215',
  '3-ингт-110': 'ingt-310',
  '3-ингт-101': 'ingt-301',
  '3-ингт-111': 'ingt-311',
  '3-ингт-113': 'ingt-313'
};

/**
 * Target prefixes for group-scoped localStorage keys that require migration.
 */
export const TARGET_PREFIXES = [
  'attendance_dirty_',
  'attendance_',
  'schedule_overrides_',
  'subject_teachers_',
  'custom_schedule_'
] as const;

/**
 * Resolves any raw or legacy group ID / alias to its canonical schedule group ID.
 * Returns the original string if it is already canonical or cannot be resolved.
 */
export function resolveCanonicalGroupId(rawId: string): string {
  if (!rawId || typeof rawId !== 'string') return rawId;
  const trimmed = rawId.trim();
  const lower = trimmed.toLowerCase();

  // 1. Direct match in explicit legacy alias map
  if (LEGACY_GROUP_ALIASES[lower]) {
    return LEGACY_GROUP_ALIASES[lower];
  }
  if (LEGACY_GROUP_ALIASES[trimmed]) {
    return LEGACY_GROUP_ALIASES[trimmed];
  }

  // 2. Transliteration and official SamGTU parsing (e.g. 3-ИНГТ-110 -> ingt-310)
  const parsed = getCanonicalGroupKey(trimmed);
  if (parsed && parsed !== 'custom-group') {
    if (LEGACY_GROUP_ALIASES[parsed.toLowerCase()]) {
      return LEGACY_GROUP_ALIASES[parsed.toLowerCase()];
    }
    return parsed;
  }

  return trimmed;
}

/**
 * Safe accessor for Web Storage API across browser and SSR / test environments.
 */
function resolveStorage(storageParam?: Storage): Storage | null {
  if (storageParam) return storageParam;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {}
  try {
    if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
      return (globalThis as any).localStorage;
    }
  } catch {}
  return null;
}

export interface MigrationSummary {
  migratedCount: number;
}

/**
 * Migrates legacy group keys in localStorage into uniform canonical format.
 *
 * Scans for group-bound prefixes:
 * - attendance_<oldId> -> attendance_<canonicalId>
 * - schedule_overrides_<oldId> -> schedule_overrides_<canonicalId>
 * - subject_teachers_<oldId> -> subject_teachers_<canonicalId>
 * - custom_schedule_<oldId> -> custom_schedule_<canonicalId>
 * - attendance_dirty_<oldId> -> attendance_dirty_<canonicalId>
 * - my_group_id (value replaced with canonical ID if legacy)
 *
 * Guarantees:
 * 1. Idempotency: Running multiple times results in 0 additional migrations and no data alteration.
 * 2. Non-destruction: If canonical key already exists, data is safely merged rather than overwritten.
 * 3. Atomic deletion: Legacy keys are removed only after successful transfer / merge into canonical key.
 * 4. Isolation: Unrelated keys (user preferences, roles, auth hashes) are untouched.
 */
export function migrateLegacyGroupKeys(storageParam?: Storage): MigrationSummary {
  const storage = resolveStorage(storageParam);
  if (!storage) {
    return { migratedCount: 0 };
  }

  let migratedCount = 0;

  // 1. Snapshot all keys first to prevent index shift during deletions
  const allKeys: string[] = [];
  try {
    if (typeof storage.length === 'number') {
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k !== null && k !== undefined) {
          allKeys.push(k);
        }
      }
    } else {
      allKeys.push(...Object.keys(storage));
    }
  } catch {
    try {
      allKeys.push(...Object.keys(storage));
    } catch {}
  }

  // 2. Check and migrate `my_group_id` value
  if (allKeys.includes('my_group_id')) {
    try {
      const currentVal = storage.getItem('my_group_id');
      if (currentVal) {
        const canonicalVal = resolveCanonicalGroupId(currentVal);
        if (canonicalVal && canonicalVal !== currentVal) {
          storage.setItem('my_group_id', canonicalVal);
          migratedCount++;
        }
      }
    } catch (e) {
      console.warn('[groupMigration] Failed to migrate my_group_id:', e);
    }
  }

  // Also check `selected_group_id` if present
  if (allKeys.includes('selected_group_id')) {
    try {
      const currentVal = storage.getItem('selected_group_id');
      if (currentVal) {
        const canonicalVal = resolveCanonicalGroupId(currentVal);
        if (canonicalVal && canonicalVal !== currentVal) {
          storage.setItem('selected_group_id', canonicalVal);
          migratedCount++;
        }
      }
    } catch (e) {
      console.warn('[groupMigration] Failed to migrate selected_group_id:', e);
    }
  }

  // 3. Migrate prefixed keys
  for (const key of allKeys) {
    let matchedPrefix: string | null = null;
    for (const prefix of TARGET_PREFIXES) {
      if (key.startsWith(prefix)) {
        matchedPrefix = prefix;
        break;
      }
    }

    if (!matchedPrefix) {
      // Unrelated key: ignore
      continue;
    }

    const oldGroupId = key.slice(matchedPrefix.length);
    if (!oldGroupId) continue;

    const canonicalGroupId = resolveCanonicalGroupId(oldGroupId);
    if (!canonicalGroupId || canonicalGroupId === oldGroupId) {
      // Already canonical or unresolvable
      continue;
    }

    const targetKey = `${matchedPrefix}${canonicalGroupId}`;
    const oldValue = storage.getItem(key);
    if (oldValue === null) continue;

    const targetValue = storage.getItem(targetKey);

    try {
      if (matchedPrefix === 'attendance_') {
        if (targetValue === null) {
          // Target does not exist yet: migrate records and update groupId
          try {
            const parsed = JSON.parse(oldValue);
            if (Array.isArray(parsed)) {
              const updated = parsed.map((record: AttendanceRecord) => {
                if (record && typeof record === 'object') {
                  return { ...record, groupId: canonicalGroupId };
                }
                return record;
              });
              storage.setItem(targetKey, JSON.stringify(updated));
            } else {
              storage.setItem(targetKey, oldValue);
            }
          } catch {
            storage.setItem(targetKey, oldValue);
          }
        } else {
          // Target already exists: merge safely without data loss
          try {
            const oldRecords = JSON.parse(oldValue);
            const targetRecords = JSON.parse(targetValue);
            if (Array.isArray(oldRecords) && Array.isArray(targetRecords)) {
              const merged = mergeAttendance(targetRecords, oldRecords);
              const updated = merged.map(r => ({ ...r, groupId: canonicalGroupId }));
              storage.setItem(targetKey, JSON.stringify(updated));
            } else if (!Array.isArray(targetRecords) && Array.isArray(oldRecords)) {
              const updated = oldRecords.map(r => ({ ...r, groupId: canonicalGroupId }));
              storage.setItem(targetKey, JSON.stringify(updated));
            }
          } catch {
            // Keep existing targetValue if parse error occurs
          }
        }
      } else if (matchedPrefix === 'schedule_overrides_') {
        if (targetValue === null) {
          storage.setItem(targetKey, oldValue);
        } else {
          try {
            const oldObj = JSON.parse(oldValue);
            const targetObj = JSON.parse(targetValue);
            if (
              oldObj && typeof oldObj === 'object' && !Array.isArray(oldObj) &&
              targetObj && typeof targetObj === 'object' && !Array.isArray(targetObj)
            ) {
              // Merge overrides: target takes precedence on collision, non-conflicting keys preserved
              const merged = { ...oldObj, ...targetObj };
              storage.setItem(targetKey, JSON.stringify(merged));
            }
          } catch {}
        }
      } else if (matchedPrefix === 'subject_teachers_') {
        if (targetValue === null) {
          storage.setItem(targetKey, oldValue);
        } else {
          try {
            const oldObj = JSON.parse(oldValue);
            const targetObj = JSON.parse(targetValue);
            if (
              oldObj && typeof oldObj === 'object' && !Array.isArray(oldObj) &&
              targetObj && typeof targetObj === 'object' && !Array.isArray(targetObj)
            ) {
              // Merge teachers: target takes precedence on collision, non-conflicting keys preserved
              const merged = { ...oldObj, ...targetObj };
              storage.setItem(targetKey, JSON.stringify(merged));
            }
          } catch {}
        }
      } else if (matchedPrefix === 'custom_schedule_') {
        if (targetValue === null) {
          storage.setItem(targetKey, oldValue);
        } else {
          try {
            const targetObj = JSON.parse(targetValue);
            if (!targetObj || (typeof targetObj === 'object' && Object.keys(targetObj).length === 0)) {
              storage.setItem(targetKey, oldValue);
            }
          } catch {
            storage.setItem(targetKey, oldValue);
          }
        }
      } else if (matchedPrefix === 'attendance_dirty_') {
        if (targetValue === null) {
          storage.setItem(targetKey, oldValue);
        } else {
          if (oldValue === 'true' || targetValue === 'true') {
            storage.setItem(targetKey, 'true');
          }
        }
      }

      // 4. Remove legacy key
      storage.removeItem(key);
      migratedCount++;
    } catch (e) {
      console.warn(`[groupMigration] Failed to migrate key ${key} to ${targetKey}:`, e);
    }
  }

  return { migratedCount };
}
