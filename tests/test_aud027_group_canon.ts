/**
 * AUD-027/028: ONE canonicalizer for group ids.
 *
 * 1. The three historical normalizers (makeGroupId, normalizeGroupId,
 *    normalizeSamgtuGroupName.id) must produce IDENTICAL results on real group
 *    names/ids (the schedule chunk set of public/schedules/*.json), including
 *    Cyrillic, stray whitespace and portal year-coded names.
 * 2. makeGroupId is idempotent on every canonical id in AVAILABLE_GROUPS.
 * 3. AUD-028: the colliding alias 'ingt-109' -> 'ingt-209' is gone; the real
 *    group 1-ИНГТ-109 canonicalizes to 'ingt-109' (its chunk exists), and no
 *    code path rewrites it to 209.
 */

import assert from 'assert';
import { makeGroupId, isValidGroupId } from '../utils/groupId';
import { normalizeGroupId, CANONICAL_GROUP_ALIASES } from '../utils/groupAliases';
import { normalizeSamgtuGroupName, getCanonicalGroupKey } from '../utils/samgtuParser';
import { AVAILABLE_GROUPS } from '../constants';
import { preloadAllSchedulesSync } from '../utils/scheduleNodeLoader';

preloadAllSchedulesSync();

console.log('=== TEST SUITE: GROUP CANONICALIZER UNIFICATION (AUD-027/028) ===\n');

// ---------------------------------------------------------------------------
// 1. Real group names (public/schedules/*.json corpus) through all three APIs
// ---------------------------------------------------------------------------
console.log('1. All three normalizers agree on real group names...\n');

const realInputs: Array<[string, string]> = [
  // [input, expected canonical id]
  ['3-ИНГТ-110', 'ingt-310'],      // 3rd course (ingt-310.json)
  ['1-ИНГТ-109', 'ingt-109'],      // real 1st course group (ingt-109.json exists!)
  ['2-ИНГТ-109', 'ingt-209'],      // 2nd course group (ingt-209.json)
  ['3-ИНГТ-113', 'ingt-313'],
  ['1-ИНГТ-101', 'ingt-101'],
  ['2-ИНГТ-114', 'ingt-214'],
  ['3-ИАИТ-108', 'iait-308'],      // iait-308.json
  ['3-ФАИД-110', 'faid-310'],      // faid-310.json
  ['2-ХТФ-115', 'htf-215'],        // htf-215.json
  ['1-АСА-101', 'asa-101'],
  ['5-ФАИД-101', 'faid-501'],
  ['4-ИНГТ-101', 'ingt-401'],
  ['24ИНГТ-110', 'ingt-310'],      // portal year-code name
  ['25ИНГТ-109', 'ingt-209'],
  ['26ИНГТ-104', 'ingt-104'],
  ['25ингт-104м', '25ingt-104m'],  // master group (25ингт-104м.json), translit slug
  ['  3-ИНГТ-110  ', 'ingt-310'],  // stray whitespace
  ['3   ингт   110', 'ingt-310'],  // spaces instead of dashes
  ['ingt-310', 'ingt-310'],        // already canonical
  ['ingt-109', 'ingt-109'],        // AUD-028: canonical id of the REAL group
];

let checked = 0;
for (const [input, expected] of realInputs) {
  const viaMake = makeGroupId(input);
  const viaNormalize = normalizeGroupId(input);
  const viaParser = normalizeSamgtuGroupName(input).id;
  assert.strictEqual(viaMake, expected, `makeGroupId("${input}") = "${viaMake}", expected "${expected}"`);
  assert.strictEqual(viaNormalize, expected, `normalizeGroupId("${input}") = "${viaNormalize}", expected "${expected}"`);
  assert.strictEqual(viaParser, expected, `normalizeSamgtuGroupName("${input}").id = "${viaParser}", expected "${expected}"`);
  checked += 3;
}
console.log(`  [PASS] ${checked} cross-API checks on ${realInputs.length} real inputs are consistent.\n`);

// ---------------------------------------------------------------------------
// 2. AUD-028: the collision is gone
// ---------------------------------------------------------------------------
console.log('2. AUD-028: ingt-109 no longer collides with ingt-209...');
assert.strictEqual(CANONICAL_GROUP_ALIASES['ingt-109'], undefined, "alias 'ingt-109' removed from the table");
assert.strictEqual(normalizeGroupId('1-ИНГТ-109'), 'ingt-109', "normalize('1-ИНГТ-109') -> ingt-109 (NOT 209)");
assert.strictEqual(normalizeGroupId('ingt-109'), 'ingt-109', "normalize('ingt-109') -> itself (NOT 209)");
assert.strictEqual(normalizeGroupId('2-ингт-109'), 'ingt-209', "2-course group keeps its own legacy alias");
assert.strictEqual(normalizeGroupId('2-ingt-109'), 'ingt-209', "latin legacy alias for 2-ИНГТ-109 kept");
console.log('  [PASS] collision resolved deterministically.\n');

// ---------------------------------------------------------------------------
// 3. Idempotency over the whole AVAILABLE_GROUPS catalog
// ---------------------------------------------------------------------------
console.log('3. makeGroupId is idempotent on every AVAILABLE_GROUPS id...');
assert(AVAILABLE_GROUPS.length > 50, `full catalog present (${AVAILABLE_GROUPS.length} groups)`);
for (const g of AVAILABLE_GROUPS) {
  assert.strictEqual(makeGroupId(g.id), g.id, `makeGroupId("${g.id}") must be identity`);
  assert.strictEqual(normalizeGroupId(g.id), g.id, `normalizeGroupId("${g.id}") must be identity`);
  assert.strictEqual(isValidGroupId(makeGroupId(g.name)), true, `canonicalizing name "${g.name}" yields a valid id`);
}
console.log(`  [PASS] ${AVAILABLE_GROUPS.length} catalog ids are stable.\n`);

// ---------------------------------------------------------------------------
// 4. Dedup key consistency (getCanonicalGroupKey rides the same canonicalizer)
// ---------------------------------------------------------------------------
console.log('4. getCanonicalGroupKey agrees with the canonicalizer...');
for (const [input, expected] of realInputs.slice(0, 12)) {
  assert.strictEqual(getCanonicalGroupKey(input), expected, `getCanonicalGroupKey("${input}") = "${expected}"`);
}
console.log('  [PASS] dedup keys are the same canonical space.\n');

console.log('\n=== GROUP CANONICALIZER (AUD-027/028): ALL CHECKS PASSED ===\n');
