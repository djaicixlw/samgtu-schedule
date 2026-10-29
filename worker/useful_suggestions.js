/**
 * Student suggestions for the "Полезное" tab: the queue, the limits, moderation and the starosta's notifications.
 *
 * Until now a student's suggestion never left the phone: the server only accepts writes to the group's list from
 * staff (403 for students) and the app ignored that answer while telling the student "the starosta will check it".
 *
 * Data model (Workers KV, one key per record, so concurrent suggestions never overwrite each other):
 *   us:<gid>:<id>      pending suggestion (30 days)
 *   usc:<gid>          {n} number of pending suggestions (cheap badge, self-healing on a full list)
 *   usr:<blind>:<day>  suggestions made by one user today (Samara day)
 *   ub:<gid>:<blind>   author blocked by this group's staff
 *   ns:<gid>:<blind>   staff member's notification subscription: AES-GCM encrypted chat id
 *   nt:<gid>           "a notification was sent recently" marker (coalescing)
 *
 * Privacy: the author's @username / first name is stored only on the pending record, only when the student left
 * "show my name" on, and disappears with the record (approve, reject, 30 days). The pseudonymous blind id (HMAC of the
 * Telegram id) is kept to enforce limits and blocks; it is never returned to anyone.
 */

export const DAILY_LIMIT = 10;
export const QUEUE_CAP = 50;
export const MAX_SUBSCRIBERS = 5;
export const NOTIFY_COOLDOWN_MS = 5 * 60 * 1000;
export const PENDING_TTL_S = 30 * 24 * 3600;

const ID_RE = /^sg_[0-9a-z]{12}$/;
const TITLE_MAX = 100;
const TEXT_MAX = 2000;
const SUBJECT_MAX = 100;
const MAX_LINKS = 10;
const MAX_ATTACHMENTS = 5;
const URL_MAX = 500;

// control characters and invisible direction overrides (they can make text look like something else)
const INVISIBLE_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const HAS_INVISIBLE = new RegExp(INVISIBLE_RE.source);   // non-global: .test() on a /g regex keeps state between calls

export const cleanText = (v, max) => String(v === undefined || v === null ? '' : v).replace(INVISIBLE_RE, '').trim().slice(0, max);
export const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Calendar day in Samara (UTC+4): the daily limit resets at local midnight. */
export const samaraDay = (now = Date.now()) => new Date(now + 4 * 3600 * 1000).toISOString().slice(0, 10);

function safeHttpsUrl(raw) {
  try {
    const s = String(raw || '').trim();
    if (!s || s.length > URL_MAX || HAS_INVISIBLE.test(s)) return null;
    const u = new URL(s);
    if (u.protocol !== 'https:' || !u.hostname.includes('.') || u.username || u.password) return null;
    return u.toString();
  } catch { return null; }
}

/** Raw student input -> clean pending item, or an error. `origin` is this Worker's origin (attachments must live there). */
export function sanitizeSuggestion(raw, origin) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Пустое предложение' };
  const title = cleanText(raw.title, TITLE_MAX);
  const text = cleanText(raw.text, TEXT_MAX);
  if (!title && !text) return { ok: false, error: 'Заполните заголовок или текст' };

  const subject = cleanText(raw.subject, SUBJECT_MAX) || undefined;
  const tags = (Array.isArray(raw.tags) ? raw.tags : [])
    .map(t => cleanText(t, 30).toLowerCase().replace(/^#+/, ''))
    .filter(t => t.length > 0)
    .slice(0, 10);
  const links = [];
  for (const l of Array.isArray(raw.links) ? raw.links : []) {
    if (links.length >= MAX_LINKS) break;
    const url = l && safeHttpsUrl(l.url);
    if (url) links.push({ title: cleanText(l.title || url, 100) || url, url });
  }
  const attachments = [];
  for (const a of Array.isArray(raw.attachments) ? raw.attachments : []) {
    if (attachments.length >= MAX_ATTACHMENTS) break;
    if (!a || typeof a !== 'object') continue;
    // files can only be ones uploaded through this Worker (/upload -> /file?...), never an arbitrary external URL
    const url = typeof a.url === 'string' && a.url.startsWith(`${origin}/file?`) && a.url.length <= 1000 ? a.url : null;
    if (!url) continue;
    const tgUrl = typeof a.tgUrl === 'string' && a.tgUrl.startsWith(`${origin}/file?`) && a.tgUrl.length <= 1000 ? a.tgUrl : undefined;
    attachments.push({
      id: a.id ? cleanText(a.id, 100) : undefined,
      name: cleanText(a.name || 'Вложение', 120) || 'Вложение',
      url,
      tgUrl,
      type: a.type === 'image' ? 'image' : 'file',
      size: a.size === undefined ? undefined : cleanText(a.size, 20)
    });
  }
  return { ok: true, item: { title, text, subject, tags, links, attachments } };
}

/** What the starosta sees as the author: "@username", else the first name, else nothing (anonymous). */
export function authorLabel(tgUser, anonymous) {
  if (anonymous || !tgUser) return null;
  if (tgUser.username) return `@${cleanText(tgUser.username, 40)}`;
  return cleanText(tgUser.first_name, 40) || null;
}

const randomId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  return 'sg_' + Array.from(bytes, b => alphabet[b % 36]).join('');
};

const readJson = async (kv, key, fallback) => {
  try { const raw = await kv.get(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
};

export async function getPendingCount(env, gid) {
  const c = await readJson(env.APP_DATA, `usc:${gid}`, { n: 0 });
  return Math.max(0, Math.min(Number(c.n) || 0, QUEUE_CAP));
}
const setPendingCount = (env, gid, n) =>
  env.APP_DATA.put(`usc:${gid}`, JSON.stringify({ n: Math.max(0, Math.min(n, QUEUE_CAP)) }), { expirationTtl: PENDING_TTL_S });

/**
 * @returns {{ok:true,id:string,remaining:number,count:number,item:object}|{ok:false,status:number,code?:string,error:string}}
 */
export async function submitSuggestion(env, gid, blind, tgUser, raw, { origin, now = Date.now() } = {}) {
  const clean = sanitizeSuggestion(raw, origin);
  if (!clean.ok) return { ok: false, status: 400, code: 'INVALID', error: clean.error };

  if (await env.APP_DATA.get(`ub:${gid}:${blind}`)) {
    return { ok: false, status: 403, code: 'BLOCKED', error: 'Староста группы отключил для вас предложения' };
  }
  const day = samaraDay(now);
  const usageKey = `usr:${blind}:${day}`;
  const used = Number(await env.APP_DATA.get(usageKey)) || 0;
  if (used >= DAILY_LIMIT) {
    return { ok: false, status: 429, code: 'DAILY_LIMIT', error: `Лимит: не более ${DAILY_LIMIT} предложений в сутки` };
  }
  const count = await getPendingCount(env, gid);
  if (count >= QUEUE_CAP) {
    return { ok: false, status: 429, code: 'QUEUE_FULL', error: 'У старосты слишком много непроверенных предложений. Попробуйте позже' };
  }

  const anonymous = raw.anonymous === true;
  const id = randomId();
  const record = {
    id,
    ...clean.item,
    author: authorLabel(tgUser, anonymous),
    anonymous,
    ab: blind,                       // pseudonymous author id: limits and blocking only, never returned
    createdAt: new Date(now).toISOString()
  };
  await env.APP_DATA.put(`us:${gid}:${id}`, JSON.stringify(record), { expirationTtl: PENDING_TTL_S });
  await env.APP_DATA.put(usageKey, String(used + 1), { expirationTtl: 2 * 24 * 3600 });
  await setPendingCount(env, gid, count + 1);
  return { ok: true, id, remaining: DAILY_LIMIT - (used + 1), count: count + 1, item: record };
}

/** Public view of a pending record (no pseudonymous author id). */
const publicView = (r) => ({
  id: r.id, title: r.title, text: r.text, subject: r.subject, tags: r.tags, links: r.links,
  attachments: r.attachments, author: r.author, anonymous: Boolean(r.anonymous), createdAt: r.createdAt
});

export async function listPending(env, gid) {
  const res = await env.APP_DATA.list({ prefix: `us:${gid}:`, limit: QUEUE_CAP * 2 });
  const items = [];
  for (const k of res.keys || []) {
    const r = await readJson(env.APP_DATA, k.name, null);
    if (r && ID_RE.test(String(r.id))) items.push(publicView(r));
  }
  items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  await setPendingCount(env, gid, items.length);   // heals the cheap counter
  return items;
}

/** action: approve | reject | block | unblock_all. Idempotent: an already handled suggestion is not an error. */
export async function decideSuggestion(env, gid, id, action) {
  if (action === 'unblock_all') {
    const res = await env.APP_DATA.list({ prefix: `ub:${gid}:`, limit: 500 });
    for (const k of res.keys || []) await env.APP_DATA.delete(k.name);
    return { ok: true, unblocked: (res.keys || []).length };
  }
  if (!ID_RE.test(String(id))) return { ok: false, status: 400, error: 'Некорректный id' };
  if (action !== 'approve' && action !== 'reject' && action !== 'block') return { ok: false, status: 400, error: 'Неизвестное действие' };
  const record = await readJson(env.APP_DATA, `us:${gid}:${id}`, null);
  if (!record) return { ok: true, already: true };
  await env.APP_DATA.delete(`us:${gid}:${id}`);
  if (action === 'block' && record.ab) {
    await env.APP_DATA.put(`ub:${gid}:${record.ab}`, '1', { expirationTtl: 365 * 24 * 3600 });
  }
  await setPendingCount(env, gid, (await getPendingCount(env, gid)) - 1);
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------
// Notifications to the starosta
// ---------------------------------------------------------------------------------------------------------------

/** deps: { encryptChatId, decryptChatId } from the Worker (kept out of this file to avoid a circular import) */
export async function setSubscription(env, gid, blind, chatId, enable, deps) {
  const key = `ns:${gid}:${blind}`;
  if (!enable) { await env.APP_DATA.delete(key); return { ok: true, subscribed: false }; }
  const existing = await env.APP_DATA.get(key);
  if (!existing) {
    const list = await env.APP_DATA.list({ prefix: `ns:${gid}:`, limit: MAX_SUBSCRIBERS + 1 });
    if ((list.keys || []).length >= MAX_SUBSCRIBERS) {
      return { ok: false, status: 409, error: `Уведомления можно включить не более чем у ${MAX_SUBSCRIBERS} человек в группе` };
    }
  }
  const enc = await deps.encryptChatId(chatId, env.ID_PEPPER);
  await env.APP_DATA.put(key, JSON.stringify({ ...enc, at: Date.now() }));
  return { ok: true, subscribed: true };
}

export async function isSubscribed(env, gid, blind) {
  return Boolean(await env.APP_DATA.get(`ns:${gid}:${blind}`));
}

/**
 * Tells subscribed staff about a new suggestion. At most one message per group per NOTIFY_COOLDOWN_MS (the badge in the
 * app covers the rest), the text is HTML-escaped (it contains student input), dead subscriptions are removed.
 */
export async function notifyStaff(env, gid, record, pendingCount, deps, { botToken, miniAppUrl, fetchFn = fetch, now = Date.now() } = {}) {
  if (!botToken) return { sent: 0, skipped: 'no-bot-token' };
  const lastSent = Number(await env.APP_DATA.get(`nt:${gid}`)) || 0;   // compare the time itself: KV TTL is only a cleanup
  if (lastSent && now - lastSent < NOTIFY_COOLDOWN_MS) return { sent: 0, skipped: 'cooldown' };
  const subs = await env.APP_DATA.list({ prefix: `ns:${gid}:`, limit: MAX_SUBSCRIBERS + 1 });
  if (!(subs.keys || []).length) return { sent: 0, skipped: 'no-subscribers' };
  await env.APP_DATA.put(`nt:${gid}`, String(now), { expirationTtl: Math.max(60, Math.ceil(NOTIFY_COOLDOWN_MS / 1000)) });

  const title = escapeHtml(cleanText(record.title || record.text, 60));
  const who = record.author ? escapeHtml(record.author) : 'аноним';
  const text =
    `📌 <b>Новое предложение в «Полезном»</b>\nГруппа: ${escapeHtml(gid)}\n«${title}» — ${who}\n\nЖдут проверки: ${pendingCount}`;
  let sent = 0;
  for (const k of subs.keys) {
    const sub = await readJson(env.APP_DATA, k.name, null);
    const chatId = sub ? await deps.decryptChatId(sub.enc, sub.iv, env.ID_PEPPER) : null;
    if (!chatId) { await env.APP_DATA.delete(k.name); continue; }
    try {
      const res = await fetchFn(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true,
          reply_markup: { inline_keyboard: [[{ text: '📌 Открыть «Полезное»', web_app: { url: miniAppUrl } }]] }
        })
      });
      if (res.ok) sent++;
      else if (res.status === 403 || res.status === 400) await env.APP_DATA.delete(k.name);   // blocked the bot / chat gone
    } catch { /* network error: keep the subscription */ }
  }
  return { sent };
}

// ---------------------------------------------------------------------------------------------------------------
// The public list ("Полезное") must never carry pending items or author identifiers
// ---------------------------------------------------------------------------------------------------------------

export function sanitizeUsefulItemForPublic(it, defaultGid = '') {
  if (!it || typeof it !== 'object' || it.isPending) return null;           // pending items are never public
  const title = cleanText(it.title, TITLE_MAX);
  const text = cleanText(it.text, TEXT_MAX);
  if (!title && !text) return null;
  const links = [];
  for (const l of Array.isArray(it.links) ? it.links : []) {
    if (links.length >= MAX_LINKS) break;
    const url = l && safeHttpsUrl(l.url);
    if (url) links.push({ title: cleanText(l.title || url, 100) || url, url });
  }
  const attachments = (Array.isArray(it.attachments) ? it.attachments : []).slice(0, 10).map(a => ({
    id: a && a.id ? cleanText(a.id, 100) : undefined,
    name: cleanText((a && a.name) || 'Вложение', 120) || 'Вложение',
    url: a && typeof a.url === 'string' ? a.url.slice(0, 1000) : undefined,
    tgUrl: a && typeof a.tgUrl === 'string' ? a.tgUrl.slice(0, 1000) : undefined,
    type: a && typeof a.type === 'string' ? cleanText(a.type, 20) : undefined,
    size: a && a.size !== undefined ? cleanText(a.size, 20) : undefined
  })).filter(a => a.url || a.tgUrl || a.id);
  return {
    id: cleanText(it.id, 100) || `useful_${Date.now()}`,
    groupId: cleanText(it.groupId || defaultGid, 64),
    title, text,
    subject: cleanText(it.subject, SUBJECT_MAX) || undefined,
    tags: (Array.isArray(it.tags) ? it.tags : []).map(t => cleanText(t, 30).toLowerCase().replace(/^#+/, '')).filter(Boolean).slice(0, 10),
    isPinned: Boolean(it.isPinned),
    order: typeof it.order === 'number' && Number.isFinite(it.order) ? it.order : undefined,
    links, attachments,
    createdAt: typeof it.createdAt === 'string' ? it.createdAt.slice(0, 40) : new Date().toISOString(),
    updatedAt: typeof it.updatedAt === 'string' ? it.updatedAt.slice(0, 40) : undefined,
    createdBy: typeof it.createdBy === 'string' ? cleanText(it.createdBy, 60) : undefined
    // submittedBy is dropped on purpose: it held the student's numeric Telegram id and @username
  };
}

/** Group document {items, deletedIds?, updatedAt} -> public-safe copy. */
/** Group document {items, deletedIds?, updatedAt} -> public-safe copy. */
export function sanitizeUsefulGroup(group, gid = '') {
  if (!group || typeof group !== 'object') return group;
  const out = { ...group };
  if (Array.isArray(group.items)) {
    out.items = group.items.slice(0, 200).map(it => sanitizeUsefulItemForPublic(it, gid)).filter(Boolean);
  }
  if (Array.isArray(group.deletedIds)) {
    out.deletedIds = group.deletedIds.map(x => String(x).slice(0, 100)).slice(-1000);
  }
  return out;
}
