/**
 * /sync/* server-side union merge tests (AUD-001 + AUD-002 worker part).
 *
 * Old behavior (defect): the PUT handler stored `{ ...existingGroup, ...incomingSlice }`,
 * so nested arrays (items / deletedIds / overrides) were REPLACED wholesale and one of
 * two concurrent device pushes was silently lost. These tests pin the new field-aware
 * merge: items upserted by id (newer updatedAt wins), deletedIds only grow.
 *
 * AUD-002 (worker part): the items/deletedIds caps were raised 200 -> 2000. (True
 * tombstone age-compaction needs tombstone timestamps and lands with the D1
 * hw_deleted table in Phase 1; string tombstones cannot be ordered by age.)
 */

import worker, {
  mergeHomeworkGroupSlice,
  mergeUsefulGroupSlice,
  mergeScheduleGroupSlice
} from '../cloudflare-worker.js';

console.log('\n=================================================');
console.log('   TEST SUITE: /sync UNION MERGE (AUD-001/002)   ');
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

// ---------------------------------------------------------------------------
// Unit level: merge functions
// ---------------------------------------------------------------------------

function runUnitTests() {
  console.log('\n--- Unit: mergeHomeworkGroupSlice ---');

  const oldStyleResult: any = { ...{ items: [{ id: 'a', updatedAt: 1 }], deletedIds: [] }, ...{ items: [{ id: 'b', updatedAt: 2 }], deletedIds: ['a'] } };
  assert(oldStyleResult.items.length === 1 && oldStyleResult.items[0].id === 'b',
    'sanity: old {...spread} style demonstrably loses item "a" (documents the defect)');

  const merged: any = mergeHomeworkGroupSlice(
    { items: [{ id: 'a', subject: 'Math', updatedAt: 1 }], deletedIds: [] },
    { items: [{ id: 'b', subject: 'Phys', updatedAt: 2 }], deletedIds: ['a'] }
  );
  assert(merged.items.length === 2, 'AUD-001: disjoint items from two devices are BOTH kept');
  assert(merged.items.some((i: any) => i.id === 'a') && merged.items.some((i: any) => i.id === 'b'),
    'AUD-001: resurrection scenario — existing item survives an incoming wholesale-style push');
  assert(merged.deletedIds.includes('a'), 'deletedIds: incoming tombstone recorded');

  const newerWins: any = mergeHomeworkGroupSlice(
    { items: [{ id: 'x', subject: 'OLD', updatedAt: 100 }] },
    { items: [{ id: 'x', subject: 'NEW', updatedAt: 200 }] }
  );
  assert(newerWins.items[0].subject === 'NEW', 'items: newer updatedAt wins (incoming newer)');

  const olderIncoming: any = mergeHomeworkGroupSlice(
    { items: [{ id: 'x', subject: 'KEEP', updatedAt: 300 }] },
    { items: [{ id: 'x', subject: 'DROP', updatedAt: 200 }] }
  );
  assert(olderIncoming.items[0].subject === 'KEEP', 'items: existing kept when incoming is older');

  const union: any = mergeHomeworkGroupSlice(
    { items: [], deletedIds: ['a', 'b'] },
    { items: [], deletedIds: ['b', 'c'] }
  );
  assert(union.deletedIds.length === 3 && ['a', 'b', 'c'].every(d => union.deletedIds.includes(d)),
    'deletedIds: set union, tombstones never regress');

  const isoDates: any = mergeHomeworkGroupSlice(
    { items: [{ id: 'x', subject: 'ISO-OLD', updatedAt: '2026-01-01T00:00:00Z' }] },
    { items: [{ id: 'x', subject: 'ISO-NEW', updatedAt: '2026-06-01T00:00:00Z' }] }
  );
  assert(isoDates.items[0].subject === 'ISO-NEW', 'items: ISO-string updatedAt compared correctly');

  console.log('\n--- Unit: mergeUsefulGroupSlice ---');
  const useful: any = mergeUsefulGroupSlice(
    { items: [{ id: 'u1', title: 'A', createdAt: '2026-02-01' }], deletedIds: ['u0'] },
    { items: [{ id: 'u2', title: 'B', createdAt: '2026-03-01' }], deletedIds: [] }
  );
  assert(useful.items.length === 2, 'useful: items from two devices are both kept');
  assert(useful.deletedIds.includes('u0'), 'useful: tombstone kept');

  console.log('\n--- Unit: mergeScheduleGroupSlice ---');
  const sched1: any = mergeScheduleGroupSlice(
    { overrides: { 'k1': { subject: 'Old', updatedAt: 100 } }, teachers: { 'Физика': 'ПТП' } },
    { overrides: { 'k2': { subject: 'Other', updatedAt: 200 } }, teachers: { 'Химия': 'ХХХ' } }
  );
  assert(sched1.overrides.k1 && sched1.overrides.k2, 'schedule: disjoint override keys both kept');
  assert(sched1.teachers['Физика'] === 'ПТП' && sched1.teachers['Химия'] === 'ХХХ', 'schedule: teachers union');

  const sched2: any = mergeScheduleGroupSlice(
    { overrides: { 'k1': { subject: 'Newer', updatedAt: 300 } } },
    { overrides: { 'k1': { subject: 'Older', updatedAt: 100 } } }
  );
  assert(sched2.overrides.k1.subject === 'Newer', 'schedule: override with newer updatedAt wins');
}

// ---------------------------------------------------------------------------
// Integration level: through worker.fetch with X-App-Key
// ---------------------------------------------------------------------------

const kvStore = new Map<string, string>();
const mockEnv = {
  TELEGRAM_BOT_TOKEN: 'mock_bot_token_sync_merge',
  ID_PEPPER: 'mock_pepper_sync_merge',
  APP_SECRET: 'test-sync-app-key',
  APP_DATA: {
    get: async (k: string) => kvStore.get(k) || null,
    put: async (k: string, v: string) => { kvStore.set(k, v); },
    delete: async (k: string) => { kvStore.delete(k); }
  }
};

const APP_KEY_HEADERS = { 'Content-Type': 'application/json', 'X-App-Key': 'test-sync-app-key' };

async function putSync(type: string, gid: string, body: any) {
  return worker.fetch(new Request(`https://worker.test/sync/${type}?groupId=${gid}`, {
    method: 'PUT',
    headers: APP_KEY_HEADERS,
    body: JSON.stringify(body)
  }), mockEnv);
}

async function getSync(type: string, gid: string) {
  const res = await worker.fetch(new Request(`https://worker.test/sync/${type}?groupId=${gid}`), mockEnv);
  return { status: res.status, json: await res.json() };
}

async function runIntegrationTests() {
  const GID = 'ingt-310';

  console.log('\n--- Integration: homework two-device convergence through PUT /sync ---');
  kvStore.clear();

  let res = await putSync('homework', GID, { items: [{ id: 'hw-1', subject: 'Задание A', updatedAt: 1000 }], deletedIds: [] });
  assert(res.status === 200, 'device A push accepted (200)');
  res = await putSync('homework', GID, { items: [{ id: 'hw-2', subject: 'Задание B', updatedAt: 2000 }], deletedIds: ['hw-0'] });
  assert(res.status === 200, 'device B push accepted (200)');

  const hw = await getSync('homework', GID);
  const hwSlice = hw.json?.byGroup?.[GID];
  assert(hwSlice?.items?.length === 2, 'AUD-001: both devices\' homework items survive (old code lost one)');
  assert(hwSlice?.deletedIds?.includes('hw-0'), 'AUD-001: tombstone from device B stored');

  console.log('\n--- Integration: AUD-002 cap raise (250 items > old cap 200) ---');
  const many = Array.from({ length: 250 }, (_, i) => ({ id: `bulk-${i}`, subject: `S${i}`, updatedAt: 5000 + i }));
  res = await putSync('homework', GID, { items: many, deletedIds: [] });
  assert(res.status === 200, '250-item push accepted');
  const hw2 = await getSync('homework', GID);
  const kept = (hw2.json?.byGroup?.[GID]?.items || []).filter((i: any) => String(i.id).startsWith('bulk-'));
  assert(kept.length === 250, `AUD-002: all 250 items stored (old cap truncated at 200), got ${kept.length}`);

  console.log('\n--- Integration: useful tombstones union (AUD-011 server side) ---');
  res = await putSync('useful', GID, { items: [{ id: 'u1', title: 'Полезное', createdAt: '2026-02-01' }], deletedIds: ['u-dead'] });
  assert(res.status === 200, 'useful push accepted');
  res = await putSync('useful', GID, { items: [{ id: 'u2', title: 'Ещё полезное', createdAt: '2026-03-01' }], deletedIds: ['u-gone'] });
  assert(res.status === 200, 'second useful push accepted');
  const uf = await getSync('useful', GID);
  const ufSlice = uf.json?.byGroup?.[GID];
  assert(ufSlice?.items?.length === 2, 'useful: both items survive');
  assert(ufSlice?.deletedIds?.includes('u-dead') && ufSlice?.deletedIds?.includes('u-gone'),
    'AUD-011: tombstones from both pushes are unioned');

  console.log('\n--- Integration: schedule override latest-wins, no regress ---');
  res = await putSync('schedule', GID, { scheduleOverrides: { 'k1': { subject: 'V1', updatedAt: 100 } } });
  assert(res.status === 200, 'schedule push v1 accepted');
  res = await putSync('schedule', GID, { scheduleOverrides: { 'k1': { subject: 'V2', updatedAt: 200 } } });
  assert(res.status === 200, 'schedule push v2 accepted');
  const sc = await getSync('schedule', GID);
  let slice = sc.json?.byGroup?.[GID];
  assert(slice?.overrides?.k1?.subject === 'V2', 'schedule: newer override won');
  res = await putSync('schedule', GID, { scheduleOverrides: { 'k1': { subject: 'STALE', updatedAt: 50 } } });
  const sc2 = await getSync('schedule', GID);
  slice = sc2.json?.byGroup?.[GID];
  assert(slice?.overrides?.k1?.subject === 'V2', 'schedule: stale override did NOT regress the stored value');
}

runUnitTests();
await runIntegrationTests();

console.log(`\n=================================================`);
console.log(`  SYNC UNION MERGE: ${passed} CHECKS PASSED  `);
console.log(`=================================================\n`);
