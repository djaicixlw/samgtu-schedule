import assert from 'assert';
import { makeGroupId, isValidGroupId, transliterateCyrillic } from '../utils/groupId';
import { AVAILABLE_GROUPS } from '../constants';

console.log('=== TEST SUITE: Group ID Normalization, Transliteration & Validation ===\n');

// 1. Transliteration Tests for standard and custom groups
console.log('1. Testing Cyrillic transliteration and canonical group IDs...');

const translitCases: Array<{ input: string; expected: string; desc: string }> = [
  { input: '3-ИНГТ-110', expected: '3-ingt-110', desc: 'Standard 3-ИНГТ-110' },
  { input: '25ингт-101м', expected: '25ingt-101m', desc: 'Master group 25ингт-101м with suffix "м"' },
  { input: '1-ХТФ-215', expected: '1-htf-215', desc: 'Faculty ХТФ abbreviation' },
  { input: '3-ФАИД-110', expected: '3-faid-110', desc: 'Faculty ФАИД abbreviation' },
  { input: '2-ИАИТ-108', expected: '2-iait-108', desc: 'Faculty ИАИТ abbreviation' },
  { input: '4-ФММТ-101', expected: '4-fmmt-101', desc: 'Faculty ФММТ abbreviation' },
  { input: '1-АСА-101', expected: '1-asa-101', desc: 'Faculty АСА abbreviation' },
  { input: '2-ЭТФ-101', expected: '2-etf-101', desc: 'Faculty ЭТФ abbreviation' },
  { input: '3-ТЭФ-101', expected: '3-tef-101', desc: 'Faculty ТЭФ abbreviation' },
  { input: '1-ИТФ-101', expected: '1-itf-101', desc: 'Faculty ИТФ abbreviation' },
  { input: '5-ФПП-101', expected: '5-fpp-101', desc: 'Faculty ФПП abbreviation' },
  { input: '1-ИИЭГО-101', expected: '1-iiego-101', desc: 'Faculty ИИЭГО abbreviation' }
];

for (const { input, expected, desc } of translitCases) {
  const result = makeGroupId(input);
  assert.strictEqual(result, expected, `Transliteration failed for ${desc}: got "${result}", expected "${expected}"`);
  assert.strictEqual(isValidGroupId(result), true, `Result "${result}" for ${desc} must be a valid group ID`);
}
console.log(`  [PASS] All ${translitCases.length} standard transliteration cases passed successfully.`);

// 2. Validation of all existing groups in constants.ts
console.log('\n2. Testing all existing groups in AVAILABLE_GROUPS from constants.ts...');

assert(AVAILABLE_GROUPS && AVAILABLE_GROUPS.length > 0, 'AVAILABLE_GROUPS must not be empty');
console.log(`  Found ${AVAILABLE_GROUPS.length} groups in AVAILABLE_GROUPS.`);

for (const grp of AVAILABLE_GROUPS) {
  assert(
    isValidGroupId(grp.id),
    `Group id "${grp.id}" in AVAILABLE_GROUPS must pass isValidGroupId check`
  );
  // makeGroupId on an already canonical id must be idempotent
  assert.strictEqual(
    makeGroupId(grp.id),
    grp.id,
    `makeGroupId on "${grp.id}" must be idempotent`
  );
}
console.log(`  [PASS] All ${AVAILABLE_GROUPS.length} groups in AVAILABLE_GROUPS strictly conform to /^[a-z0-9-]+$/ format.`);

// 3. Edge cases handling in makeGroupId
console.log('\n3. Testing edge cases in makeGroupId (spaces, slashes, mixed symbols, duplicate hyphens)...');

const edgeCases: Array<{ input: string; expected: string; desc: string }> = [
  // Spaces
  { input: '   3   ИНГТ   110   ', expected: '3-ingt-110', desc: 'Multiple leading, internal, trailing spaces' },
  // Slashes and backslashes
  { input: '3/ИНГТ/110', expected: '3-ingt-110', desc: 'Forward slashes' },
  { input: '1\\ХТФ\\215', expected: '1-htf-215', desc: 'Backslashes' },
  // Underscores and mixed symbols
  { input: '__25_ингт__101_м__', expected: '25-ingt-101-m', desc: 'Underscores' },
  { input: '3-ИНГТ-110 (очно)', expected: '3-ingt-110-ochno', desc: 'Parentheses and Cyrillic word' },
  { input: 'Группа #42 [ИТФ]', expected: 'gruppa-42-itf', desc: 'Hash and square brackets' },
  // Consecutive hyphens and boundaries
  { input: '----3-----ИНГТ-----110----', expected: '3-ingt-110', desc: 'Consecutive and boundary hyphens' },
  // Empty, null-like and purely symbolic inputs
  { input: '', expected: '', desc: 'Empty string' },
  { input: '    ', expected: '', desc: 'Only spaces' },
  { input: '---/@@@---', expected: '', desc: 'Only symbols' },
  // Non-Russian Latin characters and numbers
  { input: 'custom-stream-2026', expected: 'custom-stream-2026', desc: 'Already valid Latin string' }
];

for (const { input, expected, desc } of edgeCases) {
  const result = makeGroupId(input);
  assert.strictEqual(result, expected, `Edge case failed for ${desc}: got "${result}", expected "${expected}"`);
  if (result.length > 0) {
    assert.strictEqual(isValidGroupId(result), true, `Edge case output "${result}" for ${desc} must be valid`);
  }
}
console.log(`  [PASS] All ${edgeCases.length} edge cases handled cleanly.`);

// 4. Strict format testing for isValidGroupId
console.log('\n4. Testing strict format matching in isValidGroupId (/^[a-z0-9-]+$/)...');

const validIds = [
  'ingt-310',
  '3-ingt-110',
  '25ingt-101m',
  '1-htf-215',
  'iait-308',
  'group-1',
  'a',
  '123',
  'stream-a-b-c'
];

for (const id of validIds) {
  assert.strictEqual(isValidGroupId(id), true, `"${id}" should be valid`);
}

const invalidIds: any[] = [
  '',
  '   ',
  'INGT-310',          // Uppercase Latin
  '3-ИНГТ-110',        // Cyrillic
  'ingt 310',          // Space
  'ingt/310',          // Slash
  'ingt_310',          // Underscore
  'ingt.310',          // Dot
  'ingt@310',          // Special symbol
  'ingt#310',          // Hash
  null,
  undefined,
  123,
  {},
  []
];

for (const id of invalidIds) {
  assert.strictEqual(
    isValidGroupId(id),
    false,
    `Value ${JSON.stringify(id)} should NOT be valid`
  );
}
console.log('  [PASS] isValidGroupId correctly accepts only /^[a-z0-9-]+$/ strings and rejects invalid inputs.');

console.log('\n=================================================');
console.log('   ALL GROUP ID TESTS PASSED SUCCESSFULLY (100%)');
console.log('=================================================\n');
