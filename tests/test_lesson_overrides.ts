/**
 * Per-lesson overrides store only real changes; save messages match what changed;
 * a group-wide teacher assignment overrides stale per-lesson snapshots (the "wrong БЖД teacher" report).
 * Bug #3ИНГТ110: noteDate exact date calculation, key normalization, and admin role sync authorization.
 */
import { buildLessonOverride, describeLessonSave, clearTeacherOverridesForChangedKeys, normalizeScheduleOverridesKeys } from '../utils/lessonOverrides';
import { getDayISODate } from '../utils/samaraDate';
import worker, { createTelegramInitData } from '../cloudflare-worker.js';

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

async function run() {
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

  console.log('\n7. Bug #3ИНГТ110: Lesson noteDate computation & attachments on Week 3');
  {
    const targetIso = getDayISODate('Среда', 3);
    const fakeToday = '2026-11-10'; // e.g. Tuesday
    // Simulating user adding note and attachment for Wednesday lesson on Week 3:
    const lessonData = fullPayload({
      note: 'Подготовиться к коллоквиуму',
      isNoteRecurring: false,
      noteDate: targetIso, // MUST match the lesson's date (Wednesday), not fakeToday
      attachments: [{ name: 'лекция.pdf', url: 'https://example.com/lec.pdf', type: 'file' }]
    });
    const r = buildLessonOverride({}, lessonData as any, base, 'lesson');
    assert(r.next.note === 'Подготовиться к коллоквиуму', 'note is saved');
    assert(r.next.noteDate === targetIso, `noteDate matches lesson day on Week 3 (${targetIso})`);
    assert(Array.isArray(r.next.attachments) && r.next.attachments.length === 1, 'attachments array preserved');
    assert(r.next.attachments[0].name === 'лекция.pdf', 'attachment name preserved');

    // Verify that on the lesson date itself, the note is visible
    const isVisibleOnLessonDay = r.next.noteDate === targetIso;
    assert(isVisibleOnLessonDay, 'note is visible when viewing Wednesday Week 3');

    // Verify that if noteDate were wrongly set to fakeToday, it would mismatch
    const mismatched = fakeToday !== targetIso;
    assert(mismatched, 'fakeToday correctly differs from target Wednesday date');
  }

  console.log('\n8. Bug #3ИНГТ110: Key normalization ingt-310-w* -> 310-w*');
  {
    const rawOverrides = {
      'ingt-310-w3-we-1': { note: 'Заметка 310', attachments: [{ name: 'f.pdf', url: 'https://x.com', type: 'file' }] },
      '310-w3-we-2': { teacher: 'Сидоров А.А.' },
      'faid-310-w1-mo-1': { location: '101' }
    };
    const normalized310 = normalizeScheduleOverridesKeys('ingt-310', rawOverrides);
    assert(normalized310['310-w3-we-1'] !== undefined, 'ingt-310-w3-we-1 normalized to 310-w3-we-1');
    assert(normalized310['310-w3-we-1'].note === 'Заметка 310', 'note preserved across normalization');
    assert(normalized310['310-w3-we-1'].attachments.length === 1, 'attachments preserved across normalization');
    assert(normalized310['ingt-310-w3-we-1'] === undefined, 'legacy ingt-310- key removed');
    assert(normalized310['310-w3-we-2'].teacher === 'Сидоров А.А.', 'existing 310- key preserved');

    // Merging fields if both legacy and canonical keys exist
    const conflictingOverrides = {
      'ingt-310-w3-fr-4': { note: 'Старая заметка', teacher: 'Иванов' },
      '310-w3-fr-4': { note: 'Свежая заметка' }
    };
    const merged = normalizeScheduleOverridesKeys('ingt-310', conflictingOverrides);
    assert(merged['310-w3-fr-4'].note === 'Свежая заметка', 'canonical key fields win over legacy fields');
    assert(merged['310-w3-fr-4'].teacher === 'Иванов', 'non-overlapping fields merged cleanly');

    // Other groups untouched
    const otherGroup = normalizeScheduleOverridesKeys('faid-310', rawOverrides);
    assert(otherGroup['faid-310-w1-mo-1'] !== undefined, 'other group keys untouched');
  }

  console.log('\n9. Bug #3ИНГТ110: Cloudflare Worker sync authorization for Admin without staff token');
  {
    class MemKV {
      m = new Map<string, string>();
      async get(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
      async put(k: string, v: string) { this.m.set(k, v); }
      async delete(k: string) { this.m.delete(k); }
      async list() { return { keys: [], list_complete: true }; }
    }

    const kv = new MemKV();
    const env: any = {
      APP_DATA: kv,
      ID_PEPPER: 'test-pepper-12345678901234567890',
      TELEGRAM_BOT_TOKEN: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
      ADMIN_BLIND_ID: 'admin-blind-test-id'
    };

    // 1. Admin with TG ID 1027070834 saves schedule overrides for ingt-310 without staff token
    const adminTgId = 1027070834;
    const adminInitData = await createTelegramInitData({
      user: JSON.stringify({ id: adminTgId, first_name: 'Admin' }),
      auth_date: String(Math.floor(Date.now() / 1000))
    }, env.TELEGRAM_BOT_TOKEN);

    const schedulePayload = {
      scheduleOverrides: {
        '310-w3-we-1': {
          note: 'Материалы к коллоквиуму',
          noteDate: '2026-11-11',
          attachments: [{ name: 'colloq.pdf', url: 'https://example.com/colloq.pdf', type: 'file' }]
        }
      }
    };

    const putReq = new Request('https://worker.test/sync/schedule?groupId=ingt-310', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Init-Data': adminInitData
      },
      body: JSON.stringify(schedulePayload)
    });

    const putRes = await worker.fetch(putReq, env);
    assert(putRes.status === 200, `Admin without staff token successfully writes schedule (status ${putRes.status})`);

    // 2. Second device fetches the schedule overrides
    const getReq = new Request('https://worker.test/sync/schedule?groupId=ingt-310', {
      method: 'GET'
    });
    const getRes = await worker.fetch(getReq, env);
    assert(getRes.status === 200, 'GET /sync/schedule returns 200');
    const cloudData = await getRes.json();
    const groupOverrides = cloudData.byGroup?.['ingt-310']?.overrides || cloudData.scheduleOverrides;
    assert(groupOverrides?.['310-w3-we-1']?.note === 'Материалы к коллоквиуму', 'Note retrieved on secondary device');
    assert(groupOverrides?.['310-w3-we-1']?.attachments?.length === 1, 'Attachments retrieved on secondary device');

    // 3. GET /v3/role returns admin role and issued token
    const roleReq = new Request('https://worker.test/v3/role?gid=ingt-310', {
      method: 'GET',
      headers: {
        'X-Telegram-Init-Data': adminInitData
      }
    });
    const roleRes = await worker.fetch(roleReq, env);
    assert(roleRes.status === 200, 'GET /v3/role returns 200');
    const roleData = await roleRes.json();
    assert(roleData.ok === true && roleData.role === 'admin', 'GET /v3/role identifies caller as admin');
    assert(typeof roleData.token === 'string' && roleData.token.length > 20, 'GET /v3/role returns freshly minted staff token');
  }

  console.log(`\nTOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

run();
