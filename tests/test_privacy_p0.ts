import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeGroupId, CANONICAL_GROUP_ALIASES } from '../utils/groupAliases';
import { pushGroupCloudData, fetchGroupCloudData, getLocalBackup } from '../utils/cloudSync';
import { claimStaffRole, getLocalStudents, saveLocalStudents } from '../utils/attendanceStorage';
import { verifyPinCode } from '../utils/auth';
import { Student } from '../types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('================================================================');
console.log('   P0-01, P0-02, P0-18 & B-05 PRIVACY & AUTH VERIFICATION      ');
console.log('================================================================\n');

// In-memory localStorage mock for node environment
const originalLocalStorage = (globalThis as any).localStorage;
const originalFetch = globalThis.fetch;

class MockLocalStorage {
  private data: Record<string, string> = {};
  getItem(key: string): string | null {
    return this.data[key] ?? null;
  }
  setItem(key: string, val: string): void {
    this.data[key] = String(val);
  }
  removeItem(key: string): void {
    delete this.data[key];
  }
  clear(): void {
    this.data = {};
  }
}

const mockStorage = new MockLocalStorage();
(globalThis as any).localStorage = mockStorage;
export async function runPrivacyP0Tests() {
  (globalThis as any).localStorage = mockStorage;
  if (typeof window !== 'undefined') {
    (window as any).localStorage = mockStorage;
  }
  try {
  // =================================================================
  // SUITE 1: P0-18 Canonical Group Aliases & Exact Matching
  // =================================================================
  console.log('--- 1. Testing P0-18 Canonical Aliases & Exact Normalization ---');

  // Verify canonical dictionary contains essential target mappings
  assert.strictEqual(CANONICAL_GROUP_ALIASES['3-фаид-110'], 'faid-310');
  assert.strictEqual(CANONICAL_GROUP_ALIASES['3-ингт-110'], 'ingt-310');
  assert.strictEqual(CANONICAL_GROUP_ALIASES['2-хтф-115'], 'htf-215');

  // Exact alias normalization
  const aliasExpectations: Record<string, string> = {
    '3-фаид-110': 'faid-310',
    '3-faid-110': 'faid-310',
    '3 фаид 110': 'faid-310',
    'фаид-110': 'faid-310',
    'faid-110': 'faid-310',
    '24фад-110': 'faid-310',
    '3-ингт-110': 'ingt-310',
    '3-ingt-110': 'ingt-310',
    '3-ингт-111': 'ingt-311',
    '3-ingt-111': 'ingt-311',
    '3-ингт-113': 'ingt-313',
    '3-ingt-113': 'ingt-313',
    '2-ингт-109': 'ingt-209',
    '2-хтф-115': 'htf-215',
    '2-htf-115': 'htf-215',
    '2 хтф 115': 'htf-215',
    'хтф-115': 'htf-215',
    'htf-115': 'htf-215',
  };

  for (const [raw, expected] of Object.entries(aliasExpectations)) {
    assert.strictEqual(normalizeGroupId(raw), expected, `Alias ${raw} must map to ${expected}`);
  }

  // Whitespace and case insensitivity
  assert.strictEqual(normalizeGroupId('  3-ФАИД-110  '), 'faid-310');
  assert.strictEqual(normalizeGroupId('  3-ИНГТ-113\n'), 'ingt-313');
  assert.strictEqual(normalizeGroupId(' 2-ХТФ-115 '), 'htf-215');

  // Anti-collision / No substring (.includes) matching:
  // Distinct groups that contain substrings of aliases MUST NEVER be corrupted
  const distinctGroups = [
    'faid-210',
    'faid-410',
    'faid-111',
    'ingt-210',
    'ingt-410',
    'htf-101',
    'htf-315',
    'custom-group-1',
    'faid-110-special'
  ];

  for (const g of distinctGroups) {
    assert.strictEqual(normalizeGroupId(g), g, `Group ${g} must NOT be altered by alias normalization`);
  }

  // Edge cases
  assert.strictEqual(normalizeGroupId(''), '');
  assert.strictEqual(normalizeGroupId(null as any), '');
  assert.strictEqual(normalizeGroupId(undefined as any), '');

  console.log('  ✅ PASS: P0-18 normalizeGroupId strictly enforces exact aliases with zero substring collation bugs.\n');

  // =================================================================
  // SUITE 2: P0-01 Zero Student PII Leakage to Cloud
  // =================================================================
  console.log('--- 2. Testing P0-01 Client Roster Privacy (Zero Cloud Leakage) ---');

  const testGroup = 'ingt-310';
  const sampleStudents: Student[] = [
    { id: 1, name: 'Иванов Иван Иванович' },
    { id: 2, name: 'Петров Петр Петрович' }
  ];

  // 2.1 Local roster storage
  mockStorage.clear();
  saveLocalStudents(testGroup, sampleStudents);
  const loaded = getLocalStudents(testGroup);
  assert.strictEqual(loaded.length, 2, 'Local students stored in localStorage');
  assert.strictEqual(loaded[0].name, 'Иванов Иван Иванович');

  // 2.2 getLocalBackup must NOT contain student PII
  const backup = getLocalBackup(testGroup);
  assert.strictEqual((backup as any).students, undefined, 'getLocalBackup must never include students property');

  // 2.3 pushGroupCloudData must never call /sync/attendance or send student records
  const networkRequests: { url: string; method: string; body?: any }[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url: any, opts: any) => {
    const urlStr = String(url);
    const method = (opts?.method || 'GET').toUpperCase();
    let parsedBody: any = null;
    if (opts?.body) {
      try {
        parsedBody = typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body;
      } catch {
        parsedBody = opts.body;
      }
    }
    networkRequests.push({ url: urlStr, method, body: parsedBody });

    // Mock successful cloud response for schedule/hw
    return new Response(JSON.stringify({ status: 0, payload: JSON.stringify({ byGroup: {} }), updatedAt: Date.now() }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    // Attempt to push with injected student data
    await pushGroupCloudData({
      homework: [],
      scheduleOverrides: {},
      subjectTeachers: {},
      attendance: [{ docId: 'a1', groupId: testGroup, date: '2026-09-01', lessonId: 'l1', absentStudentIds: [1] }],
      students: sampleStudents
    } as any, testGroup);

    // Verify requests made by pushGroupCloudData
    for (const req of networkRequests) {
      assert(!req.url.includes('/sync/attendance'), `pushGroupCloudData must NOT call /sync/attendance: ${req.url}`);
      const bodyStr = JSON.stringify(req.body || '');
      assert(!bodyStr.includes('Иванов Иван Иванович'), 'Student names must NEVER be sent in push payload');
      assert(!bodyStr.includes('Петров Петр Петрович'), 'Student names must NEVER be sent in push payload');
    }

    // 2.4 fetchGroupCloudData must never return students
    const fetched = await fetchGroupCloudData(false, testGroup);
    assert.strictEqual((fetched as any).students, undefined, 'fetchGroupCloudData must never return students');

    console.log('  ✅ PASS: P0-01 Verified zero student personal data is leaked to cloud sync endpoints.\n');
  } finally {
    globalThis.fetch = originalFetch;
  }

  // =================================================================
  // SUITE 3: P0-02 & B-05 Auth: /auth/pin Retired -> /v3/staff/claim
  // =================================================================
  console.log('--- 3. Testing P0-02 & B-05 Auth Migration to /v3/staff/claim ---');

  const authRequests: { url: string; method: string; body?: any; headers?: any }[] = [];
  const authFetch = globalThis.fetch;

  globalThis.fetch = async (url: any, opts: any) => {
    const urlStr = String(url);
    const method = (opts?.method || 'GET').toUpperCase();
    let parsedBody: any = null;
    if (opts?.body) {
      try {
        parsedBody = typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body;
      } catch {
        parsedBody = opts.body;
      }
    }
    authRequests.push({ url: urlStr, method, body: parsedBody, headers: opts?.headers });

    if (urlStr.includes('/v3/staff/claim')) {
      return new Response(JSON.stringify({ ok: true, role: parsedBody?.role || 'elder', gid: parsedBody?.gid || testGroup }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (urlStr.includes('/auth/pin')) {
      return new Response(JSON.stringify({ error: 'Endpoint retired' }), { status: 404 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    // 3.1 claimStaffRole for starosta
    const claimElderRes = await claimStaffRole('ingt-310', 'TEST-CODE-1234');
    assert.strictEqual(claimElderRes.ok, true, 'claimStaffRole succeeds for starosta');

    // 3.2 claimStaffRole for admin
    const claimAdminRes = await claimStaffRole('ADMIN-PASS-9999', 'admin');
    assert.strictEqual(claimAdminRes.ok, true, 'claimStaffRole succeeds for admin');

    // 3.3 verifyPinCode backward-compat delegation
    const verifyPinRes = await verifyPinCode('TEST-CODE-1234', 'ingt-310');
    assert(verifyPinRes !== null, 'verifyPinCode routes via claimStaffRole');
    assert(['starosta', 'elder'].includes(verifyPinRes.role), `Expected starosta or elder role, got ${verifyPinRes.role}`);

    // Verify all requests hit /v3/staff/claim and ZERO hit /auth/pin
    for (const req of authRequests) {
      assert(!req.url.includes('/auth/pin'), `Client must NEVER call /auth/pin: ${req.url}`);
      assert(req.url.includes('/v3/staff/claim'), `Auth requests must route to /v3/staff/claim: ${req.url}`);
    }

    console.log('  ✅ PASS: P0-02 Client auth strictly targets /v3/staff/claim with zero calls to /auth/pin.\n');
  } finally {
    globalThis.fetch = authFetch;
  }

  // =================================================================
  // SUITE 4: B-05 & P0-02 UI & Client Source Code Audit
  // =================================================================
  console.log('--- 4. Static Codebase Audit: Visible UI Terminology & Dead /auth/pin ---');

  const adminPanelSrc = fs.readFileSync(path.resolve(rootDir, 'components/AdminPanel.tsx'), 'utf-8');
  const maintenanceSrc = fs.readFileSync(path.resolve(rootDir, 'components/MaintenanceScreen.tsx'), 'utf-8');
  const appSrc = fs.readFileSync(path.resolve(rootDir, 'App.tsx'), 'utf-8');
  const authSrc = fs.readFileSync(path.resolve(rootDir, 'utils/auth.ts'), 'utf-8');

  // Verify /auth/pin is removed from all client sources
  assert(!adminPanelSrc.includes('/auth/pin'), 'AdminPanel.tsx must not contain /auth/pin');
  assert(!maintenanceSrc.includes('/auth/pin'), 'MaintenanceScreen.tsx must not contain /auth/pin');
  assert(!appSrc.includes('/auth/pin'), 'App.tsx must not contain /auth/pin');
  assert(!authSrc.includes('/auth/pin'), 'utils/auth.ts must not contain /auth/pin');

  // Verify visible UI labels use "код доступа" and placeholder XXXX-XXXX-XXXX-XXXX
  assert(adminPanelSrc.includes('код доступа'), 'AdminPanel.tsx must use "код доступа" in UI');
  assert(adminPanelSrc.includes('XXXX-XXXX-XXXX-XXXX'), 'AdminPanel.tsx must use placeholder XXXX-XXXX-XXXX-XXXX');
  assert(!adminPanelSrc.includes('PIN-код'), 'AdminPanel.tsx must not contain user-facing "PIN-код"');

  assert(maintenanceSrc.includes('код доступа'), 'MaintenanceScreen.tsx must use "код доступа" in UI');
  assert(maintenanceSrc.includes('XXXX-XXXX-XXXX-XXXX'), 'MaintenanceScreen.tsx must use placeholder XXXX-XXXX-XXXX-XXXX');
  assert(!maintenanceSrc.includes('PIN-код'), 'MaintenanceScreen.tsx must not contain user-facing "PIN-код"');

  assert(!appSrc.includes('PIN-код старосты'), 'App.tsx must not contain user-facing "PIN-код старосты"');
  assert(appSrc.includes('Код доступа старосты') || appSrc.includes('код доступа'), 'App.tsx must use "код доступа"');

  // Verify App.tsx no longer uploads student roster to cloud
  assert(!appSrc.includes('pushGroupCloudData({ students'), 'App.tsx must not upload students in pushGroupCloudData');

  console.log('  ✅ PASS: Static audit confirms zero /auth/pin references and clean "код доступа" UI wording.\n');

  console.log('================================================================');
  console.log('   ALL PRIVACY (P0-01, P0-02, P0-18, B-05) TESTS PASSED! 🎉   ');
  console.log('================================================================\n');
  } finally {
    (globalThis as any).localStorage = originalLocalStorage;
    if (typeof window !== 'undefined') {
      (window as any).localStorage = originalLocalStorage;
    }
    globalThis.fetch = originalFetch;
  }
}

await runPrivacyP0Tests();
