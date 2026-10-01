// Cloudflare Worker: Telegram Unlimited File Storage & CORS Cloud Sync Proxy for SamGTU 3-INGT-110

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

// Strict Whitelist DTO Sanitizers (Video 2: Protection against Mass Assignment / Extra Fields)
export function sanitizeHomeworkItem(item, fallbackGroupId = '') {
  if (!item || typeof item !== 'object') return null;
  return {
    id: String(item.id || ''),
    groupId: String(item.groupId || fallbackGroupId || ''),
    subject: String(item.subject || '').slice(0, 200),
    title: String(item.title || '').slice(0, 300),
    description: String(item.description || '').slice(0, 4000),
    assignedDate: String(item.assignedDate || '').slice(0, 30),
    dueDate: String(item.dueDate || '').slice(0, 30),
    attachments: Array.isArray(item.attachments) ? item.attachments.slice(0, 10).map(att => ({
      name: String(att.name || '').slice(0, 200),
      type: String(att.type || 'file').slice(0, 30),
      size: Number(att.size) || 0,
      url: String(att.url || '').slice(0, 1000)
    })) : [],
    createdAt: String(item.createdAt || '').slice(0, 50)
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
  if (ov.note !== undefined) res.note = String(ov.note).slice(0, 500);
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
            items: Array.isArray(grp.items) ? grp.items.slice(0, 200).map(it => sanitizeHomeworkItem(it, gid)).filter(Boolean) : [],
            deletedIds: Array.isArray(grp.deletedIds) ? grp.deletedIds.map(String).slice(0, 200) : [],
            updatedAt: Number(grp.updatedAt) || now
          };
        }
      }
    }
    if (Array.isArray(rawData.items)) {
      res.items = rawData.items.slice(0, 200).map(it => sanitizeHomeworkItem(it)).filter(Boolean);
    }
    if (Array.isArray(rawData.deletedIds)) {
      res.deletedIds = rawData.deletedIds.map(String).slice(0, 200);
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
          if (Array.isArray(grp.students)) {
            cleanGroup.students = grp.students.slice(0, 100).map(s => sanitizeStudent(s)).filter(Boolean);
          }
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

  return rawData;
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

export const KV_TYPES = new Set(["schedule", "homework", "attendance"]);
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
  'http://localhost:4173'
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
  } else if (!origin && pathname === '/report-error') {
    allowOrigin = '*';
  } else {
    allowOrigin = allowed[0];
  }

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, Cache-Control, Pragma, Authorization, X-App-Key, X-Telegram-Init-Data",
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

export async function hashPin(pin) {
  const clean = String(pin || '').trim();
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(clean));
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256Hex(str) {
  const clean = String(str || '');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clean));
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function blindId(env, tgId) {
  const pepper = (env && env.ID_PEPPER) ? env.ID_PEPPER : "default_samgtu_v3_pepper_32bytes_!";
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
  const enc = new TextEncoder();
  const pepperStr = String(pepper || "default_samgtu_v3_pepper_32bytes_!");
  const keyMaterial = await crypto.subtle.digest("SHA-256", enc.encode(pepperStr));
  const key = await crypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = enc.encode(String(chatId));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  const encHex = Array.from(new Uint8Array(ciphertext)).map(b => b.toString(16).padStart(2, '0')).join('');
  const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
  return { enc: encHex, iv: ivHex };
}

export async function decryptChatId(encHex, ivHex, pepper) {
  try {
    const enc = new TextEncoder();
    const pepperStr = String(pepper || "default_samgtu_v3_pepper_32bytes_!");
    const keyMaterial = await crypto.subtle.digest("SHA-256", enc.encode(pepperStr));
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
    if (authHeader.startsWith("Bearer ")) {
      return authHeader.slice(7).trim();
    }
    return authHeader.trim();
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

    if (calculatedHash.toLowerCase() !== hash.toLowerCase()) {
      return { ok: false, error: 'Invalid HMAC signature (tampered data)' };
    }

    const isTestMode = options.isTestMode === true;
    const ignoreAuthDate = options.ignoreAuthDate === true || (isTestMode && options.checkAuthDate !== true);

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

export async function checkUserGroupAccess(appData, userId, groupId) {
  if (!appData || !userId || !groupId) return false;
  const normalizedGroupId = String(groupId).toLowerCase();

  const groupAuthRaw = await appData.get(`auth:${userId}:${normalizedGroupId}`);
  const adminAuthRaw = await appData.get(`auth:${userId}:admin`);
  const wildcardAuthRaw = await appData.get(`auth:${userId}:*`);

  for (const raw of [groupAuthRaw, adminAuthRaw, wildcardAuthRaw]) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed.role === 'admin') return true;
      if (parsed.role === 'starosta' && (!parsed.groupId || parsed.groupId.toLowerCase() === normalizedGroupId)) {
        return true;
      }
    } catch {
      if (raw === 'admin' || raw === 'starosta') return true;
    }
  }

  return false;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = getCorsHeaders(request, env, url.pathname);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const isTestMode = Boolean(env && (env.TEST_MODE === 'true' || env.TEST_MODE === true || env.TELEGRAM_BOT_TOKEN === 'mock' || env.TELEGRAM_BOT_TOKEN === 'test'));
    const TELEGRAM_BOT_TOKEN = (env && env.TELEGRAM_BOT_TOKEN) ? env.TELEGRAM_BOT_TOKEN : "";
    const BOT_TOKEN = isTestMode ? "" : TELEGRAM_BOT_TOKEN;
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

      // 0a. Telegram WebApp HMAC Authentication & Role Assertion (POST /auth/pin)
      if (url.pathname === "/auth/pin" && request.method === "POST") {
        let body;
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const { pin, initData, targetGroupId } = body || {};
        if (!pin || !initData) {
          return new Response(JSON.stringify({ error: "Missing required fields: pin and initData" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const verifyResult = await verifyTelegramInitData(initData, TELEGRAM_BOT_TOKEN, { isTestMode });
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

        const assignedScope = targetGroupId ? String(targetGroupId).toLowerCase() : 'admin';
        const rlKey = `rl:pin:${assignedScope}`;
        const attemptsRaw = await env.APP_DATA.get(rlKey);
        const attempts = attemptsRaw ? parseInt(attemptsRaw, 10) : 0;
        if (attempts >= 5) {
          return new Response(JSON.stringify({ error: "Too many attempts. Please try again later." }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        let role = null;
        let assignedGroupId = targetGroupId ? String(targetGroupId).toLowerCase() : null;

        if (assignedGroupId && assignedGroupId !== 'admin') {
          const groupRecordRaw = await env.APP_DATA.get(`g:${assignedGroupId}`);
          if (groupRecordRaw) {
            try {
              const groupData = JSON.parse(groupRecordRaw);
              if (groupData && groupData.codeSalt && groupData.codeHash) {
                const calcHash = await pbkdf2(pin, groupData.codeSalt);
                if (await safeEqual(calcHash, groupData.codeHash)) {
                  role = 'starosta';
                }
              }
            } catch {}
          }
        } else {
          let adminSalt = null;
          let adminHash = null;

          const adminRecordRaw = await env.APP_DATA.get('g:admin');
          if (adminRecordRaw) {
            try {
              const adminData = JSON.parse(adminRecordRaw);
              if (adminData && adminData.codeSalt && adminData.codeHash) {
                adminSalt = adminData.codeSalt;
                adminHash = adminData.codeHash;
              }
            } catch {}
          }

          if (!adminHash && env.ADMIN_CODE_HASH && env.ADMIN_CODE_SALT) {
            adminHash = env.ADMIN_CODE_HASH;
            adminSalt = env.ADMIN_CODE_SALT;
          }

          if (adminSalt && adminHash) {
            const calcHash = await pbkdf2(pin, adminSalt);
            if (await safeEqual(calcHash, adminHash)) {
              role = 'admin';
              assignedGroupId = 'admin';
            }
          }
        }

        if (!role) {
          await env.APP_DATA.put(rlKey, String(attempts + 1), { expirationTtl: 900 });
          return new Response(JSON.stringify({ error: "Invalid PIN code" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        await env.APP_DATA.delete(rlKey);

        const TTL_30_DAYS = 30 * 24 * 60 * 60;
        const sessionData = {
          userId: user.id,
          role,
          groupId: assignedGroupId,
          createdAt: Date.now()
        };

        await env.APP_DATA.put(`auth:${user.id}:${assignedGroupId}`, JSON.stringify(sessionData), {
          expirationTtl: TTL_30_DAYS
        });

        if (role === 'admin') {
          await env.APP_DATA.put(`auth:${user.id}:admin`, JSON.stringify(sessionData), {
            expirationTtl: TTL_30_DAYS
          });
          await env.APP_DATA.put(`auth:${user.id}:*`, JSON.stringify(sessionData), {
            expirationTtl: TTL_30_DAYS
          });
        }

        return new Response(JSON.stringify({
          ok: true,
          role,
          groupId: assignedGroupId,
          userId: user.id
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 0b. API v3 ("Blind Server" Architecture)
      if (url.pathname.startsWith("/v3/")) {
        const initDataStr = extractInitDataFromRequest(request);
        if (!initDataStr) {
          return new Response(JSON.stringify({ error: "Missing or invalid X-Telegram-Init-Data header" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const verifyResult = await verifyTelegramInitData(initDataStr, TELEGRAM_BOT_TOKEN, { isTestMode });
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

        // 1. POST /v3/staff/claim
        if (url.pathname === "/v3/staff/claim" && request.method === "POST") {
          let body;
          try {
            body = await request.json();
          } catch {
            return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          const { gid, code } = body || {};
          if (!gid || !code || typeof gid !== 'string' || typeof code !== 'string') {
            return new Response(JSON.stringify({ error: "Missing or invalid gid or code" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          const rlKey = `rl:claim:${gid}`;
          const attemptsRaw = await env.APP_DATA.get(rlKey);
          const attempts = attemptsRaw ? parseInt(attemptsRaw, 10) : 0;
          if (attempts >= 5) {
            return new Response(JSON.stringify({ error: "Too many attempts. Please try again later." }), {
              status: 429,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          const groupRaw = await env.APP_DATA.get("g:" + gid);
          if (!groupRaw) {
            await env.APP_DATA.put(rlKey, String(attempts + 1), { expirationTtl: 900 });
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

          if (!groupData.codeSalt || !groupData.codeHash) {
            await env.APP_DATA.put(rlKey, String(attempts + 1), { expirationTtl: 900 });
            return new Response(JSON.stringify({ error: "Group code not configured" }), {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          const calcHash = await pbkdf2(code, groupData.codeSalt);
          const isValid = await safeEqual(calcHash, groupData.codeHash);
          if (!isValid) {
            await env.APP_DATA.put(rlKey, String(attempts + 1), { expirationTtl: 900 });
            return new Response(JSON.stringify({ error: "Invalid group code" }), {
              status: 401,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          await env.APP_DATA.delete(rlKey);
          groupData.staff = Array.isArray(groupData.staff) ? groupData.staff : [];
          if (!groupData.staff.includes(userBlindId)) {
            groupData.staff.push(userBlindId);
          }
          await env.APP_DATA.put("g:" + gid, JSON.stringify(groupData));

          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
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

          if (!Array.isArray(groupData.staff) || !groupData.staff.includes(userBlindId)) {
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

          if (!Array.isArray(groupData.staff) || !groupData.staff.includes(userBlindId)) {
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

          if (!Array.isArray(groupData.staff) || !groupData.staff.includes(userBlindId)) {
            return new Response(JSON.stringify({ error: "Forbidden: not a group staff member" }), {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          const attRaw = await env.APP_DATA.get(`a:${gid}:${month}`);
          let monthData = { ver: 0, slots: {}, cancelled: [] };
          if (attRaw) {
            try {
              const parsed = JSON.parse(attRaw);
              monthData = {
                ver: Number(parsed.ver) || 0,
                slots: (parsed.slots && typeof parsed.slots === 'object') ? parsed.slots : {},
                cancelled: Array.isArray(parsed.cancelled) ? parsed.cancelled : []
              };
            } catch {}
          }

          return new Response(JSON.stringify(monthData), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
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

          const { gid, month, baseVer, patch, cancel } = body || {};
          if (!gid || !month || typeof gid !== 'string' || typeof month !== 'string') {
            return new Response(JSON.stringify({ error: "Missing or invalid gid or month" }), {
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

          if (!Array.isArray(groupData.staff) || !groupData.staff.includes(userBlindId)) {
            return new Response(JSON.stringify({ error: "Forbidden: not a group staff member" }), {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          const attRaw = await env.APP_DATA.get(`a:${gid}:${month}`);
          let current = { ver: 0, slots: {}, cancelled: [] };
          if (attRaw) {
            try {
              const parsed = JSON.parse(attRaw);
              current = {
                ver: Number(parsed.ver) || 0,
                slots: (parsed.slots && typeof parsed.slots === 'object') ? parsed.slots : {},
                cancelled: Array.isArray(parsed.cancelled) ? parsed.cancelled : []
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
              cancelled: current.cancelled
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

          const newVer = (current.ver || 0) + 1;
          current.ver = newVer;

          const TTL_200_DAYS = 17280000;
          await env.APP_DATA.put(`a:${gid}:${month}`, JSON.stringify(current), {
            expirationTtl: TTL_200_DAYS
          });

          return new Response(JSON.stringify({ ok: true, ver: newVer }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // 6. POST /v3/student/link (and /v3/me/claim)
        if ((url.pathname === "/v3/student/link" || url.pathname === "/v3/me/claim") && request.method === "POST") {
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

          const cleanCode = code.trim().toUpperCase();
          const codeHash = (await sha256Hex(cleanCode)).toLowerCase();
          const invRaw = await env.APP_DATA.get("inv:" + codeHash);
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
          await env.APP_DATA.delete("inv:" + codeHash);

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
          const userRaw = await env.APP_DATA.get("u:" + userBlindId);
          if (!userRaw) {
            return new Response(JSON.stringify({ ok: true, linked: false }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          let userData;
          try {
            userData = JSON.parse(userRaw);
          } catch {
            return new Response(JSON.stringify({ ok: true, linked: false }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          if (!userData || !userData.gid || !userData.slot) {
            return new Response(JSON.stringify({ ok: true, linked: false }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          const now = new Date(Date.now() + 4 * 60 * 60 * 1000);
          const defaultMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
          const targetMonth = url.searchParams.get("month") || url.searchParams.get("from") || defaultMonth;

          const attRaw = await env.APP_DATA.get(`a:${userData.gid}:${targetMonth}`);
          let monthSlots = {};
          let cancelled = [];
          if (attRaw) {
            try {
              const parsed = JSON.parse(attRaw);
              monthSlots = (parsed.slots && typeof parsed.slots === 'object') ? parsed.slots : {};
              cancelled = Array.isArray(parsed.cancelled) ? parsed.cancelled : [];
            } catch {}
          }

          const slotMarks = monthSlots[userData.slot] || {};
          return new Response(JSON.stringify({
            ok: true,
            linked: true,
            gid: userData.gid,
            slot: userData.slot,
            consentVer: userData.consentVer,
            consentAt: userData.consentAt,
            marks: slotMarks,
            cancelled
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // 8. DELETE /v3/me
        if (url.pathname === "/v3/me" && request.method === "DELETE") {
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
            const now = new Date(Date.now() + 4 * 60 * 60 * 1000);
            const defaultMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
            const targetMonth = url.searchParams.get("month") || defaultMonth;
            const attKey = `a:${userData.gid}:${targetMonth}`;
            const attRaw = await env.APP_DATA.get(attKey);
            if (attRaw) {
              try {
                const parsed = JSON.parse(attRaw);
                if (parsed.slots && parsed.slots[userData.slot]) {
                  delete parsed.slots[userData.slot];
                  parsed.ver = (parsed.ver || 0) + 1;
                  await env.APP_DATA.put(attKey, JSON.stringify(parsed), { expirationTtl: 17280000 });
                }
              } catch {}
            }
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

          if (!Array.isArray(groupData.staff) || !groupData.staff.includes(userBlindId)) {
            return new Response(JSON.stringify({ error: "Forbidden: not a group staff member" }), {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          if (Array.isArray(groupData.slots)) {
            groupData.slots = groupData.slots.filter(s => s !== slotId);
            await env.APP_DATA.put("g:" + gid, JSON.stringify(groupData));
          }

          const now = new Date(Date.now() + 4 * 60 * 60 * 1000);
          const defaultMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
          const targetMonth = url.searchParams.get("month") || defaultMonth;
          const attKey = `a:${gid}:${targetMonth}`;
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

          return new Response(JSON.stringify({ ok: true }), {
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

        const verifyResult = await verifyTelegramInitData(initDataStr, TELEGRAM_BOT_TOKEN, { isTestMode });
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
        if (!sentMessageId && isTestMode) {
          sentMessageId = 12345;
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
        const expectedSecret = env && (env.TG_WEBHOOK_SECRET || env.TELEGRAM_WEBHOOK_SECRET || env.APP_SECRET);
        const headerSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
        const pathSecret = url.pathname.startsWith("/tg/webhook/")
          ? url.pathname.slice("/tg/webhook/".length).replace(/^\/+|\/+$/g, "")
          : null;

        if (expectedSecret) {
          if (headerSecret !== expectedSecret && pathSecret !== expectedSecret) {
            return new Response(JSON.stringify({ error: "Unauthorized: Invalid webhook secret" }), {
              status: 401,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
        } else if (!isTestMode) {
          return new Response(JSON.stringify({ error: "Unauthorized: Webhook secret not configured" }), {
            status: 401,
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

        // For attendance routes, verify Telegram initData authentication and group role isolation
        const initDataHeader = extractInitDataFromRequest(request);
        if (type === "attendance") {
          if (!initDataHeader && !isTestMode) {
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

          if (type === "attendance" && initDataHeader) {
            const verifyResult = await verifyTelegramInitData(initDataHeader, TELEGRAM_BOT_TOKEN, { isTestMode });
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

            const isAuthorized = await checkUserGroupAccess(env.APP_DATA, userId, groupId);
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
          return new Response(JSON.stringify({ byGroup: { [groupId]: groupData }, updatedAt: groupData.updatedAt || 0 }), {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
              "Cache-Control": "no-cache, no-store, must-revalidate",
              "Pragma": "no-cache"
            }
          });
        }

        // PUT or POST save data to Cloudflare KV with per-group isolation
        if (request.method === "PUT" || request.method === "POST") {
          const hasAppKey = type !== "attendance" ? await requireAppKey(request, APP_SECRET) : false;
          let userBlindId = null;

          if (type !== "attendance" && !hasAppKey) {
            if (!initDataHeader) {
              return new Response(JSON.stringify({ error: "Unauthorized: Missing X-App-Key or Telegram initData" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }
            const verifyResult = await verifyTelegramInitData(initDataHeader, TELEGRAM_BOT_TOKEN, { isTestMode });
            if (!verifyResult.ok || !verifyResult.user?.id) {
              return new Response(JSON.stringify({ error: verifyResult.error || "Unauthorized: Invalid Telegram initData" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }
            userBlindId = await blindId(env, verifyResult.user.id);
          }

          const rawText = await request.text();
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
            const isAdmin = Boolean(env && env.ADMIN_BLIND_ID && userBlindId === env.ADMIN_BLIND_ID);
            let isStaff = false;
            if (groupId) {
              const groupRaw = await env.APP_DATA.get("g:" + groupId);
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

          if (type === "attendance" && initDataHeader) {
            const verifyResult = await verifyTelegramInitData(initDataHeader, TELEGRAM_BOT_TOKEN, { isTestMode });
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

            const isAuthorized = await checkUserGroupAccess(env.APP_DATA, userId, groupId);
            if (!isAuthorized) {
              return new Response(JSON.stringify({ error: "Access denied to group attendance" }), {
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
          const groupSlice = {
            ...existingGroup,
            ...incomingSlice,
            updatedAt: Date.now()
          };

          if (type === "attendance") {
            if (incomingSlice.records !== undefined) groupSlice.records = incomingSlice.records;
            else if (existingGroup.records !== undefined) groupSlice.records = existingGroup.records;

            if (incomingSlice.students !== undefined) groupSlice.students = incomingSlice.students;
            else if (existingGroup.students !== undefined) groupSlice.students = existingGroup.students;
          }

          await env.APP_DATA.put(kvKey, JSON.stringify(groupSlice));
          return new Response(JSON.stringify({ ok: true, updatedAt: groupSlice.updatedAt }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }

      // 2. File Upload to Telegram Channel / Owner Relay (Bug Reports)
      if (url.pathname === "/upload" && request.method === "POST") {
        if (!BOT_TOKEN && !isTestMode) {
          return new Response(JSON.stringify({ error: "TELEGRAM_BOT_TOKEN is not configured" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Anti-DoS Rate Limiting for upload
        const now = Date.now();
        if (isUploadRateLimited(now)) {
          return new Response(JSON.stringify({ error: "Too many upload requests. Please wait a moment." }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const formData = await request.formData();
        const targetChat = (env && (env.DEV_CHAT_ID || env.TELEGRAM_DEV_CHAT_ID || env.CHANNEL_ID)) || CHANNEL_ID;
        if (!targetChat) {
          return new Response(JSON.stringify({ error: "Telegram recipient chat is not configured (missing DEV_CHAT_ID / TELEGRAM_CHANNEL_ID)" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        formData.set("chat_id", targetChat);

        let data;
        let resStatus = 200;
        if (isTestMode) {
          data = { ok: true, result: { message_id: 1234, document: { file_id: "mock_file_upload_123" } } };
          recordUploadSent(now);
        } else {
          const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
            method: "POST",
            body: formData,
          });
          data = await tgRes.json();
          resStatus = tgRes.status;
          if (tgRes.ok && data && data.ok) {
            recordUploadSent(now);
          }
        }
        return new Response(JSON.stringify(data), {
          status: resStatus,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 2b. Private Document Export for Starosta (Word .docx reports)
      if (url.pathname === "/export-doc" && request.method === "POST") {
        if (!(await requireAppKey(request, APP_SECRET))) {
          return new Response(JSON.stringify({ error: "Unauthorized: Invalid or missing X-App-Key" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        if (!BOT_TOKEN && !isTestMode) {
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
          const verifyResult = await verifyTelegramInitData(initDataHeader, TELEGRAM_BOT_TOKEN, { isTestMode });
          if (verifyResult.ok && verifyResult.user && verifyResult.user.id) {
            targetUserId = verifyResult.user.id;
          }
        }

        // Step 1: If user initData is valid, try direct send to their PM
        if (targetUserId) {
          if (!BOT_TOKEN && isTestMode) {
            tgJson = {
              ok: true,
              result: {
                document: {
                  file_id: "mock_export_file_12345",
                  file_name: String(rawFileName)
                }
              }
            };
            sentToUser = true;
          } else {
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
        }

        // Step 2: Fallback to private storage chat if direct send failed or initData is absent
        if (!sentToUser) {
          if (!BOT_TOKEN && isTestMode) {
            tgJson = {
              ok: true,
              result: {
                document: {
                  file_id: "mock_export_file_12345",
                  file_name: String(rawFileName)
                }
              }
            };
          } else {
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
        }

        if (!tgJson || !tgJson.ok) {
          return new Response(JSON.stringify({ error: tgJson?.description || "Failed to store document in Telegram" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const fileId = tgJson.result.document.file_id;
        const fileName = tgJson.result.document.file_name || rawFileName;

        const signingKey = APP_SECRET || TELEGRAM_BOT_TOKEN;
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
        if (!expStr || !sig) {
          return new Response("Missing signature or expiration", { status: 403, headers: corsHeaders });
        }

        const nowSec = Math.floor(Date.now() / 1000);
        const exp = parseInt(expStr, 10);
        if (!exp || isNaN(exp) || exp < nowSec) {
          return new Response("Expired file link", { status: 403, headers: corsHeaders });
        }

        let isValidSig = false;
        if (isTestMode && sig === "mock-valid") {
          isValidSig = true;
        } else {
          if (APP_SECRET) {
            isValidSig = await verifyFileSignature(fileId, exp, sig, APP_SECRET);
          }
          if (!isValidSig && TELEGRAM_BOT_TOKEN) {
            isValidSig = await verifyFileSignature(fileId, exp, sig, TELEGRAM_BOT_TOKEN);
          }
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
          if (isTestMode) {
            return new Response("MOCK_FILE_CONTENT", {
              headers: {
                ...corsHeaders,
                "Content-Type": contentType,
                "Content-Disposition": `attachment; filename="${safeAsciiName}"; filename*=UTF-8''${utf8EncodedName}`,
                "Cache-Control": "private, max-age=3600"
              }
            });
          }
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
        if (!samgtuGroupId) {
          return new Response(JSON.stringify({ error: "Missing groupId query param" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const targetUrl = `https://samgtu.ru/students/getschedule?GroupID=${encodeURIComponent(samgtuGroupId)}&WeekNumber=${encodeURIComponent(weekNumber)}`;
        const samgtuRes = await fetch(targetUrl, {
          headers: {
            "Accept": "application/json, text/plain, */*",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
          }
        });
        const samgtuData = await samgtuRes.text();
        return new Response(samgtuData, {
          status: samgtuRes.status,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=3600"
          }
        });
      }

      // 5. Telegram Notification Endpoint (for nightly sync / system alerts)
      if (url.pathname === "/notify" && request.method === "POST") {
        if (!(await requireAppKey(request, APP_SECRET))) {
          return new Response(JSON.stringify({ error: "Unauthorized: Invalid or missing X-App-Key" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        if (!BOT_TOKEN && !isTestMode) {
          return new Response(JSON.stringify({ error: "TELEGRAM_BOT_TOKEN is not configured" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const body = await request.json();
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

        if (!BOT_TOKEN && isTestMode) {
          return new Response(JSON.stringify({ ok: true, result: { message_id: 12345 } }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: targetChatId,
            text: text,
            parse_mode: body.parse_mode || "HTML"
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
        return new Response(JSON.stringify({ ok: true, telegram: tgJson }), {
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
