import { fetchGroupCloudData, pushGroupCloudData } from '../utils/cloudSync';
import { SCHEDULE_REGISTRY, AVAILABLE_GROUPS } from '../constants';
import { STUDENTS_REGISTRY, BLOCKS, getSemesterWeek, getDayName, getDayISODate } from '../attendance';

async function runAudit() {
  console.log('=== 1. CLOUD SYNC AUDIT ===');
  const t1 = Date.now();
  const d1 = await fetchGroupCloudData(true, 'ingt-310');
  console.log(`[ingt-310] Fetch time: ${Date.now() - t1}ms | HW items: ${d1?.homework?.length} | Overrides: ${Object.keys(d1?.scheduleOverrides || {}).length}`);

  const t2 = Date.now();
  const d2 = await fetchGroupCloudData(true, 'faid-310');
  console.log(`[faid-310] Fetch time: ${Date.now() - t2}ms | HW items: ${d2?.homework?.length} | Overrides: ${Object.keys(d2?.scheduleOverrides || {}).length}`);

  console.log('\n=== 2. GROUP REGISTRY AUDIT ===');
  for (const grp of AVAILABLE_GROUPS) {
    const sched = SCHEDULE_REGISTRY[grp.id];
    const students = STUDENTS_REGISTRY[grp.id] || [];
    let totalPairs = 0;
    if (sched) {
      for (let w = 1; w <= 4; w++) {
        (sched[w] || []).forEach(d => totalPairs += d.lessons.length);
      }
    }
    console.log(`Group: ${grp.name.padEnd(12)} [${grp.id.padEnd(10)}] -> Schedule: ${sched ? `${totalPairs} pairs` : 'MISSING!'} | Students: ${students.length}`);
  }

  console.log('\n=== 3. ATTENDANCE & DATE BOUNDARY AUDIT ===');
  const testDates = [
    { label: 'Start Block 1', date: '2026-08-31' },
    { label: 'End Block 1', date: '2026-09-20' },
    { label: 'Start Block 2', date: '2026-09-21' },
    { label: 'End Block 2', date: '2026-10-20' },
    { label: 'Start Block 3', date: '2026-10-21' },
    { label: 'End Block 3', date: '2026-11-20' },
    { label: 'Start Block 4', date: '2026-11-21' },
    { label: 'End Block 4', date: '2026-12-25' },
    { label: 'Post Block 4 (credit week)', date: '2026-12-28' },
    { label: 'Exam Session Jan', date: '2027-01-12' }
  ];

  for (const td of testDates) {
    const dObj = new Date(td.date + 'T12:00:00');
    const w = getSemesterWeek(dObj);
    const day = getDayName(dObj);
    const inBlock = BLOCKS.find(b => td.date >= b.start && td.date <= b.end);
    console.log(`${td.label.padEnd(28)} (${td.date}) -> Week: ${w} [${day}] | Block: ${inBlock ? inBlock.name : 'NONE (LOST IN REPORT!)'}`);
  }

  console.log('\n=== AUDIT COMPLETED ===');
}

runAudit();
