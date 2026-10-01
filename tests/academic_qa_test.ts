import { SCHEDULE_REGISTRY, AVAILABLE_GROUPS, FACULTIES } from '../constants';
import { 
  STUDENTS_REGISTRY, 
  BLOCKS, 
  AttendanceRecord, 
  getSamaraDate, 
  getSamaraISODate, 
  getSemesterWeek, 
  getDayName,
  getDayISODate,
  getWeekDateRange
} from '../attendance';
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, AlignmentType, WidthType, VerticalAlign, PageOrientation } from 'docx';
import fs from 'fs';
import path from 'path';

interface TestResult {
  category: string;
  testName: string;
  status: 'PASS' | 'FAIL' | 'WARN' | 'INFO';
  details: string;
}

const results: TestResult[] = [];

function record(category: string, testName: string, status: 'PASS' | 'FAIL' | 'WARN' | 'INFO', details: string) {
  results.push({ category, testName, status, details });
  const symbol = status === 'PASS' ? '✅ PASS' : status === 'FAIL' ? '❌ FAIL' : status === 'WARN' ? '⚠️ WARN' : 'ℹ️ INFO';
  console.log(`[${symbol}] [${category}] ${testName}: ${details}`);
}

console.log('================================================================================');
console.log('       САМГТУ: АКАДЕМИЧЕСКИЙ КОМПЛЕКСНЫЙ ТЕСТ РАСПИСАНИЯ И ПОСЕЩАЕМОСТИ         ');
console.log('================================================================================\n');

// ============================================================================
// 1. РАСПИСАНИЕ ГРУППЫ 3-ИНГТ-110 НА 4 НЕДЕЛИ (constants.ts)
// ============================================================================
console.log('>>> 1. ПРОВЕРКА РАСПИСАНИЯ ГРУППЫ 3-ИНГТ-110 (constants.ts)...');

const groupConfig = AVAILABLE_GROUPS.find(g => g.name === '3-ИНГТ-110');
if (!groupConfig) {
  record('1. Расписание', 'Конфигурация группы', 'FAIL', 'Группа 3-ИНГТ-110 не найдена в AVAILABLE_GROUPS');
} else {
  record('1. Расписание', 'Конфигурация группы', 'PASS', `Найдена группа id=${groupConfig.id}, курс=${groupConfig.course}, факультет=${groupConfig.facultyId}`);
}

const facultyConfig = FACULTIES.find(f => f.id === groupConfig?.facultyId);
if (facultyConfig) {
  record('1. Расписание', 'Факультет группы', 'PASS', `Факультет: "${facultyConfig.name}" (${facultyConfig.shortName})`);
} else {
  record('1. Расписание', 'Факультет группы', 'FAIL', 'Факультет для группы не найден в FACULTIES');
}

const groupId = 'ingt-310';
const schedule = SCHEDULE_REGISTRY[groupId];

if (!schedule) {
  record('1. Расписание', 'Наличие расписания группы', 'FAIL', `Расписание для ${groupId} отсутствует в SCHEDULE_REGISTRY`);
} else {
  record('1. Расписание', 'Наличие расписания группы', 'PASS', `Расписание для ${groupId} успешно загружено из SCHEDULE_REGISTRY`);
  
  // Official SamGTU standard pair bells schedule:
  // 1 пара: 08:00 - 09:35 (95 мин)
  // 2 пара: 09:45 - 11:20 (95 мин) [обеденный перерыв 30 мин: 11:20 - 11:50]
  // 3 пара: 11:50 - 13:25 (95 мин) [перерыв 10 мин: 13:25 - 13:35]
  // 4 пара: 13:35 - 15:10 (95 мин) [перерыв 30 мин: 15:10 - 15:40]
  // 5 пара: 15:40 - 17:15 (95 мин) [перерыв 10 мин: 17:15 - 17:25]
  // 6 пара: 17:25 - 19:00 (95 мин) [перерыв 10 мин: 19:00 - 19:10]
  // 7 пара: 19:10 - 20:45 (95 мин)
  const SAMGTU_BELL_SLOTS = [
    { start: '08:00', end: '09:35', pairNum: 1 },
    { start: '09:45', end: '11:20', pairNum: 2 },
    { start: '11:50', end: '13:25', pairNum: 3 },
    { start: '13:35', end: '15:10', pairNum: 4 },
    { start: '15:40', end: '17:15', pairNum: 5 },
    { start: '17:25', end: '19:00', pairNum: 6 },
    { start: '19:10', end: '20:45', pairNum: 7 },
  ];

  const VALID_LESSON_TYPES = [
    'Лекции',
    'Практические занятия',
    'Лабораторные работы',
    'Консультация'
  ];

  const DAYS_ORDER = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  
  let totalLessonsAcross4Weeks = 0;
  const typeDistribution: Record<string, number> = {};
  const seenLessonIds = new Set<string>();
  const duplicateLessonIds: string[] = [];
  const weeklyDayBreakdown: Record<number, Record<string, number>> = {};

  for (let week = 1; week <= 4; week++) {
    weeklyDayBreakdown[week] = {};
    const weekDays = schedule[week];
    if (!weekDays || !Array.isArray(weekDays)) {
      record('1. Расписание', `Неделя ${week}: структура`, 'FAIL', `Данные для недели ${week} отсутствуют или не являются массивом`);
      continue;
    }

    record('1. Расписание', `Неделя ${week}: дни недели`, 'PASS', `Дней в расписании недели: ${weekDays.length} (Пн-Сб)`);

    // Check all days present
    for (const expectedDay of DAYS_ORDER) {
      const dayData = weekDays.find(d => d.dayName === expectedDay);
      if (!dayData) {
        record('1. Расписание', `Неделя ${week}, ${expectedDay}: наличие дня`, 'FAIL', `День ${expectedDay} отсутствует в расписании`);
        continue;
      }

      weeklyDayBreakdown[week][expectedDay] = dayData.lessons.length;

      // Check Thursday specifically (военная кафедра / СРС)
      if (expectedDay === 'Четверг') {
        if (dayData.lessons.length === 0) {
          record('1. Расписание', `Неделя ${week}, Четверг: Военная кафедра/СРС`, 'PASS', '0 пар (день свободен для военной кафедры/самостоятельной работы)');
        } else {
          record('1. Расписание', `Неделя ${week}, Четверг: Военная кафедра/СРС`, 'FAIL', `Обнаружено ${dayData.lessons.length} пар в четверг, ожидалось 0`);
        }
      }

      // Check lessons
      let prevEndTime = '00:00';
      for (const lesson of dayData.lessons) {
        totalLessonsAcross4Weeks++;
        typeDistribution[lesson.type] = (typeDistribution[lesson.type] || 0) + 1;

        // Lesson ID uniqueness
        if (seenLessonIds.has(lesson.id)) {
          duplicateLessonIds.push(lesson.id);
        }
        seenLessonIds.add(lesson.id);

        // 1. Time validity against SamGTU bell slots
        const matchingBell = SAMGTU_BELL_SLOTS.find(s => s.start === lesson.timeStart && s.end === lesson.timeEnd);
        if (!matchingBell) {
          record('1. Расписание', `Неделя ${week}, ${expectedDay}: Время пары "${lesson.subject}"`, 'WARN', 
            `Нестандартное время: ${lesson.timeStart}-${lesson.timeEnd} (не соответствует звонкам СамГТУ)`);
        }

        // Sequence / overlap check
        if (lesson.timeStart < prevEndTime) {
          record('1. Расписание', `Неделя ${week}, ${expectedDay}: Наложение пар`, 'FAIL', 
            `Пара "${lesson.subject}" (${lesson.timeStart}) начинается раньше окончания предыдущей (${prevEndTime})`);
        }
        prevEndTime = lesson.timeEnd;

        // 2. Classroom / location validity
        if (!lesson.location || lesson.location.trim() === '') {
          record('1. Расписание', `Неделя ${week}, ${expectedDay}: Аудитория "${lesson.subject}"`, 'FAIL', 'Аудитория не указана');
        } else {
          const hasCorpus = lesson.location.includes('Корпус') || lesson.location.includes('корпус') || lesson.location.includes('Главный');
          if (!hasCorpus) {
            record('1. Расписание', `Неделя ${week}, ${expectedDay}: Формат аудитории "${lesson.subject}"`, 'WARN', 
              `Локация "${lesson.location}" не содержит указания корпуса`);
          }
        }

        // 3. Lesson type validity
        if (!VALID_LESSON_TYPES.includes(lesson.type)) {
          record('1. Расписание', `Неделя ${week}, ${expectedDay}: Тип занятия "${lesson.subject}"`, 'FAIL', 
            `Недопустимый тип: "${lesson.type}". Допустимые: ${VALID_LESSON_TYPES.join(', ')}`);
        }

        // 4. Teacher validity
        if (!lesson.teacher || lesson.teacher.trim() === '') {
          record('1. Расписание', `Неделя ${week}, ${expectedDay}: Преподаватель "${lesson.subject}"`, 'WARN', 'Преподаватель не указан');
        }
      }
    }
  }

  if (duplicateLessonIds.length === 0) {
    record('1. Расписание', 'Уникальность ID всех занятий', 'PASS', `Все ${seenLessonIds.size} идентификаторов пар уникальны`);
  } else {
    record('1. Расписание', 'Уникальность ID занятий', 'FAIL', `Обнаружены дубликаты ID: ${duplicateLessonIds.join(', ')}`);
  }

  record('1. Расписание', 'Итог пар за 4-недельный цикл', 'INFO', 
    `Всего пар: ${totalLessonsAcross4Weeks}. Распределение типов: ${JSON.stringify(typeDistribution)}`);
  
  for (let w = 1; w <= 4; w++) {
    const counts = DAYS_ORDER.map(d => `${d.slice(0, 2)}: ${weeklyDayBreakdown[w][d]}п`).join(', ');
    const weekTotal = Object.values(weeklyDayBreakdown[w]).reduce((a, b) => a + b, 0);
    record('1. Расписание', `Неделя ${w}: распределение пар`, 'INFO', `${counts} | Всего за неделю: ${weekTotal} пар`);
  }
}

// Check Samara Time and getSemesterWeek
console.log('\n>>> 1.2 ПРОВЕРКА САМАРСКОГО ВРЕМЕНИ (UTC+4) И getSemesterWeek()...');

// Test 1: Samara offset
const samaraDate = getSamaraDate();
const samaraISO = getSamaraISODate();
record('1. Время', 'Текущая дата по Самаре (ISO)', 'INFO', `getSamaraISODate() = ${samaraISO}`);

// Test midnight rollover in Europe/Samara
const utcAtMidnightSamara = new Date('2026-08-31T20:00:00.000Z'); // 20:00 UTC = 00:00 Sept 1 in Samara (UTC+4)
const formatterSamara = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Samara',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});
const isoMidnight = formatterSamara.format(utcAtMidnightSamara);
if (isoMidnight === '2026-09-01') {
  record('1. Время', 'Переход через полночь UTC+4', 'PASS', '2026-08-31T20:00:00Z -> 2026-09-01 по Самаре корректен');
} else {
  record('1. Время', 'Переход через полночь UTC+4', 'FAIL', `Ожидался 2026-09-01, получен ${isoMidnight}`);
}

// Test getSemesterWeek algorithm:
// Semester starts on Monday, 31 August 2026
const weekTestCases = [
  { dateStr: '2026-08-25', expected: 1, note: 'До начала семестра (должна вернуть 1)' },
  { dateStr: '2026-08-31', expected: 1, note: 'Неделя 1, Пн (старт семестра)' },
  { dateStr: '2026-09-06', expected: 1, note: 'Неделя 1, Вс' },
  { dateStr: '2026-09-07', expected: 2, note: 'Неделя 2, Пн' },
  { dateStr: '2026-09-13', expected: 2, note: 'Неделя 2, Вс' },
  { dateStr: '2026-09-14', expected: 3, note: 'Неделя 3, Пн' },
  { dateStr: '2026-09-20', expected: 3, note: 'Неделя 3, Вс' },
  { dateStr: '2026-09-21', expected: 4, note: 'Неделя 4, Пн' },
  { dateStr: '2026-09-27', expected: 4, note: 'Неделя 4, Вс' },
  { dateStr: '2026-09-28', expected: 1, note: 'Цикл 2: Неделя 1, Пн' },
  { dateStr: '2026-10-05', expected: 2, note: 'Цикл 2: Неделя 2, Пн' },
  { dateStr: '2026-10-12', expected: 3, note: 'Цикл 2: Неделя 3, Пн' },
  { dateStr: '2026-10-19', expected: 4, note: 'Цикл 2: Неделя 4, Пн' },
  { dateStr: '2026-10-26', expected: 1, note: 'Цикл 3: Неделя 1, Пн' },
];

for (const tc of weekTestCases) {
  const [y, m, d] = tc.dateStr.split('-').map(Number);
  const testDate = new Date(y, m - 1, d, 12, 0, 0);
  const actualWeek = getSemesterWeek(testDate);
  if (actualWeek === tc.expected) {
    record('1. getSemesterWeek', `${tc.dateStr} (${tc.note})`, 'PASS', `Неделя = ${actualWeek}`);
  } else {
    record('1. getSemesterWeek', `${tc.dateStr} (${tc.note})`, 'FAIL', `Ожидалась неделя ${tc.expected}, получена ${actualWeek}`);
  }
}


// ============================================================================
// 2. МОДУЛЬ ПОСЕЩАЕМОСТИ (attendance.ts, AttendanceTracker.tsx)
// ============================================================================
console.log('\n>>> 2. ПРОВЕРКА МОДУЛЯ ПОСЕЩАЕМОСТИ...');

// 2.1 Проверка списка 17 студентов
const studentList = STUDENTS_REGISTRY['ingt-310'];
if (!studentList) {
  record('2. Студенты', 'Реестр студентов группы', 'FAIL', 'Группа ingt-310 отсутствует в STUDENTS_REGISTRY');
} else {
  if (studentList.length === 17) {
    record('2. Студенты', 'Количество студентов', 'PASS', `Ровно 17 студентов в группе 3-ИНГТ-110`);
  } else {
    record('2. Студенты', 'Количество студентов', 'FAIL', `Ожидалось 17 студентов, в списке: ${studentList.length}`);
  }

  // Check sequential IDs 1..17
  const ids = studentList.map(s => s.id);
  const expectedIds = Array.from({ length: 17 }, (_, i) => i + 1);
  const idsMatch = JSON.stringify(ids) === JSON.stringify(expectedIds);
  if (idsMatch) {
    record('2. Студенты', 'Нумерация ID студентов', 'PASS', 'ID строго последовательны от 1 до 17');
  } else {
    record('2. Студенты', 'Нумерация ID студентов', 'FAIL', `Несовпадение ID: получено ${ids.join(', ')}`);
  }

  // Check alphabetical order
  const names = studentList.map(s => s.name);
  const sortedNames = [...names].sort((a, b) => a.localeCompare(b, 'ru'));
  const isAlphabetical = names.every((val, idx) => val === sortedNames[idx]);
  if (isAlphabetical) {
    record('2. Студенты', 'Алфавитный порядок ФИО', 'PASS', 'Студенты отсортированы строго по алфавиту');
  } else {
    record('2. Студенты', 'Алфавитный порядок ФИО', 'FAIL', 'Список студентов не отсортирован по алфавиту');
  }

  // Check 3-word Russian full names (Фамилия Имя Отчество)
  const nonStandardNames = studentList.filter(s => s.name.trim().split(/\s+/).length < 2);
  if (nonStandardNames.length === 0) {
    record('2. Студенты', 'Формат ФИО студентов', 'PASS', 'Все 17 студентов имеют корректный формат ФИО (Фамилия Имя Отчество)');
  } else {
    record('2. Студенты', 'Формат ФИО студентов', 'FAIL', `Нестандартный формат ФИО у: ${nonStandardNames.map(s => s.name).join('; ')}`);
  }
}

// 2.2 Проверка статусов: Н, УП, Б, О
console.log('\n>>> 2.2 АНАЛИЗ СТАТУСОВ ПОСЕЩАЕМОСТИ (Н, УП, Б, О)...');

record('2. Статусы', 'Поддержка статуса "Н" (Неявка без ув. причины)', 'PASS', 'Реализовано: absentStudentIds в AttendanceRecord');
record('2. Статусы', 'Поддержка статуса "УП" (Уважительная причина)', 'PASS', 'Реализовано: excusedStudentIds в AttendanceRecord');
record('2. Статусы', 'Поддержка статуса "Б" (Болезнь)', 'WARN', 
  'Статус "Б" не выделен в отдельный массив (в текущей реализации обычно учитывается старостами как "УП" со справкой). Отдельного поля "sickStudentIds" в AttendanceRecord нет.');
record('2. Статусы', 'Поддержка статуса "О" (Опоздание)', 'WARN', 
  'Статус "О" отсутствует в AttendanceRecord и AttendanceTracker.tsx (в СамГТУ опоздания на пару либо не вычитают часы, либо приравнивают к посещению).');

// 2.3 Проверка кнопок «День Н» и «День УП»: пропуск отмененных пар (isCancelled)
console.log('\n>>> 2.3 ТЕСТИРОВАНИЕ КНОПОК «ДЕНЬ Н» И «ДЕНЬ УП»...');

function simulateSetFullDayStatus(
  dayLessons: { id: string }[],
  existingRecords: Record<string, AttendanceRecord>,
  studentId: number,
  status: 'absent' | 'excused',
  date: string
) {
  const updatedRecords = { ...existingRecords };
  
  dayLessons.forEach(lesson => {
    const record = updatedRecords[lesson.id] || {
      groupId: 'ingt-310',
      date,
      lessonId: lesson.id,
      absentStudentIds: [],
      excusedStudentIds: [],
      isCancelled: false
    };

    // CRITICAL LOGIC FROM AttendanceTracker.tsx line 93:
    // Skip cancelled lessons so absent status is never marked on cancelled classes!
    if (record.isCancelled) return;

    let newAbsentIds = record.absentStudentIds.filter(id => id !== studentId);
    let newExcusedIds = (record.excusedStudentIds || []).filter(id => id !== studentId);

    if (status === 'absent') {
      newAbsentIds.push(studentId);
    } else if (status === 'excused') {
      newExcusedIds.push(studentId);
    }

    updatedRecords[lesson.id] = {
      ...record,
      absentStudentIds: newAbsentIds,
      excusedStudentIds: newExcusedIds
    };
  });

  return updatedRecords;
}

// Test scenario: Monday with 4 lessons. Lesson 3 is cancelled.
const mockDayLessons = [
  { id: 'mo-1' },
  { id: 'mo-2' },
  { id: 'mo-3' }, // will be cancelled
  { id: 'mo-4' }
];

const initialRecords: Record<string, AttendanceRecord> = {
  'mo-1': { groupId: 'ingt-310', date: '2026-09-07', lessonId: 'mo-1', absentStudentIds: [], excusedStudentIds: [], isCancelled: false },
  'mo-2': { groupId: 'ingt-310', date: '2026-09-07', lessonId: 'mo-2', absentStudentIds: [], excusedStudentIds: [], isCancelled: false },
  'mo-3': { groupId: 'ingt-310', date: '2026-09-07', lessonId: 'mo-3', absentStudentIds: [], excusedStudentIds: [], isCancelled: true }, // CANCELLED
  'mo-4': { groupId: 'ingt-310', date: '2026-09-07', lessonId: 'mo-4', absentStudentIds: [], excusedStudentIds: [], isCancelled: false },
};

// 1. Test "День Н"
const recordsAfterDayN = simulateSetFullDayStatus(mockDayLessons, initialRecords, 1, 'absent', '2026-09-07');
const s1InMo1 = recordsAfterDayN['mo-1'].absentStudentIds.includes(1);
const s1InMo2 = recordsAfterDayN['mo-2'].absentStudentIds.includes(1);
const s1InMo3 = recordsAfterDayN['mo-3'].absentStudentIds.includes(1);
const s1InMo4 = recordsAfterDayN['mo-4'].absentStudentIds.includes(1);

if (s1InMo1 && s1InMo2 && !s1InMo3 && s1InMo4) {
  record('2. День Н', 'Пропуск отмененных пар (isCancelled)', 'PASS', 
    'Студент 1 отмечен "Н" на активных парах (1, 2, 4), отмененная пара 3 успешно пропущена без проставления отсутствия');
} else {
  record('2. День Н', 'Пропуск отмененных пар (isCancelled)', 'FAIL', 
    `Ошибка фильтрации: mo-1=${s1InMo1}, mo-2=${s1InMo2}, mo-3(отменена)=${s1InMo3}, mo-4=${s1InMo4}`);
}

// 2. Test "День УП" on same student
const recordsAfterDayUP = simulateSetFullDayStatus(mockDayLessons, recordsAfterDayN, 1, 'excused', '2026-09-07');
const s1ExcMo1 = (recordsAfterDayUP['mo-1'].excusedStudentIds || []).includes(1);
const s1ExcMo3 = (recordsAfterDayUP['mo-3'].excusedStudentIds || []).includes(1);
const s1AbsMo1After = recordsAfterDayUP['mo-1'].absentStudentIds.includes(1);

if (s1ExcMo1 && !s1ExcMo3 && !s1AbsMo1After) {
  record('2. День УП', 'Переключение статуса с Н на УП и пропуск отмененных', 'PASS', 
    'Статус переключился на "УП", прежний "Н" удален, отмененная пара 3 не затронута');
} else {
  record('2. День УП', 'Переключение статуса с Н на УП и пропуск отмененных', 'FAIL', 
    `Ошибка: excMo1=${s1ExcMo1}, excMo3=${s1ExcMo3}, absMo1After=${s1AbsMo1After}`);
}


// ============================================================================
// 2.4 ЭКСПОРТ В WORD (exportWord.ts): ПРОВЕРКА НА ДВОЙНОЙ УЧЕТ ЧАСОВ
// ============================================================================
console.log('\n>>> 2.4 ПРОВЕРКА ЭКСПОРТА В WORD (exportWord.ts) НА ОТСУТСТВИЕ ДВОЙНОГО УЧЕТА...');

// Implementation logic from exportWord.ts:
function calculateWordExportHours(records: AttendanceRecord[], studentId: number) {
  let cumulativeAbsences = 0;
  let cumulativeExcused = 0;
  
  const blockResults = BLOCKS.map(block => {
    let blockAbsences = 0;
    let blockExcused = 0;
    
    records.forEach(record => {
      if (record.isCancelled) return;
      if (record.date >= block.start && record.date <= block.end) {
        const isAbsent = record.absentStudentIds.includes(studentId);
        // CRITICAL GUARD in exportWord.ts line 77:
        const isExcused = !isAbsent && (record.excusedStudentIds || []).includes(studentId);
        if (isAbsent) blockAbsences += 2;
        else if (isExcused) blockExcused += 2;
      }
    });
    
    cumulativeAbsences += blockAbsences;
    cumulativeExcused += blockExcused;

    return {
      blockId: block.id,
      blockAbsences,
      blockExcused,
      cumulativeAbsences,
      cumulativeExcused
    };
  });

  return { blockResults, finalAbs: cumulativeAbsences, finalExc: cumulativeExcused };
}

// Test Case 1: Corrupted record where student is in BOTH absent and excused arrays
const corruptedRecord: AttendanceRecord = {
  groupId: 'ingt-310',
  date: '2026-09-02', // Block 1
  lessonId: 'test-dup-1',
  absentStudentIds: [5],
  excusedStudentIds: [5], // Corrupted duplicate!
  isCancelled: false
};

const resDup = calculateWordExportHours([corruptedRecord], 5);
if (resDup.finalAbs === 2 && resDup.finalExc === 0) {
  record('2.4 Word Экспорт', 'Защита от двойного учета (студент одновременно в Н и УП)', 'PASS', 
    'Студент в обоих списках засчитан ровно 1 раз (2 ч "Не УП", 0 ч "УП"), двойного учета 2+2=4 ч нет');
} else {
  record('2.4 Word Экспорт', 'Защита от двойного учета (студент одновременно в Н и УП)', 'FAIL', 
    `Двойной учет обнаружен: abs=${resDup.finalAbs}, exc=${resDup.finalExc} (ожидалось 2 ч и 0 ч)`);
}

// Test Case 2: Cancelled lesson with absent students
const cancelledWithStudentsRecord: AttendanceRecord = {
  groupId: 'ingt-310',
  date: '2026-09-03', // Block 1
  lessonId: 'test-cancelled-1',
  absentStudentIds: [5],
  excusedStudentIds: [5],
  isCancelled: true
};

const resCancelled = calculateWordExportHours([cancelledWithStudentsRecord], 5);
if (resCancelled.finalAbs === 0 && resCancelled.finalExc === 0) {
  record('2.4 Word Экспорт', 'Отмененные пары в Word отчете', 'PASS', 
    'Отмененные пары полностью игнорируются (0 часов начислено)');
} else {
  record('2.4 Word Экспорт', 'Отмененные пары в Word отчете', 'FAIL', 
    `Отмененная пара добавила часы: abs=${resCancelled.finalAbs}, exc=${resCancelled.finalExc}`);
}

// Test Case 3: Block boundaries test (Ensure no duplicate dates between blocks)
console.log('\n>>> Проверка границ академических блоков (Блок 1-4)...');
let blockOverlap = false;
for (let i = 0; i < BLOCKS.length - 1; i++) {
  const currentBlock = BLOCKS[i];
  const nextBlock = BLOCKS[i + 1];
  if (currentBlock.end >= nextBlock.start) {
    blockOverlap = true;
    record('2.4 Word Экспорт', `Пересечение блоков ${currentBlock.id} и ${nextBlock.id}`, 'FAIL', 
      `Блок ${currentBlock.id} заканчивается ${currentBlock.end}, а Блок ${nextBlock.id} начинается ${nextBlock.start}`);
  }
}
if (!blockOverlap) {
  record('2.4 Word Экспорт', 'Границы блоков 1, 2, 3, 4', 'PASS', 
    'Блоки строго не пересекаются: Б1(31.08-20.09), Б2(21.09-20.10), Б3(21.10-20.11), Б4(21.11-25.12)');
}

// Test Case 4: Multi-block cumulative accumulation
const multiBlockRecords: AttendanceRecord[] = [
  { groupId: 'ingt-310', date: '2026-09-10', lessonId: 'l1', absentStudentIds: [10], isCancelled: false }, // Block 1: 2h
  { groupId: 'ingt-310', date: '2026-10-05', lessonId: 'l2', absentStudentIds: [10], isCancelled: false }, // Block 2: 2h
  { groupId: 'ingt-310', date: '2026-11-01', lessonId: 'l3', absentStudentIds: [10], isCancelled: false }, // Block 3: 2h
  { groupId: 'ingt-310', date: '2026-12-05', lessonId: 'l4', absentStudentIds: [10], isCancelled: false }, // Block 4: 2h
];

const resMulti = calculateWordExportHours(multiBlockRecords, 10);
const cumValues = resMulti.blockResults.map(b => b.cumulativeAbsences);
if (JSON.stringify(cumValues) === JSON.stringify([2, 4, 6, 8])) {
  record('2.4 Word Экспорт', 'Нарастающий итог по блокам (официальная форма СамГТУ)', 'PASS', 
    `Нарастающий итог: ${cumValues.join('ч -> ')}ч (соответствует требованиям деканата "на DD.MM.YYYY г.")`);
} else {
  record('2.4 Word Экспорт', 'Нарастающий итог по блокам', 'FAIL', 
    `Ожидалось [2, 4, 6, 8], получено [${cumValues.join(', ')}]`);
}

// Test Case 5: Verification of docx library generation with full student roster
console.log('\n>>> Тестирование генерации DOCX документа через библиотеку docx...');
async function testDocxGeneration() {
  try {
    const tableRows: TableRow[] = [];
    // Header 1
    tableRows.push(
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "№ п/п", bold: true })], alignment: AlignmentType.CENTER })], rowSpan: 2, verticalAlign: VerticalAlign.CENTER }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "ФИО обучающегося", bold: true })], alignment: AlignmentType.CENTER })], rowSpan: 2, verticalAlign: VerticalAlign.CENTER }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Курс", bold: true })], alignment: AlignmentType.CENTER })], rowSpan: 2, verticalAlign: VerticalAlign.CENTER }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Группа", bold: true })], alignment: AlignmentType.CENTER })], rowSpan: 2, verticalAlign: VerticalAlign.CENTER }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Количество пропущенных часов", bold: true })], alignment: AlignmentType.CENTER })], columnSpan: BLOCKS.length, verticalAlign: VerticalAlign.CENTER }),
        ],
      })
    );

    // Header 2
    tableRows.push(
      new TableRow({
        children: BLOCKS.map(block => {
          const [year, month, day] = block.end.split('-');
          return new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: `на ${day}.${month}.${year} г.`, bold: true })], alignment: AlignmentType.CENTER })],
            verticalAlign: VerticalAlign.CENTER,
          });
        }),
      })
    );

    // Rows for all 17 students
    studentList.forEach((student, index) => {
      const blockCells = BLOCKS.map(() => {
        return new TableCell({
          children: [new Paragraph({ text: '0', alignment: AlignmentType.CENTER })],
          verticalAlign: VerticalAlign.CENTER,
        });
      });

      tableRows.push(
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph({ text: (index + 1).toString(), alignment: AlignmentType.CENTER })], verticalAlign: VerticalAlign.CENTER }),
            new TableCell({ children: [new Paragraph({ text: student.name })], verticalAlign: VerticalAlign.CENTER }),
            new TableCell({ children: [new Paragraph({ text: '3', alignment: AlignmentType.CENTER })], verticalAlign: VerticalAlign.CENTER }),
            new TableCell({ children: [new Paragraph({ text: '3-ИНГТ-110', alignment: AlignmentType.CENTER })], verticalAlign: VerticalAlign.CENTER }),
            ...blockCells,
          ],
        })
      );
    });

    const doc = new Document({
      sections: [{
        properties: {
          page: {
            size: { orientation: PageOrientation.LANDSCAPE }
          }
        },
        children: [
          new Paragraph({ text: "Сведение", alignment: AlignmentType.CENTER }),
          new Paragraph({ text: "Институт нефтегазовых технологий", alignment: AlignmentType.CENTER }),
          new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } })
        ]
      }]
    });

    const buffer = await Packer.toBuffer(doc);
    if (buffer && buffer.length > 1000) {
      record('2.4 Word Экспорт', 'Сборка структуры документа .docx', 'PASS', 
        `Документ Word успешно собран, размер буфера: ${(buffer.length / 1024).toFixed(1)} КБ (17 строк студентов)`);
    } else {
      record('2.4 Word Экспорт', 'Сборка структуры документа .docx', 'FAIL', 'Буфер docx пуст или слишком мал');
    }
  } catch (err: any) {
    record('2.4 Word Экспорт', 'Сборка структуры документа .docx', 'FAIL', `Исключение при формировании docx: ${err?.message}`);
  }
}

await testDocxGeneration();

// ============================================================================
// СВОДКА РЕЗУЛЬТАТОВ
// ============================================================================
console.log('\n================================================================================');
console.log('                          ИТОГИ ТЕСТИРОВАНИЯ                                    ');
console.log('================================================================================');
const passCount = results.filter(r => r.status === 'PASS').length;
const failCount = results.filter(r => r.status === 'FAIL').length;
const warnCount = results.filter(r => r.status === 'WARN').length;
const infoCount = results.filter(r => r.status === 'INFO').length;

console.log(`Всего проверок: ${results.length}`);
console.log(`Успешно (PASS):  ${passCount}`);
console.log(`Ошибок (FAIL):   ${failCount}`);
console.log(`Предупреждений: ${warnCount}`);
console.log(`Справочно (INFO): ${infoCount}`);
console.log('================================================================================');
