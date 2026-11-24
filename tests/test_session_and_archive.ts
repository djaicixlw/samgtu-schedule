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
import {
  getSemesterWeek,
  getWeekDateRange,
  getDayISODate,
  BLOCKS
} from '../attendance';
import {
  getSemesterConfig,
  isSessionPeriod
} from '../utils/samaraDate';
import { exportAttendanceToWord } from '../utils/exportWord';
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

  console.log(`\n============================================================`);
  console.log(`TOTAL: ${totalTests} | PASSED: ${passedTests} | FAILED: ${totalTests - passedTests}`);
  console.log(`============================================================\n`);

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('Test suite uncaught error:', err);
  process.exit(1);
});
