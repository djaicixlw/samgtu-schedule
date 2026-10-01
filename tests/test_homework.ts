import { getSamaraISODate } from '../attendance';

console.log("=================================================");
console.log("          TEST SUITE 4: HOMEWORK TRACKER         ");
console.log("=================================================");

// 4.1 Filters test
console.log("\n--- 4.1 Filter Comparison Logic ---");
const todayISO = "2026-09-03";

const testHomeworks = [
  { id: 'hw-1', title: 'Overdue by 5 days', dueDate: '2026-08-29' },
  { id: 'hw-2', title: 'Overdue by 1 day', dueDate: '2026-09-02' },
  { id: 'hw-3', title: 'Due TODAY', dueDate: '2026-09-03' },
  { id: 'hw-4', title: 'Due tomorrow', dueDate: '2026-09-04' },
  { id: 'hw-5', title: 'Due in 3 days', dueDate: '2026-09-06' },
  { id: 'hw-6', title: 'Due in 7 days', dueDate: '2026-09-10' },
];

function filterItems(items: typeof testHomeworks, mode: 'all' | 'upcoming' | 'past') {
  return items.filter(item => {
    if (mode === 'upcoming') return item.dueDate >= todayISO;
    if (mode === 'past') return item.dueDate < todayISO;
    return true;
  });
}

console.log("Upcoming items:", filterItems(testHomeworks, 'upcoming').map(i => `${i.title} (${i.dueDate})`));
console.log("Past items:", filterItems(testHomeworks, 'past').map(i => `${i.title} (${i.dueDate})`));
console.log("All items:", filterItems(testHomeworks, 'all').map(i => `${i.title} (${i.dueDate})`));

// 4.2 getDueBadge test
console.log("\n--- 4.2 getDueBadge Output Analysis ---");
function getDueBadgeText(dueDate: string, today: string = todayISO): string {
  if (dueDate < today) {
    return 'Срок истек';
  }
  if (dueDate === today) {
    return '🔥 Дедлайн СЕГОДНЯ!';
  }
  // Calculate days remaining
  const diff = Math.ceil((new Date(dueDate).getTime() - new Date(today).getTime()) / (1000 * 3600 * 24));
  if (diff <= 3) {
    return `⏳ Осталось ${diff} ${diff === 1 ? 'день' : diff < 5 ? 'дня' : 'дней'}`;
  }
  return `До ${dueDate.split('-').reverse().slice(0, 2).join('.')}`;
}

const testDates = [
  { desc: "Overdue by 5 days", date: "2026-08-29" },
  { desc: "Overdue by 1 day", date: "2026-09-02" },
  { desc: "Today", date: "2026-09-03" },
  { desc: "Tomorrow", date: "2026-09-04" },
  { desc: "In 2 days", date: "2026-09-05" },
  { desc: "In 3 days", date: "2026-09-06" },
  { desc: "In 4 days", date: "2026-09-07" },
  { desc: "In 10 days", date: "2026-09-13" },
];

for (const td of testDates) {
  const badge = getDueBadgeText(td.date);
  console.log(`[${td.desc}] (${td.date}) -> "${badge}"`);
}

// 4.3 formDueDate creation between 00:00 and 04:00 Samara time
console.log("\n--- 4.3 formDueDate default calculation between 00:00 and 04:00 Samara time ---");
// Suppose client is at 2026-09-04 02:00:00 in Samara (UTC+4).
// In UTC, this instant is 2026-09-03 22:00:00.
const nightUtcMs = Date.UTC(2026, 8, 3, 22, 0, 0);
const nightSamaraISO = "2026-09-04"; // what getSamaraISODate() returns

// In HomeworkTracker, we now use getSamaraFutureISODate(7) which bases calculation on getSamaraISODate()
const [y, m, day] = nightSamaraISO.split('-').map(Number);
const date = new Date(Date.UTC(y, m - 1, day, 12, 0, 0));
date.setUTCDate(date.getUTCDate() + 7);
const resY = date.getUTCFullYear();
const resM = String(date.getUTCMonth() + 1).padStart(2, '0');
const resD = String(date.getUTCDate()).padStart(2, '0');
const formDueDateCalculated = `${resY}-${resM}-${resD}`;

console.log(`Instant: 2026-09-04 02:00 Samara (2026-09-03 22:00 UTC)`);
console.log(`  formAssignedDate (from getSamaraISODate): ${nightSamaraISO}`);
console.log(`  formDueDate (from getSamaraFutureISODate): ${formDueDateCalculated}`);
const daysDiff = (new Date(formDueDateCalculated).getTime() - new Date(nightSamaraISO).getTime()) / (1000 * 3600 * 24);
console.log(`  Difference: ${daysDiff} days (Expected: 7 days)`);
if (daysDiff === 7) {
  console.log("  [PASS] Homework created between 00:00 and 04:00 Samara time correctly gets exactly 7 days difference!");
} else {
  console.log("  >>> BUG: Homework created between 00:00 and 04:00 gets incorrect days difference! <<<");
}
