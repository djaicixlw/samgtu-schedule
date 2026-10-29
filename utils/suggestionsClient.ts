/**
 * Client for the student-suggestion queue of the "Полезное" tab (see worker/useful_suggestions.js).
 * Every call returns a result object and never throws: the UI shows `error` (already in Russian) to the user.
 */
import { getAttendanceApiBase, getAuthHeaders } from './attendanceStorage';
import type { UsefulItem, UsefulLink, HomeworkAttachment } from '../types';

export interface SuggestionInput {
  gid: string;
  title: string;
  text: string;
  subject?: string;
  tags?: string[];
  links?: UsefulLink[];
  attachments?: HomeworkAttachment[];
  /** true = the starosta does not see the name (the author can still be blocked) */
  anonymous?: boolean;
}

export interface SubmitResult { ok: boolean; id?: string; remaining?: number; error?: string; code?: string; status?: number }
export interface PendingResult { ok: boolean; items: UsefulItem[]; error?: string; status?: number }
export interface CountResult { ok: boolean; count: number; status?: number }
export interface SimpleResult { ok: boolean; error?: string; status?: number }

const NETWORK_ERROR = 'Нет связи с сервером. Попробуйте ещё раз';

async function request(method: 'GET' | 'POST', path: string, gid: string, body?: unknown, timeoutMs = 8000): Promise<{ status: number; json: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${getAttendanceApiBase()}${path}`, {
      method,
      headers: getAuthHeaders(gid),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

/** Server record -> the shape the Useful tab already renders for pending items. */
export function toPendingItem(rec: any, gid: string): UsefulItem {
  const author: string | null = typeof rec.author === 'string' && rec.author ? rec.author : null;
  return {
    id: String(rec.id),
    groupId: gid,
    title: String(rec.title || ''),
    text: String(rec.text || ''),
    subject: rec.subject || undefined,
    tags: Array.isArray(rec.tags) ? rec.tags : [],
    links: Array.isArray(rec.links) ? rec.links : [],
    attachments: Array.isArray(rec.attachments) ? rec.attachments : [],
    createdAt: String(rec.createdAt || new Date().toISOString()),
    isPending: true,
    submittedBy: author ? (author.startsWith('@') ? { username: author.slice(1) } : { name: author }) : undefined
  };
}

export async function submitSuggestion(input: SuggestionInput): Promise<SubmitResult> {
  try {
    const { status, json } = await request('POST', '/v3/useful/suggest', input.gid, input);
    if (status === 200 && json.ok) return { ok: true, id: json.id, remaining: json.remaining, status };
    if (status === 401) return { ok: false, status, code: 'NO_INITDATA', error: 'Откройте приложение из Telegram, чтобы предложить материал' };
    return { ok: false, status, code: json.code, error: json.error || `Не удалось отправить (код ${status})` };
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

export async function fetchPendingCount(gid: string): Promise<CountResult> {
  try {
    const { status, json } = await request('GET', `/v3/useful/pending?gid=${encodeURIComponent(gid)}&countOnly=1`, gid);
    return status === 200 && json.ok ? { ok: true, count: Number(json.count) || 0, status } : { ok: false, count: 0, status };
  } catch {
    return { ok: false, count: 0 };
  }
}

export async function fetchPendingSuggestions(gid: string): Promise<PendingResult> {
  try {
    const { status, json } = await request('GET', `/v3/useful/pending?gid=${encodeURIComponent(gid)}`, gid);
    if (status === 200 && json.ok && Array.isArray(json.items)) return { ok: true, items: json.items.map((r: any) => toPendingItem(r, gid)), status };
    return { ok: false, items: [], status, error: json.error };
  } catch {
    return { ok: false, items: [], error: NETWORK_ERROR };
  }
}

export async function decideSuggestion(gid: string, id: string, action: 'approve' | 'reject' | 'block' | 'unblock_all'): Promise<SimpleResult> {
  try {
    const { status, json } = await request('POST', '/v3/useful/decision', gid, { gid, id, action });
    return status === 200 && json.ok ? { ok: true, status } : { ok: false, status, error: json.error || `Не удалось выполнить (код ${status})` };
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

export async function setNotifications(gid: string, enable: boolean): Promise<SimpleResult & { subscribed?: boolean }> {
  try {
    const { status, json } = await request('POST', '/v3/notify/subscribe', gid, { gid, enable });
    return status === 200 && json.ok ? { ok: true, subscribed: Boolean(json.subscribed), status } : { ok: false, status, error: json.error || `Не удалось выполнить (код ${status})` };
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

export async function getNotificationStatus(gid: string): Promise<{ ok: boolean; subscribed: boolean }> {
  try {
    const { status, json } = await request('GET', `/v3/notify/status?gid=${encodeURIComponent(gid)}`, gid);
    return status === 200 && json.ok ? { ok: true, subscribed: Boolean(json.subscribed) } : { ok: false, subscribed: false };
  } catch {
    return { ok: false, subscribed: false };
  }
}
