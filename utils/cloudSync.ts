import { HomeworkItem, Lesson, Student } from '../types';
import { AttendanceRecord, STUDENTS_REGISTRY } from '../attendance';
import { SAMGTU_GROUP_MAP } from './samgtuGroupMap';
import { convertOfficialSamgtuToWeekData } from './samgtuParser';

export const WORKER_BASE = 'https://floral-union-26d1.alexeyberezin2.workers.dev';

// Primary sync through Cloudflare Worker proxy (100% CORS compliant, zero rate limits, reliable worldwide)
const ENDPOINTS = {
  schedule: `${WORKER_BASE}/sync/schedule`,
  homework: `${WORKER_BASE}/sync/homework`,
  attendance: `${WORKER_BASE}/sync/attendance`
};

export interface GroupCloudData {
  homework: HomeworkItem[];
  deletedIds?: string[];
  schedule?: any;
  scheduleOverrides: Record<string, Partial<Lesson>>;
  subjectTeachers: Record<string, string>;
  attendance: AttendanceRecord[];
  students?: Student[];
  lastUpdated?: number;
}

import { SEED_SCHEDULE_OVERRIDES, SEED_SUBJECT_TEACHERS, SEED_ATTENDANCE, SEED_HOMEWORK, getSeedSubjectTeachers } from '../defaultData';

// Module-level cache per group to prevent cross-group cache pollution (Senior Review 2.3)
const lastFetchedDataMap: Record<string, GroupCloudData> = {};
const lastFetchTimeMap: Record<string, number> = {};

// Sanitize teacher names: replace outdated generic "Кафедра ИНГТ" with verified professors
export const sanitizeTeachers = (teachers: Record<string, string>, groupId = 'ingt-310'): Record<string, string> => {
  if (!teachers || typeof teachers !== 'object') return {};
  const res: Record<string, string> = { ...teachers };
  const groupDefaults = getSeedSubjectTeachers(groupId);

  for (const [key, val] of Object.entries(res)) {
    if (val === 'Кафедра ИНГТ' || !val) {
      if (groupDefaults[key]) {
        res[key] = groupDefaults[key];
      } else if (key.includes('бурения') && groupId === 'ingt-310') {
        res[key] = 'Драницына Елена Геннадьевна';
      } else if (key.includes('сосудов') && groupId === 'ingt-310') {
        res[key] = 'Крючков Дмитрий Александрович';
      } else if (key.includes('Практико-ориентированный') && groupId === 'ingt-310') {
        res[key] = 'Колибасов Владимир Александрович';
      } else if (groupId === 'ingt-310') {
        res[key] = SEED_SUBJECT_TEACHERS[key] || '';
      }
    }
  }
  // Ensure practicals of patent study for INGT-310 are always Kolibasov V.A., not Parfenov K.V.
  if (groupId === 'ingt-310') {
    const patentPracticalsKey = 'Опытно-конструкторские работы и патентоведение в области нефтепромыслового оборудования::Практические занятия';
    if (!res[patentPracticalsKey] || res[patentPracticalsKey].includes('Парфенов') || res[patentPracticalsKey].includes('Кафедра')) {
      res[patentPracticalsKey] = 'Колибасов Владимир Александрович';
    }
  }

  // Ensure FAID-310 teachers are clean and not contaminated with INGT Sorokina
  if (groupId === 'faid-310' || groupId === 'faid-110') {
    if (res['Безопасность жизнедеятельности'] === 'Сорокина Людмила Владимировна') {
      res['Безопасность жизнедеятельности'] = 'Закирова Марина Николаевна';
    }
    if (res['Безопасность жизнедеятельности::Лекции'] === 'Сорокина Людмила Владимировна') {
      res['Безопасность жизнедеятельности::Лекции'] = 'Закирова Марина Николаевна';
    }
    if (res['Безопасность жизнедеятельности::Практические занятия'] === 'Сидоров Артем Александрович') {
      res['Безопасность жизнедеятельности::Практические занятия'] = 'Закирова Марина Николаевна';
    }
    if (res['Безопасность жизнедеятельности::Лабораторные работы'] === 'Кривова Маргарита Андреевна') {
      res['Безопасность жизнедеятельности::Лабораторные работы'] = 'Закирова Марина Николаевна';
    }
  }
  return res;
};

// Sanitize schedule overrides: clear outdated "Кафедра ИНГТ" overrides & ensure correct teachers
export const sanitizeOverrides = (overrides: Record<string, Partial<Lesson>>): Record<string, Partial<Lesson>> => {
  if (!overrides || typeof overrides !== 'object') return {};
  const res: Record<string, Partial<Lesson>> = {};
  const patentPracticalIds = ['310-w1-fr-4', '310-w2-mo-4', '310-w3-fr-4', '310-w4-mo-4'];
  for (const [id, ov] of Object.entries(overrides)) {
    if (!ov) continue;
    const clean = { ...ov };
    if (clean.teacher === 'Кафедра ИНГТ') {
      delete clean.teacher;
    }
    // Practicals of patent studies must be Kolibasov, not Parfenov
    if (patentPracticalIds.includes(id) && clean.teacher && clean.teacher.includes('Парфенов')) {
      clean.teacher = 'Колибасов Владимир Александрович';
    }
    res[id] = clean;
  }
  return res;
};

export const getLocalBackup = (groupId = 'ingt-310'): GroupCloudData => {
  try {
    const hw = localStorage.getItem(`homework_${groupId}`);
    const ov = localStorage.getItem(`schedule_overrides_${groupId}`);
    const st = localStorage.getItem(`subject_teachers_${groupId}`);
    const att = localStorage.getItem(`attendance_${groupId}`);

    const defaultHw = (hw === null && groupId === 'ingt-310') ? SEED_HOMEWORK : [];
    const defaultOv = (ov === null && groupId === 'ingt-310') ? SEED_SCHEDULE_OVERRIDES : {};
    const defaultSt = (st === null) ? getSeedSubjectTeachers(groupId) : {};
    const defaultAtt = (att === null && groupId === 'ingt-310') ? SEED_ATTENDANCE : [];

    const deletedHw: string[] = JSON.parse(localStorage.getItem(`deleted_hw_${groupId}`) || '[]');
    const deletedSet = new Set(deletedHw);

    const rawLocalHw: HomeworkItem[] = hw ? JSON.parse(hw) : [];
    // Strict isolation: only keep items belonging to this groupId
    const localHw = rawLocalHw.filter(it => it && (!it.groupId || it.groupId === groupId));
    const localOv = ov ? JSON.parse(ov) : {};
    const localSt = st ? JSON.parse(st) : {};
    const localAtt: AttendanceRecord[] = att ? JSON.parse(att) : [];
    const stu = localStorage.getItem(`students_${groupId}`);
    const localStu: Student[] = stu ? JSON.parse(stu) : (STUDENTS_REGISTRY[groupId] || []);

    const hwMap = new Map<string, HomeworkItem>();
    defaultHw.forEach(it => { if (it && it.id && !deletedSet.has(it.id)) hwMap.set(it.id, { ...it, groupId: it.groupId || groupId }); });
    localHw.forEach(it => { if (it && it.id && !deletedSet.has(it.id)) hwMap.set(it.id, { ...it, groupId: it.groupId || groupId }); });

    const attMap = new Map<string, AttendanceRecord>();
    defaultAtt.forEach(it => { if (it) attMap.set(it.docId || `${it.groupId || groupId}_${it.date}_${it.lessonId}`, { ...it, groupId: it.groupId || groupId }); });
    localAtt.forEach(it => { if (it) attMap.set(it.docId || `${it.groupId || groupId}_${it.date}_${it.lessonId}`, { ...it, groupId: it.groupId || groupId }); });

    return {
      homework: Array.from(hwMap.values()),
      scheduleOverrides: sanitizeOverrides({ ...defaultOv, ...localOv }),
      subjectTeachers: sanitizeTeachers({ ...defaultSt, ...localSt }, groupId),
      attendance: Array.from(attMap.values()),
      students: localStu,
      lastUpdated: 0
    };
  } catch (e) {
    let safeDeletedSet = new Set<string>();
    try {
      safeDeletedSet = new Set(JSON.parse(localStorage.getItem(`deleted_hw_${groupId}`) || '[]'));
    } catch {}
    let localStu: Student[] = [];
    try {
      const stu = localStorage.getItem(`students_${groupId}`);
      localStu = stu ? JSON.parse(stu) : (STUDENTS_REGISTRY[groupId] || []);
    } catch {}
    return {
      homework: groupId === 'ingt-310' ? SEED_HOMEWORK.filter(it => it && it.id && !safeDeletedSet.has(it.id)) : [],
      scheduleOverrides: groupId === 'ingt-310' ? sanitizeOverrides(SEED_SCHEDULE_OVERRIDES) : {},
      subjectTeachers: sanitizeTeachers(getSeedSubjectTeachers(groupId), groupId),
      attendance: groupId === 'ingt-310' ? SEED_ATTENDANCE : [],
      students: localStu,
      lastUpdated: 0
    };
  }
};

// Safe fetch with cache-busting and timeout
const fetchJson = async (url: string, timeoutMs = 6000, signal?: AbortSignal) => {
  if (signal?.aborted) return null;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (signal) {
    signal.addEventListener('abort', onExternalAbort, { once: true });
  }
  try {
    const isAttendance = url.includes('/sync/attendance');
    const initData = (typeof window !== 'undefined' && window.Telegram?.WebApp?.initData)
      || (typeof globalThis !== 'undefined' && (globalThis as any).Telegram?.WebApp?.initData)
      || '';

    const cacheBuster = url.includes('?') ? `&_t=${Date.now()}` : `?_t=${Date.now()}`;
    const res = await fetch(url + cacheBuster, {
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        ...(import.meta.env?.VITE_APP_SECRET ? { 'X-App-Key': import.meta.env.VITE_APP_SECRET } : {}),
        ...(isAttendance ? { 'X-Telegram-Init-Data': initData } : {})
      }
    });
    clearTimeout(id);
    if (!res.ok) return null;
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      if (json && json.error) {
        console.warn('Cloud API rate limit or error:', json.error);
        return null;
      }
      return json;
    } catch {
      // Non-JSON response (e.g. unrouted worker fallback)
      return null;
    }
  } catch (e) {
    clearTimeout(id);
    return null;
  } finally {
    clearTimeout(id);
    if (signal) {
      signal.removeEventListener('abort', onExternalAbort);
    }
  }
};

// Safe PUT with timeout
const putJson = async (url: string, body: any, timeoutMs = 7000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const isAttendance = url.includes('/sync/attendance');
    const initData = (typeof window !== 'undefined' && window.Telegram?.WebApp?.initData)
      || (typeof globalThis !== 'undefined' && (globalThis as any).Telegram?.WebApp?.initData)
      || '';

    const res = await fetch(url, {
      method: 'PUT',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(import.meta.env?.VITE_APP_SECRET ? { 'X-App-Key': import.meta.env.VITE_APP_SECRET } : {}),
        ...(initData ? { 'X-Telegram-Init-Data': initData } : {})
      },
      body: JSON.stringify(body)
    });
    clearTimeout(id);
    if (res.ok) {
      const text = await res.text();
      // If the response is the default text from an un-updated worker, consider it failed
      if (text.includes('Running OK') && !text.includes('status') && !text.includes('data')) {
        return false;
      }
      return true;
    }
    return false;
  } catch (e) {
    clearTimeout(id);
    return false;
  }
};

// Helper to unwrap atomic cloud payload
const parseCloudPayload = (raw: any): any => {
  if (!raw) return null;
  if (raw.payload && typeof raw.payload === 'string') {
    try {
      return JSON.parse(raw.payload);
    } catch (e) {
      return null;
    }
  }
  if (raw.data) {
    if (typeof raw.data === 'string') {
      try { return JSON.parse(raw.data); } catch (e) {}
    }
    return raw.data;
  }
  return raw;
};

export const fetchGroupCloudData = async (force: boolean = false, groupId = 'ingt-310', signal?: AbortSignal): Promise<GroupCloudData | null> => {
  if (signal?.aborted) return null;
  const now = Date.now();
  if (!force && lastFetchedDataMap[groupId] && now - (lastFetchTimeMap[groupId] || 0) < 4000) {
    return lastFetchedDataMap[groupId];
  }

  const localBackup = getLocalBackup(groupId);

  try {
    const gq = `groupId=${encodeURIComponent(groupId)}`;
    const [schedRes, hwRes, attRes] = await Promise.allSettled([
      fetchJson(`${ENDPOINTS.schedule}?${gq}`, 4000, signal),
      fetchJson(`${ENDPOINTS.homework}?${gq}`, 4000, signal),
      fetchJson(`${ENDPOINTS.attendance}?${gq}`, 4000, signal)
    ]);

    if (signal?.aborted) return null;

    let cloudScheduleOverrides: Record<string, Partial<Lesson>> = localBackup.scheduleOverrides || {};
    let cloudSubjectTeachers: Record<string, string> = localBackup.subjectTeachers || {};
    let serverTimestamp = (schedRes.status === 'fulfilled' && schedRes.value) || (hwRes.status === 'fulfilled' && hwRes.value) || (attRes.status === 'fulfilled' && attRes.value) ? now : 0;

    if (schedRes.status === 'fulfilled' && schedRes.value) {
      const d = parseCloudPayload(schedRes.value);
      if (d && typeof d === 'object') {
        serverTimestamp = d.updatedAt ? Number(d.updatedAt) : now;
        if (d.byGroup && d.byGroup[groupId]) {
          const gData = d.byGroup[groupId];
          if (gData.updatedAt) serverTimestamp = Number(gData.updatedAt);
          if (gData.overrides !== undefined) cloudScheduleOverrides = gData.overrides;
          if (gData.teachers !== undefined) cloudSubjectTeachers = gData.teachers;
        } else if (groupId === 'ingt-310') {
          if (d.overrides !== undefined) cloudScheduleOverrides = d.overrides;
          if (d.teachers !== undefined) cloudSubjectTeachers = d.teachers;
        } else {
          cloudScheduleOverrides = {};
          cloudSubjectTeachers = {};
        }

        // Sanitize out old generic "Кафедра ИНГТ"
        cloudScheduleOverrides = sanitizeOverrides(cloudScheduleOverrides);
        cloudSubjectTeachers = sanitizeTeachers(cloudSubjectTeachers, groupId);

        try { localStorage.setItem(`schedule_overrides_${groupId}`, JSON.stringify(cloudScheduleOverrides)); } catch (e) {}
        try { localStorage.setItem(`subject_teachers_${groupId}`, JSON.stringify(cloudSubjectTeachers)); } catch (e) {}
      }
    }

    let cloudHomework: HomeworkItem[] = localBackup.homework || [];
    let deletedSet = new Set<string>();
    try {
      deletedSet = new Set(JSON.parse(localStorage.getItem(`deleted_hw_${groupId}`) || '[]'));
    } catch (e) {}

    if (hwRes.status === 'fulfilled' && hwRes.value) {
      const d = parseCloudPayload(hwRes.value);
      if (d && typeof d === 'object') {
        let rawItems: any[] = [];
        let rawDeletedIds: any[] = [];

        if (d.byGroup && d.byGroup[groupId]) {
          rawItems = Array.isArray(d.byGroup[groupId].items) ? d.byGroup[groupId].items : [];
          rawDeletedIds = Array.isArray(d.byGroup[groupId].deletedIds) ? d.byGroup[groupId].deletedIds : [];
        } else if (Array.isArray(d.items)) {
          rawItems = d.items.filter((h: any) => (h.groupId || 'ingt-310') === groupId);
          rawDeletedIds = Array.isArray(d.deletedIds) ? d.deletedIds : [];
        }

        rawDeletedIds.forEach((id: any) => {
          if (id) deletedSet.add(String(id));
        });
        try {
          localStorage.setItem(`deleted_hw_${groupId}`, JSON.stringify(Array.from(deletedSet)));
        } catch (e) {}

        cloudHomework = rawItems
          .filter((h: any) => h && h.id && !deletedSet.has(String(h.id)))
          .map((h: any) => ({
            id: String(h.id),
            groupId: String(h.groupId || groupId),
            subject: String(h.subject || ''),
            title: String(h.title || ''),
            description: String(h.description || ''),
            assignedDate: String(h.assignedDate || ''),
            dueDate: String(h.dueDate || ''),
            attachments: Array.isArray(h.attachments) ? h.attachments : [],
            createdAt: String(h.createdAt || '')
          }))
          .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));

        // Protect local items: merge cloud homework with existing non-deleted local items so unsaved items are never wiped
        let existingLocal: HomeworkItem[] = [];
        try {
          const stored = localStorage.getItem(`homework_${groupId}`);
          if (stored) existingLocal = JSON.parse(stored);
        } catch (e) {}

        const itemMap = new Map<string, HomeworkItem>();
        cloudHomework.forEach(item => itemMap.set(item.id, item));
        existingLocal.forEach(item => {
          if (item && item.id && !deletedSet.has(item.id) && !itemMap.has(item.id)) {
            itemMap.set(item.id, item);
          }
        });
        const safeMergedHomework = Array.from(itemMap.values())
          .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
        cloudHomework = safeMergedHomework;

        try { localStorage.setItem(`homework_${groupId}`, JSON.stringify(safeMergedHomework)); } catch (e) {}
      }
    }

    let cloudAttendance: AttendanceRecord[] = localBackup.attendance || [];
    let cloudStudents: Student[] = localBackup.students || [];
    if (attRes.status === 'fulfilled' && attRes.value) {
      const d = parseCloudPayload(attRes.value);
      if (d && typeof d === 'object') {
        let rawRecords: any[] = [];
        if (d.byGroup && d.byGroup[groupId] && Array.isArray(d.byGroup[groupId].records)) {
          rawRecords = d.byGroup[groupId].records;
        } else if (Array.isArray(d.records)) {
          rawRecords = d.records.filter((a: any) => (a.groupId || 'ingt-310') === groupId);
        }

        cloudAttendance = rawRecords.map((a: any) => ({
          docId: String(a.docId || `${groupId}_${a.date}_${a.lessonId}`),
          groupId: String(a.groupId || groupId),
          date: String(a.date || ''),
          lessonId: String(a.lessonId || ''),
          absentStudentIds: Array.isArray(a.absentStudentIds) ? a.absentStudentIds : [],
          excusedStudentIds: Array.isArray(a.excusedStudentIds) ? a.excusedStudentIds : [],
          isCancelled: !!a.isCancelled,
          updatedAt: a.updatedAt,
          updatedBy: a.updatedBy
        }));
        try { localStorage.setItem(`attendance_${groupId}`, JSON.stringify(cloudAttendance)); } catch (e) {}

        if (d.byGroup && d.byGroup[groupId] && Array.isArray(d.byGroup[groupId].students)) {
          const rawStudents = d.byGroup[groupId].students;
          cloudStudents = rawStudents
            .map((s: any) => ({ id: Number(s.id), name: String(s.name || '').trim() }))
            .filter((s: Student) => s.id && s.name);
          try { localStorage.setItem(`students_${groupId}`, JSON.stringify(cloudStudents)); } catch (e) {}
        }
      }
    }

    const result: GroupCloudData = {
      homework: cloudHomework,
      deletedIds: Array.from(deletedSet),
      scheduleOverrides: cloudScheduleOverrides,
      subjectTeachers: cloudSubjectTeachers,
      attendance: cloudAttendance,
      students: cloudStudents,
      lastUpdated: serverTimestamp
    };

    lastFetchedDataMap[groupId] = result;
    lastFetchTimeMap[groupId] = now;
    return result;
  } catch (e) {
    if (signal?.aborted) return null;
    console.warn('Cloud sync parallel fetch error:', e);
    return lastFetchedDataMap[groupId] || localBackup;
  }
};

export const pushGroupCloudData = async (partialUpdate: Partial<GroupCloudData>, groupId = 'ingt-310'): Promise<boolean> => {
  const promises: Promise<boolean>[] = [];

  // 1. Schedule overrides / teachers push with multi-group preservation
  if (partialUpdate.scheduleOverrides !== undefined || partialUpdate.subjectTeachers !== undefined) {
    const local = getLocalBackup(groupId);
    const overrides = partialUpdate.scheduleOverrides !== undefined 
      ? sanitizeOverrides(partialUpdate.scheduleOverrides)
      : sanitizeOverrides({ ...(lastFetchedDataMap[groupId]?.scheduleOverrides || {}), ...(local.scheduleOverrides || {}) });
    const teachers = partialUpdate.subjectTeachers !== undefined 
      ? sanitizeTeachers(partialUpdate.subjectTeachers, groupId)
      : sanitizeTeachers({ ...(lastFetchedDataMap[groupId]?.subjectTeachers || {}), ...(local.subjectTeachers || {}) }, groupId);

    promises.push((async () => {
      return await putJson(`${ENDPOINTS.schedule}?groupId=${encodeURIComponent(groupId)}`, {
        byGroup: {
          [groupId]: {
            overrides,
            teachers,
            updatedAt: Date.now()
          }
        }
      });
    })());
  }

  // 2. Homework push with multi-group preservation (Senior 2.2 & User Report)
  if (partialUpdate.homework !== undefined) {
    let localDeleted: string[] = [];
    try {
      localDeleted = JSON.parse(localStorage.getItem(`deleted_hw_${groupId}`) || '[]');
    } catch (e) {}

    const passedDeleted = partialUpdate.deletedIds || [];
    const allDeleted = Array.from(new Set([...localDeleted, ...passedDeleted]));

    const normalizeType = (t?: string) => {
      if (!t) return 'file';
      if (t === 'link' || t.includes('link')) return 'link';
      if (t.includes('image')) return 'image';
      if (t.includes('pdf')) return 'pdf';
      if (t.includes('word') || t.includes('document') || t.includes('msword')) return 'doc';
      if (t.includes('sheet') || t.includes('excel')) return 'xls';
      return 'file';
    };

    const sanitizedHw = partialUpdate.homework.map(item => ({
      ...item,
      groupId: item.groupId || groupId,
      attachments: (item.attachments || []).map(att => {
        const cleanType = normalizeType(att.type);
        if (att.data && att.data.length > 75000) {
          return {
            name: att.name,
            type: cleanType,
            size: att.size,
            url: att.url || ''
          };
        }
        return {
          ...att,
          type: cleanType
        };
      })
    }));

    promises.push((async () => {
      const cleanItems = sanitizedHw.filter(it => !allDeleted.includes(it.id));
      return await putJson(`${ENDPOINTS.homework}?groupId=${encodeURIComponent(groupId)}`, {
        byGroup: {
          [groupId]: {
            items: cleanItems,
            deletedIds: allDeleted,
            updatedAt: Date.now()
          }
        }
      });
    })());
  }

  // 3. Attendance & Roster (Students) push with multi-group preservation
  if (partialUpdate.attendance !== undefined || partialUpdate.students !== undefined) {
    const updatedAtt = partialUpdate.attendance !== undefined 
      ? partialUpdate.attendance.map(r => ({ ...r, groupId: r.groupId || groupId }))
      : undefined;
    const updatedStudents = partialUpdate.students !== undefined
      ? partialUpdate.students
          .map(s => ({ id: Number(s.id), name: String(s.name || '').trim().slice(0, 100) }))
          .filter(s => s.id && s.name)
      : undefined;

    promises.push((async () => {
      const groupSlice: any = { updatedAt: Date.now() };
      if (updatedAtt !== undefined) groupSlice.records = updatedAtt;
      if (updatedStudents !== undefined) groupSlice.students = updatedStudents;
      return await putJson(`${ENDPOINTS.attendance}?groupId=${encodeURIComponent(groupId)}`, {
        byGroup: {
          [groupId]: groupSlice
        }
      });
    })());
  }

  if (promises.length === 0) return true;

  const results = await Promise.allSettled(promises);
  return results.every(r => r.status === 'fulfilled' && r.value === true);
};

/**
 * Fetches official SamGTU schedule via Cloudflare Worker proxy (CORS safe).
 */
export const fetchOfficialSamgtuSchedule = async (samgtuGroupId: number, weekNumber: number = 1): Promise<any> => {
  const url = `${WORKER_BASE}/samgtu-schedule?groupId=${samgtuGroupId}&week=${weekNumber}`;
  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        ...(import.meta.env?.VITE_APP_SECRET ? { 'X-App-Key': import.meta.env.VITE_APP_SECRET } : {})
      }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn('[cloudSync] Failed to fetch official SamGTU schedule:', e);
    return null;
  }
};

/**
 * Synchronizes full 4-week official schedule from SamGTU for a given group.
 * Saves to custom_schedule_${groupId} and v1 cache.
 */
export const syncOfficialGroupSchedule = async (
  groupId: string
): Promise<{ ok: boolean; message: string; weekData?: any }> => {
  const groupConf = SAMGTU_GROUP_MAP[groupId];
  if (!groupConf) {
    return { ok: false, message: `Группа ${groupId} не найдена в реестре СамГТУ` };
  }

  const rawWeeks: Record<number, any> = {};
  for (let w = 1; w <= 4; w++) {
    const data = await fetchOfficialSamgtuSchedule(groupConf.samgtuGroupId, w);
    if (!data || !data.wd) {
      return { ok: false, message: `Не удалось загрузить неделю ${w} с сервера СамГТУ. Проверьте сеть.` };
    }
    rawWeeks[w] = data;
  }

  const teachers = getLocalBackup(groupId).subjectTeachers || {};
  const { weekData, totalLessons } = convertOfficialSamgtuToWeekData(groupId, rawWeeks, teachers);

  if (totalLessons === 0) {
    return { ok: false, message: 'Официальный реестр СамГТУ вернул 0 занятий' };
  }

  try {
    localStorage.setItem(`custom_schedule_${groupId}`, JSON.stringify(weekData));
    localStorage.setItem(`sched_cache_v1:${groupId}`, JSON.stringify({ data: weekData, cachedAt: Date.now() }));
  } catch (e) {}

  return { ok: true, message: `Успешно загружено ${totalLessons} пар из СамГТУ на все 4 недели`, weekData };
};

