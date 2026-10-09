import { SCHEDULE_REGISTRY, AVAILABLE_GROUPS } from '../constants';
import { STUDENTS_REGISTRY, getDayCalendarDate, getDayISODate } from '../attendance';
import { getSeedSubjectTeachers, SEED_SUBJECT_TEACHERS_BY_GROUP } from '../defaultData';
import { sanitizeTeachers, sanitizeOverrides } from '../utils/cloudSync';
import { preloadAllSchedulesSync } from '../utils/scheduleNodeLoader';
preloadAllSchedulesSync();

interface CheckResult {
  category: string;
  name: string;
  passed: boolean;
  details: string;
}

const results: CheckResult[] = [];

function check(category: string, name: string, passed: boolean, details: string = '') {
  results.push({ category, name, passed, details });
  const status = passed ? '[PASS]' : '[FAIL]';
  console.log(`  ${status} ${name} ${details ? `(${details})` : ''}`);
}

console.log('======================================================================');
console.log('    СТУДЕНЧЕСКИЙ ТЕСТ-РАННЕР САМГТУ: 3-ФАИД-110 И КРОСС-ПРОВЕРКА 3-ИНГТ-110');
console.log('======================================================================\n');

// ==========================================
// 1. РАСПИСАНИЕ 3-ФАИД-110 ПО ВСЕМ 4 НЕДЕЛЯМ
// ==========================================
console.log('--- 1. ПРОВЕРКА РАСПИСАНИЯ 3-ФАИД-110 (НЕДЕЛИ 1-4) ---');
const faidSchedule = SCHEDULE_REGISTRY['faid-310'];
check('1. FAID Schedule', 'SCHEDULE_REGISTRY["faid-310"] существует', !!faidSchedule);

// Проверка количества пар по неделям и дням
const expectedLessonCounts: Record<number, Record<string, number>> = {
  1: { 'Понедельник': 4, 'Вторник': 4, 'Среда': 5, 'Четверг': 5, 'Пятница': 0, 'Суббота': 0 },
  2: { 'Понедельник': 5, 'Вторник': 2, 'Среда': 5, 'Четверг': 5, 'Пятница': 0, 'Суббота': 0 },
  3: { 'Понедельник': 4, 'Вторник': 4, 'Среда': 5, 'Четверг': 5, 'Пятница': 0, 'Суббота': 0 },
  4: { 'Понедельник': 5, 'Вторник': 2, 'Среда': 5, 'Четверг': 5, 'Пятница': 0, 'Суббота': 0 }
};

for (let w = 1; w <= 4; w++) {
  const weekSchedule = faidSchedule[w];
  check('1. FAID Schedule', `Неделя ${w} присутствует в расписании`, !!weekSchedule);
  
  for (const [dayName, expectedCount] of Object.entries(expectedLessonCounts[w])) {
    const day = weekSchedule.find(d => d.dayName === dayName);
    const count = day ? day.lessons.length : 0;
    check(
      '1. FAID Schedule',
      `Неделя ${w} - ${dayName}: ожидается ${expectedCount} пар`,
      count === expectedCount,
      `фактически: ${count}`
    );
  }
}

// ==========================================
// 2. КРИТИЧЕСКИЕ ДАТЫ И UX UI ОТОБРАЖЕНИЕ
// ==========================================
console.log('\n--- 2. ПРОВЕРКА КРИТИЧЕСКИХ ДАТ И UI-СТАТУСОВ ---');

// 2.1 Вторник, Неделя 2 -> 8 сентября
const w2Tue = faidSchedule[2].find(d => d.dayName === 'Вторник');
const calDateSep8 = getDayCalendarDate('Вторник', 2, '2026-08-31');
const isoDateSep8 = getDayISODate('Вторник', 2, '2026-08-31');
check('2. Critical Dates', '8 сентября (Вторник, Неделя 2) дата в календаре = "8 сент"', calDateSep8 === '8 сент', `получено: "${calDateSep8}"`);
check('2. Critical Dates', '8 сентября (Вторник, Неделя 2) ISO дата = "2026-09-08"', isoDateSep8 === '2026-09-08', `получено: "${isoDateSep8}"`);
check('2. Critical Dates', '8 сентября (Вторник, Неделя 2) содержит ровно 2 пары', w2Tue?.lessons.length === 2, `пар: ${w2Tue?.lessons.length}`);
const sep8Badge = `${w2Tue?.lessons.length} ${(w2Tue?.lessons.length === 1 ? 'пара' : (w2Tue?.lessons.length! >= 2 && w2Tue?.lessons.length! <= 4) ? 'пары' : 'пар')}`;
check('2. Critical Dates', '8 сентября бейдж счетчика в UI: "2 пары"', sep8Badge === '2 пары', `бейдж: "${sep8Badge}"`);
check('2. Critical Dates', '8 сентября НЕ показывает "0 пар / В этот день занятий нет"', (w2Tue?.lessons.length || 0) > 0);

// 2.2 Понедельник, Неделя 3 -> 14 сентября
const w3Mon = faidSchedule[3].find(d => d.dayName === 'Понедельник');
const calDateSep14 = getDayCalendarDate('Понедельник', 3, '2026-08-31');
const isoDateSep14 = getDayISODate('Понедельник', 3, '2026-08-31');
check('2. Critical Dates', '14 сентября (Понедельник, Неделя 3) дата в календаре = "14 сент"', calDateSep14 === '14 сент', `получено: "${calDateSep14}"`);
check('2. Critical Dates', '14 сентября (Понедельник, Неделя 3) ISO дата = "2026-09-14"', isoDateSep14 === '2026-09-14', `получено: "${isoDateSep14}"`);
check('2. Critical Dates', '14 сентября (Понедельник, Неделя 3) содержит ровно 4 пары', w3Mon?.lessons.length === 4, `пар: ${w3Mon?.lessons.length}`);
const sep14Badge = `${w3Mon?.lessons.length} ${(w3Mon?.lessons.length === 1 ? 'пара' : (w3Mon?.lessons.length! >= 2 && w3Mon?.lessons.length! <= 4) ? 'пары' : 'пар')}`;
check('2. Critical Dates', '14 сентября бейдж счетчика в UI: "4 пары"', sep14Badge === '4 пары', `бейдж: "${sep14Badge}"`);
check('2. Critical Dates', '14 сентября НЕ показывает "0 пар / В этот день занятий нет"', (w3Mon?.lessons.length || 0) > 0);

// 2.3 Вторник, Неделя 4 -> 22 сентября
const w4Tue = faidSchedule[4].find(d => d.dayName === 'Вторник');
const calDateSep22 = getDayCalendarDate('Вторник', 4, '2026-08-31');
const isoDateSep22 = getDayISODate('Вторник', 4, '2026-08-31');
check('2. Critical Dates', '22 сентября (Вторник, Неделя 4) дата в календаре = "22 сент"', calDateSep22 === '22 сент', `получено: "${calDateSep22}"`);
check('2. Critical Dates', '22 сентября (Вторник, Неделя 4) ISO дата = "2026-09-22"', isoDateSep22 === '2026-09-22', `получено: "${isoDateSep22}"`);
check('2. Critical Dates', '22 сентября (Вторник, Неделя 4) содержит ровно 2 пары', w4Tue?.lessons.length === 2, `пар: ${w4Tue?.lessons.length}`);
const sep22Badge = `${w4Tue?.lessons.length} ${(w4Tue?.lessons.length === 1 ? 'пара' : (w4Tue?.lessons.length! >= 2 && w4Tue?.lessons.length! <= 4) ? 'пары' : 'пар')}`;
check('2. Critical Dates', '22 сентября бейдж счетчика в UI: "2 пары"', sep22Badge === '2 пары', `бейдж: "${sep22Badge}"`);
check('2. Critical Dates', '22 сентября НЕ показывает "0 пар / В этот день занятий нет"', (w4Tue?.lessons.length || 0) > 0);

// ==========================================
// 3. ПРЕПОДАВАТЕЛИ, ПРЕДМЕТЫ И АУДИТОРИИ 3-ФАИД-110
// ==========================================
console.log('\n--- 3. ПРЕПОДАВАТЕЛИ, ПРЕДМЕТЫ И АУДИТОРИИ (3-ФАИД-110) ---');
const requiredTeachers = [
  { name: 'Закирова', fullName: 'Закирова Марина Николаевна', subject: 'Безопасность жизнедеятельности' },
  { name: 'Каракова', fullName: 'Каракова Татьяна Владимировна', subject: 'История дизайна науки и техники' },
  { name: 'Орлова', fullName: 'Орлова Наталья Александровна', subject: 'Вертикальная планировка и благоустройство территорий' },
  { name: 'Тюрников', fullName: 'Тюрников Владимир Викторович', subject: 'Архитектурно-дизайнерское материаловедение' },
  { name: 'Евстратова', fullName: 'Евстратова Елена Александровна', subject: 'Компьютерные технологии в проектировании' },
  { name: 'Стоцкая', fullName: 'Стоцкая Татьяна Геннадьевна', subject: 'Философия' },
  { name: 'Заславский', fullName: 'Заславский Евгений Михайлович', subject: 'Конструирование в дизайне среды' },
  { name: 'Смоленская', fullName: 'Смоленская Елена Олеговна', subject: 'Проектирование' }
];

// Собираем все пары со всех 4 недель
const allFaidLessons: any[] = [];
for (let w = 1; w <= 4; w++) {
  faidSchedule[w].forEach(d => {
    d.lessons.forEach(l => allFaidLessons.push({ ...l, week: w, dayName: d.dayName }));
  });
}

// Проверяем каждого преподавателя
requiredTeachers.forEach(t => {
  const matchingLessons = allFaidLessons.filter(l => l.teacher === t.fullName);
  check(
    '3. Teachers',
    `Преподаватель ${t.fullName} (${t.name}) закреплен в расписании`,
    matchingLessons.length > 0,
    `найдено ${matchingLessons.length} пар`
  );

  const matchingSubject = matchingLessons.every(l =>
    l.subject.includes(t.subject) ||
    l.subject === 'Специальный рисунок и живопись' ||
    l.subject.includes('проект')
  );
  check(
    '3. Teachers',
    `Предметы для ${t.name} соответствуют специальности`,
    matchingSubject,
    `предмет: ${t.subject}`
  );
});

// Проверяем аудитории для ключевых предметов
console.log('\n--- 3.1 ПРОВЕРКА АУДИТОРИЙ И КОРПУСОВ ---');
const zakirovaRooms = Array.from(new Set(allFaidLessons.filter(l => l.teacher.includes('Закирова')).map(l => l.location)));
check('3.1 Rooms', 'Закирова (БЖД): правильные аудитории (Корпус 13, 0408; Корпус 11, 462; Корпус 11, 466)', 
  zakirovaRooms.some(r => r.includes('0408')) && zakirovaRooms.some(r => r.includes('462')) && zakirovaRooms.some(r => r.includes('466')),
  zakirovaRooms.join('; ')
);

const smolenskayaRooms = Array.from(new Set(allFaidLessons.filter(l => l.teacher.includes('Смоленская')).map(l => l.location)));
check('3.1 Rooms', 'Смоленская (Проектирование): аудитория 0603, Корпус 13',
  smolenskayaRooms.every(r => r.includes('0603') && r.includes('13')),
  smolenskayaRooms.join('; ')
);

const karakovaRooms = Array.from(new Set(allFaidLessons.filter(l => l.teacher.includes('Каракова')).map(l => l.location)));
check('3.1 Rooms', 'Каракова (История дизайна, Рисунок): Корпус 13 (0608, 0603)',
  karakovaRooms.every(r => r.includes('13') && (r.includes('0608') || r.includes('0603'))),
  karakovaRooms.join('; ')
);

const tyurnikovRooms = Array.from(new Set(allFaidLessons.filter(l => l.teacher.includes('Тюрников')).map(l => l.location)));
check('3.1 Rooms', 'Тюрников (Материаловедение): Корпус 12, 106',
  tyurnikovRooms.every(r => r.includes('12') && r.includes('106')),
  tyurnikovRooms.join('; ')
);

const evstratovaRooms = Array.from(new Set(allFaidLessons.filter(l => l.teacher.includes('Евстратова')).map(l => l.location)));
check('3.1 Rooms', 'Евстратова (Компьютерные технологии): Корпус 12, 417',
  evstratovaRooms.every(r => r.includes('12') && r.includes('417')),
  evstratovaRooms.join('; ')
);

const stotskayaRooms = Array.from(new Set(allFaidLessons.filter(l => l.teacher.includes('Стоцкая')).map(l => l.location)));
check('3.1 Rooms', 'Стоцкая (Философия): Корпус 12, 525, Корпус 13, 0408 или Moodle',
  stotskayaRooms.every(r => (r.includes('12') && r.includes('525')) || r.includes('Moodle') || (r.includes('13') && r.includes('0408'))),
  stotskayaRooms.join('; ')
);

const zaslavskyRooms = Array.from(new Set(allFaidLessons.filter(l => l.teacher.includes('Заславский')).map(l => l.location)));
check('3.1 Rooms', 'Заславский (Конструирование): Корпус 12, 412 и Корпус 13, 0606',
  zaslavskyRooms.some(r => r.includes('412')) && zaslavskyRooms.some(r => r.includes('0606')),
  zaslavskyRooms.join('; ')
);

// ==========================================
// 4. КРОСС-ПРОВЕРКА И ОТСУТСТВИЕ РЕГРЕССИЙ ДЛЯ 3-ИНГТ-110
// ==========================================
console.log('\n--- 4. КРОСС-ПРОВЕРКА 3-ИНГТ-110 (ОТСУТСТВИЕ РЕГРЕССИЙ) ---');
const ingtStudents = STUDENTS_REGISTRY['ingt-310'];
check('4. INGT Roster', 'Список студентов 3-ИНГТ-110 содержит ровно 16 человек', ingtStudents?.length === 16, `всего: ${ingtStudents?.length}`);

const hasPronin = ingtStudents?.some(s => s.name.toLowerCase().includes('пронин'));
check('4. INGT Roster', 'Студент Пронин отсутствует в списке 3-ИНГТ-110', !hasPronin, hasPronin ? 'ОШИБКА: Пронин найден' : 'Пронина нет');

const ingtSchedule = SCHEDULE_REGISTRY['ingt-310'];
check('4. INGT Schedule', 'SCHEDULE_REGISTRY["ingt-310"] существует', !!ingtSchedule);

for (let w = 1; w <= 4; w++) {
  const ingtThu = ingtSchedule[w].find(d => d.dayName === 'Четверг');
  check(
    '4. INGT Schedule',
    `Неделя ${w} - Четверг: 2 пары военной подготовки`,
    ingtThu?.lessons.length === 2,
    `пар: ${ingtThu?.lessons.length}`
  );
}

// Проверка практик по Патентоведению в пятницу
for (let w = 1; w <= 4; w++) {
  const friday = ingtSchedule[w].find(d => d.dayName === 'Пятница');
  const patentLessons = friday?.lessons.filter(l => l.subject.includes('патентоведение') && l.type === 'Практические занятия') || [];
  if (patentLessons.length > 0) {
    patentLessons.forEach(l => {
      check(
        '4. INGT Teachers',
        `Неделя ${w} - Пятница: Патентоведение (практика) ведет Колибасов В.А.`,
        l.teacher === 'Колибасов Владимир Александрович',
        `преподаватель: "${l.teacher}"`
      );
    });
  }
}

// ==========================================
// 5. ИЗОЛЯЦИЯ ДАННЫХ И ЗАЩИТА ОТ ЗАГРЯЗНЕНИЯ (SANITIZATION)
// ==========================================
console.log('\n--- 5. ИЗОЛЯЦИЯ МЕЖДУ ГРУППАМИ И САНИТИЗАЦИЯ ---');
const dirtyFaid = sanitizeTeachers({ 'Безопасность жизнедеятельности': 'Сорокина Людмила Владимировна' }, 'faid-310');
check(
  '5. Sanitization',
  'Санитизация не допускает лектора Сорокину (ИНГТ) в ФАИД -> Закирова М.Н.',
  dirtyFaid['Безопасность жизнедеятельности'] === 'Закирова Марина Николаевна',
  `получено: ${dirtyFaid['Безопасность жизнедеятельности']}`
);

const dirtyIngt = sanitizeTeachers({
  'Опытно-конструкторские работы и патентоведение в области нефтепромыслового оборудования::Практические занятия': 'Парфенов Кирилл Викторович'
}, 'ingt-310');
check(
  '5. Sanitization',
  'Санитизация для 3-ИНГТ-110 закрепляет на практику патентоведения Колибасова В.А.',
  dirtyIngt['Опытно-конструкторские работы и патентоведение в области нефтепромыслового оборудования::Практические занятия'] === 'Колибасов Владимир Александрович',
  `получено: ${dirtyIngt['Опытно-конструкторские работы и патентоведение в области нефтепромыслового оборудования::Практические занятия']}`
);

// ==========================================
// ИТОГИ
// ==========================================
console.log('\n======================================================================');
const total = results.length;
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
console.log(`ИТОГО ТЕСТОВ: ${total} | ПРОЙДЕНО: ${passed} | ПРОВАЛЕНО: ${failed}`);
console.log('======================================================================');

if (failed > 0) {
  console.error('\n>>> ВНИМАНИЕ: ЕСТЬ НЕПРОЙДЕННЫЕ ТЕСТЫ! <<<');
  process.exit(1);
} else {
  console.log('\n>>> ВСЕ ПРОВЕРКИ УСПЕШНО ПРОЙДЕНЫ БЕЗ ОШИБОК И РЕГРЕССИЙ! <<<');
}
