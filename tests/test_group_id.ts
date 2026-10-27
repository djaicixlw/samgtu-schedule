import assert from 'assert';
import { makeGroupId, isValidGroupId, transliterateCyrillic } from '../utils/groupId';

console.log('=== TEST SUITE: Group ID Normalization, Transliteration & Validation ===\n');

// 1. Transliteration Tests for standard and custom groups
console.log('1. Testing Cyrillic transliteration and canonical group IDs...');

// AUD-027: makeGroupId now canonicalizes into the APP id space
// (<fac>-<course><num2>, e.g. 'ingt-310') — the same space as
// normalizeGroupId and normalizeSamgtuGroupName (see test_aud027_group_canon).
const translitCases: Array<{ input: string; expected: string; desc: string }> = [
  { input: '3-ИНГТ-110', expected: 'ingt-310', desc: 'Standard 3-ИНГТ-110 -> app-canonical ingt-310' },
  { input: '25ингт-101м', expected: '25ingt-101m', desc: 'Master group 25ингт-101м with suffix "м" (translit slug)' },
  { input: '1-ХТФ-215', expected: 'htf-115', desc: 'Faculty ХТФ abbreviation' },
  { input: '3-ФАИД-110', expected: 'faid-310', desc: 'Faculty ФАИД abbreviation' },
  { input: '2-ИАИТ-108', expected: 'iait-208', desc: 'Faculty ИАИТ abbreviation (2 course)' },
  { input: '4-ФММТ-101', expected: 'fmmt-401', desc: 'Faculty ФММТ abbreviation (4 course)' },
  { input: '1-АСА-101', expected: 'asa-101', desc: 'Faculty АСА abbreviation' },
  { input: '2-ЭТФ-101', expected: 'etf-201', desc: 'Faculty ЭТФ abbreviation (2 course)' },
  { input: '3-ТЭФ-101', expected: 'tef-301', desc: 'Faculty ТЭФ abbreviation (3 course)' },
  { input: '1-ИТФ-101', expected: 'itf-101', desc: 'Faculty ИТФ abbreviation' },
  { input: '5-ФПП-101', expected: 'fpp-501', desc: 'Faculty ФПП abbreviation (5 course)' },
  { input: '1-ИИЭГО-101', expected: 'iiego-101', desc: 'Faculty ИИЭГО abbreviation' }
];

for (const { input, expected, desc } of translitCases) {
  const result = makeGroupId(input);
  assert.strictEqual(result, expected, `Transliteration failed for ${desc}: got "${result}", expected "${expected}"`);
  assert(isValidGroupId(result), `Output is not valid group ID for ${desc}: "${result}"`);
}
console.log(`[PASS] All ${translitCases.length} standard and custom group transliterations match expected IDs.`);

// 2. Transliteration helper direct tests
console.log('\n2. Testing direct transliterateCyrillic function...');
assert.strictEqual(transliterateCyrillic('институт ИНГТ'), 'institut ingt');
assert.strictEqual(transliterateCyrillic('ФАИД дизайн'), 'faid dizayn');
assert.strictEqual(transliterateCyrillic('ХТФ химия'), 'htf khimiya');
assert.strictEqual(transliterateCyrillic('съезд щука'), 'sezd shchuka');
console.log('[PASS] transliterateCyrillic correctly handles complex Russian strings and prioritized faculties.');

// 3. Edge Cases & Special Characters Normalization
console.log('\n3. Testing edge cases, spacing, punctuation and dashes...');

const edgeCases: Array<{ input: string; expected: string; desc: string }> = [
  // Spaces
  { input: '   3   ИНГТ   110   ', expected: 'ingt-310', desc: 'Multiple leading, internal, trailing spaces' },
  // Slashes and backslashes
  { input: '3/ИНГТ/110', expected: 'ingt-310', desc: 'Forward slashes' },
  { input: '1\\ХТФ\\215', expected: 'htf-115', desc: 'Backslashes' },
  // Underscores and mixed symbols
  { input: '__25_ингт__101_м__', expected: '25-ingt-101-m', desc: 'Underscores (master group, translit slug)' },
  { input: '3-ИНГТ-110 (очно)', expected: 'ingt-310', desc: 'Parentheses tail stripped like the LK parser does' },
  { input: 'Группа #42 [ИТФ]', expected: '42', desc: 'Группа-prefix and bracket tail stripped; hash becomes a boundary' },
  // Consecutive hyphens and boundaries
  { input: '----3-----ИНГТ-----110----', expected: 'ingt-310', desc: 'Consecutive and boundary hyphens' },
  // Empty, null-like and purely symbolic inputs
  { input: '', expected: '', desc: 'Empty string' },
  { input: '    ', expected: '', desc: 'Only spaces' },
  { input: '---', expected: '', desc: 'Only hyphens' },
  { input: '!@#$%^&*()', expected: '', desc: 'Purely special non-alphanumeric characters' }
];

for (const { input, expected, desc } of edgeCases) {
  const result = makeGroupId(input);
  assert.strictEqual(result, expected, `Edge case failed for ${desc}: got "${result}", expected "${expected}"`);
  if (result.length > 0) {
    assert(isValidGroupId(result), `Edge case produced invalid ID for ${desc}: "${result}"`);
  }
}
console.log(`[PASS] All ${edgeCases.length} edge cases properly sanitized into strict [a-z0-9-].`);

// 4. Strict Validation Helper (isValidGroupId)
console.log('\n4. Testing isValidGroupId validation...');
const validIds = ['ingt-310', '25ingt-101m', 'faid-110', 'htf-215', 'a', 'group-1', '123-abc'];
for (const id of validIds) {
  assert(isValidGroupId(id), `Should be valid: "${id}"`);
}

const invalidIds = [
  '',
  '   ',
  '3-ИНГТ-110',    // Cyrillic uppercase
  'ingt_310',      // Underscore
  'ingt.310',      // Dot
  'ingt/310',      // Slash
  'ingt 310',      // Space
  'INGT-310',      // Uppercase Latin
  'ingt@310',      // Special characters
  null as unknown as string,
  undefined as unknown as string,
  12345 as unknown as string
];

for (const id of invalidIds) {
  assert(!isValidGroupId(id), `Should be invalid: "${id}"`);
}
console.log(`[PASS] isValidGroupId strictly permits only /^[a-z0-9-]+$/ and rejects invalid types.`);

console.log('\n=================================================');
console.log('  ALL GROUP ID NORMALIZATION TESTS PASSED (100%)');
console.log('=================================================\n');
