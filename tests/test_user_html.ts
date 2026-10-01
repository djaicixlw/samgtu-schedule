import fs from 'fs';
import { parseSamgtuSchedule } from '../utils/samgtuParser';

const html = fs.readFileSync('tests/user_lk_export.html', 'utf-8');
const result = parseSamgtuSchedule(html);
console.log('Result with current parser:');
console.log('Meta:', result.meta);
console.log('Raw lessons count:', result.rawLessons.length);
console.log('Total unique lessons:', result.totalUniqueLessons);
console.log('Date range:', result.dateRange);
console.log('Raw lessons:', JSON.stringify(result.rawLessons, null, 2));
