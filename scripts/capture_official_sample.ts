import https from 'https';
import { SAMGTU_GROUP_MAP } from '../utils/samgtuGroupMap';
import { officialWeeksForCycle } from '../utils/officialWeeks';
import { getSemesterConfig, samaraISO } from '../utils/samaraDate';

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const clean = data.replace(/^\uFEFF/, '').trim();
          resolve(JSON.parse(clean));
        } catch (e) {
          reject(new Error(`Failed to parse JSON from ${url}: ${(e as Error).message}\nRaw response: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
  });
}

async function main() {
  const targetGroupArg = (process.argv[2] || 'ingt-310').trim().toLowerCase();
  const groupMeta = SAMGTU_GROUP_MAP[targetGroupArg];

  console.log('================================================================================');
  console.log(`   SAMGTU OFFICIAL SCHEDULE CAPTURE & SCHEMA INSPECTOR`);
  console.log('================================================================================\n');

  if (!groupMeta) {
    console.error(`[ERROR] Group "${targetGroupArg}" not found in SAMGTU_GROUP_MAP.`);
    console.error(`Available groups: ${Object.keys(SAMGTU_GROUP_MAP).join(', ')}`);
    process.exit(1);
  }

  const { name, samgtuName, samgtuGroupId } = groupMeta;
  const todayISO = samaraISO();
  const config = getSemesterConfig();
  const windowWeeks = officialWeeksForCycle(todayISO, config.semesterStart);

  console.log(`Target Group:          ${name} (internal key: ${targetGroupArg})`);
  console.log(`Official SamGTU Name:  ${samgtuName}`);
  console.log(`Official SamGTU ID:    ${samgtuGroupId}`);
  console.log(`Samara Date (Today):   ${todayISO}`);
  console.log(`Semester Start:        ${config.semesterStart}`);
  console.log(`Official Weeks Window: Cycle weeks [1, 2, 3, 4] -> Portal weeks [${windowWeeks[1]}, ${windowWeeks[2]}, ${windowWeeks[3]}, ${windowWeeks[4]}]`);
  console.log('--------------------------------------------------------------------------------\n');

  console.log(`>>> Fetching live schedule from portal for weeks: ${windowWeeks[1]}, ${windowWeeks[2]}, ${windowWeeks[3]}, ${windowWeeks[4]}...\n`);

  const weeksData: Record<number, any> = {};
  for (const cyclePos of [1, 2, 3, 4] as const) {
    const portalWeek = windowWeeks[cyclePos];
    const url = `https://samgtu.ru/students/getschedule?GroupID=${samgtuGroupId}&WeekNumber=${portalWeek}`;
    try {
      const json = await fetchJson(url);
      weeksData[portalWeek] = json;
      let cellCount = 0;
      for (const d of Object.values(json.wd || {}) as any[]) {
        for (const s of Object.values(d.at || {}) as any[]) {
          cellCount += (s.Cells || []).length;
        }
      }
      console.log(`  ✓ Portal Week ${portalWeek} (Cycle Pos ${cyclePos}): HTTP 200 OK | Total Cells: ${cellCount}`);
    } catch (err: any) {
      console.error(`  ✗ Portal Week ${portalWeek} (Cycle Pos ${cyclePos}): Error: ${err.message}`);
    }
  }

  // Schema Inspection from the first non-empty week
  const sampleWeekNumber = Object.keys(weeksData).map(Number).find(w => {
    const json = weeksData[w];
    if (!json?.wd) return false;
    for (const d of Object.values(json.wd) as any[]) {
      for (const s of Object.values(d.at || {}) as any[]) {
        if ((s.Cells || []).length > 0) return true;
      }
    }
    return false;
  }) || windowWeeks[1];

  const sampleJson = weeksData[sampleWeekNumber];

  console.log('\n================================================================================');
  console.log(`   SCHEMA & DATA STRUCTURE ANALYSIS (Sample: Week ${sampleWeekNumber})`);
  console.log('================================================================================\n');

  console.log(`1. Top-level keys: ${JSON.stringify(Object.keys(sampleJson || {}))}`);
  const sampleDays = sampleJson?.wd || {};
  console.log(`2. Days in "wd": ${JSON.stringify(Object.keys(sampleDays))} (keys are '1'..'6' representing Mon..Sat)`);

  const firstDayKey = Object.keys(sampleDays)[0];
  const firstDay = sampleDays[firstDayKey] || {};
  console.log(`3. Day container structure (e.g. Day ${firstDayKey}):`);
  console.log(`   - Name: "${firstDay.Name}"`);
  console.log(`   - "at" time slot keys: ${JSON.stringify(Object.keys(firstDay.at || {}))} (keys '1'..'7' for pair slots)`);

  // Collect sample cells and verify field schema
  let sampleCell: any = null;
  const allCellKeys = new Set<string>();
  const cellsByDay: Record<string, Array<{ dayName: string; timeSlot: string; cell: any }>> = {};

  for (const [dayKey, dayObj] of Object.entries(sampleDays) as any[]) {
    cellsByDay[dayKey] = [];
    for (const [slotKey, slotObj] of Object.entries(dayObj.at || {}) as any[]) {
      for (const c of slotObj.Cells || []) {
        Object.keys(c).forEach(k => allCellKeys.add(k));
        if (!sampleCell) sampleCell = c;
        cellsByDay[dayKey].push({
          dayName: dayObj.Name,
          timeSlot: slotObj.Name,
          cell: c
        });
      }
    }
  }

  console.log(`\n4. Cell Object Schema (Keys present across all cells):`);
  console.log(`   ${JSON.stringify(Array.from(allCellKeys), null, 2)}`);

  console.log(`\n5. Raw Cell Object Example:`);
  console.log(JSON.stringify(sampleCell, null, 2));

  console.log('\n================================================================================');
  console.log(`   SCHEDULE BREAKDOWN BY DAY (Week ${sampleWeekNumber})`);
  console.log('================================================================================\n');

  for (const [dayKey, items] of Object.entries(cellsByDay)) {
    const dayName = items[0]?.dayName || `Day ${dayKey}`;
    console.log(`--- ${dayName} (${items.length} pairs) ---`);
    if (items.length === 0) {
      console.log('    (нет занятий / выходной)');
    } else {
      for (const it of items) {
        console.log(`    [Slot ${it.cell.AuditoriumTimeID} | ${it.timeSlot.replace(/<\/?sup>/g, '')}]`);
        console.log(`      Raw CellName:    ${JSON.stringify(it.cell.CellName)}`);
        console.log(`      WeekTypeName:    ${it.cell.WeekTypeName} (WeekType=${it.cell.WeekType})`);
      }
    }
    console.log('');
  }

  console.log('================================================================================');
  console.log(`   ARCHITECTURAL VERDICT FOR PARSER & ID MIGRATION`);
  console.log('================================================================================');
  console.log(`1. Unique Lesson ID: The portal does NOT provide unique IDs (no "LessonID", "DisciplineID", etc.).`);
  console.log(`2. Coordinate Grid: All lessons are strictly identified by:`);
  console.log(`     - WeekNumber (1..30) / CyclePosition (1..4)`);
  console.log(`     - WeekDay (1..6: 1=Пн, 2=Вт, 3=Ср, 4=Чт, 5=Пт, 6=Сб)`);
  console.log(`     - AuditoriumTimeID (1..7: slot index, e.g. 1="8:00-9:35", 2="9:50-11:25")`);
  console.log(`3. Data Content: Discipline name, lesson type, teacher, and classroom are combined inside`);
  console.log(`   HTML string in "CellName" (e.g. "<b>Физика, лаб. работа</b><br/>ауд. 1-205").`);
  console.log(`4. Multi-lesson collisions: When sub-groups have simultaneous lessons, "Cells" array contains`);
  console.log(`   multiple items in the same AuditoriumTimeID slot.`);
  console.log('================================================================================\n');
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
