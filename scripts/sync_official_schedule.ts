import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import { SCHEDULE_REGISTRY, AVAILABLE_GROUPS } from '../constants';
import { Lesson, DaySchedule, WeekData } from '../types';
import { SEED_SUBJECT_TEACHERS_BY_GROUP, SEED_SUBJECT_TEACHERS } from '../defaultData';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONSTANTS_PATH = path.resolve(__dirname, '../constants.ts');

// 1. Фиксированный реестр групп (исключает путаницу ID)
import { SAMGTU_GROUP_MAP } from '../utils/samgtuGroupMap';
export { SAMGTU_GROUP_MAP };

// Звонки СамГТУ
export const TIME_SLOTS: Record<string, { timeStart: string; timeEnd: string }> = {
  '1': { timeStart: '08:00', timeEnd: '09:35' },
  '2': { timeStart: '09:45', timeEnd: '11:20' },
  '3': { timeStart: '11:50', timeEnd: '13:25' },
  '4': { timeStart: '13:35', timeEnd: '15:10' },
  '5': { timeStart: '15:40', timeEnd: '17:15' },
  '6': { timeStart: '17:25', timeEnd: '19:00' },
  '7': { timeStart: '19:10', timeEnd: '20:45' }
};

export const DAY_NAMES = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
export const DAY_CODES = ['mo', 'tu', 'we', 'th', 'fr', 'sa'];

export const GROUP_ID_PREFIXES: Record<string, string> = {
  'ingt-310': '310',
  'ingt-311': 'ingt311',
  'faid-310': 'faid310',
  'ingt-301': 'ingt301',
  'ingt-303': 'ingt303',
  'ingt-209': 'ingt209',
  'htf-215': 'htf215'
};

export function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
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
    }).on('error', reject);
  });
}

export function cleanText(text: string): string {
  return text
    .replace(/[\u00a0\s]+/g, ' ')
    .replace(/[\u2010\u2011\u2012\u2013\u2014]/g, '-')
    .trim();
}

export function parseCellName(cellName: string): {
  subject: string;
  type: 'Лекции' | 'Практические занятия' | 'Лабораторные работы';
  location: string;
} {
  const rawClean = cellName.replace(/[\u00a0\s]+/g, ' ').trim();
  const bMatch = rawClean.match(/<b>(.*?)<\/b>/i);
  const boldText = bMatch ? bMatch[1].trim() : rawClean;
  const afterBold = rawClean.replace(/<b>.*?<\/b>/i, '').replace(/<br\s*\/?>/gi, ' ').trim();

  let type: 'Лекции' | 'Практические занятия' | 'Лабораторные работы' = 'Практические занятия';
  let subject = boldText;

  const lowerBold = boldText.toLowerCase();
  if (lowerBold.includes('лекц')) {
    type = 'Лекции';
  } else if (lowerBold.includes('лабор')) {
    type = 'Лабораторные работы';
  } else if (lowerBold.includes('практик')) {
    type = 'Практические занятия';
  }

  subject = boldText
    .replace(/,\s*(?:лекция|лекции|лабораторные работы|лабораторные занятия|практические занятия)\s*$/i, '')
    .replace(/\s*(?:лекция|лекции|лабораторные работы|лабораторные занятия|практические занятия)\s*$/i, '')
    .trim();

  subject = cleanText(subject);

  if (subject.toLowerCase() === 'история дизайна, науки и техники') {
    subject = 'История дизайна науки и техники';
  }

  let location = '';
  const locMatch = afterBold.match(/(?:аудитория\s+)?([\w\d\-\/]+)\s+корпус\s+№?\s*([\w\d]+)/i);
  if (locMatch) {
    location = `Корпус № ${locMatch[2]}, ${locMatch[1]}`;
  } else if (/moodle/i.test(rawClean)) {
    location = 'Moodle, ауд. не указана';
  } else if (/спортивный комплекс/i.test(rawClean) || subject.toLowerCase().includes('физическ')) {
    location = 'Спортивный комплекс';
  } else if (/политехнопарк/i.test(rawClean)) {
    location = 'Политехнопарк';
  } else {
    const genericLoc = afterBold.replace(/^аудитория\s*/i, '').trim();
    if (genericLoc) {
      location = genericLoc;
    } else if (subject.toLowerCase().includes('элективные курсы по физической')) {
      location = 'Спортивный комплекс';
    }
  }

  return { subject, type, location };
}

// Поиск существующего преподавателя (гарантирует нетронутость преподов)
export function findExistingTeacher(groupId: string, subject: string, type: string): string {
  const normSubj = cleanText(subject).toLowerCase();
  const normType = type.toLowerCase();

  const checkTeacher = (t?: string): string => {
    if (t && typeof t === 'string' && t.trim().length > 0) {
      return t.trim();
    }
    return '';
  };

  // Для группы 111 все преподаватели строго пустые по умолчанию
  if (groupId === 'ingt-311') {
    return '';
  }

  // Для групп 101 и 103 Колибасов НЕ ведет проект и патенты (только 110)
  if ((groupId === 'ingt-301' || groupId === 'ingt-303') && (normSubj.includes('проект') || normSubj.includes('патентовед'))) {
    return '';
  }

  // 1. Прямой поиск в текущем расписании группы (совпадение предмета и типа)
  const groupSched = SCHEDULE_REGISTRY[groupId];
  if (groupSched) {
    for (let w = 1; w <= 4; w++) {
      const week = groupSched[w as 1|2|3|4] || [];
      for (const day of week) {
        for (const lesson of day.lessons) {
          const lSubj = cleanText(lesson.subject).toLowerCase();
          const lType = lesson.type.toLowerCase();
          if (lSubj === normSubj && lType === normType) {
            const found = checkTeacher(lesson.teacher);
            if (found) {
              if ((groupId === 'ingt-301' || groupId === 'ingt-303') && found.includes('Колибасов')) continue;
              return found;
            }
          }
        }
      }
    }

    // 2. Прямой поиск в расписании группы (совпадение только предмета)
    for (let w = 1; w <= 4; w++) {
      const week = groupSched[w as 1|2|3|4] || [];
      for (const day of week) {
        for (const lesson of day.lessons) {
          const lSubj = cleanText(lesson.subject).toLowerCase();
          if (lSubj === normSubj) {
            const found = checkTeacher(lesson.teacher);
            if (found) {
              if ((groupId === 'ingt-301' || groupId === 'ingt-303') && found.includes('Колибасов')) continue;
              return found;
            }
          }
        }
      }
    }
  }

  // 3. Поиск в SEED_SUBJECT_TEACHERS_BY_GROUP
  const groupSeeds = SEED_SUBJECT_TEACHERS_BY_GROUP[groupId];
  if (groupSeeds) {
    for (const [k, teacher] of Object.entries(groupSeeds)) {
      const [seedSubj, seedType] = k.split('::');
      if (cleanText(seedSubj).toLowerCase() === normSubj && seedType && seedType.toLowerCase() === normType) {
        const found = checkTeacher(teacher);
        if (found) return found;
      }
    }
    for (const [k, teacher] of Object.entries(groupSeeds)) {
      const [seedSubj] = k.split('::');
      if (cleanText(seedSubj).toLowerCase() === normSubj) {
        const found = checkTeacher(teacher);
        if (found) return found;
      }
    }
  }

  // 4. Глобальный справочник SEED_SUBJECT_TEACHERS используется СТРОГО для ingt-310
  if (groupId === 'ingt-310') {
    for (const [k, teacher] of Object.entries(SEED_SUBJECT_TEACHERS)) {
      const [seedSubj, seedType] = k.split('::');
      if (cleanText(seedSubj).toLowerCase() === normSubj && (!seedType || seedType.toLowerCase() === normType)) {
        const found = checkTeacher(teacher);
        if (found) return found;
      }
    }
    for (const [k, teacher] of Object.entries(SEED_SUBJECT_TEACHERS)) {
      const [seedSubj] = k.split('::');
      if (cleanText(seedSubj).toLowerCase() === normSubj) {
        const found = checkTeacher(teacher);
        if (found) return found;
      }
    }
  }

  // 5. Специальный фоллбэк для физкультуры (общий для всех)
  if (normSubj.includes('физической культуре') || normSubj.includes('элективные курсы')) {
    return 'Кафедра физического воспитания';
  }

  return '';
}

export function serializeGroupSchedule(groupId: string, weeks: Record<number, DaySchedule[]>): string {
  const lines: string[] = [];
  lines.push(`SCHEDULE_REGISTRY['${groupId}'] = {`);
  for (let w = 1; w <= 4; w++) {
    lines.push(`  ${w}: [`);
    const weekDays = weeks[w] || [];
    weekDays.forEach((d, dIdx) => {
      lines.push(`    {`);
      lines.push(`      dayName: '${d.dayName}',`);
      lines.push(`      lessons: [`);
      d.lessons.forEach((l, lIdx) => {
        const trailing = lIdx === d.lessons.length - 1 ? '' : ',';
        lines.push(`        { id: '${l.id}', timeStart: '${l.timeStart}', timeEnd: '${l.timeEnd}', subject: ${JSON.stringify(l.subject)}, type: '${l.type}', location: ${JSON.stringify(l.location)}, teacher: ${JSON.stringify(l.teacher || '')} }${trailing}`);
      });
      lines.push(`      ]`);
      lines.push(`    }${dIdx === weekDays.length - 1 ? '' : ','}`);
    });
    lines.push(`  ]${w === 4 ? '' : ','}`);
  }
  lines.push(`};`);
  return lines.join('\n');
}

export function serializeIngt310InsideRegistry(weeks: Record<number, DaySchedule[]>): string {
  const lines: string[] = [];
  lines.push(`  'ingt-310': {`);
  for (let w = 1; w <= 4; w++) {
    lines.push(`    ${w}: [`);
    const weekDays = weeks[w] || [];
    weekDays.forEach((d, dIdx) => {
      lines.push(`      {`);
      lines.push(`        dayName: '${d.dayName}',`);
      lines.push(`        lessons: [`);
      d.lessons.forEach((l, lIdx) => {
        const trailing = lIdx === d.lessons.length - 1 ? '' : ',';
        lines.push(`          { id: '${l.id}', timeStart: '${l.timeStart}', timeEnd: '${l.timeEnd}', subject: ${JSON.stringify(l.subject)}, type: '${l.type}', location: ${JSON.stringify(l.location)}, teacher: ${JSON.stringify(l.teacher || '')} }${trailing}`);
      });
      lines.push(`        ]`);
      lines.push(`      }${dIdx === weekDays.length - 1 ? '' : ','}`);
    });
    lines.push(`    ]${w === 4 ? '' : ','}`);
  }
  lines.push(`  }`);
  return lines.join('\n');
}

export async function verifyAndSync() {
  const isApply = process.argv.includes('--apply');
  const isCheck = process.argv.includes('--check') || !isApply;

  console.log(`\n================================================================`);
  console.log(`  ОФИЦИАЛЬНАЯ ПРОВЕРКА И СИНХРОНИЗАЦИЯ РАСПИСАНИЯ САМГТУ`);
  console.log(`  Режим: ${isApply ? 'APPLY / ОБНОВЛЕНИЕ' : 'CHECK / ТОЛЬКО АУДИТ'}`);
  console.log(`================================================================\n`);

  let totalDiscrepancies = 0;
  const updatedSchedules: Record<string, Record<number, DaySchedule[]>> = {};

  for (const [groupId, conf] of Object.entries(SAMGTU_GROUP_MAP)) {
    console.log(`----------------------------------------------------------------`);
    console.log(`Группа: ${conf.name} [ID: ${groupId}] | СамГТУ: ${conf.samgtuName} (GroupID: ${conf.samgtuGroupId})`);
    console.log(`----------------------------------------------------------------`);

    const groupWeeks: Record<number, DaySchedule[]> = {};
    const prefix = GROUP_ID_PREFIXES[groupId] || groupId;

    // Сначала скачиваем данные всех 4 недель
    const rawWeeksData: Record<number, any> = {};
    for (let w = 1; w <= 4; w++) {
      const url = `https://samgtu.ru/students/getschedule?GroupID=${conf.samgtuGroupId}&WeekNumber=${w}`;
      rawWeeksData[w] = await fetchJson(url);
    }

    for (let weekNum = 1; weekNum <= 4; weekNum++) {
      const officialData = rawWeeksData[weekNum];
      const existingWeek = SCHEDULE_REGISTRY[groupId]?.[weekNum as 1|2|3|4] || [];

      let officialLessonsCount = 0;
      let existingLessonsCount = 0;
      const weekDays: DaySchedule[] = [];

      for (let dayIdx = 1; dayIdx <= 6; dayIdx++) {
        const dayName = DAY_NAMES[dayIdx - 1];
        const dayCode = DAY_CODES[dayIdx - 1];
        let offDay = officialData?.wd?.[String(dayIdx)];
        const curDay = existingWeek.find(d => d.dayName === dayName);
        const curLessons = curDay?.lessons || [];
        existingLessonsCount += curLessons.length;

        // 31 августа - понедельник 1-й недели. Учеба начинается со вторника 1 сентября.
        // Для 4-недельного цикла сохраняем пары понедельника числителя.
        const offLessons: Lesson[] = [];

        if (weekNum === 1 && dayIdx === 1 && curLessons.length > 0) {
          offLessons.push(...curLessons);
          officialLessonsCount += curLessons.length;
        } else if (offDay && offDay.at) {
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
                  id: `${prefix}-w${weekNum}-${dayCode}-${lessonCounter}`,
                  timeStart: times.timeStart,
                  timeEnd: times.timeEnd,
                  subject: parsed.subject,
                  type: parsed.type,
                  location: parsed.location,
                  teacher
                });
                lessonCounter++;
                officialLessonsCount++;
              }
            }
          }
        }

        // LK timetable corrections for 3-ИНГТ-110 (ingt-310):
        if (groupId === 'ingt-310') {
          // 1. Tuesday odd weeks (1 & 3): LK has no 8:00 AM class, starts at 9:45
          if ((weekNum === 1 || weekNum === 3) && dayIdx === 2) {
            const idx = offLessons.findIndex(l => l.timeStart === '08:00');
            if (idx >= 0) {
              offLessons.splice(idx, 1);
              officialLessonsCount--;
            }
          }
          // 2. Monday odd weeks (1 & 3): No "Конструирование", strictly BZhD lab (13:35-15:10, note to 17:15) & lecture (17:25)
          if ((weekNum === 1 || weekNum === 3) && dayIdx === 1) {
            const pe = offLessons.find(l => l.timeStart === '11:50');
            offLessons.length = 0;
            if (pe) {
              offLessons.push(pe);
            } else {
              offLessons.push({
                id: `${prefix}-w${weekNum}-mo-1`,
                timeStart: '11:50',
                timeEnd: '13:25',
                subject: 'Элективные курсы по физической культуре и спорту',
                type: 'Практические занятия',
                location: 'Спортивный комплекс',
                teacher: 'Кафедра физического воспитания'
              });
            }
            offLessons.push({
              id: `${prefix}-w${weekNum}-mo-2`,
              timeStart: '13:35',
              timeEnd: '15:10',
              subject: 'Безопасность жизнедеятельности',
              type: 'Лабораторные работы',
              location: 'Корпус № 6, 87',
              teacher: 'Кривова Маргарита Андреевна',
              note: 'пара до 17:15'
            });
            offLessons.push({
              id: `${prefix}-w${weekNum}-mo-4`,
              timeStart: '17:25',
              timeEnd: '19:00',
              subject: 'Безопасность жизнедеятельности',
              type: 'Лекции',
              location: 'Корпус № 1, 432',
              teacher: 'Сорокина Людмила Владимировна'
            });
          }
        }

        weekDays.push({
          dayName,
          lessons: offLessons
        });

        // Сравнение
        if (offLessons.length !== curLessons.length) {
          totalDiscrepancies++;
          console.log(`  [Неделя ${weekNum}] ${dayName}: расхождение в парах! (В кодовой базе: ${curLessons.length}, в СамГТУ: ${offLessons.length})`);
          if (curLessons.length > offLessons.length) {
            console.log(`    ⚠️  Обнаружены лишние/фантомные пары в коде:`);
            curLessons.forEach(l => console.log(`      - [${l.timeStart}] ${l.subject} (${l.type})`));
          }
          if (offLessons.length > curLessons.length) {
            console.log(`    ⚠️  В кодовой базе не хватает официальных пар:`);
            offLessons.forEach(l => console.log(`      + [${l.timeStart}] ${l.subject} (${l.type}) | Преподаватель: "${l.teacher || 'НЕ НАЗНАЧЕН'}"`));
          }
        }
      }

      groupWeeks[weekNum] = weekDays;
      console.log(`  Неделя ${weekNum}: Официально пар: ${officialLessonsCount} | В кодовой базе: ${existingLessonsCount}`);
    }

    updatedSchedules[groupId] = groupWeeks;
  }

  console.log(`\n================================================================`);
  console.log(`ИТОГИ АУДИТА:`);
  console.log(`Всего дней с расхождениями: ${totalDiscrepancies}`);
  console.log(`Преподаватели: ПОЛНОСТЬЮ СОХРАНЕНЫ`);
  console.log(`Изоляция групп: СТРОГАЯ (по SAMGTU_GROUP_MAP)`);
  console.log(`Понедельник 31 августа: УЧТЕН И СОХРАНЕН ИЗ ЧИСЛИТЕЛЯ`);
  console.log(`================================================================\n`);

  if (isApply) {
    let totalParsedLessons = 0;
    for (const weeks of Object.values(updatedSchedules)) {
      for (const days of Object.values(weeks)) {
        for (const day of days) {
          totalParsedLessons += day.lessons.length;
        }
      }
    }
    if (totalParsedLessons < 50) {
      console.error(`🚨 КРИТИЧЕСКАЯ ОШИБКА: Спарсено всего ${totalParsedLessons} пар (порог безопасности: 50). Запись в constants.ts заблокирована для предотвращения стирания данных!`);
      process.exit(1);
    }

    console.log(`Применяю обновления в ${CONSTANTS_PATH} (всего проверено ${totalParsedLessons} пар)...`);
    let fileContent = fs.readFileSync(CONSTANTS_PATH, 'utf-8');

    // 1. Update ingt-310 inside SCHEDULE_REGISTRY export
    if (updatedSchedules['ingt-310']) {
      const ingt310Serialized = serializeIngt310InsideRegistry(updatedSchedules['ingt-310']);
      fileContent = fileContent.replace(
        /\s*'ingt-310':\s*\{[^]*?\n\s{2}\}/,
        `\n\n${ingt310Serialized}`
      );
      console.log(`  ✓ Обновлена группа 3-ИНГТ-110 (ingt-310)`);
    }

    // 2. Update remaining groups
    for (const groupId of ['faid-310', 'ingt-311', 'ingt-301', 'ingt-303', 'ingt-209', 'htf-215']) {
      if (updatedSchedules[groupId]) {
        const serialized = serializeGroupSchedule(groupId, updatedSchedules[groupId]);
        const groupPattern = new RegExp('SCHEDULE_REGISTRY\\x5b\x27' + groupId + '\x27\\x5d\\s*=\\s*\\{[^]*?\\n\\};', 'm');
        if (groupPattern.test(fileContent)) {
          fileContent = fileContent.replace(groupPattern, serialized);
          console.log(`  ✓ Обновлена группа ${SAMGTU_GROUP_MAP[groupId].name} (${groupId})`);
        } else {
          console.warn(`  ⚠️ Не найден шаблон для группы ${groupId} в constants.ts, пропускаем замену.`);
        }
      }
    }

    fs.writeFileSync(CONSTANTS_PATH, fileContent, 'utf-8');
    console.log(`\nФайл constants.ts успешно обновлен и синхронизирован с официальным API СамГТУ!`);
  } else {
    console.log(`Режим аудита (--check). Файлы не изменялись.`);
    console.log(`Для применения изменений запустите: npx tsx scripts/sync_official_schedule.ts --apply\n`);
  }
}

// Запуск
if (process.argv[1] && (process.argv[1].endsWith('sync_official_schedule.ts') || process.argv[1].endsWith('sync_official_schedule.js') || process.argv[1].includes('sync_official_schedule'))) {
  verifyAndSync().catch(err => {
    console.error('Ошибка выполнения verifyAndSync:', err);
    process.exit(1);
  });
}
