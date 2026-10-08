import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { OFFICIAL_TIME_SLOTS } from '../utils/samgtuParser';
import { TIME_SLOTS } from '../scripts/sync_official_schedule';
import { SCHEDULE_REGISTRY } from '../constants';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schedulesDir = path.resolve(__dirname, '../public/schedules');

console.log("=================================================");
console.log("    TEST SUITE: SAMGTU BELL SCHEDULE INTEGRITY   ");
console.log("=================================================");

const ALLOWED_BELL_STARTS = ['08:00', '09:45', '11:50', '13:35', '15:40', '17:25'];
const EXPECTED_BELL_PAIRS: Record<string, string> = {
  '08:00': '09:35',
  '09:45': '11:20',
  '11:50': '13:25',
  '13:35': '15:10',
  '15:40': '17:15',
  '17:25': '19:00'
};

// 1. Check OFFICIAL_TIME_SLOTS and TIME_SLOTS definitions (exactly 6 pairs)
console.log("\n--- 1. Verification of TIME_SLOTS Constants (Strictly 6 Pairs) ---");
const officialKeys = Object.keys(OFFICIAL_TIME_SLOTS).sort();
const syncKeys = Object.keys(TIME_SLOTS).sort();

if (officialKeys.join(',') !== '1,2,3,4,5,6') {
  console.error("  [FAIL] OFFICIAL_TIME_SLOTS must contain exactly slots 1..6! Found:", officialKeys);
  process.exit(1);
}
console.log("  [PASS] OFFICIAL_TIME_SLOTS contains exactly 6 pairs (1..6)");

if (syncKeys.join(',') !== '1,2,3,4,5,6') {
  console.error("  [FAIL] TIME_SLOTS must contain exactly slots 1..6! Found:", syncKeys);
  process.exit(1);
}
console.log("  [PASS] scripts/sync_official_schedule TIME_SLOTS contains exactly 6 pairs (1..6)");

if ((OFFICIAL_TIME_SLOTS as any)['7'] || (TIME_SLOTS as any)['7']) {
  console.error("  [FAIL] Pair 7 is still defined in TIME_SLOTS!");
  process.exit(1);
}
console.log("  [PASS] Slot '7' (19:10 - 20:45) is completely absent from all TIME_SLOTS constants");

// 2. Check public/schedules/*.json for absence of 7th pair & compliance with SamGTU bell schedule
console.log("\n--- 2. Verification of public/schedules/*.json Files ---");
const jsonFiles = fs.readdirSync(schedulesDir).filter(f => f.endsWith('.json'));
console.log(`Found ${jsonFiles.length} schedule files in ${schedulesDir}`);

let totalCheckedFiles = 0;
let totalCheckedLessons = 0;
const violations: string[] = [];

for (const file of jsonFiles) {
  totalCheckedFiles++;
  const filePath = path.join(schedulesDir, file);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  for (const [weekKey, days] of Object.entries(data)) {
    if (!Array.isArray(days)) continue;

    for (const day of days) {
      if (!day || !Array.isArray(day.lessons)) continue;

      for (const lesson of day.lessons) {
        totalCheckedLessons++;

        // Rule 1: No 7th pair (no 19:10 start, no 20:45 end)
        if (lesson.timeStart === '19:10' || lesson.timeEnd === '20:45') {
          violations.push(`[${file}] [Week ${weekKey}] [${day.dayName}] Found 7th pair lesson: "${lesson.subject}" (${lesson.timeStart} - ${lesson.timeEnd})`);
        }

        // Rule 2: Allowed bell times
        if (!ALLOWED_BELL_STARTS.includes(lesson.timeStart)) {
          violations.push(`[${file}] [Week ${weekKey}] [${day.dayName}] Invalid timeStart "${lesson.timeStart}" for lesson "${lesson.subject}"`);
        }

        const expectedEnd = EXPECTED_BELL_PAIRS[lesson.timeStart];
        if (expectedEnd && lesson.timeEnd !== expectedEnd) {
          violations.push(`[${file}] [Week ${weekKey}] [${day.dayName}] Mismatched bell slot: ${lesson.timeStart} - ${lesson.timeEnd} (expected end: ${expectedEnd})`);
        }
      }
    }
  }
}

console.log(`Checked ${totalCheckedFiles} files and ${totalCheckedLessons} lessons in public/schedules/`);

if (violations.length > 0) {
  console.error(`  [FAIL] Found ${violations.length} bell schedule violations:`);
  violations.forEach(v => console.error(`    - ${v}`));
  process.exit(1);
} else {
  console.log("  [PASS] Zero lessons with timeStart '19:10' across all public/schedules/*.json");
  console.log("  [PASS] All lessons strictly match official SamGTU bell pairs (1..6)");
}

// 3. Check SCHEDULE_REGISTRY in constants.ts
console.log("\n--- 3. Verification of SCHEDULE_REGISTRY (constants.ts) ---");
let registryLessonsChecked = 0;
const registryViolations: string[] = [];

for (const [groupId, weekSchedule] of Object.entries(SCHEDULE_REGISTRY)) {
  for (let w = 1; w <= 4; w++) {
    const days = weekSchedule[w as 1 | 2 | 3 | 4] || [];
    for (const day of days) {
      for (const lesson of day.lessons) {
        registryLessonsChecked++;

        if (lesson.timeStart === '19:10' || lesson.timeEnd === '20:45') {
          registryViolations.push(`[SCHEDULE_REGISTRY:${groupId}] [Week ${w}] [${day.dayName}] 7th pair: ${lesson.subject}`);
        }

        if (!ALLOWED_BELL_STARTS.includes(lesson.timeStart)) {
          registryViolations.push(`[SCHEDULE_REGISTRY:${groupId}] [Week ${w}] [${day.dayName}] Invalid start: ${lesson.timeStart}`);
        }

        const expectedEnd = EXPECTED_BELL_PAIRS[lesson.timeStart];
        if (expectedEnd && lesson.timeEnd !== expectedEnd) {
          registryViolations.push(`[SCHEDULE_REGISTRY:${groupId}] [Week ${w}] [${day.dayName}] Slot mismatch: ${lesson.timeStart} - ${lesson.timeEnd}`);
        }
      }
    }
  }
}

console.log(`Checked ${registryLessonsChecked} lessons across ${Object.keys(SCHEDULE_REGISTRY).length} groups in SCHEDULE_REGISTRY`);

if (registryViolations.length > 0) {
  console.error(`  [FAIL] SCHEDULE_REGISTRY has ${registryViolations.length} violations:`);
  registryViolations.forEach(v => console.error(`    - ${v}`));
  process.exit(1);
} else {
  console.log("  [PASS] SCHEDULE_REGISTRY adheres 100% to official SamGTU 6-pair bell schedule");
}

console.log("\n=================================================");
console.log("  ALL SAMGTU BELL SCHEDULE CHECKS PASSED (100%)  ");
console.log("=================================================");
