/**
 * AUD-004 regression test: a mark made WHILE the pull is in flight must survive.
 *
 * Old defect: the sync cycle captured `local` before awaiting the network pull and
 * merged against that stale snapshot, silently dropping any cell marked during the
 * (multi-second) pull. The fix re-reads local state after the pull resolves.
 *
 * This test drives the extracted cycle (syncAttendanceWithCloud) with a pull that
 * resolves only after the "user" has added a mark, and asserts the mark survives
 * the merge and is included in the subsequent push.
 */

import { syncAttendanceWithCloud } from '../attendance';
import type { AttendanceRecord } from '../attendance';
import { merge3 } from '../utils/attendanceMerge3';
import { updateBaseFromMerge } from '../utils/attendanceBase';

console.log('\n=================================================');
console.log('   TEST SUITE: SYNC CYCLE STALE SNAPSHOT (AUD-004)');
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

const GID = 'ingt-310';

const baseRecord: AttendanceRecord = {
  docId: `${GID}_2026-10-12_310-w3-mo-3`,
  groupId: GID,
  date: '2026-10-12',
  lessonId: '310-w3-mo-3',
  absentStudentIds: [1],
  excusedStudentIds: [],
  isCancelled: false,
  updatedAt: 1700000000000
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function runStaleSnapshotTests() {
  // Local state at cycle start: only student 1 absent.
  let liveRecords: AttendanceRecord[] = [baseRecord];

  const getLocalRecords = () => liveRecords.map(r => ({ ...r }));

  // The pull is slow. While it is in flight the "user" marks student 2 as well
  // (markBatchAttendance updates recordsRef synchronously — emulated here by
  // mutating the live store inside the pull's delay window, before it resolves).
  const slowPull = async () => {
    await sleep(40);
    liveRecords = [{ ...baseRecord, absentStudentIds: [1, 2], updatedAt: Date.now() }];
    // Server echo: same state as cycle start (nobody else pushed).
    return [baseRecord];
  };

  let pushedRecords: AttendanceRecord[] | null = null;
  const push = async (_gid: string, records: AttendanceRecord[]) => {
    pushedRecords = records;
    return { ok: true };
  };

  let mergedSeen: AttendanceRecord[] | null = null;
  const result = await syncAttendanceWithCloud({
    groupId: GID,
    getLocalRecords,
    pull: slowPull,
    push,
    isDirty: () => true, // the interim mark set the dirty flag (markBatchAttendance does)
    onMerged: (merged) => { mergedSeen = merged; },
    onPushedOk: () => {},
    recentOnly: false
  });

  // The critical assertion: the interim mark (student 2) survived the merge.
  // mergedSeen was produced AFTER the interim edit, because the cycle re-reads
  // local state post-pull (AUD-004).
  const interimApplied = liveRecords[0].absentStudentIds.includes(2);
  assert(interimApplied, 'scenario setup: interim mark applied to live records during pull');

  assert(result.merged.length === 1, 'cycle returns the single lesson record');
  assert(mergedSeen !== null, 'onMerged delivered the merged state');

  const mergedAbsents = new Set(mergedSeen![0].absentStudentIds);
  assert(mergedAbsents.has(1) && mergedAbsents.has(2),
    `AUD-004: interim mark (student 2) survives the merge (got: ${[...mergedAbsents].join(',')})`);

  assert(pushedRecords !== null && pushedRecords[0].absentStudentIds.includes(2),
    'AUD-004: the pushed payload includes the interim mark');

  // Sanity: with the OLD behavior (merge against the pre-pull snapshot) the interim
  // mark would have been lost — demonstrate the mechanism via merge3 directly:
  const staleLocal = [baseRecord];
  const res3 = merge3(staleLocal, null, [baseRecord], new Set(['2026-10']));
  assert(res3.merged[0].absentStudentIds.includes(1) && !res3.merged[0].absentStudentIds.includes(2),
    'sanity: merging the STALE snapshot alone would drop the interim mark (documents the old defect)');

  // And merging the FRESH local state keeps it (the actual fix mechanism):
  const fresh = [{ ...baseRecord, absentStudentIds: [1, 2], updatedAt: Date.now() }];
  updateBaseFromMerge(GID, {}, fresh);
  const res4 = merge3(fresh, null, [baseRecord], new Set(['2026-10']));
  assert(res4.merged[0].absentStudentIds.includes(2),
    'fix mechanism: merging the FRESH post-pull local state keeps the interim mark');

  console.log(`\n=================================================`);
  console.log(`  STALE SNAPSHOT: ${passed} CHECKS PASSED  `);
  console.log(`=================================================\n`);
}

await runStaleSnapshotTests();
