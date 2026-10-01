import { Lesson, DaySchedule, WeekData } from '../types';

export interface ParsedStudentMeta {
  studentName?: string;
  recordBookNumber?: string;
  groupName?: string;
  normalizedGroupId?: string;
}

export interface RawParsedLesson {
  date: string; // DD.MM.YYYY
  timeStart: string; // HH:MM
  timeEnd: string; // HH:MM
  subject: string;
  type: string;
  teacher: string;
  location: string;
  groups?: string;
  note?: string;
}

export interface ParsedScheduleResult {
  meta: ParsedStudentMeta;
  rawLessons: RawParsedLesson[];
  weeks: Record<number, DaySchedule[]>;
  totalUniqueLessons: number;
  uniqueSubjects: string[];
  uniqueTeachers: string[];
  dateRange: { start: string; end: string };
}

export interface ParseOptions {
  semesterStartDate?: string; // YYYY-MM-DD, defaults to '2026-08-31'
  groupIdOverride?: string;
  groupNameOverride?: string;
}

const DEFAULT_SEMESTER_START = '2026-08-31';

const DAY_NAMES = [
  'Воскресенье',
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота'
];

const DAY_CODES: Record<string, string> = {
  'Понедельник': 'mo',
  'Вторник': 'tu',
  'Среда': 'we',
  'Четверг': 'th',
  'Пятница': 'fr',
  'Суббота': 'sa',
  'Воскресенье': 'su'
};

const FACULTY_TO_ID_MAP: Record<string, string> = {
  'ИНГТ': 'ingt',
  'АСА': 'asa',
  'ИАИТ': 'iait',
  'ИТФ': 'itf',
  'ЭТФ': 'etf',
  'ХТФ': 'htf',
  'ТЭФ': 'tef',
  'ФММТ': 'fmmt',
  'ФПП': 'fpp',
  'ИИЭГО': 'iiego',
  'ФАИД': 'faid'
};

const ID_TO_FACULTY_MAP: Record<string, string> = {
  'ingt': 'ИНГТ',
  'asa': 'АСА',
  'iait': 'ИАИТ',
  'itf': 'ИТФ',
  'etf': 'ЭТФ',
  'htf': 'ХТФ',
  'tef': 'ТЭФ',
  'fmmt': 'ФММТ',
  'fpp': 'ФПП',
  'iiego': 'ИИЭГО',
  'faid': 'ФАИД'
};

/**
 * Normalizes SamGTU long group names like "3-ИНГТ-24ИНГТ-110" or "Группа 24ИНГТ–110" into "3-ИНГТ-110"
 * and generates clean internal group ID "ingt-310".
 */
export function normalizeSamgtuGroupName(rawName: string): { name: string; id: string } {
  const cleaned = rawName
    .replace(/^группа\s+/i, '')
    .replace(/[\u2010\u2011\u2012\u2013\u2014]/g, '-')
    .replace(/\s*[\(\[].*?[\)\]]/g, '')
    .trim();

  // Match patterns like "3-ИНГТ-24ИНГТ-110" -> "3-ИНГТ-110"
  const complexMatch = cleaned.match(/^(\d+)-([А-ЯЁA-Z]+)-\d+[А-ЯЁA-Z]+-(\d+)$/i);
  if (complexMatch) {
    const course = complexMatch[1];
    const faculty = complexMatch[2].toUpperCase();
    const groupNum = complexMatch[3];
    const shortName = `${course}-${faculty}-${groupNum}`;
    const facId = FACULTY_TO_ID_MAP[faculty] || faculty.toLowerCase();
    const id = `${facId}-${course}${groupNum.slice(-2)}`;
    return { name: shortName, id };
  }

  // Match standard pattern like "3-ИНГТ-110"
  const stdMatch = cleaned.match(/^(\d+)-([А-ЯЁA-Z]+)-(\d+)$/i);
  if (stdMatch) {
    const course = stdMatch[1];
    const faculty = stdMatch[2].toUpperCase();
    const groupNum = stdMatch[3];
    const facId = FACULTY_TO_ID_MAP[faculty] || faculty.toLowerCase();
    const id = `${facId}-${course}${groupNum.slice(-2)}`;
    return { name: `${course}-${faculty}-${groupNum}`, id };
  }

  // Match official SamGTU portal patterns like "24ИНГТ-113" or "25ИНГТ-109"
  const portalMatch = cleaned.match(/^(\d{2})([А-ЯЁA-Z]+)-(\d+)$/i);
  if (portalMatch) {
    const yearCode = parseInt(portalMatch[1], 10);
    // 24 -> 3 курс, 25 -> 2 курс, 26 -> 1 курс
    const course = yearCode === 24 ? 3 : yearCode === 25 ? 2 : yearCode === 26 ? 1 : yearCode === 23 ? 4 : 3;
    const faculty = portalMatch[2].toUpperCase();
    const groupNum = portalMatch[3];
    const facId = FACULTY_TO_ID_MAP[faculty] || faculty.toLowerCase();
    const id = `${facId}-${course}${groupNum.slice(-2)}`;
    return { name: `${course}-${faculty}-${groupNum}`, id };
  }

  // Match built-in id format like "ingt-311" or "faid-310"
  const builtinMatch = cleaned.match(/^([a-z]+)-([1-6])(\d{2})$/i);
  if (builtinMatch) {
    const facId = builtinMatch[1].toLowerCase();
    const course = builtinMatch[2];
    const num = builtinMatch[3];
    const facName = ID_TO_FACULTY_MAP[facId] || facId.toUpperCase();
    return { name: `${course}-${facName}-1${num}`, id: `${facId}-${course}${num}` };
  }

  const id = cleaned.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '-');
  return { name: cleaned, id: id || 'custom-group' };
}

/**
 * Returns a uniform canonical key for deduplication and dictionary matching.
 * Maps "3-ИНГТ-111", "ingt-311", "3-ингт-111", "Группа 24ИНГТ–111" to the exact same canonical string.
 */
export function getCanonicalGroupKey(input: { id?: string; name?: string } | string): string {
  if (!input) return '';
  const nameStr = typeof input === 'string' ? input : (input.name || '');
  const idStr = typeof input === 'string' ? input : (input.id || '');

  // 1. Try normalizing name
  if (nameStr) {
    const norm = normalizeSamgtuGroupName(nameStr);
    if (norm.id && norm.id !== 'custom-group') {
      return norm.id;
    }
  }

  // 2. Try normalizing id
  if (idStr) {
    const norm = normalizeSamgtuGroupName(idStr);
    if (norm.id && norm.id !== 'custom-group') {
      return norm.id;
    }
    // Clean id string: remove non-alphanumeric
    const cleanId = idStr.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
    if (cleanId) return cleanId;
  }

  // 3. Fallback clean name
  return nameStr.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
}

/**
 * Calculates which week of the 4-week cycle a given date falls into.
 * Week cycle: 1, 2, 3, 4.
 */
export function calculateWeekAndDay(dateStr: string, semesterStartStr: string = DEFAULT_SEMESTER_START): {
  weekNumber: number;
  dayName: string;
  dayCode: string;
  dateObj: Date;
} {
  // Parse DD.MM.YYYY
  const parts = dateStr.split('.');
  let d: Date;
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);
    d = new Date(year, month, day, 12, 0, 0); // midday to avoid DST/TZ edge cases
  } else {
    d = new Date(dateStr);
  }

  const [sYear, sMonth, sDay] = semesterStartStr.split('-').map(Number);
  const semStart = new Date(sYear, sMonth - 1, sDay, 12, 0, 0);

  const diffTime = d.getTime() - semStart.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  const weekIndex = Math.max(0, Math.floor(diffDays / 7));
  const weekNumber = (weekIndex % 4) + 1;

  const dayOfWeek = d.getDay();
  const dayName = DAY_NAMES[dayOfWeek] || 'Понедельник';
  const dayCode = DAY_CODES[dayName] || 'mo';

  return { weekNumber, dayName, dayCode, dateObj: d };
}

/**
 * Parses raw text or HTML copied from SamGTU LK (lk.samgtu.ru)
 */
export function parseSamgtuSchedule(rawContent: string, options: ParseOptions = {}): ParsedScheduleResult {
  const semesterStart = options.semesterStartDate || DEFAULT_SEMESTER_START;
  const meta: ParsedStudentMeta = {};
  const rawLessons: RawParsedLesson[] = [];

  // Clean HTML tags into readable text while keeping separators
  const cleanText = rawContent
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<td[^>]*>/gi, '\t')
    .replace(/<\/td>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\r\n/g, '\n');

  // 1. Extract Student Metadata
  const userMetaNameMatch = rawContent.match(/<div class="current-user__name">([^<]+)<\/div>/i);
  const userMetaInfoMatch = rawContent.match(/<div class="current-user__info">([^<]+)<\/div>/i);

  if (userMetaNameMatch) {
    meta.studentName = userMetaNameMatch[1].trim();
  }
  if (userMetaInfoMatch) {
    const infoText = userMetaInfoMatch[1].trim();
    const infoMatch = infoText.match(/Студент:\s*([^;,]+)(?:[;,]\s*№\s*зачетной книжки:\s*(\d+))?/i);
    if (infoMatch) {
      meta.groupName = infoMatch[1].trim();
      if (infoMatch[2]) meta.recordBookNumber = infoMatch[2].trim();
    }
  }

  if (!meta.groupName) {
    const studentMatch = cleanText.match(/Студент:\s*([^;,\n\r]+)(?:[;,\s]*№\s*зачетной книжки:\s*(\d+))?/i);
    if (studentMatch) {
      meta.groupName = studentMatch[1].trim();
      if (studentMatch[2]) meta.recordBookNumber = studentMatch[2].trim();
    }
  }

  if (!meta.studentName) {
    const nameMatch = cleanText.match(/([А-ЯЁ][а-яё]+)\s+([А-ЯЁ][а-яё]+)\s+([А-ЯЁ][а-яё]+)(?:\s*(?:Студент|Курс|Личный кабинет|\n|$))/);
    if (nameMatch) {
      meta.studentName = `${nameMatch[1]} ${nameMatch[2]} ${nameMatch[3]}`;
    }
  }

  if (options.groupNameOverride) {
    meta.groupName = options.groupNameOverride;
  }

  if (meta.groupName) {
    const norm = normalizeSamgtuGroupName(meta.groupName);
    meta.groupName = norm.name;
    meta.normalizedGroupId = options.groupIdOverride || norm.id;
  } else if (options.groupIdOverride) {
    meta.normalizedGroupId = options.groupIdOverride;
  }

  // 2. Extract Lesson Cards
  // Strategy A: Key-Value block regex parser
  const blockRegex = /Преподаватель\s*[:\t]?\s*([^\n\r]+)[\s\S]*?Дисциплина\s*[:\t]?\s*([^\n\r]+)[\s\S]*?Вид занятия\s*[:\t]?\s*([^\n\r]+)[\s\S]*?Дата проведения занятия\s*[:\t]?\s*(\d{2}\.\d{2}\.\d{4})[\s\S]*?Время проведения занятия\s*[:\t]?\s*(\d{2}:\d{2})\s*[-–—]\s*(\d{2}:\d{2})[\s\S]*?Место проведения занятия\s*[:\t]?\s*([^\n\r]+)(?:[\s\S]*?Группы\s*[:\t]?\s*([^\n\r]+))?/gi;

  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(cleanText)) !== null) {
    const teacher = match[1].trim();
    const subject = match[2].trim();
    const type = match[3].trim();
    const date = match[4].trim();
    const timeStart = match[5].trim();
    const timeEnd = match[6].trim();
    const location = match[7].trim();
    const groups = match[8]?.trim();

    rawLessons.push({
      date,
      timeStart,
      timeEnd,
      subject,
      type,
      teacher,
      location,
      groups
    });
  }

  // Strategy B: Fallback if cards have header-first format:
  if (rawLessons.length === 0) {
    const headerRegex = /(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2})[,\s]+([^,\n\r]+)[,\s]+([^\n\r]+)/g;
    let headerMatch: RegExpExecArray | null;
    const headerIndices: { index: number; date: string; time: string; type: string }[] = [];

    while ((headerMatch = headerRegex.exec(cleanText)) !== null) {
      headerIndices.push({
        index: headerMatch.index,
        date: headerMatch[1],
        time: headerMatch[2],
        type: headerMatch[3].trim()
      });
    }

    for (let i = 0; i < headerIndices.length; i++) {
      const curr = headerIndices[i];
      const nextIndex = i + 1 < headerIndices.length ? headerIndices[i + 1].index : cleanText.length;
      const chunk = cleanText.substring(curr.index, nextIndex);

      const teacherMatch = chunk.match(/Преподаватель\s*[:\t]?\s*([^\n\r]+)/i);
      const subjectMatch = chunk.match(/Дисциплина\s*[:\t]?\s*([^\n\r]+)/i);
      const timeRangeMatch = chunk.match(/Время проведения занятия\s*[:\t]?\s*(\d{2}:\d{2})\s*[-–—]\s*(\d{2}:\d{2})/i);
      const locMatch = chunk.match(/Место проведения занятия\s*[:\t]?\s*([^\n\r]+)/i);
      const grpMatch = chunk.match(/Группы\s*[:\t]?\s*([^\n\r]+)/i);

      if (subjectMatch && teacherMatch) {
        let timeEnd = '09:35';
        if (timeRangeMatch) {
          timeEnd = timeRangeMatch[2];
        } else {
          const startMap: Record<string, string> = {
            '08:00': '09:35',
            '09:45': '11:20',
            '11:50': '13:25',
            '13:35': '15:10',
            '15:40': '17:15',
            '17:25': '19:00'
          };
          timeEnd = startMap[curr.time] || '10:00';
        }

        rawLessons.push({
          date: curr.date,
          timeStart: timeRangeMatch ? timeRangeMatch[1] : curr.time,
          timeEnd,
          subject: subjectMatch[1].trim(),
          type: curr.type || 'Практические занятия',
          teacher: teacherMatch[1].trim(),
          location: locMatch ? locMatch[1].trim() : 'Корпус № 1',
          groups: grpMatch ? grpMatch[1].trim() : undefined
        });
      }
    }
  }

  // Strategy C: FullCalendar Month View HTML Parser (e.g. lk.samgtu.ru/distancelearning/distancelearning/index)
  if (rawLessons.length === 0 && (rawContent.includes('fc-day-grid-event') || rawContent.includes('id="calendar"'))) {
    // 1. Parse all tooltips at the bottom
    const tooltipRegex = /<div class="tooltip"[^>]*id="([^"]+)"[^>]*>[\s\S]*?<div class="tooltip-inner">([\s\S]*?)<\/div>/gi;
    const tooltips: Record<string, { time: string; teacher?: string; type?: string; groups?: string }> = {};
    let tm: RegExpExecArray | null;
    while ((tm = tooltipRegex.exec(rawContent)) !== null) {
      const lines = tm[2].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim().split('\n').map(s => s.trim()).filter(Boolean);
      tooltips[tm[1]] = {
        time: lines[0] || '',
        teacher: lines[1] || '',
        type: lines[2] || '',
        groups: lines[3] || ''
      };
    }

    // 2. Parse week rows
    const weekChunks = rawContent.split(/<div class="fc-row fc-week[^"]*"/);
    for (let w = 1; w < weekChunks.length; w++) {
      const chunk = weekChunks[w];
      const dateMatches = Array.from(chunk.matchAll(/data-date="(\d{4}-\d{2}-\d{2})"/g)).map(m => m[1]);
      const daysOfThisWeek = Array.from(new Set(dateMatches)).slice(0, 7);
      if (daysOfThisWeek.length < 5) continue;

      const tbodyMatch = chunk.match(/<div class="fc-content-skeleton">[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/);
      if (!tbodyMatch) continue;

      const trs = tbodyMatch[1].split(/<tr>/);
      const grid: boolean[][] = [];

      for (let r = 1; r < trs.length; r++) {
        const tr = trs[r];
        const tdMatches = Array.from(tr.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g));
        let col = 0;

        for (const td of tdMatches) {
          const attrs = td[1];
          const content = td[2];

          const rowspanMatch = attrs.match(/rowspan="(\d+)"/);
          const rowspan = rowspanMatch ? parseInt(rowspanMatch[1], 10) : 1;
          const colspanMatch = attrs.match(/colspan="(\d+)"/);
          const colspan = colspanMatch ? parseInt(colspanMatch[1], 10) : 1;

          while (grid[r] && grid[r][col]) {
            col++;
          }

          for (let ri = 0; ri < rowspan; ri++) {
            if (!grid[r + ri]) grid[r + ri] = [];
            for (let ci = 0; ci < colspan; ci++) {
              grid[r + ri][col + ci] = true;
            }
          }

          const isoDate = daysOfThisWeek[col];
          const evMatch = content.match(/<span class="fc-time">([^<]*)<\/span>\s*<span class="fc-title">([^<]*)<\/span>/);
          const ttMatch = content.match(/aria-describedby="([^"]*)"/);

          if (evMatch && isoDate) {
            const time = evMatch[1].trim();
            const subject = evMatch[2].trim();
            const ttId = ttMatch ? ttMatch[1] : '';
            const tt = ttId ? tooltips[ttId] : undefined;

            let timeStart = time;
            let timeEnd = '09:35';
            if (tt && tt.time.includes('-')) {
              const tp = tt.time.split('-');
              timeStart = tp[0].trim();
              timeEnd = tp[1].trim();
            } else {
              const startMap: Record<string, string> = {
                '08:00': '09:35',
                '09:45': '11:20',
                '11:50': '13:25',
                '13:35': '15:10',
                '15:40': '17:15',
                '17:25': '19:00'
              };
              timeEnd = startMap[timeStart] || '10:00';
            }

            const dParts = isoDate.split('-');
            const dateFormatted = `${dParts[2]}.${dParts[1]}.${dParts[0]}`;

            rawLessons.push({
              date: dateFormatted,
              timeStart,
              timeEnd,
              subject,
              type: tt?.type || 'Занятие',
              teacher: tt?.teacher || '',
              location: 'Корпус № 1',
              groups: tt?.groups
            });
          }

          col += colspan;
        }
      }
    }
  }

  // Strategy D: Telegram Bot message format (e.g. @samgtu_rasp_bot)
  if (rawLessons.length === 0 && (cleanText.includes('📅') || /📅\s*[А-Яа-яёЁ]+/i.test(cleanText))) {
    const MONTHS: Record<string, string> = {
      'января': '01',
      'февраля': '02',
      'марта': '03',
      'апреля': '04',
      'мая': '05',
      'июня': '06',
      'июля': '07',
      'августа': '08',
      'сентября': '09',
      'октября': '10',
      'ноября': '11',
      'декабря': '12'
    };

    const TYPE_MAP: Record<string, string> = {
      'лекция': 'Лекции',
      'практика': 'Практические занятия',
      'лаба': 'Лабораторные работы',
      'лабораторная': 'Лабораторные работы',
      'семинар': 'Семинар',
      'консультация': 'Консультация'
    };

    const year = parseInt(semesterStart.split('-')[0], 10) || 2026;
    const dayHeaderRegex = /📅\s*([А-Яа-яёЁ]+)[,\s]+(\d{1,2})\s+([А-Яа-яёЁ]+)/g;
    const dayIndices: { index: number; dayName: string; day: string; monthName: string }[] = [];
    let dm: RegExpExecArray | null;

    while ((dm = dayHeaderRegex.exec(cleanText)) !== null) {
      dayIndices.push({
        index: dm.index,
        dayName: dm[1],
        day: dm[2].padStart(2, '0'),
        monthName: dm[3].toLowerCase()
      });
    }

    for (let i = 0; i < dayIndices.length; i++) {
      const curr = dayIndices[i];
      const nextIndex = i + 1 < dayIndices.length ? dayIndices[i + 1].index : cleanText.length;
      const dayBlock = cleanText.substring(curr.index, nextIndex);
      const monthNum = MONTHS[curr.monthName] || '09';
      const dateFormatted = `${curr.day}.${monthNum}.${year}`;

      const timeRegex = /(?:[1-9]\uFE0F?\u20E3|[1-9]️⃣|\d+\.)?\s*(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/g;
      const timeMatches: { index: number; end: number; tStart: string; tEnd: string }[] = [];
      let tm: RegExpExecArray | null;
      while ((tm = timeRegex.exec(dayBlock)) !== null) {
        let tStart = tm[1].trim();
        if (tStart.length === 4) tStart = '0' + tStart;
        let tEnd = tm[2].trim();
        if (tEnd.length === 4) tEnd = '0' + tEnd;
        timeMatches.push({ index: tm.index, end: tm.index + tm[0].length, tStart, tEnd });
      }

      for (let j = 0; j < timeMatches.length; j++) {
        const currT = timeMatches[j];
        const nextTIndex = j + 1 < timeMatches.length ? timeMatches[j + 1].index : dayBlock.length;
        const lessonText = dayBlock.substring(currT.end, nextTIndex).trim();

        const lines = lessonText.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('___'));
        const subjectLine = lines[0] || '';
        const locLine = lines.find(l => l.includes('📍') || l.toLowerCase().includes('кор.') || l.toLowerCase().includes('ауд.')) || '';

        const subjMatch = subjectLine.match(/^[^\wА-Яа-яёЁ]*([^\n\r(]+?)(?:\s*\(([^)]+)\))?$/);
        const subject = subjMatch ? subjMatch[1].trim() : subjectLine.replace(/^[^\wА-Яа-яёЁ]+/, '').trim();
        const rawType = (subjMatch ? subjMatch[2] || '' : '').toLowerCase().trim();
        const type = TYPE_MAP[rawType] || (rawType ? rawType.charAt(0).toUpperCase() + rawType.slice(1) : 'Практические занятия');

        let location = 'Корпус № 12';
        let locRaw = locLine.replace(/^[^\wА-Яа-яёЁ]*📍\s*/, '').trim();
        locRaw = locRaw.replace(/^ауд\.\s*$/i, '').trim();

        if (!locRaw && subject.toLowerCase().includes('физическ')) {
          location = 'Спортивный комплекс';
        } else if (locRaw) {
          const korpMatch = locRaw.match(/кор\.\s*№?\s*(\d+)/i);
          const audMatch = locRaw.match(/ауд\.\s*([0-9a-zA-Zа-яА-ЯёЁ]+)/i);
          if (korpMatch && audMatch) {
            location = `Корпус № ${korpMatch[1]}, ${audMatch[1]}`;
          } else if (korpMatch) {
            location = `Корпус № ${korpMatch[1]}`;
          } else {
            location = locRaw;
          }
        }

        rawLessons.push({
          date: dateFormatted,
          timeStart: currT.tStart,
          timeEnd: currT.tEnd,
          subject,
          type,
          teacher: '',
          location
        });
      }
    }
  }

  // 3. Build 4-Week Schedule Structure
  const createEmptyWeek = (): DaySchedule[] => [
    { dayName: 'Понедельник', lessons: [] },
    { dayName: 'Вторник', lessons: [] },
    { dayName: 'Среда', lessons: [] },
    { dayName: 'Четверг', lessons: [] },
    { dayName: 'Пятница', lessons: [] },
    { dayName: 'Суббота', lessons: [] }
  ];

  const weeks: Record<number, DaySchedule[]> = {
    1: createEmptyWeek(),
    2: createEmptyWeek(),
    3: createEmptyWeek(),
    4: createEmptyWeek()
  };

  const groupId = meta.normalizedGroupId || 'custom-group';
  const shortGroupTag = groupId.replace(/[^a-zA-Z0-9]/g, '');

  const uniqueSubjectsSet = new Set<string>();
  const uniqueTeachersSet = new Set<string>();
  const existingLessonsMap = new Set<string>();

  let earliestDate = '9999-99-99';
  let latestDate = '0000-00-00';

  for (const raw of rawLessons) {
    uniqueSubjectsSet.add(raw.subject);
    if (raw.teacher) uniqueTeachersSet.add(raw.teacher);

    const { weekNumber, dayName, dayCode } = calculateWeekAndDay(raw.date, semesterStart);
    if (dayName === 'Воскресенье') continue;

    const dedupKey = `${weekNumber}_${dayName}_${raw.timeStart}_${raw.subject}`;
    if (existingLessonsMap.has(dedupKey)) {
      continue;
    }
    existingLessonsMap.add(dedupKey);

    const targetWeek = weeks[weekNumber];
    if (!targetWeek) continue;

    const dayObj = targetWeek.find(d => d.dayName === dayName);
    if (!dayObj) continue;

    const lessonIdx = dayObj.lessons.length + 1;
    const lessonItem: Lesson = {
      id: `${shortGroupTag}-w${weekNumber}-${dayCode}-${lessonIdx}`,
      timeStart: raw.timeStart,
      timeEnd: raw.timeEnd,
      subject: raw.subject,
      type: raw.type,
      location: raw.location,
      teacher: raw.teacher,
      note: raw.note
    };

    dayObj.lessons.push(lessonItem);

    const parts = raw.date.split('.');
    if (parts.length === 3) {
      const iso = `${parts[2]}-${parts[1]}-${parts[0]}`;
      if (iso < earliestDate) earliestDate = iso;
      if (iso > latestDate) latestDate = iso;
    }
  }

  // Sort each day's lessons chronologically by timeStart
  for (let w = 1; w <= 4; w++) {
    for (const day of weeks[w]) {
      day.lessons.sort((a, b) => a.timeStart.localeCompare(b.timeStart));
      const dayCode = DAY_CODES[day.dayName] || 'mo';
      day.lessons.forEach((l, idx) => {
        l.id = `${shortGroupTag}-w${w}-${dayCode}-${idx + 1}`;
      });
    }
  }

  // If weeks 3 and 4 are empty (e.g. fortnightly 2-week cycle provided), mirror odd/even weeks:
  const w1Count = weeks[1].reduce((sum, d) => sum + d.lessons.length, 0);
  const w2Count = weeks[2].reduce((sum, d) => sum + d.lessons.length, 0);
  const w3Count = weeks[3].reduce((sum, d) => sum + d.lessons.length, 0);
  const w4Count = weeks[4].reduce((sum, d) => sum + d.lessons.length, 0);

  if (w3Count === 0 && w1Count > 0) {
    weeks[3] = weeks[1].map(d => {
      const dayCode = DAY_CODES[d.dayName] || 'mo';
      return {
        dayName: d.dayName,
        lessons: d.lessons.map((l, idx) => ({
          ...l,
          id: `${shortGroupTag}-w3-${dayCode}-${idx + 1}`
        }))
      };
    });
  }

  if (w4Count === 0 && w2Count > 0) {
    weeks[4] = weeks[2].map(d => {
      const dayCode = DAY_CODES[d.dayName] || 'mo';
      return {
        dayName: d.dayName,
        lessons: d.lessons.map((l, idx) => ({
          ...l,
          id: `${shortGroupTag}-w4-${dayCode}-${idx + 1}`
        }))
      };
    });
  }

  let totalUniqueLessons = 0;
  for (let w = 1; w <= 4; w++) {
    for (const d of weeks[w]) {
      totalUniqueLessons += d.lessons.length;
    }
  }

  return {
    meta,
    rawLessons,
    weeks,
    totalUniqueLessons,
    uniqueSubjects: Array.from(uniqueSubjectsSet),
    uniqueTeachers: Array.from(uniqueTeachersSet),
    dateRange: {
      start: earliestDate === '9999-99-99' ? '' : earliestDate,
      end: latestDate === '0000-00-00' ? '' : latestDate
    }
  };
}

/**
 * Exports parsed schedule result into TypeScript code that can be inserted into constants.ts
 */
export function exportToRegistryCode(result: ParsedScheduleResult, targetGroupId?: string): string {
  const groupId = targetGroupId || result.meta.normalizedGroupId || 'custom-group';
  const lines: string[] = [];

  lines.push(`// Расписание для группы ${result.meta.groupName || groupId}, спарсено из ЛК СамГТУ`);
  if (result.meta.studentName) {
    lines.push(`// Студент: ${result.meta.studentName} (№ зачетки: ${result.meta.recordBookNumber || 'н/д'})`);
  }
  lines.push(`SCHEDULE_REGISTRY['${groupId}'] = {`);

  for (let w = 1; w <= 4; w++) {
    lines.push(`  ${w}: [`);
    const weekDays = result.weeks[w];
    weekDays.forEach((d, dIdx) => {
      lines.push(`    {`);
      lines.push(`      dayName: '${d.dayName}',`);
      lines.push(`      lessons: [`);
      d.lessons.forEach((l, lIdx) => {
        const trailing = lIdx === d.lessons.length - 1 ? '' : ',';
        lines.push(`        { id: '${l.id}', timeStart: '${l.timeStart}', timeEnd: '${l.timeEnd}', subject: ${JSON.stringify(l.subject)}, type: '${l.type}', location: ${JSON.stringify(l.location)}, teacher: ${JSON.stringify(l.teacher)} }${trailing}`);
      });
      lines.push(`      ]`);
      lines.push(`    }${dIdx === weekDays.length - 1 ? '' : ','}`);
    });
    lines.push(`  ]${w === 4 ? '' : ','}`);
  }

  lines.push(`};`);
  return lines.join('\n');
}

export const OFFICIAL_TIME_SLOTS: Record<string, { timeStart: string; timeEnd: string }> = {
  '1': { timeStart: '08:00', timeEnd: '09:35' },
  '2': { timeStart: '09:45', timeEnd: '11:20' },
  '3': { timeStart: '11:50', timeEnd: '13:25' },
  '4': { timeStart: '13:35', timeEnd: '15:10' },
  '5': { timeStart: '15:40', timeEnd: '17:15' },
  '6': { timeStart: '17:25', timeEnd: '19:00' },
  '7': { timeStart: '19:10', timeEnd: '20:45' }
};

export const OFFICIAL_DAY_NAMES = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
export const OFFICIAL_DAY_CODES = ['mo', 'tu', 'we', 'th', 'fr', 'sa'];

export function parseOfficialCell(cellName: string): { subject: string; type: string; location: string } {
  const clean = (cellName || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u00a0\s]+/g, ' ')
    .trim();

  let type = 'Лекции';
  const lower = clean.toLowerCase();
  if (lower.includes('практические')) {
    type = 'Практические занятия';
  } else if (lower.includes('лабораторные')) {
    type = 'Лабораторные работы';
  } else if (lower.includes('лекция') || lower.includes('лекции')) {
    type = 'Лекции';
  }

  let location = '';
  const audMatch = clean.match(/аудитория\s+([^\s]+)(?:\s+корпус\s+№?\s*([^\s,]+))?/i);
  if (audMatch) {
    const aud = audMatch[1].trim();
    const corp = audMatch[2] ? audMatch[2].trim() : '';
    location = corp ? `Корпус № ${corp}, ${aud}` : `ауд. ${aud}`;
  }

  const subject = clean
    .replace(/,\s*(?:практические занятия|лабораторные занятия|лабораторные работы|лекция|лекции)[\s\S]*/i, '')
    .replace(/аудитория[\s\S]*/i, '')
    .trim();

  return { subject: subject || clean, type, location };
}

export function convertOfficialSamgtuToWeekData(
  canonicalId: string,
  rawWeeksData: Record<number, any>,
  knownTeachers: Record<string, string> = {}
): { weekData: WeekData; totalLessons: number } {
  const result: WeekData = { 1: [], 2: [], 3: [], 4: [] };
  let totalLessons = 0;

  for (let weekNum = 1; weekNum <= 4; weekNum++) {
    const weekObj = rawWeeksData[weekNum];
    const weekDays: DaySchedule[] = [];

    for (let dayIdx = 1; dayIdx <= 6; dayIdx++) {
      const dayName = OFFICIAL_DAY_NAMES[dayIdx - 1];
      const dayCode = OFFICIAL_DAY_CODES[dayIdx - 1];
      let offDay = weekObj?.wd?.[String(dayIdx)];

      // Fallback for Monday Week 1 (pre-semester 31 August on portal) from Monday Week 3 (odd week cycle)
      if (weekNum === 1 && dayIdx === 1) {
        const w1HasCells = offDay?.at && Object.values(offDay.at as Record<string, any>).some((s: any) => s.Cells && s.Cells.length > 0);
        const w3Monday = rawWeeksData[3]?.wd?.['1'];
        if (!w1HasCells && w3Monday) {
          offDay = w3Monday;
        }
      }

      const lessons: Lesson[] = [];
      if (offDay && offDay.at) {
        const sortedSlots = Object.entries(offDay.at as Record<string, any>)
          .map(([slotKey, slotData]) => ({ slotKey: Number(slotKey), slotData }))
          .sort((a, b) => a.slotKey - b.slotKey);

        let lessonIdx = 1;
        for (const { slotKey, slotData } of sortedSlots) {
          if (slotData.Cells && Array.isArray(slotData.Cells) && slotData.Cells.length > 0) {
            for (const cell of slotData.Cells) {
              const parsed = parseOfficialCell(cell.CellName || '');
              const times = OFFICIAL_TIME_SLOTS[String(slotKey)] || { timeStart: '08:00', timeEnd: '09:35' };

              let teacher = '';
              for (const [key, val] of Object.entries(knownTeachers)) {
                if (key.toLowerCase() === parsed.subject.toLowerCase()) {
                  teacher = val;
                  break;
                }
              }
              if (!teacher && parsed.subject.toLowerCase().includes('физическ')) {
                teacher = 'Кафедра физического воспитания';
              }

              lessons.push({
                id: `${canonicalId}-w${weekNum}-${dayCode}-${lessonIdx}`,
                timeStart: times.timeStart,
                timeEnd: times.timeEnd,
                subject: parsed.subject,
                type: parsed.type,
                location: parsed.location,
                teacher
              });
              lessonIdx++;
              totalLessons++;
            }
          }
        }
      }

      // LK timetable corrections for 3-ИНГТ-110 (ingt-310):
      if (canonicalId === 'ingt-310') {
        // 1. Tuesday odd weeks (1 & 3): LK has no 8:00 AM class, starts at 9:45
        if ((weekNum === 1 || weekNum === 3) && dayIdx === 2) {
          const idx = lessons.findIndex(l => l.timeStart === '08:00');
          if (idx >= 0) {
            lessons.splice(idx, 1);
            totalLessons--;
          }
        }
        // 2. Monday odd weeks (1 & 3): No "Конструирование", strictly BZhD lab (13:35-15:10, note to 17:15) & lecture (17:25)
        if ((weekNum === 1 || weekNum === 3) && dayIdx === 1) {
          const pe = lessons.find(l => l.timeStart === '11:50');
          lessons.length = 0;
          if (pe) {
            lessons.push(pe);
          } else {
            lessons.push({
              id: `${canonicalId}-w${weekNum}-mo-1`,
              timeStart: '11:50',
              timeEnd: '13:25',
              subject: 'Элективные курсы по физической культуре и спорту',
              type: 'Практические занятия',
              location: 'Спортивный комплекс',
              teacher: 'Кафедра физического воспитания'
            });
          }
          lessons.push({
            id: `${canonicalId}-w${weekNum}-mo-2`,
            timeStart: '13:35',
            timeEnd: '15:10',
            subject: 'Безопасность жизнедеятельности',
            type: 'Лабораторные работы',
            location: 'Корпус № 6, 87',
            teacher: 'Кривова Маргарита Андреевна',
            note: 'пара до 17:15'
          });
          lessons.push({
            id: `${canonicalId}-w${weekNum}-mo-4`,
            timeStart: '17:25',
            timeEnd: '19:00',
            subject: 'Безопасность жизнедеятельности',
            type: 'Лекции',
            location: 'Корпус № 1, 432',
            teacher: 'Сорокина Людмила Владимировна'
          });
        }
      }

      weekDays.push({ dayName, lessons });
    }

    result[weekNum] = weekDays;
  }

  return { weekData: result, totalLessons };
}

