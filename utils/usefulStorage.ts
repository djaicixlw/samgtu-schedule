import { UsefulItem, UsefulLink, HomeworkAttachment } from '../types';
import { WORKER_BASE } from './cloudSync';
import { logger } from './logger';

const MAX_TITLE_LEN = 100;
const MAX_TEXT_LEN = 2000;
const MAX_LINKS = 10;
const MAX_ATTACHMENTS = 10;

function getUsefulStorageKey(groupId: string): string {
  return `useful_${groupId.toLowerCase()}`;
}

function getDeletedUsefulKey(groupId: string): string {
  return `deleted_useful_${groupId.toLowerCase()}`;
}

export function sanitizeUsefulItem(raw: any, defaultGroupId: string): UsefulItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || `useful_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`);
  const groupId = String(raw.groupId || defaultGroupId).toLowerCase();
  const title = String(raw.title || '').trim().slice(0, MAX_TITLE_LEN);
  const text = String(raw.text || '').trim().slice(0, MAX_TEXT_LEN);
  
  if (!title && !text) return null;

  const subject = typeof raw.subject === 'string' && raw.subject.trim() ? raw.subject.trim() : undefined;
  
  let tags: string[] = [];
  if (Array.isArray(raw.tags)) {
    tags = raw.tags
      .map((t: any) => String(t || '').trim().toLowerCase().replace(/^#+/, ''))
      .filter((t: string) => t.length > 0 && t.length <= 30)
      .slice(0, 10);
  }

  let links: UsefulLink[] = [];
  if (Array.isArray(raw.links)) {
    links = raw.links
      .filter((l: any) => l && typeof l === 'object' && typeof l.url === 'string' && l.url.startsWith('https://'))
      .slice(0, MAX_LINKS)
      .map((l: any) => ({
        title: String(l.title || l.url).trim().slice(0, 100),
        url: String(l.url).trim()
      }));
  }

  let attachments: HomeworkAttachment[] = [];
  if (Array.isArray(raw.attachments)) {
    attachments = raw.attachments.slice(0, MAX_ATTACHMENTS).map((att: any) => ({
      id: att.id ? String(att.id) : undefined,
      name: String(att.name || 'Вложение').slice(0, 120),
      url: typeof att.url === 'string' ? att.url : undefined,
      tgUrl: typeof att.tgUrl === 'string' ? att.tgUrl : undefined,
      data: typeof att.data === 'string' ? att.data : undefined,
      type: typeof att.type === 'string' ? att.type : undefined,
      size: att.size
    }));
  }

  let submittedBy: { id?: number; username?: string; name?: string } | undefined = undefined;
  if (raw.submittedBy && typeof raw.submittedBy === 'object') {
    submittedBy = {
      id: typeof raw.submittedBy.id === 'number' ? raw.submittedBy.id : undefined,
      username: typeof raw.submittedBy.username === 'string' ? String(raw.submittedBy.username).slice(0, 100) : undefined,
      name: typeof raw.submittedBy.name === 'string' ? String(raw.submittedBy.name).slice(0, 100) : undefined
    };
  }

  return {
    id,
    groupId,
    title,
    text,
    subject,
    tags,
    isPinned: Boolean(raw.isPinned),
    order: typeof raw.order === 'number' ? raw.order : undefined,
    links,
    attachments,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
    createdBy: typeof raw.createdBy === 'string' ? raw.createdBy : undefined,
    isPending: raw.isPending ? true : undefined,
    submittedBy
  };
}

export function checkUsefulSpamLimit(): { allowed: boolean; remaining: number } {
  try {
    const raw = localStorage.getItem('submitted_useful_count');
    if (!raw) return { allowed: true, remaining: 3 };
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    if (!isNaN(Number(raw)) && !raw.startsWith('[')) {
      const count = Number(raw);
      if (count >= 3) return { allowed: false, remaining: 0 };
      return { allowed: true, remaining: 3 - count };
    }

    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const valid = parsed.filter((t: any) => typeof t === 'number' && (now - t) < oneHour);
      if (valid.length >= 3) return { allowed: false, remaining: 0 };
      return { allowed: true, remaining: 3 - valid.length };
    }
    return { allowed: true, remaining: 3 };
  } catch {
    return { allowed: true, remaining: 3 };
  }
}

export function recordUsefulSubmission(): void {
  try {
    const raw = localStorage.getItem('submitted_useful_count');
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    let timestamps: number[] = [];

    if (raw) {
      try {
        if (!isNaN(Number(raw)) && !raw.startsWith('[')) {
          const count = Number(raw);
          for (let i = 0; i < count; i++) timestamps.push(now - 1000);
        } else {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            timestamps = parsed.filter((t: any) => typeof t === 'number' && (now - t) < oneHour);
          }
        }
      } catch {}
    }
    timestamps.push(now);
    localStorage.setItem('submitted_useful_count', JSON.stringify(timestamps));
  } catch {}
}

export function getLocalUsefulItems(groupId: string): UsefulItem[] {
  if (!groupId) return [];
  try {
    const raw = localStorage.getItem(getUsefulStorageKey(groupId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    
    let deletedSet = new Set<string>();
    try {
      deletedSet = new Set(JSON.parse(localStorage.getItem(getDeletedUsefulKey(groupId)) || '[]'));
    } catch {}

    return parsed
      .map((item: any) => sanitizeUsefulItem(item, groupId))
      .filter((item: UsefulItem | null): item is UsefulItem => item !== null && !deletedSet.has(item.id))
      .sort((a, b) => {
        if (Boolean(a.isPinned) !== Boolean(b.isPinned)) {
          return a.isPinned ? -1 : 1;
        }
        if (a.order !== undefined && b.order !== undefined) {
          return a.order - b.order;
        }
        if (a.order !== undefined) return -1;
        if (b.order !== undefined) return 1;
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      });
  } catch (e) {
    logger.warn('USEFUL', `Failed to read local useful items for ${groupId}`, e);
    return [];
  }
}

export function saveLocalUsefulItems(groupId: string, items: UsefulItem[]): void {
  if (!groupId) return;
  try {
    const sanitized = items
      .map(item => sanitizeUsefulItem(item, groupId))
      .filter((item): item is UsefulItem => item !== null);
    localStorage.setItem(getUsefulStorageKey(groupId), JSON.stringify(sanitized));
  } catch (e) {
    logger.error('USEFUL', `Failed to save local useful items for ${groupId}`, e);
  }
}

export function recordDeletedUsefulItem(groupId: string, id: string): void {
  if (!groupId || !id) return;
  try {
    const key = getDeletedUsefulKey(groupId);
    const deleted: string[] = JSON.parse(localStorage.getItem(key) || '[]');
    if (!deleted.includes(id)) {
      deleted.push(id);
      localStorage.setItem(key, JSON.stringify(deleted.slice(-100)));
    }
  } catch {}
}

export async function fetchGroupUsefulData(
  groupId: string,
  signal?: AbortSignal
): Promise<{ items: UsefulItem[]; fromNetwork: boolean }> {
  const local = getLocalUsefulItems(groupId);
  if (!groupId) return { items: local, fromNetwork: false };

  try {
    const base = WORKER_BASE;
    const url = `${base}/sync/useful?groupId=${encodeURIComponent(groupId.toLowerCase())}`;
    const res = await fetch(url, { signal });
    if (!res.ok) {
      return { items: local, fromNetwork: false };
    }
    const data = await res.json();
    const groupPayload = data?.byGroup?.[groupId.toLowerCase()] || data;
    const rawItems = Array.isArray(groupPayload?.items) ? groupPayload.items : [];
    
    let deletedSet = new Set<string>();
    try {
      deletedSet = new Set(JSON.parse(localStorage.getItem(getDeletedUsefulKey(groupId)) || '[]'));
    } catch {}

    const cloudItems: UsefulItem[] = rawItems
      .map((item: any) => sanitizeUsefulItem(item, groupId))
      .filter((item: UsefulItem | null): item is UsefulItem => item !== null && !deletedSet.has(item.id));

    // Merge strategy: map by id, preserving any non-deleted local items
    const itemMap = new Map<string, UsefulItem>();
    cloudItems.forEach(item => itemMap.set(item.id, item));
    local.forEach(item => {
      if (!deletedSet.has(item.id) && !itemMap.has(item.id)) {
        itemMap.set(item.id, item);
      }
    });

    const merged = Array.from(itemMap.values()).sort((a, b) => {
      if (Boolean(a.isPinned) !== Boolean(b.isPinned)) {
        return a.isPinned ? -1 : 1;
      }
      if (a.order !== undefined && b.order !== undefined) {
        return a.order - b.order;
      }
      if (a.order !== undefined) return -1;
      if (b.order !== undefined) return 1;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });

    saveLocalUsefulItems(groupId, merged);
    return { items: merged, fromNetwork: true };
  } catch {
    return { items: local, fromNetwork: false };
  }
}

export async function pushGroupUsefulData(groupId: string, items: UsefulItem[]): Promise<boolean> {
  if (!groupId) return false;
  try {
    const base = WORKER_BASE;
    const url = `${base}/sync/useful?groupId=${encodeURIComponent(groupId.toLowerCase())}`;
    
    // Light payload without base64 to avoid HTTP 413
    const sanitizedItems = items.map(item => ({
      ...item,
      attachments: (item.attachments || []).map(att => ({
        id: att.id,
        name: att.name,
        url: att.url,
        tgUrl: att.tgUrl,
        type: att.type,
        size: att.size
      }))
    }));

    const tgInitData = (window as any).Telegram?.WebApp?.initData || '';
    const staffToken = typeof localStorage !== 'undefined'
      ? (localStorage.getItem(`staff_token_${groupId.toLowerCase()}`) || localStorage.getItem('staff_token') || '')
      : '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (tgInitData) {
      headers['X-Telegram-Init-Data'] = tgInitData;
    }
    if (staffToken) {
      headers['X-Staff-Token'] = staffToken;
      headers['Authorization'] = `Bearer ${staffToken}`;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        groupId: groupId.toLowerCase(),
        items: sanitizedItems,
        updatedAt: Date.now()
      })
    });

    return res.ok;
  } catch {
    return false;
  }
}
