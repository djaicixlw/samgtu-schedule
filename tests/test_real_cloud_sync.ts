import { fetchGroupCloudData, pushGroupCloudData, getLocalBackup } from '../utils/cloudSync';
import { HomeworkItem } from '../types';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string): void { this.store.set(k, String(v)); }
  removeItem(k: string): void { this.store.delete(k); }
  clear(): void { this.store.clear(); }
}

const phoneStorage = new MemoryStorage();
const pcStorage = new MemoryStorage();
let activeStorage = phoneStorage;

(global as any).localStorage = {
  getItem: (k: string) => activeStorage.getItem(k),
  setItem: (k: string, v: string) => activeStorage.setItem(k, v),
  removeItem: (k: string) => activeStorage.removeItem(k),
  clear: () => activeStorage.clear()
};

async function runTest() {
  console.log('====================================================');
  console.log('STARTING REAL CLOUD SYNC VERIFICATION ACROSS DEVICES');
  console.log('====================================================\n');

  const groupId = 'ingt-310';

  console.log('>>> TEST 1: Schedule Note Sync & Deletion');
  activeStorage = phoneStorage;
  const lessonId = 'test_lesson_note_1';
  const initialOverrides = {
    [lessonId]: { note: 'Принести лабораторный журнал №3' }
  };
  phoneStorage.setItem(`schedule_overrides_${groupId}`, JSON.stringify(initialOverrides));
  
  console.log('1. Phone pushing note override to cloud...');
  const pushOk1 = await pushGroupCloudData({ scheduleOverrides: initialOverrides }, groupId);
  if (!pushOk1) throw new Error('Failed to push initial schedule override from phone');
  console.log('   Phone push SUCCESS.');

  activeStorage = pcStorage;
  console.log('2. PC fetching cloud data...');
  const pcCloud1 = await fetchGroupCloudData(true, groupId);
  if (!pcCloud1 || !pcCloud1.scheduleOverrides) throw new Error('PC failed to fetch cloud data');
  
  const pcNote1 = pcCloud1.scheduleOverrides[lessonId]?.note;
  console.log(`   PC received note: "${pcNote1}"`);
  if (pcNote1 !== 'Принести лабораторный журнал №3') {
    throw new Error(`Expected note on PC, got: ${pcNote1}`);
  }
  console.log('   PASS: Note successfully appeared on PC!\n');

  activeStorage = phoneStorage;
  console.log('3. Phone deleting the note override...');
  const clearedOverrides: Record<string, any> = {};
  phoneStorage.setItem(`schedule_overrides_${groupId}`, JSON.stringify(clearedOverrides));
  
  const pushOk2 = await pushGroupCloudData({ scheduleOverrides: clearedOverrides }, groupId);
  if (!pushOk2) throw new Error('Failed to push cleared overrides from phone');
  console.log('   Phone push cleared overrides SUCCESS.');

  activeStorage = pcStorage;
  console.log('4. PC refreshing cloud data after note deletion on phone...');
  const pcCloud2 = await fetchGroupCloudData(true, groupId);
  if (!pcCloud2) throw new Error('PC failed to fetch after deletion');

  const pcNote2 = pcCloud2.scheduleOverrides[lessonId]?.note;
  console.log(`   PC override for ${lessonId}:`, pcCloud2.scheduleOverrides[lessonId]);
  if (pcNote2 !== undefined) {
    throw new Error(`FAIL: Note was NOT deleted on PC! Still had: "${pcNote2}"`);
  }
  console.log('   PASS: Note was completely removed on PC without ghost data!\n');

  console.log('>>> TEST 2: Homework Creation with Attachment on PC');
  activeStorage = pcStorage;
  const testHwId = `hw_verify_${Date.now()}`;
  const newHwItem: HomeworkItem = {
    id: testHwId,
    groupId,
    subject: 'Безопасность жизнедеятельности',
    title: 'Расчет параметров вентиляции',
    description: 'Выполнить расчет по формулам из методички на стр. 45',
    assignedDate: '2026-09-04',
    dueDate: '2026-09-12',
    attachments: [
      { name: 'Методичка.pdf', url: 'https://disk.yandex.ru/d/example123', type: 'link' },
      { name: 'Формулы.jpg', data: 'data:image/jpeg;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', type: 'image/jpeg', size: '24 КБ' }
    ],
    createdAt: new Date().toISOString()
  };

  pcStorage.setItem(`homework_${groupId}`, JSON.stringify([newHwItem]));

  console.log('1. PC pushing homework with attachments to cloud...');
  const pushHwOk = await pushGroupCloudData({ homework: [newHwItem] }, groupId);
  if (!pushHwOk) throw new Error('Failed to push homework from PC');
  console.log('   PC push SUCCESS.');

  activeStorage = phoneStorage;
  console.log('2. Phone fetching homework from cloud...');
  const phoneCloudHw = await fetchGroupCloudData(true, groupId);
  if (!phoneCloudHw || !phoneCloudHw.homework) throw new Error('Phone failed to fetch homework');

  const foundItemOnPhone = phoneCloudHw.homework.find(h => h.id === testHwId);
  if (!foundItemOnPhone) {
    throw new Error(`FAIL: Homework ${testHwId} not found on Phone!`);
  }
  console.log(`   Phone found homework: "${foundItemOnPhone.title}"`);
  console.log(`   Attachments count on phone: ${foundItemOnPhone.attachments.length}`);
  console.log(`   Attachment 1: ${foundItemOnPhone.attachments[0].name} (${foundItemOnPhone.attachments[0].url})`);
  console.log(`   Attachment 2: ${foundItemOnPhone.attachments[1].name} (${foundItemOnPhone.attachments[1].size})`);
  
  if (foundItemOnPhone.attachments.length !== 2) {
    throw new Error('Attachments mismatch on Phone!');
  }
  console.log('   PASS: Homework and attachments synced perfectly to Phone!\n');

  console.log('>>> TEST 3: Homework Deletion on Phone & Anti-Resurrection');
  activeStorage = phoneStorage;
  console.log('1. Phone deleting homework and saving tombstone...');
  const phoneDeletedList = [testHwId];
  phoneStorage.setItem(`deleted_hw_${groupId}`, JSON.stringify(phoneDeletedList));
  phoneStorage.setItem(`homework_${groupId}`, JSON.stringify([]));

  const deletePushOk = await pushGroupCloudData({ homework: [], deletedIds: phoneDeletedList }, groupId);
  if (!deletePushOk) throw new Error('Failed to push homework deletion from phone');
  console.log('   Phone deletion push SUCCESS.');

  activeStorage = pcStorage;
  console.log('2. PC refreshing homework after deletion on Phone...');
  const pcCloudHwAfterDelete = await fetchGroupCloudData(true, groupId);
  if (!pcCloudHwAfterDelete) throw new Error('PC failed to fetch after homework deletion');

  const itemStillOnPC = (pcCloudHwAfterDelete.homework || []).some(h => h.id === testHwId);
  const pcHasTombstone = (pcCloudHwAfterDelete.deletedIds || []).includes(testHwId);

  console.log(`   Is item present in cloud on PC? ${itemStillOnPC}`);
  console.log(`   Is tombstone received on PC? ${pcHasTombstone}`);

  if (itemStillOnPC) {
    throw new Error('FAIL: Deleted homework resurrected on PC!');
  }
  if (!pcHasTombstone) {
    throw new Error('FAIL: Tombstone was not propagated to PC!');
  }
  console.log('   PASS: Homework deleted cleanly on all devices without resurrection!\n');

  console.log('====================================================');
  console.log('ALL REAL MULTI-DEVICE SYNC TESTS PASSED WITH 100%!');
  console.log('====================================================');
}

runTest().catch(err => {
  console.error('\nTEST FAILED:', err.message);
  process.exit(1);
});
