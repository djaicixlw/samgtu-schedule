import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { Student, Registry } from './types';
import { fetchGroupCloudData, pushGroupCloudData } from './utils/cloudSync';
import { getSamaraISODate } from './utils/samaraDate';
import { SEED_ATTENDANCE } from './defaultData';

export const STUDENTS_REGISTRY: Registry<Student[]> = {
  'ingt-310': [
    { id: 1, name: "Березин Алексей Александрович" },
    { id: 2, name: "Бочарников Роман Владимирович" },
    { id: 3, name: "Васильев Тимур Икромжонович" },
    { id: 4, name: "Вырмаскин Иван Денисович" },
    { id: 5, name: "Данилов Никита Владимирович" },
    { id: 6, name: "Дьячков Илья Игоревич" },
    { id: 7, name: "Зеляев Александр Андреевич" },
    { id: 8, name: "Колотыркин Даниил Дмитриевич" },
    { id: 9, name: "Кондрашов Матвей Иванович" },
    { id: 10, name: "Малыгин Илья Алексеевич" },
    { id: 11, name: "Мантуров Егор Сергеевич" },
    { id: 12, name: "Мячин Владислав Дмитриевич" },
    { id: 13, name: "Поздняков Павел Евгеньевич" },
    { id: 14, name: "Савкин Александр Владимирович" },
    { id: 15, name: "Сычев Никита Дмитриевич" },
    { id: 16, name: "Ульмасова Алина Александровна" }
  ],
  'ingt-301': [
    { id: 1, name: "Александров Данила Игоревич" },
    { id: 2, name: "Белов Артем Сергеевич" },
    { id: 3, name: "Волков Максим Денисович" },
    { id: 4, name: "Григорьева Анна Дмитриевна" }
  ],
  'ingt-303': [
    { id: 1, name: "Кузнецов Михаил Андреевич" },
    { id: 2, name: "Морозов Дмитрий Сергеевич" },
    { id: 3, name: "Новикова Екатерина Павловна" },
    { id: 4, name: "Смирнов Арсений Романович" }
  ],
  'faid-310': [
    { id: 1, name: "Аверьянова Дарья" },
    { id: 2, name: "Антоненко Георгий" },
    { id: 3, name: "Баландина Валерия" },
    { id: 4, name: "Бурханова Виктория" },
    { id: 5, name: "Винк Полина" },
    { id: 6, name: "Внучкова Мария" },
    { id: 7, name: "Губарева Алёна" },
    { id: 8, name: "Зацепина Полина" },
    { id: 9, name: "Зубалова Мария" },
    { id: 10, name: "Иванов Никита" },
    { id: 11, name: "Кирина Варвара" },
    { id: 12, name: "Левина Валерия" },
    { id: 13, name: "Манасыпов Даниил" },
    { id: 14, name: "Петрова Полина" },
    { id: 15, name: "Пивоварова Дарья" },
    { id: 16, name: "Сафонова Виктория" },
    { id: 17, name: "Романова Дарья" },
    { id: 18, name: "Селиванова Юлия" },
    { id: 19, name: "Ушмаева Дарья" },
    { id: 20, name: "Хведчик Вера" },
    { id: 21, name: "Юрьева Ангелина" },
    { id: 22, name: "Яблонская Полина" }
  ],
  // Fallback aliases for existing storage
  'ingt-1': [
    { id: 1, name: "Александров Данила Игоревич" },
    { id: 2, name: "Белов Артем Сергеевич" },
    { id: 3, name: "Волков Максим Денисович" },
    { id: 4, name: "Григорьева Анна Дмитриевна" }
  ],
  'faid-110': [
    { id: 1, name: "Аверьянова Дарья" },
    { id: 2, name: "Антоненко Георгий" },
    { id: 3, name: "Баландина Валерия" },
    { id: 4, name: "Бурханова Виктория" },
    { id: 5, name: "Винк Полина" },
    { id: 6, name: "Внучкова Мария" },
    { id: 7, name: "Губарева Алёна" },
    { id: 8, name: "Зацепина Полина" },
    { id: 9, name: "Зубалова Мария" },
    { id: 10, name: "Иванов Никита" },
    { id: 11, name: "Кирина Варвара" },
    { id: 12, name: "Левина Валерия" },
    { id: 13, name: "Манасыпов Даниил" },
    { id: 14, name: "Петрова Полина" },
    { id: 15, name: "Пивоварова Дарья" },
    { id: 16, name: "Сафонова Виктория" },
    { id: 17, name: "Романова Дарья" },
    { id: 18, name: "Селиванова Юлия" },
    { id: 19, name: "Ушмаева Дарья" },
    { id: 20, name: "Хведчик Вера" },
    { id: 21, name: "Юрьева Ангелина" },
    { id: 22, name: "Яблонская Полина" }
  ],
  'htf-215': [
      {
          "id": 1,
          "name": "Абаджян Нарек Барсегович"
      },
      {
          "id": 2,
          "name": "Астафьева Анна Сергеевна"
      },
      {
          "id": 3,
          "name": "Богословская Анна Владимировна"
      },
      {
          "id": 4,
          "name": "Кривельская Анастасия Дмитриевна"
      },
      {
          "id": 5,
          "name": "Винокурова Татьяна Алексеевна"
      },
      {
          "id": 6,
          "name": "Герасименко Анастасия Андреевна"
      },
      {
          "id": 7,
          "name": "Давыдова Руслана Рустамовна"
      },
      {
          "id": 8,
          "name": "Должковая Дарья Григорьевна"
      },
      {
          "id": 9,
          "name": "Зарицкий Владимир Викторович"
      },
      {
          "id": 10,
          "name": "Козырева Полина Васильевна"
      },
      {
          "id": 11,
          "name": "Матрунич Ева Игоревна"
      },
      {
          "id": 12,
          "name": "Медведева Полина Сергеевна"
      },
      {
          "id": 13,
          "name": "Милованова Анастасия Евгеньевна"
      },
      {
          "id": 14,
          "name": "Митюль Анастасия Максимовна"
      },
      {
          "id": 15,
          "name": "Моисеева Анастасия Игоревна"
      },
      {
          "id": 16,
          "name": "Насирова Эвелина Баратовна"
      },
      {
          "id": 17,
          "name": "Плотников Егор Александрович"
      },
      {
          "id": 18,
          "name": "Пролейко Анастасия Максимовна"
      },
      {
          "id": 19,
          "name": "Ревина Злата Алексеевна"
      },
      {
          "id": 20,
          "name": "Росляков Ярослав Витальевич"
      },
      {
          "id": 21,
          "name": "Самсонова Елизавета Павловна"
      },
      {
          "id": 22,
          "name": "Самотохина Дарья"
      },
      {
          "id": 23,
          "name": "Сахабиев Максим Витальевич"
      },
      {
          "id": 24,
          "name": "Сехина Елизавета Владимировна"
      },
      {
          "id": 25,
          "name": "Сизякова Яна Сергеевна"
      },
      {
          "id": 26,
          "name": "Субботина Ангелина Максимовна"
      },
      {
          "id": 27,
          "name": "Силин Богдан Михайлович"
      },
      {
          "id": 28,
          "name": "Черныш Ирина Михайловна"
      },
      {
          "id": 29,
          "name": "Чуфистов Павел Георгиевич"
      },
      {
          "id": 30,
          "name": "Шатунов Тарас Константинович"
      },
      {
          "id": 31,
          "name": "Щербакова Вероника Сергеевна"
      }
  ],
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
        map.set(key, r);
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
      } else {
        if (getRecordTime(r) > getRecordTime(existing)) {
          map.set(key, r);
        }
      }
    }
  }

  return Array.from(map.values());
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
      const saved = localStorage.getItem(`attendance_${currentGroupId}`);
      const parsed: AttendanceRecord[] = saved ? JSON.parse(saved) : [];
      const sanitized = sanitizeGroupRecords(parsed, currentGroupId);
      if (sanitized.length !== parsed.length) {
        localStorage.setItem(`attendance_${currentGroupId}`, JSON.stringify(sanitized));
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
      const saved = localStorage.getItem(`attendance_${currentGroupId}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        const sanitized = sanitizeGroupRecords(parsed, currentGroupId);
        setRecords(sanitized);
        if (sanitized.length !== parsed.length) {
          localStorage.setItem(`attendance_${currentGroupId}`, JSON.stringify(sanitized));
        }
      }
    } catch (e) {}
  }, [currentGroupId, refreshTrigger]);

  // 2. Real-time Cloud Sync with REST & safe merge (Syncs across all classmates' devices)
  useEffect(() => {
    if (!currentGroupId) return;

    let isMounted = true;

    const getLocalRecords = (): AttendanceRecord[] => {
      let fromStorage: AttendanceRecord[] = [];
      try {
        const saved = localStorage.getItem(`attendance_${currentGroupId}`);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) fromStorage = sanitizeGroupRecords(parsed, currentGroupId);
        }
      } catch (e) {}
      const fromRef = recordsRef.current || [];
      if (fromStorage.length === 0) return fromRef;
      if (fromRef.length === 0) return fromStorage;
      return mergeAttendance(fromRef, fromStorage, currentGroupId);
    };

    const syncWithCloud = async () => {
      const isDirty = localStorage.getItem(`attendance_dirty_${currentGroupId}`) === 'true';
      const cloud = await fetchGroupCloudData(true, currentGroupId);
      if (!isMounted) return;

      const local = getLocalRecords();

      if (cloud && Array.isArray(cloud.attendance)) {
        const merged = mergeAttendance(local, cloud.attendance, currentGroupId);
        setRecords(merged);
        recordsRef.current = merged;
        try {
          localStorage.setItem(`attendance_${currentGroupId}`, JSON.stringify(merged));
        } catch (e) {}

        if (isDirty) {
          try {
            const ok = await pushGroupCloudData({ attendance: merged }, currentGroupId);
            if (ok && isMounted) {
              localStorage.removeItem(`attendance_dirty_${currentGroupId}`);
            }
          } catch (e) {}
        } else if (cloud.attendance.length === 0 && merged.length > 0) {
          // Auto-heal: cloud was wiped or empty, but local has records -> restore cloud!
          try {
            const ok = await pushGroupCloudData({ attendance: merged }, currentGroupId);
            if (!ok && isMounted) {
              localStorage.setItem(`attendance_dirty_${currentGroupId}`, 'true');
            }
          } catch (e) {
            if (isMounted) {
              localStorage.setItem(`attendance_dirty_${currentGroupId}`, 'true');
            }
          }
        }
      } else if (isDirty) {
        // Cloud fetch failed or offline, but we have unsynced changes -> retry push
        try {
          if (local.length > 0) {
            const ok = await pushGroupCloudData({ attendance: local }, currentGroupId);
            if (ok && isMounted) {
              localStorage.removeItem(`attendance_dirty_${currentGroupId}`);
            }
          }
        } catch (e) {}
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
  }>) => {
    if (!updates || updates.length === 0) return;
    const groupId = currentGroupId || 'ingt-310';

    // 1. Synchronously get current records from ref, state, or localStorage
    let baseList = recordsRef.current && recordsRef.current.length > 0 ? recordsRef.current : records;
    if (baseList.length === 0) {
      try {
        const saved = localStorage.getItem(`attendance_${groupId}`);
        if (saved) baseList = JSON.parse(saved);
      } catch (e) {}
    }

    // 2. Map keyed by date_lessonId for atomic in-memory update
    const map = new Map<string, AttendanceRecord>();
    baseList.forEach(r => map.set(`${r.date}_${r.lessonId}`, r));

    const createdRecords: AttendanceRecord[] = [];

    for (const update of updates) {
      const recordId = `${groupId}_${update.date}_${update.lessonId}`;
      const newRecord: AttendanceRecord = {
        docId: recordId,
        groupId,
        date: update.date,
        lessonId: update.lessonId,
        absentStudentIds: update.absentStudentIds,
        excusedStudentIds: update.excusedStudentIds || [],
        isCancelled: update.isCancelled ?? false,
        updatedAt: new Date().toISOString(),
        updatedBy: 'starosta_pin'
      };
      map.set(`${update.date}_${update.lessonId}`, newRecord);
      createdRecords.push(newRecord);
    }

    const updatedRecords = Array.from(map.values());

    // 3. Immediately update ref, React state, and LocalStorage
    recordsRef.current = updatedRecords;
    setRecords(updatedRecords);
    try {
      localStorage.setItem(`attendance_${groupId}`, JSON.stringify(updatedRecords));
    } catch (e) {}

    // 4. Push the GUARANTEED valid array to REST Cloud immediately (syncs to all classmates)
    try {
      const ok = await pushGroupCloudData({ attendance: updatedRecords }, groupId);
      if (!ok) {
        localStorage.setItem(`attendance_dirty_${groupId}`, 'true');
      } else {
        localStorage.removeItem(`attendance_dirty_${groupId}`);
      }
    } catch (e) {
      localStorage.setItem(`attendance_dirty_${groupId}`, 'true');
    }
  };

  const markAttendance = async (
    date: string, 
    lessonId: string, 
    absentStudentIds: number[], 
    excusedStudentIds: number[] = [], 
    isCancelled: boolean = false
  ) => {
    await markBatchAttendance([{
      date,
      lessonId,
      absentStudentIds,
      excusedStudentIds,
      isCancelled
    }]);

    toast.success(isCancelled ? 'Пара отмечена как отмененная' : 'Посещаемость сохранена');
  };

  const getAttendance = (date: string, lessonId: string): AttendanceRecord => {
    const list = recordsRef.current && recordsRef.current.length > 0 ? recordsRef.current : records;
    const record = list.find(r => r.date === date && r.lessonId === lessonId);
    return record || { groupId: currentGroupId || 'ingt-310', date, lessonId, absentStudentIds: [], excusedStudentIds: [], isCancelled: false };
  };

  return { records, markAttendance, markBatchAttendance, getAttendance };
};

export const BLOCKS = [
  { id: 1, name: "Блок 1 (31.08 - 20.09)", start: "2026-08-31", end: "2026-09-20" },
  { id: 2, name: "Блок 2 (21.09 - 20.10)", start: "2026-09-21", end: "2026-10-20" },
  { id: 3, name: "Блок 3 (21.10 - 20.11)", start: "2026-10-21", end: "2026-11-20" },
  { id: 4, name: "Блок 4 (21.11 - 31.12)", start: "2026-11-21", end: "2026-12-31" } // было 2026-12-25
];

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
 * If a student is in both absent and excused arrays, counts strictly once as excused (2 hours).
 */
export function calculateStudentAbsenceHours(records: AttendanceRecord[], studentId: number) {
  let totalAbs = 0;
  let totalExc = 0;
  const absencesByBlock = BLOCKS.map(() => 0);
  const excusedByBlock = BLOCKS.map(() => 0);

  records.forEach(record => {
    if (record.isCancelled) return;
    const isExcused = (record.excusedStudentIds || []).includes(studentId);
    const isAbsent = !isExcused && record.absentStudentIds.includes(studentId);

    if (isExcused) {
      totalExc += 2;
    } else if (isAbsent) {
      totalAbs += 2;
    }

    if (isAbsent || isExcused) {
      BLOCKS.forEach((block, index) => {
        if (record.date >= block.start && record.date <= block.end) {
          if (isExcused) excusedByBlock[index] += 2;
          else if (isAbsent) absencesByBlock[index] += 2;
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


