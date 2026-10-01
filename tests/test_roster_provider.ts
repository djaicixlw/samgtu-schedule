import assert from 'node:assert';
import { Student } from '../types';
import { RosterProvider, LocalCloudRosterProvider, defaultRosterProvider } from '../utils/rosterProvider';
import { STUDENTS_REGISTRY } from '../attendance';

console.log('================================================================');
console.log('   STARTING ROSTER PROVIDER & 152-FZ COMPLIANCE TESTS          ');
console.log('================================================================\n');

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string): void { this.store.set(k, String(v)); }
  removeItem(k: string): void { this.store.delete(k); }
  clear(): void { this.store.clear(); }
}

const mockLocalStorage = new MemoryStorage();
(globalThis as any).localStorage = mockLocalStorage;
if (typeof window !== 'undefined') {
  (window as any).localStorage = mockLocalStorage;
}

// ----------------------------------------------------
// 1. MockRosterProvider implementation (Anonymized Data)
// ----------------------------------------------------
export class MockRosterProvider implements RosterProvider {
  private storage = new Map<string, Student[]>();

  constructor(seed?: Record<string, Student[]>) {
    if (seed) {
      for (const [group, students] of Object.entries(seed)) {
        this.storage.set(group, [...students]);
      }
    }
  }

  async getRoster(groupId: string): Promise<Student[]> {
    return this.storage.get(groupId) || [];
  }

  async saveRoster(groupId: string, students: Student[]): Promise<boolean> {
    this.storage.set(groupId, [...students]);
    return true;
  }
}

// Mock Cloud Data
let mockCloudBin: any = {
  byGroup: {
    'test-group-cloud': {
      students: [
        { id: 101, name: 'Синтетический Студент 1' },
        { id: 102, name: 'Синтетический Студент 2' }
      ],
      records: [],
      updatedAt: Date.now()
    }
  }
};

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url: any, opts: any) => {
  const urlStr = String(url);
  const method = (opts?.method || 'GET').toUpperCase();

  if (urlStr.includes('/sync/attendance') || urlStr.includes('cdaacff')) {
    if (method === 'PUT') {
      const body = JSON.parse(opts.body);
      const payload = typeof body.payload === 'string' ? JSON.parse(body.payload) : body;
      mockCloudBin = payload;
      return new Response(JSON.stringify({ status: 0, data: 'OK' }), { status: 200 });
    }
    return new Response(JSON.stringify({ payload: JSON.stringify(mockCloudBin), updatedAt: Date.now() }), { status: 200 });
  }

  return new Response(JSON.stringify({ payload: JSON.stringify({ byGroup: {} }), updatedAt: Date.now() }), { status: 200 });
};

async function runRosterProviderTests() {
  // ----------------------------------------------------
  // TEST 1: MockRosterProvider (152-FZ Synthetic Data Isolation)
  // ----------------------------------------------------
  console.log('>>> 1. Testing MockRosterProvider with synthetic anonymized data (152-FZ safe)');
  const syntheticStudents: Student[] = [
    { id: 1, name: 'Синтетический Студент Альфа' },
    { id: 2, name: 'Синтетический Студент Бета' }
  ];

  const mockProvider = new MockRosterProvider({
    'synth-101': syntheticStudents
  });

  const fetched = await mockProvider.getRoster('synth-101');
  assert.strictEqual(fetched.length, 2, 'Mock provider returns seeded synthetic students');
  assert.strictEqual(fetched[0].name, 'Синтетический Студент Альфа');

  const emptyRoster = await mockProvider.getRoster('non-existent');
  assert.deepStrictEqual(emptyRoster, [], 'Non-existent group returns empty roster');

  const saveOk = await mockProvider.saveRoster('synth-101', [
    ...syntheticStudents,
    { id: 3, name: 'Синтетический Студент Гамма' }
  ]);
  assert.strictEqual(saveOk, true, 'saveRoster returns true');
  const updatedRoster = await mockProvider.getRoster('synth-101');
  assert.strictEqual(updatedRoster.length, 3, 'Roster update confirmed');
  console.log('✅ PASS: MockRosterProvider fully functional without real PII.\n');

  // ----------------------------------------------------
  // TEST 2: LocalCloudRosterProvider Tier 1 (localStorage cache hit)
  // ----------------------------------------------------
  console.log('>>> 2. Testing LocalCloudRosterProvider Tier 1: LocalStorage cache hit');
  const provider = new LocalCloudRosterProvider();
  mockLocalStorage.clear();

  const cachedStudents: Student[] = [
    { id: 10, name: 'Тестовый Обучающийся 1' },
    { id: 11, name: 'Тестовый Обучающийся 2' }
  ];
  mockLocalStorage.setItem('students_test-group-local', JSON.stringify(cachedStudents));

  const localRes = await provider.getRoster('test-group-local');
  assert.strictEqual(localRes.length, 2, 'Retrieved cached students directly from localStorage');
  assert.strictEqual(localRes[0].name, 'Тестовый Обучающийся 1');
  console.log('✅ PASS: Local storage tier serves roster with zero network latency.\n');

  // ----------------------------------------------------
  // TEST 3: LocalCloudRosterProvider Tier 2 (Cloud fetch fallback and cache backfill)
  // ----------------------------------------------------
  console.log('>>> 3. Testing LocalCloudRosterProvider Tier 2: Cloud fetch & cache backfill');
  assert.strictEqual(mockLocalStorage.getItem('students_test-group-cloud'), null, 'Local cache starts empty for test-group-cloud');

  const cloudRes = await provider.getRoster('test-group-cloud');
  assert.strictEqual(cloudRes.length, 2, 'Fetched 2 students from cloud mock');
  assert.strictEqual(cloudRes[0].name, 'Синтетический Студент 1');

  // Verify backfilled localStorage
  const backfilled = JSON.parse(mockLocalStorage.getItem('students_test-group-cloud') || '[]');
  assert.strictEqual(backfilled.length, 2, 'Local storage automatically backfilled from cloud');
  assert.strictEqual(backfilled[1].name, 'Синтетический Студент 2');
  console.log('✅ PASS: Cloud tier resolves missing roster and populates local cache.\n');

  // ----------------------------------------------------
  // TEST 4: LocalCloudRosterProvider Tier 3 (Static registry fallback)
  // ----------------------------------------------------
  console.log('>>> 4. Testing LocalCloudRosterProvider Tier 3: Static registry fallback');
  mockLocalStorage.removeItem('students_ingt-310');
  // For ingt-310, static registry has 16 students
  const ingt310Res = await provider.getRoster('ingt-310');
  assert(ingt310Res.length > 0, 'Falls back to STUDENTS_REGISTRY for built-in groups');
  assert.strictEqual(ingt310Res.length, STUDENTS_REGISTRY['ingt-310'].length);

  const unknownRes = await provider.getRoster('completely-unknown-group');
  assert.deepStrictEqual(unknownRes, [], 'Unknown group with no cloud data returns empty array');
  console.log('✅ PASS: Static registry fallback behaves reliably.\n');

  // ----------------------------------------------------
  // TEST 5: LocalCloudRosterProvider saveRoster (Dual storage write & cloud dispatch)
  // ----------------------------------------------------
  console.log('>>> 5. Testing LocalCloudRosterProvider saveRoster (local & cloud dispatch)');
  const newRoster: Student[] = [
    { id: 201, name: 'Студент Сохранения 1' },
    { id: 202, name: 'Студент Сохранения 2' }
  ];
  const saveSuccess = await provider.saveRoster('test-save-group', newRoster);
  assert.strictEqual(saveSuccess, true, 'saveRoster returns true');

  const savedLocal = JSON.parse(mockLocalStorage.getItem('students_test-save-group') || '[]');
  assert.strictEqual(savedLocal.length, 2, 'Roster saved to localStorage');
  assert.strictEqual(savedLocal[0].name, 'Студент Сохранения 1');

  // Verify cloud received payload
  assert(mockCloudBin.byGroup['test-save-group'] !== undefined, 'Cloud received updated group');
  assert.strictEqual(mockCloudBin.byGroup['test-save-group'].students.length, 2, 'Cloud contains saved roster');
  console.log('✅ PASS: Dual persistence (local + cloud) verified successfully.\n');

  // ----------------------------------------------------
  // TEST 6: Error handling & Resilience
  // ----------------------------------------------------
  console.log('>>> 6. Testing Error Handling & Fault Resilience');
  // Corrupt local storage JSON
  mockLocalStorage.setItem('students_corrupt-group', '{invalid json---');
  const corruptRes = await provider.getRoster('corrupt-group');
  assert.deepStrictEqual(corruptRes, [], 'Gracefully recovers from corrupt localStorage JSON');

  // Empty groupId handling
  const emptyGroupRes = await provider.getRoster('');
  assert.deepStrictEqual(emptyGroupRes, [], 'Empty groupId returns empty array safely');
  const emptySaveRes = await provider.saveRoster('', []);
  assert.strictEqual(emptySaveRes, false, 'Saving with empty groupId safely returns false');

  // Verify default exported provider singleton
  assert(defaultRosterProvider !== undefined, 'defaultRosterProvider singleton exists');
  assert(typeof defaultRosterProvider.getRoster === 'function', 'getRoster method available');
  console.log('✅ PASS: Error handling and boundary conditions passed.\n');

  console.log('================================================================');
  console.log('   ALL ROSTER PROVIDER TESTS PASSED (6/6) 🎉                   ');
  console.log('================================================================\n');
}

try {
  await runRosterProviderTests();
} catch (err) {
  console.error('RosterProvider test failed:', err);
  process.exit(1);
} finally {
  globalThis.fetch = originalFetch;
}
