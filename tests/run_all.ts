import './setup_mock_auth';
import { preloadAllSchedulesSync } from '../utils/scheduleNodeLoader';
preloadAllSchedulesSync();

// A failing assertion must fail the run: individual suites only print a marker (and some set
// process.exitCode), so count markers here and exit non-zero at the end.
let failureCount = 0;
const FAIL_MARKER = /(❌|\[FAIL\]|✗ FAIL)/;
const FAILED_COUNT = /FAILED:\s*(\d+)/;
for (const level of ['log', 'warn', 'error'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: any[]) => {
    try {
      const line = args.map(a => (typeof a === 'string' ? a : String(a))).join(' ');
      const counted = line.match(FAILED_COUNT);
      if (FAIL_MARKER.test(line) || (counted && Number(counted[1]) > 0)) failureCount++;
    } catch {}
    original(...args);
  };
}

console.log("Running all test suites sequentially...");
await import('./test_ondemand_schedules');
await import('./test_dates');
await import('./test_attendance');
await import('./test_schedule_sync');
await import('./test_homework');
await import('./test_telegram_webapp');
await import('./test_samgtu_parser');
await import('./test_faid_schedule');
await import('./test_faid_attendance');
await import('./verify_student_ux');
await import('./test_ingt209_schedule');
await import('./test_qa_ingt209_verification');
await import('./test_bugreport_feature');
await import('./test_logger_diagnostics');
await import('./test_telemetry');
await import('./test_cancellation_and_privacy');
await import('./test_security_audit');
await import('./test_auth_hashes');
await import('./test_initdata_auth');
await import('./test_api_v3');
await import('./test_attendance_storage');
await import('./test_group_dedup_and_ingt3');
await import('./test_roster_cloud_sync');
await import('./test_roster_provider');
await import('./test_attendance_word_export_verification');
await import('./test_tma_resilience_e2e');
await import('./test_sunday_week_rollover_regression');
await import('./test_semester_preload');
await import('./test_audit_deep');
await import('./test_sanitization');
await import('./test_schedule_url');
await import('./test_kv_backup');
await import('./test_privacy_p0');
await import('./test_bell_schedule');
await import('./test_attendance_merge');
await import('./test_tma_word_export');
await import('./test_friday_pair4_verification');
await import('./test_block_a_ux');
await import('./test_useful_tracker');
await import('./test_attendance_matrix');
await import('./test_multidevice_attendance_sync');
const { runLessonMaterialsTests } = await import('./test_lesson_materials');
await runLessonMaterialsTests();
const { runHomeworkLifecycleStressTest } = await import('./test_homework_lifecycle_stress');
await runHomeworkLifecycleStressTest();
await import('./test_stage2_schedule_filters');
await import('./test_stage3_group_roster_archive');
await import('./test_stage1_ui_and_double_hours');
await import('./test_absences_notes_paste_dnd');
await import('./test_p0_regressions');
await import('./test_real_user_emulation');
if (failureCount > 0 || (process.exitCode ?? 0) !== 0) {
  console.log(`\n=== TEST RUN FAILED: ${failureCount} failure marker(s) ===`);
  process.exit(1);
}
console.log("\n=================================================");
console.log("       ALL TEST SUITES COMPLETED SUCCESSFULLY  ");
console.log("=================================================");
process.exit(0);
