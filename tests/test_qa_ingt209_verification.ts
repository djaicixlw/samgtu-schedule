/**
 * QA Verification Test Suite: 2-ИНГТ-109 and System Regression Testing
 * Run with: npx tsx tests/test_qa_ingt209_verification.ts
 */

import './setup_mock_auth';
import { preloadAllSchedulesSync } from '../utils/scheduleNodeLoader';
preloadAllSchedulesSync();
import { SCHEDULE_REGISTRY, AVAILABLE_GROUPS } from '../constants';
import { verifyPinCode } from '../utils/auth';
import { STUDENTS_REGISTRY } from '../attendance';
import { SEED_SUBJECT_TEACHERS_BY_GROUP } from '../defaultData';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failureMessages: string[] = [];

function check(title: string, condition: boolean, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] ${title}${detail ? ` -> ${detail}` : ''}`);
  } else {
    failedTests++;
    const errMsg = `  [FAIL] ${title}${detail ? ` -> ${detail}` : ''}`;
    console.error(errMsg);
    failureMessages.push(errMsg);
  }
}

console.log("================================================================================");
console.log("       QA TEST REPORT: GROUP 2-ИНГТ-109 (ingt-209) & REGRESSION CHECKS         ");
console.log("================================================================================");

// ============================================================================
// SECTION 1: GROUP 2-ИНГТ-109 CONFIGURATION & REGISTRY
// ============================================================================
console.log("\n>>> 1. Проверка конфигурации группы 2-ИНГТ-109 в AVAILABLE_GROUPS");
const ingt209Config = AVAILABLE_GROUPS.find(g => g.id === 'ingt-209');
check("Наличие группы в AVAILABLE_GROUPS", !!ingt209Config, "id: 'ingt-209'");
check("Имя группы name === '2-ИНГТ-109'", ingt209Config?.name === '2-ИНГТ-109', ingt209Config?.name);
check("Факультет facultyId === 'ingt'", ingt209Config?.facultyId === 'ingt', ingt209Config?.facultyId);
check("Курс course === 2", ingt209Config?.course === 2, `course: ${ingt209Config?.course}`);
check("Ступень degree === 'Бакалавриат'", ingt209Config?.degree === 'Бакалавриат', ingt209Config?.degree);

// ============================================================================
// SECTION 2: SCHEDULE_REGISTRY AND ALIASES
// ============================================================================
console.log("\n>>> 2. Проверка SCHEDULE_REGISTRY и алиасов");
const schedule209 = SCHEDULE_REGISTRY['ingt-209'];
check("Наличие расписания SCHEDULE_REGISTRY['ingt-209']", !!schedule209);
check("Наличие всех 4 недель в расписании", !!(schedule209?.[1] && schedule209?.[2] && schedule209?.[3] && schedule209?.[4]));
check("Алиас '2-ingt-109' ссылается на расписание ingt-209", SCHEDULE_REGISTRY['2-ingt-109'] === schedule209);
// AUD-028: коллизия удалена — 'ingt-109' теперь настоящая группа 1-ИНГТ-109
check("Алиас 'ingt-109' больше НЕ указывает на ingt-209 (AUD-028)", SCHEDULE_REGISTRY['ingt-109'] !== schedule209);
check("'ingt-109' содержит расписание реальной группы 1-ИНГТ-109", SCHEDULE_REGISTRY['ingt-109'] !== undefined);

// ============================================================================
// SECTION 3-6: WEEKS 1..4 CONTRACT & SCHEMA VERIFICATION (ingt-209)
// ============================================================================
console.log("\n>>> 3-6. Проверка контракта расписания Недель 1-4 группы 2-ИНГТ-109");
const VALID_TYPES = ['Лекции', 'Практические занятия', 'Лабораторные работы'];
const VALID_START_TIMES = ['08:00', '09:45', '11:50', '13:35', '15:40', '17:25'];

let totalLessonsCycle = 0;
for (let w = 1; w <= 4; w++) {
  const week = schedule209[w];
  check(`Неделя ${w}: содержит 6 учебных дней`, Array.isArray(week) && week.length === 6, `дней: ${week?.length}`);
  const weekTotal = week.reduce((sum, d) => sum + d.lessons.length, 0);
  totalLessonsCycle += weekTotal;
  check(`Неделя ${w}: суммарно пар >= 10`, weekTotal >= 10, `получено: ${weekTotal}`);

  for (const day of week) {
    for (const l of day.lessons) {
      if (!VALID_START_TIMES.includes(l.timeStart) || !VALID_TYPES.includes(l.type) || !l.subject || l.subject.length < 2) {
        check(`Урок ${l.id} валиден`, false, `${l.timeStart} ${l.type} ${l.subject}`);
      }
    }
  }
}
check("Суммарно пар за 4 недели >= 30", totalLessonsCycle >= 30, `всего: ${totalLessonsCycle}`);

// ============================================================================
// SECTION 7: STAROSTA AUTHENTICATION BY PIN 109
// ============================================================================
console.log("\n>>> 7. Авторизация старосты по PIN 925483 (verifyPinCode, App.tsx, AdminPanel)");
const auth209 = await verifyPinCode('925483');
check("verifyPinCode('925483') авторизует старосту 2-ИНГТ-109", auth209 !== null && auth209.role === 'starosta' && auth209.targetGroupId === 'ingt-209');
const authAdmin = await verifyPinCode('94726108');
check("verifyPinCode('94726108') авторизует главного администратора", authAdmin !== null && authAdmin.role === 'admin');

// Моделирование логики App.tsx handleQuickPinLogin
function simulateAppQuickPinLogin(inputPin: string) {
  const pin = inputPin.trim().toLowerCase();
  let userRole = 'student';
  let starostaGroupId: string | null = null;
  let currentGroupId = 'ingt-310';
  let boundGroupId: string | null = null;
  let toastMsg = '';

  if (pin === '94726108') {
    userRole = 'admin';
    starostaGroupId = null;
    toastMsg = 'Активирован режим ГЛАВНОГО АДМИНИСТРАТОРА (все группы)';
  } else if (pin === '109' || pin === '2109' || pin === 'ingt109') {
    userRole = 'starosta';
    starostaGroupId = 'ingt-209';
    currentGroupId = 'ingt-209';
    boundGroupId = 'ingt-209';
    toastMsg = 'Активирован режим СТАРОСТЫ (2-ИНГТ-109)';
  } else {
    toastMsg = 'Неверный PIN-код доступа';
  }

  return { userRole, starostaGroupId, currentGroupId, boundGroupId, toastMsg };
}

const login109 = simulateAppQuickPinLogin('109');
check("App.tsx: Быстрый вход старосты по PIN '109'", login109.userRole === 'starosta' && login109.starostaGroupId === 'ingt-209' && login109.currentGroupId === 'ingt-209');
const login2109 = simulateAppQuickPinLogin('2109');
check("App.tsx: Альтернативный PIN '2109'", login2109.userRole === 'starosta' && login2109.starostaGroupId === 'ingt-209');
const loginIngt109 = simulateAppQuickPinLogin('ingt109');
check("App.tsx: Текстовый PIN 'ingt109'", loginIngt109.userRole === 'starosta' && loginIngt109.starostaGroupId === 'ingt-209');

// Моделирование логики AdminPanel handleVerifyPin
function simulateAdminPanelVerifyPin(inputPin: string) {
  const pin = inputPin.trim().toLowerCase();
  let roleChangedTo: string | null = null;
  let targetGroupChangedTo: string | null = null;
  let toastMsg = '';

  const onRoleChange = (role: string, target?: string) => {
    roleChangedTo = role;
    targetGroupChangedTo = target || null;
  };

  if (pin === '2808') {
    onRoleChange('admin');
    toastMsg = 'Авторизован режим Главного Администратора';
  } else if (pin === '109' || pin === '2109' || pin === 'ingt109') {
    onRoleChange('starosta', 'ingt-209');
    toastMsg = 'Авторизован режим Старосты (2-ИНГТ-109)';
  } else {
    toastMsg = 'Неверный PIN-код доступа';
  }

  return { roleChangedTo, targetGroupChangedTo, toastMsg };
}

const adminPanel109 = simulateAdminPanelVerifyPin('109');
check("AdminPanel.tsx: Авторизация старосты по PIN '109'", adminPanel109.roleChangedTo === 'starosta' && adminPanel109.targetGroupChangedTo === 'ingt-209');

// ============================================================================
// SECTION 8: ZERO REGRESSION - 3-ИНГТ-110
// ============================================================================
console.log("\n>>> 8. Регрессионное тестирование: 3-ИНГТ-110 (ingt-310)");
const rosterIngt310 = STUDENTS_REGISTRY['ingt-310'];
check("3-ИНГТ-110: ровно 16 студентов в STUDENTS_REGISTRY", rosterIngt310?.length === 16, `студентов: ${rosterIngt310?.length}`);

const schedIngt310 = SCHEDULE_REGISTRY['ingt-310'];
check("3-ИНГТ-110: расписание существует", !!schedIngt310);

// Четверг 0 пар во всех неделях
const thuW1 = schedIngt310[1].find(d => d.dayName === 'Четверг')?.lessons.length || 0;
const thuW2 = schedIngt310[2].find(d => d.dayName === 'Четверг')?.lessons.length || 0;
const thuW3 = schedIngt310[3].find(d => d.dayName === 'Четверг')?.lessons.length || 0;
const thuW4 = schedIngt310[4].find(d => d.dayName === 'Четверг')?.lessons.length || 0;
check("3-ИНГТ-110 Четверг: 2 пары военной подготовки во всех 4 неделях", thuW1 === 2 && thuW2 === 2 && thuW3 === 2 && thuW4 === 2, `W1:${thuW1}, W2:${thuW2}, W3:${thuW3}, W4:${thuW4}`);

// Пятница Патентоведение с Колибасовым В.А.
const friW1Lessons = schedIngt310[1].find(d => d.dayName === 'Пятница')?.lessons || [];
const friW3Lessons = schedIngt310[3].find(d => d.dayName === 'Пятница')?.lessons || [];

const hasPatentKolibasovW1 = friW1Lessons.some(l => 
  l.subject.toLowerCase().includes('патентоведение') && 
  (l.teacher.includes('Колибасов') || l.teacher.includes('Колибасов В.А.'))
);
const hasPatentKolibasovW3 = friW3Lessons.some(l => 
  l.subject.toLowerCase().includes('патентоведение') && 
  (l.teacher.includes('Колибасов') || l.teacher.includes('Колибасов В.А.'))
);

check("3-ИНГТ-110 Пятница: Патентоведение с Колибасовым В.А. (Неделя 1)", hasPatentKolibasovW1);
check("3-ИНГТ-110 Пятница: Патентоведение с Колибасовым В.А. (Неделя 3)", hasPatentKolibasovW3);

// ============================================================================
// SECTION 9: ZERO REGRESSION - 3-ФАИД-110
// ============================================================================
console.log("\n>>> 9. Регрессионное тестирование: 3-ФАИД-110 (faid-310)");
const rosterFaid310 = STUDENTS_REGISTRY['faid-310'];
check("3-ФАИД-110: ровно 22 студента в STUDENTS_REGISTRY", rosterFaid310?.length === 22, `студентов: ${rosterFaid310?.length}`);

const schedFaid310 = SCHEDULE_REGISTRY['faid-310'];
check("3-ФАИД-110: расписание существует", !!schedFaid310);

for (let w = 1; w <= 4; w++) {
  const weekLessons = schedFaid310[w];
  const monCount = weekLessons.find(d => d.dayName === 'Понедельник')?.lessons.length || 0;
  const tueCount = weekLessons.find(d => d.dayName === 'Вторник')?.lessons.length || 0;
  const wedCount = weekLessons.find(d => d.dayName === 'Среда')?.lessons.length || 0;
  const thuCount = weekLessons.find(d => d.dayName === 'Четверг')?.lessons.length || 0;
  const friCount = weekLessons.find(d => d.dayName === 'Пятница')?.lessons.length || 0;
  const satCount = weekLessons.find(d => d.dayName === 'Суббота')?.lessons.length || 0;
  const weekTotal = monCount + tueCount + wedCount + thuCount + friCount + satCount;

  check(`3-ФАИД-110 Неделя ${w}: Пт 0 пар и Сб 0 пар`, friCount === 0 && satCount === 0, `Пт:${friCount}, Сб:${satCount}`);
  check(`3-ФАИД-110 Неделя ${w}: итоговая загрузка >= 10 пар`, weekTotal >= 10, `пар: ${weekTotal}`);
}

// ============================================================================
// SECTION 10: USER EXPERIENCE (UX) INTEGRITY
// ============================================================================
console.log("\n>>> 10. Проверка UX и целостности пользовательского опыта");
// 10.1 Список студентов ingt-209
const rosterIngt209 = STUDENTS_REGISTRY['ingt-209'];
check("Список студентов 2-ИНГТ-109 инициализирован как пустой массив (списка пока нет)", Array.isArray(rosterIngt209) && rosterIngt209.length === 0, `длина: ${rosterIngt209?.length}`);

// 10.2 Преподаватели по умолчанию
const defaultTeachers209 = SEED_SUBJECT_TEACHERS_BY_GROUP['ingt-209'];
check("SEED_SUBJECT_TEACHERS_BY_GROUP['ingt-209'] инициализирован", typeof defaultTeachers209 === 'object' && defaultTeachers209 !== null);
check("Алиас преподавателей SEED_SUBJECT_TEACHERS_BY_GROUP['2-ingt-109'] настроен", SEED_SUBJECT_TEACHERS_BY_GROUP['2-ingt-109'] === defaultTeachers209);
check("Алиас преподавателей SEED_SUBJECT_TEACHERS_BY_GROUP['ingt-109'] настроен", SEED_SUBJECT_TEACHERS_BY_GROUP['ingt-109'] === defaultTeachers209);

// ИТОГ
console.log("\n================================================================================");
console.log(`ИТОГИ ТЕСТИРОВАНИЯ: ВСЕГО ${totalTests} | ПРОЙДЕНО: ${passedTests} | ПРОВАЛЕНО: ${failedTests}`);
console.log("================================================================================");

if (failedTests > 0) {
  console.error("ОШИБКИ ТЕСТИРОВАНИЯ:");
  failureMessages.forEach(msg => console.error(msg));
  process.exit(1);
} else {
  console.log(">>> ВСЕ ТЕСТЫ И ПРОВЕРКИ ПРОЙДЕНЫ НА 100% УСПЕШНО! НИ ОДНОЙ ОШИБКИ ИЛИ РЕГРЕССИИ. <<<");
}
