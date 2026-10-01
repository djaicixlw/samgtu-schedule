import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { SCHEDULE_REGISTRY } from '../constants';
import { getCanonicalGroupKey } from '../utils/samgtuParser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const publicSchedulesDir = path.join(projectRoot, 'public', 'schedules');

if (!fs.existsSync(publicSchedulesDir)) {
  fs.mkdirSync(publicSchedulesDir, { recursive: true });
}

console.log('--- EXPORTING SCHEDULES TO ON-DEMAND JSON CHUNKS ---');

// Canonical group keys that represent unique schedule datasets
const CANONICAL_GROUPS = [
  'ingt-301',
  'ingt-302',
  'ingt-303',
  'ingt-304',
  'ingt-305',
  'ingt-306',
  'ingt-307',
  'ingt-308',
  'ingt-309',
  'ingt-310',
  'ingt-311',
  'ingt-312',
  'ingt-313',
  'ingt-314',
  'faid-310',
  'ingt-209',
  'htf-215'
];

let exportedCount = 0;

for (const gid of CANONICAL_GROUPS) {
  const scheduleData = SCHEDULE_REGISTRY[gid];
  if (!scheduleData) {
    console.warn(`[WARN] Schedule for ${gid} not found in SCHEDULE_REGISTRY!`);
    continue;
  }

  const targetPath = path.join(publicSchedulesDir, `${gid}.json`);
  fs.writeFileSync(targetPath, JSON.stringify(scheduleData, null, 2), 'utf8');
  console.log(`  [OK] Exported ${gid} -> public/schedules/${gid}.json (${(fs.statSync(targetPath).size / 1024).toFixed(1)} KB)`);
  exportedCount++;
}

console.log(`\n🎉 Successfully exported ${exportedCount} schedule chunks into public/schedules/!\n`);
