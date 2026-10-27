import type { Lesson } from '../types';

/**
 * Per-lesson overrides must contain only what the starosta really changed.
 * The edit modal always submits every field, and storing all of them froze a snapshot of the
 * lesson (teacher, room, subject, hours) at save time: later official updates and group-wide
 * teacher assignments never reached that lesson again.
 */

export type LessonOverride = Record<string, any>;
export type OverrideMap = Record<string, LessonOverride>;

export interface BaseLessonValues {
  subject: string;
  /** Teacher as the schedule would show it without a per-lesson override (group mapping or official data). */
  teacher: string;
  location: string;
  hours: number;
}

export type TeacherScope = 'lesson' | 'mapped';

export interface OverrideResult {
  next: LessonOverride;
  /** Keys that really changed: subject, teacher, location, hours, isHidden, attachments, note. */
  changed: string[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function buildLessonOverride(
  current: LessonOverride,
  edited: Partial<Lesson>,
  base: BaseLessonValues,
  teacherScope: TeacherScope
): OverrideResult {
  const next: LessonOverride = { ...current };
  delete next.isCancelled; // cancellation is date-specific and lives in the attendance records
  const changed: string[] = [];

  const applyScalar = (key: 'subject' | 'location' | 'hours', baseValue: string | number) => {
    const value = edited[key];
    if (value === undefined) return;
    const effective = current[key] !== undefined ? current[key] : baseValue;
    if (same(value, effective)) return;
    changed.push(key);
    if (same(value, baseValue)) delete next[key]; else next[key] = value;
  };
  applyScalar('subject', base.subject);
  applyScalar('location', base.location);
  applyScalar('hours', base.hours);

  if (edited.teacher !== undefined) {
    const effective = current.teacher !== undefined ? current.teacher : base.teacher;
    if (edited.teacher.trim() !== String(effective || '').trim()) {
      changed.push('teacher');
      if (teacherScope === 'mapped' || same(edited.teacher.trim(), base.teacher.trim())) {
        delete next.teacher; // a group-wide assignment owns the value; or the edit just restored the default
      } else {
        next.teacher = edited.teacher;
      }
    }
  }

  if (edited.isHidden !== undefined && Boolean(edited.isHidden) !== Boolean(current.isHidden)) {
    changed.push('isHidden');
    if (edited.isHidden) next.isHidden = true; else delete next.isHidden;
  }

  if (edited.attachments !== undefined) {
    const effective = current.attachments ?? [];
    if (!same(edited.attachments, effective)) {
      changed.push('attachments');
      if (edited.attachments.length === 0) delete next.attachments; else next.attachments = edited.attachments;
    }
  }

  if (edited.note !== undefined) {
    const cleanNote = edited.note.trim();
    const noteChanged = cleanNote !== String(current.note || '');
    const metaChanged = Boolean(cleanNote) &&
      (!same(edited.noteDate, current.noteDate) || Boolean(edited.isNoteRecurring) !== Boolean(current.isNoteRecurring));
    if (noteChanged || metaChanged) {
      changed.push('note');
      if (!cleanNote) {
        delete next.note; delete next.noteDate; delete next.isNoteRecurring;
      } else {
        next.note = cleanNote;
        if (edited.noteDate !== undefined) next.noteDate = edited.noteDate; else delete next.noteDate;
        next.isNoteRecurring = Boolean(edited.isNoteRecurring);
      }
    }
  }

  return { next, changed };
}

export interface SaveSummaryInput {
  changed: string[];
  cancelChanged: boolean;
  cancelledNow: boolean;
  teacherScope?: 'lesson' | 'type' | 'all';
  teacher?: string;
  lessonType?: string;
  noteRemoved?: boolean;
}

export interface SaveSummary {
  kind: 'success' | 'warning' | 'info';
  text: string;
}

/** One accurate message per save instead of a different message depending on which flag happened to be set. */
export function describeLessonSave(input: SaveSummaryInput): SaveSummary {
  const parts = input.changed.length + (input.cancelChanged ? 1 : 0);
  if (parts === 0) return { kind: 'info', text: 'Изменений нет' };

  if (parts === 1) {
    if (input.cancelChanged) {
      return input.cancelledNow
        ? { kind: 'warning', text: 'Пара отменена на эту дату' }
        : { kind: 'success', text: 'Пара снова проводится' };
    }
    switch (input.changed[0]) {
      case 'teacher':
        if (input.teacherScope === 'type') return { kind: 'success', text: `Преподаватель «${input.teacher}» назначен на все «${input.lessonType}» по этому предмету` };
        if (input.teacherScope === 'all') return { kind: 'success', text: `Преподаватель «${input.teacher}» назначен на все занятия по этому предмету` };
        return { kind: 'success', text: 'Преподаватель этой пары изменён' };
      case 'note':
        return { kind: 'success', text: input.noteRemoved ? 'Заметка к паре удалена' : 'Заметка к паре сохранена' };
      case 'location':
        return { kind: 'success', text: 'Аудитория пары изменена' };
      case 'attachments':
        return { kind: 'success', text: 'Материалы к паре сохранены' };
      default:
        return { kind: 'success', text: 'Изменения пары сохранены' };
    }
  }
  return { kind: 'success', text: 'Изменения пары сохранены' };
}

type WeekRegistry = Record<string, Array<{ lessons: Array<Pick<Lesson, 'id' | 'subject' | 'type'>> }>>;

/**
 * A group-wide teacher assignment must win over older per-lesson teacher snapshots for the lessons it covers.
 * Keys are `subject::type` (one kind of lesson) or `subject` (every kind without its own key).
 */
export function clearTeacherOverridesForChangedKeys(
  overrides: OverrideMap,
  registry: WeekRegistry,
  previous: Record<string, string>,
  next: Record<string, string>
): { overrides: OverrideMap; cleared: number } {
  const changedKeys = new Set<string>();
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if ((previous[key] || '') !== (next[key] || '')) changedKeys.add(key);
  }
  if (changedKeys.size === 0) return { overrides, cleared: 0 };

  const result: OverrideMap = { ...overrides };
  let cleared = 0;
  for (const days of Object.values(registry)) {
    for (const day of days) {
      for (const lesson of day.lessons) {
        const ov = result[lesson.id];
        if (!ov || ov.teacher === undefined) continue;
        const typeKey = `${lesson.subject}::${lesson.type}`;
        const affected = changedKeys.has(typeKey) || (changedKeys.has(lesson.subject) && next[typeKey] === undefined);
        if (!affected) continue;
        const { teacher, ...rest } = ov;
        cleared++;
        if (Object.keys(rest).length === 0) delete result[lesson.id]; else result[lesson.id] = rest;
      }
    }
  }
  return { overrides: result, cleared };
}
