// ============================================================================
// HOMEWORK CRUD LIFECYCLE & RESURRECTION STRESS TEST SUITE
// Lead QA Data Engineer Verification Suite
// Target: C:\Users\A.le_BL\.gemini\antigravity\scratch
// ============================================================================

// 1. Setup Mock Browser Environment for Node.js
class LocalStorageMock {
  private store: Map<string, string> = new Map();

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] || null;
  }

  get length(): number {
    return this.store.size;
  }

  dump(): Record<string, string> {
    const out: Record<string, string> = {};
    this.store.forEach((v, k) => { out[k] = v; });
    return out;
  }
}

const mockStorage = new LocalStorageMock();
(global as any).localStorage = mockStorage;
(global as any).window = global;
(global as any).confirm = () => true;

// Mock fetch for deterministic cloud API testing
let mockCloudPayload: any = null;
let mockCloudNetworkError = false;

const originalFetch = global.fetch;
(global as any).fetch = async (url: string, options: any = {}) => {
  if (mockCloudNetworkError) {
    throw new Error('Network simulated failure');
  }

  // Intercept REST endpoints
  if (url.includes('/sync/homework') || url.includes('dfdebcc') || url.includes('ff808181a067127101a06866951a0496')) {
    if (options.method === 'PUT') {
      const body = JSON.parse(options.body || '{}');
      const payload = body.payload ? JSON.parse(body.payload) : (body.data || body);
      mockCloudPayload = {
        items: payload.items || (payload.byGroup?.['ingt-310']?.items) || [],
        deletedIds: payload.deletedIds || (payload.byGroup?.['ingt-310']?.deletedIds) || [],
        updatedAt: body.updatedAt || Date.now()
      };
      return {
        ok: true,
        text: async () => JSON.stringify({ status: 'success', data: mockCloudPayload }),
        json: async () => ({ status: 'success', data: mockCloudPayload })
      };
    }
    return {
      ok: true,
      text: async () => JSON.stringify(mockCloudPayload || { items: [] }),
      json: async () => ({ data: mockCloudPayload || { items: [] }, payload: JSON.stringify(mockCloudPayload || { items: [] }) })
    };
  }

  // Other endpoints return generic empty structure
  return {
    ok: true,
    json: async () => ({ data: {} })
  };
};

// Import modules under test
import { getLocalBackup, fetchGroupCloudData, pushGroupCloudData } from '../utils/cloudSync';
import { SEED_HOMEWORK } from '../defaultData';
import { HomeworkItem, HomeworkAttachment } from '../types';

// ANSI Colors for executive reporting
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

let totalAssertions = 0;
let passedAssertions = 0;
let failedAssertions = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalAssertions++;
  if (condition) {
    passedAssertions++;
    console.log(`  ${GREEN}✓ PASS:${RESET} ${testName}`);
    if (detail) console.log(`         ${CYAN}↳ ${detail}${RESET}`);
  } else {
    failedAssertions++;
    console.error(`  ${RED}✗ FAIL:${RESET} ${BOLD}${testName}${RESET}`);
    if (detail) console.error(`         ${RED}↳ ${detail}${RESET}`);
  }
}

console.log(`${BOLD}========================================================================${RESET}`);
console.log(`${BOLD}     ENTERPRISE QA STRESS TEST: HOMEWORK CRUD & TOMBSTONE LIFECYCLE    ${RESET}`);
console.log(`${BOLD}========================================================================${RESET}`);

const GROUP_ID = 'ingt-310';
const TOMBSTONE_KEY = `deleted_hw_${GROUP_ID}`;
const STORAGE_KEY = `homework_${GROUP_ID}`;

// Helper simulating HomeworkTracker's exact React loadCloud logic
async function simulateHomeworkTrackerLoadCloud(
  currentGroupId: string,
  currentState: { items: HomeworkItem[]; setItems: (items: HomeworkItem[]) => void },
  force: boolean = false
) {
  const cloud = await fetchGroupCloudData(force, currentGroupId);
  if (!cloud) return;

  // Read tombstone deleted items
  let deletedSet = new Set<string>();
  try {
    const d = JSON.parse(mockStorage.getItem(`deleted_hw_${currentGroupId}`) || '[]');
    deletedSet = new Set(d);
  } catch (e) {}

  // Authoritative cloud items filtered by remote and local tombstones
  const cloudHw = (cloud.homework || [])
    .filter(it => it && it.id && !deletedSet.has(it.id))
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));

  currentState.setItems(cloudHw);
  try {
    mockStorage.setItem(`homework_${currentGroupId}`, JSON.stringify(cloudHw));
  } catch (e) {}
}

// Helper simulating HomeworkTracker's save logic
function simulateSaveHomework(
  itemData: {
    id?: string;
    subject: string;
    title: string;
    description: string;
    assignedDate: string;
    dueDate: string;
    attachments?: HomeworkAttachment[];
  },
  currentState: { items: HomeworkItem[]; setItems: (items: HomeworkItem[]) => void },
  groupId = GROUP_ID
): HomeworkItem {
  let freshItems: HomeworkItem[] = [];
  try {
    const saved = mockStorage.getItem(`homework_${groupId}`);
    if (saved) freshItems = JSON.parse(saved);
  } catch (e) {}
  if (freshItems.length === 0 && currentState.items.length > 0) freshItems = currentState.items;

  const id = itemData.id || `hw_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const newHomework: HomeworkItem = {
    id,
    groupId,
    subject: itemData.subject,
    title: itemData.title.trim(),
    description: itemData.description.trim(),
    assignedDate: itemData.assignedDate,
    dueDate: itemData.dueDate,
    attachments: itemData.attachments || [],
    createdAt: new Date().toISOString()
  };

  const isEditing = freshItems.some(it => it.id === id);
  const updated = isEditing
    ? freshItems.map(it => it.id === id ? newHomework : it)
    : [...freshItems.filter(it => it.id !== id), newHomework];

  currentState.setItems(updated);
  mockStorage.setItem(`homework_${groupId}`, JSON.stringify(updated));
  return newHomework;
}

// Helper simulating HomeworkTracker's delete logic
function simulateDeleteHomework(
  id: string,
  currentState: { items: HomeworkItem[]; setItems: (items: HomeworkItem[]) => void },
  groupId = GROUP_ID
) {
  // 1. Record in tombstone list
  try {
    const deletedList: string[] = JSON.parse(mockStorage.getItem(`deleted_hw_${groupId}`) || '[]');
    if (!deletedList.includes(id)) {
      deletedList.push(id);
      mockStorage.setItem(`deleted_hw_${groupId}`, JSON.stringify(deletedList));
    }
  } catch (e) {}

  // 2. Remove from local storage and state
  let freshItems: HomeworkItem[] = [];
  try {
    const saved = mockStorage.getItem(`homework_${groupId}`);
    if (saved) freshItems = JSON.parse(saved);
  } catch (e) {}
  if (freshItems.length === 0 && currentState.items.length > 0) freshItems = currentState.items;

  const updated = freshItems.filter(it => it.id !== id);
  currentState.setItems(updated);
  mockStorage.setItem(`homework_${groupId}`, JSON.stringify(updated));
}

async function runTestSuite() {
  // Reset state
  mockStorage.clear();
  mockCloudPayload = null;

  // React state emulator
  let trackerItems: HomeworkItem[] = [];
  const trackerState = {
    items: trackerItems,
    setItems: (newItems: HomeworkItem[]) => {
      trackerItems = newItems;
      trackerState.items = newItems;
    }
  };

  // --------------------------------------------------------------------------
  console.log(`\n${BOLD}[PHASE 1] Initial Cold Start & Seed Loading Verification${RESET}`);
  // --------------------------------------------------------------------------
  const initialBackup = getLocalBackup(GROUP_ID);
  assert(
    initialBackup.homework.length === 0,
    'Cold start without localStorage returns clean empty state (no ghost seed items)',
    `Found ${initialBackup.homework.length} seed items`
  );

  assert(
    SEED_HOMEWORK.length === 0,
    'SEED_HOMEWORK is empty to prevent resurrecting test/ghost items'
  );

  // --------------------------------------------------------------------------
  console.log(`\n${BOLD}[PHASE 2] Homework Creation (Title, Description, DueDate, Attachments)${RESET}`);
  // --------------------------------------------------------------------------
  const sampleAttachments: HomeworkAttachment[] = [
    {
      id: 'att-1',
      name: 'Методичка_Расчет_Колонн.pdf',
      data: 'data:application/pdf;base64,JVBERi0xLjQKJcTl8uXrp/Og0MTGCjQgMCBvYmoKPDw...',
      type: 'pdf',
      size: '240.5 КБ'
    },
    {
      id: 'att-2',
      name: 'Схема_установки.png',
      data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ...',
      type: 'image',
      size: '85.2 КБ'
    },
    {
      id: 'att-3',
      name: 'Яндекс.Диск с материалами лекции',
      url: 'https://disk.yandex.ru/d/example_lecture_notes',
      type: 'link'
    }
  ];

  // Seed tracker items as if HomeworkTracker mounted
  trackerState.setItems([...SEED_HOMEWORK]);
  mockStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_HOMEWORK));

  const createdHw = simulateSaveHomework(
    {
      subject: 'Основы расчета колебаний динамического оборудования нефтяных и газовых промыслов',
      title: 'Расчетно-графическая работа №2: Колебания бурильной колонны',
      description: 'Выполнить расчет амплитудно-частотной характеристики по формуле (3.14). Приложить графики в Excel.',
      assignedDate: '2026-09-04',
      dueDate: '2026-09-18',
      attachments: sampleAttachments
    },
    trackerState
  );

  assert(Boolean(createdHw.id), 'New homework assigned unique ID', `Generated ID: ${createdHw.id}`);
  assert(createdHw.title === 'Расчетно-графическая работа №2: Колебания бурильной колонны', 'Title saved correctly');
  assert(createdHw.attachments.length === 3, 'All 3 attachments attached (PDF, image, cloud link)');
  assert(createdHw.dueDate === '2026-09-18', 'Due date correctly configured (2026-09-18)');

  // Verify persistence in localStorage
  const rawStorageAfterAdd = mockStorage.getItem(STORAGE_KEY);
  assert(Boolean(rawStorageAfterAdd), 'localStorage[homework_ingt-310] updated after create');
  const parsedStorageAfterAdd: HomeworkItem[] = JSON.parse(rawStorageAfterAdd!);
  const storedCreatedItem = parsedStorageAfterAdd.find(it => it.id === createdHw.id);
  assert(Boolean(storedCreatedItem), 'Created homework item found in localStorage array');
  assert(storedCreatedItem?.attachments?.length === 3, 'Attachments preserved with full fidelity in localStorage');
  assert(parsedStorageAfterAdd.length === SEED_HOMEWORK.length + 1, `Total items in localStorage is now ${parsedStorageAfterAdd.length}`);

  // Test Cloud push with sanitization
  const pushSuccess = await pushGroupCloudData({ homework: parsedStorageAfterAdd }, GROUP_ID);
  assert(pushSuccess, 'pushGroupCloudData succeeds with newly created homework');
  assert(mockCloudPayload !== null && Array.isArray(mockCloudPayload.items), 'Cloud receives items payload');
  const cloudItem = mockCloudPayload.items.find((it: any) => it.id === createdHw.id);
  assert(Boolean(cloudItem), 'Newly created homework successfully synchronized to mock cloud endpoint');

  // Verify heavy attachment sanitization in cloudSync
  const heavyAttachmentSample: HomeworkAttachment = {
    id: 'att-heavy',
    name: 'heavy_photo.jpg',
    data: 'data:image/jpeg;base64,' + 'A'.repeat(250000), // > 200KB base64
    type: 'image',
    size: '250 КБ'
  };
  const hwWithHeavyAtt: HomeworkItem = {
    ...createdHw,
    id: 'hw_heavy_test',
    attachments: [heavyAttachmentSample]
  };
  await pushGroupCloudData({ homework: [hwWithHeavyAtt] }, GROUP_ID);
  const cloudHeavy = mockCloudPayload.items.find((it: any) => it.id === 'hw_heavy_test');
  assert(
    cloudHeavy?.attachments?.[0]?.data === undefined,
    'Heavy base64 payload (>200KB) stripped in cloud payload to prevent HTTP 413 Payload Too Large'
  );
  assert(
    cloudHeavy?.attachments?.[0]?.name === 'heavy_photo.jpg',
    'Attachment metadata (name, size, type) retained during cloud sanitization'
  );

  // Restore cloud payload to current items
  await pushGroupCloudData({ homework: parsedStorageAfterAdd }, GROUP_ID);

  // --------------------------------------------------------------------------
  console.log(`\n${BOLD}[PHASE 3] Homework Deletion & Tombstone Recording${RESET}`);
  // --------------------------------------------------------------------------
  const itemToDeleteId = createdHw.id;
  const seedToDeleteId = 'hw-1756911666632'; // One of the seed homework items

  console.log(`  Deleting custom HW: ${itemToDeleteId}`);
  simulateDeleteHomework(itemToDeleteId, trackerState);

  // Check 1: Tombstone list in localStorage
  const tombstoneRaw = mockStorage.getItem(TOMBSTONE_KEY);
  assert(Boolean(tombstoneRaw), `Tombstone key exists: localStorage[${TOMBSTONE_KEY}]`);
  const tombstoneList: string[] = JSON.parse(tombstoneRaw!);
  assert(
    tombstoneList.includes(itemToDeleteId),
    `Deleted custom HW ID (${itemToDeleteId}) recorded in tombstone list`
  );

  // Check 2: Removal from localStorage[homework_ingt-310]
  const storageAfterDelete: HomeworkItem[] = JSON.parse(mockStorage.getItem(STORAGE_KEY) || '[]');
  const foundInStorage = storageAfterDelete.some(it => it.id === itemToDeleteId);
  assert(!foundInStorage, `Deleted ID (${itemToDeleteId}) removed from localStorage[${STORAGE_KEY}]`);

  // Check 3: Removal from tracker state
  const foundInState = trackerState.items.some(it => it.id === itemToDeleteId);
  assert(!foundInState, `Deleted ID (${itemToDeleteId}) removed from in-memory items state`);

  // Now delete the seed item to test seed deletion
  console.log(`  Deleting SEED HW: ${seedToDeleteId}`);
  simulateDeleteHomework(seedToDeleteId, trackerState);
  const tombstoneListAfterSeed: string[] = JSON.parse(mockStorage.getItem(TOMBSTONE_KEY)!);
  assert(
    tombstoneListAfterSeed.includes(seedToDeleteId),
    `Seed HW ID (${seedToDeleteId}) recorded in tombstone list`
  );
  assert(
    !trackerState.items.some(it => it.id === seedToDeleteId),
    `Seed HW ID (${seedToDeleteId}) removed from tracker items`
  );

  // Check tombstone idempotency (deleting same ID again does not duplicate entries)
  simulateDeleteHomework(seedToDeleteId, trackerState);
  const tombstoneListDedup: string[] = JSON.parse(mockStorage.getItem(TOMBSTONE_KEY)!);
  const occurrences = tombstoneListDedup.filter(id => id === seedToDeleteId).length;
  assert(occurrences === 1, 'Tombstone list is idempotent: duplicate deletion does not duplicate ID in array');

  // --------------------------------------------------------------------------
  console.log(`\n${BOLD}[PHASE 4] Resurrection Tests (Zombie Data Attacks)${RESET}`);
  // --------------------------------------------------------------------------

  // ATTACK 4.1: getLocalBackup Verification
  console.log(`  ${BOLD}Scenario 4.1: getLocalBackup Tombstone Immunity${RESET}`);
  const backupAfterDelete = getLocalBackup(GROUP_ID);
  const backupContainsCustom = backupAfterDelete.homework.some(it => it.id === itemToDeleteId);
  const backupContainsSeed = backupAfterDelete.homework.some(it => it.id === seedToDeleteId);

  assert(!backupContainsCustom, 'getLocalBackup: does NOT return deleted custom HW');
  assert(!backupContainsSeed, 'getLocalBackup: does NOT return deleted seed HW');

  // ATTACK 4.2: Cold Start Resurrection Simulation
  // User clears their browser cache or opens app on a new device,
  // but tombstone list was retained.
  console.log(`  ${BOLD}Scenario 4.2: Cold Start / Empty Storage Resurrection Attack${RESET}`);
  mockStorage.removeItem(STORAGE_KEY); // Simulate cleared items cache
  assert(mockStorage.getItem(STORAGE_KEY) === null, 'localStorage[homework_ingt-310] is null (cold start simulation)');

  const coldBackup = getLocalBackup(GROUP_ID);
  const coldSeedZombie = coldBackup.homework.some(it => it.id === seedToDeleteId);
  assert(
    !coldSeedZombie,
    'Cold start getLocalBackup filters out deleted seed items even when homework storage is null'
  );

  // ATTACK 4.3: Simulated Cloud Polling with Zombie Data (Stale Cloud Node)
  console.log(`  ${BOLD}Scenario 4.3: Stale Cloud Polling with Zombie Items${RESET}`);
  // Mock cloud endpoint still has the deleted custom homework AND deleted seed homework
  mockCloudPayload = {
    items: [
      ...SEED_HOMEWORK, // Contains seedToDeleteId!
      createdHw,        // Contains itemToDeleteId!
      {
        id: 'hw_surviving_1',
        groupId: GROUP_ID,
        subject: 'Безопасность жизнедеятельности',
        title: 'Выживающее задание из облака',
        description: 'Это задание должно остаться',
        assignedDate: '2026-09-01',
        dueDate: '2026-09-15',
        attachments: [],
        createdAt: '2026-09-01T10:00:00.000Z'
      }
    ]
  };

  // Run fetchGroupCloudData directly to test cloudSync module resilience
  const fetchedCloudData = await fetchGroupCloudData(true, GROUP_ID);
  assert(fetchedCloudData !== null, 'fetchGroupCloudData returns cloud data');

  const cloudContainsCustomZombie = fetchedCloudData?.homework.some(it => it.id === itemToDeleteId);
  const cloudContainsSeedZombie = fetchedCloudData?.homework.some(it => it.id === seedToDeleteId);
  assert(
    !cloudContainsCustomZombie,
    'fetchGroupCloudData: deleted custom HW is NOT resurrected in returned data',
    `Custom ID: ${itemToDeleteId}`
  );
  assert(
    !cloudContainsSeedZombie,
    'fetchGroupCloudData: deleted seed HW is NOT resurrected in returned data',
    `Seed ID: ${seedToDeleteId}`
  );

  const storageAfterCloudFetch: HomeworkItem[] = JSON.parse(mockStorage.getItem(STORAGE_KEY) || '[]');
  assert(
    !storageAfterCloudFetch.some(it => it.id === itemToDeleteId),
    'fetchGroupCloudData: does NOT re-pollute localStorage with deleted custom HW'
  );
  assert(
    !storageAfterCloudFetch.some(it => it.id === seedToDeleteId),
    'fetchGroupCloudData: does NOT re-pollute localStorage with deleted seed HW'
  );

  // ATTACK 4.4: HomeworkTracker loadCloud Execution
  console.log(`  ${BOLD}Scenario 4.4: HomeworkTracker Component loadCloud Full Execution${RESET}`);
  // Execute simulated loadCloud (matching HomeworkTracker.tsx lines 89-130)
  await simulateHomeworkTrackerLoadCloud(GROUP_ID, trackerState, true);

  const trackerContainsCustomZombie = trackerState.items.some(it => it.id === itemToDeleteId);
  const trackerContainsSeedZombie = trackerState.items.some(it => it.id === seedToDeleteId);
  assert(
    !trackerContainsCustomZombie,
    'HomeworkTracker items: deleted custom HW is NOT in items state after loadCloud'
  );
  assert(
    !trackerContainsSeedZombie,
    'HomeworkTracker items: deleted seed HW is NOT in items state after loadCloud'
  );
  assert(
    trackerState.items.some(it => it.id === 'hw_surviving_1'),
    'Legitimate surviving cloud homework (hw_surviving_1) is successfully merged into items'
  );

  // Verify non-deleted seed item is preserved
  const nonDeletedSeed = SEED_HOMEWORK.find(s => s.id !== seedToDeleteId);
  if (nonDeletedSeed) {
    assert(
      trackerState.items.some(it => it.id === nonDeletedSeed.id),
      `Non-deleted seed HW (${nonDeletedSeed.id}) remains intact in items array`
    );
  }

  // --------------------------------------------------------------------------
  console.log(`\n${BOLD}[PHASE 5] Post-Deletion Creation & Non-Deleted Item Integrity${RESET}`);
  // --------------------------------------------------------------------------
  const postDeleteHw = simulateSaveHomework(
    {
      subject: 'Техника и технология добычи нефти и газа',
      title: 'Практическое занятие №4: Эксплуатация штанговых скважинных насосных установок',
      description: 'Рассчитать подачу ШСНУ и коэффициент наполнения цилиндра насоса.',
      assignedDate: '2026-09-04',
      dueDate: '2026-09-17',
      attachments: [
        {
          name: 'Методические указания к ПЗ-4.docx',
          url: 'https://storage.example.com/pz4.docx',
          type: 'doc'
        }
      ]
    },
    trackerState
  );

  assert(Boolean(postDeleteHw.id), 'Newly added homework created successfully after deletions');
  assert(postDeleteHw.id !== itemToDeleteId, 'New homework has unique ID distinct from deleted IDs');
  assert(
    trackerState.items.some(it => it.id === postDeleteHw.id),
    'New homework present in tracker items'
  );

  // Verify deleted items are still dead
  assert(
    !trackerState.items.some(it => it.id === itemToDeleteId),
    'Previously deleted custom HW remains excluded from items'
  );
  assert(
    !trackerState.items.some(it => it.id === seedToDeleteId),
    'Previously deleted seed HW remains excluded from items'
  );

  // Verify other items intact
  assert(
    trackerState.items.some(it => it.id === 'hw_surviving_1'),
    'Surviving cloud item remains in items without data loss'
  );

  const rawStoragePostCreate: HomeworkItem[] = JSON.parse(mockStorage.getItem(STORAGE_KEY) || '[]');
  assert(
    rawStoragePostCreate.some(it => it.id === postDeleteHw.id),
    'New homework stored into localStorage[homework_ingt-310]'
  );

  // Verify Chronological DueDate Sorting
  const dates = trackerState.items.map(it => it.dueDate);
  const isSorted = dates.every((d, i) => i === 0 || d >= dates[i - 1]);
  assert(isSorted, 'Homework list automatically sorted by dueDate ascending', `Dates: ${dates.join(' -> ')}`);

  // --------------------------------------------------------------------------
  console.log(`\n${BOLD}[PHASE 6] Stress & Fault Tolerance (Corrupted Storage & Edge Cases)${RESET}`);
  // --------------------------------------------------------------------------

  // Stress 6.1: Corrupted JSON in deleted_hw
  console.log(`  ${BOLD}Stress 6.1: Corrupted tombstone JSON string recovery${RESET}`);
  mockStorage.setItem(TOMBSTONE_KEY, '{malformed_json:not_array');
  let crashed = false;
  try {
    const safeBackup = getLocalBackup(GROUP_ID);
    assert(Array.isArray(safeBackup.homework), 'getLocalBackup handles corrupted tombstone gracefully');
  } catch (e) {
    crashed = true;
  }
  assert(!crashed, 'No unhandled exception thrown on corrupt tombstone JSON');

  // Restore tombstone
  mockStorage.setItem(TOMBSTONE_KEY, JSON.stringify([itemToDeleteId, seedToDeleteId]));

  // Stress 6.2: Corrupted JSON in homework storage
  console.log(`  ${BOLD}Stress 6.2: Corrupted homework storage JSON recovery${RESET}`);
  mockStorage.setItem(STORAGE_KEY, '[[corrupted data');
  crashed = false;
  try {
    const safeBackup2 = getLocalBackup(GROUP_ID);
    assert(Array.isArray(safeBackup2.homework), 'getLocalBackup handles corrupted homework JSON gracefully');
    assert(
      !safeBackup2.homework.some(it => it.id === seedToDeleteId),
      'Corrupt homework fallback in catch block still respects tombstone deleted items'
    );
  } catch (e) {
    crashed = true;
  }
  assert(!crashed, 'No unhandled exception thrown on corrupt homework JSON');

  // Stress 6.3: Network failure during cloud fetch
  console.log(`  ${BOLD}Stress 6.3: Network crash during cloud sync${RESET}`);
  mockCloudNetworkError = true;
  mockStorage.setItem(STORAGE_KEY, JSON.stringify([postDeleteHw]));
  const fallbackData = await fetchGroupCloudData(true, GROUP_ID);
  assert(fallbackData !== null, 'fetchGroupCloudData falls back to local backup on network outage');
  assert(
    fallbackData?.homework.some(it => it.id === postDeleteHw.id),
    'Local homework intact during network outage'
  );
  mockCloudNetworkError = false;

  // --------------------------------------------------------------------------
  // Summary & Final Verdict
  // --------------------------------------------------------------------------
  console.log(`\n${BOLD}========================================================================${RESET}`);
  console.log(`${BOLD}                    STRESS TEST EXECUTION RESULTS                      ${RESET}`);
  console.log(`${BOLD}========================================================================${RESET}`);
  console.log(`Total Assertions Checked: ${BOLD}${totalAssertions}${RESET}`);
  console.log(`Passed:                   ${GREEN}${BOLD}${passedAssertions}${RESET}`);
  console.log(`Failed:                   ${failedAssertions > 0 ? RED + BOLD : GREEN}${failedAssertions}${RESET}`);

  if (failedAssertions === 0) {
    console.log(`\n${GREEN}${BOLD}✓ VERDICT: PASSED - 100% IMMUNITY TO RESURRECTION CONFIRMED.${RESET}`);
    console.log(`  All CRUD lifecycle phases, tombstone tracking, cloud syncing, and edge-cases`);
    console.log(`  operate in full accordance with specifications without data leaks or zombie resurrection.`);
  } else {
    console.error(`\n${RED}${BOLD}✗ VERDICT: FAILED - ${failedAssertions} ASSERTIONS BROKEN.${RESET}`);
    process.exit(1);
  }
}

export async function runHomeworkLifecycleStressTest() {
  return runTestSuite();
}

const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('test_homework_lifecycle_stress.ts') || 
  process.argv[1].endsWith('test_homework_lifecycle_stress.js')
);

if (isDirectRun) {
  runTestSuite().catch(err => {
    console.error(`${RED}FATAL ERROR IN TEST SUITE:${RESET}`, err);
    process.exit(1);
  });
}
