import { safeSetItem, safeGetItem } from './safeStorage';
import type { BaseMap } from './attendanceMerge3';

export interface AttendanceBaseStore {
  v: number;
  baseMap: BaseMap;
  hours: Record<string, number>;
}

export function getBaseItem(key: string): string | null {
  return safeGetItem(key);
}

export function loadAttendanceBase(gid: string): AttendanceBaseStore {
  const key = `attendance_base_map_${String(gid || '').toLowerCase()}`;
  const raw = getBaseItem(key);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return { v: 2, baseMap: parsed.baseMap || parsed, hours: parsed.hours || {} };
      }
    } catch {}
  }
  return { v: 2, baseMap: {}, hours: {} };
}

export function saveAttendanceBase(gid: string, store: AttendanceBaseStore | BaseMap): void {
  const key = `attendance_base_map_${String(gid || '').toLowerCase()}`;
  const value = JSON.stringify(store);
  safeSetItem(key, value, { component: 'attendanceBase' });
}

export function updateBaseFromMerge(gid: string, baseMap: BaseMap, _mergedRecords?: any[]): void {
  const key = `attendance_base_map_${String(gid || '').toLowerCase()}`;
  const value = JSON.stringify(baseMap || {});
  safeSetItem(key, value, { component: 'attendanceBase' });
}
