import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import { TIME_SLOTS, DAY_NAMES, DAY_CODES, parseCellName } from './sync_official_schedule';
import { DaySchedule, Lesson, WeekData } from '../types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TARGET_GROUPS = [
  { id: 'ingt-302', name: '3-ИНГТ-102', samgtuId: 31662, prefix: 'ingt302' },
  { id: 'ingt-304', name: '3-ИНГТ-104', samgtuId: 31660, prefix: 'ingt304' },
  { id: 'ingt-305', name: '3-ИНГТ-105', samgtuId: 31653, prefix: 'ingt305' },
  { id: 'ingt-306', name: '3-ИНГТ-106', samgtuId: 31654, prefix: 'ingt306' },
  { id: 'ingt-307', name: '3-ИНГТ-107', samgtuId: 31601, prefix: 'ingt307' },
  { id: 'ingt-308', name: '3-ИНГТ-108', samgtuId: 31646, prefix: 'ingt308' },
  { id: 'ingt-309', name: '3-ИНГТ-109', samgtuId: 31584, prefix: 'ingt309' },
  { id: 'ingt-312', name: '3-ИНГТ-112', samgtuId: 31648, prefix: 'ingt312' },
  { id: 'ingt-313', name: '3-ИНГТ-113', samgtuId: 31765, prefix: 'ingt313' },
  { id: 'ingt-314', name: '3-ИНГТ-114', samgtuId: 31762, prefix: 'ingt314' }
];

function fetchJson(url: string): Promise<any> {
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

async function main() {
  console.log(`Starting official schedule generation for ${TARGET_GROUPS.length} INGT 3rd year groups...`);
  const allGeneratedSchedules: Record<string, WeekData> = {};

  for (const group of TARGET_GROUPS) {
    console.log(`\nFetching ${group.name} (${group.id}, SamGTU ID: ${group.samgtuId})...`);
    const rawWeeksData: Record<number, any> = {};

    for (let w = 1; w <= 4; w++) {
      const url = `https://samgtu.ru/students/getschedule?GroupID=${group.samgtuId}&WeekNumber=${w}`;
      rawWeeksData[w] = await fetchJson(url);
      await new Promise(r => setTimeout(r, 100));
    }

    const groupWeeks: Record<number, DaySchedule[]> = {};
    let totalGroupLessons = 0;

    for (let weekNum = 1; weekNum <= 4; weekNum++) {
      const officialData = rawWeeksData[weekNum];
      const weekDays: DaySchedule[] = [];

      for (let dayIdx = 1; dayIdx <= 6; dayIdx++) {
        const dayName = DAY_NAMES[dayIdx - 1];
        const dayCode = DAY_CODES[dayIdx - 1];
        let offDay = officialData?.wd?.[String(dayIdx)];

        // Fallback for Monday Week 1 (31 August) from Monday Week 3 (numerator)
        if (weekNum === 1 && dayIdx === 1) {
          const w1HasCells = offDay?.at && Object.values(offDay.at as Record<string, any>).some(s => s.Cells && s.Cells.length > 0);
          const w3Monday = rawWeeksData[3]?.wd?.['1'];
          if (!w1HasCells && w3Monday) {
            offDay = w3Monday;
          }
        }

        const offLessons: Lesson[] = [];

        if (offDay && offDay.at) {
          const sortedSlots = Object.entries(offDay.at as Record<string, any>)
            .map(([slotKey, slotData]) => ({ slotKey: Number(slotKey), slotData }))
            .sort((a, b) => a.slotKey - b.slotKey);

          let lessonCounter = 1;
          for (const { slotKey, slotData } of sortedSlots) {
            if (slotData.Cells && slotData.Cells.length > 0) {
              for (const cell of slotData.Cells) {
                const parsed = parseCellName(cell.CellName);
                const times = TIME_SLOTS[String(slotKey)] || { timeStart: '00:00', timeEnd: '00:00' };

                offLessons.push({
                  id: `${group.prefix}-w${weekNum}-${dayCode}-${lessonCounter}`,
                  timeStart: times.timeStart,
                  timeEnd: times.timeEnd,
                  subject: parsed.subject,
                  type: parsed.type,
                  location: parsed.location,
                  teacher: '' // Leave empty for dynamic/group teacher resolution
                });
                lessonCounter++;
                totalGroupLessons++;
              }
            }
          }
        }

        weekDays.push({
          dayName,
          lessons: offLessons
        });
      }

      groupWeeks[weekNum] = weekDays;
    }

    allGeneratedSchedules[group.id] = groupWeeks as unknown as WeekData;
    console.log(`  ✓ ${group.name}: Total ${totalGroupLessons} lessons parsed across 4 weeks.`);
  }

  // Ensure schedules directory exists
  const schedulesDir = path.resolve(__dirname, '../schedules');
  if (!fs.existsSync(schedulesDir)) {
    fs.mkdirSync(schedulesDir, { recursive: true });
  }

  // Write TypeScript file
  const outPath = path.join(schedulesDir, 'ingt3_schedules.ts');
  const codeLines: string[] = [
    `// Automatically generated official 4-week schedules for INGT 3rd year groups`,
    `// Sourced directly from https://samgtu.ru/students/getschedule API`,
    `import { WeekData } from '../types';`,
    ``,
    `export const INGT3_SCHEDULES: Record<string, WeekData> = ${JSON.stringify(allGeneratedSchedules, null, 2)};`,
    ``
  ];

  fs.writeFileSync(outPath, codeLines.join('\n'), 'utf-8');
  console.log(`\n✅ Generated file: ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);
}

main().catch(err => {
  console.error('Error generating INGT 3rd year schedules:', err);
  process.exit(1);
});
