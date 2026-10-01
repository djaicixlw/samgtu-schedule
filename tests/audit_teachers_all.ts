import { SCHEDULE_REGISTRY } from '../constants';

for (const [gid, sched] of Object.entries(SCHEDULE_REGISTRY)) {
  console.log('=== ' + gid + ' ===');
  const map: Record<string, Set<string>> = {};
  for (let w = 1; w <= 4; w++) {
    sched[w]?.forEach(d => d.lessons.forEach(l => {
      const key = `${l.subject} [${l.type}]`;
      if (!map[key]) map[key] = new Set();
      map[key].add(l.teacher || 'NONE');
    }));
  }
  for (const [k, v] of Object.entries(map)) {
    console.log(`  ${k} -> "${[...v].join(', ')}"`);
  }
}
