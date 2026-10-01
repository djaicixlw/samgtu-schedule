import { parseSamgtuSchedule, RawParsedLesson } from '../utils/samgtuParser';

const botText = `
📅Вторник, 01 сентября

1️⃣9:45-11:20
📚Безопасность жизнедеятельности (лекция)
📍ауд. 0408 кор. №13

2️⃣11:50-13:25
📚История дизайна науки и техники (лекция)
📍ауд. 0608 кор. №13

3️⃣13:35-15:10
📚Вертикальная планировка и благоустройство территорий (лекция)
📍ауд. 0408 кор. №13

4️⃣15:40-17:15
✏️Вертикальная планировка и благоустройство территорий (практика)
📍ауд. 0603 кор. №13

_________________________________

📅Среда, 02 сентября

1️⃣8:00-9:35
📚Архитектурно–дизайнерское материаловедение (лекция)
📍ауд. 106 кор. №12

2️⃣9:45-11:20
🔬Архитектурно–дизайнерское материаловедение (лаба)
📍ауд. 106 кор. №12

3️⃣11:50-13:25
✏️Компьютерные технологии в проектировании (практика)
📍ауд. 417 кор. №12

4️⃣13:35-15:10
✏️Компьютерные технологии в проектировании (практика)
📍ауд. 417 кор. №12

5️⃣15:40-17:15
✏️Элективные курсы по физической культуре и спорту (практика)
📍ауд.

_________________________________

📅Четверг, 03 сентября

1️⃣8:00-9:35
✏️Специальный рисунок и живопись (практика)
📍ауд. 0603 кор. №13

2️⃣9:45-11:20
✏️Специальный рисунок и живопись (практика)
📍ауд. 0603 кор. №13

3️⃣11:50-13:25
✏️Проектирование (практика)
📍ауд. 0603 кор. №13

4️⃣13:35-15:10
✏️Проектирование (практика)
📍ауд. 0603 кор. №13

5️⃣15:40-17:15
✏️Философия (практика)
📍ауд. 525 кор. №12

_________________________________
📅Понедельник, 07 сентября

1️⃣8:00-9:35
✏️Проектирование (практика)
📍ауд. 0603 кор. №13

2️⃣9:45-11:20
✏️Проектирование (практика)
📍ауд. 0603 кор. №13

3️⃣11:50-13:25
✏️Безопасность жизнедеятельности (практика)
📍ауд. 462 кор. №11

4️⃣13:35-15:10
📚Конструирование в дизайне среды (лекция)
📍ауд. 412 кор. №12

5️⃣15:40-17:15
✏️Конструирование в дизайне среды (практика)
📍ауд. 0606 кор. №13

_________________________________

📅Среда, 09 сентября

1️⃣8:00-9:35
✏️Элективные курсы по физической культуре и спорту (практика)
📍ауд.

2️⃣9:45-11:20
🔬Архитектурно–дизайнерское материаловедение (лаба)
📍ауд. 106 кор. №12

3️⃣11:50-13:25
📚Вертикальная планировка и благоустройство территорий (лекция)
📍ауд. 0608 кор. №13

4️⃣13:35-15:10
✏️Специальный рисунок и живопись (практика)
📍ауд. 0603 кор. №13

5️⃣15:40-17:15
✏️Специальный рисунок и живопись (практика)
📍ауд. 0603 кор. №13

_________________________________

📅Четверг, 10 сентября

1️⃣9:45-11:20
🔬Безопасность жизнедеятельности (лаба)
📍ауд. 466 кор. №11

2️⃣11:50-13:25
📚История дизайна науки и техники (лекция)
📍ауд. 0608 кор. №13

3️⃣13:35-15:10
✏️Вертикальная планировка и благоустройство территорий (практика)
📍ауд. 0603 кор. №13

4️⃣15:40-17:15
✏️Проектирование (практика)
📍ауд. 0603 кор. №13

5️⃣17:25-19:00
✏️Проектирование (практика)
📍ауд. 0603 кор. №13
`;

export function parseTelegramBotSchedule(text: string, year: number = 2026): RawParsedLesson[] {
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
    'семинар': 'Семинар',
    'консультация': 'Консультация'
  };

  const rawLessons: RawParsedLesson[] = [];

  // Split by day headers: 📅Понедельник, 07 сентября
  const dayHeaderRegex = /📅\s*([А-Яа-яёЁ]+)[,\s]+(\d{1,2})\s+([А-Яа-яёЁ]+)/g;
  const dayIndices: { index: number; dayName: string; day: string; monthName: string }[] = [];
  let m: RegExpExecArray | null;

  while ((m = dayHeaderRegex.exec(text)) !== null) {
    dayIndices.push({
      index: m.index,
      dayName: m[1],
      day: m[2].padStart(2, '0'),
      monthName: m[3].toLowerCase()
    });
  }

  for (let i = 0; i < dayIndices.length; i++) {
    const curr = dayIndices[i];
    const nextIndex = i + 1 < dayIndices.length ? dayIndices[i + 1].index : text.length;
    const dayBlock = text.substring(curr.index, nextIndex);
    const monthNum = MONTHS[curr.monthName] || '09';
    const dateFormatted = `${curr.day}.${monthNum}.${year}`;

    // Regex for lesson items in dayBlock
    // Matches:
    // 1️⃣9:45-11:20
    // 📚Безопасность жизнедеятельности (лекция)
    // 📍ауд. 0408 кор. №13
    // Clean chunking by time:
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

      // Lines in lessonText:
      // Line 1: Subject (type) - e.g. "📚Безопасность жизнедеятельности (лекция)" or "✏️Проектирование (практика)"
      // Line 2: Location - e.g. "📍ауд. 0408 кор. №13"
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

  return rawLessons;
}

const lessons = parseTelegramBotSchedule(botText);
console.log('Parsed bot lessons count:', lessons.length);
const byDay: Record<string, number> = {};
lessons.forEach(l => {
  byDay[l.date] = (byDay[l.date] || 0) + 1;
});
console.log('Lessons by date:', byDay);
console.log('Lessons for 10.09.2026:');
lessons.filter(l => l.date === '10.09.2026').forEach(l => {
  console.log(`  ${l.timeStart}-${l.timeEnd}: ${l.subject} (${l.type}) -> ${l.location}`);
});
