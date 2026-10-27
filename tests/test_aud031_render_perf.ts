/**
 * AUD-031 (+ AUD-032 / AUD-040 pins): render-performance hardening.
 *
 * Verifies:
 *   1. ClassCard / DayColumn / SwipeableDays are React.memo barriers.
 *   2. App consumes the day-granularity ticker (useSamaraDayTick), NOT the
 *      per-minute useNow(60000), and the schedule handlers are useCallback-
 *      stabilized (data-only deps).
 *   3. samaraDayChanged() — the pure rollover predicate — behaves at Samara
 *      midnight boundaries.
 *   4. AUD-032: the weekly «Итого» uses lesson/record hours, not a hardcoded 2.
 *   5. AUD-040: the toast left the hook layer (attendance.ts), feedback lives
 *      at the action sites; the three uploadFile copies now share ONE core in
 *      utils/upload.ts (no fetch('/upload') left in components).
 *   6. uploadToTelegramStorage: happy path + size guard (unit).
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const W = path.resolve(__dirname, '..');

let passed = 0;
function check(cond: any, label: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { console.error(`  ✗ FAIL ${label}`); process.exitCode = 1; }
}

console.log('\n--- 1. Memo barriers (AUD-031) ---');
const classCardSrc = fs.readFileSync(path.join(W, 'components/ClassCard.tsx'), 'utf8');
const dayColumnSrc = fs.readFileSync(path.join(W, 'components/DayColumn.tsx'), 'utf8');
const swipeableSrc = fs.readFileSync(path.join(W, 'components/SwipeableDays.tsx'), 'utf8');

check(classCardSrc.includes('export default React.memo(ClassCard)'), 'ClassCard is React.memo');
check(dayColumnSrc.includes('export default React.memo(DayColumn)'), 'DayColumn is React.memo');
check(swipeableSrc.includes('export default React.memo(SwipeableDays)'), 'SwipeableDays is React.memo');
// DayColumn keeps its own minute ticker (current-pair indicator) — memo must not freeze it.
check(dayColumnSrc.includes('useNow(60000)'), 'DayColumn owns the minute ticker internally');

console.log('\n--- 2. Day-granularity ticker in App (AUD-031) ---');
const appSrc = fs.readFileSync(path.join(W, 'App.tsx'), 'utf8');
const useNowSrc = fs.readFileSync(path.join(W, 'utils/useNow.ts'), 'utf8');

check(appSrc.includes('const liveNow = useSamaraDayTick(60000)'), 'App uses useSamaraDayTick(60000)');
check(!appSrc.includes('const liveNow = useNow(60000)'), 'App no longer runs the per-minute ticker at tree level');
check(appSrc.includes('const samaraNow = useMemo(() => getSamaraDate(liveNow), [liveNow])'), 'samaraNow derivation unchanged');
check(appSrc.includes('const todayDayName = useMemo(() => getDayName(samaraISO(liveNow)), [liveNow])'), 'todayDayName derivation unchanged (AUD-024 preserved)');
check(useNowSrc.includes('export function useSamaraDayTick'), 'useSamaraDayTick exported');
check(useNowSrc.includes('export function useNow(intervalMs: number = 60000): Date'), 'useNow signature preserved (minute consumers: DayColumn/SwipeableDays)');

check(appSrc.includes('const handleUpdateLesson = useCallback(async ('), 'handleUpdateLesson is useCallback');
check(appSrc.includes('const handleResetLesson = useCallback(async (lessonId: string)'), 'handleResetLesson is useCallback');
check(
  appSrc.includes('}, [canEdit, currentGroupId, scheduleOverrides, subjectTeachers, attendanceRecords, selectedWeek, markAttendance])'),
  'handlers use data-only dependency lists'
);
check(appSrc.includes('const isOnline = useOnlineStatus()'), 'App consumes useOnlineStatus (AUD-041 wiring, source pin)');

console.log('\n--- 3. samaraDayChanged predicate ---');
const { samaraDayChanged } = await import('../utils/useNow');
// Samara = UTC+4: 2026-10-01T19:30Z == 23:30 Samara; 20:30Z == 00:30 next day.
const beforeMidnight = new Date('2026-10-01T19:30:00Z');
const afterMidnight = new Date('2026-10-01T20:30:00Z');
check(samaraDayChanged(beforeMidnight, afterMidnight) === true, 'midnight rollover detected (Samara)');
check(samaraDayChanged(beforeMidnight, new Date('2026-10-01T19:59:00Z')) === false, 'same-day minute tick does NOT roll over');
check(samaraDayChanged(afterMidnight, afterMidnight) === false, 'same instant -> no change');
// Year boundary in Samara terms: 19:00Z on 12-31 is 23:00 Samara (Dec 31);
// 20:00Z is already 00:00 Samara (Jan 1).
check(samaraDayChanged(new Date('2026-12-31T19:00:00Z'), new Date('2026-12-31T20:00:00Z')) === true, 'year boundary rollover detected');
check(samaraDayChanged(new Date('2026-12-31T20:30:00Z'), new Date('2027-01-01T02:00:00Z')) === false, 'both instants on the same Samara day -> no change');

console.log('\n--- 4. Week totals use real hours (AUD-032) ---');
const matrixSrc = fs.readFileSync(path.join(W, 'components/AttendanceMatrix.tsx'), 'utf8');
check(!matrixSrc.includes('studentWeekAbsHours += 2') && !matrixSrc.includes('studentWeekExcHours += 2'), 'no hardcoded +=2 in week totals');
check(
  matrixSrc.includes('const lessonHours = lesson.hours || record.hours || 2;') &&
  matrixSrc.includes('studentWeekAbsHours += lessonHours') &&
  matrixSrc.includes('studentWeekExcHours += lessonHours'),
  'week totals use lesson.hours || record.hours || 2 (same source as semester stats)'
);

console.log('\n--- 5. Single toast at the action site (AUD-040) ---');
const attSrc = fs.readFileSync(path.join(W, 'attendance.ts'), 'utf8');
const trackerSrc = fs.readFileSync(path.join(W, 'components/AttendanceTracker.tsx'), 'utf8');
check(!attSrc.includes("toast.success(isCancelled"), 'attendance.ts markAttendance no longer toasts (hook layer)');
check(!attSrc.includes("from 'sonner'"), 'attendance.ts dropped the sonner import');
check(trackerSrc.includes("toast.success('Посещаемость сохранена')"), 'AttendanceTracker handleSetStudentStatus shows its own toast');
check(matrixSrc.includes('toast.success(`${studentName}: ${statusLabel}`'), 'AttendanceMatrix keeps its action-site toast');
check(!/markAttendance\([^)]*\);\s*toast\.success\('Посещаемость сохранена'\)\s*toast/.test(trackerSrc), 'no accidental double toast in tracker');

console.log('\n--- 6. Single upload core (AUD-040) ---');
const hwSrc = fs.readFileSync(path.join(W, 'components/HomeworkTracker.tsx'), 'utf8');
const usefulSrc = fs.readFileSync(path.join(W, 'components/UsefulTracker.tsx'), 'utf8');
const uploadSrc = fs.readFileSync(path.join(W, 'utils/upload.ts'), 'utf8');
check(uploadSrc.includes('export async function uploadToTelegramStorage'), 'utils/upload.ts owns the shared upload core');
check(uploadSrc.includes('export async function uploadAttachmentFile'), 'uploadAttachmentFile still exported (EditLessonModal/GroupManager pin)');
check(hwSrc.includes('await uploadToTelegramStorage(file'), 'HomeworkTracker delegates to the core');
check(usefulSrc.includes('await uploadToTelegramStorage(file'), 'UsefulTracker delegates to the core');
check(!hwSrc.includes("fetch(`${TG_WORKER_URL}/upload`"), 'no fetch(/upload) left in HomeworkTracker');
check(!usefulSrc.includes("fetch(`${WORKER_BASE}/upload`"), 'no fetch(/upload) left in UsefulTracker');
check(hwSrc.includes('uploadFile(file)') && usefulSrc.includes('uploadFile(file)'), 'paste handlers still call local uploadFile (source pins of test_absences_notes_paste_dnd)');
check(hwSrc.includes('Файл слишком большой (>50 МБ)'), 'Homework 50MB UX unchanged');
check(usefulSrc.includes('Максимум 10 вложений'), 'Useful 10-attachment cap unchanged');
check(uploadSrc.includes('formatUploadedSize'), 'shared size formatter exported');

console.log('\n--- 7. uploadToTelegramStorage unit behavior ---');
const originalFetch = globalThis.fetch;
const originalLocalStorage = globalThis.localStorage;
try {
  // happy path
  const calls: Array<{ url: string; init: RequestInit }> = [];
  (globalThis as any).fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: true,
      json: async () => ({ ok: true, result: { document: { file_id: 'FILEID-1' } }, sig: 'SIG', exp: 'EXP' })
    };
  };
  const { uploadToTelegramStorage } = await import('../utils/upload');
  const file = new File([new Uint8Array(1024)], 'shot.png', { type: 'image/png' });
  const core = await uploadToTelegramStorage(file, { caption: '[3-ИНГТ-110] 📚 ДЗ: shot.png #tag' });
  check(core.fileId === 'FILEID-1' && core.sig === 'SIG' && core.exp === 'EXP', 'core returns fileId/sig/exp');
  check(calls.length === 1 && calls[0].url.endsWith('/upload'), 'core POSTs exactly once to /upload');
  const fd = calls[0].init.body as FormData;
  check(fd.get('caption') === '[3-ИНГТ-110] 📚 ДЗ: shot.png #tag', 'caption forwarded');

  // size guard
  const big = new File([new Uint8Array(6 * 1024 * 1024)], 'big.bin');
  let threw = '';
  try {
    await uploadToTelegramStorage(big, { maxSizeBytes: 5 * 1024 * 1024 });
  } catch (e: any) {
    threw = String(e.message);
  }
  check(threw.includes('>5 МБ'), 'size guard throws with the familiar message shape');
} finally {
  globalThis.fetch = originalFetch;
  globalThis.localStorage = originalLocalStorage;
}

console.log(`\n[${passed} checks passed]`);
if (process.exitCode !== 1) console.log('=== AUD-031/032/040 SUITE PASSED ===');
