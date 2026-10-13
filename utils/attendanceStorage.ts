import { Student } from '../types';
import type { AttendanceRecord } from '../attendance';
import { normalizeGroupId } from './groupAliases';
import { getSemesterWeek, getDayName } from './samaraDate';
import { SCHEDULE_REGISTRY } from '../constants';

const DEFAULT_PROD_WORKER_URL = 'https://floral-union-26d1.aghaskdbbb.workers.dev';

const getDefaultWorkerBase = (): string => {
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_WORKER_URL) {
    return (import.meta as any).env.VITE_WORKER_URL;
  }
  if (typeof process !== 'undefined' && process.env?.VITE_WORKER_URL) {
    return process.env.VITE_WORKER_URL;
  }
  return DEFAULT_PROD_WORKER_URL;
};

export const WORKER_BASE = getDefaultWorkerBase();
export const CROCKFORD_BASE32_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

let customApiBaseUrl: string | null = null;

export function setAttendanceApiBase(url: string | null): void {
  customApiBaseUrl = url;
}

export function getAttendanceApiBase(): string {
  if (customApiBaseUrl) return customApiBaseUrl;
  if (WORKER_BASE) return WORKER_BASE;
  if (typeof window === 'undefined') {
    return 'https://worker.test';
  }
  return '';
}

export interface StudentInvite {
  studentId: number;
  slot: string;
  code: string;
  hash: string;
}

export interface RosterBackup {
  version: 3;
  groupId: string;
  exportedAt: string;
  students: Student[];
}

export interface MonthAttendanceV3 {
  ver: number;
  slots: Record<string, Record<string, 'e' | 'u'>>;
  cancelled: string[];
}

/**
 * Generate a random 8-character Crockford Base32 slot identifier (e.g. "A7K2Q9X1").
 * Uses alphabet: 0123456789ABCDEFGHJKMNPQRSTVWXYZ.
 */
export function generateSlotId(): string {
  const chars = CROCKFORD_BASE32_ALPHABET;
  let result = '';
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < 8; i++) {
      result += chars[bytes[i] % chars.length];
    }
  } else {
    for (let i = 0; i < 8; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
  }
  return result;
}

/**
 * Generate a 10-character Crockford Base32 invite code formatted with hyphen (e.g. "K7P2-9XQM4T").
 */
export function generateInviteCode(): string {
  const chars = CROCKFORD_BASE32_ALPHABET;
  let raw = '';
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < 10; i++) {
      raw += chars[bytes[i] % chars.length];
    }
  } else {
    for (let i = 0; i < 10; i++) {
      raw += chars[Math.floor(Math.random() * chars.length)];
    }
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/**
 * Compute SHA-256 hash in lowercase hex from normalized invite code (uppercase, alphanumeric only, no hyphens).
 */
export async function hashInviteCode(code: string): Promise<string> {
  const normalized = (code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function getLocalStudents(groupId: string): Student[] {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(`students_${groupId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const all = parsed
            .filter(s => s && typeof s === 'object' && typeof s.id === 'number')
            .map(s => ({
              id: s.id,
              name: String(s.name || '').trim(),
              ...(s.slot ? { slot: String(s.slot).trim().toUpperCase() } : {})
            }));

          // Self-healing: if real named students exist along with phantom "Студент N"
          // created by earlier slot desync bugs, transfer any slots and purge phantoms!
          const isAnon = (name: string) => /^Студент\s+\d+$/i.test(name.trim());
          const realStudents = all.filter(s => !isAnon(s.name));
          const phantomStudents = all.filter(s => isAnon(s.name));

          if (realStudents.length > 0 && phantomStudents.length > 0) {
            // Transfer slots from phantoms to real students who lack slots
            phantomStudents.forEach((phantom, idx) => {
              if (phantom.slot && realStudents[idx] && !realStudents[idx].slot) {
                realStudents[idx].slot = phantom.slot;
              }
            });
            try {
              localStorage.setItem(`students_${groupId}`, JSON.stringify(realStudents));
            } catch {}
            return realStudents;
          }

          return all;
        }
      }
    }
  } catch (e) {
    console.error(`Failed to load local students for ${groupId}:`, e);
  }
  return [];
}

/**
 * Save local students roster for a group to localStorage.
 */
export function saveLocalStudents(groupId: string, students: Student[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`students_${groupId}`, JSON.stringify(students));
    }
  } catch (e) {
    console.error(`Failed to save local students for ${groupId}:`, e);
  }
}

/**
 * Ensures that every student in the roster has a unique 8-character slot identifier.
 * Preserves existing slots and auto-generates slots for students missing one.
 */
export function ensureGroupSlots(groupId: string, students: Student[]): Student[] {
  const existingSlots = new Set<string>();
  for (const s of students) {
    if (s.slot && typeof s.slot === 'string' && s.slot.trim()) {
      existingSlots.add(s.slot.trim().toUpperCase());
    }
  }

  let modified = false;
  const updated = students.map(s => {
    if (s.slot && typeof s.slot === 'string' && s.slot.trim()) {
      return { ...s, slot: s.slot.trim().toUpperCase() };
    }
    let newSlot = generateSlotId();
    while (existingSlots.has(newSlot)) {
      newSlot = generateSlotId();
    }
    existingSlots.add(newSlot);
    modified = true;
    return { ...s, slot: newSlot };
  });

  if (modified) {
    saveLocalStudents(groupId, updated);
  }

  return updated;
}

/**
 * Creates unique invite codes and their SHA-256 hashes for all students in the group.
 * Does NOT send names or student IDs to the server.
 */
export async function createGroupInvites(
  groupId: string,
  students: Student[]
): Promise<StudentInvite[]> {
  const rosterWithSlots = ensureGroupSlots(groupId, students);
  const invites: StudentInvite[] = [];

  for (const stu of rosterWithSlots) {
    if (!stu.slot) continue;
    const code = generateInviteCode();
    const hash = await hashInviteCode(code);
    invites.push({
      studentId: stu.id,
      slot: stu.slot,
      code,
      hash
    });
  }

  return invites;
}

/**
 * Export local group roster as JSON backup string (version 3 format).
 */
export function exportRosterBackup(groupId: string): string {
  const students = getLocalStudents(groupId);
  const backup: RosterBackup = {
    version: 3,
    groupId,
    exportedAt: new Date().toISOString(),
    students
  };
  return JSON.stringify(backup, null, 2);
}

/**
 * Import local group roster from JSON backup string.
 * Supports:
 * 1. Standard wrapper object v3: { version: 3, groupId: '...', students: [...] }
 * 2. Direct students array: Student[] (e.g. [{ id: 1, name: '...', slot?: '...' }])
 */
export function importRosterBackup(
  groupId: string,
  jsonStr: string
): { ok: boolean, count?: number, error?: string } {
  try {
    if (!jsonStr || typeof jsonStr !== 'string') {
      return { ok: false, error: 'Пустая или некорректная резервная копия' };
    }
    let cleanStr = jsonStr.trim();
    // Strip UTF-8 BOM if present
    if (cleanStr.charCodeAt(0) === 0xFEFF) {
      cleanStr = cleanStr.slice(1).trim();
    }
    // Strip markdown code fences if copied from chat or markdown (e.g. ```json ... ```)
    if (cleanStr.startsWith('```')) {
      cleanStr = cleanStr.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    }
    if (!cleanStr) {
      return { ok: false, error: 'Пустая строка резервной копии' };
    }

    let parsed: any;
    try {
      parsed = JSON.parse(cleanStr);
    } catch (e: any) {
      if (cleanStr.startsWith('{') || cleanStr.startsWith('[')) {
        return { ok: false, error: `Неверный формат данных: ${e?.message || 'некорректный синтаксис'}` };
      }

      // Universal plain text line-by-line parsing (e.g. copied from Word/Excel/dekanat: "1. Иванов Иван")
      const lines = cleanStr.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const parsedStudents: Student[] = [];
      let nextId = 1;

      for (const line of lines) {
        // Strip leading numbering/bullets e.g. "1. ", "1) ", "1 - ", "- ", "* "
        const cleanedName = line.replace(/^\s*(?:\d+[\.\)\-:\s]+|[-*•]\s+)/, '').trim();
        if (cleanedName.length >= 2 && /[а-яА-Яa-zA-Z]/.test(cleanedName)) {
          parsedStudents.push({
            id: nextId++,
            name: cleanedName
          });
        }
      }

      if (parsedStudents.length > 0) {
        const rosterWithSlots = ensureGroupSlots(groupId, parsedStudents);
        saveLocalStudents(groupId, rosterWithSlots);
        return { ok: true, count: rosterWithSlots.length };
      }

      return { ok: false, error: `Неверный формат данных: ${e?.message || 'некорректный синтаксис'}` };
    }

    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: 'Неверный формат: резервная копия должна быть объектом или списком' };
    }

    let rawStudents: any[];

    if (Array.isArray(parsed)) {
      // Direct array of students
      rawStudents = parsed;
    } else {
      // Wrapper object
      if (parsed.version !== undefined && parsed.version !== 3) {
        return { ok: false, error: `Неподдерживаемая версия резервной копии: ${parsed.version}` };
      }
      if (parsed.groupId && typeof parsed.groupId === 'string') {
        if (parsed.groupId.trim().toLowerCase() !== groupId.trim().toLowerCase()) {
          return { ok: false, error: `Резервная копия принадлежит группе "${parsed.groupId}", а выбрана "${groupId}"` };
        }
      }
      if (!Array.isArray(parsed.students)) {
        return { ok: false, error: 'Резервная копия не содержит корректного списка студентов (поле students)' };
      }
      rawStudents = parsed.students;
    }

    const sanitizedStudents: Student[] = [];
    for (const item of rawStudents) {
      if (!item || typeof item !== 'object') continue;
      const id = Number(item.id);
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      if (!id || !name) continue;
      const stu: Student = { id, name };
      if (item.slot && typeof item.slot === 'string' && item.slot.trim()) {
        stu.slot = item.slot.trim().toUpperCase();
      }
      sanitizedStudents.push(stu);
    }

    const rosterWithSlots = ensureGroupSlots(groupId, sanitizedStudents);
    saveLocalStudents(groupId, rosterWithSlots);
    return { ok: true, count: rosterWithSlots.length };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Не удалось восстановить резервную копию' };
  }
}

/**
 * Helper to get Telegram WebApp initData string from global context.
 */
export function getTelegramInitData(): string {
  if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.initData) {
    return (window as any).Telegram.WebApp.initData;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as any).Telegram?.WebApp?.initData) {
    return (globalThis as any).Telegram.WebApp.initData;
  }
  return '';
}

export function getSavedStaffToken(groupId?: string): string {
  try {
    if (typeof localStorage !== 'undefined') {
      if (groupId) {
        const byGroup = localStorage.getItem(`staff_token_${normalizeGroupId(groupId).toLowerCase()}`);
        if (byGroup) return byGroup;
      }
      return localStorage.getItem('staff_token') || '';
    }
  } catch {}
  return '';
}

export function saveStaffToken(token: string, groupId?: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('staff_token', token);
      if (groupId) {
        localStorage.setItem(`staff_token_${normalizeGroupId(groupId).toLowerCase()}`, token);
      }
    }
  } catch {}
}

export function getAuthHeaders(groupId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  const initData = getTelegramInitData();
  if (initData) {
    headers['X-Telegram-Init-Data'] = initData;
  }
  const token = getSavedStaffToken(groupId);
  if (token) {
    headers['X-Staff-Token'] = token;
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Register student slot identifiers with Cloudflare Worker (Blind Server).
 * POST /v3/slots
 */
export async function registerSlotsWithServer(
  groupId: string,
  slots: string[]
): Promise<{ ok: boolean, registered?: number, error?: string }> {
  try {
    const base = getAttendanceApiBase();
    const res = await fetch(`${base}/v3/slots`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ gid: groupId, slots })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: json.error || `HTTP ${res.status}` };
    }
    return { ok: true, registered: json.registered };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Network error' };
  }
}

/**
 * Publish invite code hashes for slots with Cloudflare Worker.
 * POST /v3/invites
 */
export async function publishInvitesWithServer(
  groupId: string,
  items: { slot: string, hash: string }[]
): Promise<{ ok: boolean, count?: number, error?: string }> {
  try {
    const base = getAttendanceApiBase();
    const res = await fetch(`${base}/v3/invites`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ gid: groupId, items })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: json.error || `HTTP ${res.status}` };
    }
    return { ok: true, count: json.count };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Network error' };
  }
}

/**
 * Fetch monthly attendance data for a group from Cloudflare Worker.
 * GET /v3/att?gid=...&month=...
 */
export async function fetchMonthAttendanceV3(
  groupId: string,
  month: string
): Promise<{ ok: boolean, data?: any, error?: string, status?: number }> {
  try {
    const base = getAttendanceApiBase();
    const params = new URLSearchParams({ gid: groupId, month });
    const res = await fetch(`${base}/v3/att?${params.toString()}`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: json.error || `HTTP ${res.status}`, status: res.status };
    }
    return { ok: true, data: json, status: res.status };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Network error' };
  }
}

/**
 * Save monthly attendance patch with optimistic locking with Cloudflare Worker.
 * PUT /v3/att
 */
export async function saveMonthAttendanceV3(
  groupId: string,
  month: string,
  baseVer: number,
  patch: any,
  cancel: any
): Promise<{ ok: boolean, ver?: number, conflict?: boolean, error?: string, status?: number }> {
  try {
    const base = getAttendanceApiBase();
    const res = await fetch(`${base}/v3/att`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        gid: groupId,
        month,
        baseVer,
        patch,
        cancel
      })
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 409) {
      return {
        ok: false,
        conflict: true,
        ver: json.ver ?? json.currentVer,
        error: json.error || 'Version conflict',
        status: 409
      };
    }
    if (!res.ok) {
      return { ok: false, error: json.error || `HTTP ${res.status}`, status: res.status };
    }
    return { ok: true, ver: json.ver, status: res.status };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Network error' };
  }
}

export interface LocalStudentLink {
  gid: string;
  slot: string;
  linkedAt: number;
  consentVer: number;
}

/**
 * Get local student link information from localStorage.
 */
export function getLocalStudentLink(): LocalStudentLink | null {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem('v3_student_linked');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          parsed &&
          typeof parsed === 'object' &&
          typeof parsed.gid === 'string' &&
          typeof parsed.slot === 'string'
        ) {
          return {
            gid: parsed.gid,
            slot: parsed.slot,
            linkedAt: typeof parsed.linkedAt === 'number' ? parsed.linkedAt : Date.now(),
            consentVer: typeof parsed.consentVer === 'number' ? parsed.consentVer : 1
          };
        }
      }
    }
  } catch (e) {
    console.error('Failed to get local student link:', e);
  }
  return null;
}

/**
 * Clear local student link information from localStorage.
 */
export function clearLocalStudentLink(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('v3_student_linked');
    }
  } catch (e) {
    console.error('Failed to clear local student link:', e);
  }
}

/**
 * Link current student with invite code on Cloudflare Worker (Blind Server).
 * POST /v3/student/link
 */
export async function linkStudentWithInvite(
  code: string,
  consentVer: number = 1
): Promise<{ ok: boolean; gid?: string; slot?: string; error?: string }> {
  try {
    if (!code || typeof code !== 'string' || !code.trim()) {
      return { ok: false, error: 'Неверный или истекший код приглашения' };
    }
    const cleanCode = code.trim().toUpperCase();
    const base = getAttendanceApiBase();
    const res = await fetch(`${base}/v3/student/link`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ code: cleanCode, consentVer })
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 404) {
      return { ok: false, error: 'Неверный или истекший код приглашения' };
    }
    if (res.status === 429) {
      return { ok: false, error: 'Слишком много попыток, подождите 15 минут' };
    }
    if (!res.ok) {
      return { ok: false, error: json.error || `HTTP ${res.status}` };
    }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(
          'v3_student_linked',
          JSON.stringify({
            gid: json.gid,
            slot: json.slot,
            linkedAt: Date.now(),
            consentVer
          })
        );
      }
    } catch (e) {
      console.error('Failed to save student link to localStorage:', e);
    }
    return { ok: true, gid: json.gid, slot: json.slot };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Network error' };
  }
}

/**
 * Fetch current student's attendance records and status from Cloudflare Worker.
 * GET /v3/me
 */
export async function fetchMyAttendanceV3(month?: string): Promise<{
  ok: boolean;
  linked: boolean;
  gid?: string;
  slot?: string;
  marks?: Record<string, 'e' | 'u'>;
  cancelled?: string[];
  error?: string;
}> {
  try {
    const base = getAttendanceApiBase();
    const url = month
      ? `${base}/v3/me?month=${encodeURIComponent(month)}`
      : `${base}/v3/me`;
    const res = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, linked: false, error: json.error || `HTTP ${res.status}` };
    }
    return {
      ok: true,
      linked: Boolean(json.linked),
      gid: json.gid,
      slot: json.slot,
      marks: json.marks,
      cancelled: json.cancelled
    };
  } catch (err: any) {
    return { ok: false, linked: false, error: err?.message || 'Network error' };
  }
}

/**
 * Unlink student from group and delete remote slot data on Cloudflare Worker.
 * DELETE /v3/me
 */
export async function unlinkStudentV3(month?: string): Promise<{
  ok: boolean;
  deleted: boolean;
  error?: string;
}> {
  try {
    const base = getAttendanceApiBase();
    const url = month
      ? `${base}/v3/me?month=${encodeURIComponent(month)}`
      : `${base}/v3/me`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, deleted: false, error: json.error || `HTTP ${res.status}` };
    }
    clearLocalStudentLink();
    return { ok: true, deleted: Boolean(json.deleted) };
  } catch (err: any) {
    return { ok: false, deleted: false, error: err?.message || 'Network error' };
  }
}

/**
 * Claim starosta staff or admin role using the 80-bit code.
 * POST /v3/staff/claim
 */
export async function claimStaffRole(
  gidOrCode: string,
  codeOrRole?: string
): Promise<{ ok: boolean; role?: 'admin' | 'starosta'; gid?: string; token?: string; error?: string }> {
  try {
    const base = getAttendanceApiBase();
    let targetGid = gidOrCode;
    let code = codeOrRole || '';
    if (codeOrRole === 'admin' || codeOrRole?.toLowerCase() === 'admin') {
      code = gidOrCode;
      targetGid = 'admin';
    } else if (!codeOrRole && gidOrCode) {
      code = gidOrCode;
      targetGid = 'admin';
    }
    const cleanCode = (code || '').trim().toUpperCase();
    const canonicalGid = normalizeGroupId(targetGid).trim().toLowerCase();
    const res = await fetch(`${base}/v3/staff/claim`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        gid: canonicalGid,
        code: cleanCode
      })
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 429) {
      return { ok: false, error: 'Слишком много попыток ввода кода. Подождите 15 минут.' };
    }
    if (!res.ok) {
      return { ok: false, error: json.error || 'Неверный код группы или администратора' };
    }
    const finalGid = json.gid || canonicalGid;
    if (json.token) {
      saveStaffToken(json.token, finalGid);
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`group_code_${finalGid}`, cleanCode);
    }
    return { ok: true, role: json.role || 'starosta', gid: finalGid, token: json.token };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Ошибка сети' };
  }
}

/**
 * Synchronize local attendance records with Cloudflare Worker API v3 (Blind Server).
 * Maps local students to anonymous slots and pushes monthly slices via PUT /v3/att.
 */
export async function syncAttendanceRecordsToV3(
  groupId: string,
  records?: AttendanceRecord[]
): Promise<{ ok: boolean; error?: string; status?: number }> {
  try {
    const gid = groupId.trim().toLowerCase();
    let students = getLocalStudents(gid);
    if (!students || students.length === 0) {
      return { ok: true };
    }

    students = ensureGroupSlots(gid, students);

    // Auto-sync encrypted E2EE roster backup to cloud so slots match across all devices
    syncRosterToCloud(gid, students).catch(() => {});

    // Register slots with server if needed
    const slots = students.map(s => s.slot).filter(Boolean) as string[];
    if (slots.length > 0) {
      await registerSlotsWithServer(gid, slots).catch(() => {});
    }

    let recs = records;
    if (!recs) {
      try {
        const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(`attendance_${gid}`) : null;
        if (saved) recs = JSON.parse(saved);
      } catch {}
    }
    if (!recs || recs.length === 0) return { ok: true };

    // Group records by month (YYYY-MM)
    const byMonth = new Map<string, AttendanceRecord[]>();
    for (const r of recs) {
      if (!r || !r.date) continue;
      const m = r.date.slice(0, 7); // "YYYY-MM"
      const list = byMonth.get(m) || [];
      list.push(r);
      byMonth.set(m, list);
    }

    const slotMap = new Map<number, string>();
    students.forEach(s => {
      if (s.slot) slotMap.set(s.id, s.slot);
    });

    for (const [month, monthRecs] of byMonth.entries()) {
      let attempts = 0;
      let success = false;
      let lastError = '';

      while (attempts < 3 && !success) {
        attempts++;
        const fetchRes = await fetchMonthAttendanceV3(gid, month);
        if (!fetchRes.ok && fetchRes.status === 401) {
          return { ok: false, error: fetchRes.error, status: 401 };
        }

        const baseVer = (fetchRes.ok && fetchRes.data?.ver) ? fetchRes.data.ver : 0;
        const currentSlots = (fetchRes.ok && fetchRes.data?.slots) ? fetchRes.data.slots : {};
        const currentCancelled: string[] = (fetchRes.ok && Array.isArray(fetchRes.data?.cancelled)) ? fetchRes.data.cancelled : [];

        const patch: Record<string, Record<string, 'e' | 'u' | null>> = {};
        const cancelSet = new Set<string>(currentCancelled);

        // Initialize patch objects for known slots
        slots.forEach(slot => {
          patch[slot] = {};
        });

        for (const rec of monthRecs) {
          const pairMatch = (rec.lessonId || '').match(/(\d+)$/);
          const pairNum = pairMatch ? pairMatch[1] : '1';
          const mmdd = rec.date.slice(5);
          const lessonKey = `${mmdd}.${pairNum}`;

          if (rec.isCancelled) {
            cancelSet.add(lessonKey);
          } else {
            cancelSet.delete(lessonKey);
          }

          const absentIds = new Set(rec.absentStudentIds || []);
          const excusedIds = new Set(rec.excusedStudentIds || []);

          for (const [studentId, slot] of slotMap.entries()) {
            if (absentIds.has(studentId)) {
              patch[slot][lessonKey] = 'u'; // 'u' = unexcused / неуважительная (Н)
            } else if (excusedIds.has(studentId)) {
              patch[slot][lessonKey] = 'e'; // 'e' = excused / уважительная (УП)
            } else {
              if (currentSlots[slot] && currentSlots[slot][lessonKey]) {
                patch[slot][lessonKey] = null;
              }
            }
          }
        }

        const saveRes = await saveMonthAttendanceV3(gid, month, baseVer, patch, Array.from(cancelSet));
        if (saveRes.ok) {
          success = true;
        } else if (saveRes.conflict) {
          // Version changed in background, retry with fresh version
          continue;
        } else {
          if (saveRes.status === 401) {
            return { ok: false, error: saveRes.error, status: 401 };
          }
          lastError = saveRes.error || 'Save failed';
          break;
        }
      }

      if (!success) {
        return { ok: false, error: lastError || 'Version conflict retry failed' };
      }
    }

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Sync failed' };
  }
}

const safeBtoa = (str: string): string => {
  if (typeof btoa !== 'undefined') return btoa(str);
  if (typeof Buffer !== 'undefined') return Buffer.from(str, 'binary').toString('base64');
  return '';
};

const safeAtob = (b64: string): string => {
  if (typeof atob !== 'undefined') return atob(b64);
  if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64').toString('binary');
  return '';
};

/**
 * Derives an AES-GCM 256-bit CryptoKey from an 80-bit group access code using PBKDF2 with SHA-256.
 */
async function deriveRosterCryptoKey(accessCode: string, salt: Uint8Array): Promise<CryptoKey> {
  const normalized = (accessCode || '').trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
  const enc = new TextEncoder();
  const c = typeof crypto !== 'undefined' ? crypto : (globalThis as any).crypto;
  const keyMaterial = await c.subtle.importKey(
    'raw',
    enc.encode(normalized),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return await c.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt student roster using AES-256-GCM.
 * Zero-Knowledge: plaintext names NEVER leave the client unencrypted.
 */
export async function encryptRosterE2EE(
  students: Student[],
  accessCode: string
): Promise<{ data: string; iv: string; salt: string }> {
  const c = typeof crypto !== 'undefined' ? crypto : (globalThis as any).crypto;
  const salt = new Uint8Array(16);
  const iv = new Uint8Array(12);
  if (c && c.getRandomValues) {
    c.getRandomValues(salt);
    c.getRandomValues(iv);
  } else {
    for (let i = 0; i < 16; i++) salt[i] = Math.floor(Math.random() * 256);
    for (let i = 0; i < 12; i++) iv[i] = Math.floor(Math.random() * 256);
  }

  const key = await deriveRosterCryptoKey(accessCode, salt);
  const enc = new TextEncoder();
  const plaintext = JSON.stringify(students);
  const ciphertextBuffer = await c.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext)
  );

  return {
    data: safeBtoa(String.fromCharCode(...new Uint8Array(ciphertextBuffer))),
    iv: safeBtoa(String.fromCharCode(...iv)),
    salt: safeBtoa(String.fromCharCode(...salt))
  };
}

/**
 * Decrypt student roster using AES-256-GCM.
 */
export async function decryptRosterE2EE(
  payload: { data: string; iv: string; salt: string },
  accessCode: string
): Promise<Student[] | null> {
  try {
    if (!payload || !payload.data || !payload.iv || !payload.salt) return null;
    const c = typeof crypto !== 'undefined' ? crypto : (globalThis as any).crypto;
    const saltRaw = safeAtob(payload.salt);
    const salt = Uint8Array.from(saltRaw, ch => ch.charCodeAt(0));
    const ivRaw = safeAtob(payload.iv);
    const iv = Uint8Array.from(ivRaw, ch => ch.charCodeAt(0));
    const cipherRaw = safeAtob(payload.data);
    const ciphertext = Uint8Array.from(cipherRaw, ch => ch.charCodeAt(0));

    const key = await deriveRosterCryptoKey(accessCode, salt);
    const decryptedBuffer = await c.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    const decryptedStr = new TextDecoder().decode(decryptedBuffer);
    const parsed = JSON.parse(decryptedStr);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(s => s && typeof s.id === 'number');
  } catch (err) {
    return null;
  }
}

/**
 * Save encrypted roster to Cloudflare KV.
 * PUT /v3/roster
 */
export async function saveEncryptedRosterV3(
  groupId: string,
  payload: { data: string; iv: string; salt: string }
): Promise<{ ok: boolean; ver?: number; error?: string }> {
  try {
    const base = getAttendanceApiBase();
    const res = await fetch(`${base}/v3/roster`, {
      method: 'PUT',
      headers: getAuthHeaders(groupId),
      body: JSON.stringify({
        gid: normalizeGroupId(groupId),
        data: payload.data,
        iv: payload.iv,
        salt: payload.salt
      })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: json.error || `HTTP ${res.status}` };
    }
    return { ok: true, ver: json.ver };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Network error' };
  }
}

/**
 * Fetch encrypted roster from Cloudflare KV.
 * GET /v3/roster?gid=...
 */
export async function fetchEncryptedRosterV3(
  groupId: string
): Promise<{ ok: boolean; roster?: any; error?: string }> {
  try {
    const base = getAttendanceApiBase();
    const res = await fetch(`${base}/v3/roster?gid=${encodeURIComponent(normalizeGroupId(groupId))}`, {
      method: 'GET',
      headers: getAuthHeaders(groupId)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: json.error || `HTTP ${res.status}` };
    }
    return { ok: true, roster: json.roster };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Network error' };
  }
}

/**
 * Sync local students to cloud in encrypted E2EE format.
 */
export async function syncRosterToCloud(
  groupId: string,
  students: Student[],
  accessCode?: string
): Promise<boolean> {
  try {
    const canonicalGid = normalizeGroupId(groupId);
    const code = accessCode || (typeof localStorage !== 'undefined' ? localStorage.getItem(`group_code_${canonicalGid}`) || localStorage.getItem('access_code') : '') || '';
    if (!code) return false;
    const slotted = ensureGroupSlots(canonicalGid, students);
    const encrypted = await encryptRosterE2EE(slotted, code);
    const res = await saveEncryptedRosterV3(canonicalGid, encrypted);
    return Boolean(res.ok);
  } catch {
    return false;
  }
}

/**
 * Restore roster from cloud using access code, decrypt and save to localStorage.
 */
export async function restoreRosterFromCloud(
  groupId: string,
  accessCode: string
): Promise<{ ok: boolean; count?: number; error?: string }> {
  try {
    const canonicalGid = normalizeGroupId(groupId);
    const res = await fetchEncryptedRosterV3(canonicalGid);
    if (!res.ok || !res.roster) {
      return { ok: false, error: res.error || 'Резервная копия ростера не найдена в облаке' };
    }
    const decrypted = await decryptRosterE2EE(res.roster, accessCode);
    if (!decrypted || decrypted.length === 0) {
      return { ok: false, error: 'Не удалось расшифровать список студентов' };
    }
    const slotted = ensureGroupSlots(canonicalGid, decrypted);
    saveLocalStudents(canonicalGid, slotted);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`group_code_${canonicalGid}`, accessCode);
    }
    return { ok: true, count: slotted.length };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Ошибка восстановления ростера' };
  }
}

/**
 * Pull attendance records from Cloudflare Worker API v3 (Blind Server).
 * Reconstructs AttendanceRecord[] from anonymous slots for the current semester.
 */
export async function pullAttendanceRecordsFromV3(
  groupId: string
): Promise<AttendanceRecord[]> {
  try {
    const gid = normalizeGroupId(groupId).trim().toLowerCase();
    let students = getLocalStudents(gid);

    // Active semester months in Samara timezone (UTC+4)
    const now = new Date(Date.now() + 4 * 60 * 60 * 1000);
    const curYear = now.getUTCFullYear();
    const curMonth = now.getUTCMonth() + 1; // 1..12

    let monthsToFetch: string[] = [];
    if (curMonth >= 8 || curMonth === 1) {
      // Fall semester (August - January)
      const yr = curMonth === 1 ? curYear - 1 : curYear;
      monthsToFetch = [
        `${yr}-08`,
        `${yr}-09`,
        `${yr}-10`,
        `${yr}-11`,
        `${yr}-12`,
        `${yr + 1}-01`
      ];
    } else {
      // Spring semester (February - July)
      monthsToFetch = [
        `${curYear}-02`,
        `${curYear}-03`,
        `${curYear}-04`,
        `${curYear}-05`,
        `${curYear}-06`,
        `${curYear}-07`
      ];
    }

    // Build slot-to-student mapping
    let slotToStudentId = new Map<string, number>();
    for (const s of students) {
      if (s.slot) {
        slotToStudentId.set(s.slot.trim().toUpperCase(), s.id);
      }
    }

    const recordsByLesson = new Map<string, AttendanceRecord>();

    for (const monthStr of monthsToFetch) {
      const res = await fetchMonthAttendanceV3(gid, monthStr);
      if (!res.ok || !res.data) continue;

      const data = res.data;
      const slots: Record<string, Record<string, 'e' | 'u'>> = (data.slots && typeof data.slots === 'object') ? data.slots : {};
      const cancelledSet = new Set<string>(Array.isArray(data.cancelled) ? data.cancelled : []);

      const serverSlots = Object.keys(slots);
      if (serverSlots.length === 0 && cancelledSet.size === 0) continue;

      // If students exist in the roster, bind unmapped server slots to students without slots
      let rosterModified = false;
      if (students.length > 0) {
        const unslottedStudents = students.filter(s => !s.slot);
        const unassignedServerSlots = serverSlots.filter(s => !slotToStudentId.has(s.trim().toUpperCase()));
        if (unslottedStudents.length > 0 && unassignedServerSlots.length > 0) {
          const count = Math.min(unslottedStudents.length, unassignedServerSlots.length);
          for (let i = 0; i < count; i++) {
            const cleanSlot = unassignedServerSlots[i].trim().toUpperCase();
            unslottedStudents[i].slot = cleanSlot;
            slotToStudentId.set(cleanSlot, unslottedStudents[i].id);
            rosterModified = true;
          }
        }
      } else {
        // ONLY if local roster is completely empty (e.g. cold start on new device without roster)
        serverSlots.sort().forEach(slot => {
          const cleanSlot = slot.trim().toUpperCase();
          if (!slotToStudentId.has(cleanSlot)) {
            const nextId = students.length > 0 ? Math.max(...students.map(s => s.id)) + 1 : 1;
            const fallbackStu: Student = {
              id: nextId,
              name: `Студент ${nextId}`,
              slot: cleanSlot
            };
            students.push(fallbackStu);
            slotToStudentId.set(cleanSlot, nextId);
            rosterModified = true;
          }
        });
      }

      if (rosterModified) {
        saveLocalStudents(gid, students);
      }

      // Collect all lesson keys present in this month
      const allLessonKeys = new Set<string>(cancelledSet);
      for (const [slot, lessonMarks] of Object.entries(slots)) {
        if (lessonMarks && typeof lessonMarks === 'object') {
          for (const lk of Object.keys(lessonMarks)) {
            allLessonKeys.add(lk);
          }
        }
      }

      // For each lesson key (format "MM-DD.P"), reconstruct AttendanceRecord
      for (const lessonKey of allLessonKeys) {
        const dotIdx = lessonKey.lastIndexOf('.');
        if (dotIdx === -1) continue;
        const mmdd = lessonKey.slice(0, dotIdx);
        const pairNum = lessonKey.slice(dotIdx + 1);
        const yearPart = monthStr.slice(0, 4);
        const dateStr = `${yearPart}-${mmdd}`;

        const isCancelled = cancelledSet.has(lessonKey);
        const absentStudentIds: number[] = [];
        const excusedStudentIds: number[] = [];

        for (const [slot, marks] of Object.entries(slots)) {
          const cleanSlot = slot.trim().toUpperCase();
          const studentId = slotToStudentId.get(cleanSlot);
          if (!studentId) continue;

          const mark = marks[lessonKey];
          if (mark === 'u') {
            absentStudentIds.push(studentId);
          } else if (mark === 'e') {
            excusedStudentIds.push(studentId);
          }
        }

        // Generate canonical lesson ID matching group schedule if available
        let matchedLessonId = `${gid}-${pairNum}`;
        try {
          const [yr, m, d] = dateStr.split('-').map(Number);
          const dt = new Date(yr, (m || 1) - 1, d || 1, 12, 0, 0);
          const week = getSemesterWeek(dt, gid);
          const dayName = getDayName(dt);
          const scheduleDays = (SCHEDULE_REGISTRY as any)[gid]?.[week];
          if (Array.isArray(scheduleDays)) {
            const dayObj = scheduleDays.find((sd: any) => sd.dayName === dayName);
            if (dayObj && Array.isArray(dayObj.lessons)) {
              const num = Number(pairNum);
              const foundLesson = dayObj.lessons.find((l: any) => {
                if (l.order === num) return true;
                const mMatch = (l.id || '').match(/(\d+)$/);
                return mMatch && Number(mMatch[1]) === num;
              });
              if (foundLesson && foundLesson.id) {
                matchedLessonId = foundLesson.id;
              }
            }
          }
        } catch {}

        const recKey = `${dateStr}_${matchedLessonId}`;
        recordsByLesson.set(recKey, {
          docId: `${gid}_${dateStr}_${matchedLessonId}`,
          groupId: gid,
          date: dateStr,
          lessonId: matchedLessonId,
          absentStudentIds,
          excusedStudentIds,
          isCancelled,
          updatedAt: Number(data.updatedAt) || 0
        });
      }
    }

    return Array.from(recordsByLesson.values());
  } catch (err) {
    console.warn('Failed to pull attendance from v3:', err);
    return [];
  }
}



