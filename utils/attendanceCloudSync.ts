import type { AttendanceRecord } from '../attendance';
import {
  pullAttendanceSnapshotFromV3,
  syncAttendanceRecordsToV3,
  rebaseAttendanceBaseFromServer
} from './attendanceStorage';
import { merge3, snapshotBase, BaseMap } from './attendanceMerge3';
import { safeSetItem } from './safeStorage';

/**
 * Cloud synchronisation of attendance, extracted from the React hook so it can be tested
 * against the real worker. Two bases exist on purpose:
 *   attendance_base_${gid}      cell-level base used to build push deltas (attendanceStorage.ts)
 *   attendance_base_map_${gid}  record-level base used by merge3 when pulling (this file)
 * Both must advance whenever this device's state is known to equal the server's.
 */

const attKey = (gid: string) => `attendance_${gid}`;
const dirtyKey = (gid: string) => `attendance_dirty_${gid}`;
const baseMapKey = (gid: string) => `attendance_base_map_${gid}`;

export interface PullMergePushResult {
  merged: AttendanceRecord[];
  /** True when the merge ran against fresh server data (the caller should refresh React state). */
  mergedWithRemote: boolean;
  pushed: boolean;
  authExpired: boolean;
}

/** After a tap push succeeded: the pushed snapshot is now what the server knows about this device. */
export function markSnapshotPushed(groupId: string, snapshot: AttendanceRecord[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(baseMapKey(groupId), JSON.stringify(snapshotBase(snapshot as any)));
    }
  } catch {}
}

export async function pullMergePush(
  groupId: string,
  local: AttendanceRecord[]
): Promise<PullMergePushResult> {
  const store = typeof localStorage !== 'undefined' ? localStorage : null;
  const snapshot = await pullAttendanceSnapshotFromV3(groupId);
  const dirty = store ? store.getItem(dirtyKey(groupId)) === 'true' : false;

  let merged = local;
  let mergedWithRemote = false;

  // Merge whenever the server was really read, including "this month is empty": an absent record
  // is information (someone removed the marks), not a missing answer.
  if (snapshot.fetchedMonths.length > 0) {
    let baseMap: BaseMap | null = null;
    try {
      const raw = store ? store.getItem(baseMapKey(groupId)) : null;
      if (raw) baseMap = JSON.parse(raw);
    } catch {}

    const res3 = merge3(local as any, baseMap, snapshot.records as any, new Set(snapshot.fetchedMonths));
    merged = res3.merged as AttendanceRecord[];
    mergedWithRemote = true;
    safeSetItem(attKey(groupId), JSON.stringify(merged), { component: 'attendanceCloudSync' });
    try {
      store?.setItem(baseMapKey(groupId), JSON.stringify(res3.base));
    } catch {}
    // The push base mirrors the server (not the merged state): pending local edits stay visible to the
    // next push as differences, and nothing this device has never uploaded is declared "synced".
    rebaseAttendanceBaseFromServer(groupId, snapshot.records, snapshot.fetchedMonths);
  }

  let pushed = false;
  let authExpired = false;
  if (dirty || (local.length > 0 && snapshot.records.length === 0)) {
    const pushRes = await syncAttendanceRecordsToV3(groupId, merged);
    if (pushRes && pushRes.ok) {
      store?.removeItem(dirtyKey(groupId));
      markSnapshotPushed(groupId, merged);
      pushed = true;
    } else if (pushRes && pushRes.status === 401) {
      authExpired = true;
    }
  }

  return { merged, mergedWithRemote, pushed, authExpired };
}
