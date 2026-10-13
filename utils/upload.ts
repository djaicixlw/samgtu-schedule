import { HomeworkAttachment } from '../types';
import { WORKER_BASE } from './cloudSync';
import { logger } from './logger';

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' Б';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' КБ';
  return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
}

/**
 * Extracts Telegram file_id from a fileId string or direct /file?file_id= URL.
 */
export function extractFileId(fileIdOrUrl?: string): string | null {
  if (!fileIdOrUrl || typeof fileIdOrUrl !== 'string') return null;
  const match = fileIdOrUrl.match(/[?&]file_id=([^&]+)/);
  if (match && match[1]) {
    return decodeURIComponent(match[1]);
  }
  // If it's not a URL with protocol and looks like a raw file_id
  if (!fileIdOrUrl.includes('://') && !fileIdOrUrl.includes('/') && fileIdOrUrl.length >= 10) {
    return fileIdOrUrl;
  }
  return null;
}

/**
 * Upload a document or image to Telegram private storage via Cloudflare Worker.
 */
export async function uploadAttachmentFile(
  file: File,
  caption?: string
): Promise<HomeworkAttachment> {
  if (file.size > 20 * 1024 * 1024) {
    throw new Error('Файл слишком большой (>20 МБ). Прикрепите ссылку на Яндекс.Диск или Облако');
  }

  const formData = new FormData();
  formData.append('document', file, file.name);
  if (caption) {
    formData.append('caption', caption);
  }

  const tg = (typeof window !== 'undefined' && (window as any).Telegram?.WebApp) || null;
  const initData = tg?.initData || '';

  const res = await fetch(`${WORKER_BASE}/upload`, {
    method: 'POST',
    headers: {
      ...(initData ? { 'X-Telegram-Init-Data': initData } : {})
    },
    body: formData
  });

  if (!res.ok) {
    throw new Error(`Ошибка загрузки: статус ${res.status}`);
  }

  const json = await res.json();
  if (!json.ok || !json.result) {
    throw new Error(json.description || 'Сервер отклонил файл');
  }

  const doc = json.result.document || (json.result.photo ? json.result.photo[json.result.photo.length - 1] : null);
  const fileId = doc?.file_id;

  const directUrl = json.direct_url || (fileId ? `${WORKER_BASE}/file?file_id=${fileId}&download=1` : '');
  const isImage = file.type.startsWith('image/');

  return {
    id: 'att_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    name: file.name,
    url: directUrl,
    tgUrl: directUrl,
    fileId: fileId,
    type: isImage ? 'image' : 'file',
    size: formatFileSize(file.size)
  };
}

/**
 * Fetch a fresh, valid 10-minute signed URL for Telegram-backed attachments (B-04).
 * If the link is an external web link, returns it directly.
 */
export async function getFreshFileUrl(
  fileIdOrUrl?: string,
  fileName?: string
): Promise<string> {
  if (!fileIdOrUrl) return '';

  const fileId = extractFileId(fileIdOrUrl);
  if (!fileId) {
    return fileIdOrUrl; // External link (e.g. Yandex Disk, Moodle)
  }

  try {
    const res = await fetch(`${WORKER_BASE}/v3/files/link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        file_id: fileId,
        filename: fileName || 'file'
      })
    });

    if (res.ok) {
      const json = await res.json();
      if (json && json.ok && json.direct_url) {
        return json.direct_url;
      }
    }
  } catch (e) {
    logger.warn('Failed to get fresh signed file link, using fallback URL:', e);
  }

  // Fallback to original URL or direct streaming URL
  if (fileIdOrUrl.startsWith('http')) {
    return fileIdOrUrl;
  }
  return `${WORKER_BASE}/file?file_id=${encodeURIComponent(fileId)}&download=1`;
}

/**
 * Safely open an attachment via Telegram WebApp or browser window, refreshing link if needed.
 */
export async function openAttachmentSafe(attachment: HomeworkAttachment): Promise<void> {
  const target = attachment.fileId || attachment.url || attachment.tgUrl;
  if (!target) return;

  const tg = (typeof window !== 'undefined' && (window as any).Telegram?.WebApp) || null;

  // In non-Telegram browsers, pre-open window synchronously to retain user activation gesture
  let newWin: Window | null = null;
  if (!tg && typeof window !== 'undefined') {
    try {
      newWin = window.open('about:blank', '_blank');
    } catch {}
  }

  try {
    const freshUrl = await getFreshFileUrl(target, attachment.name);
    if (!freshUrl) {
      if (newWin && !newWin.closed) newWin.close();
      return;
    }

    if (tg && typeof tg.openLink === 'function' && freshUrl.startsWith('https://')) {
      try {
        tg.openLink(freshUrl);
        if (newWin && !newWin.closed) newWin.close();
        return;
      } catch (e) {
        // Fallback below
      }
    }

    if (newWin && !newWin.closed) {
      newWin.location.href = freshUrl;
    } else if (typeof window !== 'undefined') {
      const a = document.createElement('a');
      a.href = freshUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  } catch (err) {
    if (newWin && !newWin.closed) {
      try { newWin.close(); } catch {}
    }
  }
}
