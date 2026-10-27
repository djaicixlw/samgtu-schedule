/**
 * AUD-035: extracted vertical slice — "day lessons for the attendance tab".
 *
 * This is the DECOMPOSITION SAMPLE: the pure computation of the effective
 * lesson list for one day (base schedule + overrides + custom lessons +
 * PE filtering + Monday-fallback), moved VERBATIM out of the
 * AttendanceTracker God-component (775 lines) into a testable util.
 *
 * Behavior contract (pinned by tests/test_stage1_ui_and_double_hours and the
 * suite below): the returned array is identical to what the inline useMemo in
 * AttendanceTracker produced before the extraction — same filters, same
 * fallback, same ordering.
 */

import { SCHEDULE_REGISTRY } from '../constants';
import { Lesson, DaySchedule } from '../types';
import { isPhysicalEducationLesson } from './scheduleLoader';
import { TIME_SLOTS } from '../attendance';

export interface DayLessonsParams {
  daySchedule?: DaySchedule;
  dayName: string;
  week: number;
  currentGroupId: string;
  scheduleOverrides: Record<string, Partial<Lesson>>;
}

export function buildDayLessons({ daySchedule, dayName, week, currentGroupId, scheduleOverrides }: DayLessonsParams): Lesson[] {
  let sourceLessons = daySchedule && Array.isArray(daySchedule.lessons) ? daySchedule.lessons : [];
  // Fallback for Monday if week 1 Monday is empty: pull from week 3
  if (dayName === 'Понедельник' && sourceLessons.length === 0) {
    const w3Mon = SCHEDULE_REGISTRY[currentGroupId]?.[3]?.find(d => d.dayName === 'Понедельник');
    if (w3Mon && Array.isArray(w3Mon.lessons) && w3Mon.lessons.length > 0) {
      sourceLessons = w3Mon.lessons;
    }
  }

  const standardLessons = sourceLessons.map(lesson => {
    if (!lesson || !lesson.id) return lesson;
    const override = scheduleOverrides[lesson.id] || {};
    return {
      ...lesson,
      ...override,
      isHidden: !!override.isHidden
    };
  }).filter(l => !l.isHidden && !isPhysicalEducationLesson(l));

  // Include dynamically added custom lessons for this day/week
  const customLessons: Lesson[] = Object.entries(scheduleOverrides)
    .filter(([id, rawOv]) => {
      const ov = rawOv as Partial<Lesson> & { dayName?: string };
      const isCustom = id.includes('_extra_') || id.includes('_custom_');
      const matchesDay = ov.dayName === dayName || id.startsWith(`${dayName.toLowerCase()}_w${week}_`);
      return isCustom && matchesDay && !ov.isHidden && !isPhysicalEducationLesson(ov);
    })
    .map(([id, rawOv]) => {
      const ov = rawOv as Partial<Lesson> & { dayName?: string };
      const orderNum = ov.order || 1;
      const timeSlot = (TIME_SLOTS as any)[String(orderNum)] || { timeStart: '08:30', timeEnd: '10:00' };
      return {
        id,
        subject: ov.subject || 'Пользовательская пара',
        type: ov.type || 'Практические занятия',
        timeStart: ov.timeStart || timeSlot.timeStart,
        timeEnd: ov.timeEnd || timeSlot.timeEnd,
        location: ov.location || 'Ауд.',
        teacher: ov.teacher || '',
        order: orderNum,
        isCancelled: !!ov.isCancelled,
        note: ov.note
      } as Lesson;
    });

  return [...standardLessons, ...customLessons].sort((a, b) => (a.order || 1) - (b.order || 1));
}
