import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  sanitizeUsefulItem,
  getLocalUsefulItems,
  saveLocalUsefulItems,
  recordDeletedUsefulItem
} from '../utils/usefulStorage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('=================================================');
console.log('  TEST SUITE: USEFUL TRACKER & STORAGE INTEGRITY');
console.log('=================================================');

let total = 0;
let passed = 0;

function assert(cond: boolean, desc: string) {
  total++;
  if (cond) {
    passed++;
    console.log(`  ✓ [PASS] ${desc}`);
  } else {
    console.error(`  ✗ [FAIL] ${desc}`);
    throw new Error(`Assertion failed: ${desc}`);
  }
}

// 1. Sanitization & Constraints Tests
console.log('\n--- 1. Sanitization & Input Limits ---');

const sanitized1 = sanitizeUsefulItem(null, 'ingt-310');
assert(sanitized1 === null, 'sanitizeUsefulItem returns null for null input');

const sanitizedEmpty = sanitizeUsefulItem({ title: '', text: '' }, 'ingt-310');
assert(sanitizedEmpty === null, 'sanitizeUsefulItem returns null when both title and text are empty');

const longTitle = 'A'.repeat(150);
const longText = 'B'.repeat(2500);
const sanitizedLimits = sanitizeUsefulItem({
  title: longTitle,
  text: longText,
  tags: ['#ЛАБЫ', '#СЕССИЯ', 'контакты', ''],
  links: [
    { title: 'Test 1', url: 'https://samgtu.ru' },
    { title: 'Insecure', url: 'http://insecure.com' } // should be filtered out
  ]
}, 'ingt-310');

assert(sanitizedLimits !== null, 'Item with title and text is sanitized');
assert(sanitizedLimits!.title.length === 100, 'Title is capped at 100 chars');
assert(sanitizedLimits!.text.length === 2000, 'Text is capped at 2000 chars');
assert(sanitizedLimits!.tags?.length === 3, 'Tags are filtered and non-empty');
assert(sanitizedLimits!.tags![0] === 'лабы', 'Tags are stripped of # and lowercased');
assert(sanitizedLimits!.links?.length === 1, 'Only https:// links are kept');
assert(sanitizedLimits!.links![0].url === 'https://samgtu.ru', 'Valid https link preserved');

// 2. Storage CRUD & Pinned Sorting Tests
console.log('\n--- 2. Local Storage CRUD & Pinned Sorting ---');

const TEST_GROUP = 'test-group-useful';
const mockStorage: Record<string, string> = {};

// Mock localStorage in node environment if needed
const originalLocalStorage = globalThis.localStorage;
globalThis.localStorage = {
  getItem: (k: string) => mockStorage[k] || null,
  setItem: (k: string, v: string) => { mockStorage[k] = v; },
  removeItem: (k: string) => { delete mockStorage[k]; },
  clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); },
  key: (i: number) => Object.keys(mockStorage)[i] || null,
  length: Object.keys(mockStorage).length
} as any;

const item1 = {
  id: 'u1',
  groupId: TEST_GROUP,
  title: 'Обычная заметка',
  text: 'Текст',
  isPinned: false,
  createdAt: '2026-10-01T10:00:00.000Z'
};

const item2 = {
  id: 'u2',
  groupId: TEST_GROUP,
  title: 'Закрепленная заметка',
  text: 'Текст закрепленной',
  isPinned: true,
  createdAt: '2026-10-02T10:00:00.000Z'
};

saveLocalUsefulItems(TEST_GROUP, [item1, item2]);
const loaded = getLocalUsefulItems(TEST_GROUP);

assert(loaded.length === 2, 'Loaded 2 items from storage');
assert(loaded[0].id === 'u2', 'Pinned item is sorted first');
assert(loaded[1].id === 'u1', 'Unpinned item is sorted second');

// 3. Tombstone Deletion Tests
console.log('\n--- 3. Tombstone Deletion & Resurrection Prevention ---');

recordDeletedUsefulItem(TEST_GROUP, 'u2');
const loadedAfterDelete = getLocalUsefulItems(TEST_GROUP);

assert(loadedAfterDelete.length === 1, 'Deleted item is excluded after tombstone recording');
assert(loadedAfterDelete[0].id === 'u1', 'Only surviving item u1 remains');

// 4. File and UI Code Checks
console.log('\n--- 4. Component Structure & Integration ---');

const usefulTrackerPath = path.resolve(__dirname, '../components/UsefulTracker.tsx');
assert(fs.existsSync(usefulTrackerPath), 'components/UsefulTracker.tsx exists');

const usefulTrackerContent = fs.readFileSync(usefulTrackerPath, 'utf8');
assert(usefulTrackerContent.includes('export const UsefulTracker'), 'UsefulTracker is exported as named export');
assert(usefulTrackerContent.includes('export default UsefulTracker'), 'UsefulTracker is exported as default export');
assert(usefulTrackerContent.includes('canEdit'), 'UsefulTracker calculates canEdit for starosta/admin');
assert(usefulTrackerContent.includes('isPinned'), 'UsefulTracker handles pinned notes');
assert(usefulTrackerContent.includes('openLink'), 'UsefulTracker integrates with Telegram.WebApp.openLink');
assert(usefulTrackerContent.includes('getLocalUsefulItems'), 'UsefulTracker calls getLocalUsefulItems');
assert(usefulTrackerContent.includes('saveLocalUsefulItems'), 'UsefulTracker calls saveLocalUsefulItems');
assert(usefulTrackerContent.includes('pushGroupUsefulData'), 'UsefulTracker calls pushGroupUsefulData');
assert(usefulTrackerContent.includes('recordDeletedUsefulItem'), 'UsefulTracker calls recordDeletedUsefulItem');

const hwTrackerPath = path.resolve(__dirname, '../components/HomeworkTracker.tsx');
const hwTrackerContent = fs.readFileSync(hwTrackerPath, 'utf8');

assert(hwTrackerContent.includes('UsefulTracker'), 'HomeworkTracker imports UsefulTracker');
assert(hwTrackerContent.includes('Полезное'), 'HomeworkTracker contains «Полезное» tab');
assert(hwTrackerContent.includes('Задания'), 'HomeworkTracker contains «Задания» tab');
assert(hwTrackerContent.includes('<UsefulTracker'), 'HomeworkTracker renders UsefulTracker');

// 5. Anti-Bureaucratic & Anti-AI-Tell Tone Check
console.log('\n--- 5. Anti-Bureaucratic & Clean Tone Check ---');
assert(!usefulTrackerContent.includes('152-ФЗ'), 'No 152-ФЗ in UsefulTracker');
assert(!usefulTrackerContent.includes('персональных данных'), 'No bureaucratic GDPR/PD jargon in UsefulTracker');

// Restore original localStorage if present
if (originalLocalStorage) {
  globalThis.localStorage = originalLocalStorage;
}

console.log('\n=================================================');
console.log(`  RESULT: ${passed}/${total} checks passed (100%)`);
console.log('=================================================');
