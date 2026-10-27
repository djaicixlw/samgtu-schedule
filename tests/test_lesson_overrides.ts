/**
 * Per-lesson overrides store only real changes; save messages match what changed;
 * a group-wide teacher assignment overrides stale per-lesson snapshots (the "wrong БЖД teacher" report).
 */
import { buildLessonOverride, describeLessonSave, clearTeacherOverridesForChangedKeys } from '../utils/lessonOverrides';

let passed = 0, failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✓ [PASS] ${msg}`); }
  else { failed++; console.error(`  ❌ [FAIL] ${msg}`); process.exitCode = 1; }
}

const base = { subject: 'Безопасность жизнедеятельности', teacher: 'Сидоров Артем Александрович', location: 'Корпус № 7, 704', hours: 2 };
// What EditLessonModal submits: EVERY field, whether touched or not.
const fullPayload = (over: Record<string, any> = {}) => ({
  subject: base.subject, teacher: base.teacher, location: base.location, note: '', isNoteRecurring: false,
  isCancelled: false, isHidden: false, hours: 2, attachments: [], ...over
});

console.log('\n=================================================');
console.log('   TEST SUITE: LESSON OVERRIDES');
console.log('=================================================');

console.log('\n1. Saving without touching anything stores nothing');
{
  const r = buildLessonOverride({}, fullPayload() as any, base, 'lesson');
  assert(Object.keys(r.next).length === 0 && r.changed.length === 0, 'an untouched modal save creates no override');
}

console.log('\n2. Only the edited field is stored');
{
  const r = buildLessonOverride({}, fullPayload({ location: 'Корпус № 1, 101' }) as any, base, 'lesson');
  assert(JSON.stringify(r.next) === '{"location":"Корпус № 1, 101"}', 'room change stores the room only (no teacher/subject snapshot)');
  assert(r.changed.join() === 'location', 'changed = location');
  const back = buildLessonOverride(r.next, fullPayload() as any, base, 'lesson');
  assert(Object.keys(back.next).length === 0, 'restoring the original room removes the override');
}

console.log('\n3. Group-wide teacher assignment is not duplicated per lesson');
{
  const stale = { teacher: 'Кривова Маргарита Андреевна', location: 'Корпус № 7, 704' };
  const r = buildLessonOverride(stale, fullPayload({ teacher: 'Сидоров Артем Александрович' }) as any, base, 'mapped');
  assert(r.next.teacher === undefined && r.next.location === '' + stale.location, 'scope type/all removes the per-lesson teacher and keeps other overrides');
  const single = buildLessonOverride({}, fullPayload({ teacher: 'Иванов И.И.' }) as any, base, 'lesson');
  assert(single.next.teacher === 'Иванов И.И.', 'scope "this lesson" keeps a per-lesson teacher');
}

console.log('\n4. Notes');
{
  const added = buildLessonOverride({}, fullPayload({ note: ' Принести тетрадь ', noteDate: '2026-10-26' }) as any, base, 'lesson');
  assert(added.next.note === 'Принести тетрадь' && added.next.noteDate === '2026-10-26' && added.changed.join() === 'note', 'note is trimmed and stored with its date');
  const removed = buildLessonOverride(added.next, fullPayload({ note: '   ' }) as any, base, 'lesson');
  assert(removed.next.note === undefined && removed.next.noteDate === undefined, 'an emptied note removes note, date and recurrence');
}

console.log('\n5. Save messages describe what really happened');
{
  assert(describeLessonSave({ changed: [], cancelChanged: false, cancelledNow: false }).text === 'Изменений нет', 'nothing changed: "no changes"');
  assert(describeLessonSave({ changed: ['location'], cancelChanged: false, cancelledNow: false }).text === 'Аудитория пары изменена', 'room only');
  assert(describeLessonSave({ changed: [], cancelChanged: true, cancelledNow: true }).kind === 'warning', 'cancelling warns');
  assert(describeLessonSave({ changed: [], cancelChanged: true, cancelledNow: false }).text === 'Пара снова проводится', 'un-cancelling says the lesson is held again');
  const teacher = describeLessonSave({ changed: ['teacher'], cancelChanged: false, cancelledNow: false, teacherScope: 'type', teacher: 'Сидоров', lessonType: 'Практические' });
  assert(teacher.text.includes('Практические') && !/посещаем/i.test(teacher.text), 'teacher message names the lesson type and never mentions attendance');
  assert(describeLessonSave({ changed: ['location', 'note'], cancelChanged: false, cancelledNow: false }).text === 'Изменения пары сохранены', 'several changes: one summary');
}

console.log('\n6. A group-wide assignment overrides stale snapshots');
{
  const registry: any = { 1: [{ dayName: 'Понедельник', lessons: [
    { id: 'l-practice', subject: 'БЖД', type: 'Практические' },
    { id: 'l-lecture', subject: 'БЖД', type: 'Лекции' },
    { id: 'l-other', subject: 'Физика', type: 'Практические' }
  ] }] };
  const overrides: any = {
    'l-practice': { teacher: 'Кривова', location: '704' },
    'l-lecture': { teacher: 'Сорокина' },
    'l-other': { teacher: 'Другой' }
  };
  const prev = { 'БЖД::Лекции': 'Сорокина' };
  const next = { 'БЖД::Лекции': 'Сорокина', 'БЖД::Практические': 'Сидоров' };
  const r = clearTeacherOverridesForChangedKeys(overrides, registry, prev, next);
  assert(r.overrides['l-practice'].teacher === undefined && r.overrides['l-practice'].location === '704', 'the practical lesson loses the stale teacher, keeps its room');
  assert(r.overrides['l-lecture'].teacher === 'Сорокина', 'an unchanged mapping does not touch its lessons');
  assert(r.overrides['l-other'].teacher === 'Другой', 'other subjects are not touched');
  assert(r.cleared === 1, 'exactly one snapshot cleared');
  const untouched = clearTeacherOverridesForChangedKeys(overrides, registry, next, next);
  assert(untouched.cleared === 0 && untouched.overrides === overrides, 'saving an identical mapping changes nothing');
}

console.log(`\nTOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
if (failed > 0) process.exitCode = 1;
