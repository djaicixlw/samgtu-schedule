import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeGroupId } from '../utils/groupAliases';
import { makeGroupId, isValidGroupId } from '../utils/groupId';
import { validateWeekData } from '../utils/scheduleSchema';
import { GROUP_ID_RE } from '../cloudflare-worker';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SCHEDULES_DIR = path.resolve(ROOT, 'public/schedules');

console.log('=== TEST SUITE: CYRILLIC TO ASCII SCHEDULE NORMALIZATION (DEF-05) ===\n');

// 1. Check all files in public/schedules/*.json are strict ASCII and match GROUP_ID_RE
console.log('1. Checking public/schedules/*.json files naming...');
const scheduleFiles = fs.readdirSync(SCHEDULES_DIR).filter(f => f.endsWith('.json'));
assert(scheduleFiles.length > 0, 'public/schedules must contain schedule files');

let checkedFiles = 0;
for (const file of scheduleFiles) {
  const stem = file.replace(/\.json$/i, '');
  
  assert(!/[а-яА-ЯёЁ]/.test(file), `File ${file} contains Cyrillic characters!`);
  assert(GROUP_ID_RE.test(stem), `File stem "${stem}" does not match GROUP_ID_RE (/^[a-z0-9-]{1,64}$/)`);
  assert(isValidGroupId(stem), `File stem "${stem}" is not valid group id according to isValidGroupId`);
  assert.strictEqual(makeGroupId(stem), stem, `File stem "${stem}" must be a fixpoint of makeGroupId`);
  assert.strictEqual(normalizeGroupId(stem), stem, `File stem "${stem}" must be a fixpoint of normalizeGroupId`);
  
  checkedFiles++;
}
console.log(`  ✓ [PASS] All ${checkedFiles} schedule files in public/schedules/ are strict ASCII and pass GROUP_ID_RE.\n`);

// 2. Check archive directories for Cyrillic files
console.log('2. Checking archive directories for Cyrillic files...');
const archiveDirs = [
  path.resolve(SCHEDULES_DIR, 'archive/block-from-week-5'),
  path.resolve(SCHEDULES_DIR, 'archive/block-from-week-13')
];

for (const archDir of archiveDirs) {
  if (!fs.existsSync(archDir)) continue;
  const archFiles = fs.readdirSync(archDir).filter(f => f.endsWith('.json'));
  for (const f of archFiles) {
    assert(!/[а-яА-ЯёЁ]/.test(f), `Archive file ${f} in ${path.basename(archDir)} contains Cyrillic!`);
    const stem = f.replace(/\.json$/i, '');
    assert(GROUP_ID_RE.test(stem), `Archive file stem "${stem}" does not match GROUP_ID_RE`);
  }
  console.log(`  ✓ [PASS] Archive ${path.basename(archDir)} (${archFiles.length} files) is 100% ASCII clean.`);
}

// 3. Test all 19 Master's Groups resolution & schema validity
console.log('\n3. Testing all 19 Master\'s Degree groups normalization and schema validity...');
const MASTER_GROUPS = [
  '25ингт-101м', '25ингт-102м', '25ингт-103м', '25ингт-104м', '25ингт-105м',
  '25ингт-106м', '25ингт-107м', '25ингт-231м', '25ингт-241м', '25ингт-251м',
  '25ингт-252м', '25ингт-253м', '25ингт-281м', '26ингт-101м', '26ингт-102м',
  '26ингт-103м', '26ингт-104м', '26ингт-106м', '26ингт-107м'
];

assert.strictEqual(MASTER_GROUPS.length, 19, 'Must test exactly 19 master groups');

for (const rawName of MASTER_GROUPS) {
  const canonicalId = normalizeGroupId(rawName);
  assert(GROUP_ID_RE.test(canonicalId), `Canonical ID "${canonicalId}" for ${rawName} must pass GROUP_ID_RE`);
  
  // Test variations: uppercase, with dashes
  const upperName = rawName.toUpperCase();
  assert.strictEqual(normalizeGroupId(upperName), canonicalId, `Uppercase ${upperName} must normalize to ${canonicalId}`);
  
  // 25-ИНГТ-101м -> 25ingt-101m
  const dashedName = rawName.replace(/^(\d{2})([а-яё]+)/i, '$1-$2').toUpperCase();
  assert.strictEqual(normalizeGroupId(dashedName), canonicalId, `Dashed ${dashedName} must normalize to ${canonicalId}`);

  // Check file exists on disk
  const filePath = path.join(SCHEDULES_DIR, `${canonicalId}.json`);
  assert(fs.existsSync(filePath), `Schedule file missing for group ${rawName}: expected ${filePath}`);

  // Check schema validity
  const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const validation = validateWeekData(content);
  assert(validation.ok, `Schedule schema validation failed for ${canonicalId}`);
  assert(content[1] && content[2] && content[3] && content[4], `All 4 weeks must exist for ${canonicalId}`);
}
console.log(`  ✓ [PASS] All 19 master groups normalize correctly from lowercase/uppercase/dashed, exist on disk, and pass schema validation.`);

console.log('\n=================================================');
console.log('  ALL DEF-05 CYRILLIC/ASCII CHECKS PASSED (100%)');
console.log('=================================================\n');
