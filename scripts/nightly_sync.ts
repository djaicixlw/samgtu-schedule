import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import { SAMGTU_GROUP_MAP } from '../utils/samgtuGroupMap';
import { SCHEDULE_REGISTRY } from '../constants';
import { blockWindow } from '../utils/officialSchedule';
import { loadSemesterConfig, samaraISO } from '../utils/samaraDate';
import { Lesson, DaySchedule } from '../types';
import { TIME_SLOTS, DAY_NAMES, DAY_CODES, GROUP_ID_PREFIXES, parseCellName, findExistingTeacher, serializeGroupSchedule, serializeIngt310InsideRegistry } from './sync_official_schedule';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONSTANTS_PATH = path.resolve(__dirname, '../constants.ts');

// Pause between portal requests (tests set 0).
const SYNC_DELAY_MS = Number(process.env.SYNC_REQUEST_DELAY_MS ?? 80);

/** Thresholds of the write guards. A group is never rewritten from data that looks truncated. */
export const MIN_KEPT_SHARE = 0.6;
export const MIN_EXISTING_FOR_SHRINK_CHECK = 20;

export interface SyncResult {
  diffs: Record<string, GroupDiff>;
  /** groupId -> why the group was left untouched (incomplete portal data, suspicious shrink, ...) */
  skipped: Record<string, string>;
  applied: boolean;
}

export async function fetchJson(url: string, timeoutMs = 10000, retries = 3, delayMs = 300): Promise<any> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await new Promise((resolve, reject) => {
        const req = https.get(url, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const clean = data.replace(/^\uFEFF/, '').trim();
              if (clean.startsWith('<')) {
                return reject(new Error(`HTML response received instead of JSON (status ${res.statusCode}): ${clean.substring(0, 100)}`));
              }
              resolve(JSON.parse(clean));
            } catch (e) {
              reject(e);
            }
          });
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
          req.destroy();
          reject(new Error(`Timeout fetching ${url}`));
        });
      });
      return res;
    } catch (err: any) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, delayMs * attempt));
    }
  }
}

export interface GroupDiff {
  groupName: string;
  groupId: string;
  added: string[];
  removed: string[];
  changed: string[];
}

/**
 * Sends a Telegram notification (via direct Bot API or Cloudflare Worker fallback).
 */
export async function sendTelegramNotification(messageText: string): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const targetChatId = process.env.DEV_CHAT_ID || process.env.TELEGRAM_DEV_CHAT_ID || process.env.TELEGRAM_CHANNEL_ID;

  if (!botToken || !targetChatId) {
    console.log('[Telegram Notification Skipped] TELEGRAM_BOT_TOKEN or DEV_CHAT_ID is not set in environment.');
    return false;
  }

  return new Promise<boolean>((resolve) => {
    const payload = JSON.stringify({
      chat_id: targetChatId,
      text: messageText,
      parse_mode: 'HTML'
    });

    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${botToken}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          console.log('[Telegram Notification Sent Successfully]');
          resolve(true);
        } else {
          console.warn(`[Telegram Notification Failed] HTTP ${res.statusCode}: ${body}`);
          resolve(false);
        }
      });
    });

    req.on('error', (err) => {
      console.warn('[Telegram Notification Error]', err.message);
      resolve(false);
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Main nightly audit & sync routine.
 */
export async function runNightlySync(): Promise<SyncResult> {
  const isDryRun = process.argv.includes('--dry-run');
  const isAutoApply = !isDryRun && (process.argv.includes('--apply') || process.env.AUTO_APPLY === 'true');

  console.log('\n================================================================');
  console.log('🌙 НОЧНАЯ АВТОСВЕРКА РАСПИСАНИЯ С ОФИЦИАЛЬНЫМ API САМГТУ');
  console.log(`Режим: ${isDryRun ? 'DRY-RUN (ТОЛЬКО АУДИТ)' : isAutoApply ? 'AUTO-APPLY (ОБНОВЛЕНИЕ И ОПОВЕЩЕНИЕ)' : 'CHECK'}`);
  console.log('================================================================\n');

  const allDiffs: Record<string, GroupDiff> = {};
  const skipped: Record<string, string> = {};

  // The portal publishes a new set of subjects every block (4 weeks); the app's 4-week cycle is built from the
  // portal weeks of the CURRENT block (e.g. weeks 9..12 for block 3), not from fixed weeks 1..8.
  const semester = loadSemesterConfig();
  const todayISO = process.env.SYNC_TODAY || samaraISO();
  const window = blockWindow(todayISO, semester);
  const schedulesDirForMeta = path.resolve(__dirname, '../public/schedules');
  const metaPath = path.join(schedulesDirForMeta, '_sync-state.txt'); // not *.json: loaders read every *.json in this folder as a schedule
  let previousWindowStart: number | null = null;
  try { previousWindowStart = JSON.parse(fs.readFileSync(metaPath, 'utf8')).windowStart ?? null; } catch {}
  const blockChanged = previousWindowStart !== null && previousWindowStart !== window.start;
  console.log(`📅 Сегодня ${todayISO}: блок ${window.blockId ?? '?'}, недели портала ${window.weeks.join(', ')}` +
    (blockChanged ? ` (НОВЫЙ БЛОК: расписание было с недели ${previousWindowStart})` : ''));
  const updatedSchedules: Record<string, Record<number, DaySchedule[]>> = {};
  let totalParsedLessonsAcrossAll = 0;

  for (const [groupId, conf] of Object.entries(SAMGTU_GROUP_MAP)) {
    // AUD-034: entries from the AUTO-GENERATED map section carry
    // samgtuGroupId: 0 (portal numeric id unknown until a human fills it in).
    // Polling the official API with 0 would be nonsense — skip explicitly.
    if (!conf.samgtuGroupId) {
      console.log(`Пропуск ${conf.name} [${groupId}]: samgtuGroupId не задан (AUTO-GENERATED, заполните карту вручную).`);
      continue;
    }
    console.log(`Проверка: ${conf.name} [${groupId}]...`);
    const prefix = GROUP_ID_PREFIXES[groupId] || groupId;
    const groupDiff: GroupDiff = {
      groupName: conf.name,
      groupId,
      added: [],
      removed: [],
      changed: []
    };

    const groupWeeks: Record<number, DaySchedule[]> = {};
    const rawOfficialWeeks: Record<number, any> = {};
    let fetchErrorOccurred = false;

    for (const portalWeek of window.weeks) {
      const url = `https://samgtu.ru/students/getschedule?GroupID=${conf.samgtuGroupId}&WeekNumber=${portalWeek}`;
      try {
        const res = await fetchJson(url);
        await new Promise(r => setTimeout(r, SYNC_DELAY_MS));
        if (res && typeof res === 'object' && res.wd) {
          rawOfficialWeeks[portalWeek] = res;
        }
      } catch (err: any) {
        fetchErrorOccurred = true;
        console.warn(`  ⚠️ Не удалось загрузить неделю ${portalWeek} для ${conf.name}: ${err.message}`);
      }
    }

    // All 4 weeks of the block must be present: with a missing week the cycle would silently be built from
    // nothing, and the result would be committed and deployed.
    const missingWeeks = window.weeks.filter(pw => !rawOfficialWeeks[pw]);
    if (missingWeeks.length > 0) {
      const reason = `нет данных портала за недели ${missingWeeks.join(', ')}${fetchErrorOccurred ? ' (сетевая ошибка)' : ''}`;
      console.warn(`  🛡️ [Защита] ${conf.name}: ${reason}. Локальное расписание не тронуто.`);
      skipped[groupId] = reason;
      continue;
    }

    // Load existing schedule across all 4 weeks to guard against empty API wiping local schedule
    let existingTotalLessons = 0;
    const existingGroupSchedule: Record<number, DaySchedule[]> = {};
    for (let w = 1; w <= 4; w++) {
      let existingWeek = SCHEDULE_REGISTRY[groupId]?.[w as 1 | 2 | 3 | 4] || [];
      const hasLessons = existingWeek.some(d => Array.isArray(d.lessons) && d.lessons.length > 0);
      if (!hasLessons) {
        const chunkPath = path.resolve(__dirname, `../public/schedules/${groupId}.json`);
        if (fs.existsSync(chunkPath)) {
          try {
            const chunkData = JSON.parse(fs.readFileSync(chunkPath, 'utf8'));
            if (chunkData && Array.isArray(chunkData[w])) {
              existingWeek = chunkData[w];
            }
          } catch {}
        }
      }
      existingGroupSchedule[w] = existingWeek;
      existingTotalLessons += existingWeek.reduce((acc, d) => acc + (d.lessons?.length || 0), 0);
    }

    let groupParsedLessons = 0;

    for (let w = 1; w <= 4; w++) {
      const weekDays: DaySchedule[] = [];

      for (let dayIdx = 1; dayIdx <= 6; dayIdx++) {
        const dayName = DAY_NAMES[dayIdx - 1];
        const dayCode = DAY_CODES[dayIdx - 1];

        const hasCells = (d: any) => d?.at && Object.values(d.at as Record<string, any>).some((s: any) => s.Cells && s.Cells.length > 0);
        let offDay = rawOfficialWeeks[window.start + w - 1]?.wd?.[String(dayIdx)];

        // First block only: Monday 31 August has 0 pairs on the portal, take the Monday of cycle week 3
        if (window.start === 1 && w === 1 && dayIdx === 1 && !hasCells(offDay)) {
          offDay = rawOfficialWeeks[window.start + 2]?.wd?.['1'];
        }

        const offLessons: Lesson[] = [];

        if (offDay && offDay.at) {
          const sortedSlots = Object.entries(offDay.at as Record<string, any>)
            .map(([slotKey, slotData]) => ({ slotKey: Number(slotKey), slotData }))
            .sort((a, b) => a.slotKey - b.slotKey);

          let lessonCounter = 1;
          for (const { slotKey, slotData } of sortedSlots) {
            if (!TIME_SLOTS[String(slotKey)]) continue; // строго звонки 1..6 (без 7-й пары)
            if (slotData.Cells && slotData.Cells.length > 0) {
              for (const cell of slotData.Cells) {
                const parsed = parseCellName(cell.CellName);
                const times = TIME_SLOTS[String(slotKey)];
                const existingWeek = existingGroupSchedule[w] || [];
                const teacher = findExistingTeacher(groupId, parsed.subject, parsed.type, existingWeek);

                offLessons.push({
                  id: `${prefix}-w${w}-${dayCode}-${lessonCounter}`,
                  timeStart: times.timeStart,
                  timeEnd: times.timeEnd,
                  subject: parsed.subject,
                  type: parsed.type,
                  location: parsed.location,
                  teacher
                });
                lessonCounter++;
              }
            }
          }
        }

        groupParsedLessons += offLessons.length;
        weekDays.push({ dayName, lessons: offLessons });
      }

      groupWeeks[w] = weekDays;
    }

    // Safety guard: if official API returned 0 lessons while existing schedule has lessons, do not wipe
    if (groupParsedLessons === 0 && existingTotalLessons > 0) {
      console.warn(`  🛡️ [Защита] API вернул 0 пар для группы ${conf.name}, но в локальном расписании ${existingTotalLessons} пар. Защита от затирания активирована, локальное расписание сохранено.`);
      skipped[groupId] = `портал вернул 0 пар вместо ${existingTotalLessons}`;
      continue;
    }

    if (!blockChanged && existingTotalLessons >= MIN_EXISTING_FOR_SHRINK_CHECK && groupParsedLessons < existingTotalLessons * MIN_KEPT_SHARE) {
      const reason = `портал вернул ${groupParsedLessons} пар вместо ${existingTotalLessons} (меньше ${Math.round(MIN_KEPT_SHARE * 100)}%)`;
      console.warn(`  🛡️ [Защита] ${conf.name}: ${reason}. Похоже на неполные данные, расписание не тронуто.`);
      skipped[groupId] = reason;
      continue;
    }

    totalParsedLessonsAcrossAll += groupParsedLessons;

    // Compare lessons for differences
    for (let w = 1; w <= 4; w++) {
      const existingWeek = existingGroupSchedule[w] || [];
      const offWeek = groupWeeks[w] || [];

      for (let dayIdx = 1; dayIdx <= 6; dayIdx++) {
        const dayName = DAY_NAMES[dayIdx - 1];
        const curDay = existingWeek.find(d => d.dayName === dayName);
        const curLessons = curDay?.lessons || [];
        const offDay = offWeek.find(d => d.dayName === dayName);
        const offLessons = offDay?.lessons || [];

        // 1. Added lessons
        for (const ol of offLessons) {
          const match = curLessons.find(cl => cl.timeStart === ol.timeStart && cl.subject.toLowerCase() === ol.subject.toLowerCase());
          if (!match) {
            groupDiff.added.push(`Н${w} ${dayName} ${ol.timeStart}: «${ol.subject}» (${ol.type}, ${ol.location || 'ауд. не указана'})`);
          } else if (match.location !== ol.location && ol.location) {
            groupDiff.changed.push(`Н${w} ${dayName} ${ol.timeStart} «${ol.subject}»: смена аудитории (${match.location} ➔ ${ol.location})`);
          }
        }

        // 2. Removed lessons
        for (const cl of curLessons) {
          // Special exception: 31 August Monday lessons for future cycles are preserved
          if (w === 1 && dayName === 'Понедельник' && cl.subject) continue;

          const match = offLessons.find(ol => ol.timeStart === cl.timeStart && ol.subject.toLowerCase() === cl.subject.toLowerCase());
          if (!match) {
            groupDiff.removed.push(`Н${w} ${dayName} ${cl.timeStart}: «${cl.subject}»`);
          }
        }
      }
    }

    updatedSchedules[groupId] = groupWeeks;

    const totalGroupDiffs = groupDiff.added.length + groupDiff.removed.length + groupDiff.changed.length;
    if (totalGroupDiffs > 0) {
      allDiffs[groupId] = groupDiff;
      console.log(`  ⚡ Найдено расхождений: ${totalGroupDiffs} (Добавлено: ${groupDiff.added.length}, Снято: ${groupDiff.removed.length}, Изменено: ${groupDiff.changed.length})`);
    } else {
      console.log(`  ✅ Полное совпадение (0 расхождений)`);
    }
  }

  const groupsWithChanges = Object.values(allDiffs);

  console.log('\n================================================================');
  console.log(`ИТОГИ СВЕРКИ: ${groupsWithChanges.length} из ${Object.keys(SAMGTU_GROUP_MAP).length} групп имеют изменения.`);
  console.log('================================================================');

  const skippedNote = Object.keys(skipped).length > 0
    ? `\n⚠️ <b>Пропущены группы (${Object.keys(skipped).length}):</b>\n` + Object.entries(skipped).map(([g, why]) => `  • ${SAMGTU_GROUP_MAP[g]?.name || g}: ${why}`).join('\n') + '\n'
    : '';

  if (groupsWithChanges.length === 0) {
    if (skippedNote) {
      console.log('⚠️ Изменений нет, но часть групп пропущена защитой:' + skippedNote.replace(/<[^>]+>/g, ''));
      await sendTelegramNotification(`🔔 <b>Автосверка расписания СамГТУ</b>\n${skippedNote}`);
    } else {
      console.log('✨ Изменений не обнаружено. Все расписания актуальны. Уведомление в Telegram не требуется (тихий режим).');
    }
    return { diffs: allDiffs, skipped, applied: false };
  }

  // Format Telegram Alert
  const now = new Date();
  const samaraTimeStr = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + (4 * 3600000))
    .toLocaleString('ru-RU', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  let msg = `🔔 <b>Обнаружены изменения в расписании СамГТУ!</b>\n`;
  msg += `<i>Автосверка: ${samaraTimeStr} (Самара)</i>\n\n`;

  for (const diff of groupsWithChanges) {
    msg += `📚 <b>Группа ${diff.groupName}:</b>\n`;
    if (diff.added.length > 0) {
      msg += `  ➕ <b>Добавлено (${diff.added.length}):</b>\n`;
      diff.added.slice(0, 5).forEach(a => msg += `    • ${a}\n`);
      if (diff.added.length > 5) msg += `    <i>...и еще ${diff.added.length - 5} пар</i>\n`;
    }
    if (diff.removed.length > 0) {
      msg += `  ➖ <b>Снято (${diff.removed.length}):</b>\n`;
      diff.removed.slice(0, 5).forEach(r => msg += `    • ${r}\n`);
      if (diff.removed.length > 5) msg += `    <i>...и еще ${diff.removed.length - 5} пар</i>\n`;
    }
    if (diff.changed.length > 0) {
      msg += `  🔄 <b>Изменено (${diff.changed.length}):</b>\n`;
      diff.changed.slice(0, 5).forEach(c => msg += `    • ${c}\n`);
    }
    msg += `\n`;
  }

  // Circuit breaker: do not apply if total lessons < 50
  if (totalParsedLessonsAcrossAll < 50) {
    console.error(`🚨 СРАБОТАЛ CIRCUIT BREAKER: Спарсено всего ${totalParsedLessonsAcrossAll} пар. Запись отменена.`);
    msg += `⚠️ <i>Внимание: Автообновление заблокировано защитным порогом безопасности (<50 пар). Требуется ручная проверка.</i>`;
    await sendTelegramNotification(msg);
    return { diffs: allDiffs, skipped, applied: false };
  }

  msg += skippedNote;

  let applied = false;
  if (isAutoApply) {
    console.log(`\nПрименяю обновления в ${CONSTANTS_PATH}...`);
    let fileContent = fs.readFileSync(CONSTANTS_PATH, 'utf-8');
    const applyErrors: string[] = [];

    // Update ingt-310 inside SCHEDULE_REGISTRY export
    if (updatedSchedules['ingt-310']) {
      const ingt310Serialized = serializeIngt310InsideRegistry(updatedSchedules['ingt-310']);
      const ingt310Regex = /\s*'ingt-310':\s*\{[^]*?\n\s{2}\}/;
      if (ingt310Regex.test(fileContent)) {
        fileContent = fileContent.replace(ingt310Regex, `\n\n${ingt310Serialized}`);
      } else {
        applyErrors.push('ingt-310');
      }
    }

    // Update other groups (faid-310, ingt-311, ingt-301, ingt-303, ingt-209, htf-215)
    const otherGroups = ['faid-310', 'ingt-311', 'ingt-301', 'ingt-303', 'ingt-209', 'htf-215'];
    for (const gid of otherGroups) {
      if (updatedSchedules[gid]) {
        const serialized = serializeGroupSchedule(gid, updatedSchedules[gid]);
        const regex = new RegExp(`SCHEDULE_REGISTRY\\['${gid}'\\]\\s*=\\s*\\{[\\s\\S]*?\\n\\};`, 'm');
        if (regex.test(fileContent)) {
          fileContent = fileContent.replace(regex, serialized);
        } else {
          applyErrors.push(gid);
        }
      }
    }

    if (applyErrors.length > 0) {
      // constants.ts and public/schedules/*.json must never diverge: write nothing and say so loudly.
      console.error(`🚨 Не найден блок расписания в constants.ts для: ${applyErrors.join(', ')}. Запись отменена, файлы не изменены.`);
      msg += `🚨 <b>Автообновление отменено:</b> в constants.ts не найден блок для ${applyErrors.join(', ')}. Формат файла изменился, нужна ручная проверка.`;
      await sendTelegramNotification(msg);
      process.exitCode = 1;
      return { diffs: allDiffs, skipped, applied: false };
    }

    fs.writeFileSync(CONSTANTS_PATH, fileContent, 'utf-8');
    console.log('✅ constants.ts успешно обновлен!');

    // Also update public/schedules/*.json for on-demand chunk loading
    const schedulesDir = path.resolve(__dirname, '../public/schedules');
    if (!fs.existsSync(schedulesDir)) {
      fs.mkdirSync(schedulesDir, { recursive: true });
    }
    if (blockChanged) {
      // keep the previous block's template: past attendance must still be readable against it
      const archiveDir = path.join(schedulesDir, 'archive', `block-from-week-${previousWindowStart}`);
      fs.mkdirSync(archiveDir, { recursive: true });
      for (const file of fs.readdirSync(schedulesDir)) {
        if (file.endsWith('.json')) {
          fs.copyFileSync(path.join(schedulesDir, file), path.join(archiveDir, file));
        }
      }
    }
    for (const [gid, sched] of Object.entries(updatedSchedules)) {
      const hasAnyLessons = Object.values(sched).some(w => Array.isArray(w) && w.some(d => Array.isArray(d.lessons) && d.lessons.length > 0));
      if (!hasAnyLessons) {
        console.warn(`  🛡️ [Защита] Пропуск записи ${gid}.json: пустое расписание!`);
        continue;
      }
      const jsonPath = path.join(schedulesDir, `${gid}.json`);
      fs.writeFileSync(jsonPath, JSON.stringify(sched, null, 2), 'utf-8');
    }
    if (Object.keys(skipped).length === 0) {
      fs.writeFileSync(metaPath, JSON.stringify({ windowStart: window.start, blockId: window.blockId ?? null, updatedAt: todayISO }, null, 2) + '\n', 'utf-8');
    }
    console.log(`✅ public/schedules/*.json (${Object.keys(updatedSchedules).length} файлов) успешно обновлены!`);

    msg += `✅ <b>Расписание в приложении успешно обновлено.</b>`;
    applied = true;
  } else {
    msg += `ℹ️ <i>Режим аудита (без автоприменения). Для применения запустите с флагом --apply</i>`;
  }

  console.log('\n--- ДЕТАЛИ ИЗМЕНЕНИЙ ---\n' + msg.replace(/<[^>]+>/g, ''));

  // Send the Telegram alert
  await sendTelegramNotification(msg);
  return { diffs: allDiffs, skipped, applied };
}

/** Total parsed lessons in one week (array of DaySchedule). */
export function countWeekLessons(week?: DaySchedule[]): number {
  if (!Array.isArray(week)) return 0;
  return week.reduce((acc, d) => acc + (Array.isArray(d?.lessons) ? d.lessons.length : 0), 0);
}

/** Canonical form used for equality: schedule content without cosmetic field order. */
function canonicalWeek(week?: DaySchedule[]): string {
  const days = Array.isArray(week) ? week : [];
  return JSON.stringify(days.map(d => ({
    dayName: d?.dayName,
    lessons: (Array.isArray(d?.lessons) ? d.lessons : []).map(l => ({
      id: l.id,
      timeStart: l.timeStart,
      timeEnd: l.timeEnd,
      subject: l.subject,
      type: l.type,
      location: l.location,
      teacher: l.teacher || ''
    }))
  })));
}

export function weeksEqual(a?: DaySchedule[], b?: DaySchedule[]): boolean {
  return canonicalWeek(a) === canonicalWeek(b);
}

export interface WeekWriteDecision {
  /** true = the parsed week must be written (week really changed). */
  write: boolean;
  /** ok = changed; empty-api-guard = API week empty over non-empty existing; unchanged = identical content. */
  reason: 'ok' | 'empty-api-guard' | 'unchanged';
  apiLessons: number;
  existingLessons: number;
}

/**
 * AUD-033 core decision for ONE week:
 *   - API week is empty AND existing week has lessons -> DO NOT write (guard);
 *   - API week content identical to existing -> no write needed (nothing changed);
 *   - otherwise -> write the freshly parsed week.
 */
export function resolveWeekWrite(apiWeek?: DaySchedule[], existingWeek?: DaySchedule[]): WeekWriteDecision {
  const apiLessons = countWeekLessons(apiWeek);
  const existingLessons = countWeekLessons(existingWeek);

  if (apiLessons === 0 && existingLessons > 0) {
    return { write: false, reason: 'empty-api-guard', apiLessons, existingLessons };
  }
  if (weeksEqual(apiWeek, existingWeek)) {
    return { write: false, reason: 'unchanged', apiLessons, existingLessons };
  }
  return { write: true, reason: 'ok', apiLessons, existingLessons };
}

export interface PerWeekGuardResult {
  /** Weeks safe to persist: parsed week when writing, existing week otherwise. */
  weeks: Record<number, DaySchedule[]>;
  decisions: Record<number, WeekWriteDecision>;
  /** Human-readable warnings, one per guarded (kept-old) week. */
  warnings: string[];
}

/**
 * Applies resolveWeekWrite to all 4 weeks. A guarded week keeps the EXISTING
 * schedule in the output (so downstream diff/serialization never sees an empty
 * week) and produces a warning.
 */
export function applyPerWeekGuards(
  apiWeeks: Record<number, DaySchedule[]>,
  existingWeeks: Record<number, DaySchedule[]>
): PerWeekGuardResult {
  const weeks: Record<number, DaySchedule[]> = {};
  const decisions: Record<number, WeekWriteDecision> = {};
  const warnings: string[] = [];

  for (let w = 1; w <= 4; w++) {
    const apiWeek = apiWeeks[w] || [];
    const existingWeek = existingWeeks[w] || [];
    const decision = resolveWeekWrite(apiWeek, existingWeek);
    decisions[w] = decision;

    if (decision.reason === 'empty-api-guard') {
      warnings.push(
        `  🛡️ [Защита AUD-033] Неделя ${w}: API вернул 0 пар, но в существующем расписании ${decision.existingLessons} пар. Существующая неделя сохранена, запись пустой недели отклонена.`
      );
      weeks[w] = existingWeek;
    } else if (decision.reason === 'unchanged') {
      weeks[w] = existingWeek;
    } else {
      weeks[w] = apiWeek;
    }
  }

  return { weeks, decisions, warnings };
}

/** True when at least one week of the group has decision.write (really changed). */
export function groupHasChangedWeek(
  gid: string,
  decisionsByGroup: Record<string, Record<number, WeekWriteDecision>>
): boolean {
  const decisions = decisionsByGroup[gid];
  if (!decisions) return true; // no guard info (e.g. legacy caller) — behave as before
  return Object.values(decisions).some(d => d.write);
}

/**
 * AUD-033: the week-building loop of runNightlySync, extracted verbatim so the
 * mock-source test exercises the production path (official JSON shape in,
 * DaySchedule weeks out).
 */
export function buildOfficialWeeks(params: {
  rawEarly: Record<number, any>;
  rawLate: Record<number, any>;
  prefix: string;
  groupId: string;
  existingGroupSchedule: Record<number, DaySchedule[]>;
}): { weeks: Record<number, DaySchedule[]>; parsedLessons: number } {
  const { rawEarly, rawLate, prefix, groupId, existingGroupSchedule } = params;
  const weeks: Record<number, DaySchedule[]> = {};
  let parsedLessons = 0;

  for (let w = 1; w <= 4; w++) {
    const weekDays: DaySchedule[] = [];

    for (let dayIdx = 1; dayIdx <= 6; dayIdx++) {
      const dayName = DAY_NAMES[dayIdx - 1];
      const dayCode = DAY_CODES[dayIdx - 1];

      const hasCells = (d: any) => d?.at && Object.values(d.at as Record<string, any>).some((s: any) => s.Cells && s.Cells.length > 0);
      const dayLate = rawLate[w]?.wd?.[String(dayIdx)];
      const dayEarly = rawEarly[w]?.wd?.[String(dayIdx)];
      let offDay = hasCells(dayLate) ? dayLate : dayEarly;

      // Fallback for Monday Week 1 (31 August has 0 pairs on portal)
      if (w === 1 && dayIdx === 1 && !hasCells(offDay)) {
        const w3Late = rawLate[3]?.wd?.['1'];
        const w3Early = rawEarly[3]?.wd?.['1'];
        offDay = hasCells(w3Late) ? w3Late : w3Early;
      }

      const offLessons: Lesson[] = [];

      if (offDay && offDay.at) {
        const sortedSlots = Object.entries(offDay.at as Record<string, any>)
          .map(([slotKey, slotData]) => ({ slotKey: Number(slotKey), slotData }))
          .sort((a, b) => a.slotKey - b.slotKey);

        let lessonCounter = 1;
        for (const { slotKey, slotData } of sortedSlots) {
          if (!TIME_SLOTS[String(slotKey)]) continue; // строго звонки 1..6 (без 7-й пары)
          if (slotData.Cells && slotData.Cells.length > 0) {
            for (const cell of slotData.Cells) {
              const parsed = parseCellName(cell.CellName);
              const times = TIME_SLOTS[String(slotKey)];
              const existingWeek = existingGroupSchedule[w] || [];
              const teacher = findExistingTeacher(groupId, parsed.subject, parsed.type, existingWeek);

              offLessons.push({
                id: `${prefix}-w${w}-${dayCode}-${lessonCounter}`,
                timeStart: times.timeStart,
                timeEnd: times.timeEnd,
                subject: parsed.subject,
                type: parsed.type,
                location: parsed.location,
                teacher
              });
              lessonCounter++;
            }
          }
        }
      }

      parsedLessons += offLessons.length;
      weekDays.push({ dayName, lessons: offLessons });
    }

    weeks[w] = weekDays;
  }

  return { weeks, parsedLessons };
}

if (process.argv[1] && process.argv[1].endsWith('nightly_sync.ts')) {
  runNightlySync().catch(err => {
    console.error('Fatal error in nightly sync:', err);
    process.exit(1);
  });
}
