import { HomeworkItem } from '../types';

class LocalStorageInstance {
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
}

interface CloudDbState {
  items: any[];
  deletedIds: string[];
  updatedAt: number;
}

let centralCloud: CloudDbState = {
  items: [],
  deletedIds: ['hw-1756911666632', 'hw-1756914589201'],
  updatedAt: Date.now()
};

const storagePhone = new LocalStorageInstance();
const storagePC = new LocalStorageInstance();

let currentDeviceStorage: LocalStorageInstance = storagePhone;

(global as any).localStorage = {
  getItem: (k: string) => currentDeviceStorage.getItem(k),
  setItem: (k: string, v: string) => currentDeviceStorage.setItem(k, v),
  removeItem: (k: string) => currentDeviceStorage.removeItem(k),
  clear: () => currentDeviceStorage.clear()
};

(global as any).window = global;

(global as any).fetch = async (url: string, options: any = {}) => {
  const method = options.method || 'GET';
  if (url.includes('/sync/homework') || url.includes('dfdebcc') || url.includes('ff808181a067127101a06866951a0496')) {
    if (method === 'PUT') {
      const body = JSON.parse(options.body || '{}');
      const payload = body.payload ? JSON.parse(body.payload) : (body.data || body);
      centralCloud = {
        items: payload.items || (payload.byGroup?.['ingt-310']?.items) || [],
        deletedIds: payload.deletedIds || (payload.byGroup?.['ingt-310']?.deletedIds) || [],
        updatedAt: body.updatedAt || Date.now()
      };
      return {
        ok: true,
        text: async () => JSON.stringify({ status: 'success', data: centralCloud }),
        json: async () => ({ status: 'success', data: centralCloud })
      };
    }
    return {
      ok: true,
      text: async () => JSON.stringify(centralCloud),
      json: async () => ({ data: centralCloud, payload: JSON.stringify(centralCloud) })
    };
  }
  return {
    ok: true,
    text: async () => JSON.stringify({ data: {} }),
    json: async () => ({ data: {} })
  };
};

import { fetchGroupCloudData, pushGroupCloudData } from '../utils/cloudSync';

const simulateDeviceLoadCloud = async (storage: LocalStorageInstance, groupId = 'ingt-310') => {
  currentDeviceStorage = storage;
  const cloud = await fetchGroupCloudData(true, groupId);
  if (!cloud) return [];

  let deletedSet = new Set<string>();
  try {
    const d = JSON.parse(storage.getItem('deleted_hw_' + groupId) || '[]');
    deletedSet = new Set(d);
  } catch (e) {}

  const cloudHw = (cloud.homework || [])
    .filter(it => it && it.id && !deletedSet.has(it.id))
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));

  storage.setItem('homework_' + groupId, JSON.stringify(cloudHw));
  return cloudHw;
};

const simulateDeviceDeleteHomework = async (storage: LocalStorageInstance, hwId: string, groupId = 'ingt-310') => {
  currentDeviceStorage = storage;
  let deletedList: string[] = [];
  try {
    deletedList = JSON.parse(storage.getItem('deleted_hw_' + groupId) || '[]');
    if (!deletedList.includes(hwId)) {
      deletedList.push(hwId);
      storage.setItem('deleted_hw_' + groupId, JSON.stringify(deletedList));
    }
  } catch (e) {}

  let freshItems: HomeworkItem[] = [];
  try {
    const saved = storage.getItem('homework_' + groupId);
    if (saved) freshItems = JSON.parse(saved);
  } catch (e) {}

  const updated = freshItems.filter(it => it.id !== hwId);
  storage.setItem('homework_' + groupId, JSON.stringify(updated));

  await pushGroupCloudData({ homework: updated, deletedIds: deletedList }, groupId);
  return updated;
};

const simulateDeviceAddHomework = async (storage: LocalStorageInstance, item: HomeworkItem, groupId = 'ingt-310') => {
  currentDeviceStorage = storage;
  let freshItems: HomeworkItem[] = [];
  try {
    const saved = storage.getItem('homework_' + groupId);
    if (saved) freshItems = JSON.parse(saved);
  } catch (e) {}

  const updated = [...freshItems.filter(it => it.id !== item.id), item];
  storage.setItem('homework_' + groupId, JSON.stringify(updated));

  let deletedList: string[] = [];
  try {
    deletedList = JSON.parse(storage.getItem('deleted_hw_' + groupId) || '[]');
  } catch (e) {}

  await pushGroupCloudData({ homework: updated, deletedIds: deletedList }, groupId);
  return updated;
};

async function runMultiDeviceTest() {
  console.log('='.repeat(70));
  console.log('   CROSS-DEVICE SYNC & ANTI-RESURRECTION SIMULATION TEST');
  console.log('='.repeat(70));

  let totalTests = 0;
  let passedTests = 0;

  function assert(condition: boolean, msg: string) {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log('  ✓ PASS: ' + msg);
    } else {
      console.error('  ✗ FAIL: ' + msg);
      throw new Error('Assertion failed: ' + msg);
    }
  }

  console.log('\n[STAGE 1] Initial Startup on Mobile (Device A) and PC (Device B)');
  const phoneInit = await simulateDeviceLoadCloud(storagePhone);
  const pcInit = await simulateDeviceLoadCloud(storagePC);
  assert(phoneInit.length === 0, 'Phone starts with 0 homework');
  assert(pcInit.length === 0, 'PC starts with 0 homework');
  assert(centralCloud.items.length === 0, 'Cloud is empty initially');

  console.log('\n[STAGE 2] Phone (Starosta) adds 2 homework assignments');
  const hw1: HomeworkItem = {
    id: 'hw_task_1',
    groupId: 'ingt-310',
    subject: 'БЖД',
    title: 'Лабораторная 1',
    description: 'Оформить',
    assignedDate: '2026-09-04',
    dueDate: '2026-09-11',
    attachments: [],
    createdAt: new Date().toISOString()
  };
  const hw2: HomeworkItem = {
    id: 'hw_task_2',
    groupId: 'ingt-310',
    subject: 'Техника',
    title: 'Задача 3',
    description: 'Формулы',
    assignedDate: '2026-09-04',
    dueDate: '2026-09-12',
    attachments: [],
    createdAt: new Date().toISOString()
  };

  await simulateDeviceAddHomework(storagePhone, hw1);
  await simulateDeviceAddHomework(storagePhone, hw2);
  assert(centralCloud.items.length === 2, 'Cloud received both homework items');

  console.log('\n[STAGE 3] PC loads/refreshes page');
  const pcLoaded = await simulateDeviceLoadCloud(storagePC);
  assert(pcLoaded.length === 2, 'PC loaded both homework items from cloud');
  assert(pcLoaded.some(it => it.id === 'hw_task_1'), 'PC has hw_task_1');
  assert(pcLoaded.some(it => it.id === 'hw_task_2'), 'PC has hw_task_2');

  console.log('\n[STAGE 4] User deletes hw_task_1 on Phone');
  await simulateDeviceDeleteHomework(storagePhone, 'hw_task_1');
  assert(centralCloud.items.length === 1, 'Cloud items reduced to 1');
  assert(centralCloud.items[0].id === 'hw_task_2', 'Cloud only has hw_task_2');
  assert(centralCloud.deletedIds.includes('hw_task_1'), 'Cloud deletedIds includes hw_task_1');

  console.log('\n[STAGE 5] PC refreshes/updates data after Phone deletion (Exact user bug)');
  const pcAfterDelete = await simulateDeviceLoadCloud(storagePC);
  assert(pcAfterDelete.length === 1, 'PC now has exactly 1 homework item');
  assert(!pcAfterDelete.some(it => it.id === 'hw_task_1'), 'hw_task_1 is GONE from PC!');
  assert(pcAfterDelete[0].id === 'hw_task_2', 'hw_task_2 is preserved on PC');

  const pcTombstones: string[] = JSON.parse(storagePC.getItem('deleted_hw_ingt-310') || '[]');
  assert(pcTombstones.includes('hw_task_1'), 'PC learned about remote deletion and saved tombstone locally');

  console.log('\n[STAGE 6] Repeated PC refreshes (Testing for Zombie Resurrection)');
  for (let i = 1; i <= 3; i++) {
    const pcRepeat = await simulateDeviceLoadCloud(storagePC);
    assert(pcRepeat.length === 1, 'Refresh #' + i + ': PC still has exactly 1 item');
    assert(!pcRepeat.some(it => it.id === 'hw_task_1'), 'Refresh #' + i + ': hw_task_1 did NOT resurrect');
  }

  console.log('\n[STAGE 7] Phone deletes the remaining HW2 (Cloud now has 0 items!)');
  await simulateDeviceDeleteHomework(storagePhone, 'hw_task_2');
  assert(centralCloud.items.length === 0, 'Cloud items is now empty []');
  assert(centralCloud.deletedIds.includes('hw_task_2'), 'Cloud deletedIds includes hw_task_2');

  console.log('\n[STAGE 8] PC refreshes when cloud has 0 items (Testing auto-heal removal)');
  const pcEmptyCheck = await simulateDeviceLoadCloud(storagePC);
  assert(pcEmptyCheck.length === 0, 'PC correctly displays 0 homework items (Empty state)');
  assert(centralCloud.items.length === 0, 'PC DID NOT auto-heal / re-upload deleted homework to cloud');

  console.log('\n[STAGE 9] PC creates a brand new homework hw_task_3');
  const hw3: HomeworkItem = {
    id: 'hw_task_3',
    groupId: 'ingt-310',
    subject: 'Колебания',
    title: 'Коллоквиум',
    description: 'Вопросы',
    assignedDate: '2026-09-04',
    dueDate: '2026-09-18',
    attachments: [],
    createdAt: new Date().toISOString()
  };
  await simulateDeviceAddHomework(storagePC, hw3);
  assert(centralCloud.items.length === 1, 'Cloud has 1 item (hw_task_3)');
  assert(centralCloud.items[0].id === 'hw_task_3', 'Cloud item is hw_task_3');

  console.log('\n[STAGE 10] Phone syncs and receives hw_task_3');
  const phoneFinal = await simulateDeviceLoadCloud(storagePhone);
  assert(phoneFinal.length === 1, 'Phone has 1 item');
  assert(phoneFinal[0].id === 'hw_task_3', 'Phone received hw_task_3');
  assert(!phoneFinal.some(it => it.id === 'hw_task_1' || it.id === 'hw_task_2'), 'No old deleted items resurrected on Phone');

  console.log('\n' + '='.repeat(70));
  console.log('✓ ALL ' + totalTests + ' MULTI-DEVICE SYNCHRONIZATION TESTS PASSED!');
  console.log('='.repeat(70) + '\n');
}

runMultiDeviceTest().catch(e => {
  console.error('Test execution error:', e);
  process.exit(1);
});
