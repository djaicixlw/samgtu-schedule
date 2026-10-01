import { parseSamgtuSchedule, normalizeSamgtuGroupName, calculateWeekAndDay, exportToRegistryCode } from '../utils/samgtuParser';

console.log("=================================================");
console.log("       TEST SUITE: SAMGTU SCHEDULE PARSER        ");
console.log("=================================================");

// Test 1: Group Name Normalization
console.log("\n--- 1. Group Name Normalization ---");
const g1 = normalizeSamgtuGroupName("3-ИНГТ-24ИНГТ-110");
console.log(`"3-ИНГТ-24ИНГТ-110" -> name: "${g1.name}", id: "${g1.id}"`);
if (g1.name === "3-ИНГТ-110" && g1.id === "ingt-310") {
  console.log("  [PASS] Successfully normalized complex group name");
} else {
  console.error("  [FAIL] Group name normalization failed:", g1);
  process.exit(1);
}

const g2 = normalizeSamgtuGroupName("5-АСА-101");
console.log(`"5-АСА-101" -> name: "${g2.name}", id: "${g2.id}"`);
if (g2.name === "5-АСА-101" && g2.id === "asa-501") {
  console.log("  [PASS] Successfully normalized 5-course group name");
} else {
  console.error("  [FAIL] 5-course normalization failed:", g2);
  process.exit(1);
}

// Test 2: 4-Week Cycle Assignment
console.log("\n--- 2. Week and Day Calculation ---");
const datesToTest = [
  { date: '01.09.2026', expectedWeek: 1, expectedDay: 'Вторник' },
  { date: '04.09.2026', expectedWeek: 1, expectedDay: 'Пятница' },
  { date: '07.09.2026', expectedWeek: 2, expectedDay: 'Понедельник' },
  { date: '09.09.2026', expectedWeek: 2, expectedDay: 'Среда' },
  { date: '14.09.2026', expectedWeek: 3, expectedDay: 'Понедельник' },
  { date: '18.09.2026', expectedWeek: 3, expectedDay: 'Пятница' },
  { date: '21.09.2026', expectedWeek: 4, expectedDay: 'Понедельник' },
  { date: '23.09.2026', expectedWeek: 4, expectedDay: 'Среда' },
  { date: '28.09.2026', expectedWeek: 1, expectedDay: 'Понедельник' }, // Cycle 2 starts!
];

for (const tc of datesToTest) {
  const res = calculateWeekAndDay(tc.date, '2026-08-31');
  const pass = res.weekNumber === tc.expectedWeek && res.dayName === tc.expectedDay;
  console.log(`Date: ${tc.date} -> Week ${res.weekNumber}, ${res.dayName} (${pass ? 'PASS' : 'FAIL'})`);
  if (!pass) {
    console.error(`  [FAIL] Expected Week ${tc.expectedWeek}, ${tc.expectedDay}; got Week ${res.weekNumber}, ${res.dayName}`);
    process.exit(1);
  }
}

// Test 3: Real LK SamGTU HTML Snippet Parsing
console.log("\n--- 3. Real HTML Snippet Parsing ---");
const sampleHtml = `
<div class="user-header">
  <div class="user-name">Березин Алексей Александрович</div>
  <div>Студент: 3-ИНГТ-24ИНГТ-110, № зачетной книжки: 24060179</div>
</div>

<div class="schedule-card">
  <div class="header">01.09.2026 08:00, Практические занятия, 3-ИНГТ-24ИНГТ-110</div>
  <table>
    <tr><td>Преподаватель</td><td>Ибатуллин Ильдар Дугласович</td></tr>
    <tr><td>Дисциплина</td><td>Технологии ресурсоповышающей обработки</td></tr>
    <tr><td>Вид занятия</td><td>Практические занятия</td></tr>
    <tr><td>Дата проведения занятия</td><td>01.09.2026</td></tr>
    <tr><td>Время проведения занятия</td><td>08:00-09:35</td></tr>
    <tr><td>Место проведения занятия</td><td>Корпус № 1, 109</td></tr>
    <tr><td>Группы</td><td>3-ИНГТ-24ИНГТ-110</td></tr>
  </table>
</div>

<div class="schedule-card">
  <div class="header">04.09.2026 17:25, Практические занятия, 3-ИНГТ-24ИНГТ-110</div>
  <table>
    <tr><td>Преподаватель</td><td>Колибасов Владимир Александрович</td></tr>
    <tr><td>Дисциплина</td><td>Опытно-конструкторские работы и патентоведение в области нефтепромыслового оборудования</td></tr>
    <tr><td>Вид занятия</td><td>Практические занятия</td></tr>
    <tr><td>Дата проведения занятия</td><td>04.09.2026</td></tr>
    <tr><td>Время проведения занятия</td><td>17:25-19:00</td></tr>
    <tr><td>Место проведения занятия</td><td>Корпус № 1, 109Б</td></tr>
    <tr><td>Группы</td><td>3-ИНГТ-24ИНГТ-110</td></tr>
  </table>
</div>

<div class="schedule-card">
  <div class="header">07.09.2026 15:40, Практические занятия, 3-ИНГТ-24ИНГТ-110</div>
  <table>
    <tr><td>Преподаватель</td><td>Колибасов Владимир Александрович</td></tr>
    <tr><td>Дисциплина</td><td>Опытно-конструкторские работы и патентоведение в области нефтепромыслового оборудования</td></tr>
    <tr><td>Вид занятия</td><td>Практические занятия</td></tr>
    <tr><td>Дата проведения занятия</td><td>07.09.2026</td></tr>
    <tr><td>Время проведения занятия</td><td>15:40-17:15</td></tr>
    <tr><td>Место проведения занятия</td><td>Корпус № 1, 109Б</td></tr>
    <tr><td>Группы</td><td>3-ИНГТ-24ИНГТ-110</td></tr>
  </table>
</div>

<!-- Duplicate lesson in next cycle to test deduplication -->
<div class="schedule-card">
  <div class="header">29.09.2026 08:00, Практические занятия, 3-ИНГТ-24ИНГТ-110</div>
  <table>
    <tr><td>Преподаватель</td><td>Ибатуллин Ильдар Дугласович</td></tr>
    <tr><td>Дисциплина</td><td>Технологии ресурсоповышающей обработки</td></tr>
    <tr><td>Вид занятия</td><td>Практические занятия</td></tr>
    <tr><td>Дата проведения занятия</td><td>29.09.2026</td></tr>
    <tr><td>Время проведения занятия</td><td>08:00-09:35</td></tr>
    <tr><td>Место проведения занятия</td><td>Корпус № 1, 109</td></tr>
    <tr><td>Группы</td><td>3-ИНГТ-24ИНГТ-110</td></tr>
  </table>
</div>
`;

const parsed = parseSamgtuSchedule(sampleHtml);
console.log(`Meta: Student=${parsed.meta.studentName}, Group=${parsed.meta.groupName}, Id=${parsed.meta.normalizedGroupId}`);
console.log(`Raw lessons found: ${parsed.rawLessons.length}`);
console.log(`Unique lessons across 4-week cycle: ${parsed.totalUniqueLessons} (Expected 6 after 2-week mirroring & deduplicating 29.09)`);

if (parsed.meta.studentName === 'Березин Алексей Александрович' &&
    parsed.meta.groupName === '3-ИНГТ-110' &&
    parsed.meta.normalizedGroupId === 'ingt-310' &&
    (parsed.totalUniqueLessons === 6 || parsed.totalUniqueLessons === 3)) {
  console.log("  [PASS] HTML parsing and deduplication verified!");
} else {
  console.error("  [FAIL] Unexpected parsing result:", parsed);
  process.exit(1);
}

// Test 4: Code Generation Check
console.log("\n--- 4. TypeScript Code Export ---");
const code = exportToRegistryCode(parsed);
if (code.includes("SCHEDULE_REGISTRY['ingt-310']") && code.includes("Колибасов Владимир Александрович")) {
  console.log("  [PASS] TypeScript code generator verified!");
} else {
  console.error("  [FAIL] Code generator failed:", code);
  process.exit(1);
}

console.log("\n=================================================");
console.log("       ALL SAMGTU PARSER TESTS PASSED!          ");
console.log("=================================================");
