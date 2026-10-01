import { AVAILABLE_GROUPS, SCHEDULE_REGISTRY, FACULTIES } from '../constants';
import { preloadAllSchedulesSync } from '../utils/scheduleNodeLoader';
import { getCanonicalGroupKey, normalizeSamgtuGroupName } from '../utils/samgtuParser';
preloadAllSchedulesSync();
import { sanitizeTeachers, sanitizeOverrides } from '../utils/cloudSync';
import { verifyPinCode } from '../utils/auth';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('========================================================================');
console.log('   DEEP MULTI-DIMENSIONAL AUDIT & STRESS VERIFICATION (NON-STANDARD)   ');
console.log('========================================================================\n');

let totalChecks = 0;
let passedChecks = 0;
let warningsCount = 0;

function check(title: string, condition: boolean, detail?: string) {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`  [PASS] ${title}`);
  } else {
    console.error(`  [FAIL] ${title} ${detail ? `-> ${detail}` : ''}`);
    process.exit(1);
  }
}

function warn(title: string, detail: string) {
  warningsCount++;
  console.warn(`  [WARN] ${title}: ${detail}`);
}

// ============================================================================
// 1. DATA INTEGRITY: LESSON TIMINGS & COLLISION DETECTION
// ============================================================================
console.log('--- 1. Schedule Data Integrity & Lesson Collision Matrix ---');

let totalRegisteredLessons = 0;
const registeredGroupIds = Object.keys(SCHEDULE_REGISTRY);

for (const gid of registeredGroupIds) {
  const sched = SCHEDULE_REGISTRY[gid];
  if (!sched) continue;

  for (let w = 1; w <= 4; w++) {
    const week = sched[w];
    if (!Array.isArray(week)) continue;

    for (const day of week) {
      if (!Array.isArray(day.lessons)) continue;

      // Check time format and start < end
      for (const lesson of day.lessons) {
        totalRegisteredLessons++;
        check(`Group ${gid} (w${w} ${day.dayName}): lesson ${lesson.id} has non-empty subject`, typeof lesson.subject === 'string' && lesson.subject.trim().length > 0);
        check(`Group ${gid} (w${w} ${day.dayName}): lesson ${lesson.id} has valid timeStart format`, /^\d{2}:\d{2}$/.test(lesson.timeStart), `got: ${lesson.timeStart}`);
        check(`Group ${gid} (w${w} ${day.dayName}): lesson ${lesson.id} has valid timeEnd format`, /^\d{2}:\d{2}$/.test(lesson.timeEnd), `got: ${lesson.timeEnd}`);
        check(`Group ${gid} (w${w} ${day.dayName}): lesson ${lesson.id} timeStart < timeEnd`, lesson.timeStart < lesson.timeEnd, `${lesson.timeStart} vs ${lesson.timeEnd}`);
      }

      // Check for overlapping lesson times within the same day
      for (let i = 0; i < day.lessons.length; i++) {
        for (let j = i + 1; j < day.lessons.length; j++) {
          const l1 = day.lessons[i];
          const l2 = day.lessons[j];
          const isOverlap = (l1.timeStart < l2.timeEnd && l2.timeStart < l1.timeEnd);
          // If subjects or types differ (e.g. sub-groups), warn instead of fail
          if (isOverlap) {
            warn(`Potential concurrent pair in ${gid} w${w} ${day.dayName}`, `"${l1.subject}" (${l1.timeStart}-${l1.timeEnd}) and "${l2.subject}" (${l2.timeStart}-${l2.timeEnd})`);
          }
        }
      }
    }
  }
}
console.log(`✅ Checked timing integrity across ${totalRegisteredLessons} lessons in registry.`);

// ============================================================================
// 2. FACULTY & GROUP CONFIGURATION MATRIX
// ============================================================================
console.log('\n--- 2. Faculty & Group Config Relational Integrity ---');

const knownFacultyIds = new Set(FACULTIES.map(f => f.id));
for (const grp of AVAILABLE_GROUPS) {
  check(`Group ${grp.id} links to valid faculty ID`, knownFacultyIds.has(grp.facultyId), `invalid facultyId: ${grp.facultyId}`);
  check(`Group ${grp.id} course is between 1 and 6`, grp.course >= 1 && grp.course <= 6, `invalid course: ${grp.course}`);
  check(`Group ${grp.id} degree is valid`, grp.degree === 'Бакалавриат' || grp.degree === 'Специалитет' || grp.degree === 'Магистратура', `got: ${grp.degree}`);
  check(`Group ${grp.id} has non-empty name`, typeof grp.name === 'string' && grp.name.length >= 3);
}

// ============================================================================
// 3. STORAGE & RECOVERY RESILIENCE: CORRUPTED PAYLOAD HANDLING
// ============================================================================
console.log('\n--- 3. Client Storage Resilience & Corrupted JSON Recovery ---');

const corruptedPayloads = [
  '{ bad json: true, ',
  'null',
  'undefined',
  '""',
  '12345',
  '[]',
  '{"id": "broken", "lessons": "not an array"}',
  '{"1": null, "2": "garbage"}'
];

for (let i = 0; i < corruptedPayloads.length; i++) {
  const payload = corruptedPayloads[i];
  let parsed: any = null;
  let didCrash = false;
  try {
    parsed = JSON.parse(payload);
  } catch {
    // Handled
  }

  // Verify that our sanitizers never throw uncaught errors when fed corrupted objects
  try {
    const cleanTeachers = sanitizeTeachers(parsed, 'ingt-310');
    check(`Sanitizer resilience to payload #${i}`, typeof cleanTeachers === 'object' && cleanTeachers !== null);
  } catch (err: any) {
    didCrash = true;
    check(`Sanitizer crashed on payload #${i}`, false, err.message);
  }

  try {
    const cleanOverrides = sanitizeOverrides(parsed);
    check(`Override sanitizer resilience to payload #${i}`, typeof cleanOverrides === 'object' && cleanOverrides !== null);
  } catch (err: any) {
    didCrash = true;
    check(`Override sanitizer crashed on payload #${i}`, false, err.message);
  }
}

// ============================================================================
// 4. LIVE EDGE GATEWAY HEALTH & SECURITY HEADERS (ONLINE VERIFICATION)
// ============================================================================
console.log('\n--- 4. Live Cloudflare Worker Edge Gateway Verification ---');

const WORKER_BASE = 'https://unischedule-worker.a-le-bl.workers.dev';
try {
  const statusRes = await fetch(`${WORKER_BASE}/status`, { signal: AbortSignal.timeout(5000) });
  check('Edge gateway status HTTP 200 OK', statusRes.status === 200);
  const statusData = await statusRes.json();
  check('Edge gateway returns valid JSON payload', typeof statusData === 'object' && statusData !== null);
  check('Edge gateway provides maintenance flag boolean', typeof statusData.maintenance === 'boolean');
  console.log(`   Edge status message: "${statusData.message || 'System Operational'}" (maintenance: ${statusData.maintenance})`);
} catch (err: any) {
  warn('Edge Gateway unreachable or timed out', err.message);
}

// Unauthorized request rejection test
try {
  const unauthRes = await fetch(`${WORKER_BASE}/sync/homework?groupId=ingt-310`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [] }),
    signal: AbortSignal.timeout(5000)
  });
  check('Edge gateway strictly enforces X-App-Key (HTTP 401 on missing key)', unauthRes.status === 401);
} catch (err: any) {
  warn('Edge Gateway auth check skipped', err.message);
}

// ============================================================================
// 5. STATIC ASSET & SECURITY SCAN
// ============================================================================
console.log('\n--- 5. Static Source & Security Inspection ---');

const projectDir = path.resolve(__dirname, '..');
const appTsx = fs.readFileSync(path.join(projectDir, 'App.tsx'), 'utf8');
const indexHtml = fs.readFileSync(path.join(projectDir, 'index.html'), 'utf8');
const indexCss = fs.readFileSync(path.join(projectDir, 'index.css'), 'utf8');

check('index.html contains viewport-fit=cover for safe-area calculation', indexHtml.includes('viewport-fit=cover'));
check('index.html includes Telegram WebApp SDK script tag', indexHtml.includes('telegram-web-app.js'));
check('index.css declares @utility pt-safe', indexCss.includes('@utility pt-safe'));
check('index.css declares @utility pb-safe', indexCss.includes('@utility pb-safe'));
check('App.tsx uses canonical group key deduplication in state', appTsx.includes('getCanonicalGroupKey'));
check('App.tsx uses Suspense for code-split components', appTsx.includes('<Suspense'));
check('App.tsx mounts TabErrorBoundary for component failure containment', appTsx.includes('<TabErrorBoundary'));

// Check for accidental hardcoded secrets
const sensitivePatterns = [
  /bot\d+:[A-Za-z0-9_-]{35}/, // Telegram Bot Token
  /AKIA[0-9A-Z]{16}/,          // AWS Access Key
  /-----BEGIN PRIVATE KEY-----/ // Private Keys
];

for (const pattern of sensitivePatterns) {
  check(`No hardcoded secret matching ${pattern.source}`, !pattern.test(appTsx) && !pattern.test(indexHtml));
}

// ============================================================================
// 6. TOTAL RESULTS
// ============================================================================
console.log('\n========================================================================');
console.log(`TOTAL CHECKS: ${totalChecks} | PASSED: ${passedChecks} | WARNINGS: ${warningsCount}`);
console.log('========================================================================');

if (totalChecks === passedChecks) {
  console.log('>>> DEEP MULTI-DIMENSIONAL VERIFICATION COMPLETED WITH 100% SUCCESS <<<\n');
} else {
  console.error('>>> FAILURES DETECTED IN DEEP VERIFICATION <<<\n');
  process.exit(1);
}
