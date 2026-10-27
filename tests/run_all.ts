/**
 * Honest sequential test runner (replaces the console-regex-only runner, AUD-007).
 *
 * Why this exists: the old runner counted failure markers in console output and
 * trusted the final process.exitCode. That had three blind spots:
 *   1. Some suites signal failure via `>>> BUG:` markers that the old regex missed.
 *   2. Many suites call process.exit(1) directly, aborting the whole run on the
 *      first failure (every suite after it silently never ran).
 *   3. Suites that print nothing at all (no failure AND no success signal) were
 *      reported as "passed" by silence.
 *
 * What this runner does:
 *   - Runs every suite inside try/catch; a thrown error marks the suite FAILED.
 *   - Resets Cloudflare Worker rate limiters (__resetRateLimiters()) before each suite.
 *   - Intercepts process.exit during a suite: exit(0) = PASS, exit(n!=0) = FAILED
 *     (the run itself continues to the next suite).
 *   - Captures process.exitCode per suite (reset before each suite).
 *   - Watches console output with an explicit vocabulary:
 *       failure markers: /❌|\[FAIL\]|✗ FAIL|>>> BUG/  or  /FAILED:\s*(\d+)/ with n>0
 *       success markers: /✓|✅|\[PASS\]|PASS:|PASSED|\bpassed\b|SUCCESS/
 *     A suite with no failure signal and no success signal is UNKNOWN, and UNKNOWN
 *     fails the run (silence is not success).
 *   - Attributes unhandledRejection / uncaughtException to the running suite.
 *   - Detects orphan suites: tests/*.ts files that are neither in the manifest
 *     nor in NON_SUITE.
 *
 * Usage:
 *   npx tsx tests/run_all.ts                    # full run
 *   npx tsx tests/run_all.ts --filter=homework  # only suites matching substring
 *   npx tsx tests/run_all.ts --list             # print manifest + orphans, don't run
 *   npx tsx tests/run_all.ts --strict-orphans   # orphans fail the run
 *   npx tsx tests/run_all.ts --quiet            # suppress suite output, print statuses only
 */
import './setup_mock_auth';
import { preloadAllSchedulesSync } from '../utils/scheduleNodeLoader';
import { __resetRateLimiters } from '../cloudflare-worker.js';
preloadAllSchedulesSync();

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

type Suite = {
  name: string;
  load: () => Promise<any>;
  /** Optional exported function to call after import (suites that don't self-invoke). */
  call?: string;
};

const MANIFEST: Suite[] = [
  // 50 базовых сьютов
  { name: 'test_ondemand_schedules', load: () => import('./test_ondemand_schedules') },
  { name: 'test_dates', load: () => import('./test_dates') },
  { name: 'test_attendance', load: () => import('./test_attendance') },
  { name: 'test_schedule_sync', load: () => import('./test_schedule_sync') },
  { name: 'test_homework', load: () => import('./test_homework') },
  { name: 'test_telegram_webapp', load: () => import('./test_telegram_webapp') },
  { name: 'test_samgtu_parser', load: () => import('./test_samgtu_parser') },
  { name: 'test_faid_schedule', load: () => import('./test_faid_schedule') },
  { name: 'test_faid_attendance', load: () => import('./test_faid_attendance') },
  { name: 'verify_student_ux', load: () => import('./verify_student_ux') },
  { name: 'test_ingt209_schedule', load: () => import('./test_ingt209_schedule') },
  { name: 'test_qa_ingt209_verification', load: () => import('./test_qa_ingt209_verification') },
  { name: 'test_bugreport_feature', load: () => import('./test_bugreport_feature') },
  { name: 'test_logger_diagnostics', load: () => import('./test_logger_diagnostics') },
  { name: 'test_telemetry', load: () => import('./test_telemetry') },
  { name: 'test_cancellation_and_privacy', load: () => import('./test_cancellation_and_privacy') },
  { name: 'test_security_audit', load: () => import('./test_security_audit') },
  { name: 'test_auth_hashes', load: () => import('./test_auth_hashes') },
  { name: 'test_initdata_auth', load: () => import('./test_initdata_auth') },
  { name: 'test_api_v3', load: () => import('./test_api_v3') },
  { name: 'test_attendance_storage', load: () => import('./test_attendance_storage') },
  { name: 'test_group_dedup_and_ingt3', load: () => import('./test_group_dedup_and_ingt3') },
  { name: 'test_roster_cloud_sync', load: () => import('./test_roster_cloud_sync') },
  { name: 'test_roster_provider', load: () => import('./test_roster_provider') },
  { name: 'test_attendance_word_export_verification', load: () => import('./test_attendance_word_export_verification') },
  { name: 'test_tma_resilience_e2e', load: () => import('./test_tma_resilience_e2e') },
  { name: 'test_sunday_week_rollover_regression', load: () => import('./test_sunday_week_rollover_regression') },
  { name: 'test_semester_preload', load: () => import('./test_semester_preload') },
  { name: 'test_audit_deep', load: () => import('./test_audit_deep') },
  { name: 'test_sanitization', load: () => import('./test_sanitization') },
  { name: 'test_schedule_url', load: () => import('./test_schedule_url') },
  { name: 'test_kv_backup', load: () => import('./test_kv_backup') },
  { name: 'test_privacy_p0', load: () => import('./test_privacy_p0') },
  { name: 'test_bell_schedule', load: () => import('./test_bell_schedule') },
  { name: 'test_attendance_merge', load: () => import('./test_attendance_merge') },
  { name: 'test_tma_word_export', load: () => import('./test_tma_word_export') },
  { name: 'test_friday_pair4_verification', load: () => import('./test_friday_pair4_verification') },
  { name: 'test_block_a_ux', load: () => import('./test_block_a_ux') },
  { name: 'test_useful_tracker', load: () => import('./test_useful_tracker') },
  { name: 'test_attendance_matrix', load: () => import('./test_attendance_matrix') },
  { name: 'test_multidevice_attendance_sync', load: () => import('./test_multidevice_attendance_sync') },
  { name: 'test_lesson_materials', load: () => import('./test_lesson_materials'), call: 'runLessonMaterialsTests' },
  { name: 'test_homework_lifecycle_stress', load: () => import('./test_homework_lifecycle_stress'), call: 'runHomeworkLifecycleStressTest' },
  { name: 'test_stage2_schedule_filters', load: () => import('./test_stage2_schedule_filters') },
  { name: 'test_stage3_group_roster_archive', load: () => import('./test_stage3_group_roster_archive') },
  { name: 'test_stage1_ui_and_double_hours', load: () => import('./test_stage1_ui_and_double_hours') },
  { name: 'test_absences_notes_paste_dnd', load: () => import('./test_absences_notes_paste_dnd') },
  { name: 'test_p0_regressions', load: () => import('./test_p0_regressions') },
  { name: 'test_real_user_emulation', load: () => import('./test_real_user_emulation') },
  { name: 'test_group_id', load: () => import('./test_group_id') },
  { name: 'test_group_migration', load: () => import('./test_group_migration') },

  // 16 новых сьютов из review/glm (Фазы 1-3)
  { name: 'test_concurrent_att_sync', load: () => import('./test_concurrent_att_sync') },
  { name: 'test_sync_union_merge', load: () => import('./test_sync_union_merge') },
  { name: 'test_aud004_stale_snapshot', load: () => import('./test_aud004_stale_snapshot') },
  { name: 'test_aud006_semester', load: () => import('./test_aud006_semester') },
  { name: 'test_aud012_homework_merge', load: () => import('./test_aud012_homework_merge') },
  { name: 'test_worker_secrets', load: () => import('./test_worker_secrets') },
  { name: 'test_cache_headers', load: () => import('./test_cache_headers') },
  { name: 'test_aud023_cloud_sync_engine', load: () => import('./test_aud023_cloud_sync_engine') },
  { name: 'test_delete_my_data', load: () => import('./test_delete_my_data') },
  { name: 'test_aud027_group_canon', load: () => import('./test_aud027_group_canon') },
  { name: 'test_aud031_render_perf', load: () => import('./test_aud031_render_perf') },
  { name: 'test_aud033_nightly_guard', load: () => import('./test_aud033_nightly_guard') },
  { name: 'test_aud034_group_chunks', load: () => import('./test_aud034_group_chunks') },
  { name: 'test_aud037_safe_storage', load: () => import('./test_aud037_safe_storage') },
  { name: 'test_aud041_online_status', load: () => import('./test_aud041_online_status') },
  { name: 'test_aud042_kv_backup', load: () => import('./test_aud042_kv_backup') },

  // 5 новых сьютов из review/sonnet_ex
  { name: 'test_attendance_convergence', load: () => import('./test_attendance_convergence') },
  { name: 'test_followup_hardening', load: () => import('./test_followup_hardening') },
  { name: 'test_lesson_overrides', load: () => import('./test_lesson_overrides') },
  { name: 'test_official_week_assembly', load: () => import('./test_official_week_assembly') },
  { name: 'test_useful_suggestions', load: () => import('./test_useful_suggestions') },

  // 4 новых сьюта из review/sonnet_h
  { name: 'test_d1_attendance', load: () => import('./test_d1_attendance') },
  { name: 'test_d1_client', load: () => import('./test_d1_client') },
  { name: 'test_bugfix_oct24', load: () => import('./test_bugfix_oct24') },
  { name: 'test_bot_welcome', load: () => import('./test_bot_welcome') },
];

/** Files in tests/ that are not suites (helpers/fixtures/analysis scripts). */
const NON_SUITE = new Set<string>([
  'run_all.ts',
  'setup_mock_auth.ts',
  'faid_schedule_generated.ts', // fixture data imported by other suites
  'worker_test_helpers.ts',     // AUD-038: initData helper
  'academic_qa_test.ts',
  'analyze_fullcalendar.ts',
  'audit_teachers_all.ts',
  'inspect_lk.ts',
  'subagent_c_audit.ts',
  'test_audit_subagent1.ts',
  'test_bot_parser.ts',
  'test_bug_tz_week.ts',
  'test_dates_unified.ts',
  'test_date_parsing_bug.ts',
  'test_htf215_verification.ts',
  'test_live_audit.ts',
  'test_multidevice_homework_sync.ts',
  'test_real_cloud_sync.ts',
  'test_schedule_cache.ts',
  'test_schedule_schema.ts',
  'test_semester_cycles.ts',
  'test_swipe_gestures.ts',
  'test_tz_boundaries.ts',
  'test_user_html.ts',
]);

/**
 * Known failures (xfail): suites that currently fail for a DOCUMENTED reason.
 * AUD-043 is resolved, so KNOWN_FAILURES is empty.
 */
const KNOWN_FAILURES = new Map<string, string>();

// ---------------------------------------------------------------------------
// Failure/success vocabulary (runtime output classification)
// ---------------------------------------------------------------------------

const FAIL_MARKER_RE = /(❌|\[FAIL\]|✗ FAIL|>>> BUG)/;
const FAILED_COUNT_RE = /FAILED:\s*(\d+)/;
const OK_RE = /(✓|✅|\[PASS\]|PASS:|PASSED|\bpassed\b|SUCCESS)/;

// ---------------------------------------------------------------------------
// Runner state
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string) => argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? '';
const FILTER = opt('filter');
const LIST_ONLY = flag('list');
const STRICT_ORPHANS = flag('strict-orphans');
const QUIET = flag('quiet');

const suites = FILTER ? MANIFEST.filter(s => s.name.includes(FILTER)) : MANIFEST;

type Status = 'PASS' | 'FAILED' | 'UNKNOWN' | 'XFAIL';
type Result = {
  name: string;
  status: Status;
  ms: number;
  reasons: string[];
};

/** Currently running suite; used to attribute async rejections. */
let current: Result | null = null;
let globalReasons: string[] = [];

const __dirnameTests = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Console monitoring (output still passes through untouched)
// ---------------------------------------------------------------------------

const origConsole: Record<'log' | 'warn' | 'error', (...args: any[]) => void> = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

function noteLine(line: string): void {
  if (!current) return;
  const countMatch = line.match(FAILED_COUNT_RE);
  if (countMatch && Number(countMatch[1]) > 0) {
    current.status = 'FAILED';
    current.reasons.push(`${Number(countMatch[1])} failure(s) reported in output`);
    return;
  }
  if (FAIL_MARKER_RE.test(line)) {
    current.status = 'FAILED';
    if (!current.reasons.includes('failure marker in output')) current.reasons.push('failure marker in output');
    return;
  }
  if (OK_RE.test(line) && current.status !== 'FAILED') {
    current.status = 'PASS';
  }
}

for (const level of ['log', 'warn', 'error'] as const) {
  console[level] = (...args: any[]) => {
    try {
      noteLine(args.map(a => (typeof a === 'string' ? a : String(a))).join(' '));
    } catch { /* never break a suite because of monitoring */ }
    if (QUIET) return;
    origConsole[level](...args);
  };
}

// ---------------------------------------------------------------------------
// process.exit interception + async failure attribution
// ---------------------------------------------------------------------------

class ExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const origExit = process.exit.bind(process);

async function main(): Promise<void> {
  process.on('unhandledRejection', reason => {
    const msg = `unhandledRejection: ${reason instanceof Error ? reason.message : String(reason)}`;
    if (current && current.status !== 'FAILED') {
      current.status = 'FAILED';
      current.reasons.push(msg);
    } else if (!current) {
      globalReasons.push(msg);
    }
  });
  process.on('uncaughtException', err => {
    const msg = `uncaughtException: ${err instanceof Error ? err.message : String(err)}`;
    if (current && current.status !== 'FAILED') {
      current.status = 'FAILED';
      current.reasons.push(msg);
    } else if (!current) {
      globalReasons.push(msg);
    }
  });

  // Orphan detection ---------------------------------------------------------
  const manifestNames = new Set(MANIFEST.map(s => `${s.name}.ts`));
  const allFiles = fs.readdirSync(__dirnameTests).filter(f => f.endsWith('.ts'));
  const orphans = allFiles.filter(f => !manifestNames.has(f) && !NON_SUITE.has(f));

  if (LIST_ONLY) {
    origConsole.log(`Manifest suites: ${MANIFEST.length}`);
    origConsole.log(`Orphan files (not in manifest, not in NON_SUITE): ${orphans.length}`);
    for (const o of orphans) origConsole.log(`  ORPHAN: ${o}`);
    process.exit(0);
  }

  origConsole.log(`Running ${suites.length} suite(s) sequentially${FILTER ? ` (filter: "${FILTER}")` : ''}...\n`);

  if (suites.length === 0) {
    origConsole.error(`No suites match filter "${FILTER}" — refusing to report an empty run as success.`);
    process.exit(2);
  }

  const results: Result[] = [];

  for (const suite of suites) {
    const result: Result = { name: suite.name, status: 'UNKNOWN', ms: 0, reasons: [] };
    current = result;
    process.exitCode = 0;

    // Reset rate limiters before each suite run
    if (typeof __resetRateLimiters === 'function') {
      try {
        __resetRateLimiters();
      } catch {}
    }

    // While a suite runs, process.exit becomes a catchable signal instead of
    // killing the whole run (suites historically use exit(1) on failure).
    (process as any).exit = (code: number) => { throw new ExitError(code); };

    const t0 = Date.now();
    try {
      const mod = await suite.load();
      if (suite.call && typeof mod[suite.call] === 'function') {
        await mod[suite.call]();
      }
      result.ms = Date.now() - t0;
      if (result.status !== 'FAILED') {
        const code = process.exitCode ?? 0;
        if (code !== 0) {
          result.status = 'FAILED';
          result.reasons.push(`process.exitCode=${code}`);
        }
      }
    } catch (e) {
      result.ms = Date.now() - t0;
      if (e instanceof ExitError) {
        if (e.code !== 0 && result.status !== 'FAILED') {
          result.status = 'FAILED';
          result.reasons.push(e.message);
        } else if (e.code === 0 && result.status === 'UNKNOWN') {
          result.status = 'PASS';
          result.reasons.push('process.exit(0)');
        }
      } else {
        result.status = 'FAILED';
        result.reasons.push(`threw: ${e instanceof Error ? (e.stack ?? e.message).split('\n')[0] : String(e)}`);
      }
    } finally {
      (process as any).exit = origExit;
      process.exitCode = 0; // final code is decided by the runner, not by suites
    }

    // A suite that proves nothing (no failure AND no success signal) is not a pass.
    if (result.status === 'UNKNOWN') {
      result.reasons.push('no success and no failure signal in output (silence is not success)');
    }

    // xfail bookkeeping: documented failures don't fail the run; an xfail suite that
    // starts passing DOES fail the run (the registry entry must be removed).
    if (KNOWN_FAILURES.has(suite.name)) {
      if (result.status === 'FAILED' || result.status === 'UNKNOWN') {
        result.status = 'XFAIL';
        result.reasons.push(`xfail: ${KNOWN_FAILURES.get(suite.name)}`);
      } else if (result.status === 'PASS') {
        result.status = 'FAILED';
        result.reasons.push('expected failure now passing — remove from KNOWN_FAILURES');
      }
    }

    results.push(result);
    current = null;
    const icon = result.status === 'PASS' ? '✅' : result.status === 'FAILED' ? '❌' : result.status === 'XFAIL' ? '⚠️' : '❔';
    origConsole[QUIET ? 'log' : 'error'](`${icon} ${result.status.padEnd(7)} ${result.name} (${result.ms} ms)${result.reasons.length ? ` — ${result.reasons.join('; ')}` : ''}\n`);
  }

  // Summary ------------------------------------------------------------------
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAILED').length;
  const unknown = results.filter(r => r.status === 'UNKNOWN').length;
  const xfailed = results.filter(r => r.status === 'XFAIL').length;

  origConsole.log('\n================ RUN SUMMARY ================');
  origConsole.log(`Suites run:    ${results.length}`);
  origConsole.log(`Passed:        ${passed}`);
  origConsole.log(`Failed:        ${failed}`);
  if (xfailed) origConsole.log(`Known-fail:    ${xfailed} (xfail, do not fail the run)`);
  if (unknown) origConsole.log(`Unknown:       ${unknown} (counted as failures)`);
  origConsole.log(`Orphan suites: ${orphans.length} (not executed)`);
  for (const o of orphans) origConsole.log(`  ORPHAN: ${o}`);
  if (globalReasons.length) {
    origConsole.log(`Global async failures: ${globalReasons.length}`);
    for (const g of globalReasons) origConsole.log(`  ${g}`);
  }
  origConsole.log('=============================================\n');

  const runFailed = failed > 0 || unknown > 0 || globalReasons.length > 0 || (STRICT_ORPHANS && orphans.length > 0);
  if (runFailed) {
    origConsole.log(`=== TEST RUN FAILED: ${failed} failed, ${unknown} unknown ===`);
    process.exit(1);
  }
  origConsole.log('=== ALL MANIFESTED SUITES PASSED ===');
  process.exit(0);
}

main();
