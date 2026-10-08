import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import { SAMGTU_GROUP_MAP } from '../utils/samgtuGroupMap';
import { SCHEDULE_REGISTRY } from '../constants';
import { Lesson, DaySchedule } from '../types';
import { TIME_SLOTS, DAY_NAMES, DAY_CODES, GROUP_ID_PREFIXES, parseCellName, findExistingTeacher, serializeGroupSchedule, serializeIngt310InsideRegistry } from './sync_official_schedule';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONSTANTS_PATH = path.resolve(__dirname, '../constants.ts');

export function fetchJson(url: string, timeoutMs = 8000): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const clean = data.replace(/^\uFEFF/, '');
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
export async function runNightlySync() {
  const isDryRun = process.argv.includes('--dry-run');
  const isAutoApply = !isDryRun && (process.argv.includes('--apply') || process.env.AUTO_APPLY === 'true');

  console.log('\n================================================================');
  console.log('🌙 НОЧНАЯ АВТОСВЕРКА РАСПИСАНИЯ С ОФИЦИАЛЬНЫМ API САМГТУ');
  console.log(`Режим: ${isDryRun ? 'DRY-RUN (ТОЛЬКО АУДИТ)' : isAutoApply ? 'AUTO-APPLY (ОБНОВЛЕНИЕ И ОПОВЕЩЕНИЕ)' : 'CHECK'}`);
  console.log('================================================================\n');

  const allDiffs: Record<string, GroupDiff> = {};
  const updatedSchedules: Record<string, Record<number, DaySchedule[]>> = {};
  let totalParsedLessonsAcrossAll = 0;

  for (const [groupId, conf] of Object.entries(SAMGTU_GROUP_MAP)) {
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

    for (let w = 1; w <= 4; w++) {
      const url = `https://samgtu.ru/students/getschedule?GroupID=${conf.samgtuGroupId}&WeekNumber=${w}`;
      try {
        rawOfficialWeeks[w] = await fetchJson(url);
      } catch (err: any) {
        console.warn(`  ⚠️ Не удалось загрузить неделю ${w} для ${conf.name}: ${err.message}`);
      }
    }

    for (let w = 1; w <= 4; w++) {
      const officialData = rawOfficialWeeks[w];
      if (!officialData) continue;

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
      const weekDays: DaySchedule[] = [];

      for (let dayIdx = 1; dayIdx <= 6; dayIdx++) {
        const dayName = DAY_NAMES[dayIdx - 1];
        const dayCode = DAY_CODES[dayIdx - 1];
        let offDay = officialData?.wd?.[String(dayIdx)];

        // Fallback for Monday Week 1 (31 August has 0 pairs on portal) from Monday Week 3 (odd week cycle)
        if (w === 1 && dayIdx === 1) {
          const w1HasCells = offDay?.at && Object.values(offDay.at as Record<string, any>).some((s: any) => s.Cells && s.Cells.length > 0);
          const w3Monday = rawOfficialWeeks[3]?.wd?.['1'];
          if (!w1HasCells && w3Monday) {
            offDay = w3Monday;
          }
        }

        const curDay = existingWeek.find(d => d.dayName === dayName);
        const curLessons = curDay?.lessons || [];
        const offLessons: Lesson[] = [];

        if (offDay && offDay.at) {
          const sortedSlots = Object.entries(offDay.at as Record<string, any>)
            .map(([slotKey, slotData]) => ({ slotKey: Number(slotKey), slotData }))
            .sort((a, b) => a.slotKey - b.slotKey);

          let lessonCounter = 1;
          for (const { slotKey, slotData } of sortedSlots) {
            if (slotData.Cells && slotData.Cells.length > 0) {
              for (const cell of slotData.Cells) {
                const parsed = parseCellName(cell.CellName);
                const times = TIME_SLOTS[String(slotKey)] || { timeStart: '00:00', timeEnd: '00:00' };
                const teacher = findExistingTeacher(groupId, parsed.subject, parsed.type);

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

        // LK timetable corrections for 3-ИНГТ-110 (ingt-310):
        if (groupId === 'ingt-310') {
          // 1. Tuesday odd weeks (1 & 3): LK has no 8:00 AM class, starts at 9:45
          if ((w === 1 || w === 3) && dayIdx === 2) {
            const idx = offLessons.findIndex(l => l.timeStart === '08:00');
            if (idx >= 0) offLessons.splice(idx, 1);
          }
          // 2. Monday odd weeks (1 & 3): No "Конструирование", strictly BZhD lab (13:35-15:10, note to 17:15) & lecture (17:25)
          if ((w === 1 || w === 3) && dayIdx === 1) {
            const pe = offLessons.find(l => l.timeStart === '11:50');
            offLessons.length = 0;
            if (pe) {
              offLessons.push(pe);
            } else {
              offLessons.push({
                id: `${prefix}-w${w}-mo-1`,
                timeStart: '11:50',
                timeEnd: '13:25',
                subject: 'Элективные курсы по физической культуре и спорту',
                type: 'Практические занятия',
                location: 'Спортивный комплекс',
                teacher: 'Кафедра физического воспитания'
              });
            }
            offLessons.push({
              id: `${prefix}-w${w}-mo-2`,
              timeStart: '13:35',
              timeEnd: '15:10',
              subject: 'Безопасность жизнедеятельности',
              type: 'Лабораторные работы',
              location: 'Корпус № 6, 87',
              teacher: 'Кривова Маргарита Андреевна',
              note: 'пара до 17:15'
            });
            offLessons.push({
              id: `${prefix}-w${w}-mo-4`,
              timeStart: '17:25',
              timeEnd: '19:00',
              subject: 'Безопасность жизнедеятельности',
              type: 'Лекции',
              location: 'Корпус № 1, 432',
              teacher: 'Сорокина Людмила Владимировна'
            });
          }
        }

        totalParsedLessonsAcrossAll += offLessons.length;
        weekDays.push({ dayName, lessons: offLessons });

        // Compare lessons for differences
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

      groupWeeks[w] = weekDays;
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

  if (groupsWithChanges.length === 0) {
    console.log('✨ Изменений не обнаружено. Все расписания актуальны. Уведомление в Telegram не требуется (тихий режим).');
    return;
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
    return;
  }

  if (isAutoApply) {
    console.log(`\nПрименяю обновления в ${CONSTANTS_PATH}...`);
    let fileContent = fs.readFileSync(CONSTANTS_PATH, 'utf-8');

    // Update ingt-310 inside SCHEDULE_REGISTRY export
    if (updatedSchedules['ingt-310']) {
      const ingt310Serialized = serializeIngt310InsideRegistry(updatedSchedules['ingt-310']);
      fileContent = fileContent.replace(
        /\s*'ingt-310':\s*\{[^]*?\n\s{2}\}/,
        `\n\n${ingt310Serialized}`
      );
    }

    // Update other groups (faid-310, ingt-311, ingt-301, ingt-303, ingt-209, htf-215)
    const otherGroups = ['faid-310', 'ingt-311', 'ingt-301', 'ingt-303', 'ingt-209', 'htf-215'];
    for (const gid of otherGroups) {
      if (updatedSchedules[gid]) {
        const serialized = serializeGroupSchedule(gid, updatedSchedules[gid]);
        const regex = new RegExp(`SCHEDULE_REGISTRY\\['${gid}'\\]\\s*=\\s*\\{[\\s\\S]*?\\n\\};`, 'm');
        if (regex.test(fileContent)) {
          fileContent = fileContent.replace(regex, serialized);
        }
      }
    }

    fs.writeFileSync(CONSTANTS_PATH, fileContent, 'utf-8');
    console.log('✅ constants.ts успешно обновлен!');

    // Also update public/schedules/*.json for on-demand chunk loading
    const schedulesDir = path.resolve(__dirname, '../public/schedules');
    if (!fs.existsSync(schedulesDir)) {
      fs.mkdirSync(schedulesDir, { recursive: true });
    }
    for (const [gid, sched] of Object.entries(updatedSchedules)) {
      const jsonPath = path.join(schedulesDir, `${gid}.json`);
      fs.writeFileSync(jsonPath, JSON.stringify(sched, null, 2), 'utf-8');
    }
    console.log(`✅ public/schedules/*.json (${Object.keys(updatedSchedules).length} файлов) успешно обновлены!`);

    msg += `✅ <b>Расписание в приложении успешно обновлено.</b>`;
  } else {
    msg += `ℹ️ <i>Режим аудита (без автоприменения). Для применения запустите с флагом --apply</i>`;
  }

  console.log('\n--- ДЕТАЛИ ИЗМЕНЕНИЙ ---\n' + msg.replace(/<[^>]+>/g, ''));

  // Send the Telegram alert
  await sendTelegramNotification(msg);
}

if (process.argv[1] && process.argv[1].endsWith('nightly_sync.ts')) {
  runNightlySync().catch(err => {
    console.error('Fatal error in nightly sync:', err);
    process.exit(1);
  });
}
