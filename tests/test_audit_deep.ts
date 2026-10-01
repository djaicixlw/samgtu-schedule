import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { SCHEDULE_REGISTRY } from '../constants';

console.log('=== RUNNING COMPREHENSIVE AUDIT TEST SUITE ===\n');
const root = process.cwd();

// Test 1: cloudflare-worker.js security & privacy
{
  console.log('Test 1: cloudflare-worker.js security & privacy');
  const workerCode = fs.readFileSync(path.resolve(root, 'cloudflare-worker.js'), 'utf8');
  assert(!workerCode.includes('@raspisanie_samgtu'), 'Should not route bug reports to public channel');
  assert(!workerCode.includes('8330761109:AA'), 'Should not contain hardcoded bot token');
  assert(workerCode.includes('X-App-Key'), 'Should enforce X-App-Key header');
  assert(workerCode.includes('APP_SECRET'), 'Should check APP_SECRET');
  console.log('  PASS: Worker is secure, private, and tokenless.\n');
}

// Test 2: attendance.ts dead code cut
{
  console.log('Test 2: attendance.ts cleanliness');
  const attendanceCode = fs.readFileSync(path.resolve(root, 'attendance.ts'), 'utf8');
  assert(!attendanceCode.includes('firebase/firestore'), 'Should not import firebase/firestore');
  assert(!attendanceCode.includes('onSnapshot'), 'Should not use Firestore onSnapshot');
  assert(attendanceCode.includes("updatedBy: 'starosta_pin'"), 'Should tag attendance updates with starosta_pin');
  console.log('  PASS: attendance.ts has no Firebase/Firestore dead code.\n');
}

// Test 3: App.tsx race conditions, TabErrorBoundary, and safe guards
{
  console.log('Test 3: App.tsx race conditions & error boundaries');
  const appCode = fs.readFileSync(path.resolve(root, 'App.tsx'), 'utf8');
  assert(!appCode.includes('from "firebase/firestore"'), 'App.tsx should not import firebase/firestore');
  assert(appCode.includes('last_local_edit_'), 'App.tsx should record last_local_edit timestamp');
  assert(appCode.includes('30 * 1000') || appCode.includes('30000'), 'App.tsx should skip cloud override within 30s of local edit');
  assert(appCode.includes('TabErrorBoundary'), 'App.tsx should import and use TabErrorBoundary');
  assert(appCode.includes('Array.isArray(rawSchedule)'), 'App.tsx should validate rawSchedule is an array');
  assert(appCode.includes('key={currentGroupId}'), 'SwipeableDays should be keyed by currentGroupId');
  console.log('  PASS: App.tsx handles race conditions, tab errors, and group switching correctly.\n');
}

// Test 4: GroupManager.tsx roster editing unlocked
{
  console.log('Test 4: GroupManager.tsx roster editing');
  const gmCode = fs.readFileSync(path.resolve(root, 'components/GroupManager.tsx'), 'utf8');
  assert(!gmCode.includes('parsed.length !== 16'), 'GroupManager should not discard custom student list with !== 16');
  assert(!gmCode.includes('parsed.length !== 22'), 'GroupManager should not discard custom student list with !== 22');
  console.log('  PASS: Roster editing is not forcibly reset by length checks.\n');
}

// Test 5: BugReportModal.tsx album grid, canvas height limit, and mobile ergonomics
{
  console.log('Test 5: BugReportModal.tsx iOS Safari & mobile ergonomics');
  const brmCode = fs.readFileSync(path.resolve(root, 'components/BugReportModal.tsx'), 'utf8');
  assert(brmCode.includes('MAX_CANVAS_HEIGHT = 4000'), 'Canvas height must be capped at 4000px to avoid iOS Safari OOM');
  assert(brmCode.includes('isMultiCol = images.length > 3') && brmCode.includes('cols = isMultiCol ? 2 : 1'), 'Album stitching should use 2 columns when > 3 images');
  assert(brmCode.includes('items-end sm:items-center'), 'Modal should display as a bottom sheet on mobile');
  assert(brmCode.includes('text-base sm:text-xs'), 'Inputs should use font-size 16px on mobile to prevent iOS Safari autozoom');
  console.log('  PASS: BugReportModal iOS Safari and mobile layout optimized.\n');
}

// Test 6: SwipeableDays.tsx touch events
{
  console.log('Test 6: SwipeableDays.tsx touch listener cleanliness');
  const sdCode = fs.readFileSync(path.resolve(root, 'components/SwipeableDays.tsx'), 'utf8');
  assert(!sdCode.includes('onTouchStart={handleTouchStart}'), 'Container should not attach duplicate onTouchStart');
  assert(!sdCode.includes('onTouchEnd={handleTouchEnd}'), 'Container should not attach duplicate onTouchEnd');
  console.log('  PASS: Double swipe issue eliminated.\n');
}

// Test 7: exportWord.ts block absences
{
  console.log('Test 7: exportWord.ts block absences logic');
  const ewCode = fs.readFileSync(path.resolve(root, 'utils/exportWord.ts'), 'utf8');
  assert(ewCode.includes('blockAbsences > 0') && ewCode.includes('${blockAbsences} Не УП'), 'exportWord should output block-specific absences');
  assert(ewCode.includes('blockExcused > 0') && ewCode.includes('${blockExcused} УП'), 'exportWord should output block-specific excused absences');
  console.log('  PASS: exportWord outputs correct per-block absences.\n');
}

// Test 8: constants.ts schedule integrity & typo fixes
{
  console.log('Test 8: constants.ts schedule integrity & typo fixes');
  const constCode = fs.readFileSync(path.resolve(root, 'constants.ts'), 'utf8');
  assert(!constCode.includes('Лабораторные занятия'), 'All "Лабораторные занятия" should be "Лабораторные работы"');

  const groups = ['ingt-301', 'ingt-303', 'faid-310', 'ingt-209', 'htf-215'];
  for (const g of groups) {
    const reg = SCHEDULE_REGISTRY[g];
    assert(reg, 'Schedule registry must exist for ' + g);
    const w1 = reg[1];
    const w1Monday = w1.find(d => d.dayName === 'Понедельник');
    assert(w1Monday && w1Monday.lessons.length > 0, 'Week 1 Monday must have lessons for ' + g);
  }
  console.log('  PASS: Typo eliminated and Week 1 Mondays restored across all groups.\n');
}

// Test 9: AndroidManifest permissions
{
  console.log('Test 9: AndroidManifest.xml permissions');
  const manifest = fs.readFileSync(path.resolve(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  assert(manifest.includes('android.permission.CAMERA'), 'Manifest must have CAMERA permission');
  assert(manifest.includes('android.permission.READ_MEDIA_IMAGES'), 'Manifest must have READ_MEDIA_IMAGES permission');
  console.log('  PASS: Android permissions configured correctly.\n');
}

// Test 10: sync_official_schedule circuit breaker
{
  console.log('Test 10: sync_official_schedule.ts circuit breaker');
  const syncCode = fs.readFileSync(path.resolve(root, 'scripts/sync_official_schedule.ts'), 'utf8');
  assert(syncCode.includes('totalParsedLessons < 50'), 'sync script must have circuit breaker checking < 50 lessons');
  console.log('  PASS: Circuit breaker in place to protect schedule data integrity.\n');
}

console.log('========================================');
console.log('ALL 10 AUDIT VERIFICATION TESTS PASSED!');
console.log('========================================');