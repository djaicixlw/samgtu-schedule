import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import { TIME_SLOTS, DAY_NAMES, DAY_CODES, parseCellName, cleanText } from './sync_official_schedule';
import { WeekData, DaySchedule, Lesson, GroupConfig } from '../types';
import { normalizeSamgtuGroupName, getCanonicalGroupKey } from '../utils/samgtuParser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SCHEDULES_DIR = path.resolve(ROOT_DIR, 'public', 'schedules');
const GROUP_MAP_PATH = path.resolve(ROOT_DIR, 'utils', 'samgtuGroupMap.ts');

export const SAMGTU_FACULTIES = [
  { id: 'ingt', name: 'Институт нефтегазовых технологий', samgtuId: 100105, shortName: 'ИНГТ' },
  { id: 'iait', name: 'Институт автоматики и информационных технологий', samgtuId: 104717, shortName: 'ИАИТ' },
  { id: 'faid', name: 'Факультет архитектуры и дизайна', samgtuId: 112953, shortName: 'ФАИД' },
  { id: 'htf', name: 'Химико-технологический факультет', samgtuId: 100106, shortName: 'ХТФ' },
  { id: 'itf', name: 'Инженерно-технологический факультет', samgtuId: 100108, shortName: 'ИТФ' },
  { id: 'etf', name: 'Электротехнический факультет', samgtuId: 100111, shortName: 'ЭТФ' },
  { id: 'tef', name: 'Теплоэнергетический факультет', samgtuId: 100110, shortName: 'ТЭФ' },
  { id: 'fmmt', name: 'Факультет машиностроения, металлургии и транспорта', samgtuId: 101029, shortName: 'ФММТ' },
  { id: 'iiego', name: 'Институт инженерно-экономического и гуманитарного образования', samgtuId: 112040, shortName: 'ИИЭГО' },
  { id: 'asa', name: 'Факультет промышленного и гражданского строительства (АСА)', samgtuId: 104758, shortName: 'АСА-ПГС' },
  { id: 'asa_stf', name: 'Строительно-технологический факультет (АСА)', samgtuId: 104765, shortName: 'АСА-СТФ' },
  { id: 'fpp', name: 'Высшая биотехнологическая школа', samgtuId: 113574, shortName: 'ВБШ' }
];

export class CircuitBreaker {
  private failureCount = 0;
  private maxFailures: number;
  private cooldownMs: number;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private nextAttempt = 0;

  constructor(maxFailures = 5, cooldownMs = 10000) {
    this.maxFailures = maxFailures;
    this.cooldownMs = cooldownMs;
  }

  public async execute<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    if (this.state === 'OPEN') {
      if (now < this.nextAttempt) {
        throw new Error(`CircuitBreaker is OPEN. Waiting cooldown until ${new Date(this.nextAttempt).toLocaleTimeString()}`);
      }
      this.state = 'HALF_OPEN';
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  private onFailure() {
    this.failureCount++;
    if (this.failureCount >= this.maxFailures) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.cooldownMs;
      console.warn(`[CircuitBreaker] TRIPPED to OPEN state! Consecutive errors: ${this.failureCount}. Cooldown for ${this.cooldownMs}ms`);
    }
  }

  public getState() {
    return this.state;
  }
}

export function fetchJson(url: string, timeoutMs = 8000): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const clean = data.replace(/^\uFEFF/, '').trim();
          if (!clean) {
            resolve(null);
            return;
          }
          const parsed = JSON.parse(clean);
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Invalid JSON from ${url}: ${(e as Error).message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Timeout (${timeoutMs}ms) fetching ${url}`));
    });
  });
}

export interface DiscoveredGroup {
  samgtuId: number | string;
  rawName: string;
  normalizedName: string;
  canonicalId: string;
  course: number;
  facultyId: string;
  degree: 'Бакалавриат' | 'Специалитет' | 'Магистратура';
}

/**
 * Normalizes raw group name from API (e.g. "Группа 24ИНГТ–110") into structured metadata.
 */
export function normalizeDiscoveredGroup(
  rawName: string,
  samgtuId: number | string,
  facultyId: string,
  fallbackCourse: number
): DiscoveredGroup | null {
  const clean = cleanText(rawName).replace(/^Группа\s+/i, '').trim();
  if (!clean) return null;

  const parsed = normalizeSamgtuGroupName(clean);
  const courseMatch = parsed.name ? parsed.name.match(/^(\d+)-/) : null;
  let course = courseMatch ? parseInt(courseMatch[1], 10) : fallbackCourse;

  // Degree detection
  let degree: 'Бакалавриат' | 'Специалитет' | 'Магистратура' = 'Бакалавриат';
  if (clean.endsWith('М') || clean.endsWith('м')) {
    degree = 'Магистратура';
  } else if (course === 5 || /-\d{3}с/i.test(clean)) {
    degree = 'Специалитет';
  }

  const canonicalId = parsed.id && parsed.id !== 'custom-group'
    ? parsed.id
    : getCanonicalGroupKey(clean) || `${facultyId}-${course}${clean.replace(/\D/g, '').slice(-2)}`;

  return {
    samgtuId,
    rawName,
    normalizedName: parsed.name || clean,
    canonicalId,
    course,
    facultyId,
    degree
  };
}

/**
 * Converts raw official SamGTU API 4-week response to clean WeekData.
 */
export function convertOfficialToWeekData(
  canonicalId: string,
  rawWeeksData: Record<number, any>
): { weekData: WeekData; totalLessons: number } {
  const result: WeekData = {
    1: [],
    2: [],
    3: [],
    4: []
  };
  let totalLessons = 0;

  for (let weekNum = 1; weekNum <= 4; weekNum++) {
    const weekObj = rawWeeksData[weekNum];
    const weekDays: DaySchedule[] = [];

    for (let dayIdx = 1; dayIdx <= 6; dayIdx++) {
      const dayName = DAY_NAMES[dayIdx - 1];
      const dayCode = DAY_CODES[dayIdx - 1];
      let offDay = weekObj?.wd?.[String(dayIdx)];

      // Fallback for Monday Week 1 (31 August) from Monday Week 3 (numerator)
      if (weekNum === 1 && dayIdx === 1) {
        const w1HasCells = offDay?.at && Object.values(offDay.at as Record<string, any>).some(s => s.Cells && s.Cells.length > 0);
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
              const parsed = parseCellName(cell.CellName || '');
              const times = TIME_SLOTS[String(slotKey)] || { timeStart: '08:00', timeEnd: '09:35' };

              lessons.push({
                id: `${canonicalId}-w${weekNum}-${dayCode}-${lessonIdx}`,
                timeStart: times.timeStart,
                timeEnd: times.timeEnd,
                subject: parsed.subject,
                type: parsed.type,
                location: parsed.location,
                teacher: '' // Leave empty for runtime/cloud starosta resolution
              });
              lessonIdx++;
              totalLessons++;
            }
          }
        }
      }

      weekDays.push({
        dayName,
        lessons
      });
    }

    result[weekNum] = weekDays;
  }

  return { weekData: result, totalLessons };
}

/**
 * Main Sync Script
 */
export async function runSync(options: {
  facultyFilter?: string;
  courseFilter?: number;
  groupFilter?: string;
  dryRun?: boolean;
  throttleMs?: number;
}) {
  const {
    facultyFilter,
    courseFilter,
    groupFilter,
    dryRun = false,
    throttleMs = 250
  } = options;

  console.log('========================================================================');
  console.log('   SAMGTU UNIVERSITY-WIDE SCHEDULE GENERATOR (sync_schedule_all_groups)  ');
  console.log('========================================================================');
  console.log(`Mode: ${dryRun ? 'DRY-RUN (Inspection only)' : 'PRODUCTION (Saving to public/schedules/*.json)'}`);
  console.log(`Throttle: ${throttleMs}ms | Timeout: 8000ms | Circuit Breaker: ON\n`);

  if (!fs.existsSync(SCHEDULES_DIR)) {
    fs.mkdirSync(SCHEDULES_DIR, { recursive: true });
  }

  const breaker = new CircuitBreaker(5, 10000);
  const targetFaculties = facultyFilter
    ? SAMGTU_FACULTIES.filter(f => f.id === facultyFilter.toLowerCase() || f.shortName.toLowerCase() === facultyFilter.toLowerCase())
    : SAMGTU_FACULTIES;

  if (targetFaculties.length === 0) {
    console.error(`Faculty filter "${facultyFilter}" did not match any known faculties!`);
    console.log('Known faculties:', SAMGTU_FACULTIES.map(f => `${f.id} (${f.shortName})`).join(', '));
    return;
  }

  const targetCourses = courseFilter ? [courseFilter] : [1, 2, 3, 4, 5];
  const discoveredGroups: DiscoveredGroup[] = [];

  console.log(`Phase 1: Discovering official groups across ${targetFaculties.length} faculties and courses [${targetCourses.join(', ')}]...`);

  for (const fac of targetFaculties) {
    for (const crs of targetCourses) {
      const url = `https://samgtu.ru/students/getgrouplist?Faculty=${fac.samgtuId}&Course=${crs}`;
      try {
        const list = await breaker.execute(() => fetchJson(url));
        if (Array.isArray(list) && list.length > 0) {
          for (const item of list) {
            const disc = normalizeDiscoveredGroup(item.Name, item.ID, fac.id, crs);
            if (disc) {
              if (groupFilter) {
                const q = groupFilter.toLowerCase();
                if (!disc.normalizedName.toLowerCase().includes(q) && !disc.canonicalId.toLowerCase().includes(q)) {
                  continue;
                }
              }
              discoveredGroups.push(disc);
            }
          }
        }
      } catch (err) {
        console.warn(`[WARN] Failed to fetch groups for ${fac.shortName} Course ${crs}: ${(err as Error).message}`);
      }
      await new Promise(r => setTimeout(r, throttleMs));
    }
  }

  // Deduplicate discovered groups by canonicalId
  const uniqueGroupsMap = new Map<string, DiscoveredGroup>();
  for (const g of discoveredGroups) {
    if (!uniqueGroupsMap.has(g.canonicalId)) {
      uniqueGroupsMap.set(g.canonicalId, g);
    }
  }
  const uniqueGroups = Array.from(uniqueGroupsMap.values());
  console.log(`\nDiscovered ${uniqueGroups.length} unique academic groups across selected faculties.\n`);

  if (dryRun) {
    console.log('=== DRY-RUN GROUP CATALOG ===');
    uniqueGroups.slice(0, 30).forEach((g, idx) => {
      console.log(` ${idx + 1}. [${g.canonicalId}] ${g.normalizedName} (Course ${g.course}, ${g.degree}, SamGTU ID: ${g.samgtuId})`);
    });
    if (uniqueGroups.length > 30) {
      console.log(` ... and ${uniqueGroups.length - 30} more groups.`);
    }
    console.log('\nDry-run completed successfully without writing files.');
    return;
  }

  // Phase 2: Fetching 4-week schedules and exporting to public/schedules/<canonicalId>.json
  console.log('Phase 2: Synchronizing 4-week schedule cycles for discovered groups...');
  let successCount = 0;
  let emptyCount = 0;
  let errorCount = 0;

  for (let i = 0; i < uniqueGroups.length; i++) {
    const grp = uniqueGroups[i];
    process.stdout.write(`[${i + 1}/${uniqueGroups.length}] Fetching ${grp.normalizedName} (${grp.canonicalId})... `);

    const rawWeeks: Record<number, any> = {};
    let hasFetchError = false;

    for (let w = 1; w <= 4; w++) {
      const scheduleUrl = `https://samgtu.ru/students/getschedule?GroupID=${grp.samgtuId}&WeekNumber=${w}`;
      try {
        rawWeeks[w] = await breaker.execute(() => fetchJson(scheduleUrl));
        await new Promise(r => setTimeout(r, 100));
      } catch (err) {
        hasFetchError = true;
        break;
      }
    }

    if (hasFetchError) {
      console.log('❌ ERROR (Circuit Breaker / Timeout)');
      errorCount++;
      await new Promise(r => setTimeout(r, throttleMs * 2));
      continue;
    }

    const { weekData, totalLessons } = convertOfficialToWeekData(grp.canonicalId, rawWeeks);

    if (totalLessons === 0) {
      console.log('⚠️ 0 pairs (inactive/unassigned)');
      emptyCount++;
    } else {
      const targetJsonPath = path.join(SCHEDULES_DIR, `${grp.canonicalId}.json`);
      fs.writeFileSync(targetJsonPath, JSON.stringify(weekData, null, 2), 'utf8');
      console.log(`✅ OK (${totalLessons} pairs in cycle)`);
      successCount++;
    }

    await new Promise(r => setTimeout(r, throttleMs));
  }

  console.log('\n========================================================================');
  console.log('                    SYNC EXECUTION RESULTS SUMMARY                      ');
  console.log('========================================================================');
  console.log(`Total Groups Discovered:  ${uniqueGroups.length}`);
  console.log(`Successfully Generated:   ${successCount}`);
  console.log(`Empty/No Pairs Found:     ${emptyCount}`);
  console.log(`Fetch Errors / Skipped:   ${errorCount}`);
  console.log(`Circuit Breaker State:    ${breaker.getState()}`);
  console.log('========================================================================\n');
}

// CLI direct run check
if (process.argv[1] && process.argv[1].endsWith('sync_schedule_all_groups.ts')) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const facIdx = args.indexOf('--faculty');
  const facultyFilter = facIdx !== -1 ? args[facIdx + 1] : undefined;
  const crsIdx = args.indexOf('--course');
  const courseFilter = crsIdx !== -1 ? parseInt(args[crsIdx + 1], 10) : undefined;
  const grpIdx = args.indexOf('--group');
  const groupFilter = grpIdx !== -1 ? args[grpIdx + 1] : undefined;

  runSync({
    dryRun,
    facultyFilter,
    courseFilter,
    groupFilter
  }).catch(console.error);
}
