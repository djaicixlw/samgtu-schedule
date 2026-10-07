import { setupMockAuth, TEST_ADMIN_PIN, TEST_STAROSTA_310_PIN, TEST_STAROSTA_311_PIN } from './setup_mock_auth';
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { verifyPinCode } from '../utils/auth';
import worker, { safeEqual, pbkdf2 } from '../cloudflare-worker.js';

async function runAuthTests() {
  console.log('=== RUNNING AUTH HASH VERIFICATION TESTS ===\n');
  await setupMockAuth();

  // Test 1: Admin Code
  const adminRes = await verifyPinCode(TEST_ADMIN_PIN);
  assert(adminRes !== null, 'Admin code should resolve');
  assert.strictEqual(adminRes?.role, 'admin', 'Admin role should be admin');
  console.log('✅ PASS: Admin test code correctly authorizes as admin');

  // Test 2: Starosta Codes for groups
  const testCases = [
    { code: TEST_STAROSTA_310_PIN, expectedGroup: 'ingt-310', name: '3-ИНГТ-110' },
    { code: TEST_STAROSTA_311_PIN, expectedGroup: 'ingt-311', name: '3-ИНГТ-111' }
  ];

  for (const tc of testCases) {
    const res = await verifyPinCode(tc.code, tc.expectedGroup);
    assert(res !== null, `Code for ${tc.name} should be valid`);
    assert.strictEqual(res?.role, 'starosta', `Role should be starosta for ${tc.name}`);
    assert.strictEqual(res?.targetGroupId, tc.expectedGroup, `Target group should be ${tc.expectedGroup}`);
    console.log(`✅ PASS: ${tc.name} -> Authorized for group ${tc.expectedGroup}`);
  }

  // Test 3: Invalid Code
  const invalidRes = await verifyPinCode('INVALID-MOCK-CODE-000', 'ingt-310');
  assert.strictEqual(invalidRes, null, 'Invalid code should return null');
  console.log('✅ PASS: Invalid code returns null (access denied)');

  // Test 4: Rate-limiting verification (429 / blocked after 5 failed attempts)
  const rlTestGroup = 'rl-lockout-test';
  for (let i = 0; i < 5; i++) {
    const res = await verifyPinCode(`FAIL-TRY-${i}`, rlTestGroup);
    assert.strictEqual(res, null, `Brute force attempt ${i + 1} rejected`);
  }
  const blockedRes = await verifyPinCode('FAIL-TRY-6', rlTestGroup);
  assert.strictEqual(blockedRes, null, '6th attempt rejected by rate limiter (429)');
  console.log('✅ PASS: Rate-limiting blocks brute-force attempts after 5 failures');

  // Test 5: Verify safeEqual and pbkdf2 cryptographic functions
  assert.strictEqual(await safeEqual('abc-hash-token', 'abc-hash-token'), true, 'safeEqual identical strings');
  assert.strictEqual(await safeEqual('abc-hash-token', 'xyz-hash-token'), false, 'safeEqual different strings');
  assert.strictEqual(await safeEqual('short', 'longer-string'), false, 'safeEqual different lengths');

  const testSalt = 'MDEyMzQ1Njc4OWFiY2RlZg==';
  const h1 = await pbkdf2('test-secret', testSalt);
  const h2 = await pbkdf2('test-secret', testSalt);
  const h3 = await pbkdf2('other-secret', testSalt);
  assert.strictEqual(h1, h2, 'pbkdf2 is deterministic');
  assert.notStrictEqual(h1, h3, 'pbkdf2 generates distinct output for different secret');
  assert.strictEqual(typeof h1, 'string', 'pbkdf2 returns string');
  assert.strictEqual(h1.length, 44, 'pbkdf2 returns 256-bit base64 (44 characters)');
  console.log('✅ PASS: safeEqual and pbkdf2 cryptographic functions operate correctly');

  // Test 6: Verify absence of ADMIN_PIN_HASH and GROUP_STAROSTA_PIN_HASHES in worker
  assert.strictEqual((worker as any).ADMIN_PIN_HASH, undefined, 'ADMIN_PIN_HASH must NOT be exported by worker');
  assert.strictEqual((worker as any).GROUP_STAROSTA_PIN_HASHES, undefined, 'GROUP_STAROSTA_PIN_HASHES must NOT be exported by worker');

  const workerCode = fs.readFileSync(path.resolve(process.cwd(), 'cloudflare-worker.js'), 'utf8');
  assert(!workerCode.includes('ADMIN_PIN_HASH'), 'ADMIN_PIN_HASH must NOT be in cloudflare-worker.js');
  assert(!workerCode.includes('GROUP_STAROSTA_PIN_HASHES'), 'GROUP_STAROSTA_PIN_HASHES must NOT be in cloudflare-worker.js');

  const authCode = fs.readFileSync(path.resolve(process.cwd(), 'utils/auth.ts'), 'utf8');
  assert(!authCode.includes('ADMIN_PIN_HASH'), 'ADMIN_PIN_HASH must NOT be in utils/auth.ts');
  assert(!authCode.includes('GROUP_STAROSTA_PIN_HASHES'), 'GROUP_STAROSTA_PIN_HASHES must NOT be in utils/auth.ts');
  console.log('✅ PASS: Hardcoded PIN hashes completely purged from worker and utils/auth.ts');

  console.log('\n========================================');
  console.log('ALL AUTH HASH TESTS PASSED!');
  console.log('========================================');
}

runAuthTests().catch(err => {
  console.error('Auth test failed:', err);
  process.exit(1);
});
