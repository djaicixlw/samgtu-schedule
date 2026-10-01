import { WeekData, DaySchedule, Lesson } from '../types';

export type LoadFailReason = 'not_found' | 'network' | 'invalid' | 'empty' | 'timeout';

export type LoadResult =
  | { ok: true; data: WeekData; [week: number]: DaySchedule[] | undefined }
  | { ok: false; reason: LoadFailReason; [week: number]: DaySchedule[] | undefined };

/**
 * Checks whether a WeekData structure contains at least one real lesson.
 */
export function hasAnyLessons(data: WeekData | undefined): boolean {
  if (!data) return false;
  for (let w = 1; w <= 4; w++) {
    const days = data[w];
    if (Array.isArray(days)) {
      for (const day of days) {
        if (day && Array.isArray(day.lessons) && day.lessons.length > 0) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Validates and sanitizes a raw unknown object into WeekData.
 * Returns null if the structure is invalid.
 * Validates:
 * - Object with keys 1, 2, 3, 4 (arrays of days)
 * - Each day has dayName (non-empty string) and lessons (array)
 * - Each lesson has valid id (string) and subject (string)
 */
export function parseWeekData(raw: unknown): WeekData | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const obj = raw as Record<string, unknown>;
  const parsedWeeks: Partial<WeekData> = {};

  for (let w = 1; w <= 4; w++) {
    const weekArr = obj[w] ?? obj[String(w)];
    if (!Array.isArray(weekArr)) {
      return null;
    }

    const parsedDays: DaySchedule[] = [];
    for (const day of weekArr) {
      if (!day || typeof day !== 'object' || Array.isArray(day)) {
        return null;
      }
      if (typeof day.dayName !== 'string' || !day.dayName.trim()) {
        return null;
      }
      if (!Array.isArray(day.lessons)) {
        return null;
      }

      const parsedLessons: Lesson[] = [];
      for (const lesson of day.lessons) {
        if (!lesson || typeof lesson !== 'object' || Array.isArray(lesson)) {
          return null;
        }
        if (typeof lesson.id !== 'string' || !lesson.id.trim()) {
          return null;
        }
        if (typeof lesson.subject !== 'string' || !lesson.subject.trim()) {
          return null;
        }

        parsedLessons.push({
          id: lesson.id.trim(),
          timeStart: typeof lesson.timeStart === 'string' ? lesson.timeStart : '',
          timeEnd: typeof lesson.timeEnd === 'string' ? lesson.timeEnd : '',
          subject: lesson.subject.trim(),
          type: typeof lesson.type === 'string' ? lesson.type : '',
          location: typeof lesson.location === 'string' ? lesson.location : '',
          teacher: typeof lesson.teacher === 'string' ? lesson.teacher : '',
          groups: typeof lesson.groups === 'string' ? lesson.groups : undefined,
          note: typeof lesson.note === 'string' ? lesson.note : undefined
        });
      }

      parsedDays.push({
        dayName: day.dayName.trim(),
        lessons: parsedLessons
      });
    }

    parsedWeeks[w] = parsedDays;
  }

  return parsedWeeks as WeekData;
}

/**
 * Validates raw data and checks whether it contains real lessons.
 * Returns { ok: true, data } or { ok: false, reason: 'invalid' | 'empty' }.
 */
export function validateWeekData(raw: unknown): { ok: true; data: WeekData } | { ok: false; reason: 'invalid' | 'empty' } {
  const parsed = parseWeekData(raw);
  if (!parsed) {
    return { ok: false, reason: 'invalid' };
  }
  if (!hasAnyLessons(parsed)) {
    return { ok: false, reason: 'empty' };
  }
  return { ok: true, data: parsed };
}
