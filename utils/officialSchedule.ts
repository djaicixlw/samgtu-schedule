import { SCHEDULE_REGISTRY } from '../constants';
import { DaySchedule } from '../types';
import { SEED_SUBJECT_TEACHERS_BY_GROUP, SEED_SUBJECT_TEACHERS } from '../defaultData';

/**
 * Single source of truth for reading the official SamGTU portal feed. The nightly sync, the one-off sync scripts,
 * and the in-app "Сверка / Синхронизировать" buttons all use THIS code, so they cannot disagree about what
 * a cell means (subject, lesson type, room) or which teacher belongs to it.
 */

// Звонки СамГТУ
export const TIME_SLOTS: Record<string, { timeStart: string; timeEnd: string }> = {
  '1': { timeStart: '08:00', timeEnd: '09:35' },
  '2': { timeStart: '09:45', timeEnd: '11:20' },
  '3': { timeStart: '11:50', timeEnd: '13:25' },
  '4': { timeStart: '13:35', timeEnd: '15:10' },
  '5': { timeStart: '15:40', timeEnd: '17:15' },
  '6': { timeStart: '17:25', timeEnd: '19:00' }
};

export const DAY_NAMES = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
export const DAY_CODES = ['mo', 'tu', 'we', 'th', 'fr', 'sa'];


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
  // \p{L}: rooms and buildings carry Cyrillic letters ("109б", "корпус № 3б"), which \w does not match
  const locMatch = afterBold.match(/(?:аудитория\s+)?([\p{L}\d\-\/]+)\s+корпус\s+№?\s*([\p{L}\d]+)/iu);
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
export function findExistingTeacher(groupId: string, subject: string, type: string, existingWeek?: DaySchedule[]): string {
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

  // 0. Поиск в переданном existingWeek (если расписание подгружено on-demand)
  if (existingWeek && existingWeek.length > 0) {
    for (const day of existingWeek) {
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
    for (const day of existingWeek) {
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

// ---------------------------------------------------------------------------
// Which portal weeks to read
// ---------------------------------------------------------------------------
// The university changes the subjects every 4 weeks ("блок", see public/semester.json), and the portal numbers
// weeks from the first day of the semester. The 4-week cycle used by the app is therefore the 4 portal weeks of
// the CURRENT block: weeks 9..12 for block 3 (26.10 - 22.11), not weeks 1..8 forever.

export interface BlockConfig { semesterStart: string; blocks?: Array<{ id?: number; start: string; end: string }> }

const dayNumber = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / 86400000);
};

/** Portal week number (1 = the week that contains the semester start) of a YYYY-MM-DD date. */
export function portalWeekNumber(dateISO: string, semesterStartISO: string): number {
  return Math.max(1, Math.floor((dayNumber(dateISO) - dayNumber(semesterStartISO)) / 7) + 1);
}

export interface BlockWindow {
  /** first portal week of the window; cycle week 1 = portal week `start` */
  start: number;
  /** the 4 portal weeks that make up the cycle */
  weeks: number[];
  blockId?: number;
}

/** The 4 portal weeks of the block that contains `todayISO` (the last block when the date is past the semester). */
export function blockWindow(todayISO: string, config: BlockConfig): BlockWindow {
  const blocks = (config.blocks || []).filter(b => b.start && b.end);
  let block = blocks.find(b => todayISO >= b.start && todayISO <= b.end);
  if (!block && blocks.length > 0) block = todayISO < blocks[0].start ? blocks[0] : blocks[blocks.length - 1];
  const start = block
    ? portalWeekNumber(block.start, config.semesterStart)
    : Math.floor((portalWeekNumber(todayISO, config.semesterStart) - 1) / 4) * 4 + 1;
  return { start, weeks: [start, start + 1, start + 2, start + 3], blockId: block?.id };
}