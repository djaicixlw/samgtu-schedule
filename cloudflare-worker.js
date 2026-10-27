// Cloudflare Worker: Telegram Unlimited File Storage & CORS Cloud Sync Proxy for SamGTU 3-INGT-110
import {
  attStorage, readMonth, applyLegacyPatch, applyOps, normalizeOps, readChanges, readStudentMarks,
  deleteSlotMarks, migrateCopy, migrateVerify, migrateFlip, migrateRollback, hasD1, currentRev
} from './worker/attendance_d1.js';


// In-memory rate limiting (per-isolate, zero KV writes for anonymous traffic).
// Pairs with optional Cloudflare Rate Limiting binding named CLAIM_LIMITER (see wrangler.toml) - it is consulted first when present.
const rlBuckets = new Map();
const RL_MAX_BUCKETS = 20000;

function rlCount(key, now = Date.now()) {
  const b = rlBuckets.get(key);
  return b && b.reset > now ? b.n : 0;
}

function rlBump(key, windowMs, now = Date.now()) {
  if (rlBuckets.size >= RL_MAX_BUCKETS) {
    for (const [k, v] of rlBuckets) if (v.reset <= now) rlBuckets.delete(k);
    if (rlBuckets.size >= RL_MAX_BUCKETS) rlBuckets.delete(rlBuckets.keys().next().value);
  }
  const cur = rlCount(key, now);
  const reset = (rlBuckets.get(key)?.reset > now) ? rlBuckets.get(key).reset : now + windowMs;
  rlBuckets.set(key, { n: cur + 1, reset });
  return cur + 1;
}

function rlClear(key) {
  rlBuckets.delete(key);
}

export function __resetRateLimiters() {
  rlBuckets.clear();
}

// In-memory rate limiting and deduplication storage (per isolate)
export const recentErrorHashes = new Map();
export const recentAlertTimestamps = [];

export const recentUploadTimestamps = [];

export function clearWorkerRateLimits() {
  recentErrorHashes.clear();
  recentAlertTimestamps.length = 0;
  recentUploadTimestamps.length = 0;
}

export function isUploadRateLimited(now = Date.now()) {
  const UPLOAD_WINDOW_MS = 60 * 1000;
  const MAX_UPLOADS_PER_MINUTE = 30;
  while (recentUploadTimestamps.length > 0 && (now - recentUploadTimestamps[0]) > UPLOAD_WINDOW_MS) {
    recentUploadTimestamps.shift();
  }
  return recentUploadTimestamps.length >= MAX_UPLOADS_PER_MINUTE;
}

export function recordUploadSent(now = Date.now()) {
  recentUploadTimestamps.push(now);
}

export function normalizeAccessCode(raw) {
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

// Strict Whitelist DTO Sanitizers (Video 2: Protection against Mass Assignment / Extra Fields)
export function sanitizeHomeworkItem(item, fallbackGroupId = '') {
  if (!item || typeof item !== 'object') return null;
  return {
    id: String(item.id || ''),
    groupId: String(item.groupId || fallbackGroupId || '').slice(0, 50),
    subject: String(item.subject || '').slice(0, 200),
    lessonId: item.lessonId ? String(item.lessonId).slice(0, 100) : undefined,
    assignedDate: String(item.assignedDate || '').slice(0, 30),
    dueDate: String(item.dueDate || '').slice(0, 30),
    title: String(item.title || '').slice(0, 300),
    description: String(item.description || '').slice(0, 4000),
    teacher: item.teacher ? String(item.teacher).slice(0, 150) : undefined,
    attachments: Array.isArray(item.attachments) ? item.attachments.slice(0, 10).map(att => {
      if (!att || typeof att !== 'object') return null;
      return {
        id: String(att.id || '').slice(0, 100),
        name: String(att.name || '').slice(0, 200),
        type: String(att.type || 'file').slice(0, 30),
        size: typeof att.size === 'number' || typeof att.size === 'string' ? String(att.size).slice(0, 30) : 0,
        url: String(att.url || '').slice(0, 1000),
        tgUrl: att.tgUrl ? String(att.tgUrl).slice(0, 1000) : undefined,
        fileId: att.fileId ? String(att.fileId).slice(0, 200) : undefined
      };
    }).filter(Boolean) : [],
    createdAt: String(item.createdAt || '').slice(0, 50),
    createdBy: item.createdBy ? String(item.createdBy).slice(0, 100) : undefined,
    updatedAt: item.updatedAt ? (typeof item.updatedAt === 'number' ? item.updatedAt : String(item.updatedAt).slice(0, 50)) : undefined
  };
}


export function sanitizeUsefulItem(item, fallbackGroupId = '') {
  if (!item || typeof item !== 'object') return null;
  const id = String(item.id || '').slice(0, 100);
  if (!id) return null;
  const title = String(item.title || '').trim().slice(0, 100);
  const text = String(item.text || '').trim().slice(0, 2000);
  if (!title && !text) return null;

  const tags = Array.isArray(item.tags)
    ? item.tags.map(t => String(t || '').trim().toLowerCase().replace(/^#+/, '')).filter(t => t.length > 0 && t.length <= 30).slice(0, 10)
    : [];
  const links = Array.isArray(item.links)
    ? item.links
        .filter(l => l && typeof l === 'object' && typeof l.url === 'string' && l.url.startsWith('https://') && l.url.length <= 1000)
        .slice(0, 10)
        .map(l => ({ title: String(l.title || l.url).trim().slice(0, 100), url: String(l.url).trim() }))
    : [];
  // Attachment payloads (base64 `data`) are never stored on the server.
  const attachments = Array.isArray(item.attachments)
    ? item.attachments.slice(0, 10).map(att => {
        if (!att || typeof att !== 'object') return null;
        return {
          id: att.id ? String(att.id).slice(0, 100) : undefined,
          name: String(att.name || 'Вложение').slice(0, 200),
          url: typeof att.url === 'string' ? att.url.slice(0, 1000) : undefined,
          tgUrl: typeof att.tgUrl === 'string' ? att.tgUrl.slice(0, 1000) : undefined,
          type: typeof att.type === 'string' ? att.type.slice(0, 80) : undefined,
          size: typeof att.size === 'number' && Number.isFinite(att.size) ? att.size : (typeof att.size === 'string' ? att.size.slice(0, 30) : undefined)
        };
      }).filter(Boolean)
    : [];

  let submittedBy;
  if (item.submittedBy && typeof item.submittedBy === 'object') {
    submittedBy = {
      id: typeof item.submittedBy.id === 'number' && Number.isFinite(item.submittedBy.id) ? item.submittedBy.id : undefined,
      username: typeof item.submittedBy.username === 'string' ? item.submittedBy.username.slice(0, 100) : undefined,
      name: typeof item.submittedBy.name === 'string' ? item.submittedBy.name.slice(0, 100) : undefined
    };
  }

  return {
    id,
    groupId: String(item.groupId || fallbackGroupId || '').toLowerCase().slice(0, 64),
    title,
    text,
    subject: typeof item.subject === 'string' && item.subject.trim() ? item.subject.trim().slice(0, 200) : undefined,
    tags,
    isPinned: Boolean(item.isPinned),
    order: typeof item.order === 'number' && Number.isFinite(item.order) ? item.order : undefined,
    links,
    attachments,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt.slice(0, 50) : '',
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt.slice(0, 50) : undefined,
    createdBy: typeof item.createdBy === 'string' ? item.createdBy.slice(0, 100) : undefined,
    isPending: item.isPending ? true : undefined,
    submittedBy
  };
}

export function sanitizeAttendanceRecord(rec, fallbackGroupId = '') {
  if (!rec || typeof rec !== 'object') return null;
  const groupId = String(rec.groupId || fallbackGroupId || '').slice(0, 50);
  const date = String(rec.date || '').slice(0, 20);
  const lessonId = String(rec.lessonId || '').slice(0, 80);
  const generatedDocId = (groupId && date && lessonId) ? `${groupId}_${date}_${lessonId}` : '';
  const docId = String(rec.docId || generatedDocId || '').slice(0, 120);

  return {
    docId,
    groupId,
    date,
    lessonId,
    absentStudentIds: Array.isArray(rec.absentStudentIds)
      ? rec.absentStudentIds.map(Number).filter(n => Number.isInteger(n) && n > 0)
      : [],
    excusedStudentIds: Array.isArray(rec.excusedStudentIds)
      ? rec.excusedStudentIds.map(Number).filter(n => Number.isInteger(n) && n > 0)
      : [],
    isCancelled: Boolean(rec.isCancelled),
    updatedAt: typeof rec.updatedAt === 'number' ? rec.updatedAt : String(rec.updatedAt || '').slice(0, 50),
    updatedBy: String(rec.updatedBy || '').slice(0, 50)
  };
}

export function sanitizeStudent(student) {
  if (!student || typeof student !== 'object') return null;
  const id = Number(student.id);
  const name = String(student.name || '').trim().slice(0, 100);
  if (!id || !name) return null;
  return { id, name };
}

export function sanitizeScheduleOverride(ov) {
  if (!ov || typeof ov !== 'object') return null;
  const res = {};
  if (ov.subject !== undefined) res.subject = String(ov.subject).slice(0, 200);
  if (ov.type !== undefined) res.type = String(ov.type).slice(0, 50);
  if (ov.location !== undefined) res.location = String(ov.location).slice(0, 200);
  if (ov.teacher !== undefined) res.teacher = String(ov.teacher).slice(0, 150);
  if (ov.isCancelled !== undefined) res.isCancelled = Boolean(ov.isCancelled);
  if (ov.isHidden !== undefined) res.isHidden = Boolean(ov.isHidden);
  if (ov.hours !== undefined) res.hours = Number(ov.hours);
  if (ov.note !== undefined) {
    const cleanNote = String(ov.note).trim().slice(0, 500);
    if (cleanNote) {
      res.note = cleanNote;
      if (ov.noteDate !== undefined) res.noteDate = String(ov.noteDate).slice(0, 30);
      if (ov.isNoteRecurring !== undefined) res.isNoteRecurring = Boolean(ov.isNoteRecurring);
    }
  }
  if (ov.order !== undefined) res.order = Number(ov.order);
  if (ov.timeStart !== undefined) res.timeStart = String(ov.timeStart).slice(0, 20);
  if (ov.timeEnd !== undefined) res.timeEnd = String(ov.timeEnd).slice(0, 20);
  if (ov.updatedAt !== undefined) res.updatedAt = typeof ov.updatedAt === 'number' ? ov.updatedAt : String(ov.updatedAt).slice(0, 50);
  if (Array.isArray(ov.attachments)) {
    res.attachments = ov.attachments.slice(0, 10).map(att => {
      if (!att || typeof att !== 'object') return null;
      return {
        id: String(att.id || '').slice(0, 100),
        name: String(att.name || '').slice(0, 200),
        type: String(att.type || 'file').slice(0, 30),
        size: typeof att.size === 'number' || typeof att.size === 'string' ? String(att.size).slice(0, 30) : undefined,
        url: String(att.url || '').slice(0, 1000),
        tgUrl: att.tgUrl ? String(att.tgUrl).slice(0, 1000) : undefined,
        fileId: att.fileId ? String(att.fileId).slice(0, 200) : undefined
      };
    }).filter(Boolean);
  }
  return res;
}

export function sanitizeSyncPayload(type, rawData) {
  if (!rawData || typeof rawData !== 'object') return rawData;
  const now = Date.now();

  // If payload is wrapped in { payload: string, updatedAt: number }
  if (typeof rawData.payload === 'string') {
    try {
      const inner = JSON.parse(rawData.payload);
      const cleanInner = sanitizeSyncPayload(type, inner);
      return {
        payload: JSON.stringify(cleanInner),
        updatedAt: Number(rawData.updatedAt) || now
      };
    } catch {
      return rawData;
    }
  }

  if (type === 'homework') {
    const res = { updatedAt: Number(rawData.updatedAt) || now };
    if (rawData.byGroup && typeof rawData.byGroup === 'object') {
      res.byGroup = {};
      const entries = Object.entries(rawData.byGroup).slice(0, 50);
      for (const [gid, grp] of entries) {
        if (grp && typeof grp === 'object') {
          res.byGroup[gid] = {
            items: Array.isArray(grp.items) ? grp.items.slice(0, 2000).map(it => sanitizeHomeworkItem(it, gid)).filter(Boolean) : [],
            deletedIds: Array.isArray(grp.deletedIds) ? grp.deletedIds.map(String).slice(-1000) : [],
            updatedAt: Number(grp.updatedAt) || now
          };
        }
      }
    }
    if (Array.isArray(rawData.items)) {
      res.items = rawData.items.slice(0, 2000).map(it => sanitizeHomeworkItem(it)).filter(Boolean);
    }
    if (Array.isArray(rawData.deletedIds)) {
      res.deletedIds = rawData.deletedIds.map(String).slice(-1000);
    }
    return res;
  }

  if (type === 'attendance') {
    const res = { updatedAt: Number(rawData.updatedAt) || now };
    if (rawData.byGroup && typeof rawData.byGroup === 'object') {
      res.byGroup = {};
      const entries = Object.entries(rawData.byGroup).slice(0, 50);
      for (const [gid, grp] of entries) {
        if (grp && typeof grp === 'object') {
          const cleanGroup = {
            records: Array.isArray(grp.records) ? grp.records.slice(0, 500).map(r => sanitizeAttendanceRecord(r, gid)).filter(Boolean) : [],
            updatedAt: Number(grp.updatedAt) || now
          };
          res.byGroup[gid] = cleanGroup;
        }
      }
    }
    if (Array.isArray(rawData.records)) {
      res.records = rawData.records.slice(0, 500).map(r => sanitizeAttendanceRecord(r)).filter(Boolean);
    }
    return res;
  }

  if (type === 'schedule') {
    const res = { updatedAt: Number(rawData.updatedAt) || now };
    if (rawData.byGroup && typeof rawData.byGroup === 'object') {
      res.byGroup = {};
      const entries = Object.entries(rawData.byGroup).slice(0, 50);
      for (const [gid, grp] of entries) {
        if (grp && typeof grp === 'object') {
          const cleanGrp = { updatedAt: Number(grp.updatedAt) || now };
          if (grp.overrides && typeof grp.overrides === 'object') {
            cleanGrp.overrides = {};
            for (const [k, v] of Object.entries(grp.overrides)) {
              cleanGrp.overrides[k] = sanitizeScheduleOverride(v);
            }
          }
          if (grp.teachers && typeof grp.teachers === 'object') {
            cleanGrp.teachers = {};
            for (const [k, v] of Object.entries(grp.teachers)) {
              cleanGrp.teachers[k] = String(v).slice(0, 150);
            }
          }
          res.byGroup[gid] = cleanGrp;
        }
      }
    }
    if (rawData.scheduleOverrides && typeof rawData.scheduleOverrides === 'object') {
      res.scheduleOverrides = {};
      for (const [k, v] of Object.entries(rawData.scheduleOverrides)) {
        res.scheduleOverrides[k] = sanitizeScheduleOverride(v);
      }
    }
    if (rawData.subjectTeachers && typeof rawData.subjectTeachers === 'object') {
      res.subjectTeachers = {};
      for (const [k, v] of Object.entries(rawData.subjectTeachers)) {
        res.subjectTeachers[k] = String(v).slice(0, 150);
      }
    }
    return res;
  }

  if (type === 'useful') {
    const res = { updatedAt: Number(rawData.updatedAt) || now };
    const cleanItems = (arr, gid) => arr.slice(0, 200).map(it => sanitizeUsefulItem(it, gid)).filter(Boolean);
    const cleanDeleted = (arr) => arr.map(x => String(x).slice(0, 100)).slice(-1000);
    if (typeof rawData.groupId === 'string') res.groupId = rawData.groupId.toLowerCase().slice(0, 64);
    if (rawData.byGroup && typeof rawData.byGroup === 'object') {
      res.byGroup = {};
      for (const [gid, grp] of Object.entries(rawData.byGroup).slice(0, 50)) {
        if (grp && typeof grp === 'object') {
          res.byGroup[gid] = {
            groupId: gid,
            items: Array.isArray(grp.items) ? cleanItems(grp.items, gid) : [],
            deletedIds: Array.isArray(grp.deletedIds) ? cleanDeleted(grp.deletedIds) : [],
            updatedAt: Number(grp.updatedAt) || now
          };
        }
      }
    }
    if (Array.isArray(rawData.items)) res.items = cleanItems(rawData.items, res.groupId || '');
    if (Array.isArray(rawData.deletedIds)) res.deletedIds = cleanDeleted(rawData.deletedIds);
    return res;
  }

  return rawData;
}


// ---------------------------------------------------------------------------
// AUD-001: field-aware union merge for /sync/* group slices.
// ---------------------------------------------------------------------------

function syncTsMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const asNum = Number(value);
    if (Number.isFinite(asNum)) return asNum;
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

function syncItemNewer(incoming, existing) {
  return syncTsMs(incoming && (incoming.updatedAt ?? incoming.createdAt)) >
         syncTsMs(existing && (existing.updatedAt ?? existing.createdAt));
}

function mergeSyncItemArrays(existingItems, incomingItems) {
  const byId = new Map();
  for (const it of (Array.isArray(incomingItems) ? incomingItems : [])) {
    if (it && it.id !== undefined && it.id !== null) byId.set(String(it.id), it);
  }
  for (const it of (Array.isArray(existingItems) ? existingItems : [])) {
    if (!it || it.id === undefined || it.id === null) continue;
    const key = String(it.id);
    const prev = byId.get(key);
    if (!prev) {
      byId.set(key, it);
    } else if (syncItemNewer(it, prev)) {
      byId.set(key, it);
    }
  }
  return Array.from(byId.values());
}

function mergeSyncDeletedIds(existingGroup, incoming) {
  const deleted = new Set();
  for (const d of (Array.isArray(existingGroup && existingGroup.deletedIds) ? existingGroup.deletedIds : [])) deleted.add(String(d));
  for (const d of (Array.isArray(incoming && incoming.deletedIds) ? incoming.deletedIds : [])) deleted.add(String(d));
  return Array.from(deleted);
}

export function mergeHomeworkGroupSlice(existingGroup, incoming) {
  const ex = (existingGroup && typeof existingGroup === 'object') ? existingGroup : {};
  const inc = (incoming && typeof incoming === 'object') ? incoming : {};
  const result = { ...ex };
  result.items = mergeSyncItemArrays(ex.items, inc.items);
  result.deletedIds = mergeSyncDeletedIds(ex, inc);
  if (inc.updatedAt !== undefined) result.updatedAt = inc.updatedAt;
  return result;
}

export function mergeUsefulGroupSlice(existingGroup, incoming) {
  const ex = (existingGroup && typeof existingGroup === 'object') ? existingGroup : {};
  const inc = (incoming && typeof incoming === 'object') ? incoming : {};
  const result = { ...ex };
  result.items = mergeSyncItemArrays(ex.items, inc.items);
  result.deletedIds = mergeSyncDeletedIds(ex, inc);
  if (inc.updatedAt !== undefined) result.updatedAt = inc.updatedAt;
  return result;
}

export function mergeScheduleGroupSlice(existingGroup, incoming) {
  const ex = (existingGroup && typeof existingGroup === 'object') ? existingGroup : {};
  const inc = (incoming && typeof incoming === 'object') ? incoming : {};
  const result = { ...ex };

  const exOverrides = (ex.overrides && typeof ex.overrides === 'object') ? ex.overrides
    : (ex.scheduleOverrides && typeof ex.scheduleOverrides === 'object') ? ex.scheduleOverrides : {};
  const incOverrides = (inc.overrides && typeof inc.overrides === 'object') ? inc.overrides
    : (inc.scheduleOverrides && typeof inc.scheduleOverrides === 'object') ? inc.scheduleOverrides : {};
  const overrides = { ...exOverrides };
  for (const k of Object.keys(incOverrides)) {
    const prev = overrides[k];
    if (!prev || syncItemNewer(incOverrides[k], prev)) overrides[k] = incOverrides[k];
  }
  result.overrides = overrides;

  const exTeachers = (ex.teachers && typeof ex.teachers === 'object') ? ex.teachers
    : (ex.subjectTeachers && typeof ex.subjectTeachers === 'object') ? ex.subjectTeachers : {};
  const incTeachers = (inc.teachers && typeof inc.teachers === 'object') ? inc.teachers
    : (inc.subjectTeachers && typeof inc.subjectTeachers === 'object') ? inc.subjectTeachers : {};
  result.teachers = { ...exTeachers, ...incTeachers };

  if (inc.updatedAt !== undefined) result.updatedAt = inc.updatedAt;
  return result;
}

export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function isDeduplicated(errorKey, now = Date.now()) {
  const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
  for (const [key, timestamp] of recentErrorHashes.entries()) {
    if (now - timestamp > DEDUP_WINDOW_MS) {
      recentErrorHashes.delete(key);
    }
  }
  if (recentErrorHashes.has(errorKey)) {
    const lastTime = recentErrorHashes.get(errorKey);
    if (now - lastTime < DEDUP_WINDOW_MS) {
      return true;
    }
  }
  return false;
}

export function isRateLimited(now = Date.now()) {
  const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
  const MAX_ALERTS_PER_MINUTE = 5;
  while (recentAlertTimestamps.length > 0 && (now - recentAlertTimestamps[0]) > RATE_LIMIT_WINDOW_MS) {
    recentAlertTimestamps.shift();
  }
  return recentAlertTimestamps.length >= MAX_ALERTS_PER_MINUTE;
}

export function recordAlertSent(errorKey, now = Date.now()) {
  recentErrorHashes.set(errorKey, now);
  recentAlertTimestamps.push(now);
}

export function formatTelegramErrorHtml({ message, stack, component, group, platform, userAgent, timestamp }) {
  const safeGroup = escapeHtml(group || 'Не указана');
  const safePlatform = escapeHtml(platform || 'Не определена');
  const safeComponent = escapeHtml(component || 'Неизвестный компонент');
  const safeTime = escapeHtml(timestamp || new Date().toISOString());
  const safeMessage = escapeHtml((message || 'Без описания ошибки').slice(0, 1000));

  let text = `🚨 <b>СИГНАЛИЗАЦИЯ ОБ ОШИБКЕ (TMA)</b> 🚨\n\n` +
    `👥 <b>Группа:</b> <code>${safeGroup}</code>\n` +
    `📱 <b>Платформа:</b> ${safePlatform}\n` +
    `🧩 <b>Компонент:</b> <code>${safeComponent}</code>\n` +
    `⏰ <b>Время:</b> ${safeTime}\n\n` +
    `❌ <b>Ошибка:</b>\n<code>${safeMessage}</code>\n`;

  if (stack) {
    const safeStack = escapeHtml(String(stack).slice(0, 1500));
    text += `\n📑 <b>Фрагмент стека:</b>\n<pre>${safeStack}</pre>\n`;
  }

  if (userAgent) {
    const safeUa = escapeHtml(String(userAgent).slice(0, 200));
    text += `\n🌐 <b>User-Agent:</b> <pre>${safeUa}</pre>`;
  }

  return text;
}

export const KV_TYPES = new Set(["schedule", "homework", "attendance", "useful"]);
export const GROUP_ID_RE = /^[a-z0-9-]{1,64}$/;

export async function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode("cmp"),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(a));
  return crypto.subtle.verify("HMAC", key, sig, enc.encode(b));
}

export async function requireAppKey(request, appSecret) {
  if (!appSecret || typeof appSecret !== 'string') return false;
  if (!request || !request.headers) return false;
  const clientKey = request.headers.get("X-App-Key") || "";
  return safeEqual(clientKey, appSecret);
}

export const ALLOWED_ORIGINS = [
  'https://djaicixlw.github.io',
  'https://aleblll.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173'
];

export function getCorsHeaders(request, env, pathname = '') {
  let allowed = ALLOWED_ORIGINS;
  if (env && env.ALLOWED_ORIGINS) {
    if (Array.isArray(env.ALLOWED_ORIGINS)) {
      allowed = env.ALLOWED_ORIGINS;
    } else if (typeof env.ALLOWED_ORIGINS === 'string') {
      allowed = env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
    }
  }

  const origin = request?.headers?.get('Origin') || '';
  let allowOrigin;
  if (origin && allowed.includes(origin)) {
    allowOrigin = origin;
  } else {
    allowOrigin = allowed[0];
  }

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Allow-Headers": "Content-Type, Accept, Cache-Control, Pragma, Authorization, X-App-Key, X-Telegram-Init-Data, X-Staff-Token",
    "Vary": "Origin",
  };
}

export async function signFileUrl(fileId, exp, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(String(secret || "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const data = `${fileId}:${exp}`;
  const sigBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(sigBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyFileSignature(fileId, exp, sig, secret) {
  if (!fileId || !exp || !sig || !secret) return false;
  const expectedSig = await signFileUrl(fileId, exp, secret);
  return safeEqual(sig, expectedSig);
}

export async function deriveFileSigningKey(pepper) {
  if (!pepper || typeof pepper !== 'string') {
    throw new Error("ID_PEPPER is not configured");
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, enc.encode("file-sign:v1"));
  return Array.from(new Uint8Array(sigBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function pbkdf2(secret, saltB64) {
  try {
    const cleanSecret = String(secret || '');
    const salt = Uint8Array.from(atob(String(saltB64 || '')), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(cleanSecret),
      "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
    return btoa(String.fromCharCode(...new Uint8Array(bits)));
  } catch {
    return '';
  }
}

export async function sha256Hex(str) {
  const clean = String(str || '');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clean));
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function createStaffToken(pepper, payload) {
  if (!pepper || typeof pepper !== 'string' || pepper === 'staff-token-pepper') {
    throw new Error("Server configuration error: ID_PEPPER is not configured");
  }
  const enc = new TextEncoder();
  const rawData = JSON.stringify(payload);
  const dataB64 = btoa(unescape(encodeURIComponent(rawData)));
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(dataB64));
  const sig = Array.from(new Uint8Array(sigBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `${dataB64}.${sig}`;
}

export async function verifyStaffToken(token, pepper) {
  if (!token || typeof token !== 'string' || !pepper || pepper === 'staff-token-pepper') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [dataB64, sig] = parts;
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(pepper),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const sigBytes = new Uint8Array(sig.match(/.{1,2}/g)?.map(b => parseInt(b, 16)) || []);
    const isValid = await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(dataB64));
    if (!isValid) return null;
    const rawData = decodeURIComponent(escape(atob(dataB64)));
    const payload = JSON.parse(rawData);
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

const d1Json = (corsHeaders, status, body, extra = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json", ...extra }
});
const d1Unavailable = (corsHeaders) => d1Json(corsHeaders, 503, { error: "Attendance storage temporarily unavailable, retry" }, { "Retry-After": "5" });
const attDeviceId = (request, body, userBlindId) =>
  String((body && body.dev) || request.headers.get("X-Device-Id") || userBlindId || "staff").replace(/[^0-9A-Za-z_-]/g, "_").slice(0, 32);

/** Loads g:<gid> and checks that the caller is staff of that group. Returns {group} or {response}. */

const SUGGEST_QUEUE_MAX = 30;
const SUGGEST_PER_USER_PER_HOUR = 10;
const SUGGEST_PER_GROUP_PER_HOUR = 20;
const SUGGEST_TTL_SECONDS = 30 * 86400;

async function bumpHourlyCounter(env, key, limit) {
  const raw = await env.APP_DATA.get(key);
  const n = raw ? parseInt(raw, 10) || 0 : 0;
  if (n >= limit) return false;
  await env.APP_DATA.put(key, String(n + 1), { expirationTtl: 3600 });
  return true;
}

/**
 * Suggestions in "Полезное":
 *   POST /v3/useful/suggest   student: { gid, item: { title, text, subject, tags, links, attachments } }
 *   GET  /v3/useful/pending   staff: ?gid=... -> { items, notify }
 *   POST /v3/useful/resolve   staff: { gid, id, action: "approve" | "reject" }
 *   POST /v3/useful/notify    staff: { gid, enabled }
 */
async function handleUsefulSuggestions(request, env, corsHeaders, ctx) {
  const { url, userBlindId, tokenPayload, verifiedUser, botToken } = ctx;
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
  const path = url.pathname;

  const readBody = async () => {
    try { return await request.json(); } catch { return null; }
  };
  const loadGroup = async (gidRaw) => {
    const gid = String(gidRaw || '').trim().toLowerCase();
    if (!ATT_GID_RE.test(gid)) return { error: json({ error: "Invalid gid" }, 400) };
    const raw = await env.APP_DATA.get("g:" + gid);
    if (!raw) return { error: json({ error: "У этой группы пока нет старосты в приложении", code: "NO_STAROSTA" }, 404) };
    try { return { gid, groupData: JSON.parse(raw) }; } catch { return { error: json({ error: "Corrupted group record" }, 500) }; }
  };
  const pendingKey = (gid) => `useful-pending:${gid}`;
  const readPending = async (gid) => {
    const raw = await env.APP_DATA.get(pendingKey(gid));
    if (!raw) return [];
    try { const p = JSON.parse(raw); return Array.isArray(p.items) ? p.items : []; } catch { return []; }
  };
  const writePending = (gid, items) =>
    env.APP_DATA.put(pendingKey(gid), JSON.stringify({ items, updatedAt: Date.now() }), { expirationTtl: SUGGEST_TTL_SECONDS });

  // ---- POST /v3/useful/suggest
  if (path === "/v3/useful/suggest" && request.method === "POST") {
    if (!verifiedUser || !userBlindId) {
      return json({ error: "Откройте приложение в Telegram, чтобы отправить материал", code: "NO_TELEGRAM" }, 401);
    }
    const body = await readBody();
    if (!body || typeof body !== 'object') return json({ error: "Invalid JSON body" }, 400);
    const g = await loadGroup(body.gid);
    if (g.error) return g.error;

    if (!(await bumpHourlyCounter(env, `rl:us:${userBlindId}`, SUGGEST_PER_USER_PER_HOUR))) {
      return json({ error: "Слишком много предложений. Попробуйте через час.", code: "RATE_LIMITED" }, 429);
    }
    if (!(await bumpHourlyCounter(env, `rl:ug:${g.gid}`, SUGGEST_PER_GROUP_PER_HOUR))) {
      return json({ error: "В группу сейчас пришло слишком много предложений. Попробуйте позже.", code: "RATE_LIMITED" }, 429);
    }

    const pending = await readPending(g.gid);
    if (pending.length >= SUGGEST_QUEUE_MAX) {
      return json({ error: "У старосты накопилась очередь предложений. Попробуйте позже.", code: "QUEUE_FULL" }, 429);
    }

    const id = `sg_${Date.now().toString(36)}_${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
    const item = sanitizeUsefulItem({
      ...(body.item && typeof body.item === 'object' ? body.item : {}),
      id,
      groupId: g.gid,
      isPending: true,
      createdAt: new Date().toISOString(),
      submittedBy: {
        id: verifiedUser.id,
        username: verifiedUser.username,
        name: [verifiedUser.first_name, verifiedUser.last_name].filter(Boolean).join(' ') || undefined
      }
    }, g.gid);
    if (!item) return json({ error: "Пустое предложение", code: "EMPTY" }, 400);

    pending.unshift(item);
    await writePending(g.gid, pending);

    try {
      if (botToken && env.ID_PEPPER && typeof env.APP_DATA.list === 'function') {
        const listed = await env.APP_DATA.list({ prefix: `un:${g.gid}:` });
        const author = item.submittedBy?.username ? `@${item.submittedBy.username}` : (item.submittedBy?.name || 'студент');
        const text = `📚 Новое предложение в «Полезное» (${g.gid.toUpperCase()})\n«${item.title || item.text.slice(0, 60)}» — от ${author}\n\nОткройте приложение → ДЗ → Полезное, чтобы одобрить или отклонить.`;
        for (const k of (listed.keys || [])) {
          const rawEnc = await env.APP_DATA.get(k.name);
          if (!rawEnc) continue;
          let enc; try { enc = JSON.parse(rawEnc); } catch { continue; }
          const chatId = await decryptChatId(enc.enc, enc.iv, env.ID_PEPPER);
          if (!chatId) continue;
          const tg = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
          });
          if (tg.status === 403 || tg.status === 400) await env.APP_DATA.delete(k.name);
        }
      }
    } catch {}

    return json({ ok: true, id });
  }

  // Everything below is staff only.
  const body = request.method === "GET" ? null : await readBody();
  const g = await loadGroup(request.method === "GET" ? url.searchParams.get("gid") : body?.gid);
  if (g.error) return g.error;
  if (!isAuthorizedStaff(g.groupData, g.gid, userBlindId, tokenPayload)) {
    return json({ error: "Forbidden: not a group staff member" }, 403);
  }

  // ---- GET /v3/useful/pending
  if (path === "/v3/useful/pending" && request.method === "GET") {
    const items = await readPending(g.gid);
    let notify = false;
    if (userBlindId) notify = Boolean(await env.APP_DATA.get(`un:${g.gid}:${userBlindId}`));
    return json({ ok: true, items, notify });
  }

  // ---- POST /v3/useful/resolve
  if (path === "/v3/useful/resolve" && request.method === "POST") {
    const id = String(body?.id || '');
    const action = body?.action;
    if (!id || (action !== 'approve' && action !== 'reject')) return json({ error: "Invalid id or action" }, 400);
    const pending = await readPending(g.gid);
    const found = pending.find(it => it.id === id);
    if (!found) return json({ error: "Предложение не найдено", code: "NOT_FOUND" }, 404);

    await writePending(g.gid, pending.filter(it => it.id !== id));

    if (action === 'approve') {
      const key = `useful:${g.gid}`;
      let slice = {};
      try { slice = JSON.parse((await env.APP_DATA.get(key)) || '{}') || {}; } catch {}
      const items = Array.isArray(slice.items) ? slice.items : [];
      const dead = new Set(Array.isArray(slice.deletedIds) ? slice.deletedIds.map(String) : []);
      if (!dead.has(id) && !items.some(it => it && it.id === id)) {
        const published = sanitizeUsefulItem({ ...found, isPending: false, updatedAt: new Date().toISOString() }, g.gid);
        if (published) {
          delete published.isPending;
          delete published.submittedBy;
          items.unshift(published);
        }
      }
      slice = { ...slice, groupId: g.gid, items: items.slice(0, 200), updatedAt: Date.now() };
      await env.APP_DATA.put(key, JSON.stringify(slice));
    }
    return json({ ok: true, action });
  }

  // ---- POST /v3/useful/notify
  if (path === "/v3/useful/notify" && request.method === "POST") {
    if (!verifiedUser || !userBlindId) return json({ error: "Откройте приложение в Telegram", code: "NO_TELEGRAM" }, 401);
    const key = `un:${g.gid}:${userBlindId}`;
    if (body?.enabled) {
      if (!env.ID_PEPPER) return json({ error: "Server secret unconfigured", code: "NO_PEPPER" }, 500);
      const enc = await encryptChatId(verifiedUser.id, env.ID_PEPPER);
      await env.APP_DATA.put(key, JSON.stringify(enc), { expirationTtl: SUGGEST_TTL_SECONDS });
    } else {
      await env.APP_DATA.delete(key);
    }
    return json({ ok: true, enabled: Boolean(body?.enabled) });
  }

  return json({ error: "Not found" }, 404);
}

async function loadStaffGroup(env, gid, userBlindId, tokenPayload, corsHeaders) {
  const raw = await env.APP_DATA.get("g:" + gid);
  if (!raw) return { response: d1Json(corsHeaders, 404, { error: "Group not found" }) };
  let group;
  try { group = JSON.parse(raw); } catch { return { response: d1Json(corsHeaders, 500, { error: "Corrupted group record" }) }; }
  if (!isAuthorizedStaff(group, gid, userBlindId, tokenPayload)) {
    return { response: d1Json(corsHeaders, 403, { error: "Forbidden: not a group staff member" }) };
  }
  return { group };
}

export function isAuthorizedStaff(groupData, gid, userBlindId, tokenPayload) {
  if (tokenPayload) {
    if (tokenPayload.role === 'admin') return true;
    if (tokenPayload.role === 'starosta' && tokenPayload.gid && String(tokenPayload.gid).toLowerCase() === String(gid).toLowerCase()) {
      return true;
    }
  }
  if (userBlindId && Array.isArray(groupData?.staff) && groupData.staff.includes(userBlindId)) {
    return true;
  }
  return false;
}


export async function blindId(env, tgId) {
  const pepper = env?.ID_PEPPER;
  if (!pepper || typeof pepper !== 'string') {
    throw new Error("Server configuration error: ID_PEPPER is not configured");
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, enc.encode("tg:" + tgId));
  return Array.from(new Uint8Array(sigBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function encryptChatId(chatId, pepper) {
  if (!pepper || typeof pepper !== 'string') {
    throw new Error("Server configuration error: ID_PEPPER is not configured for encryption");
  }
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.digest("SHA-256", enc.encode(pepper));
  const key = await crypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = enc.encode(String(chatId));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  const encHex = Array.from(new Uint8Array(ciphertext)).map(b => b.toString(16).padStart(2, '0')).join('');
  const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
  return { enc: encHex, iv: ivHex };
}

export async function decryptChatId(encHex, ivHex, pepper) {
  if (!pepper || typeof pepper !== 'string') return null;
  try {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.digest("SHA-256", enc.encode(pepper));
    const key = await crypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, ["decrypt"]);
    const iv = new Uint8Array(ivHex.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []);
    const ciphertext = new Uint8Array(encHex.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

export function extractInitDataFromRequest(request) {
  const customHeader = request.headers.get("X-Telegram-Init-Data");
  if (customHeader) return customHeader.trim();

  const authHeader = request.headers.get("Authorization");
  if (authHeader) {
    const candidate = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader.trim();
    // A staff token ("<b64>.<hex>") must never be mistaken for Telegram initData:
    // only values that look like an initData query string are treated as such.
    if (candidate.includes("hash=") && candidate.includes("auth_date=")) return candidate;
  }
  return null;
}

export async function verifyTelegramInitData(initDataStr, botToken, options = {}) {
  if (!initDataStr || typeof initDataStr !== 'string') {
    return { ok: false, error: 'Missing or invalid initData string' };
  }

  const params = new URLSearchParams(initDataStr);
  const hash = params.get('hash');
  if (!hash) {
    return { ok: false, error: 'Missing hash parameter' };
  }

  if (!botToken) {
    return { ok: false, error: 'Missing bot token for verification' };
  }

  const checkKeys = Array.from(new Set(params.keys()))
    .filter(k => k !== 'hash')
    .sort();
  const dataCheckString = checkKeys
    .map(k => `${k}=${params.get(k)}`)
    .join('\n');

  try {
    const enc = new TextEncoder();
    const hmacKey = await crypto.subtle.importKey(
      "raw",
      enc.encode("WebAppData"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const secretKeyBuffer = await crypto.subtle.sign(
      "HMAC",
      hmacKey,
      enc.encode(botToken)
    );

    const checkKey = await crypto.subtle.importKey(
      "raw",
      secretKeyBuffer,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const checkBuffer = await crypto.subtle.sign(
      "HMAC",
      checkKey,
      enc.encode(dataCheckString)
    );

    const calculatedHash = Array.from(new Uint8Array(checkBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    if (!(await safeEqual(calculatedHash.toLowerCase(), hash.toLowerCase()))) {
      return { ok: false, error: 'Invalid HMAC signature (tampered data)' };
    }

    const ignoreAuthDate = options.ignoreAuthDate === true || options.isTestMode === true;

    const authDateStr = params.get('auth_date');
    const authDate = authDateStr ? parseInt(authDateStr, 10) : 0;

    if (!ignoreAuthDate) {
      if (!authDate || isNaN(authDate)) {
        return { ok: false, error: 'Missing or invalid auth_date' };
      }
      const nowSec = Math.floor(Date.now() / 1000);
      if (nowSec - authDate > 86400) {
        return { ok: false, error: 'Telegram initData has expired (> 24 hours)' };
      }
    }

    let user = null;
    const userStr = params.get('user');
    if (userStr) {
      try {
        user = JSON.parse(userStr);
      } catch {
        return { ok: false, error: 'Malformed user JSON in initData' };
      }
    }

    return {
      ok: true,
      user,
      authDate,
      data: Object.fromEntries(params.entries())
    };
  } catch (err) {
    return { ok: false, error: `HMAC verification failed: ${err.message}` };
  }
}

export async function createTelegramInitData(paramsObj, botToken) {
  const enc = new TextEncoder();
  const searchParams = new URLSearchParams();
  for (const [k, v] of Object.entries(paramsObj)) {
    searchParams.set(k, String(v));
  }

  const checkKeys = Array.from(new Set(searchParams.keys()))
    .filter(k => k !== 'hash')
    .sort();
  const dataCheckString = checkKeys
    .map(k => `${k}=${searchParams.get(k)}`)
    .join('\n');

  const hmacKey = await crypto.subtle.importKey(
    "raw",
    enc.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const secretKeyBuffer = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    enc.encode(botToken)
  );

  const checkKey = await crypto.subtle.importKey(
    "raw",
    secretKeyBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const checkBuffer = await crypto.subtle.sign(
    "HMAC",
    checkKey,
    enc.encode(dataCheckString)
  );

  const hash = Array.from(new Uint8Array(checkBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  searchParams.set('hash', hash);
  return searchParams.toString();
}

export async function checkUserGroupAccess(appData, userBlindId, groupId) {
  if (!appData || !userBlindId || !groupId) return false;
  const normalizedGroupId = String(groupId).toLowerCase();

  // Check admin staff
  try {
    const adminRaw = await appData.get("g:admin");
    if (adminRaw) {
      const adminObj = JSON.parse(adminRaw);
      if (Array.isArray(adminObj?.staff) && adminObj.staff.includes(userBlindId)) {
        return true;
      }
    }
  } catch {}

  // Check group staff
  try {
    const groupRaw = await appData.get("g:" + normalizedGroupId);
    if (groupRaw) {
      const groupObj = JSON.parse(groupRaw);
      if (Array.isArray(groupObj?.staff) && groupObj.staff.includes(userBlindId)) {
        return true;
      }
    }
  } catch {}

  return false;
}

const CLAIM_GROUP_ALIASES = {
  // FAID (Факультет архитектуры и дизайна)
  '3-фаид-110': 'faid-310',
  '3-faid-110': 'faid-310',
  '3 фаид 110': 'faid-310',
  'фаид-110': 'faid-310',
  'faid-110': 'faid-310',
  '24фад-110': 'faid-310',
  '24фаид-110': 'faid-310',
  'фаид-310': 'faid-310',
  '3-фаид-310': 'faid-310',

  // INGT (Институт нефтегазовых технологий)
  'ingt-1': 'ingt-301',
  '3-ингт-101': 'ingt-301',
  '3-ingt-101': 'ingt-301',
  '3-ингт-110': 'ingt-310',
  '3-ingt-110': 'ingt-310',
  '3-ингт-111': 'ingt-311',
  '3-ingt-111': 'ingt-311',
  '3-ингт-113': 'ingt-313',
  '3-ingt-113': 'ingt-313',
  '2-ингт-109': 'ingt-209',
  '2-ingt-109': 'ingt-209',

  // IAIT (Институт автоматики и информационных технологий)
  '3-иаит-108': 'iait-308',
  '3-iait-108': 'iait-308',

  // HTF (Химико-технологический факультет)
  '2 хтф 115': 'htf-215',
  '2-хтф-115': 'htf-215',
  '2-htf-115': 'htf-215',
  'хтф-115': 'htf-215',
  'htf-115': 'htf-215'
};

/**
 * POST /v3/staff/claim.
 * Bounded cost: at most 3 PBKDF2 derivations per secret (group, admin) per request, no
 * 5<->S style guessing variants. Rate limiting is keyed by IP (always) and by (group, IP)
 * only for groups that really exist, so rotating fake group ids cannot mint fresh counters
 * or create unbounded KV keys. The group code is checked first; the admin code is a fallback.
 */
async function handleStaffClaim(request, env, corsHeaders, userBlindId) {
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  const { gid, code } = body || {};
  if (!code || typeof code !== 'string' || code.length > 64) {
    return json({ error: "Missing or invalid code" }, 400);
  }

  const rawCode = code.trim().toUpperCase();
  const cleanCode = normalizeAccessCode(code);
  // Bounded typo tolerance: whole-string 5<->S swaps only (2 extra candidates, not 2^k combinations).
  const swapChars = (str, a, b) => str.split(a).join(b);
  const candidates = Array.from(new Set([
    cleanCode,
    rawCode,
    cleanCode.replace(/-/g, ''),
    swapChars(cleanCode, '5', 'S'),
    swapChars(cleanCode, 'S', '5')
  ]));

  const isGroupClaim = Boolean(gid && typeof gid === 'string' && gid.trim() && gid.trim().toLowerCase() !== 'admin');
  const clientIp = request.headers.get("cf-connecting-ip") || "unknown";
  const rawGid = isGroupClaim ? gid.trim().toLowerCase().slice(0, 64) : '';
  const targetGid = CLAIM_GROUP_ALIASES[rawGid] || rawGid;

  const readAttempts = async (key) => rlCount(key);
  const bump = async (key) => { rlBump(key, 900000); };
  const tooMany = () => json({ error: "Too many attempts. Please try again later." }, 429);

  if (env && env.CLAIM_LIMITER && typeof env.CLAIM_LIMITER.limit === 'function') {
    try {
      const verdict = await env.CLAIM_LIMITER.limit({ key: clientIp });
      if (verdict && verdict.success === false) return tooMany();
    } catch {}
  }

  const ipKey = isGroupClaim ? `rl:claim:ip:${clientIp}` : `rl:claim:admin:${userBlindId || clientIp}`;
  const ipLimit = isGroupClaim ? 30 : 5;
  const ipAttempts = await readAttempts(ipKey);
  if (ipAttempts >= ipLimit) return tooMany();

  let groupData = null;
  let groupKvKey = null;
  let groupRlKey = null;
  let groupAttempts = 0;
  if (isGroupClaim) {
    if (!targetGid) {
      await bump(ipKey);
      return json({ error: "Invalid claim code or missing gid" }, 401);
    }
    groupKvKey = "g:" + targetGid;
    let groupRaw = await env.APP_DATA.get(groupKvKey);
    if (!groupRaw && targetGid !== rawGid) {
      groupKvKey = "g:" + rawGid;
      groupRaw = await env.APP_DATA.get(groupKvKey);
    }
    if (groupRaw) {
      groupRlKey = `rl:claim:${targetGid}:${clientIp}`;
      groupAttempts = await readAttempts(groupRlKey);
      if (groupAttempts >= 5) return tooMany();
      try { groupData = JSON.parse(groupRaw); } catch { return json({ error: "Corrupted group record" }, 500); }
    }
  }

  const matches = async (secrets) => {
    if (!secrets || !secrets.codeSalt || !secrets.codeHash) return false;
    for (const cand of candidates) {
      const calc = await pbkdf2(cand, secrets.codeSalt);
      if (await safeEqual(calc, secrets.codeHash)) return true;
    }
    return false;
  };
  const fail = async (status, message) => {
    await bump(ipKey);
    if (groupRlKey) await bump(groupRlKey);
    return json({ error: message }, status);
  };

  // 1. Group code
  if (groupData && await matches(groupData)) {
    if (!env.ID_PEPPER) return json({ error: "Server configuration error: ID_PEPPER missing" }, 500);
    if (groupRlKey) {
      rlClear(groupRlKey);
      try { await env.APP_DATA.delete(groupRlKey); } catch {}
    }
    groupData.staff = Array.isArray(groupData.staff) ? groupData.staff : [];
    if (userBlindId && !groupData.staff.includes(userBlindId)) {
      groupData.staff.push(userBlindId);
      await env.APP_DATA.put(groupKvKey, JSON.stringify(groupData));
    }
    const staffToken = await createStaffToken(env.ID_PEPPER, {
      gid: targetGid,
      role: "starosta",
      exp: Date.now() + 30 * 86400000
    });
    return json({ ok: true, role: "starosta", gid: targetGid, token: staffToken });
  }

  // 2. Admin code (fallback)
  let adminData = null;
  const adminRaw = await env.APP_DATA.get("g:admin");
  if (adminRaw) {
    try { adminData = JSON.parse(adminRaw); } catch {}
  } else if (env.ADMIN_CODE_HASH) {
    adminData = { codeSalt: env.ADMIN_CODE_SALT || "", codeHash: env.ADMIN_CODE_HASH, staff: [] };
  }
  if (adminData && await matches(adminData)) {
    if (!env.ID_PEPPER) return json({ error: "Server configuration error: ID_PEPPER missing" }, 500);
    rlClear(ipKey);
    adminData.staff = Array.isArray(adminData.staff) ? adminData.staff : [];
    if (userBlindId && !adminData.staff.includes(userBlindId)) {
      adminData.staff.push(userBlindId);
      await env.APP_DATA.put("g:admin", JSON.stringify(adminData));
    }
    const staffToken = await createStaffToken(env.ID_PEPPER, {
      gid: "admin",
      role: "admin",
      exp: Date.now() + 30 * 86400000
    });
    return json({ ok: true, role: "admin", token: staffToken });
  }

  // 3. Failure
  if (!isGroupClaim) return fail(401, "Invalid claim code or missing gid");
  if (!groupData) return fail(404, "Group not found");
  if (!groupData.codeSalt || !groupData.codeHash) return fail(403, "Group code not configured");
  return fail(401, "Invalid group code");
}

const ATT_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ATT_GID_RE = /^[^\s:]{1,64}$/u;
const ATT_SLOT_RE = /^[0-9A-Za-z_-]{1,32}$/;
const ATT_LESSON_KEY_RE = /^[0-9A-Za-z._-]{1,24}$/;
const ATT_MAX_SLOTS = 80;
const ATT_MAX_MARKS_PER_SLOT = 400;
const ATT_MAX_CANCELLED = 400;

/** Returns an error message for invalid /v3/att parameters, or null when they are acceptable. */
export function validateAttParams(gid, month) {
  if (typeof gid !== 'string' || !ATT_GID_RE.test(gid)) return "Invalid gid";
  if (typeof month !== 'string' || !ATT_MONTH_RE.test(month)) return "Invalid month (expected YYYY-MM)";
  return null;
}

/** Returns an error message when a PUT /v3/att patch/cancel payload exceeds structural limits, or null. */
export function validateAttPatch(patch, cancel, hours) {
  if (patch !== undefined && patch !== null) {
    if (typeof patch !== 'object' || Array.isArray(patch)) return "Invalid patch";
    const slotIds = Object.keys(patch);
    if (slotIds.length > ATT_MAX_SLOTS) return "Patch has too many slots";
    for (const slotId of slotIds) {
      if (!ATT_SLOT_RE.test(slotId)) return "Invalid slot id in patch";
      const marks = patch[slotId];
      if (marks === null || marks === undefined) continue;
      if (typeof marks !== 'object' || Array.isArray(marks)) return "Invalid slot marks in patch";
      const keys = Object.keys(marks);
      if (keys.length > ATT_MAX_MARKS_PER_SLOT) return "Too many marks for one slot";
      for (const k of keys) if (!ATT_LESSON_KEY_RE.test(k)) return "Invalid lesson key in patch";
    }
  }
  if (cancel !== undefined && cancel !== null) {
    const keys = Array.isArray(cancel) ? cancel : (typeof cancel === 'object' ? Object.keys(cancel) : null);
    if (!keys) return "Invalid cancel";
    if (keys.length > ATT_MAX_CANCELLED) return "Too many cancelled lessons";
    for (const k of keys) if (typeof k !== 'string' && typeof k !== 'number') return "Invalid cancelled lesson key";
    for (const k of keys) if (!ATT_LESSON_KEY_RE.test(String(k))) return "Invalid cancelled lesson key";
  }
  if (hours !== undefined && hours !== null) {
    if (typeof hours !== 'object' || Array.isArray(hours)) return "Invalid hours";
    const entries = Object.entries(hours);
    if (entries.length > ATT_MAX_CANCELLED) return "Too many hours entries";
    for (const [k, v] of entries) {
      if (!ATT_LESSON_KEY_RE.test(k)) return "Invalid hours lesson key";
      if (v !== null && !(Number.isInteger(v) && v >= 1 && v <= 12)) return "Invalid hours value (expected integer 1-12 or null)";
    }
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = getCorsHeaders(request, env, url.pathname);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const TELEGRAM_BOT_TOKEN = (env && env.TELEGRAM_BOT_TOKEN) ? env.TELEGRAM_BOT_TOKEN : "";
    const BOT_TOKEN = TELEGRAM_BOT_TOKEN;
    const CHANNEL_ID = (env && env.TELEGRAM_CHANNEL_ID) ? env.TELEGRAM_CHANNEL_ID : "";

    const APP_SECRET = (env && (env.APP_SECRET || env.X_APP_KEY)) ? (env.APP_SECRET || env.X_APP_KEY) : null;

    try {
      // 0. Maintenance & Service Health Endpoint
      if (url.pathname === "/status" || url.pathname === "/maintenance") {
        const isMaintenance = (env && (env.MAINTENANCE_MODE === "true" || env.MAINTENANCE_MODE === true)) || false;
        const message = (env && env.MAINTENANCE_MESSAGE) || "Ведутся плановые технические работы по обновлению базы данных расписания.";
        const estimatedEndTime = (env && env.MAINTENANCE_UNTIL) || null;
        return new Response(JSON.stringify({
          ok: true,
          maintenance: isMaintenance,
          message,
          estimatedEndTime,
          timestamp: new Date().toISOString()
        }), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Cache-Control": "no-cache, no-store, must-revalidate"
          }
        });
      }

      // 0a. Telegram WebApp HMAC Authentication & Role Assertion (POST /auth/pin) - DEPRECATED (P0-02)
      if (url.pathname === "/auth/pin" && request.method === "POST") {
        return new Response(JSON.stringify({ error: "Deprecated endpoint. Use /v3/staff/claim for authorization." }), {
          status: 410,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 0b. API v3 ("Blind Server" Architecture)
      if (url.pathname.startsWith("/v3/")) {
        const initDataStr = extractInitDataFromRequest(request);
        const authHeader = request.headers.get("Authorization") || "";
        const staffTokenHeader = request.headers.get("X-Staff-Token") || (authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "");

        let tokenPayload = null;
        if (staffTokenHeader) {
          if (env?.ID_PEPPER) {
            tokenPayload = await verifyStaffToken(staffTokenHeader, env.ID_PEPPER);
          }
        }

        let userBlindId = null;
        let verifiedUser = null;
        if (initDataStr) {
          const verifyResult = await verifyTelegramInitData(initDataStr, TELEGRAM_BOT_TOKEN);
          if (!verifyResult.ok) {
            // A valid staff token is sufficient on its own (e.g. initData older than 24h in a long-lived WebView).
            if (!tokenPayload) {
              return new Response(JSON.stringify({ error: verifyResult.error || "Invalid Telegram initData" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }
          } else if (verifyResult.user?.id) {
            verifiedUser = verifyResult.user;
            userBlindId = await blindId(env, verifyResult.user.id);
          }
        }

        const isPublicV3 = url.pathname === "/v3/staff/claim" || url.pathname === "/v3/files/link";
        if (!isPublicV3) {
          if (!userBlindId && !tokenPayload) {
            return new Response(JSON.stringify({ error: "Missing or invalid authorization" }), {
              status: 401,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
        }

        if (!env || !env.APP_DATA) {
          return new Response(JSON.stringify({ error: "Cloudflare KV APP_DATA namespace is not bound" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // 1. POST /v3/staff/claim
        if (url.pathname === "/v3/staff/claim" && request.method === "POST") {
          return handleStaffClaim(request, env, corsHeaders, userBlindId);
        }

        // 2. POST /v3/slots
        if (url.pathname === "/v3/slots" && request.method === "POST") {
          let body;
          try {
            body = await request.json();
          } catch {
            return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          const { gid, slots } = body || {};
          if (!gid || typeof gid !== 'string' || !Array.isArray(slots)) {
            return new Response(JSON.stringify({ error: "Missing or invalid gid or slots" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          const groupRaw = await env.APP_DATA.get("g:" + gid);
          if (!groupRaw) {
            return new Response(JSON.stringify({ error: "Group not found" }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          let groupData;
          try {
            groupData = JSON.parse(groupRaw);
          } catch {
            return new Response(JSON.stringify({ error: "Corrupted group record" }), {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          if (!isAuthorizedStaff(groupData, gid, userBlindId, tokenPayload)) {
            return new Response(JSON.stringify({ error: "Forbidden: not a group staff member" }), {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          groupData.slots = Array.isArray(groupData.slots) ? groupData.slots : [];
          const existingSet = new Set(groupData.slots);
          let newlyRegistered = 0;
          for (const s of slots) {
            const cleanSlot = String(s).trim();
            if (cleanSlot && !existingSet.has(cleanSlot)) {
              existingSet.add(cleanSlot);
              newlyRegistered++;
            }
          }

          if (existingSet.size > 60) {
            return new Response(JSON.stringify({ error: "Maximum of 60 slots per group exceeded" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          groupData.slots = Array.from(existingSet);
          await env.APP_DATA.put("g:" + gid, JSON.stringify(groupData));

          return new Response(JSON.stringify({ ok: true, registered: newlyRegistered }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // 3. POST /v3/invites
        if (url.pathname === "/v3/invites" && request.method === "POST") {
          let body;
          try {
            body = await request.json();
          } catch {
            return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          const { gid, items } = body || {};
          if (!gid || typeof gid !== 'string' || !Array.isArray(items)) {
            return new Response(JSON.stringify({ error: "Missing or invalid gid or items" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          const groupRaw = await env.APP_DATA.get("g:" + gid);
          if (!groupRaw) {
            return new Response(JSON.stringify({ error: "Group not found" }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          let groupData;
          try {
            groupData = JSON.parse(groupRaw);
          } catch {
            return new Response(JSON.stringify({ error: "Corrupted group record" }), {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          if (!isAuthorizedStaff(groupData, gid, userBlindId, tokenPayload)) {
            return new Response(JSON.stringify({ error: "Forbidden: not a group staff member" }), {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          const TTL_14_DAYS = 1209600;
          let count = 0;
          for (const it of items) {
            if (it && it.slot && it.hash) {
              const cleanHash = String(it.hash).toLowerCase().trim();
              const cleanSlot = String(it.slot).trim();
              await env.APP_DATA.put("inv:" + cleanHash, JSON.stringify({ gid, slot: cleanSlot }), {
                expirationTtl: TTL_14_DAYS
              });
              count++;
            }
          }

          return new Response(JSON.stringify({ ok: true, count }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        
        if (url.pathname.startsWith("/v3/useful/")) {
          return await handleUsefulSuggestions(request, env, corsHeaders, {
            url,
            userBlindId,
            tokenPayload,
            verifiedUser,
            botToken: TELEGRAM_BOT_TOKEN
          });
        }

        // 4. GET /v3/att
        if (url.pathname === "/v3/att" && request.method === "GET") {
          const gid = url.searchParams.get("gid");
          const month = url.searchParams.get("month");
          if (!gid || !month) {
            return new Response(JSON.stringify({ error: "Missing gid or month query parameter" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
          {
            const paramError = validateAttParams(gid, month);
            if (paramError) {
              return new Response(JSON.stringify({ error: paramError }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }
          }

          const groupRaw = await env.APP_DATA.get("g:" + gid);
          if (!groupRaw) {
            return new Response(JSON.stringify({ error: "Group not found" }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          let groupData;
          try {
            groupData = JSON.parse(groupRaw);
          } catch {
            return new Response(JSON.stringify({ error: "Corrupted group record" }), {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          if (!isAuthorizedStaff(groupData, gid, userBlindId, tokenPayload)) {
            return new Response(JSON.stringify({ error: "Forbidden: not a group staff member" }), {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          let getStorage;
          try { getStorage = await attStorage(env, gid); } catch { return d1Unavailable(corsHeaders); }
          if (getStorage === 'd1') {
            try { return d1Json(corsHeaders, 200, await readMonth(env, gid, month), { "Cache-Control": "private, no-store" }); } catch { return d1Unavailable(corsHeaders); }
          }

          const attRaw = await env.APP_DATA.get(`a:${gid}:${month}`);
          let monthData = { ver: 0, slots: {}, cancelled: [], hours: {} };
          if (attRaw) {
            try {
              const parsed = JSON.parse(attRaw);
              monthData = {
                ver: Number(parsed.ver) || 0,
                slots: (parsed.slots && typeof parsed.slots === 'object') ? parsed.slots : {},
                cancelled: Array.isArray(parsed.cancelled) ? parsed.cancelled : [],
                hours: (parsed.hours && typeof parsed.hours === 'object' && !Array.isArray(parsed.hours)) ? parsed.hours : {},
                updatedAt: Number(parsed.updatedAt) || 0
              };
            } catch {}
          }

          return new Response(JSON.stringify(monthData), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store" }
          });
        }

        // 5. PUT /v3/att
        if (url.pathname === "/v3/att" && request.method === "PUT") {
          let body;
          try {
            body = await request.json();
          } catch {
            return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          const { gid, month, baseVer, patch, cancel, hours } = body || {};
          if (!gid || !month || typeof gid !== 'string' || typeof month !== 'string') {
            return new Response(JSON.stringify({ error: "Missing or invalid gid or month" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
          {
            const paramError = validateAttParams(gid, month) || validateAttPatch(patch, cancel, hours);
            if (paramError) {
              return new Response(JSON.stringify({ error: paramError }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }
          }

          const groupRaw = await env.APP_DATA.get("g:" + gid);
          if (!groupRaw) {
            return new Response(JSON.stringify({ error: "Group not found" }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          let groupData;
          try {
            groupData = JSON.parse(groupRaw);
          } catch {
            return new Response(JSON.stringify({ error: "Corrupted group record" }), {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          if (!isAuthorizedStaff(groupData, gid, userBlindId, tokenPayload)) {
            return new Response(JSON.stringify({ error: "Forbidden: not a group staff member" }), {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          let putStorage;
          try { putStorage = await attStorage(env, gid); } catch { return d1Unavailable(corsHeaders); }
          if (putStorage === 'd1') {
            // Cell-level ops: no read-modify-write, no version conflicts. baseVer is accepted and ignored.
            try {
              const res = await applyLegacyPatch(env, gid, month, patch, cancel, hours, { dev: attDeviceId(request, null, userBlindId) });
              if (!res.ok) return d1Json(corsHeaders, 400, { error: res.error });
              return d1Json(corsHeaders, 200, { ok: true, ver: res.rev, updatedAt: res.updatedAt });
            } catch { return d1Unavailable(corsHeaders); }
          }

          const attRaw = await env.APP_DATA.get(`a:${gid}:${month}`);
          let current = { ver: 0, slots: {}, cancelled: [], hours: {}, updatedAt: 0 };
          if (attRaw) {
            try {
              const parsed = JSON.parse(attRaw);
              current = {
                ver: Number(parsed.ver) || 0,
                slots: (parsed.slots && typeof parsed.slots === 'object') ? parsed.slots : {},
                cancelled: Array.isArray(parsed.cancelled) ? parsed.cancelled : [],
                hours: (parsed.hours && typeof parsed.hours === 'object' && !Array.isArray(parsed.hours)) ? parsed.hours : {},
                updatedAt: Number(parsed.updatedAt) || 0
              };
            } catch {}
          }

          const expectedBaseVer = (baseVer !== undefined && baseVer !== null) ? Number(baseVer) : 0;
          if (current.ver > 0 && current.ver !== expectedBaseVer) {
            return new Response(JSON.stringify({
              error: "Conflict: data was modified by another session",
              currentVer: current.ver,
              ver: current.ver,
              slots: current.slots,
              cancelled: current.cancelled,
              hours: current.hours,
              updatedAt: current.updatedAt
            }), {
              status: 409,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          if (patch && typeof patch === 'object') {
            for (const [slotId, slotMarks] of Object.entries(patch)) {
              if (slotMarks && typeof slotMarks === 'object') {
                current.slots[slotId] = current.slots[slotId] || {};
                for (const [lessonKey, val] of Object.entries(slotMarks)) {
                  if (val === null || val === undefined || val === '') {
                    delete current.slots[slotId][lessonKey];
                  } else if (val === 'e' || val === 'u') {
                    current.slots[slotId][lessonKey] = val;
                  }
                }
              }
            }
          }

          if (cancel !== undefined && cancel !== null) {
            if (Array.isArray(cancel)) {
              current.cancelled = cancel.map(String);
            } else if (typeof cancel === 'object') {
              const cancelledSet = new Set(current.cancelled);
              for (const [lessonKey, shouldCancel] of Object.entries(cancel)) {
                if (shouldCancel === true) {
                  cancelledSet.add(lessonKey);
                } else if (shouldCancel === null || shouldCancel === false) {
                  cancelledSet.delete(lessonKey);
                }
              }
              current.cancelled = Array.from(cancelledSet);
            }
          }

          if (hours && typeof hours === 'object' && !Array.isArray(hours)) {
            for (const [lessonKey, val] of Object.entries(hours)) {
              if (val === null) delete current.hours[lessonKey];
              else if (Number.isInteger(val) && val >= 1 && val <= 12) current.hours[lessonKey] = val;
            }
          }

          const newVer = (current.ver || 0) + 1;
          current.ver = newVer;
          current.updatedAt = Date.now();

          const TTL_200_DAYS = 17280000;
          await env.APP_DATA.put(`a:${gid}:${month}`, JSON.stringify(current), {
            expirationTtl: TTL_200_DAYS
          });

          return new Response(JSON.stringify({ ok: true, ver: newVer, updatedAt: current.updatedAt }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // 5b. POST /v3/att/ops  (D1 groups only): idempotent cell-level operations
        if (url.pathname === "/v3/att/ops" && request.method === "POST") {
          let body;
          try { body = await request.json(); } catch { return d1Json(corsHeaders, 400, { error: "Invalid JSON body" }); }
          const gid = body && body.gid;
          const paramError = typeof gid !== 'string' ? "Missing gid" : validateAttParams(gid, "2000-01");
          if (paramError) return d1Json(corsHeaders, 400, { error: paramError });
          const auth = await loadStaffGroup(env, gid, userBlindId, tokenPayload, corsHeaders);
          if (auth.response) return auth.response;
          let storage;
          try { storage = await attStorage(env, gid); } catch { return d1Unavailable(corsHeaders); }
          if (storage !== 'd1') return d1Json(corsHeaders, 409, { error: "Group is not migrated to D1", code: "NOT_D1" });
          const norm = normalizeOps(body.ops, { month: typeof body.month === 'string' ? body.month : null });
          if (!norm.ok) return d1Json(corsHeaders, 400, { error: norm.error });
          try {
            const res = await applyOps(env, gid, norm.ops, { dev: attDeviceId(request, body, userBlindId) });
            return d1Json(corsHeaders, 200, { ok: true, rev: res.rev, applied: norm.ops.length });
          } catch { return d1Unavailable(corsHeaders); }
        }

        // 5c. GET /v3/att/changes?gid=&since=&limit=  (D1 groups only)
        if (url.pathname === "/v3/att/changes" && request.method === "GET") {
          const gid = url.searchParams.get("gid") || "";
          const paramError = validateAttParams(gid, "2000-01");
          if (paramError) return d1Json(corsHeaders, 400, { error: paramError });
          const auth = await loadStaffGroup(env, gid, userBlindId, tokenPayload, corsHeaders);
          if (auth.response) return auth.response;
          let storage;
          try { storage = await attStorage(env, gid); } catch { return d1Unavailable(corsHeaders); }
          if (storage !== 'd1') return d1Json(corsHeaders, 409, { error: "Group is not migrated to D1", code: "NOT_D1" });
          try {
            const out = await readChanges(env, gid, url.searchParams.get("since"), url.searchParams.get("limit"));
            return d1Json(corsHeaders, 200, { ok: true, ...out }, { "Cache-Control": "private, no-store" });
          } catch { return d1Unavailable(corsHeaders); }
        }

        // 5d. POST /v3/admin/att/migrate {gid, mode: status|copy|flip|rollback}  (admin only)
        if (url.pathname === "/v3/admin/att/migrate" && request.method === "POST") {
          const isAdminCaller = Boolean(tokenPayload && tokenPayload.role === 'admin') ||
            Boolean(env.ADMIN_BLIND_ID && userBlindId && userBlindId === env.ADMIN_BLIND_ID);
          if (!isAdminCaller) return d1Json(corsHeaders, 403, { error: "Forbidden: admin only" });
          if (!hasD1(env)) return d1Json(corsHeaders, 500, { error: "D1 binding DB is not configured" });
          let body;
          try { body = await request.json(); } catch { return d1Json(corsHeaders, 400, { error: "Invalid JSON body" }); }
          const gid = body && body.gid;
          const paramError = typeof gid !== 'string' ? "Missing gid" : validateAttParams(gid, "2000-01");
          if (paramError) return d1Json(corsHeaders, 400, { error: paramError });
          if (!(await env.APP_DATA.get("g:" + gid))) return d1Json(corsHeaders, 404, { error: "Group not found" });
          const mode = body.mode;
          try {
            const storage = await attStorage(env, gid);
            if (mode === 'status') {
              return d1Json(corsHeaders, 200, { ok: true, storage, rev: await currentRev(env, gid), verify: await migrateVerify(env, gid, { exact: storage !== 'd1' }) });
            }
            if (mode === 'copy') {
              const copied = await migrateCopy(env, gid);
              return d1Json(corsHeaders, 200, { ok: true, storage, copied, verify: await migrateVerify(env, gid, { exact: storage !== 'd1' }) });
            }
            if (mode === 'flip') {
              if (storage === 'd1') return d1Json(corsHeaders, 200, { ok: true, storage: 'd1', already: true });
              const verify = await migrateVerify(env, gid, { exact: true });
              if (!verify.ok) return d1Json(corsHeaders, 409, { error: "D1 does not match KV yet, run copy first", verify });
              await migrateFlip(env, gid);
              return d1Json(corsHeaders, 200, { ok: true, storage: 'd1', verify });
            }
            if (mode === 'rollback') {
              if (storage !== 'd1') return d1Json(corsHeaders, 200, { ok: true, storage: 'kv', already: true });
              const out = await migrateRollback(env, gid);
              return d1Json(corsHeaders, 200, { ok: true, storage: 'kv', exported: out.months });
            }
            return d1Json(corsHeaders, 400, { error: "mode must be status, copy, flip or rollback" });
          } catch (err) {
            return d1Json(corsHeaders, 500, { error: "Migration step failed", detail: String(err && err.message).slice(0, 200) });
          }
        }

        // 6. POST /v3/student/link (and /v3/me/claim)
        if ((url.pathname === "/v3/student/link" || url.pathname === "/v3/me/claim") && request.method === "POST") {
          if (!userBlindId) {
            return new Response(JSON.stringify({ error: "Unauthorized: Telegram WebApp context is required for student linking" }), {
              status: 401,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
          let body;
          try {
            body = await request.json();
          } catch {
            return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          const { code, consentVer } = body || {};
          if (!code || typeof code !== 'string') {
            return new Response(JSON.stringify({ error: "Missing or invalid invite code" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          const rlKey = `rl:link:${userBlindId}`;
          const attemptsRaw = await env.APP_DATA.get(rlKey);
          const attempts = attemptsRaw ? parseInt(attemptsRaw, 10) : 0;
          if (attempts >= 5) {
            return new Response(JSON.stringify({ error: "Too many attempts. Please try again later." }), {
              status: 429,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          const rawCode = code.trim().toUpperCase();
          const cleanCode = rawCode.replace(/[^0-9A-Z]/g, '');
          const cleanHash = (await sha256Hex(cleanCode)).toLowerCase();
          const rawHash = (await sha256Hex(rawCode)).toLowerCase();

          let invRaw = await env.APP_DATA.get("inv:" + cleanHash);
          let matchedHash = cleanHash;
          if (!invRaw && rawHash !== cleanHash) {
            invRaw = await env.APP_DATA.get("inv:" + rawHash);
            matchedHash = rawHash;
          }
          if (!invRaw) {
            await env.APP_DATA.put(rlKey, String(attempts + 1), { expirationTtl: 900 });
            return new Response(JSON.stringify({ error: "Invalid or expired invite code" }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          let invData;
          try {
            invData = JSON.parse(invRaw);
          } catch {
            await env.APP_DATA.put(rlKey, String(attempts + 1), { expirationTtl: 900 });
            return new Response(JSON.stringify({ error: "Invalid or expired invite code" }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          await env.APP_DATA.delete(rlKey);
          await env.APP_DATA.delete("inv:" + matchedHash);

          const userData = {
            gid: invData.gid,
            slot: invData.slot,
            consentVer: Number(consentVer) || 1,
            consentAt: Date.now()
          };
          await env.APP_DATA.put("u:" + userBlindId, JSON.stringify(userData));

          return new Response(JSON.stringify({ ok: true, gid: invData.gid, slot: invData.slot }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // 7. GET /v3/me
        if (url.pathname === "/v3/me" && request.method === "GET") {
          if (!userBlindId) {
            return new Response(JSON.stringify({ error: "Unauthorized: Telegram WebApp context is required" }), {
              status: 401,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
          const userRaw = await env.APP_DATA.get("u:" + userBlindId);
          if (!userRaw) {
            return new Response(JSON.stringify({ ok: true, linked: false }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store" }
            });
          }

          let userData;
          try {
            userData = JSON.parse(userRaw);
          } catch {
            return new Response(JSON.stringify({ ok: true, linked: false }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store" }
            });
          }

          if (!userData || !userData.gid || !userData.slot) {
            return new Response(JSON.stringify({ ok: true, linked: false }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store" }
            });
          }

          const now = new Date(Date.now() + 4 * 60 * 60 * 1000);
          const explicitMonth = url.searchParams.get("month") || url.searchParams.get("from");

          let targetMonths = [];
          if (explicitMonth) {
            targetMonths = [explicitMonth];
          } else {
            // Aggregate all active months of current semester
            const y = now.getUTCFullYear();
            const m = now.getUTCMonth() + 1;
            if (m >= 8) {
              for (let mon = 8; mon <= 12; mon++) {
                targetMonths.push(`${y}-${String(mon).padStart(2, '0')}`);
              }
            } else {
              for (let mon = 2; mon <= 7; mon++) {
                targetMonths.push(`${y}-${String(mon).padStart(2, '0')}`);
              }
            }
          }

          let meStorage;
          try { meStorage = await attStorage(env, userData.gid); } catch { return d1Unavailable(corsHeaders); }
          if (meStorage === 'd1') {
            const months = targetMonths.filter(m => /^\d{4}-(0[1-9]|1[0-2])$/.test(m)).sort();
            try {
              const own = months.length
                ? await readStudentMarks(env, userData.gid, userData.slot, months[0], months[months.length - 1])
                : { marks: {}, cancelled: [] };
              return d1Json(corsHeaders, 200, {
                ok: true, linked: true, gid: userData.gid, slot: userData.slot,
                consentVer: userData.consentVer, consentAt: userData.consentAt,
                marks: own.marks, cancelled: own.cancelled
              }, { "Cache-Control": "private, no-store" });
            } catch { return d1Unavailable(corsHeaders); }
          }

          const aggregatedMarks = {};
          const aggregatedCancelled = new Set();

          for (const m of targetMonths) {
            const attRaw = await env.APP_DATA.get(`a:${userData.gid}:${m}`);
            if (attRaw) {
              try {
                const parsed = JSON.parse(attRaw);
                const slots = (parsed.slots && typeof parsed.slots === 'object') ? parsed.slots : {};
                const userMarks = slots[userData.slot] || {};
                Object.assign(aggregatedMarks, userMarks);
                if (Array.isArray(parsed.cancelled)) {
                  parsed.cancelled.forEach(c => aggregatedCancelled.add(c));
                }
              } catch {}
            }
          }

          return new Response(JSON.stringify({
            ok: true,
            linked: true,
            gid: userData.gid,
            slot: userData.slot,
            consentVer: userData.consentVer,
            consentAt: userData.consentAt,
            marks: aggregatedMarks,
            cancelled: Array.from(aggregatedCancelled)
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store" }
          });
        }

        // 8. DELETE /v3/me
        if (url.pathname === "/v3/me" && request.method === "DELETE") {
          if (!userBlindId) {
            return new Response(JSON.stringify({ error: "Unauthorized: Telegram WebApp context is required" }), {
              status: 401,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
          const userRaw = await env.APP_DATA.get("u:" + userBlindId);
          if (!userRaw) {
            return new Response(JSON.stringify({ ok: true, deleted: false }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          let userData = null;
          try {
            userData = JSON.parse(userRaw);
          } catch {}

          await env.APP_DATA.delete("u:" + userBlindId);

          if (userData && userData.gid && userData.slot) {
            const slotsRaw = await env.APP_DATA.get("s:" + userData.gid);
            if (slotsRaw) {
              try {
                const slotsData = JSON.parse(slotsRaw);
                if (slotsData.slots && slotsData.slots[userData.slot]) {
                  delete slotsData.slots[userData.slot].claimedAt;
                  delete slotsData.slots[userData.slot].claimed;
                  await env.APP_DATA.put("s:" + userData.gid, JSON.stringify(slotsData), { expirationTtl: 17280000 });
                }
              } catch {}
            }

            // ИСПРАВЛЕНО (A-5): Журнал посещаемости принадлежит группе и деканату.
            // Студент при отвязке аккаунта удаляет только свою связку u:{blindId},
            // но НЕ может стереть выставленные старостой пропуски в a:{gid}:{month}.
          }

          return new Response(JSON.stringify({ ok: true, deleted: true }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // 9. DELETE /v3/slot/:id
        if ((url.pathname.startsWith("/v3/slot/") || url.pathname.startsWith("/v3/slots/")) && request.method === "DELETE") {
          const slotId = url.pathname.split("/").pop();
          const gid = url.searchParams.get("gid");
          if (!gid || !slotId) {
            return new Response(JSON.stringify({ error: "Missing gid or slot id" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          const groupRaw = await env.APP_DATA.get("g:" + gid);
          if (!groupRaw) {
            return new Response(JSON.stringify({ error: "Group not found" }), {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          let groupData;
          try {
            groupData = JSON.parse(groupRaw);
          } catch {
            return new Response(JSON.stringify({ error: "Corrupted group record" }), {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          if (!isAuthorizedStaff(groupData, gid, userBlindId, tokenPayload)) {
            return new Response(JSON.stringify({ error: "Forbidden: not a group staff member" }), {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          if (Array.isArray(groupData.slots)) {
            groupData.slots = groupData.slots.filter(s => s !== slotId);
            await env.APP_DATA.put("g:" + gid, JSON.stringify(groupData));
          }

          let delStorage;
          try { delStorage = await attStorage(env, gid); } catch { return d1Unavailable(corsHeaders); }
          if (delStorage === 'd1') {
            try { await deleteSlotMarks(env, gid, slotId); } catch { return d1Unavailable(corsHeaders); }
            return d1Json(corsHeaders, 200, { ok: true });
          }

          const targetMonths = new Set();
          if (url.searchParams.get("month")) {
            targetMonths.add(url.searchParams.get("month"));
          }
          const now = new Date(Date.now() + 4 * 60 * 60 * 1000);
          const y = now.getUTCFullYear();
          for (let m = 1; m <= 12; m++) {
            targetMonths.add(`${y}-${String(m).padStart(2, '0')}`);
            targetMonths.add(`${y - 1}-${String(m).padStart(2, '0')}`);
          }
          if (typeof env.APP_DATA.list === 'function') {
            try {
              const listRes = await env.APP_DATA.list({ prefix: `a:${gid}:` });
              if (listRes && Array.isArray(listRes.keys)) {
                for (const k of listRes.keys) {
                  const mMatch = k.name.replace(`a:${gid}:`, '');
                  if (mMatch) targetMonths.add(mMatch);
                }
              }
            } catch {}
          }

          for (const monthStr of targetMonths) {
            const attKey = `a:${gid}:${monthStr}`;
            const attRaw = await env.APP_DATA.get(attKey);
            if (attRaw) {
              try {
                const parsed = JSON.parse(attRaw);
                if (parsed.slots && parsed.slots[slotId]) {
                  delete parsed.slots[slotId];
                  parsed.ver = (parsed.ver || 0) + 1;
                  await env.APP_DATA.put(attKey, JSON.stringify(parsed), { expirationTtl: 17280000 });
                }
              } catch {}
            }
          }

          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // 9. GET /v3/roster (Encrypted Zero-Knowledge Roster Backup)
        if (url.pathname === "/v3/roster" && request.method === "GET") {
          const gid = url.searchParams.get("gid");
          if (!gid) {
            return new Response(JSON.stringify({ error: "Missing gid query parameter" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
          const canonicalGid = gid.trim().toLowerCase();
          const groupRaw = await env.APP_DATA.get("g:" + canonicalGid);
          let groupData = null;
          try { if (groupRaw) groupData = JSON.parse(groupRaw); } catch {}

          if (!isAuthorizedStaff(groupData, canonicalGid, userBlindId, tokenPayload)) {
            return new Response(JSON.stringify({ error: "Forbidden: not a group staff member" }), {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          const rosterRaw = await env.APP_DATA.get("r:" + canonicalGid);
          let rosterData = null;
          if (rosterRaw) {
            try { rosterData = JSON.parse(rosterRaw); } catch {}
          }

          return new Response(JSON.stringify({ ok: true, roster: rosterData }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store" }
          });
        }

        // 10. PUT /v3/roster (Encrypted Zero-Knowledge Roster Backup)
        if (url.pathname === "/v3/roster" && request.method === "PUT") {
          let body;
          try { body = await request.json(); } catch {
            return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
          const { gid, data, iv, salt, ver } = body || {};
          if (!gid || !data || !iv || !salt) {
            return new Response(JSON.stringify({ error: "Missing required fields (gid, data, iv, salt)" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
          const canonicalGid = String(gid).trim().toLowerCase();
          const groupRaw = await env.APP_DATA.get("g:" + canonicalGid);
          let groupData = null;
          try { if (groupRaw) groupData = JSON.parse(groupRaw); } catch {}

          if (!isAuthorizedStaff(groupData, canonicalGid, userBlindId, tokenPayload)) {
            return new Response(JSON.stringify({ error: "Forbidden: not a group staff member" }), {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          if (String(data).length > 50000 || String(iv).length > 100 || String(salt).length > 100) {
            return new Response(JSON.stringify({ error: "Roster payload too large" }), {
              status: 413,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          const existingRaw = await env.APP_DATA.get("r:" + canonicalGid);
          let existingVer = 0;
          if (existingRaw) {
            try { existingVer = JSON.parse(existingRaw)?.ver || 0; } catch {}
          }
          // Optional optimistic concurrency: a client that sends its last known `ver` gets 409 when it is stale.
          if (typeof ver === 'number' && existingVer > 0 && ver !== existingVer) {
            return new Response(JSON.stringify({ error: "Conflict: roster was modified by another session", ver: existingVer }), {
              status: 409,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
          const nextVer = existingVer + 1;
          const payloadToStore = {
            ver: nextVer,
            data: String(data).slice(0, 50000),
            iv: String(iv).slice(0, 100),
            salt: String(salt).slice(0, 100),
            updatedAt: Date.now()
          };
          await env.APP_DATA.put("r:" + canonicalGid, JSON.stringify(payloadToStore));

          return new Response(JSON.stringify({ ok: true, ver: nextVer }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // 11. GET/POST /v3/files/link (Dynamic 10-Minute Signed File Link)
        if (url.pathname === "/v3/files/link") {
          let fileId = null;
          let fileName = "file";
          if (request.method === "POST") {
            try {
              const body = await request.json();
              fileId = body.file_id || body.fileId;
              fileName = body.filename || body.fileName || "file";
            } catch (e) {
              return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }
          } else if (request.method === "GET") {
            fileId = url.searchParams.get("file_id") || url.searchParams.get("fileId");
            fileName = url.searchParams.get("filename") || url.searchParams.get("name") || "file";
          } else {
            return new Response(JSON.stringify({ error: "Method not allowed" }), {
              status: 405,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          if (!fileId || typeof fileId !== "string" || fileId.length < 5) {
            return new Response(JSON.stringify({ error: "Missing or invalid file_id" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          if (!env || !env.ID_PEPPER) {
            return new Response(JSON.stringify({ error: "Internal server error: ID_PEPPER missing" }), {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          const signingKey = await deriveFileSigningKey(env.ID_PEPPER);
          const exp = Math.floor(Date.now() / 1000) + 600; // 10 minutes TTL
          const sig = await signFileUrl(fileId, exp, signingKey);
          const directUrl = `${url.origin}/file?file_id=${fileId}&exp=${exp}&sig=${sig}&download=1&filename=${encodeURIComponent(fileName)}`;

          return new Response(JSON.stringify({
            ok: true,
            file_id: fileId,
            filename: fileName,
            exp: exp,
            sig: sig,
            direct_url: directUrl
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        return new Response(JSON.stringify({ error: "Not Found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 0b. Bug Report Bot Relay Endpoint (POST /report)
      if (url.pathname === "/report" && request.method === "POST") {
        const initDataStr = extractInitDataFromRequest(request);
        if (!initDataStr) {
          return new Response(JSON.stringify({ error: "Unauthorized: Missing Telegram initData" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const verifyResult = await verifyTelegramInitData(initDataStr, TELEGRAM_BOT_TOKEN);
        if (!verifyResult.ok) {
          return new Response(JSON.stringify({ error: verifyResult.error || "Invalid Telegram initData" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const user = verifyResult.user;
        if (!user || !user.id) {
          return new Response(JSON.stringify({ error: "Missing user in Telegram initData" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        if (!env || !env.APP_DATA) {
          return new Response(JSON.stringify({ error: "Cloudflare KV APP_DATA namespace is not bound" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const userBlindId = await blindId(env, user.id);
        const rlKey = `rl:report:${userBlindId}`;
        const attemptsRaw = await env.APP_DATA.get(rlKey);
        const attempts = attemptsRaw ? parseInt(attemptsRaw, 10) : 0;
        if (attempts >= 5) {
          return new Response(JSON.stringify({ error: "Too many reports. Rate limit exceeded (max 5 per hour)." }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        let body;
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const text = String(body?.text || "").trim().slice(0, 2000);
        if (!text) {
          return new Response(JSON.stringify({ error: "Report text is required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        let diagStr = "";
        if (body?.diag !== undefined && body?.diag !== null) {
          diagStr = typeof body.diag === "string" ? body.diag : JSON.stringify(body.diag, null, 2);
          diagStr = diagStr.slice(0, 4000);
        }

        const wantReply = Boolean(body?.wantReply);
        const DEV_CHAT_ID = env && (env.DEV_CHAT_ID || env.TELEGRAM_DEV_CHAT_ID || env.CHANNEL_ID || CHANNEL_ID);
        if (!DEV_CHAT_ID) {
          return new Response(JSON.stringify({ error: "Owner chat ID is not configured" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        let devMessageText = `📩 Новое обращение от пользователя:\n\n${text}`;
        if (diagStr) {
          devMessageText += `\n\n📊 Диагностика:\n${diagStr}`;
        }
        if (wantReply) {
          devMessageText += `\n\n💬 Пользователь ожидает ответ. Ответьте через Reply на это сообщение.`;
        }

        let sentMessageId = null;
        if (BOT_TOKEN) {
          const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: DEV_CHAT_ID,
              text: devMessageText
            })
          });
          const tgJson = await tgRes.json().catch(() => ({}));
          if (tgJson && tgJson.ok && tgJson.result && tgJson.result.message_id) {
            sentMessageId = tgJson.result.message_id;
          }
        }
 
        if (!sentMessageId && env && env.APP_DATA) {
          try {
            const reportKey = `report:${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
            await env.APP_DATA.put(reportKey, JSON.stringify({
              timestamp: Date.now(),
              text,
              diag: diagStr,
              wantReply,
              userBlindId,
              note: "Telegram send failed or offline; stored in database"
            }), { expirationTtl: 2592000 });
          } catch {}
        }

        if (wantReply && sentMessageId) {
          const encData = await encryptChatId(user.id, env.ID_PEPPER);
          await env.APP_DATA.put(`rm:${sentMessageId}`, JSON.stringify(encData), {
            expirationTtl: 2592000 // 30 days
          });
        }

        await env.APP_DATA.put(rlKey, String(attempts + 1), { expirationTtl: 3600 });

        return new Response(JSON.stringify({ ok: true, sent: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 0c. Telegram Bot Webhook Endpoint (POST /tg/webhook or /tg/webhook/*)
      if ((url.pathname === "/tg/webhook" || url.pathname.startsWith("/tg/webhook/")) && request.method === "POST") {
        // AUD-020: no fallback to APP_SECRET — the webhook secret must be its own value.
        const expectedSecret = env && (env.TG_WEBHOOK_SECRET || env.TELEGRAM_WEBHOOK_SECRET);
        const headerSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
        const pathSecret = url.pathname.startsWith("/tg/webhook/")
          ? url.pathname.slice("/tg/webhook/".length).replace(/^\/+|\/+$/g, "")
          : null;

        if (expectedSecret) {
          const headerOk = headerSecret ? await safeEqual(headerSecret, String(expectedSecret)) : false;
          const pathOk = pathSecret ? await safeEqual(pathSecret, String(expectedSecret)) : false;
          if (!headerOk && !pathOk) {
            return new Response(JSON.stringify({ error: "Unauthorized: Invalid webhook secret" }), {
              status: 401,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
        } else {
          // Fail closed; the message must not disclose which secret is missing.
          return new Response(JSON.stringify({ error: "Service unavailable" }), {
            status: 503,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        let update;
        try {
          update = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const msg = update?.message;
        const DEV_CHAT_ID = env && (env.DEV_CHAT_ID || env.TELEGRAM_DEV_CHAT_ID || env.CHANNEL_ID || CHANNEL_ID);

                // /start and /help in a private chat
        if (msg && msg.chat && msg.chat.type === "private" && typeof msg.text === "string" && BOT_TOKEN) {
          const cmd = /^\/(start|help)(?:@\w+)?(?:\s|$)/i.exec(msg.text);
          if (cmd) {
            const isHelp = cmd[1].toLowerCase() === "help";
            const miniAppUrl = (env && env.MINIAPP_URL) || "https://djaicixlw.github.io/samgtu-schedule/";
            const welcome =
              "<b>Расписание СамГТУ</b>\n\n" +
              "📅 Пары вашей группы на 4 недели\n" +
              "📝 Домашние задания и полезные материалы\n" +
              "✅ Посещаемость: староста отмечает, вы видите свои пропуски\n\n" +
              "Нажмите кнопку ниже и выберите свою группу." +
              (isHelp
                ? "\n\n<b>Староста:</b> откройте вкладку «Админ» и введите код доступа группы.\n" +
                  "<b>Нашли ошибку?</b> Нажмите значок жука в шапке приложения."
                : "") +
              "\n\n<i>Неофициальный студенческий проект, не связан с администрацией СамГТУ.</i>";
            try {
              await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: msg.chat.id,
                  text: welcome,
                  parse_mode: "HTML",
                  disable_web_page_preview: true,
                  reply_markup: { inline_keyboard: [[{ text: "📅 Открыть расписание", web_app: { url: miniAppUrl } }]] }
                })
              });
            } catch (e) {}
            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
        }

        if (msg && msg.from && String(msg.from.id) === String(DEV_CHAT_ID) && msg.reply_to_message) {
          const replyMsgId = msg.reply_to_message.message_id;
          if (env && env.APP_DATA) {
            const rawEnc = await env.APP_DATA.get(`rm:${replyMsgId}`);
            if (rawEnc) {
              let encData = null;
              try {
                encData = JSON.parse(rawEnc);
              } catch {}
              if (encData && encData.enc && encData.iv) {
                const studentChatId = await decryptChatId(encData.enc, encData.iv, env.ID_PEPPER);
                if (studentChatId) {
                  const replyText = msg.text || "";
                  const textToSend = `💬 Ответ разработчика на ваше обращение:\n\n${replyText}`;
                  if (BOT_TOKEN) {
                    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        chat_id: studentChatId,
                        text: textToSend
                      })
                    });
                  }
                }
              }
            }
          }
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 1. Cloud Storage Sync (Schedule, Homework, Attendance) via Cloudflare KV with per-group isolation
      if (url.pathname.startsWith("/sync/")) {
        const type = url.pathname.replace("/sync/", "").replace(/^\/+|\/+$/g, "");
        if (!KV_TYPES.has(type)) {
          return new Response(JSON.stringify({ error: "Unknown sync type: " + type }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        if (!env || !env.APP_DATA) {
          return new Response(JSON.stringify({ error: "Cloudflare KV APP_DATA namespace is not bound" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        let groupId = (url.searchParams.get("groupId") || "").toLowerCase();

        // For attendance routes, verify Telegram initData authentication or X-App-Key
        const hasAppKey = await requireAppKey(request, APP_SECRET);
        const initDataHeader = extractInitDataFromRequest(request);
        const authHeader = request.headers.get("Authorization") || "";
        const staffTokenHeader = request.headers.get("X-Staff-Token") || (authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "");
        let tokenPayload = null;
        if (staffTokenHeader && env?.ID_PEPPER) {
          tokenPayload = await verifyStaffToken(staffTokenHeader, env.ID_PEPPER);
        }

        if (type === "attendance" && !hasAppKey) {
          if (!initDataHeader) {
            return new Response(JSON.stringify({ error: "Access denied to group attendance" }), {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
        }

        // GET latest data from Cloudflare KV for the specific group
        if (request.method === "GET") {
          if (!groupId || !GROUP_ID_RE.test(groupId)) {
            return new Response(JSON.stringify({ error: "Invalid or missing groupId parameter" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          if (type === "attendance" && !hasAppKey) {
            const verifyResult = await verifyTelegramInitData(initDataHeader, TELEGRAM_BOT_TOKEN);
            if (!verifyResult.ok) {
              return new Response(JSON.stringify({ error: verifyResult.error || "Invalid Telegram initData" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }
            const userId = verifyResult.user?.id;
            if (!userId) {
              return new Response(JSON.stringify({ error: "Access denied to group attendance" }), {
                status: 403,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }

            if (!env || !env.ID_PEPPER) {
              return new Response(JSON.stringify({ error: "Internal server error" }), {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }

            const userBlindId = await blindId(env, userId);
            const isAuthorized = await checkUserGroupAccess(env.APP_DATA, userBlindId, groupId);
            if (!isAuthorized) {
              return new Response(JSON.stringify({ error: "Access denied to group attendance" }), {
                status: 403,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }
          }

          const kvKey = `${type}:${groupId}`;
          const raw = await env.APP_DATA.get(kvKey);
          let groupData = {};
          if (raw) {
            try {
              groupData = JSON.parse(raw);
            } catch {
              groupData = {};
            }
          }
          const responseBody = JSON.stringify({ byGroup: { [groupId]: groupData }, updatedAt: groupData.updatedAt || 0 });
          const etag = `"${await sha256Hex(responseBody)}"`;
          const clientEtag = request.headers.get("If-None-Match");

          if (clientEtag && (clientEtag === etag || clientEtag === `W/${etag}`)) {
            return new Response(null, {
              status: 304,
              headers: {
                ...corsHeaders,
                "ETag": etag,
                "Cache-Control": "private, no-store"
              }
            });
          }

          return new Response(responseBody, {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
              "ETag": etag,
              "Cache-Control": "private, no-store"
            }
          });
        }

        // PUT or POST save data to Cloudflare KV with per-group isolation
        if (request.method === "PUT" || request.method === "POST") {
          // P0-01: PUT /sync/attendance is permanently deprecated (410 Gone) in API v3
          if (type === "attendance") {
            return new Response(JSON.stringify({ error: "Deprecated endpoint. Use /v3/att for attendance synchronization." }), {
              status: 410,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          let userBlindId = null;

          const isStaffAuthorized = Boolean(tokenPayload && (
            tokenPayload.role === 'admin' ||
            (tokenPayload.role === 'starosta' && String(tokenPayload.gid).toLowerCase() === String(groupId).toLowerCase())
          ));

          if (!hasAppKey && !isStaffAuthorized) {
            if (!initDataHeader) {
              return new Response(JSON.stringify({ error: "Unauthorized: Missing X-App-Key, Telegram initData, or valid Staff Token" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }
            const verifyResult = await verifyTelegramInitData(initDataHeader, TELEGRAM_BOT_TOKEN);
            if (!verifyResult.ok || !verifyResult.user?.id) {
              return new Response(JSON.stringify({ error: verifyResult.error || "Unauthorized: Invalid Telegram initData" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }
            userBlindId = await blindId(env, verifyResult.user.id);
          }

          const rawText = await request.text();
          if (rawText.length > 1000000) {
            return new Response(JSON.stringify({ error: "Payload too large" }), {
              status: 413,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
          let parsed;
          try {
            parsed = JSON.parse(rawText);
          } catch {
            return new Response(JSON.stringify({ error: "Invalid JSON body for sync" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          // Fallback to extract groupId from body if omitted in query params
          if (!groupId && parsed && typeof parsed === "object") {
            if (typeof parsed.groupId === "string") {
              groupId = parsed.groupId.toLowerCase();
            } else if (parsed.byGroup && typeof parsed.byGroup === "object") {
              const keys = Object.keys(parsed.byGroup);
              if (keys.length > 0) groupId = keys[0].toLowerCase();
            }
          }

          if (!groupId || !GROUP_ID_RE.test(groupId)) {
            return new Response(JSON.stringify({ error: "Invalid or missing groupId parameter" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          if (type !== "attendance" && !hasAppKey) {
            let isAdmin = Boolean(tokenPayload?.role === 'admin') || Boolean(env && env.ADMIN_BLIND_ID && userBlindId === env.ADMIN_BLIND_ID);
            if (!isAdmin && userBlindId) {
              const adminRaw = await env.APP_DATA.get("g:admin");
              if (adminRaw) {
                try {
                  const adminObj = JSON.parse(adminRaw);
                  if (Array.isArray(adminObj.staff) && adminObj.staff.includes(userBlindId)) {
                    isAdmin = true;
                  }
                } catch {}
              }
            }
            let isStaff = isStaffAuthorized;
            if (!isStaff && groupId && userBlindId) {
              const groupRaw = await env.APP_DATA.get("g:" + groupId.toLowerCase());
              if (groupRaw) {
                try {
                  const groupObj = JSON.parse(groupRaw);
                  if (Array.isArray(groupObj.staff) && groupObj.staff.includes(userBlindId)) {
                    isStaff = true;
                  }
                } catch {}
              }
            }
            if (!isAdmin && !isStaff) {
              return new Response(JSON.stringify({ error: "Forbidden: Write permission requires verified staff or admin role" }), {
                status: 403,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }
          }

          const kvKey = `${type}:${groupId}`;

          // Mass Assignment Protection (Strict Whitelist DTO)
          const cleanData = sanitizeSyncPayload(type, parsed);
          let targetData = cleanData;
          if (cleanData && typeof cleanData.payload === "string") {
            try {
              targetData = JSON.parse(cleanData.payload);
            } catch {}
          }
          const rawExisting = await env.APP_DATA.get(kvKey);
          let existingGroup = {};
          if (rawExisting) {
            try { existingGroup = JSON.parse(rawExisting); } catch {}
          }
          const incomingSlice = (targetData && targetData.byGroup && targetData.byGroup[groupId]) || targetData || {};
          let groupSlice;
          if (type === "homework") {
            groupSlice = mergeHomeworkGroupSlice(existingGroup, incomingSlice);
          } else if (type === "useful") {
            groupSlice = mergeUsefulGroupSlice(existingGroup, incomingSlice);
          } else if (type === "schedule") {
            groupSlice = mergeScheduleGroupSlice(existingGroup, incomingSlice);
          } else {
            groupSlice = { ...existingGroup, ...incomingSlice };
          }
          groupSlice.updatedAt = Date.now();

          if (type === 'homework' || type === 'useful') {
            const asIds = (v) => (Array.isArray(v) ? v.map(String) : []);
            const tombstones = Array.from(new Set([...asIds(existingGroup.deletedIds), ...asIds(incomingSlice.deletedIds)])).slice(-1000);
            groupSlice.deletedIds = tombstones;
            if (Array.isArray(groupSlice.items) && tombstones.length > 0) {
              const dead = new Set(tombstones);
              groupSlice.items = groupSlice.items.filter(it => it && !dead.has(String(it.id)));
            }
            if (type === 'useful' && Array.isArray(groupSlice.items)) {
              groupSlice.items = groupSlice.items.slice(0, 200);
            }
          }

          await env.APP_DATA.put(kvKey, JSON.stringify(groupSlice));
          return new Response(JSON.stringify({ ok: true, updatedAt: groupSlice.updatedAt }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }

      // 2. File Upload to Telegram Channel / Owner Relay (Bug Reports)
      if (url.pathname === "/upload" && request.method === "POST") {
        if (!BOT_TOKEN) {
          return new Response(JSON.stringify({ error: "TELEGRAM_BOT_TOKEN is not configured" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Anti-DoS Rate Limiting for upload (in-memory burst protection)
        const now = Date.now();
        if (isUploadRateLimited(now)) {
          return new Response(JSON.stringify({ error: "Too many upload requests. Please wait a moment." }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const hasAppKey = await requireAppKey(request, APP_SECRET);
        const initDataHeader = extractInitDataFromRequest(request);
        let initVerified = false;
        let verifiedUserId = null;
        if (initDataHeader) {
          const verifyResult = await verifyTelegramInitData(initDataHeader, TELEGRAM_BOT_TOKEN);
          if (verifyResult.ok && verifyResult.user?.id) {
            initVerified = true;
            verifiedUserId = verifyResult.user.id;
          }
        }

        // P0-03: Origin check completely removed from authorization. Must have valid initData or X-App-Key.
        if (!hasAppKey && !initVerified) {
          return new Response(JSON.stringify({ error: "Unauthorized: upload requires valid initData or X-App-Key" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // P0-03: Rate limiting by blindId in KV with TTL
        let userBlindId = null;
        if (verifiedUserId) {
          if (!env || !env.ID_PEPPER) {
            return new Response(JSON.stringify({ error: "Internal server error" }), {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
          userBlindId = await blindId(env, verifiedUserId);
          if (env.APP_DATA && userBlindId) {
            const rlKey = `rl:up:${userBlindId}`;
            const countRaw = await env.APP_DATA.get(rlKey);
            const count = countRaw ? parseInt(countRaw, 10) : 0;
            if (count >= 10) {
              return new Response(JSON.stringify({ error: "Too many upload requests. Please wait a moment." }), {
                status: 429,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }
            await env.APP_DATA.put(rlKey, String(count + 1), { expirationTtl: 600 });
          }
        }

        let formData;
        try {
          formData = await request.formData();
        } catch {
          return new Response(JSON.stringify({ error: "Invalid form data" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const uploadType = String(formData.get("type") || "");
        const captionText = String(formData.get("caption") || "");
        const isBugReport = uploadType === "bugreport" || captionText.includes("БАГ-РЕПОРТ") || captionText.includes("Полное описание проблемы") || captionText.includes("Диагностический дамп");

        const DEV_CHAT_ID = (env && (env.DEV_CHAT_ID || env.TELEGRAM_DEV_CHAT_ID)) || null;
        const CHANNEL_ID_TARGET = (env && (env.TELEGRAM_CHANNEL_ID || env.CHANNEL_ID)) || CHANNEL_ID || null;

        let targetChat = isBugReport ? (DEV_CHAT_ID || CHANNEL_ID_TARGET) : (CHANNEL_ID_TARGET || DEV_CHAT_ID);
        if (!targetChat && verifiedUserId) {
          targetChat = verifiedUserId;
        }
        if (!targetChat) {
          if (env && env.APP_DATA) {
            try {
              const reportKey = `report:${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
              const captionText = formData.get("caption") || "";
              const diagText = formData.get("diagnostics") || "";
              await env.APP_DATA.put(reportKey, JSON.stringify({
                timestamp: Date.now(),
                caption: String(captionText).slice(0, 4000),
                diagnostics: String(diagText).slice(0, 8000),
                note: "Saved without targetChat configured"
              }), { expirationTtl: 2592000 });
              return new Response(JSON.stringify({ ok: true, stored: true }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            } catch {}
          }
          return new Response(JSON.stringify({ error: "Telegram recipient chat is not configured (missing DEV_CHAT_ID / TELEGRAM_CHANNEL_ID in Worker settings)" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        formData.set("chat_id", targetChat);
        formData.set("disable_notification", "true");

        let data;
        let resStatus = 200;
        try {
          const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
            method: "POST",
            body: formData,
          });
          data = await tgRes.json().catch(() => ({}));
          resStatus = tgRes.status;
          if (tgRes.ok && data && data.ok) {
            recordUploadSent(now);
          }
        } catch (fetchErr) {
          data = { ok: false, description: String(fetchErr) };
          resStatus = 500;
        }

        // If Telegram delivery failed (e.g. 400 Bad Request: chat not found), do NOT fail the user!
        // Save report data to KV and return { ok: true, stored: true }
        if (!data || !data.ok) {
          if (env && env.APP_DATA) {
            try {
              const reportKey = `report:${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
              const caption = formData.get("caption");
              const diag = formData.get("diagnostics");
              const doc = formData.get("document");
              let preview = "";
              if (doc && typeof doc.text === 'function') {
                try { preview = (await doc.text()).slice(0, 5000); } catch {}
              }
              await env.APP_DATA.put(reportKey, JSON.stringify({
                timestamp: Date.now(),
                caption: caption ? String(caption).slice(0, 4000) : "",
                diagnostics: diag ? String(diag).slice(0, 8000) : "",
                preview,
                tgError: data ? (data.description || data.error_code) : `HTTP ${resStatus}`
              }), { expirationTtl: 2592000 }); // 30 days
            } catch (kvErr) {
              console.warn("[Upload] Fallback KV put failed:", kvErr);
            }
          }
          return new Response(JSON.stringify({
            ok: true,
            stored: true,
            warning: "Telegram notification failed; report saved to storage."
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        if (data && data.ok && data.result) {
          const doc = data.result.document || (data.result.photo ? data.result.photo[data.result.photo.length - 1] : null);
          if (doc && doc.file_id) {
            const exp = Math.floor(Date.now() / 1000) + (14 * 86400); // 14 days TTL
            if (!env || !env.ID_PEPPER) {
              return new Response(JSON.stringify({ error: "Internal server error" }), {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }
            const signingKey = await deriveFileSigningKey(env.ID_PEPPER);
            const sig = await signFileUrl(doc.file_id, exp, signingKey);
            const fileName = doc.file_name || "file";
            const directUrl = `${url.origin}/file?file_id=${doc.file_id}&exp=${exp}&sig=${sig}&download=1&filename=${encodeURIComponent(fileName)}`;
            data.direct_url = directUrl;
            data.exp = exp;
            data.sig = sig;
          }
        }
        // Never echo Telegram's raw response (it contains the receiving chat and the bot);
        // return only the fields clients actually use.
        const pickFile = (f) => f ? { file_id: f.file_id, file_unique_id: f.file_unique_id, file_name: f.file_name, file_size: f.file_size, mime_type: f.mime_type } : undefined;
        const safeBody = { ok: Boolean(data && data.ok) };
        if (data && data.ok && data.result) {
          const photo = Array.isArray(data.result.photo) && data.result.photo.length ? data.result.photo[data.result.photo.length - 1] : null;
          safeBody.result = { document: pickFile(data.result.document || photo) };
        } else if (data && data.description) {
          safeBody.description = String(data.description).slice(0, 200);
        }
        for (const k of ['direct_url', 'exp', 'sig', 'stored', 'warning']) if (data && data[k] !== undefined) safeBody[k] = data[k];
        return new Response(JSON.stringify(safeBody), {
          status: resStatus,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 2b. Private Document Export for Starosta (Word .docx reports)
      if (url.pathname === "/export-doc" && request.method === "POST") {
        const exportHasAppKey = await requireAppKey(request, APP_SECRET);
        if (!exportHasAppKey) {
          const exportInit = extractInitDataFromRequest(request);
          const exportVerify = exportInit
            ? await verifyTelegramInitData(exportInit, TELEGRAM_BOT_TOKEN)
            : { ok: false };
          if (!exportVerify.ok || !exportVerify.user || !exportVerify.user.id) {
            return new Response(JSON.stringify({ error: "Unauthorized: Telegram initData required" }), {
              status: 401,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
        }

        if (!BOT_TOKEN) {
          return new Response(JSON.stringify({ error: "TELEGRAM_BOT_TOKEN is not configured" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const now = Date.now();
        if (isUploadRateLimited(now)) {
          return new Response(JSON.stringify({ error: "Too many export requests. Please wait a moment." }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const formData = await request.formData();
        const file = formData.get("document");
        const rawFileName = formData.get("filename") || "Ведомость_посещаемости.docx";
        const caption = formData.get("caption") || "📄 Официальная ведомость пропусков";

        if (!file) {
          return new Response(JSON.stringify({ error: "Missing document file in formData" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const PRIVATE_STORAGE_CHAT = (env && (env.TELEGRAM_DEV_CHAT_ID || env.DEV_CHAT_ID))
          ? (env.TELEGRAM_DEV_CHAT_ID || env.DEV_CHAT_ID)
          : CHANNEL_ID;

        let tgJson = null;
        let sentToUser = false;

        const initDataHeader = extractInitDataFromRequest(request);
        let targetUserId = null;
        if (initDataHeader) {
          const verifyResult = await verifyTelegramInitData(initDataHeader, TELEGRAM_BOT_TOKEN);
          if (verifyResult.ok && verifyResult.user && verifyResult.user.id) {
            targetUserId = verifyResult.user.id;
          }
        }

        // Step 1: If user initData is valid, try direct send to their PM
        if (targetUserId) {
          const userFormData = new FormData();
          userFormData.append("chat_id", String(targetUserId));
          userFormData.append("document", file, String(rawFileName));
          userFormData.append("caption", String(caption));

          try {
            const userTgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
              method: "POST",
              body: userFormData
            });
            tgJson = await userTgRes.json();
            if (tgJson && tgJson.ok) {
              sentToUser = true;
            }
          } catch (e) {
            console.warn("Direct send to user chat failed, falling back to private storage chat:", e);
          }
        }

        // Step 2: Fallback to private storage chat if direct send failed or initData is absent
        // Документ содержит реальные ФИО студентов: его нельзя пересылать в чат разработчика!
        if (!sentToUser && !exportHasAppKey) {
          return new Response(JSON.stringify({
            error: "Не удалось отправить файл в личные сообщения. Откройте бота в Telegram, нажмите Start и повторите попытку.",
            code: "PM_NOT_DELIVERED"
          }), {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        if (!sentToUser) {
          const fallbackFormData = new FormData();
          fallbackFormData.append("chat_id", String(PRIVATE_STORAGE_CHAT));
          fallbackFormData.append("document", file, String(rawFileName));
          fallbackFormData.append("caption", `[Архив ведомостей] ${caption}`);

          const fallbackRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
            method: "POST",
            body: fallbackFormData
          });
          tgJson = await fallbackRes.json();
        }

        if (!tgJson || !tgJson.ok) {
          return new Response(JSON.stringify({ error: tgJson?.description || "Failed to store document in Telegram" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const fileId = tgJson.result.document.file_id;
        const fileName = tgJson.result.document.file_name || rawFileName;

        if (!env || !env.ID_PEPPER) {
          return new Response(JSON.stringify({ error: "Internal server error" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        const signingKey = await deriveFileSigningKey(env.ID_PEPPER);
        const exp = Math.floor(Date.now() / 1000) + 600;
        const sig = await signFileUrl(fileId, exp, signingKey);

        const directUrl = `${url.origin}/file?file_id=${fileId}&exp=${exp}&sig=${sig}&download=1&filename=${encodeURIComponent(fileName)}`;

        recordUploadSent(now);
        return new Response(JSON.stringify({
          ok: true,
          file_id: fileId,
          filename: fileName,
          direct_url: directUrl,
          sent_to_pm: sentToUser
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }


      // 3. Direct File Streaming (Bypasses RKN / Works in Russia without VPN!)
      if (url.pathname === "/file") {
        const fileId = url.searchParams.get("file_id");
        if (!fileId) return new Response("Missing file_id", { status: 400, headers: corsHeaders });

        const expStr = url.searchParams.get("exp");
        const sig = url.searchParams.get("sig");
        const initDataHeader = extractInitDataFromRequest(request);

        let isValidSig = false;
        if (initDataHeader && TELEGRAM_BOT_TOKEN) {
          const initVerify = await verifyTelegramInitData(initDataHeader, TELEGRAM_BOT_TOKEN);
          if (initVerify.ok) {
            isValidSig = true;
          }
        }

        if (!isValidSig) {
          if (!expStr || !sig) {
            return new Response("Missing signature or expiration", { status: 403, headers: corsHeaders });
          }

          const nowSec = Math.floor(Date.now() / 1000);
          const exp = parseInt(expStr, 10);
          if (!exp || isNaN(exp) || exp < nowSec) {
            return new Response("Expired file link", { status: 403, headers: corsHeaders });
          }

          if (!env || !env.ID_PEPPER) {
            return new Response("Internal server error", { status: 500, headers: corsHeaders });
          }

          const signingKey = await deriveFileSigningKey(env.ID_PEPPER);
          isValidSig = await verifyFileSignature(fileId, exp, sig, signingKey);
        }

        if (!isValidSig) {
          return new Response("Forbidden: invalid signature", { status: 403, headers: corsHeaders });
        }

        const queryFilename = url.searchParams.get("filename") || url.searchParams.get("name");
        const rawFileName = queryFilename || "file";

        // RFC 5987: ASCII fallback + UTF-8 encoded filename for Russian characters on mobile
        const safeAsciiName = rawFileName.replace(/[^\x20-\x7E]/g, '_');
        const utf8EncodedName = encodeURIComponent(rawFileName);

        let contentType = "application/octet-stream";
        if (rawFileName.toLowerCase().endsWith(".docx")) {
          contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        }

        if (!BOT_TOKEN) {
          return new Response("TELEGRAM_BOT_TOKEN is not configured", { status: 500, headers: corsHeaders });
        }

        const infoRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
        const info = await infoRes.json();
        if (!info.ok) return new Response("File not found in Telegram", { status: 404, headers: corsHeaders });

        const directUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${info.result.file_path}`;
        const fileRes = await fetch(directUrl);

        const fetchedContentType = fileRes.headers.get("Content-Type");
        if (fetchedContentType && !rawFileName.toLowerCase().endsWith(".docx")) {
          contentType = fetchedContentType;
        }

        const isDownload = url.searchParams.get("download") === "1" || rawFileName.toLowerCase().endsWith(".docx");
        const dispositionType = isDownload ? "attachment" : "inline";

        return new Response(fileRes.body, {
          headers: {
            ...corsHeaders,
            "Content-Type": contentType,
            "Content-Disposition": `${dispositionType}; filename="${safeAsciiName}"; filename*=UTF-8''${utf8EncodedName}`,
            "Cache-Control": "private, max-age=3600"
          }
        });
      }

      // 4. Proxy official SamGTU schedule API (CORS bypass for client admin verification)
      if (url.pathname === "/samgtu-schedule" && request.method === "GET") {
        const samgtuGroupId = url.searchParams.get("groupId");
        const weekNumber = url.searchParams.get("week") || "1";

        if (!samgtuGroupId || !/^[a-zA-Z0-9-]{1,32}$/.test(samgtuGroupId)) {
          return new Response(JSON.stringify({ error: "Invalid or missing groupId parameter" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        if (!/^\d{1,2}$/.test(weekNumber) || Number(weekNumber) < 1 || Number(weekNumber) > 30) {
          return new Response(JSON.stringify({ error: "Invalid week parameter" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // IP rate limiting for the schedule proxy (max 60 req/min), in memory: no KV writes for anonymous traffic.
        const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
        if (rlCount(`rl:samgtu:${clientIp}`) > 60) {
          return new Response(JSON.stringify({ error: "Too many schedule proxy requests. Please wait." }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        rlBump(`rl:samgtu:${clientIp}`, 60000);

        const targetUrl = `https://samgtu.ru/students/getschedule?GroupID=${encodeURIComponent(samgtuGroupId)}&WeekNumber=${encodeURIComponent(weekNumber)}`;
        
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 7000);

          const samgtuRes = await fetch(targetUrl, {
            signal: controller.signal,
            // Upstream answers are identical for everyone: let Cloudflare cache them for an hour.
            cf: { cacheTtl: 3600, cacheEverything: true },
            headers: {
              "Accept": "application/json, text/plain, */*",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
          });
          clearTimeout(timeout);

          const samgtuData = await samgtuRes.text();
          return new Response(samgtuData, {
            status: samgtuRes.status,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"
            }
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: "Failed to reach official SamGTU portal", details: err?.message || 'timeout' }), {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }

      // 5. Telegram Notification Endpoint (for nightly sync / system alerts)
      if (url.pathname === "/notify" && request.method === "POST") {
        if (!(await requireAppKey(request, APP_SECRET))) {
          return new Response(JSON.stringify({ error: "Unauthorized: Invalid or missing X-App-Key" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        if (!BOT_TOKEN) {
          return new Response(JSON.stringify({ error: "TELEGRAM_BOT_TOKEN is not configured" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        let body;
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const text = body.message || body.text;
        if (!text) {
          return new Response(JSON.stringify({ error: "Missing message text" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const DEV_CHAT_ID = (env && (env.TELEGRAM_DEV_CHAT_ID || env.DEV_CHAT_ID)) ? String(env.TELEGRAM_DEV_CHAT_ID || env.DEV_CHAT_ID) : null;
        const allowedChats = new Set([String(CHANNEL_ID)]);
        if (DEV_CHAT_ID) allowedChats.add(DEV_CHAT_ID);

        const targetChatId = String(body.chat_id || CHANNEL_ID);
        if (!allowedChats.has(targetChatId)) {
          return new Response(JSON.stringify({ error: "Forbidden: target chat_id must match system channels" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: targetChatId,
            text: text,
            parse_mode: "HTML"
          })
        });
        const tgJson = await tgRes.json();
        return new Response(JSON.stringify(tgJson), {
          status: tgRes.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 6. Telegram Telemetry & Error Alerting Endpoint (Video 1)
      if (url.pathname === "/report-error" && request.method === "POST") {
        let body = {};
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        if (body && typeof body === 'object') {
          for (const [k, max] of [['message', 600], ['stack', 2000], ['component', 80], ['group', 64], ['platform', 80], ['userAgent', 200], ['timestamp', 40]]) {
            if (typeof body[k] === 'string' && body[k].length > max) body[k] = body[k].slice(0, max);
          }
        }
        const message = body.message;
        if (!message || typeof message !== 'string') {
          return new Response(JSON.stringify({ error: "Missing or invalid 'message' field" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const now = Date.now();
        const component = body.component || 'Unknown';
        const errorKey = `${component}::${message.trim()}`;

        // Deduplication check (max 1 message per identical error per 5 minutes)
        if (isDeduplicated(errorKey, now)) {
          return new Response(JSON.stringify({ ok: true, throttled: true, reason: "duplicate_error" }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Global Rate Limit check (max 5 alerts per minute across all errors)
        if (isRateLimited(now)) {
          return new Response(JSON.stringify({ ok: true, throttled: true, reason: "global_rate_limit" }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Record alert event
        recordAlertSent(errorKey, now);

        if (!BOT_TOKEN) {
          return new Response(JSON.stringify({ ok: true, warning: "TELEGRAM_BOT_TOKEN is not configured" }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const targetChatId = (env && (env.TELEGRAM_DEV_CHAT_ID || env.DEV_CHAT_ID))
          ? (env.TELEGRAM_DEV_CHAT_ID || env.DEV_CHAT_ID)
          : CHANNEL_ID;

        const htmlText = formatTelegramErrorHtml({
          message: body.message,
          stack: body.stack,
          component: body.component,
          group: body.group,
          platform: body.platform,
          userAgent: body.userAgent || request.headers.get("User-Agent") || "Unknown",
          timestamp: body.timestamp
        });

        const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: targetChatId,
            text: htmlText,
            parse_mode: "HTML"
          })
        });

        const tgJson = await tgRes.json().catch(() => ({}));
        return new Response(JSON.stringify({ ok: Boolean(tgJson && tgJson.ok) }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (url.pathname === "/" || url.pathname === "") {
        return new Response("SamGTU Telegram Storage and Cloud Sync Worker is Running OK", { headers: corsHeaders });
      }

      return new Response(JSON.stringify({ error: "Not Found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }
};
