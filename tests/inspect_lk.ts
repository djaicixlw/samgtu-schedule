import fs from 'fs';

const html = fs.readFileSync('tests/user_lk_export.html', 'utf-8');

// Match tooltips
const tooltipRegex = /<div class="tooltip"[^>]*id="([^"]+)"[^>]*>[\s\S]*?<div class="tooltip-inner">([\s\S]*?)<\/div>/gi;
const tooltips: Record<string, string> = {};
let m;
while ((m = tooltipRegex.exec(html)) !== null) {
  tooltips[m[1]] = m[2].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
}

console.log('Total tooltips parsed:', Object.keys(tooltips).length);
for (const [id, text] of Object.entries(tooltips).slice(0, 5)) {
  console.log('Tooltip', id, ':\n ', text.split('\n').join(' | '));
}

// Check user
const nameM = html.match(/<div class="current-user__name">([^<]+)<\/div>/);
const infoM = html.match(/<div class="current-user__info">([^<]+)<\/div>/);
console.log('User Name:', nameM ? nameM[1].trim() : 'none');
console.log('User Info:', infoM ? infoM[1].trim() : 'none');

// Count weeks
const weekMatches = html.match(/<div class="fc-row fc-week[^"]*"/g);
console.log('Week rows count:', weekMatches?.length);

// Check event elements
const eventRegex = /<a[^>]*class="[^"]*fc-day-grid-event[^"]*"[^>]*href="([^"]*view\?id=(\d+))"[^>]*(?:aria-describedby="([^"]*)")?[\s\S]*?<span class="fc-time">([^<]*)<\/span>[\s\S]*?<span class="fc-title">([^<]*)<\/span>/gi;
let evMatch;
let evCount = 0;
while ((evMatch = eventRegex.exec(html)) !== null) {
  evCount++;
  if (evCount <= 5) {
    console.log(`Event ${evCount}: Time=${evMatch[4]} | Title=${evMatch[5]} | TooltipId=${evMatch[3]} | ViewId=${evMatch[2]}`);
  }
}
console.log('Total events matching regex:', evCount);
