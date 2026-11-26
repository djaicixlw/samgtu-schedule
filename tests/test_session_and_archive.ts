import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getBlockWindowForDate,
  getArchiveCandidateUrls,
  loadBlockScheduleForDate,
  clearArchiveCache
} from '../utils/scheduleLoader';
import { preloadAllSchedulesSync } from '../utils/scheduleNodeLoader';
preloadAllSchedulesSync();
import {
  getSemesterWeek,
  getWeekDateRange,
  getDayISODate,
  BLOCKS
} from '../attendance';
import {
  getSemesterConfig,
  setSemesterConfig,
  isSessionPeriod
} from '../utils/samaraDate';
import { exportAttendanceToWord, formatSemesterPrepositional } from '../utils/exportWord';
import { resolveAbsenceDateISO } from '../components/MyAbsencesModal';
import { buildSemesterMatrixPeriods } from '../components/AttendanceMatrix';
import { fetchMyAttendanceV3 } from '../utils/attendanceStorage';
import { fetchGroupCloudData, saveLocalExams, getSavedExams } from '../utils/cloudSync';
import worker, { createStaffToken, WORKER_VERSION } from '../cloudflare-worker.js';
import { createTelegramInitData } from './worker_test_helpers';
import { ExamItem, Student, GroupConfig } from '../types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

let totalTests = 0;
let passedTests = 0;

function check(desc: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    const res = fn();
    if (res instanceof Promise) {
      return res.then(() => {
        passedTests++;
        console.log(`  ✓ [PASS] ${desc}`);
      }).catch(err => {
        console.error(`  ✗ [FAIL] ${desc}`);
        console.error(err);
        process.exitCode = 1;
      });
    } else {
      passedTests++;
      console.log(`  ✓ [PASS] ${desc}`);
    }
  } catch (err) {
    console.error(`  ✗ [FAIL] ${desc}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function runSuite() {
  console.log('=== TEST SUITE: STAGE 3 — ARCHIVE RESOLUTION, 17th WEEK, EXAM SESSION & WORKER SYNC ===\n');

  // ============================================================
  // 1. ARCHIVE RESOLUTION & BLOCK WINDOWS
  // ============================================================
  console.log('--- 1. Archive Resolution & Block Windows ---');

  check('getBlockWindowForDate maps dates to correct block windows', () => {
    const b1 = getBlockWindowForDate('2026-09-15');
    assert.strictEqual(b1.start, 1);
    assert.strictEqual(b1.end, 4);

    const b2 = getBlockWindowForDate('2026-10-15');
    assert.strictEqual(b2.start, 5);
    assert.strictEqual(b2.end, 8);

    const b3 = getBlockWindowForDate('2026-11-10');
    assert.strictEqual(b3.start, 9);
    assert.strictEqual(b3.end, 12);

    const b4 = getBlockWindowForDate('2026-11-25');
    assert.strictEqual(b4.start, 13);
    assert.strictEqual(b4.end, 16);

    // 17th week of December also maps to block 4 (weeks 13..16)
    const b4Dec = getBlockWindowForDate('2026-12-25');
    assert.strictEqual(b4Dec.start, 13);
    assert.strictEqual(b4Dec.end, 16);
  });

  check('getArchiveCandidateUrls builds correct paths for block-from-week-9 and block-from-week-5', () => {
    const urls9 = getArchiveCandidateUrls('ingt-110', 9);
    assert(urls9.some(u => u.includes('block-from-week-9/ingt-110.json')), 'Must include block-from-week-9');

    const urls5 = getArchiveCandidateUrls('ingt-110', 5);
    assert(urls5.some(u => u.includes('block-from-week-5/ingt-110.json')), 'Must include block-from-week-5');
  });

  await check('loadBlockScheduleForDate loads Block 3 archive (block-from-week-9)', async () => {
    clearArchiveCache();
    const schedule = await loadBlockScheduleForDate('ingt-110', '2026-11-10');
    assert(schedule, 'Schedule must be loaded for Block 3');
    assert(schedule[1] && schedule[1].length > 0, 'Week 1 must contain days in Block 3 schedule');
  });

  await check('loadBlockScheduleForDate loads Block 2 archive (block-from-week-5)', async () => {
    clearArchiveCache();
    const schedule = await loadBlockScheduleForDate('ingt-110', '2026-10-15');
    assert(schedule, 'Schedule must be loaded for Block 2');
    assert(schedule[1] && schedule[1].length > 0, 'Week 1 must contain days in Block 2 schedule');
  });

  await check('loadBlockScheduleForDate falls back gracefully for Block 1 (no throw)', async () => {
    clearArchiveCache();
    const schedule = await loadBlockScheduleForDate('ingt-110', '2026-09-10');
    assert(schedule, 'Schedule must fall back gracefully for Block 1');
  });

  await check('loadBlockScheduleForDate normalizes Cyrillic group alias', async () => {
    clearArchiveCache();
    const schedule = await loadBlockScheduleForDate('3-ИНГТ-110', '2026-11-10');
    assert(schedule, 'Cyrillic group alias must resolve correctly to Block 3 archive');
  });

  await check('Block 3 archive for ingt-310 differs from Block 2 and Block 4 (real Block 3 snapshot)', async () => {
    clearArchiveCache();
    const b2 = await loadBlockScheduleForDate('ingt-310', '2026-10-15');
    const b3 = await loadBlockScheduleForDate('ingt-310', '2026-11-10');
    const b4 = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/schedules/ingt-310.json'), 'utf-8'));
    assert(b2 && b3 && b4, 'All blocks for ingt-310 must load');
    assert.notStrictEqual(JSON.stringify(b3), JSON.stringify(b4), 'Block 3 archive must NOT be a copy of Block 4');
    assert.notStrictEqual(JSON.stringify(b3), JSON.stringify(b2), 'Block 3 archive must NOT be a copy of Block 2');
    const collectSubjects = (sched: any) => {
      const s = new Set<string>();
      for (const days of Object.values(sched) as any[]) {
        for (const d of days || []) for (const l of d.lessons || []) s.add(l.subject);
      }
      return s;
    };
    const b3Subjects = collectSubjects(b3);
    const b4Subjects = collectSubjects(b4);
    assert(
      b3Subjects.has('Актуальные вопросы профессиональной деятельности и построение карьеры'),
      'Block 3 ingt-310 archive must retain Block 3 subject'
    );
    assert(
      !b4Subjects.has('Актуальные вопросы профессиональной деятельности и построение карьеры'),
      'Block 4 ingt-310 schedule does not contain Block 3-only subject'
    );
  });

  check('AttendanceMatrix guards handleCellToggle with isSessionPeriod and excludes 2027-01', () => {
    const matrixSrc = fs.readFileSync(path.join(ROOT, 'components/AttendanceMatrix.tsx'), 'utf-8');
    assert(matrixSrc.includes('isSessionPeriod(dayISO)'), 'AttendanceMatrix must guard marking with isSessionPeriod(dayISO)');
    assert(!matrixSrc.includes("id: '2027-01'"), 'AttendanceMatrix SEMESTER_MONTHS must not allow January 2027 marking');
  });

  // ============================================================
  // 2. 17th WEEK OF DECEMBER & SEMESTER CONFIG
  // ============================================================
  console.log('\n--- 2. 17th Week of December & Semester Bounds ---');

  check('2026-12-25 maps to cycle week 1 and December date range', () => {
    const cycleWeek = getSemesterWeek('2026-12-25');
    assert.strictEqual(cycleWeek, 1, '2026-12-25 should be cycle week 1');

    const dateRange = getWeekDateRange(1, '2026-12-25');
    assert.strictEqual(dateRange, '21 дек - 26 дек', 'Week 1 on 2026-12-25 must show December dates');

    const fridayDate = getDayISODate('Пятница', 1, '2026-12-25');
    assert.strictEqual(fridayDate, '2026-12-25', 'Friday in cycle week 1 for 2026-12-25 must be 2026-12-25');
  });

  check('Dynamic BLOCKS proxy in attendance.ts reads getSemesterConfig', () => {
    assert.strictEqual(BLOCKS.length, 4, 'Should have 4 blocks');
    assert(BLOCKS[0].name.startsWith('Блок 1'), 'Block 1 name');
    assert.strictEqual(BLOCKS[3].weeks, '13-16', 'Block 4 weeks');
  });

  check('isSessionPeriod identifies session dates correctly', () => {
    assert.strictEqual(isSessionPeriod('2026-12-25'), false, '2026-12-25 is still semester classes, not session');
    assert.strictEqual(isSessionPeriod('2027-01-15'), true, '2027-01-15 is January winter session');
    assert.strictEqual(isSessionPeriod('2027-06-15'), true, '2027-06-15 is June summer session');
  });

  // ============================================================
  // 3. WORD EXPORT SEMESTER BOUNDS FILTERING
  // ============================================================
  console.log('\n--- 3. Word Export Semester Bounds Filtering ---');

  await check('exportAttendanceToWord excludes January session records from Autumn semester export', async () => {
    const sampleStudents: Student[] = [
      { id: 'st-1', name: 'Иванов Иван Иванович', isStarosta: true },
      { id: 'st-2', name: 'Петров Петр Петрович' }
    ];

    const groupConfig: GroupConfig = {
      id: 'ingt-110',
      name: '3-ИНГТ-110',
      faculty: 'ИНГТ',
      course: 3
    };

    const recordsWithJanuary: Record<string, any> = {
      // In semester
      'ingt-110-2026-10-15-p1': {
        lessonId: 'ingt-110-w2-thu-1',
        date: '2026-10-15',
        pairNumber: 1,
        absentStudents: ['st-1'],
        excusedStudents: []
      },
      // In semester (December 17th week)
      'ingt-110-2026-12-25-p1': {
        lessonId: 'ingt-110-w1-fri-1',
        date: '2026-12-25',
        pairNumber: 1,
        absentStudents: ['st-2'],
        excusedStudents: []
      },
      // OUT OF SEMESTER (January session record that must be filtered out)
      'ingt-110-2027-01-15-p1': {
        lessonId: 'ingt-110-w3-fri-1',
        date: '2027-01-15',
        pairNumber: 1,
        absentStudents: ['st-1', 'st-2'],
        excusedStudents: []
      }
    };

    const res = await exportAttendanceToWord(
      recordsWithJanuary,
      sampleStudents,
      groupConfig,
      'Институт нефтегазовых технологий'
    );
    assert.strictEqual(res.success, true, 'exportAttendanceToWord must succeed');
  });

  // ============================================================
  // 4. CLOUDFLARE WORKER EXAM SYNC & PERMISSIONS
  // ============================================================
  console.log('\n--- 4. Cloudflare Worker Exam Sync & Permissions ---');

  const kvStore = new Map<string, string>();
  const mockAppData = {
    get: async (k: string) => kvStore.get(k) || null,
    put: async (k: string, v: string, _opts?: any) => { kvStore.set(k, v); },
    delete: async (k: string) => { kvStore.delete(k); }
  };

  const TEST_BOT_TOKEN = 'mock_bot_token_session_test';
  const TEST_PEPPER = 'mock_pepper_session_test_32bytes!';
  const mockEnv = {
    TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN,
    ID_PEPPER: TEST_PEPPER,
    APP_DATA: mockAppData
  };

  await check('Worker health check returns version 2026-11-23-stage3', async () => {
    assert.strictEqual(WORKER_VERSION, '2026-11-23-stage3');
    const req = new Request('https://worker.test/health', { method: 'GET' });
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 200);
    const data = await res.json() as any;
    assert.strictEqual(data.workerVersion, '2026-11-23-stage3');
  });

  await check('PUT /sync/schedule rejects unauthenticated requests with 401', async () => {
    const req = new Request('https://worker.test/sync/schedule?groupId=ingt-110', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ byGroup: { 'ingt-110': { exams: [] } } })
    });
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 401);
  });

  await check('PUT /sync/schedule rejects student token with 403', async () => {
    const studentToken = await createStaffToken(TEST_PEPPER, { gid: 'ingt-110', role: 'student', exp: Date.now() + 86400000 });
    const req = new Request('https://worker.test/sync/schedule?groupId=ingt-110', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Staff-Token': studentToken
      },
      body: JSON.stringify({ byGroup: { 'ingt-110': { exams: [] } } })
    });
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 403);
  });

  await check('PUT /sync/schedule allows starosta token to save exams and overrides', async () => {
    const starostaToken = await createStaffToken(TEST_PEPPER, { gid: 'ingt-110', role: 'starosta', exp: Date.now() + 86400000 });

    // 1. Initial push with scheduleOverrides
    const pushOverridesReq = new Request('https://worker.test/sync/schedule?groupId=ingt-110', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Staff-Token': starostaToken
      },
      body: JSON.stringify({
        byGroup: {
          'ingt-110': {
            overrides: {
              'ingt-110-w1-mon-1': { teacher: 'Проф. Тестов Т.Т.', note: 'Ауд. 402' }
            },
            updatedAt: Date.now()
          }
        }
      })
    });
    const res1 = await worker.fetch(pushOverridesReq, mockEnv);
    assert.strictEqual(res1.status, 200, 'Push overrides must succeed');

    // 2. Partial push with ONLY exams (no overrides). Verifies overrides are PRESERVED!
    const sampleExams: ExamItem[] = [
      {
        id: 'exam-1',
        date: '2027-01-12',
        time: '09:00',
        subject: 'Бурение нефтяных и газовых скважин',
        type: 'Экзамен',
        location: 'Корпус 1, ауд. 301',
        teacher: 'Драницына Е.Г.',
        updatedAt: Date.now()
      },
      {
        id: 'exam-2',
        date: '2027-01-18',
        time: '11:00',
        subject: 'Физика горных пород',
        type: 'Консультация',
        location: 'Корпус 2, ауд. 105',
        updatedAt: Date.now()
      }
    ];

    const pushExamsReq = new Request('https://worker.test/sync/schedule?groupId=ingt-110', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Staff-Token': starostaToken
      },
      body: JSON.stringify({
        byGroup: {
          'ingt-110': {
            exams: sampleExams,
            updatedAt: Date.now()
          }
        }
      })
    });
    const res2 = await worker.fetch(pushExamsReq, mockEnv);
    assert.strictEqual(res2.status, 200, 'Push exams must succeed');

    // Verify KV state: overrides are still present AND exams are saved
    const rawSaved = kvStore.get('schedule:ingt-110');
    assert(rawSaved, 'schedule:ingt-110 must be in KV');
    const savedData = JSON.parse(rawSaved);
    assert(savedData.overrides && savedData.overrides['ingt-110-w1-mon-1'], 'Overrides must be preserved after exams push');
    assert(Array.isArray(savedData.exams) && savedData.exams.length === 2, 'Exams must be saved in KV');
    assert.strictEqual(savedData.exams[0].subject, 'Бурение нефтяных и газовых скважин');

    // 3. Tombstone test: delete exam-1 via deletedExamIds
    const deleteExamReq = new Request('https://worker.test/sync/schedule?groupId=ingt-110', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Staff-Token': starostaToken
      },
      body: JSON.stringify({
        byGroup: {
          'ingt-110': {
            exams: [sampleExams[1]], // only exam-2
            deletedExamIds: ['exam-1'],
            updatedAt: Date.now()
          }
        }
      })
    });
    const res3 = await worker.fetch(deleteExamReq, mockEnv);
    assert.strictEqual(res3.status, 200, 'Delete exam must succeed');

    const rawAfterDel = kvStore.get('schedule:ingt-110');
    const dataAfterDel = JSON.parse(rawAfterDel!);
    assert.strictEqual(dataAfterDel.exams.length, 1, 'Only 1 exam should remain after deletion');
    assert.strictEqual(dataAfterDel.exams[0].id, 'exam-2', 'Remaining exam must be exam-2');
    assert(dataAfterDel.deletedExamIds && (dataAfterDel.deletedExamIds['exam-1'] || (Array.isArray(dataAfterDel.deletedExamIds) && dataAfterDel.deletedExamIds.includes('exam-1'))), 'Tombstone must be recorded');
  });

  // ============================================================
  // 5. PRE-SESSION REHEARSAL & SPRING ROLLOVER REGRESSIONS
  // ============================================================
  console.log('\n--- 5. Pre-Session Rehearsal & Spring Rollover Regressions ---');

  check('MyAbsencesModal resolves autumn MM-DD marks to previous year during Jan session', () => {
    assert.strictEqual(resolveAbsenceDateISO('10-15', '2027-01-15'), '2026-10-15');
    assert.strictEqual(resolveAbsenceDateISO('03-15', '2027-04-10'), '2027-03-15');
  });

  check('Word export formats semester name in prepositional case', () => {
    assert.strictEqual(
      formatSemesterPrepositional('Осенний семестр 2026/2027'),
      'осеннем семестре 2026/2027 уч. г.'
    );
    assert.strictEqual(
      formatSemesterPrepositional('Весенний семестр 2026/2027'),
      'весеннем семестре 2026/2027 уч. г.'
    );
  });

  await check('fetchMyAttendanceV3 in Jan queries Dec first (1 req if unlinked) and merges Aug-Nov if linked', async () => {
    const origNow = Date.now;
    const origFetch = globalThis.fetch;
    const calls: string[] = [];
    let linkedState = false;
    Date.now = () => Date.UTC(2027, 0, 15, 10, 0, 0);
    (globalThis as any).fetch = async (input: any) => {
      const urlStr = typeof input === 'string' ? input : input.url;
      calls.push(urlStr);
      const u = new URL(urlStr);
      const m = u.searchParams.get('month') || '';
      if (!linkedState) {
        return new Response(JSON.stringify({ ok: true, linked: false }), { status: 200 });
      }
      const marks = m === '2026-10' ? { '10-15.1': 'u' } : m === '2026-12' ? { '12-03.2': 'e' } : {};
      const cancelled = m === '2026-11' ? ['11-05.3'] : [];
      return new Response(JSON.stringify({ ok: true, linked: true, gid: 'ingt-310', slot: 'SLOT01', marks, cancelled }), { status: 200 });
    };
    try {
      const unlinkedRes = await fetchMyAttendanceV3();
      assert.strictEqual(unlinkedRes.ok, true);
      assert.strictEqual(unlinkedRes.linked, false);
      assert.strictEqual(calls.length, 1, `Unlinked student in Jan must make only 1 request (got ${calls.length})`);
      assert(calls[0].includes('month=2026-12'), 'First January /v3/me call must probe 2026-12');

      calls.length = 0;
      linkedState = true;
      const linkedRes = await fetchMyAttendanceV3();
      assert.strictEqual(linkedRes.ok, true);
      assert.strictEqual(linkedRes.linked, true);
      assert.strictEqual(calls.length, 5, `Linked student in Jan must query 2026-08..2026-12 (got ${calls.length})`);
      assert.strictEqual(linkedRes.marks?.['10-15.1'], 'u');
      assert.strictEqual(linkedRes.marks?.['12-03.2'], 'e');
      assert(linkedRes.cancelled?.includes('11-05.3'), 'Merged cancelled keys must include 2026-11');
    } finally {
      Date.now = origNow;
      globalThis.fetch = origFetch;
    }
  });

  await check('fetchGroupCloudData wipes zombie last exam on exams:[] while respecting exams_dirty_', async () => {
    const origFetch = globalThis.fetch;
    const origLS = (globalThis as any).localStorage;
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
      get length() { return store.size; },
      key: (i: number) => Array.from(store.keys())[i] ?? null
    };
    (globalThis as any).fetch = async (input: any) => {
      const urlStr = typeof input === 'string' ? input : input.url;
      if (urlStr.includes('/sync/schedule')) {
        return new Response(JSON.stringify({
          byGroup: {
            'ingt-310': {
              overrides: {},
              teachers: {},
              exams: [],
              deletedExamIds: { 'ex-zombie': Date.now() },
              ver: 10
            }
          }
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ byGroup: { 'ingt-310': { items: [], deletedIds: [] } } }), { status: 200 });
    };
    try {
      saveLocalExams('ingt-310', [{
        id: 'ex-zombie',
        date: '2027-01-12',
        time: '09:00',
        subject: 'Зомби-экзамен',
        type: 'Экзамен',
        location: '101'
      }]);
      const resClean = await fetchGroupCloudData(true, 'ingt-310');
      assert.strictEqual(resClean?.exams?.length, 0, 'Zombie last exam must be cleared when server returns exams: []');
      assert.strictEqual(getSavedExams('ingt-310').length, 0, 'localStorage exams_ingt-310 must be cleared');

      // Now verify offline dirty exam is preserved while exams_dirty_ is set
      saveLocalExams('ingt-310', [{
        id: 'ex-local',
        date: '2027-01-20',
        time: '10:00',
        subject: 'Офлайн экзамен',
        type: 'Зачёт',
        location: '202'
      }]);
      store.set('exams_dirty_ingt-310', 'true');
      const resDirty = await fetchGroupCloudData(true, 'ingt-310');
      assert.strictEqual(resDirty?.exams?.length, 1, 'Pending local exam must be preserved when exams_dirty_ is true');
      assert.strictEqual(resDirty?.exams?.[0]?.id, 'ex-local');
    } finally {
      globalThis.fetch = origFetch;
      (globalThis as any).localStorage = origLS;
    }
  });

  await check('AttendanceMatrix periods include Dec 21-31 & Spring 2027, and Spring future dates skip Autumn archives', async () => {
    const origConfig = getSemesterConfig();
    const origNow = Date.now;
    try {
      const autumnPeriods = buildSemesterMatrixPeriods(origConfig);
      assert(autumnPeriods.some(p => p.id === '2026-12-tail' && p.weeks.join(',') === '1,2'), 'Autumn periods must include Dec 21-31 tail');

      const springConfig = {
        semesterName: 'Весенний семестр 2026/2027',
        semesterStart: '2027-02-08',
        cycleWeeks: 4,
        sessionStart: '2027-06-01',
        sessionEnd: '2027-06-30',
        blocks: [
          { id: 1, name: 'Блок 1', start: '2027-02-08', end: '2027-03-07' },
          { id: 2, name: 'Блок 2', start: '2027-03-08', end: '2027-04-04' },
          { id: 3, name: 'Блок 3', start: '2027-04-05', end: '2027-05-02' },
          { id: 4, name: 'Блок 4', start: '2027-05-03', end: '2027-05-30' }
        ]
      };
      const springPeriods = buildSemesterMatrixPeriods(springConfig);
      assert.strictEqual(springPeriods.map(p => p.id).join(','), '2027-02,2027-03,2027-04,2027-05', 'Spring periods must cover Feb-May');

      setSemesterConfig(springConfig);
      Date.now = () => Date.UTC(2027, 1, 10, 10, 0, 0); // 2027-02-10
      clearArchiveCache();
      const futureSpringInfo = getBlockWindowForDate('2027-03-15', springConfig);
      assert.strictEqual(futureSpringInfo.isPastSemesterBlock, false, 'Future Spring block must not be marked as past archive');
      const futureSpringSched = await loadBlockScheduleForDate('ingt-310', '2027-03-15');
      const collect = (sched: any) => {
        const s = new Set<string>();
        for (const days of Object.values(sched || {}) as any[]) {
          for (const d of days || []) for (const l of d.lessons || []) s.add(l.subject);
        }
        return s;
      };
      assert(
        !collect(futureSpringSched).has('Актуальные вопросы профессиональной деятельности и построение карьеры'),
        'Future Spring date must NOT load stale Autumn block-from-week-5/9 archive'
      );
    } finally {
      Date.now = origNow;
      setSemesterConfig(origConfig);
      clearArchiveCache();
    }
  });

  console.log(`\n============================================================`);
  console.log(`TOTAL: ${totalTests} | PASSED: ${passedTests} | FAILED: ${totalTests - passedTests}`);
  console.log(`============================================================\n`);

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

await runSuite().catch(err => {
  console.error('Test suite uncaught error:', err);
  process.exit(1);
});
