import { SCHEDULE_REGISTRY, AVAILABLE_GROUPS, FACULTIES } from '../constants';
import { 
  getSamaraDate, 
  getSamaraISODate, 
  getSemesterWeek, 
  getDayName,
  getDayCalendarDate,
  getWeekDateRange,
  getDayISODate,
  BLOCKS
} from '../attendance';

console.log("================================================================================");
console.log("            SUBAGENT C: DEEP DATA, TIME & SCALE AUDIT                          ");
console.log("================================================================================\n");

// ============================================================================
// PART 1: CALENDAR & TIME MATH
// ============================================================================
console.log("--------------------------------------------------------------------------------");
console.log("PART 1: CALENDAR & TIME MATH VERIFICATION");
console.log("--------------------------------------------------------------------------------");

// 1.1 Timezone testing: Samara is UTC+4.
// When it is 00:00 to 04:00 in Samara, UTC is 20:00 to 00:00 of the PREVIOUS DAY.
console.log("\n[1.1] Testing Midnight Window (00:00 - 04:00 Samara) across Timezones");

// Let's test instants on 2026-09-01 (Tuesday) from 00:05 to 04:05 Samara time:
// Samara 2026-09-01 00:05:00 = UTC 2026-08-31 20:05:00
// Samara 2026-09-01 02:00:00 = UTC 2026-08-31 22:00:00
// Samara 2026-09-01 03:59:00 = UTC 2026-08-31 23:59:00
// Samara 2026-09-01 04:01:00 = UTC 2026-09-01 00:01:00

const testInstants = [
  { desc: "Samara 00:05:00 (UTC 20:05 prev day)", utcMs: Date.UTC(2026, 7, 31, 20, 5, 0), expectedDate: "2026-09-01", expectedDay: "Вторник" },
  { desc: "Samara 01:30:00 (UTC 21:30 prev day)", utcMs: Date.UTC(2026, 7, 31, 21, 30, 0), expectedDate: "2026-09-01", expectedDay: "Вторник" },
  { desc: "Samara 03:59:00 (UTC 23:59 prev day)", utcMs: Date.UTC(2026, 7, 31, 23, 59, 0), expectedDate: "2026-09-01", expectedDay: "Вторник" },
  { desc: "Samara 04:01:00 (UTC 00:01 same day)", utcMs: Date.UTC(2026, 8, 1, 0, 1, 0), expectedDate: "2026-09-01", expectedDay: "Вторник" },
];

const tzList = [
  { name: 'Samara (UTC+4)', offsetMin: -240 },
  { name: 'Moscow (UTC+3)', offsetMin: -180 },
  { name: 'London (UTC+1 BST)', offsetMin: -60 },
  { name: 'London (UTC+0)', offsetMin: 0 },
  { name: 'New York (UTC-4 EDT)', offsetMin: 240 },
  { name: 'Los Angeles (UTC-7 PDT)', offsetMin: 420 },
  { name: 'Tokyo (UTC+9)', offsetMin: -540 },
];

for (const inst of testInstants) {
  console.log(`\nTest Instant: ${inst.desc}`);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Samara',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const intlIso = formatter.format(new Date(inst.utcMs));
  console.log(`  Intl.DateTimeFormat ('Europe/Samara') -> ${intlIso} [${intlIso === inst.expectedDate ? 'OK' : 'MISMATCH'}]`);

  for (const tz of tzList) {
    const fakeNowTime = inst.utcMs;
    const fakeTzOffset = tz.offsetMin;
    const utcSim = fakeNowTime + (fakeTzOffset * 60000);
    const samaraDateSim = new Date(utcSim + (4 * 3600000));
    
    const samaraTimestamp = inst.utcMs + 4 * 3600000;
    const dUtc = new Date(samaraTimestamp);
    const isoY = dUtc.getUTCFullYear();
    const isoM = String(dUtc.getUTCMonth() + 1).padStart(2, '0');
    const isoD = String(dUtc.getUTCDate()).padStart(2, '0');
    const actualSimDate = `${isoY}-${isoM}-${isoD}`;
    const days = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
    const actualSimDay = days[dUtc.getUTCDay()];

    if (actualSimDate !== inst.expectedDate || actualSimDay !== inst.expectedDay) {
      console.log(`  ⚠️ TZ Anomaly on ${tz.name}: got date=${actualSimDate}, day=${actualSimDay}`);
    }
  }
}

// 1.2 Testing Semester Cycle: weeks 1..18 and 4-week cycle mapping
console.log("\n[1.2] Testing 4-week cycle mapping to weeks 1..18 of the semester");

const SEMESTER_START = new Date(2026, 7, 31); // Mon Aug 31 2026

interface WeekTestEntry {
  calWeek: number;
  startDate: string;
  endDate: string;
  cycle: number;
  expectedCycleWeek: number;
  computedWeek: number;
  uiWeekDateRange: string;
}

const semesterWeeksData: WeekTestEntry[] = [];

for (let w = 0; w < 22; w++) {
  const mon = new Date(SEMESTER_START);
  mon.setDate(SEMESTER_START.getDate() + w * 7);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);

  const monIso = `${mon.getFullYear()}-${String(mon.getMonth()+1).padStart(2,'0')}-${String(mon.getDate()).padStart(2,'0')}`;
  const sunIso = `${sun.getFullYear()}-${String(sun.getMonth()+1).padStart(2,'0')}-${String(sun.getDate()).padStart(2,'0')}`;

  const calWeek = w + 1;
  const cycle = Math.floor(w / 4);
  const expectedCycleWeek = (w % 4) + 1;
  const computedWeek = getSemesterWeek(mon);

  const uiWeekDateRange = getWeekDateRange(computedWeek, mon);

  semesterWeeksData.push({
    calWeek,
    startDate: monIso,
    endDate: sunIso,
    cycle,
    expectedCycleWeek,
    computedWeek,
    uiWeekDateRange
  });
}

console.table(semesterWeeksData.slice(0, 19).map(item => ({
  'Семестр Неделя': item.calWeek,
  'Даты': `${item.startDate} - ${item.endDate}`,
  'Цикл': item.cycle + 1,
  'Номер в цикле (1..4)': item.expectedCycleWeek,
  'getSemesterWeek()': item.computedWeek,
  'getWeekDateRange': item.uiWeekDateRange
})));

// 1.3 Key Boundary Dates Check
console.log("\n[1.3] Key Academic & Boundary Dates Check");

const boundaryCases = [
  { name: '31 августа 2026 (Понедельник до 1 сентября)', date: new Date(2026, 7, 31, 12, 0, 0), check: 'Начало отсчета семестра' },
  { name: '1 сентября 2026 (Вторник, День знаний)', date: new Date(2026, 8, 1, 12, 0, 0), check: 'Официальный старт занятий' },
  { name: 'Переход сентябрь-октябрь (30 сен -> 1 окт)', date: new Date(2026, 8, 30, 12, 0, 0) },
  { name: 'Переход октябрь-ноябрь (31 окт -> 1 ноя)', date: new Date(2026, 9, 31, 12, 0, 0) },
  { name: 'Зачетная неделя (28 дек 2026)', date: new Date(2026, 11, 28, 12, 0, 0), check: 'Неделя 18, 4-й цикл' },
  { name: '31 декабря 2026 (Четверг, конец Блока 4)', date: new Date(2026, 11, 31, 12, 0, 0), check: 'Конец семестра' },
  { name: 'Январская сессия (11 января 2027)', date: new Date(2027, 0, 11, 12, 0, 0), check: 'Сессия' },
  { name: 'Январская сессия (25 января 2027 Татьянин день)', date: new Date(2027, 0, 25, 12, 0, 0), check: 'Сессия' },
  { name: 'Високосный 2028: 29 февраля 2028', date: new Date(2028, 1, 29, 12, 0, 0), check: 'Високосный день' },
];

for (const bc of boundaryCases) {
  const w = getSemesterWeek(bc.date);
  const dayName = getDayName(bc.date);
  const iso = `${bc.date.getFullYear()}-${String(bc.date.getMonth()+1).padStart(2,'0')}-${String(bc.date.getDate()).padStart(2,'0')}`;
  console.log(`- ${bc.name} -> ISO: ${iso}, День: ${dayName}, getSemesterWeek: ${w}`);
}

// 1.4 Check UI week date ranges inconsistency across cycles
console.log("\n[1.4] Inconsistency in UI Week Range Buttons across cycles");
console.log("Suppose today is Calendar Week 5 (2026-09-28, Cycle 2, Week 1).");
const targetDateWeek5 = new Date(2026, 8, 28);
for (let btn = 1; btn <= 4; btn++) {
  const range = getWeekDateRange(btn, targetDateWeek5);
  console.log(`  Button [Неделя ${btn}] -> Range: ${range}`);
}
console.log("Suppose today is Calendar Week 18 (2026-12-28, Cycle 5, Week 2):");
const targetDateWeek18 = new Date(2026, 11, 28);
for (let btn = 1; btn <= 4; btn++) {
  const range = getWeekDateRange(btn, targetDateWeek18);
  console.log(`  Button [Неделя ${btn}] -> Range: ${range}`);
}


// ============================================================================
// PART 2: SCHEDULE_REGISTRY INTEGRITY AUDIT (ALL 42 GROUPS)
// ============================================================================
console.log("\n--------------------------------------------------------------------------------");
console.log("PART 2: SCHEDULE_REGISTRY INTEGRITY AUDIT (42 GROUPS)");
console.log("--------------------------------------------------------------------------------");

const SAMGTU_BELLS = [
  { start: '08:00', end: '09:35', pair: 1 },
  { start: '09:45', end: '11:20', pair: 2 },
  { start: '11:50', end: '13:25', pair: 3 },
  { start: '13:35', end: '15:10', pair: 4 },
  { start: '15:40', end: '17:15', pair: 5 },
  { start: '17:25', end: '19:00', pair: 6 },
  { start: '19:10', end: '20:45', pair: 7 }
];

const VALID_TYPES = new Set([
  'Лекции',
  'Практические занятия',
  'Лабораторные работы',
  'Консультация'
]);

const registryGroupIds = Object.keys(SCHEDULE_REGISTRY);
console.log(`Total groups in AVAILABLE_GROUPS: ${AVAILABLE_GROUPS.length}`);
console.log(`Total groups defined in SCHEDULE_REGISTRY: ${registryGroupIds.length}`);

// Check groups in AVAILABLE_GROUPS missing from SCHEDULE_REGISTRY
const missingFromRegistry = AVAILABLE_GROUPS.filter(g => !SCHEDULE_REGISTRY[g.id]);
console.log(`Groups in AVAILABLE_GROUPS missing schedule: ${missingFromRegistry.length}`);
if (missingFromRegistry.length > 0) {
  console.log(`  Missing: ${missingFromRegistry.map(g => `${g.name} (${g.id})`).join(', ')}`);
}

// Check groups in SCHEDULE_REGISTRY missing from AVAILABLE_GROUPS
const extraInRegistry = registryGroupIds.filter(id => !AVAILABLE_GROUPS.some(g => g.id === id));
console.log(`Groups in SCHEDULE_REGISTRY not in AVAILABLE_GROUPS: ${extraInRegistry.length}`);
if (extraInRegistry.length > 0) {
  console.log(`  Extra: ${extraInRegistry.join(', ')}`);
}

interface LessonAnomaly {
  groupId: string;
  week: number;
  dayName: string;
  lessonId: string;
  issue: string;
  details: string;
}

interface GroupAuditSummary {
  groupId: string;
  groupName: string;
  facultyId: string;
  weeksCount: number;
  totalLessons: number;
  w1MonLessons: number;
  w2MonLessons: number;
  w3MonLessons: number;
  w4MonLessons: number;
  anomaliesCount: number;
}

const allAnomalies: LessonAnomaly[] = [];
const groupSummaries: GroupAuditSummary[] = [];
const globalLessonIdSet = new Map<string, { groupId: string; week: number; dayName: string }>();
const duplicateLessonIds: { id: string; first: any; second: any }[] = [];

for (const grp of AVAILABLE_GROUPS) {
  const sched = SCHEDULE_REGISTRY[grp.id];
  if (!sched) {
    continue;
  }

  let totalLessons = 0;
  let w1MonLessons = 0;
  let w2MonLessons = 0;
  let w3MonLessons = 0;
  let w4MonLessons = 0;
  let groupAnomalies = 0;

  for (let w = 1; w <= 4; w++) {
    const days = sched[w] || [];
    for (const day of days) {
      if (day.dayName === 'Понедельник') {
        if (w === 1) w1MonLessons = day.lessons.length;
        if (w === 2) w2MonLessons = day.lessons.length;
        if (w === 3) w3MonLessons = day.lessons.length;
        if (w === 4) w4MonLessons = day.lessons.length;
      }

      for (let i = 0; i < day.lessons.length; i++) {
        const l1 = day.lessons[i];
        totalLessons++;

        // 1. Check ID
        if (!l1.id || typeof l1.id !== 'string') {
          allAnomalies.push({
            groupId: grp.id, week: w, dayName: day.dayName, lessonId: String(l1.id),
            issue: 'INVALID_ID', details: 'Lesson ID is missing or not a string'
          });
          groupAnomalies++;
        } else {
          if (globalLessonIdSet.has(l1.id)) {
            duplicateLessonIds.push({
              id: l1.id,
              first: globalLessonIdSet.get(l1.id),
              second: { groupId: grp.id, week: w, dayName: day.dayName }
            });
          } else {
            globalLessonIdSet.set(l1.id, { groupId: grp.id, week: w, dayName: day.dayName });
          }
        }

        // 2. Check timeStart and timeEnd
        if (!l1.timeStart || !l1.timeEnd) {
          allAnomalies.push({
            groupId: grp.id, week: w, dayName: day.dayName, lessonId: l1.id,
            issue: 'MISSING_TIME', details: `timeStart="${l1.timeStart}", timeEnd="${l1.timeEnd}"`
          });
          groupAnomalies++;
        } else {
          const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
          if (!timeRegex.test(l1.timeStart) || !timeRegex.test(l1.timeEnd)) {
            allAnomalies.push({
              groupId: grp.id, week: w, dayName: day.dayName, lessonId: l1.id,
              issue: 'MALFORMED_TIME', details: `timeStart="${l1.timeStart}", timeEnd="${l1.timeEnd}"`
            });
            groupAnomalies++;
          }
          if (l1.timeStart >= l1.timeEnd) {
            allAnomalies.push({
              groupId: grp.id, week: w, dayName: day.dayName, lessonId: l1.id,
              issue: 'INVERTED_TIME', details: `${l1.timeStart} >= ${l1.timeEnd}`
            });
            groupAnomalies++;
          }
          const matchesBell = SAMGTU_BELLS.some(b => b.start === l1.timeStart && b.end === l1.timeEnd);
          if (!matchesBell) {
            allAnomalies.push({
              groupId: grp.id, week: w, dayName: day.dayName, lessonId: l1.id,
              issue: 'NON_STANDARD_BELL', details: `${l1.timeStart} - ${l1.timeEnd} does not match any official bell slot`
            });
            groupAnomalies++;
          }
        }

        // 3. Check lesson type
        if (!VALID_TYPES.has(l1.type)) {
          allAnomalies.push({
            groupId: grp.id, week: w, dayName: day.dayName, lessonId: l1.id,
            issue: 'INVALID_TYPE', details: `type="${l1.type}"`
          });
          groupAnomalies++;
        }

        // 4. Check location
        if (!l1.location || l1.location.trim() === '') {
          allAnomalies.push({
            groupId: grp.id, week: w, dayName: day.dayName, lessonId: l1.id,
            issue: 'EMPTY_LOCATION', details: 'Location is empty or blank'
          });
          groupAnomalies++;
        }

        // 5. Check collision with other lessons of same day
        for (let j = i + 1; j < day.lessons.length; j++) {
          const l2 = day.lessons[j];
          if (l1.timeStart === l2.timeStart) {
            allAnomalies.push({
              groupId: grp.id, week: w, dayName: day.dayName, lessonId: `${l1.id} & ${l2.id}`,
              issue: 'TIME_COLLISION', details: `Both lessons start at ${l1.timeStart}: "${l1.subject}" vs "${l2.subject}"`
            });
            groupAnomalies++;
          }
        }
      }
    }
  }

  groupSummaries.push({
    groupId: grp.id,
    groupName: grp.name,
    facultyId: grp.facultyId,
    weeksCount: Object.keys(sched).length,
    totalLessons,
    w1MonLessons,
    w2MonLessons,
    w3MonLessons,
    w4MonLessons,
    anomaliesCount: groupAnomalies
  });
}

console.log(`\nAudit finished. Groups audited: ${groupSummaries.length}`);
console.log(`Total duplicate IDs found across registry: ${duplicateLessonIds.length}`);
if (duplicateLessonIds.length > 0) {
  console.log("Duplicate ID samples:", duplicateLessonIds.slice(0, 5));
}

console.log(`Total anomalies found: ${allAnomalies.length}`);
const anomalyByType: Record<string, number> = {};
for (const a of allAnomalies) {
  anomalyByType[a.issue] = (anomalyByType[a.issue] || 0) + 1;
}
console.log("Anomalies breakdown:", anomalyByType);
if (allAnomalies.length > 0) {
  console.log("Sample anomalies:", allAnomalies.slice(0, 10));
}

// 2.3 Analysis of Monday Week 1 Problem
console.log("\n[2.3] Analysis of Week 1 Monday Problem across All Groups");
const w1MonZero = groupSummaries.filter(g => g.w1MonLessons === 0);
const w1MonNonZero = groupSummaries.filter(g => g.w1MonLessons > 0);
console.log(`Groups with 0 lessons on Week 1 Monday: ${w1MonZero.length} / ${groupSummaries.length}`);
console.log(`Groups with >0 lessons on Week 1 Monday: ${w1MonNonZero.length} / ${groupSummaries.length}`);

if (w1MonNonZero.length > 0) {
  console.log("Groups with lessons on Week 1 Monday:", w1MonNonZero.map(g => `${g.groupName} (${g.w1MonLessons} lessons)`).join(', '));
}

const w1ZeroW3HasLessons = groupSummaries.filter(g => g.w1MonLessons === 0 && g.w3MonLessons > 0);
const w1ZeroW3AlsoZero = groupSummaries.filter(g => g.w1MonLessons === 0 && g.w3MonLessons === 0);
console.log(`Groups where W1 Mon = 0 and W3 Mon > 0 (fallback works on cycle 2+): ${w1ZeroW3HasLessons.length}`);
console.log(`Groups where W1 Mon = 0 and W3 Mon = 0 (still empty on cycle 2+): ${w1ZeroW3AlsoZero.length}`);


// ============================================================================
// PART 3: SCALABILITY BENCHMARK (50 - 100 GROUPS)
// ============================================================================
console.log("\n--------------------------------------------------------------------------------");
console.log("PART 3: SCALABILITY ANALYSIS (50 - 100 GROUPS)");
console.log("--------------------------------------------------------------------------------");

const registryJson = JSON.stringify(SCHEDULE_REGISTRY);
const registryByteSize = Buffer.byteLength(registryJson, 'utf8');
const registryKb = (registryByteSize / 1024).toFixed(2);
const avgBytesPerGroup = registryByteSize / Object.keys(SCHEDULE_REGISTRY).length;

console.log(`Current SCHEDULE_REGISTRY size in JSON: ${registryKb} KB (${registryByteSize} bytes) for ${Object.keys(SCHEDULE_REGISTRY).length} groups`);
console.log(`Average size per group: ${(avgBytesPerGroup / 1024).toFixed(2)} KB`);
console.log(`Projected size for 50 groups: ${((avgBytesPerGroup * 50) / 1024).toFixed(2)} KB`);
console.log(`Projected size for 100 groups: ${((avgBytesPerGroup * 100) / 1024).toFixed(2)} KB`);
console.log(`Projected size for 300 groups (entire university): ${((avgBytesPerGroup * 300) / 1024).toFixed(2)} KB (${((avgBytesPerGroup * 300) / (1024*1024)).toFixed(2)} MB)`);

console.log("\n[3.2] Benchmarking Search & Filtering across group sets");

function benchmarkSearch(groupsList: typeof AVAILABLE_GROUPS, iterations: number = 10000) {
  const query = 'инро';
  const query2 = '110';
  const query3 = 'аса';

  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) {
    const q = i % 3 === 0 ? query : (i % 3 === 1 ? query2 : query3);
    const filtered = groupsList.filter(g => 
      g.name.toLowerCase().includes(q) || 
      g.facultyId.toLowerCase().includes(q) ||
      g.id.toLowerCase().includes(q)
    );
  }
  const t1 = performance.now();
  return (t1 - t0) / iterations;
}

const currentSearchTimeMs = benchmarkSearch(AVAILABLE_GROUPS);
console.log(`Current search time (${AVAILABLE_GROUPS.length} groups): ${(currentSearchTimeMs * 1000).toFixed(2)} microseconds per search`);

const synthetic100 = [...AVAILABLE_GROUPS];
for (let i = AVAILABLE_GROUPS.length; i < 100; i++) {
  synthetic100.push({
    id: `syn-${i}`,
    name: `${(i % 4) + 1}-СИН-${i}`,
    facultyId: AVAILABLE_GROUPS[i % AVAILABLE_GROUPS.length].facultyId,
    degree: 'Бакалавриат',
    course: (i % 4) + 1
  });
}
const time100Ms = benchmarkSearch(synthetic100);
console.log(`Search time for 100 groups: ${(time100Ms * 1000).toFixed(2)} microseconds per search`);

const synthetic500 = [...AVAILABLE_GROUPS];
for (let i = AVAILABLE_GROUPS.length; i < 500; i++) {
  synthetic500.push({
    id: `syn-${i}`,
    name: `${(i % 4) + 1}-СИН-${i}`,
    facultyId: AVAILABLE_GROUPS[i % AVAILABLE_GROUPS.length].facultyId,
    degree: 'Бакалавриат',
    course: (i % 4) + 1
  });
}
const time500Ms = benchmarkSearch(synthetic500);
console.log(`Search time for 500 groups: ${(time500Ms * 1000).toFixed(2)} microseconds per search`);

console.log("\n[3.3] Benchmarking Group Switching (currentSchedule computation)");

function benchmarkGroupSwitch(iterations: number = 2000) {
  const groupIds = Object.keys(SCHEDULE_REGISTRY);
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) {
    const gid = groupIds[i % groupIds.length];
    const selectedWeek = (i % 4) + 1;
    const rawSchedule = SCHEDULE_REGISTRY[gid]?.[selectedWeek] || [];
    
    const processed = rawSchedule.map(day => {
      const isoDate = getDayISODate(day.dayName, selectedWeek);
      if (isoDate === '2026-08-31') return { dayName: day.dayName, lessons: [] };
      let sourceLessons = day.lessons;
      if (day.dayName === 'Понедельник' && sourceLessons.length === 0 && isoDate !== '2026-08-31') {
        const w3Mon = SCHEDULE_REGISTRY[gid]?.[3]?.find(d => d.dayName === 'Понедельник');
        if (w3Mon && w3Mon.lessons.length > 0) {
          sourceLessons = w3Mon.lessons;
        }
      }
      return {
        dayName: day.dayName,
        lessons: sourceLessons.map(l => ({ ...l, resolvedTeacher: l.teacher }))
      };
    });
  }
  const t1 = performance.now();
  return (t1 - t0) / iterations;
}

const switchTimeMs = benchmarkGroupSwitch();
console.log(`Group switch calculation time: ${switchTimeMs.toFixed(4)} ms`);
