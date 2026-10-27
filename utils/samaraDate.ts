/**
 * Unified Samara Time (Europe/Samara, UTC+4) and Academic Semester Cycle Module
 * Specification: Appendix F7
 *
 * Eliminates timezoneOffset and client-side DST distortion bugs by relying on
 * Intl.DateTimeFormat (IANA 'Europe/Samara') and pure Date.UTC arithmetic.
 */

export interface SemesterBlock {
  id: number;
  name?: string;
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
}

export interface SemesterConfig {
  semesterStart: string; // YYYY-MM-DD
  cycleWeeks?: number;
  blocks: SemesterBlock[];
}

/**
 * AUD-006: generates a fallback semester config from the current date instead of
 * carrying a hardcoded year. The academic year rolls over on August 1st (Jul -> the
 * still-running previous academic year, Aug -> the new one). Block structure mirrors
 * the released 2026/27 autumn layout shifted by whole years — it is a FALLBACK only;
 * public/semester.json remains the source of truth (see setSemesterConfig).
 */
export function generateDefaultSemesterConfig(now: Date = new Date()): SemesterConfig {
  const samara = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  const y = samara.getUTCFullYear();
  const m = samara.getUTCMonth() + 1; // 1..12
  const academicYear = (m >= 8) ? y : y - 1;
  const delta = academicYear - 2026;

  const shift = (dateStr: string): string => {
    const [yy, mm, dd] = dateStr.split('-').map(Number);
    return `${yy + delta}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  };
  const mkBlock = (id: number, s: string, e: string): SemesterBlock => {
    const ss = shift(s);
    const ee = shift(e);
    const fmt = (iso: string) => { const [, mm2, dd2] = iso.split('-'); return `${dd2}.${mm2}`; };
    return { id, name: `Блок ${id} (${fmt(ss)} - ${fmt(ee)})`, start: ss, end: ee };
  };

  return {
    semesterStart: `${academicYear}-08-31`,
    cycleWeeks: 4,
    blocks: [
      mkBlock(1, '2026-08-31', '2026-09-26'),
      mkBlock(2, '2026-09-28', '2026-10-24'),
      mkBlock(3, '2026-10-26', '2026-11-21'),
      mkBlock(4, '2026-11-23', '2026-12-31')
    ]
  };
}

export const DEFAULT_SEMESTER_CONFIG: SemesterConfig = generateDefaultSemesterConfig();

let activeSemesterConfig: SemesterConfig = DEFAULT_SEMESTER_CONFIG;

/**
 * Loads semester configuration from public/semester.json if available in Node environment,
 * or returns the active / default configuration.
 */
export function loadSemesterConfig(customPath?: string): SemesterConfig {
  try {
    if (typeof process !== 'undefined' && process.versions?.node) {
      const req = (globalThis as any).require || (typeof require !== 'undefined' ? require : null);
      if (req) {
        const fs = req('fs');
        const path = req('path');
        const filePath = customPath || path.resolve(process.cwd(), 'public', 'semester.json');
        if (fs.existsSync(filePath)) {
          const raw = fs.readFileSync(filePath, 'utf8');
          activeSemesterConfig = JSON.parse(raw);
          return activeSemesterConfig;
        }
      }
    }
  } catch {}
  return activeSemesterConfig;
}

/**
 * Sets the active semester configuration in memory.
 */
export function setSemesterConfig(config: SemesterConfig): void {
  activeSemesterConfig = config;
}

/**
 * Returns the currently active semester configuration.
 */
export function getSemesterConfig(): SemesterConfig {
  return activeSemesterConfig;
}

const samaraFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Samara',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

/**
 * Formats a Date into a Samara (Europe/Samara, UTC+4) ISO date string (YYYY-MM-DD).
 * Uses Intl.DateTimeFormat with timeZone: 'Europe/Samara'.
 *
 * Solves the legacy bug where new Date().getTimezoneOffset() was added to UTC ms:
 * since now.getTime() is already UTC, shifting by local offset changes the absolute epoch,
 * causing false day rollovers on non-Samara clients (e.g. New York or Berlin).
 */
export function samaraISO(d: Date | number | string = new Date()): string {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return d;
  }
  const dateObj = d instanceof Date ? d : new Date(d);
  if (isNaN(dateObj.getTime())) return '';

  if ((dateObj as any).__isSamaraWallClock) {
    const y = dateObj.getUTCFullYear();
    const m = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  try {
    return samaraFormatter.format(dateObj);
  } catch {
    // Fallback if Intl fails
    const utc = dateObj.getTime() + (dateObj.getTimezoneOffset() * 60000);
    const samara = new Date(utc + (4 * 3600000));
    const y = samara.getFullYear();
    const m = String(samara.getMonth() + 1).padStart(2, '0');
    const day = String(samara.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}

/**
 * Calculates academic week in 4-week cycle (1..4) using pure Date.UTC integer arithmetic.
 * Ensures zero timezone offset distortion, regardless of client time zone or DST shifts.
 *
 * @param iso Target date string in YYYY-MM-DD format
 * @param startISO Semester start date string in YYYY-MM-DD format (defaults to semester config)
 */
export function cycleWeek(iso: string, startISO?: string): number {
  if (!iso) return 1;
  const config = getSemesterConfig();
  const effectiveStart = startISO || config.semesterStart || generateDefaultSemesterConfig().semesterStart;

  const [y1, m1, d1] = iso.split('-').map(Number);
  const [y0, m0, d0] = effectiveStart.split('-').map(Number);

  const targetUtc = Date.UTC(y1, m1 - 1, d1);
  const startUtc = Date.UTC(y0, m0 - 1, d0);

  const diffTime = targetUtc - startUtc;
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 1;
  const cycleLength = config.cycleWeeks || 4;
  return (Math.floor(diffDays / 7) % cycleLength) + 1;
}

/**
 * Reads semester configuration and returns the current semester week (1..4).
 * If isoDate is omitted, determines today's date in Europe/Samara via samaraISO().
 * Accepts an ISO string ("YYYY-MM-DD") or a Date object.
 */
export function getSemesterWeek(isoDateOrDate?: string | Date, groupId?: string): number {
  let targetISO: string;
  if (!isoDateOrDate) {
    targetISO = samaraISO();
  } else if (typeof isoDateOrDate === 'string') {
    targetISO = /^\d{4}-\d{2}-\d{2}$/.test(isoDateOrDate) ? isoDateOrDate : samaraISO(isoDateOrDate);
  } else if (isoDateOrDate instanceof Date) {
    targetISO = samaraISO(isoDateOrDate);
  } else {
    targetISO = samaraISO();
  }

  const config = getSemesterConfig();
  return cycleWeek(targetISO, config.semesterStart);
}

/**
 * Returns a Date object representing the given instant in Europe/Samara wall-clock time,
 * safely extracted via Intl without getTimezoneOffset skew.
 * Marked with __isSamaraWallClock to prevent double-shifting by downstream utilities.
 */
export function getSamaraDate(d: Date = new Date()): Date {
  let res: Date;
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Samara',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false
    });
    const parts = formatter.formatToParts(d);
    const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value || '0', 10);
    const h = get('hour') === 24 ? 0 : get('hour');
    res = new Date(Date.UTC(get('year'), get('month') - 1, get('day'), h, get('minute'), get('second')));
  } catch {
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    res = new Date(utc + (4 * 3600000));
  }
  (res as any).__isSamaraWallClock = true;
  return res;
}

export const getSamaraISODate = (): string => samaraISO();

export const RU_MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сент', 'окт', 'нояб', 'дек'];

export const DAY_OFFSETS: Record<string, number> = {
  'Понедельник': 0,
  'Вторник': 1,
  'Среда': 2,
  'Четверг': 3,
  'Пятница': 4,
  'Суббота': 5,
  'Воскресенье': 6
};

/**
 * Returns the day of the week in Russian for a given Date or ISO date string in Europe/Samara.
 */
export function getDayName(dateOrISO: Date | string = new Date()): string {
  const days = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
  if (dateOrISO instanceof Date && (dateOrISO as any).__isSamaraWallClock) {
    return days[dateOrISO.getUTCDay()];
  }
  const iso = samaraISO(dateOrISO);
  const [y, m, d] = iso.split('-').map(Number);
  const dayIdx = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return days[dayIdx];
}

function getTargetCycleAndMonday(weekNumber: number, referenceDate?: Date | string) {
  const config = getSemesterConfig();
  const startISO = config.semesterStart || '2026-08-31';
  const targetISO = referenceDate
    ? (typeof referenceDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(referenceDate) ? referenceDate : samaraISO(referenceDate))
    : samaraISO();

  const [y1, m1, d1] = targetISO.split('-').map(Number);
  const [y0, m0, d0] = startISO.split('-').map(Number);

  const targetUtc = Date.UTC(y1, m1 - 1, d1);
  const startUtc = Date.UTC(y0, m0 - 1, d0);

  const diffDays = Math.floor((targetUtc - startUtc) / 86400000);
  const totalWeeks = Math.max(0, Math.floor(diffDays / 7));
  const cycleIndex = Math.floor(totalWeeks / 4);

  const mondayUtc = startUtc + (cycleIndex * 28 + (weekNumber - 1) * 7) * 86400000;
  const mondayDate = new Date(mondayUtc);

  return { mondayDate, mondayUtc, cycleIndex, diffDays, totalWeeks };
}

/**
 * Returns formatted calendar week date range (e.g. "28 сент - 3 окт").
 */
export function getWeekDateRange(weekNumber: number, referenceDate?: Date | string): string {
  const { mondayDate, mondayUtc } = getTargetCycleAndMonday(weekNumber, referenceDate);
  const saturdayDate = new Date(mondayUtc + 5 * 86400000);

  const mDay = mondayDate.getUTCDate();
  const mMonth = RU_MONTHS[mondayDate.getUTCMonth()];
  const sDay = saturdayDate.getUTCDate();
  const sMonth = RU_MONTHS[saturdayDate.getUTCMonth()];

  return `${mDay} ${mMonth} - ${sDay} ${sMonth}`;
}

/**
 * Returns formatted day calendar date (e.g. "28 сент").
 */
export function getDayCalendarDate(dayName: string, weekNumber: number, referenceDate?: Date | string): string {
  const { mondayUtc } = getTargetCycleAndMonday(weekNumber, referenceDate);
  const offset = DAY_OFFSETS[dayName] !== undefined ? DAY_OFFSETS[dayName] : 0;
  const d = new Date(mondayUtc + offset * 86400000);

  return `${d.getUTCDate()} ${RU_MONTHS[d.getUTCMonth()]}`;
}

/**
 * Returns ISO date (YYYY-MM-DD) for a specific day and week.
 */
export function getDayISODate(dayName: string, weekNumber: number, referenceDate?: Date | string): string {
  const { mondayUtc } = getTargetCycleAndMonday(weekNumber, referenceDate);
  const offset = DAY_OFFSETS[dayName] !== undefined ? DAY_OFFSETS[dayName] : 0;
  const d = new Date(mondayUtc + offset * 86400000);

  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Converts a "HH:MM" string into minutes from midnight (0..1439).
 * Returns -1 for invalid or missing input.
 */
export function parseTimeToMinutes(timeStr?: string): number {
  if (!timeStr || typeof timeStr !== 'string' || !timeStr.includes(':')) return -1;
  const [h, m] = timeStr.trim().split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return -1;
  return h * 60 + m;
}

/**
 * Returns current hours and minutes [H, M] in Europe/Samara timezone.
 */
export function getSamaraTimeHM(d: Date = new Date()): [number, number] {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Samara',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const parts = formatter.format(d).split(':');
    return [parseInt(parts[0], 10), parseInt(parts[1], 10)];
  } catch {
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    const samara = new Date(utc + (4 * 3600000));
    return [samara.getHours(), samara.getMinutes()];
  }
}
