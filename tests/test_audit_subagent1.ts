import { SCHEDULE_REGISTRY, AVAILABLE_GROUPS } from '../constants';
import { getSeedSubjectTeachers, SEED_SUBJECT_TEACHERS_BY_GROUP } from '../defaultData';
import { sanitizeTeachers, sanitizeOverrides } from '../utils/cloudSync';
import { getSemesterWeek, getSamaraISODate, getDayISODate } from '../attendance';

console.log('====================================================');
console.log('AUDIT CHECK 1: 3-ИНГТ-111 (ingt-311)');
console.log('====================================================');

const group311 = SCHEDULE_REGISTRY['ingt-311'];
if (!group311) {
  console.error('FAIL: SCHEDULE_REGISTRY["ingt-311"] not found!');
  process.exit(1);
}

const ids = new Set<string>();
const duplicates: any[] = [];
const nonBlankTeachers: any[] = [];
let totalLessons = 0;
const timeSlotsPerDay: Record<string, any[]> = {};

for (let w = 1; w <= 4; w++) {
  const days = group311[w] || [];
  for (const day of days) {
    const dayKey = `W${w}-${day.dayName}`;
    timeSlotsPerDay[dayKey] = timeSlotsPerDay[dayKey] || [];
    for (const l of day.lessons) {
      totalLessons++;
      if (ids.has(l.id)) {
        duplicates.push({ week: w, day: day.dayName, id: l.id, lesson: l });
      }
      ids.add(l.id);

      if (l.teacher && l.teacher.trim() !== '') {
        nonBlankTeachers.push({ week: w, day: day.dayName, subject: l.subject, teacher: l.teacher });
      }

      const slot = `${l.timeStart}-${l.timeEnd}`;
      timeSlotsPerDay[dayKey].push({ slot, subject: l.subject, type: l.type, id: l.id });
    }
  }
}

console.log('Total lessons across 4 weeks:', totalLessons);
console.log('Duplicate lesson IDs count:', duplicates.length);
if (duplicates.length > 0) console.log('Duplicates:', duplicates);

console.log('Non-blank teachers count in constants.ts:', nonBlankTeachers.length);
if (nonBlankTeachers.length > 0) console.log('Teachers found:', nonBlankTeachers);

// Check duplicate slots within the same day
const slotDuplicates: any[] = [];
for (const [dayKey, slots] of Object.entries(timeSlotsPerDay)) {
  const seenSlots: Record<string, any> = {};
  for (const s of slots) {
    if (seenSlots[s.slot]) {
      slotDuplicates.push({ dayKey, slot: s.slot, first: seenSlots[s.slot], second: s });
    } else {
      seenSlots[s.slot] = s;
    }
  }
}
console.log('Duplicate time slots on same day count:', slotDuplicates.length);
if (slotDuplicates.length > 0) console.log('Slot collisions:', slotDuplicates);

// Check seed teachers & sanitizeTeachers
const seed = getSeedSubjectTeachers('ingt-311');
console.log('Seed teachers count for ingt-311:', Object.keys(seed).length);
const sanitized = sanitizeTeachers({ ...seed }, 'ingt-311');
console.log('Sanitized teachers count for ingt-311:', Object.keys(sanitized).length);

// Check phantom lessons or weird entries
for (let w = 1; w <= 4; w++) {
  const days = group311[w] || [];
  for (const day of days) {
    for (const l of day.lessons) {
      if (!l.subject || !l.timeStart || !l.timeEnd || !l.location) {
        console.log(`POTENTIAL PHANTOM: W${w} ${day.dayName}:`, l);
      }
    }
  }
}

console.log('\n====================================================');
console.log('AUDIT CHECK 4: AUGUST 31 & MONDAYS FOR ADDED GROUPS');
console.log('====================================================');

const targetGroups = [
  'ingt-301', // 3-ИНГТ-101
  'ingt-303', // 3-ИНГТ-103
  'ingt-310', // 3-ИНГТ-110
  'ingt-311', // 3-ИНГТ-111
  'ingt-209', // 2-ИНГТ-109
  'htf-215',  // 2-ХТФ-115
  'faid-310'  // 3-ФАИД-110
];

const aug31Date = new Date(2026, 7, 31);
const aug31Week = getSemesterWeek(aug31Date);
console.log(`Date 2026-08-31 (Monday) falls on Semester Week: ${aug31Week}`);

for (const gid of targetGroups) {
  const sched = SCHEDULE_REGISTRY[gid];
  if (!sched) {
    console.error(`Group ${gid} NOT in SCHEDULE_REGISTRY!`);
    continue;
  }
  
  // Week 1 Monday lessons
  const w1Mon = sched[1]?.find(d => d.dayName === 'Понедельник');
  console.log(`\nGroup ${gid}:`);
  console.log(`  Week 1 Monday lessons count: ${w1Mon?.lessons.length ?? 0}`);
  if (w1Mon && w1Mon.lessons.length > 0) {
    w1Mon.lessons.forEach(l => {
      console.log(`    - ${l.timeStart}-${l.timeEnd}: ${l.subject} (${l.type}) [${l.teacher || 'NO TEACHER'}]`);
    });
  } else {
    console.log(`    (No lessons on Week 1 Monday)`);
  }

  // Check all weeks Monday lessons
  for (let w = 1; w <= 4; w++) {
    const mon = sched[w]?.find(d => d.dayName === 'Понедельник');
    console.log(`  Week ${w} Monday lessons: ${mon?.lessons.length ?? 0}`);
  }
}
