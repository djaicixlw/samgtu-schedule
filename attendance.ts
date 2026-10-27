import { useState, useEffect, useRef } from 'react';
import { Student, Registry } from './types';
import { syncAttendanceRecordsToV3, pullAttendanceRecordsFromV3, getSavedStaffToken, rebaseAttendanceBase } from './utils/attendanceStorage';
import { merge3, snapshotBase, BaseMap } from './utils/attendanceMerge3';
import { pullMergePush, markSnapshotPushed } from './utils/attendanceCloudSync';
import { safeSetItem, safeGetItem, safeRemoveItem } from './utils/safeStorage';
import { getSamaraISODate } from './utils/samaraDate';
import { SEED_ATTENDANCE } from './defaultData';
import { isPhysicalEducationLesson, isPhysicalEducationLessonId } from './utils/scheduleLoader';

export { isPhysicalEducationLesson, isPhysicalEducationLessonId };

const createAnonymousStudents = (count: number): Student[] =>
  Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `Студент ${i + 1}` }));

export const STUDENTS_REGISTRY: Registry<Student[]> = {
  'ingt-310': createAnonymousStudents(16),
  'ingt-301': createAnonymousStudents(4),
  'ingt-303': createAnonymousStudents(4),
  'faid-310': createAnonymousStudents(22),
  // Fallback aliases for existing storage
  'ingt-1': createAnonymousStudents(4),
  'faid-110': [],
  'htf-215': createAnonymousStudents(31),
  '2-htf-115': [],
  'htf-115': [],
  '2-хтф-115': [],
  'ingt-209': [],
  '2-ingt-109': [],
  'ingt-109': []
};

STUDENTS_REGISTRY['2-htf-115'] = STUDENTS_REGISTRY['htf-215'];
STUDENTS_REGISTRY['htf-115'] = STUDENTS_REGISTRY['htf-215'];
STUDENTS_REGISTRY['2-хтф-115'] = STUDENTS_REGISTRY['htf-215'];
STUDENTS_REGISTRY['3-ингт-110'] = STUDENTS_REGISTRY['ingt-310'];
STUDENTS_REGISTRY['3-ingt-110'] = STUDENTS_REGISTRY['ingt-310'];
STUDENTS_REGISTRY['3-фаид-110'] = STUDENTS_REGISTRY['faid-310'];
STUDENTS_REGISTRY['3-faid-110'] = STUDENTS_REGISTRY['faid-310'];
STUDENTS_REGISTRY['faid-110'] = STUDENTS_REGISTRY['faid-310'];
STUDENTS_REGISTRY['ingt-311'] = [];
STUDENTS_REGISTRY['3-ингт-111'] = STUDENTS_REGISTRY['ingt-311'];
STUDENTS_REGISTRY['3-ingt-111'] = STUDENTS_REGISTRY['ingt-311'];

export interface AttendanceRecord {
  docId?: string;
  groupId: string;
  date: string; // YYYY-MM-DD
  lessonId: string;
  absentStudentIds: number[];
  excusedStudentIds?: number[];
  isCancelled?: boolean;
  hours?: number;
  timestamp?: number;
  updatedAt?: any;
  updatedBy?: string;
}

/**
 * Merges local and remote attendance records without data loss.
 * - Key: `${r.date}_${r.lessonId}`
 * - On key collision, the record with the later updatedAt (Date.parse(r.updatedAt)) wins.
 * - Records existing only locally or only in the cloud are never lost.
 */
export function mergeAttendance(
  local: AttendanceRecord[] = [],
  remote: AttendanceRecord[] = [],
  targetGroupId?: string
): AttendanceRecord[] {
  const map = new Map<string, AttendanceRecord>();

  // Lesson length is a property of the lesson, not of who marked it: never lose it when one side lacks it.
  const withHours = (winner: AttendanceRecord, other?: AttendanceRecord): AttendanceRecord =>
    (winner.hours === undefined && other && other.hours !== undefined) ? { ...winner, hours: other.hours } : winner;

  const getRecordTime = (r: AttendanceRecord): number => {
    if (r.updatedAt) {
      if (typeof r.updatedAt === 'number') return r.updatedAt;
      if (r.updatedAt instanceof Date) return r.updatedAt.getTime();
      const parsed = Date.parse(String(r.updatedAt));
      if (!isNaN(parsed)) return parsed;
    }
    if (r.timestamp && !isNaN(r.timestamp)) return r.timestamp;
    return 0;
  };

  const isMatchingGroup = (r: AttendanceRecord): boolean => {
    if (!targetGroupId) return true;
    if (r.groupId && r.groupId !== targetGroupId) return false;
    if (r.lessonId) {
      const canonicalTarget = targetGroupId.toLowerCase();
      const rawGid = canonicalTarget.replace('ingt-', '').replace('faid-', '');
      if (r.lessonId.startsWith('ingt-') || r.lessonId.startsWith('faid-') || /^\d{3}-/.test(r.lessonId)) {
        if (!r.lessonId.startsWith(canonicalTarget) && !r.lessonId.startsWith(rawGid)) {
          return false;
        }
      }
    }
    return true;
  };

  if (Array.isArray(local)) {
    for (const r of local) {
      if (!r || !r.date || !r.lessonId) continue;
      if (!isMatchingGroup(r)) continue;
      const key = `${r.date}_${r.lessonId}`;
      const existing = map.get(key);
      if (!existing || getRecordTime(r) > getRecordTime(existing)) {
        map.set(key, withHours(r, existing));
      }
    }
  }

  if (Array.isArray(remote)) {
    for (const r of remote) {
      if (!r || !r.date || !r.lessonId) continue;
      if (!isMatchingGroup(r)) continue;
      const key = `${r.date}_${r.lessonId}`;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, r);
      } else if (getRecordTime(r) > getRecordTime(existing)) {
        map.set(key, withHours(r, existing));
      } else {
        map.set(key, withHours(existing, r));
      }
    }
  }

  return Array.from(map.values());
}

/**
 * AUD-004: one attendance sync cycle (pull -> merge -> conditional push), extracted
 * from the hook so the timing defect is unit-testable.
 */
export async function syncAttendanceWithCloud(params: {
  groupId: string;
  getLocalRecords: () => AttendanceRecord[];
  pull: (gid: string, o?: { recentOnly?: boolean }) => Promise<AttendanceRecord[]>;
  push: (gid: string, records: AttendanceRecord[]) => Promise<{ ok: boolean; error?: string; status?: number }>;
  isDirty: () => boolean;
  onMerged: (merged: AttendanceRecord[]) => void;
  onPushedOk: () => void;
  recentOnly?: boolean;
}): Promise<{ merged: AttendanceRecord[]; pushed: boolean }> {
  const local = params.getLocalRecords();

  // 1. PULL latest attendance from Cloudflare Worker API v3
  const remote = await params.pull(params.groupId, { recentOnly: Boolean(params.recentOnly) });

  // AUD-004: re-read the local state AFTER the network wait - the user may have
  // marked absences while the pull was in flight.
  const freshLocal = params.getLocalRecords();
  const dirty = params.isDirty();

  let merged = freshLocal;
  if (remote && remote.length > 0) {
    let baseMap: any = null;
    try {
      const raw = safeGetItem(`attendance_base_map_${params.groupId}`);
      if (raw) baseMap = JSON.parse(raw);
    } catch {}

    const fetchedMonths = new Set<string>();
    remote.forEach(r => { if (r && r.date) fetchedMonths.add(r.date.slice(0, 7)); });

    const res3 = merge3(freshLocal, baseMap, remote, fetchedMonths);
    merged = res3.merged;
    params.onMerged(merged);
    safeSetItem(`attendance_${params.groupId}`, JSON.stringify(merged), { component: 'attendance' });
    try {
      safeSetItem(`attendance_base_map_${params.groupId}`, JSON.stringify(res3.base), { component: 'attendanceBase' });
    } catch {}
    if (!dirty) rebaseAttendanceBase(params.groupId, merged);
  }

  // 2. PUSH any local marks that may have been created or are marked dirty
  let pushed = false;
  if (dirty || (freshLocal.length > 0 && (!remote || remote.length === 0))) {
    const pushRes = await params.push(params.groupId, merged);
    if (pushRes && pushRes.ok) {
      params.onPushedOk();
      pushed = true;
    }
  }

  return { merged, pushed };
}

// Cloud pushes are debounced with an honest 2500ms trailing timer after the last tap:
// taps made while waiting collapse into one push of the latest snapshot.
const SYNC_DEBOUNCE_MS = 2500;
const pendingSyncByGroup = new Map<string, AttendanceRecord[]>();
const runningSyncGroups = new Set<string>();
const syncTimers = new Map<string, ReturnType<typeof setTimeout>>();

const runCoalescedSync = async (groupId: string): Promise<void> => {
  if (runningSyncGroups.has(groupId)) return;
  runningSyncGroups.add(groupId);
  try {
    while (pendingSyncByGroup.has(groupId)) {
      const snapshot = pendingSyncByGroup.get(groupId)!;
      pendingSyncByGroup.delete(groupId);
      try {
        const res = await syncAttendanceRecordsToV3(groupId, snapshot);
        if (res && res.ok) {
          markSnapshotPushed(groupId, snapshot);
          if (!pendingSyncByGroup.has(groupId)) safeRemoveItem(`attendance_dirty_${groupId}`);
        } else {
          safeSetItem(`attendance_dirty_${groupId}`, 'true', { component: 'attendance' });
          if ((res as any)?.status === 401 && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('samgtu:auth-expired'));
          }
        }
      } catch (e) {
        safeSetItem(`attendance_dirty_${groupId}`, 'true', { component: 'attendance' });
      }
    }
  } finally {
    runningSyncGroups.delete(groupId);
  }
};

export function scheduleSync(groupId: string): void {
  const existing = syncTimers.get(groupId);
  if (existing) clearTimeout(existing);
  syncTimers.set(groupId, setTimeout(() => {
    syncTimers.delete(groupId);
    void runCoalescedSync(groupId);
  }, SYNC_DEBOUNCE_MS));
}

export async function flushSyncNow(groupId?: string): Promise<void> {
  const targetGroups = groupId
    ? [groupId]
    : Array.from(new Set([...pendingSyncByGroup.keys(), ...syncTimers.keys(), ...runningSyncGroups]));
  for (const gid of targetGroups) {
    const timer = syncTimers.get(gid);
    if (timer) {
      clearTimeout(timer);
      syncTimers.delete(gid);
    }
  }
  for (const gid of targetGroups) {
    await runCoalescedSync(gid);
  }
}

if (typeof window !== 'undefined') {
  const flushAll = () => { void flushSyncNow(); };
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void flushSyncNow();
    }
  });
}

export const useAttendance = (isAuthenticated: boolean, currentGroupId: string | null, refreshTrigger: number = 0) => {
  const sanitizeGroupRecords = (recs: AttendanceRecord[], gid: string): AttendanceRecord[] => {
    if (!Array.isArray(recs)) return [];
    const canonicalTarget = gid.toLowerCase();
    const rawGid = canonicalTarget.replace('ingt-', '').replace('faid-', '');
    return recs.filter(r => {
      if (!r || !r.lessonId) return false;
      if (r.groupId && r.groupId !== gid) return false;
      if (r.lessonId.startsWith('ingt-') || r.lessonId.startsWith('faid-') || /^\d{3}-/.test(r.lessonId)) {
        if (!r.lessonId.startsWith(canonicalTarget) && !r.lessonId.startsWith(rawGid)) {
          return false;
        }
      }
      return true;
    });
  };

  const [records, setRecords] = useState<AttendanceRecord[]>(() => {
    const defaultList = currentGroupId === 'ingt-310' ? SEED_ATTENDANCE : [];
    if (!currentGroupId) return defaultList;
    try {
      const saved = safeGetItem(`attendance_${currentGroupId}`);
      const parsed: AttendanceRecord[] = saved ? JSON.parse(saved) : [];
      const sanitized = sanitizeGroupRecords(parsed, currentGroupId);
      if (sanitized.length !== parsed.length) {
        safeSetItem(`attendance_${currentGroupId}`, JSON.stringify(sanitized), { component: 'attendance' });
      }
      const map = new Map<string, AttendanceRecord>();
      defaultList.forEach(r => map.set(r.docId || `${r.groupId}_${r.date}_${r.lessonId}`, r));
      sanitized.forEach(r => map.set(r.docId || `${r.groupId}_${r.date}_${r.lessonId}`, r));
      return Array.from(map.values());
    } catch (e) {
      return defaultList;
    }
  });

  const recordsRef = useRef<AttendanceRecord[]>(records);
  useEffect(() => {
    recordsRef.current = records;
  }, [records]);

  // 1. Instant local storage load
  useEffect(() => {
    if (!currentGroupId) return;
    try {
      const saved = safeGetItem(`attendance_${currentGroupId}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        const sanitized = sanitizeGroupRecords(parsed, currentGroupId);
        setRecords(sanitized);
        if (sanitized.length !== parsed.length) {
          safeSetItem(`attendance_${currentGroupId}`, JSON.stringify(sanitized), { component: 'attendance' });
        }
      } else {
        setRecords([]);
      }
    } catch (e) {
      setRecords([]);
    }
  }, [currentGroupId, refreshTrigger]);

  // 2. Real-time Cloud Sync with REST & safe merge (Syncs across all classmates' devices)
  useEffect(() => {
    if (!currentGroupId) return;

    let isMounted = true;

    const getLocalRecords = (): AttendanceRecord[] => {
      let fromStorage: AttendanceRecord[] = [];
      try {
        const saved = safeGetItem(`attendance_${currentGroupId}`);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) fromStorage = sanitizeGroupRecords(parsed, currentGroupId);
        }
      } catch (e) {}
      const fromRef = (recordsRef.current || []).filter(r => r.groupId === currentGroupId);
      if (fromStorage.length === 0) return fromRef;
      if (fromRef.length === 0) return fromStorage;
      return mergeAttendance(fromRef, fromStorage, currentGroupId);
    };

    const syncWithCloud = async () => {
      const local = getLocalRecords();
      setRecords(local);
      recordsRef.current = local;

      // Staff auth check: do not query staff-only /v3/att for anonymous students
      const hasStaffAuth = isAuthenticated || Boolean(getSavedStaffToken(currentGroupId));
      if (!hasStaffAuth) {
        return;
      }

      try {
        // PULL -> three-way MERGE -> PUSH (utils/attendanceCloudSync.ts)
        const out = await pullMergePush(currentGroupId, local);
        if (!isMounted) return;

        if (out.mergedWithRemote) {
          setRecords(out.merged);
          recordsRef.current = out.merged;
        }
        if (out.authExpired && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('samgtu:auth-expired'));
        }
      } catch (e) {
        console.warn('Attendance cloud sync error:', e);
      }
    };

    const setupSubscription = async () => {
      await syncWithCloud();
    };

    setupSubscription();

    const handleVisibilityChange = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible' && isMounted) {
        await syncWithCloud();
      }
    };

    const handleOnline = async () => {
      if (isMounted) {
        await syncWithCloud();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('online', handleOnline);
    }

    return () => {
      isMounted = false;
      if (typeof window !== 'undefined') {
        window.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('online', handleOnline);
      }
    };
  }, [currentGroupId, refreshTrigger]);

  const markBatchAttendance = async (updates: Array<{
    date: string;
    lessonId: string;
    absentStudentIds: number[];
    excusedStudentIds?: number[];
    isCancelled?: boolean;
    hours?: number;
  }>) => {
    if (!updates || updates.length === 0) return;
    const groupId = currentGroupId || 'ingt-310';

    // 1. Synchronously get current records from ref, state, or localStorage
    let baseList = recordsRef.current && recordsRef.current.length > 0 ? recordsRef.current : records;
    if (baseList.length === 0) {
      try {
        const saved = safeGetItem(`attendance_${groupId}`);
        if (saved) baseList = JSON.parse(saved);
      } catch (e) {}
    }

    // 2. Map keyed by date_lessonId for atomic in-memory update
    const map = new Map<string, AttendanceRecord>();
    baseList.forEach(r => map.set(`${r.date}_${r.lessonId}`, r));

    const createdRecords: AttendanceRecord[] = [];

    for (const update of updates) {
      const recordId = `${groupId}_${update.date}_${update.lessonId}`;
      const existing = map.get(`${update.date}_${update.lessonId}`);
      const newRecord: AttendanceRecord = {
        docId: recordId,
        groupId,
        date: update.date,
        lessonId: update.lessonId,
        absentStudentIds: update.absentStudentIds,
        excusedStudentIds: update.excusedStudentIds || [],
        isCancelled: update.isCancelled ?? false,
        hours: update.hours || existing?.hours || 2,
        updatedAt: new Date().toISOString(),
        updatedBy: 'starosta_pin'
      };
      map.set(`${update.date}_${update.lessonId}`, newRecord);
      createdRecords.push(newRecord);
    }

    const updatedRecords = Array.from(map.values());

    // 3. Immediately update ref, React state, and SafeStorage
    recordsRef.current = updatedRecords;
    setRecords(updatedRecords);
    safeSetItem(`attendance_${groupId}`, JSON.stringify(updatedRecords), { component: 'attendance' });

    // 4. Mark dirty immediately (a pull must not overwrite unsent marks), then push debounced snapshots.
    safeSetItem(`attendance_dirty_${groupId}`, 'true', { component: 'attendance' });
    pendingSyncByGroup.set(groupId, updatedRecords);
    scheduleSync(groupId);
  };

  const markAttendance = async (
    date: string, 
    lessonId: string, 
    absentStudentIds: number[], 
    excusedStudentIds: number[] = [], 
    isCancelled: boolean = false,
    hours?: number,
    showToast?: boolean
  ) => {
    await markBatchAttendance([{
      date,
      lessonId,
      absentStudentIds,
      excusedStudentIds,
      isCancelled,
      hours: hours || 2
    }]);

    // No toast here on purpose: this is also called for background bookkeeping (cancelling a pair in the schedule,
    // editing a pair) and used to show "Посещаемость сохранена" there. Screens show their own message when needed.
  };

  const getAttendance = (date: string, lessonId: string): AttendanceRecord => {
    const list = recordsRef.current && recordsRef.current.length > 0 ? recordsRef.current : records;
    const record = list.find(r => r.date === date && r.lessonId === lessonId);
    return record || { groupId: currentGroupId || 'ingt-310', date, lessonId, absentStudentIds: [], excusedStudentIds: [], isCancelled: false };
  };

  return { records, markAttendance, markBatchAttendance, getAttendance };
};

export const BLOCKS = [
  { id: 1, name: "Блок 1 (31.08 - 27.09)", start: "2026-08-31", end: "2026-09-27" },
  { id: 2, name: "Блок 2 (28.09 - 25.10)", start: "2026-09-28", end: "2026-10-25" },
  { id: 3, name: "Блок 3 (26.10 - 22.11)", start: "2026-10-26", end: "2026-11-22" },
  { id: 4, name: "Блок 4 (23.11 - 31.12)", start: "2026-11-23", end: "2026-12-31" }
];

export const TIME_SLOTS: Record<string, { timeStart: string; timeEnd: string }> = {
  '1': { timeStart: '08:00', timeEnd: '09:35' },
  '2': { timeStart: '09:45', timeEnd: '11:20' },
  '3': { timeStart: '11:50', timeEnd: '13:25' },
  '4': { timeStart: '13:35', timeEnd: '15:10' },
  '5': { timeStart: '15:40', timeEnd: '17:15' },
  '6': { timeStart: '17:25', timeEnd: '19:00' },
};

export {
  getSamaraDate,
  getSamaraISODate,
  getSemesterWeek,
  getDayName,
  getDayCalendarDate,
  getWeekDateRange,
  getDayISODate,
  samaraISO
} from './utils/samaraDate';

export const getSamaraFutureISODate = (daysToAdd: number = 7): string => {
  const baseIso = getSamaraISODate();
  const [y, m, d] = baseIso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  date.setUTCDate(date.getUTCDate() + daysToAdd);
  const resY = date.getUTCFullYear();
  const resM = String(date.getUTCMonth() + 1).padStart(2, '0');
  const resD = String(date.getUTCDate()).padStart(2, '0');
  return `${resY}-${resM}-${resD}`;
};

/**
 * Calculates student absence hours with collision protection and priority of excused absences.
 * If a student is in both absent and excused arrays, counts strictly once as excused.
 * Supports configurable lesson hours (default 2h, or 4h for double lessons).
 */
export function calculateStudentAbsenceHours(
  records: AttendanceRecord[], 
  studentId: number,
  lessonOrResolver?: any
) {
  let totalAbs = 0;
  let totalExc = 0;
  const absencesByBlock = BLOCKS.map(() => 0);
  const excusedByBlock = BLOCKS.map(() => 0);

  records.forEach(record => {
    if (record.isCancelled) return;
    if (isPhysicalEducationLessonId(record.lessonId, record.groupId)) return;
    const isExcused = (record.excusedStudentIds || []).includes(studentId);
    const isAbsent = !isExcused && record.absentStudentIds.includes(studentId);
    const lesson = (record as any).lesson || (typeof lessonOrResolver === 'function' ? lessonOrResolver(record.lessonId) : lessonOrResolver?.[record.lessonId]);
    const lessonHours = lesson?.hours || record.hours || 2;

    if (isExcused) {
      totalExc += lessonHours;
    } else if (isAbsent) {
      totalAbs += lessonHours;
    }

    if (isAbsent || isExcused) {
      BLOCKS.forEach((block, index) => {
        if (record.date >= block.start && record.date <= block.end) {
          if (isExcused) excusedByBlock[index] += lessonHours;
          else if (isAbsent) absencesByBlock[index] += lessonHours;
        }
      });
    }
  });

  return {
    totalAbs,
    totalExc,
    totalHours: totalAbs + totalExc,
    absencesByBlock,
    excusedByBlock
  };
}

/**
 * Safe attendance percentage calculation with division by zero guard.
 */
export function calculateAttendancePercentage(absentHours: number, totalHours: number): number {
  return totalHours > 0 ? Math.round((absentHours / totalHours) * 100) : 0;
}


