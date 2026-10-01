import fs from 'fs';

const html = fs.readFileSync('tests/user_lk_export.html', 'utf-8');

// Parse tooltips
const tooltipRegex = /<div class="tooltip"[^>]*id="([^"]+)"[^>]*>[\s\S]*?<div class="tooltip-inner">([\s\S]*?)<\/div>/gi;
const tooltips: Record<string, { time: string; teacher?: string; type?: string; groups?: string }> = {};
let tm;
while ((tm = tooltipRegex.exec(html)) !== null) {
  const lines = tm[2].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim().split('\n').map(s => s.trim()).filter(Boolean);
  tooltips[tm[1]] = {
    time: lines[0] || '',
    teacher: lines[1] || '',
    type: lines[2] || '',
    groups: lines[3] || ''
  };
}

console.log('Tooltips count:', Object.keys(tooltips).length);

// In FullCalendar v4, each week row is:
// <div class="fc-row fc-week fc-widget-content">
// Inside:
//   <div class="fc-bg"><table><tbody><tr><td data-date="2026-08-31">...</td>...
//   <div class="fc-content-skeleton">
//     <table>
//       <thead>... contains the 7 day top numbers ...
//       <tbody>... rows of events

const weekRegex = /<div class="fc-row fc-week[^"]*"[\s\S]*?(?=<div class="fc-row fc-week|<\/tbody>\s*<\/table>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/td>)/g;
let wm;
let weekIdx = 0;
const weeks: { weekIdx: number; events: Array<{ date: string; time: string; title: string; teacher?: string; type?: string }> }[] = [];

// Split by fc-row fc-week
const weekChunks = html.split(/<div class="fc-row fc-week[^"]*"/);

for (let w = 1; w < weekChunks.length; w++) {
  const chunk = weekChunks[w];
  // Get 7 dates from data-date
  const dateMatches = Array.from(chunk.matchAll(/data-date="(\d{4}-\d{2}-\d{2})"/g)).map(m => m[1]);
  const daysOfThisWeek = Array.from(new Set(dateMatches)).slice(0, 7);
  console.log(`\nWeek ${w} (${daysOfThisWeek[0]} - ${daysOfThisWeek[6]}):`);

  // Parse events in this week
  // FullCalendar skeleton:
  // Each tr in tbody has 7 columns (or spans).
  // Column 0 = Monday (daysOfThisWeek[0]), Column 1 = Tuesday (daysOfThisWeek[1]), etc.
  const tbodyMatch = chunk.match(/<div class="fc-content-skeleton">[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/);
  if (!tbodyMatch) continue;

  const trs = tbodyMatch[1].split(/<tr>/);
  // Grid matrix: row x col
  const grid: (boolean)[][] = [];

  for (let r = 1; r < trs.length; r++) {
    const tr = trs[r];
    const tdMatches = Array.from(tr.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g));
    let col = 0;

    for (const td of tdMatches) {
      const attrs = td[1];
      const content = td[2];

      const rowspanMatch = attrs.match(/rowspan="(\d+)"/);
      const rowspan = rowspanMatch ? parseInt(rowspanMatch[1], 10) : 1;
      const colspanMatch = attrs.match(/colspan="(\d+)"/);
      const colspan = colspanMatch ? parseInt(colspanMatch[1], 10) : 1;

      // Find first unoccupied column in this row
      while (grid[r] && grid[r][col]) {
        col++;
      }

      // Mark occupied cells in grid for rowspan/colspan
      for (let ri = 0; ri < rowspan; ri++) {
        if (!grid[r + ri]) grid[r + ri] = [];
        for (let ci = 0; ci < colspan; ci++) {
          grid[r + ri][col + ci] = true;
        }
      }

      const dateForCol = daysOfThisWeek[col];

      // Check if this td contains an event
      const evMatch = content.match(/<span class="fc-time">([^<]*)<\/span>\s*<span class="fc-title">([^<]*)<\/span>/);
      const ttMatch = content.match(/aria-describedby="([^"]*)"/);

      if (evMatch) {
        const time = evMatch[1].trim();
        const title = evMatch[2].trim();
        const ttId = ttMatch ? ttMatch[1] : '';
        const ttInfo = ttId ? tooltips[ttId] : undefined;

        console.log(`  [${dateForCol}] (col ${col}) ${time} - ${title} | ${ttInfo?.teacher || 'нет преп.'} | ${ttInfo?.type || 'нет типа'}`);
      }

      col += colspan;
    }
  }
}
