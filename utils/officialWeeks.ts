/**
 * Which weeks of the public portal (samgtu.ru) describe the schedule that is valid NOW.
 *
 * The portal numbers weeks from the start of the semester (1, 2, 3 ...), while the app keeps a 4-week cycle.
 * Weeks 1-4 are the draft of the first month (the portal itself is incomplete there); the schedule people actually
 * follow is the one for the current week and the next three. Both the in-app check/apply and the nightly sync must
 * look at that window, otherwise they "find" differences that do not exist (or apply stale data).
 */

const DAY_MS = 86_400_000;
/** The Worker proxy refuses week numbers above this. */
export const OFFICIAL_MAX_WEEK = 30;

const dayNumber = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / DAY_MS);
};

/** Official week number (1-based) that contains `todayISO`; before the semester starts it is 1. */
export function currentOfficialWeek(todayISO: string, semesterStartISO: string): number {
  const diffDays = dayNumber(todayISO) - dayNumber(semesterStartISO);
  return Math.max(1, Math.floor(diffDays / 7) + 1);
}

/** Position (1..4) of an official week inside the app's 4-week cycle. */
export const cycleOf = (officialWeek: number): 1 | 2 | 3 | 4 => (((officialWeek - 1) % 4) + 1) as 1 | 2 | 3 | 4;

/** For every cycle position the nearest official week at or after the current one: always inside [current, current+3]. */
export function officialWeeksForCycle(todayISO: string, semesterStartISO: string): Record<1 | 2 | 3 | 4, number> {
  const cur = currentOfficialWeek(todayISO, semesterStartISO);
  const out = {} as Record<1 | 2 | 3 | 4, number>;
  for (const c of [1, 2, 3, 4] as const) out[c] = cur + ((c - cycleOf(cur) + 4) % 4);
  return out;
}

/** Weeks to try for one cycle position: the target, then the same position one and two cycles earlier. */
export function weekFallbackChain(target: number): number[] {
  return [target, target - 4, target - 8].filter(w => w >= 1 && w <= OFFICIAL_MAX_WEEK);
}

/** True when a portal week really contains lessons (an unpublished future week comes back empty). */
export function officialWeekHasLessons(raw: any): boolean {
  const wd = raw && raw.wd;
  if (!wd || typeof wd !== 'object') return false;
  return Object.values(wd).some((day: any) =>
    day && day.at && Object.values(day.at as Record<string, any>).some((slot: any) => Array.isArray(slot?.Cells) && slot.Cells.length > 0)
  );
}
