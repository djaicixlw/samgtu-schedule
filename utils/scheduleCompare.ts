/**
 * Comparison of the app's schedule with the portal's. Pure (no I/O) so it can be tested.
 * Key rule: if the app has NO lessons for the group (schedule not loaded yet), the result is 'no-local-data',
 * never "62 differences": an empty side is a loading problem, not a schedule difference.
 */

interface LessonLike { timeStart: string; subject: string; location?: string }
interface DayLike { dayName: string; lessons?: LessonLike[] }
export type WeekDataLike = Record<number, DayLike[] | undefined>;

export const normSubject = (s: string) => (s || '')
  .replace(/[\u2010-\u2015]/g, '-')
  .replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\s]+/g, ' ')
  .trim()
  .toLowerCase();

export const normLocation = (loc: string) => {
  if (!loc) return '';
  const clean = loc
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\s]+/g, ' ')
    .replace(/№/g, '')
    .replace(/,/g, ' ')
    .replace(/ауд(?:итория)?\.?/g, '')
    .replace(/корпус/g, 'к')
    .replace(/3б/g, '3')
    .trim();
  return clean.split(/\s+/).filter(Boolean).sort().join(' ');
};

export const countLessons = (data: WeekDataLike | null | undefined): number => {
  if (!data) return 0;
  let n = 0;
  for (const w of [1, 2, 3, 4]) for (const d of data[w] || []) n += (d.lessons || []).length;
  return n;
};

export interface CompareResult {
  status: 'no-local-data' | 'match' | 'diff';
  diffs: string[];
  currentTotal: number;
  officialTotal: number;
}

export function compareWithOfficial(current: WeekDataLike | null | undefined, official: WeekDataLike): CompareResult {
  const currentTotal = countLessons(current);
  const officialTotal = countLessons(official);
  if (currentTotal === 0) return { status: 'no-local-data', diffs: [], currentTotal, officialTotal };

  const diffs: string[] = [];
  for (const w of [1, 2, 3, 4]) {
    const curDays = current?.[w] || [];
    const offDays = official[w] || [];
    for (const offDay of offDays) {
      const curLessons = curDays.find(d => d.dayName === offDay.dayName)?.lessons || [];
      for (const offL of offDay.lessons || []) {
        const match = curLessons.find(cl => cl.timeStart === offL.timeStart && normSubject(cl.subject) === normSubject(offL.subject));
        if (!match) {
          diffs.push(`Н${w} ${offDay.dayName} ${offL.timeStart}: в СамГТУ «${offL.subject}», в приложении нет`);
        } else if (offL.location && normLocation(match.location || '') !== normLocation(offL.location)) {
          diffs.push(`Н${w} ${offDay.dayName} ${offL.timeStart} «${offL.subject}»: ауд. ${match.location || '—'} ➔ ${offL.location}`);
        }
      }
      for (const curL of curLessons) {
        const match = (offDay.lessons || []).find(ol => ol.timeStart === curL.timeStart && normSubject(ol.subject) === normSubject(curL.subject));
        if (!match) diffs.push(`Н${w} ${offDay.dayName} ${curL.timeStart}: в приложении «${curL.subject}», в СамГТУ нет`);
      }
    }
  }
  return { status: diffs.length === 0 ? 'match' : 'diff', diffs, currentTotal, officialTotal };
}
