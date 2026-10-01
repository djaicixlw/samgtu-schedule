import { SCHEDULE_REGISTRY } from '../constants';
import { Lesson } from '../types';

console.log("=================================================");
console.log("      TEST SUITE 3: SCHEDULE SYNCHRONIZATION     ");
console.log("=================================================");

// 3.1 Teacher resolution hierarchy test
console.log("\n--- 3.1 Teacher Resolution Hierarchy ---");
const baseLesson: Lesson = {
  id: 'test-1',
  timeStart: '08:00',
  timeEnd: '09:35',
  subject: 'Физика',
  type: 'Лекции',
  teacher: 'Иванов И.И.',
  location: '109'
};

function resolveTeacher(
  lesson: Lesson,
  override: Partial<Lesson> = {},
  subjectTeachers: Record<string, string> = {}
): string {
  const teacherByType = subjectTeachers[`${lesson.subject}::${lesson.type}`];
  const flatTeacher = subjectTeachers[lesson.subject];
  return override.teacher !== undefined ? override.teacher : (teacherByType || flatTeacher || lesson.teacher);
}

// Case 1: Default
console.log("1. Default lesson teacher:", resolveTeacher(baseLesson)); // Иванов И.И.

// Case 2: Subject level teacher assigned (flat)
let teachers: Record<string, string> = { 'Физика': 'Петров П.П.' };
console.log("2. Flat subject teacher:", resolveTeacher(baseLesson, {}, teachers)); // Петров П.П.

// Case 3: Type level teacher assigned (more specific)
teachers[`Физика::Лекции`] = 'Сидоров С.С.';
console.log("3. Type-specific teacher:", resolveTeacher(baseLesson, {}, teachers)); // Сидоров С.С.

// Case 4: Single lesson override
const override: Partial<Lesson> = { teacher: 'Кузнецов К.К.' };
console.log("4. Single lesson override:", resolveTeacher(baseLesson, override, teachers)); // Кузнецов К.К.

// Case 5: User clears teacher in override (sets to empty string "")
const clearedOverride: Partial<Lesson> = { teacher: '' };
const clearedResult = resolveTeacher(baseLesson, clearedOverride, teachers);
console.log("5. User clears teacher (override.teacher = ''):", `"${clearedResult}"`);
if (clearedResult === '') {
  console.log("  [PASS] Empty string teacher override successfully cleared teacher!");
} else {
  console.log("  >>> BUG: Empty string '' is falsy, so user CANNOT delete/clear a teacher via override! <<<");
}

// 3.2 handleResetLesson test
console.log("\n--- 3.2 handleResetLesson Analysis ---");
// Simulate what happens in App.tsx when a lesson is updated with applyScope='type' and then reset
const currentScheduleOverrides: Record<string, Partial<Lesson>> = {};
const currentSubjectTeachers: Record<string, string> = {};

// Step 1: User edits lesson '310-w1-mo-1' with teacher 'Новый Преподаватель', room '101', note 'Тест' with applyScope='type'
const lessonId = '310-w1-mo-1';
const subject = 'Опытно-конструкторские работы...';
const type = 'Лекции';

// Code from App.tsx handleUpdateLesson:
currentScheduleOverrides[lessonId] = {
  teacher: 'Новый Преподаватель',
  location: 'Корпус 1, 101',
  note: 'Тест'
};
currentSubjectTeachers[`${subject}::${type}`] = 'Новый Преподаватель';

console.log("After updateLesson with scope 'type':");
console.log("  scheduleOverrides[lessonId]:", currentScheduleOverrides[lessonId]);
console.log("  subjectTeachers:", currentSubjectTeachers);

// Step 2: User clicks 'Сбросить' (handleResetLesson)
delete currentScheduleOverrides[lessonId];

console.log("\nAfter handleResetLesson:");
console.log("  scheduleOverrides[lessonId]:", currentScheduleOverrides[lessonId]); // undefined
console.log("  subjectTeachers:", currentSubjectTeachers); // STILL HAS 'Новый Преподаватель'!

// Now check resolved teacher after reset:
const mockMo1: Lesson = {
  id: lessonId,
  timeStart: '09:45',
  timeEnd: '11:20',
  subject: subject,
  type: type,
  teacher: 'Парфенов Кирилл Викторович', // Default in constants.ts
  location: '109'
};
const teacherAfterReset = resolveTeacher(mockMo1, currentScheduleOverrides[lessonId] || {}, currentSubjectTeachers);
console.log(`  Resolved teacher after reset: '${teacherAfterReset}' (Expected default: 'Парфенов Кирилл Викторович')`);
if (teacherAfterReset !== 'Парфенов Кирилл Викторович') {
  console.log("  >>> BUG: Resetting a lesson does NOT reset the teacher if it was assigned via scope 'type' or 'all'! <<<");
}

// 3.3 Thursday (DayColumn counter & rendering)
console.log("\n--- 3.3 Thursday (0 lessons) Counter & Rendering ---");
const week1Schedule = SCHEDULE_REGISTRY['ingt-310'][1];
const thursday = week1Schedule.find(d => d.dayName === 'Четверг')!;
console.log("Thursday lessons count:", thursday.lessons.length);

// DayColumn.tsx line 37:
// {daySchedule.lessons.length} {daySchedule.lessons.length === 1 ? 'пара' : daySchedule.lessons.length > 4 ? 'пар' : 'пары'}
const count = thursday.lessons.length;
const declension = count === 1 ? 'пара' : count > 4 ? 'пар' : 'пары';
const counterString = `${count} ${declension}`;
console.log(`DayColumn counter output for 0 lessons: "${counterString}"`);
if (counterString === '0 пары') {
  console.log("  >>> GRAMMAR BUG: Displays '0 пары' instead of correct Russian '0 пар'! <<<");
}
