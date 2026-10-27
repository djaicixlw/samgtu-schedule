/**
 * Teacher overrides on single lessons used to be "frozen copies": editing ANY field of a pair (note, room, files)
 * sent the pre-filled teacher back and stored it in the pair's override, and the scopes "all lessons of this type" /
 * "all lessons of the subject" stored it there as well. An override beats every subject/type assignment, so later
 * changes in "Преподаватели" silently did not apply to those pairs.
 *
 * clearFrozenTeachers removes exactly those copies, and keeps a deliberate per-pair choice.
 */

export interface LessonRef { id: string; subject: string; type: string; teacher?: string }
export type TeacherMap = Record<string, string>;

/** Same priority as the schedule renderer, without the per-lesson override. */
export const teacherWithoutOverride = (l: LessonRef, teachers: TeacherMap): string =>
  teachers[`${l.subject}::${l.type}`] || teachers[l.subject] || l.teacher || '';

/**
 * Drops `teacher` from a pair's override when it is just a frozen copy of what the pair resolved to BEFORE the
 * change, and the change would actually alter that pair's teacher. A teacher that differs from the previous
 * resolved one is a deliberate choice for this pair and is kept.
 * (Pins made by "reset pair" equal the official teacher; they are cleared by the explicit "Снять" button, not here.)
 */
export function clearFrozenTeachers<T extends { teacher?: string }>(
  overrides: Record<string, T>,
  lessons: Map<string, LessonRef> | Record<string, LessonRef>,
  previousTeachers: TeacherMap,
  nextTeachers: TeacherMap
): { overrides: Record<string, T>; cleared: string[] } {
  const get = (id: string): LessonRef | undefined => (lessons instanceof Map ? lessons.get(id) : (lessons as Record<string, LessonRef>)[id]);
  const out: Record<string, T> = {};
  const cleared: string[] = [];
  for (const [id, ov] of Object.entries(overrides || {})) {
    const lesson = get(id);
    if (!ov || ov.teacher === undefined || !lesson) { out[id] = ov; continue; }
    const before = teacherWithoutOverride(lesson, previousTeachers);
    const after = teacherWithoutOverride(lesson, nextTeachers);
    const wouldChange = after !== before;
    const isFrozenCopy = ov.teacher === before;
    if (wouldChange && isFrozenCopy && ov.teacher !== after) {
      const { teacher: _drop, ...rest } = ov as any;
      cleared.push(id);
      if (Object.keys(rest).length > 0) out[id] = rest as T;   // an override with nothing left is removed entirely
    } else {
      out[id] = ov;
    }
  }
  return { overrides: out, cleared };
}

/** id -> lesson for the whole 4-week schedule of a group (SCHEDULE_REGISTRY[groupId]). */
export function buildLessonIndex(weeks: object | undefined | null): Map<string, LessonRef> {
  const index = new Map<string, LessonRef>();
  for (const days of Object.values((weeks || {}) as Record<string, Array<{ lessons?: LessonRef[] }>>)) {
    for (const day of days || []) {
      for (const l of day.lessons || []) if (l && l.id) index.set(l.id, l);
    }
  }
  return index;
}

/** "subject::type" -> number of pairs whose own override shows a DIFFERENT teacher than the subject/type assignment. */
export function countPinnedTeachers(
  overrides: Record<string, { teacher?: string }>,
  lessons: Map<string, LessonRef>,
  teachers: TeacherMap
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, ov] of Object.entries(overrides || {})) {
    const l = lessons.get(id);
    if (!l || !ov || ov.teacher === undefined) continue;
    if (ov.teacher === teacherWithoutOverride(l, teachers)) continue;   // changes nothing visible
    const key = `${l.subject}::${l.type}`;
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

/** Removes the per-pair teacher from every pair of one subject/type (explicit user action). */
export function unpinTeachers<T extends { teacher?: string }>(
  overrides: Record<string, T>,
  lessons: Map<string, LessonRef>,
  key: string
): { overrides: Record<string, T>; cleared: string[] } {
  const out: Record<string, T> = {};
  const cleared: string[] = [];
  for (const [id, ov] of Object.entries(overrides || {})) {
    const l = lessons.get(id);
    if (l && ov && ov.teacher !== undefined && `${l.subject}::${l.type}` === key) {
      const { teacher: _drop, ...rest } = ov as any;
      cleared.push(id);
      if (Object.keys(rest).length > 0) out[id] = rest as T;
    } else {
      out[id] = ov;
    }
  }
  return { overrides: out, cleared };
}
