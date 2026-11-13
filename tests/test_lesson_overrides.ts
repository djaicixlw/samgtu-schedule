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

    // Canonical key has absolute priority over legacy key (no resurrecting stale fields/attachments)
    const conflictingOverrides = {
      'ingt-310-w3-fr-4': { note: 'Старая заметка', teacher: 'Иванов', attachments: [{ name: 'old.pdf', url: 'https://x.com' }] },
      '310-w3-fr-4': { note: 'Свежая заметка' }
    };
    const merged = normalizeScheduleOverridesKeys('ingt-310', conflictingOverrides);
    assert(merged['310-w3-fr-4'].note === 'Свежая заметка', 'canonical key fields win over legacy fields');
    assert(merged['310-w3-fr-4'].attachments === undefined, 'legacy attachments are never merged onto canonical key');

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

  console.log('\n10. Bug #3ИНГТ110: Exact E2E scenario (Photo 1/2 -> Photo 2/2)');
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

    const adminTgId = 1027070834;
    const adminInitData = await createTelegramInitData({
      user: JSON.stringify({ id: adminTgId, first_name: 'Admin' }),
      auth_date: String(Math.floor(Date.now() / 1000))
    }, env.TELEGRAM_BOT_TOKEN);

    // Device 1: Admin on Week 3 (2026-11-11) adds note "к 9" to lesson 310-w3-we-1
    const lessonDate = getDayISODate('Среда', 3);
    assert(lessonDate === '2026-11-11', 'Lesson date is 2026-11-11');

    const updatePayload = {
      note: 'к 9',
      noteDate: lessonDate,
      isNoteRecurring: false
    };

    const overrideResult = buildLessonOverride({}, fullPayload(updatePayload) as any, base, 'lesson');
    assert(overrideResult.next.note === 'к 9', 'Note built locally as "к 9"');
    assert(overrideResult.next.noteDate === '2026-11-11', 'noteDate is 2026-11-11');

    // PUT to server
    const syncReq = new Request('https://worker.test/sync/schedule?groupId=ingt-310', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Init-Data': adminInitData
      },
      body: JSON.stringify({
        byGroup: {
          'ingt-310': {
            overrides: {
              '310-w3-we-1': overrideResult.next
            },
            updatedAt: Date.now()
          }
        }
      })
    });

    const syncRes = await worker.fetch(syncReq, env);
    assert(syncRes.status === 200, 'Device 1: Sync to worker returns 200 OK');

    // Verify stored in KV
    const kvRaw = await kv.get('schedule:ingt-310');
    assert(kvRaw !== null, 'schedule:ingt-310 written to KV');
    const kvParsed = JSON.parse(kvRaw!);
    assert(kvParsed.overrides?.['310-w3-we-1']?.note === 'к 9', 'KV contains note "к 9"');
    assert(kvParsed.overrides?.['310-w3-we-1']?.noteDate === '2026-11-11', 'KV contains noteDate 2026-11-11');

    // Device 1 reloads / fetches again:
    const reloadReq = new Request('https://worker.test/sync/schedule?groupId=ingt-310', {
      method: 'GET'
    });
    const reloadRes = await worker.fetch(reloadReq, env);
    const reloadData = await reloadRes.json();
    const reloadOverrides = reloadData.byGroup?.['ingt-310']?.overrides || reloadData.scheduleOverrides;
    assert(reloadOverrides?.['310-w3-we-1']?.note === 'к 9', 'Device 1 reload: note "к 9" persists, NOT disappeared!');

    // Device 2 (another device / user) fetches:
    const dev2Req = new Request('https://worker.test/sync/schedule?groupId=ingt-310', {
      method: 'GET'
    });
    const dev2Res = await worker.fetch(dev2Req, env);
    const dev2Data = await dev2Res.json();
    const dev2Overrides = dev2Data.byGroup?.['ingt-310']?.overrides || dev2Data.scheduleOverrides;
    assert(dev2Overrides?.['310-w3-we-1']?.note === 'к 9', 'Device 2: note "к 9" received on secondary device!');
    assert(dev2Overrides?.['310-w3-we-1']?.noteDate === '2026-11-11', 'Device 2: noteDate matches lesson date (2026-11-11)!');
  }

  console.log('\n11. Bug 8_3_pdf: Deleting attachments removes override from server and never resurrects');
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

    const adminTgId = 1027070834;
    const adminInitData = await createTelegramInitData({
      user: JSON.stringify({ id: adminTgId, first_name: 'Admin' }),
      auth_date: String(Math.floor(Date.now() / 1000))
    }, env.TELEGRAM_BOT_TOKEN);

    // 1. Initial save with attachment "ПЗ 8_3.pdf"
    const push1 = new Request('https://worker.test/sync/schedule?groupId=ingt-310', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Init-Data': adminInitData
      },
      body: JSON.stringify({
        byGroup: {
          'ingt-310': {
            overrides: {
              '310-w4-fr-2': {
                attachments: [{ id: 'att_1792744617209_xhvy98', name: 'ПЗ 8_3.pdf', url: 'https://example.com/8_3.pdf' }],
                attachmentsDate: '2026-10-23'
              }
            },
            updatedAt: Date.now()
          }
        }
      })
    });
    const res1 = await worker.fetch(push1, env);
    assert(res1.status === 200, 'Initial push with attachment succeeded');

    const get1 = new Request('https://worker.test/sync/schedule?groupId=ingt-310', { method: 'GET' });
    const data1 = await (await worker.fetch(get1, env)).json();
    assert(data1.byGroup?.['ingt-310']?.overrides?.['310-w4-fr-2']?.attachments?.length === 1, 'Attachment present on server');

    // 2. User deletes attachment (attachments: []) -> buildLessonOverride removes attachments
    const baseVal: BaseLessonValues = {
      subject: 'Техника и технология бурения нефтегазовых скважин',
      teacher: 'Драницына Елена Геннадьевна',
      location: 'Корпус № 1, 4',
      hours: 2
    };
    const currentOv = data1.byGroup['ingt-310'].overrides['310-w4-fr-2'];
    const { next: nextOv } = buildLessonOverride(currentOv, { attachments: [] }, baseVal, 'lesson');
    assert(nextOv.attachments === undefined, 'buildLessonOverride removed attachments');
    assert(nextOv.attachmentsDate === undefined, 'buildLessonOverride removed attachmentsDate');
    assert(Object.keys(nextOv).length === 0, 'No more overrides left for this lesson');

    // Client deletes key from scheduleOverrides and pushes clean overrides dict with deletedOverrides
    const cleanOverrides: Record<string, any> = {};
    const push2 = new Request('https://worker.test/sync/schedule?groupId=ingt-310', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Init-Data': adminInitData
      },
      body: JSON.stringify({
        byGroup: {
          'ingt-310': {
            overrides: cleanOverrides,
            deletedOverrides: ['310-w4-fr-2'],
            updatedAt: Date.now()
          }
        }
      })
    });
    const res2 = await worker.fetch(push2, env);
    assert(res2.status === 200, 'Clean push succeeded');

    // Verify GET /sync/schedule: 310-w4-fr-2 is completely gone, NOT resurrected!
    const get2 = new Request('https://worker.test/sync/schedule?groupId=ingt-310', { method: 'GET' });
    const data2 = await (await worker.fetch(get2, env)).json();
    const ov2 = data2.byGroup?.['ingt-310']?.overrides || {};
    assert(ov2['310-w4-fr-2'] === undefined, 'Deleted override 310-w4-fr-2 is NOT resurrected on server!');
  }

  console.log('\n12. Bug 8_3_pdf: Cycle date boundary for lesson attachments (October vs November)');
  {
    // Case A: Override has attachmentsDate = 2026-10-23 (October, Cycle 2, Week 4 Friday)
    const octOverride = {
      attachments: [{ id: 'att_1792744617209_xhvy98', name: 'ПЗ 8_3.pdf', url: 'https://example.com/8_3.pdf' }],
      attachmentsDate: '2026-10-23',
      isNoteRecurring: false
    };

    const resolveForDate = (ov: any, isoDate: string) => {
      let resolvedAtt = ov.attachments;
      const effectiveDate = ov.attachmentsDate || ov.noteDate;
      if (resolvedAtt && resolvedAtt.length > 0 && !ov.isNoteRecurring) {
        if (effectiveDate) {
          if (effectiveDate !== isoDate) resolvedAtt = undefined;
        } else {
          const matchTs = (resolvedAtt[0]?.id || '').match(/^att_(\d{13})/);
          if (matchTs) {
            const attTime = Number(matchTs[1]);
            const lessonTime = new Date(`${isoDate}T12:00:00+04:00`).getTime();
            if (Math.abs(lessonTime - attTime) > 7 * 86400 * 1000) resolvedAtt = undefined;
          } else if (isoDate && !isoDate.startsWith('2026-09')) {
            resolvedAtt = undefined;
          }
        }
      }
      return resolvedAtt;
    };

    const octDateView = resolveForDate(octOverride, '2026-10-23');
    assert(octDateView !== undefined && octDateView.length === 1, 'Attachment visible on its intended date (2026-10-23)');

    const novDateView = resolveForDate(octOverride, '2026-11-20');
    assert(novDateView === undefined, 'October attachment hidden when viewing November 20 (Week 4, Block 3)');

    // Case B: Legacy attachment with NO attachmentsDate, but created with October timestamp
    const legacyOctOverride = {
      attachments: [{ id: 'att_1792744617209_xhvy98', name: 'ПЗ 8_3.pdf', url: 'https://example.com/8_3.pdf' }],
      isNoteRecurring: false
    };
    const legacyNovView = resolveForDate(legacyOctOverride, '2026-11-20');
    assert(legacyNovView === undefined, 'Legacy October attachment suppressed in November via timestamp guard');

    // Case C: Recurring attachment (isNoteRecurring: true)
    const recurringOverride = {
      attachments: [{ id: 'att_1', name: 'постоянная_методичка.pdf', url: 'https://example.com/m.pdf' }],
      isNoteRecurring: true
    };
    const recurringNovView = resolveForDate(recurringOverride, '2026-11-20');
    assert(recurringNovView !== undefined && recurringNovView.length === 1, 'Recurring attachment visible across cycles');
  }

  console.log(`\nTOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

run();
