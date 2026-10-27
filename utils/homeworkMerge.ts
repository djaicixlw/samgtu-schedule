/**
 * AUD-012: per-item homework merge with updatedAt arbitration.
 *
 * Defects being fixed:
 *   1. The old component merge treated cloud items as authoritative for the same id:
 *      an offline edit (whose push failed) was silently overwritten by the older
 *      cloud copy on the next load.
 *   2. Edits did not even stamp updatedAt, so no arbitration signal existed.
 *   3. A failed push only logged a console warning — the edit was never retried.
 *
 * Merge rules here:
 *   - deleted ids are filtered first (tombstones always win);
 *   - same id: the copy with the newer updatedAt wins; if the LOCAL copy is newer,
 *     hasLocalNewer=true so the caller re-pushes (auto-heal);
 *   - equal/missing timestamps: cloud wins (deterministic, matches old behavior);
 *   - disjoint ids are unioned.
 */

export interface HomeworkLike {
  id: string;
  groupId?: string;
  updatedAt?: number;
  createdAt?: string;
  [key: string]: any;
}

function itemTs(it: HomeworkLike | null | undefined): number {
  if (!it) return 0;
  if (typeof it.updatedAt === 'number' && Number.isFinite(it.updatedAt)) return it.updatedAt;
  if (it.createdAt) {
    const parsed = Date.parse(it.createdAt);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

export function mergeHomeworkItems<T extends HomeworkLike>(
  cloudItems: T[] | undefined,
  localItems: T[] | undefined,
  deletedSet: Set<string>,
  belongsToGroup: (it: T) => boolean
): { merged: T[]; hasLocalNewer: boolean } {
  const itemMap = new Map<string, T>();
  let hasLocalNewer = false;

  // 1. Cloud items first (authoritative when timestamps tie or are missing).
  for (const it of cloudItems || []) {
    if (it && it.id && !deletedSet.has(it.id) && belongsToGroup(it)) {
      itemMap.set(it.id, it);
    }
  }

  // 2. Local items: keep if absent from cloud (unsynced new item) or NEWER than the
  //    cloud copy (offline edit whose push had failed).
  for (const it of localItems || []) {
    if (!it || !it.id || deletedSet.has(it.id) || !belongsToGroup(it)) continue;
    const cloudCopy = itemMap.get(it.id);
    if (!cloudCopy) {
      itemMap.set(it.id, it);
      hasLocalNewer = true; // unsynced new item — caller should push
      continue;
    }
    if (itemTs(it) > itemTs(cloudCopy)) {
      itemMap.set(it.id, it);
      hasLocalNewer = true; // local edit is newer — auto-heal will re-push
    }
  }

  return { merged: Array.from(itemMap.values()), hasLocalNewer };
}
