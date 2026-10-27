import { Student } from '../types';
import { getAttendanceMode, refreshServerMirror, pushMonthOps } from './attendanceD1Client';
import { safeSetItem, safeGetItem } from './safeStorage';
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
  // Node (tests, scripts) must never silently talk to the production worker.
  if (typeof process !== 'undefined' && (process as any).versions?.node) {
    return 'http://worker.invalid';
  }
  return DEFAULT_PROD_WORKER_URL;
};

export const WORKER_BASE = getDefaultWorkerBase();
export const CROCKFORD_BASE32_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Canonical Crockford Base32 Access Code normalizer.
 * Safely maps O -> 0, I -> 1, L -> 1, strips non-alphanumeric separators, and groups into XXXX-XXXX-XXXX-XXXX.
 * Strictly avoids merging 5 and S!
 */
export function normalizeAccessCode(raw: string): string {
  const upper = String(raw || "").trim().toUpperCase();
  const stripped = upper
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (stripped.length === 16) {
    return stripped.match(/.{1,4}/g)?.join("-") || stripped;
  }
  return upper;
}

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
              ...(s.slot ? { slot: String(s.slot).trim().toUpperCase() } : {}),
              ...(typeof s.isArchived === 'boolean' ? { isArchived: s.isArchived } : {})
            }));

          const isAnon = (name: string) => /^Студент\s+\d+$/i.test(name.trim());
          const realStudents = all.filter(s => !isAnon(s.name));
          if (realStudents.length > 0 && realStudents.length < all.length) {
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
            id: 0,
            name: cleanedName
          });
        }
      }

      if (parsedStudents.length > 0) {
        const norm = (n: string) => n.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
        const existing = getLocalStudents(groupId);
        const byName = new Map<string, Student>();
        existing.forEach(s => { if (!byName.has(norm(s.name))) byName.set(norm(s.name), s); });
        let nextId = existing.reduce((m, s) => Math.max(m, s.id), 0) + 1;
        const used = new Set<number>();
        const next: Student[] = [];
        for (const ps of parsedStudents) {
          const hit = byName.get(norm(ps.name));
          if (hit && !used.has(hit.id)) {
            used.add(hit.id);
            next.push({ ...hit, name: ps.name, isArchived: false });
          } else if (!hit) {
            next.push({ id: nextId++, name: ps.name });
          }
        }
        existing.forEach(s => { if (!used.has(s.id)) next.push({ ...s, isArchived: true }); });
        next.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
        const rosterWithSlots = ensureGroupSlots(groupId, next);
        saveLocalStudents(groupId, rosterWithSlots);
        return { ok: true, count: rosterWithSlots.filter(s => !s.isArchived).length };
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
      if (typeof item.isArchived === 'boolean') {
        stu.isArchived = item.isArchived;
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
      headers: getAuthHeaders(groupId),
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
      headers: getAuthHeaders(groupId),
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
      headers: getAuthHeaders(groupId)
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
  cancel: any,
  hours?: any
): Promise<{ ok: boolean, ver?: number, conflict?: boolean, error?: string, status?: number }> {
  try {
    const base = getAttendanceApiBase();
    const res = await fetch(`${base}/v3/att`, {
      method: 'PUT',
      headers: getAuthHeaders(groupId),
      body: JSON.stringify({
        gid: groupId,
        month,
        baseVer,
        patch,
        cancel,
        hours
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

/** Clears stored access codes for a clean logout (sessionStorage + any legacy disk copies). */
export function clearGroupAccessCodes(): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const drop: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith('group_code_')) drop.push(k);
      }
      drop.forEach(k => sessionStorage.removeItem(k));
    }
  } catch {}
  try {
    if (typeof localStorage !== 'undefined') {
      const drop: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('group_code_') || k === 'access_code')) drop.push(k);
      }
      drop.forEach(k => localStorage.removeItem(k));
    }
  } catch {}
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
    const cleanCode = normalizeAccessCode(code);
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
// ---------------------------------------------------------------------------
// Cell-level three-way sync for attendance.
//
// BASE   = what this device last synchronised (stored in localStorage),
// OURS   = what the local records say now,
// THEIRS = whatever the server holds (never read for diffing).
//
// Only cells where OURS differs from BASE are sent, as per-cell operations. A cell that is
// absent locally but also absent from BASE is "unknown", not "deleted", so marks set on
// another device are never erased by a stale device (the old behaviour pushed the whole month
// and turned "no mark here" into "delete the mark").
// ---------------------------------------------------------------------------

const attendanceBaseKey = (gid: string) => `attendance_base_${gid}`;

function readAttendanceBase(gid: string): Record<string, string> {
  try {
    const raw = safeGetItem(attendanceBaseKey(gid));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return {};
}

function writeAttendanceBase(gid: string, cells: Record<string, string>): void {
  safeSetItem(attendanceBaseKey(gid), JSON.stringify(cells), { component: 'attendanceBase' });
}

/** Flattens local records into cell keys: `${month}|${slot}|${lessonKey}` -> 'u' | 'e', `c|${month}|${lessonKey}` -> 'c'. */
function buildAttendanceCells(
  records: AttendanceRecord[],
  students: Student[]
): Map<string, string | undefined> {
  const slotByStudentId = new Map<number, string>();
  students.forEach(s => { if (s.slot) slotByStudentId.set(s.id, s.slot); });
  const cells = new Map<string, string | undefined>();
  for (const rec of records) {
    if (!rec || !rec.date) continue;
    const month = rec.date.slice(0, 7);
    const pairMatch = (rec.lessonId || '').match(/(\d+)$/);
    const pairNum = pairMatch ? pairMatch[1] : '1';
    const lessonKey = `${rec.date.slice(5)}.${pairNum}`;
    cells.set(`c|${month}|${lessonKey}`, rec.isCancelled ? 'c' : undefined);
    // Only non-default lesson length is stored (2 academic hours is the default).
    cells.set(`h|${month}|${lessonKey}`, rec.hours && rec.hours !== 2 ? String(rec.hours) : undefined);
    const absentIds = new Set(rec.absentStudentIds || []);
    const excusedIds = new Set(rec.excusedStudentIds || []);
    for (const [studentId, slot] of slotByStudentId.entries()) {
      const mark = absentIds.has(studentId) ? 'u' : excusedIds.has(studentId) ? 'e' : undefined;
      cells.set(`${month}|${slot}|${lessonKey}`, mark);
    }
  }
  return cells;
}

/**
 * Declares the local records to be in sync with the server (call after a pull that was merged
 * without pending local changes). Replaces BASE with the cells of the given records.
 */
export function rebaseAttendanceBase(groupId: string, records: AttendanceRecord[]): void {
  const gid = groupId.trim().toLowerCase();
  const students = getLocalStudents(gid);
  const base: Record<string, string> = {};
  for (const [key, value] of buildAttendanceCells(records || [], students).entries()) {
    if (value) base[key] = value;
  }
  writeAttendanceBase(gid, base);
}

/**
 * Sets the push base to what the SERVER holds for the given months (never to local state), so
 * pending local edits remain visible to the next push as differences from the base.
 */
export function rebaseAttendanceBaseFromServer(
  groupId: string,
  serverRecords: AttendanceRecord[],
  fetchedMonths: string[]
): void {
  const gid = groupId.trim().toLowerCase();
  const students = getLocalStudents(gid);
  const base = readAttendanceBase(gid);
  const months = new Set(fetchedMonths);
  const monthOf = (key: string) => (key.startsWith('c|') || key.startsWith('h|')) ? key.split('|')[1] : key.split('|')[0];
  for (const key of Object.keys(base)) {
    if (months.has(monthOf(key))) delete base[key];
  }
  for (const [key, value] of buildAttendanceCells(serverRecords || [], students).entries()) {
    if (value && months.has(monthOf(key))) base[key] = value;
  }
  writeAttendanceBase(gid, base);
}

/**
 * Synchronize local attendance records with Cloudflare Worker API v3 (Blind Server).
 * Sends only the cells that changed on this device since the last successful sync.
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
    const store = typeof localStorage !== 'undefined' ? localStorage : null;

    // Roster backup and slot registration only when they actually changed (each is a KV write).
    const rosterSig = JSON.stringify(students.map(s => [s.id, s.name, s.slot || '', s.isArchived ? 1 : 0]));
    if (!store || store.getItem(`roster_sig_${gid}`) !== rosterSig) {
      syncRosterToCloud(gid, students)
        .then(ok => { if (ok && store) { try { store.setItem(`roster_sig_${gid}`, rosterSig); } catch {} } })
        .catch(() => {});
    }
    const slots = students.map(s => s.slot).filter(Boolean) as string[];
    const slotsSig = slots.slice().sort().join(',');
    if (slots.length > 0 && (!store || store.getItem(`slots_sig_${gid}`) !== slotsSig)) {
      const reg = await registerSlotsWithServer(gid, slots).catch(() => ({ ok: false }));
      if (reg && reg.ok && store) { try { store.setItem(`slots_sig_${gid}`, slotsSig); } catch {} }
    }

    let recs = records;
    if (!recs) {
      try {
        const saved = store ? store.getItem(`attendance_${gid}`) : null;
        if (saved) recs = JSON.parse(saved);
      } catch {}
    }
    if (!recs || recs.length === 0) return { ok: true };

    const base = readAttendanceBase(gid);
    const ours = buildAttendanceCells(recs, students);

    type MonthDelta = {
      patch: Record<string, Record<string, 'e' | 'u' | null>>;
      cancel: Record<string, true | null>;
      hours: Record<string, number | null>;
      updates: Array<[string, string | undefined]>;
    };
    const deltas = new Map<string, MonthDelta>();
    const deltaFor = (month: string): MonthDelta => {
      let d = deltas.get(month);
      if (!d) { d = { patch: {}, cancel: {}, hours: {}, updates: [] }; deltas.set(month, d); }
      return d;
    };

    for (const [key, value] of ours.entries()) {
      if (value === base[key]) continue; // unchanged on this device: never touch what we did not change
      if (key.startsWith('c|')) {
        const [, month, lessonKey] = key.split('|');
        const d = deltaFor(month);
        d.cancel[lessonKey] = value ? true : null;
        d.updates.push([key, value]);
      } else if (key.startsWith('h|')) {
        const [, month, lessonKey] = key.split('|');
        const d = deltaFor(month);
        d.hours[lessonKey] = value ? Number(value) : null;
        d.updates.push([key, value]);
      } else {
        const [month, slot, lessonKey] = key.split('|');
        const d = deltaFor(month);
        (d.patch[slot] = d.patch[slot] || {})[lessonKey] = (value as 'e' | 'u' | undefined) ?? null;
        d.updates.push([key, value]);
      }
    }

    if (deltas.size === 0) return { ok: true };

    // Time of the local edit per lesson: lets the server order offline edits correctly against other devices.
    const recTimes = new Map<string, number>();
    for (const rec of recs) {
      if (!rec || !rec.date) continue;
      const pm = (rec.lessonId || '').match(/(\d+)$/);
      const t = typeof (rec as any).updatedAt === 'number' ? (rec as any).updatedAt : Date.parse(String((rec as any).updatedAt));
      if (Number.isFinite(t) && t > 0) recTimes.set(`${rec.date.slice(0, 7)}|${rec.date.slice(5)}.${pm ? pm[1] : '1'}`, t);
    }

    const newBase: Record<string, string> = { ...base };
    let failure: { error: string; status?: number } | null = null;

    for (const [month, delta] of deltas.entries()) {
      // D1 groups: idempotent cell ops, one request per month, no read-modify-write and no version conflicts.
      if (getAttendanceMode(gid) === 'd1') {
        const pushed = await pushMonthOps(
          { base: getAttendanceApiBase(), headers: getAuthHeaders(gid) }, gid, month, delta,
          lessonKey => recTimes.get(`${month}|${lessonKey}`)
        );
        if (pushed.ok) {
          for (const [key, value] of delta.updates) {
            if (value) newBase[key] = value; else delete newBase[key];
          }
          continue;
        }
        if (!pushed.notD1) {
          failure = { error: pushed.error || 'Save failed', status: pushed.status };
          if (pushed.status === 401) break;
          continue;
        }
        // the group is not on D1 (any more): fall through to the legacy month protocol below
      }

      let attempts = 0;
      let success = false;
      let lastError = '';

      while (attempts < 3 && !success) {
        attempts++;
        const fetchRes = await fetchMonthAttendanceV3(gid, month);
        if (!fetchRes.ok && fetchRes.status === 401) {
          failure = { error: fetchRes.error || 'Unauthorized', status: 401 };
          break;
        }
        const baseVer = (fetchRes.ok && fetchRes.data?.ver) ? fetchRes.data.ver : 0;
        if (fetchRes.ok && isStaleRead(gid, month, baseVer)) {
          // The edge serving us is behind a version this device already saw: writing on top of it would
          // silently drop someone's marks. Keep the dirty flag and retry on the next sync.
          lastError = 'Stale read from a lagging edge location; push postponed';
          break;
        }
        const hasCancel = Object.keys(delta.cancel).length > 0;
        const hasHours = Object.keys(delta.hours).length > 0;
        const saveRes = await saveMonthAttendanceV3(
          gid, month, baseVer, delta.patch,
          hasCancel ? delta.cancel : undefined,
          hasHours ? delta.hours : undefined
        );
        if (saveRes.ok) {
          success = true;
          noteSeenVer(gid, month, saveRes.ver);
        } else if (saveRes.conflict) {
          // Another session wrote first. Our payload is a set of per-cell operations that does not
          // depend on the server state, so it is safe to retry it unchanged on top of the new version.
          continue;
        } else {
          if (saveRes.status === 401) {
            failure = { error: saveRes.error || 'Unauthorized', status: 401 };
          }
          lastError = saveRes.error || 'Save failed';
          break;
        }
      }

      if (success) {
        for (const [key, value] of delta.updates) {
          if (value) newBase[key] = value; else delete newBase[key];
        }
      } else if (!failure) {
        failure = { error: lastError || 'Version conflict retry failed' };
      }
      if (failure && failure.status === 401) break;
    }

    writeAttendanceBase(gid, newBase);
    if (failure) return { ok: false, error: failure.error, status: failure.status };
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
  const normalized = normalizeAccessCode(accessCode);
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
  if (!c || typeof c.getRandomValues !== 'function' || !c.subtle) {
    throw new Error('Web Crypto API with secure RNG is required');
  }
  c.getRandomValues(salt);
  c.getRandomValues(iv);

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
    if (!students || students.length === 0 || students.every(s => typeof s.name === 'string' && /^Студент\s+\d+$/i.test(s.name.trim()))) {
      console.warn(`[syncRosterToCloud] Aborted sync for ${canonicalGid}: roster is empty or contains only dummy students`);
      return false;
    }
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

const STALE_READ_WINDOW_MS = 15_000;
const seenVersKey = (gid: string) => `attendance_seen_vers_${gid}`;

export function readSeenVers(gid: string): Record<string, { ver: number; at: number }> {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(seenVersKey(gid));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      }
    }
  } catch {}
  return {};
}

export function noteSeenVer(gid: string, month: string, ver: number | undefined): void {
  if (!ver || !Number.isFinite(ver)) return;
  try {
    if (typeof localStorage === 'undefined') return;
    const all = readSeenVers(gid);
    if (!all[month] || ver >= all[month].ver) {
      all[month] = { ver, at: Date.now() };
      localStorage.setItem(seenVersKey(gid), JSON.stringify(all));
    }
  } catch {}
}

/** True when `ver` is older than a version this device saw/wrote very recently (lagging edge cache). */
export function isStaleRead(gid: string, month: string, ver: number): boolean {
  const seen = readSeenVers(gid)[month];
  return Boolean(seen && ver < seen.ver && Date.now() - seen.at < STALE_READ_WINDOW_MS);
}

export interface AttendanceSnapshot {
  records: AttendanceRecord[];
  /** Months that were really fetched from the server (even if empty); stale or failed months are excluded. */
  fetchedMonths: string[];
}

export async function pullAttendanceRecordsFromV3(groupId: string): Promise<AttendanceRecord[]> {
  return (await pullAttendanceSnapshotFromV3(groupId)).records;
}

/**
 * Pull attendance records from Cloudflare Worker API v3 (Blind Server).
 * Reconstructs AttendanceRecord[] from anonymous slots for the current semester.
 */
export async function pullAttendanceSnapshotFromV3(
  groupId: string,
  options?: { recentOnly?: boolean }
): Promise<AttendanceSnapshot> {
  const fetchedMonths: string[] = [];
  const recordsByLesson = new Map<string, AttendanceRecord>();

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

    if (options?.recentOnly) {
      const curMonthStr = `${curYear}-${String(curMonth).padStart(2, '0')}`;
      const prevDate = new Date(now.getTime() - 28 * 86400000);
      const prevMonthStr = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, '0')}`;
      monthsToFetch = monthsToFetch.filter(m => m === curMonthStr || m === prevMonthStr);
    }

    // Build slot-to-student mapping
    let slotToStudentId = new Map<string, number>();
    for (const s of students) {
      if (s.slot) {
        slotToStudentId.set(s.slot.trim().toUpperCase(), s.id);
      }
    }

    // D1 groups: ONE incremental request to the change feed replaces one GET per month. The local mirror has the
    // shape of the legacy month documents, so everything below (slot mapping, records, merge) stays unchanged.
    let mirror: Awaited<ReturnType<typeof refreshServerMirror>> | null = null;
    if (getAttendanceMode(gid) !== 'kv') {
      mirror = await refreshServerMirror({ base: getAttendanceApiBase(), headers: getAuthHeaders(gid) }, gid);
      if (mirror.mode === 'kv') mirror = null;                          // group is not on D1: legacy month protocol
      else if (!mirror.ok) return { records: Array.from(recordsByLesson.values()), fetchedMonths }; // feed failed
    }

    for (const monthStr of monthsToFetch) {
      let data: any = null;
      if (mirror && mirror.getMonth) {
        data = mirror.getMonth(monthStr);
        fetchedMonths.push(monthStr);
      } else {
        const res = await fetchMonthAttendanceV3(gid, monthStr);
        if (!res.ok || !res.data) continue;
        const ver = Number(res.data.ver) || 0;
        if (isStaleRead(gid, monthStr, ver)) continue;
        noteSeenVer(gid, monthStr, ver);
        fetchedMonths.push(monthStr);
        data = res.data;
      }
      if (!data) continue;

      const slots: Record<string, Record<string, 'e' | 'u'>> = (data.slots && typeof data.slots === 'object') ? data.slots : {};
      const cancelledSet = new Set<string>(Array.isArray(data.cancelled) ? data.cancelled : []);

      const serverSlots = Object.keys(slots);
      if (serverSlots.length === 0 && cancelledSet.size === 0) continue;

      // Cold-start binding of server slots to a roster that has no slots at all (legacy / restored roster).
      // Slots are anonymous, so this is a positional guess and is only safe when the whole roster is
      // unslotted and the counts match exactly. With a partially slotted roster (a student was added or
      // removed) an unmatched slot is an orphan of someone else and must never be bound to a new student.
      let rosterModified = false;
      if (students.length > 0) {
        const unslottedStudents = students.filter(s => !s.slot);
        const unassignedServerSlots = serverSlots.filter(s => !slotToStudentId.has(s.trim().toUpperCase()));
        const rosterHasNoSlots = students.every(s => !s.slot);
        if (rosterHasNoSlots && unslottedStudents.length > 0 && unslottedStudents.length === unassignedServerSlots.length) {
          const count = unslottedStudents.length;
          for (let i = 0; i < count; i++) {
            const cleanSlot = unassignedServerSlots[i].trim().toUpperCase();
            unslottedStudents[i].slot = cleanSlot;
            slotToStudentId.set(cleanSlot, unslottedStudents[i].id);
            rosterModified = true;
          }
        }
      } else {
        // ONLY if local roster is completely empty (e.g. cold start on new device without roster)
        // Keep mapping strictly in-memory so attendance matrix renders, but NEVER save dummy students to localStorage!
        serverSlots.sort().forEach(slot => {
          const cleanSlot = slot.trim().toUpperCase();
          if (!slotToStudentId.has(cleanSlot)) {
            const nextId = slotToStudentId.size + 1;
            slotToStudentId.set(cleanSlot, nextId);
          }
        });
      }

      const hasRealStudents = students.length > 0 && !students.every(s => typeof s.name === 'string' && /^Студент\s+\d+$/i.test(s.name.trim()));
      if (rosterModified && hasRealStudents) {
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
          ...(Number.isInteger(data.hours?.[lessonKey]) ? { hours: data.hours[lessonKey] } : {}),
          updatedAt: Number(data.updatedAt) || 0
        });
      }
    }

    return { records: Array.from(recordsByLesson.values()), fetchedMonths };
  } catch (err) {
    console.warn('Failed to pull attendance from v3:', err);
    return { records: [], fetchedMonths: [] };
  }
}



