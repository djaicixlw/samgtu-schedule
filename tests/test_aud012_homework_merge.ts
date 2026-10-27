/**
 * AUD-012 regression test: per-item homework merge with updatedAt arbitration.
 *
 * Old defects: cloud items were authoritative per id (an offline edit whose push
 * failed was silently overwritten by the older cloud copy), edits did not stamp
 * updatedAt, and failed pushes were only console-warned.
 *
 * The component now uses mergeHomeworkItems(); these checks pin its contract.
 */

import { mergeHomeworkItems } from '../utils/homeworkMerge';

console.log('\n=================================================');
console.log('   TEST SUITE: HOMEWORK PER-ITEM MERGE (AUD-012) ');
console.log('=================================================');

let passed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`  ❌ FAIL: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  passed++;
  console.log(`  ✓ [PASS] ${msg}`);
}

const belongs = () => true;

async function runMergeTests() {
  console.log('\n--- 1. Offline edit newer than cloud: local wins, auto-heal flag set ---');
  const cloudOld = [{ id: 'hw-1', title: 'СТАРАЯ версия (облако)', updatedAt: 1000 }];
  const localNew = [{ id: 'hw-1', title: 'НОВАЯ правка офлайн', updatedAt: 2000 }];
  let r = mergeHomeworkItems(cloudOld, localNew, new Set(), belongs);
  assert(r.merged.length === 1 && r.merged[0].title === 'НОВАЯ правка офлайн',
    'AUD-012: newer LOCAL edit survives the next load (old code: cloud always won)');
  assert(r.hasLocalNewer === true, 'auto-heal re-push flag set for the newer local copy');

  console.log('\n--- 2. Cloud newer than local edit: cloud wins ---');
  r = mergeHomeworkItems(
    [{ id: 'hw-1', title: 'Облако свежее', updatedAt: 3000 }],
    [{ id: 'hw-1', title: 'Локаль устарела', updatedAt: 1500 }],
    new Set(), belongs
  );
  assert(r.merged[0].title === 'Облако свежее', 'cloud copy kept when it is newer');
  assert(r.hasLocalNewer === false, 'no auto-heal when local is stale');

  console.log('\n--- 3. Equal timestamps: cloud wins (deterministic) ---');
  r = mergeHomeworkItems(
    [{ id: 'hw-1', title: 'Облако', updatedAt: 1000 }],
    [{ id: 'hw-1', title: 'Локаль', updatedAt: 1000 }],
    new Set(), belongs
  );
  assert(r.merged[0].title === 'Облако' && r.hasLocalNewer === false, 'tie goes to cloud');

  console.log('\n--- 4. Disjoint ids: union, unsynced new local item flagged ---');
  r = mergeHomeworkItems(
    [{ id: 'hw-1', title: 'A', updatedAt: 1 }],
    [{ id: 'hw-2', title: 'B', updatedAt: 2 }],
    new Set(), belongs
  );
  assert(r.merged.length === 2, 'both items kept');
  assert(r.hasLocalNewer === true, 'unsynced new local item triggers auto-heal push');

  console.log('\n--- 5. Tombstones: deleted items never resurrect from either side ---');
  r = mergeHomeworkItems(
    [{ id: 'hw-1', title: 'A', updatedAt: 5 }],
    [{ id: 'hw-2', title: 'B', updatedAt: 5 }],
    new Set(['hw-1', 'hw-2']), belongs
  );
  assert(r.merged.length === 0, 'deleted items filtered on both sides');

  console.log('\n--- 6. Missing timestamps: falls back to createdAt, then cloud-wins ---');
  r = mergeHomeworkItems(
    [{ id: 'hw-1', title: 'Облако', createdAt: '2026-05-01T00:00:00Z' }],
    [{ id: 'hw-1', title: 'Локаль', createdAt: '2026-06-01T00:00:00Z' }],
    new Set(), belongs
  );
  assert(r.merged[0].title === 'Локаль' && r.hasLocalNewer === true,
    'createdAt fallback arbitrates when updatedAt is absent (edited items now stamp updatedAt)');

  console.log('\n--- 7. Group isolation: foreign items excluded ---');
  r = mergeHomeworkItems(
    [{ id: 'hw-1', title: 'чужая группа', groupId: 'faid-310', updatedAt: 9 }],
    [{ id: 'hw-2', title: 'своя группа', groupId: 'ingt-310', updatedAt: 9 }],
    new Set(),
    (it) => (it.groupId || 'ingt-310') === 'ingt-310'
  );
  assert(r.merged.length === 1 && r.merged[0].id === 'hw-2', 'foreign-group item dropped');

  console.log(`\n=================================================`);
  console.log(`  HOMEWORK MERGE: ${passed} CHECKS PASSED  `);
  console.log(`=================================================\n`);
}

await runMergeTests();
