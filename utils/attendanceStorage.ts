import { Student } from '../types';
import type { AttendanceRecord } from '../attendance';

export const WORKER_BASE = 'https://floral-union-26d1.alexeyberezin2.workers.dev';
export const CROCKFORD_BASE32_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

let customApiBaseUrl: string | null = null;

export function setAttendanceApiBase(url: string | null): void {
  customApiBaseUrl = url;
}

export function getAttendanceApiBase(): string {
  return customApiBaseUrl || WORKER_BASE;
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

/**
 * Get local students roster for a group from localStorage.
 */
export function getLocalStudents(groupId: string): Student[] {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(`students_${groupId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed
            .filter(s => s && typeof s === 'object' && typeof s.id === 'number')
            .map(s => ({
              id: s.id,
              name: String(s.name || '').trim(),
              ...(s.slot ? { slot: String(s.slot).trim().toUpperCase() } : {})
            }));
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
 */
export function importRosterBackup(
  groupId: string,
  jsonStr: string
): { ok: boolean, count?: number, error?: string } {
  try {
    if (!jsonStr || typeof jsonStr !== 'string') {
      return { ok: false, error: 'Empty or invalid JSON backup' };
    }
    const parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: 'Backup root must be an object' };
    }
    if (parsed.version !== 3) {
      return { ok: false, error: `Unsupported backup version: ${parsed.version}` };
    }
    if (parsed.groupId && parsed.groupId !== groupId) {
      return { ok: false, error: `Backup belongs to group "${parsed.groupId}", expected "${groupId}"` };
    }
    if (!Array.isArray(parsed.students)) {
      return { ok: false, error: 'Backup does not contain a valid students array' };
    }

    const sanitizedStudents: Student[] = [];
    for (const item of parsed.students) {
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
    return { ok: false, error: e?.message || 'Failed to parse JSON backup' };
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

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  const initData = getTelegramInitData();
  if (initData) {
    headers['X-Telegram-Init-Data'] = initData;
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
): Promise<{ ok: boolean, data?: any, error?: string }> {
  try {
    const base = getAttendanceApiBase();
    const params = new URLSearchParams({ gid: groupId, month });
    const res = await fetch(`${base}/v3/att?${params.toString()}`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: json.error || `HTTP ${res.status}` };
    }
    return { ok: true, data: json };
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
): Promise<{ ok: boolean, ver?: number, conflict?: boolean, error?: string }> {
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
        error: json.error || 'Version conflict'
      };
    }
    if (!res.ok) {
      return { ok: false, error: json.error || `HTTP ${res.status}` };
    }
    return { ok: true, ver: json.ver };
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
  gid: string,
  code: string
): Promise<{ ok: boolean; role?: 'admin' | 'starosta'; error?: string }> {
  try {
    const base = getAttendanceApiBase();
    const res = await fetch(`${base}/v3/staff/claim`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        gid: gid.trim().toLowerCase(),
        code: code.trim().toUpperCase()
      })
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 429) {
      return { ok: false, error: 'Слишком много попыток ввода кода. Подождите 15 минут.' };
    }
    if (!res.ok) {
      return { ok: false, error: json.error || 'Неверный код группы или администратора' };
    }
    return { ok: true, role: json.role || 'starosta' };
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
): Promise<{ ok: boolean; error?: string }> {
  try {
    const gid = groupId.trim().toLowerCase();
    let students = getLocalStudents(gid);
    if (!students || students.length === 0) {
      return { ok: true };
    }

    students = ensureGroupSlots(gid, students);

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
      const fetchRes = await fetchMonthAttendanceV3(gid, month);
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
            patch[slot][lessonKey] = 'e';
          } else if (excusedIds.has(studentId)) {
            patch[slot][lessonKey] = 'u';
          } else {
            if (currentSlots[slot] && currentSlots[slot][lessonKey]) {
              patch[slot][lessonKey] = null;
            }
          }
        }
      }

      await saveMonthAttendanceV3(gid, month, baseVer, patch, Array.from(cancelSet));
    }

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Sync failed' };
  }
}


