import fs from 'fs';
import { parseSamgtuSchedule, exportToRegistryCode } from '../utils/samgtuParser';

const testFile = fs.readFileSync('tests/test_bot_parser.ts', 'utf-8');
const textMatch = testFile.match(/const botText = `([\s\S]*?)`;/);
const text = textMatch ? textMatch[1] : '';

const result = parseSamgtuSchedule(text, { groupIdOverride: 'faid-310', groupNameOverride: '3-ФАИД-110' });
console.log('Result totalUniqueLessons:', result.totalUniqueLessons);
console.log('Subjects:', result.uniqueSubjects);
console.log('Weeks 1 lessons count:', result.weeks[1].reduce((a, b) => a + b.lessons.length, 0));
console.log('Weeks 2 lessons count:', result.weeks[2].reduce((a, b) => a + b.lessons.length, 0));
console.log('Weeks 3 lessons count:', result.weeks[3].reduce((a, b) => a + b.lessons.length, 0));
console.log('Weeks 4 lessons count:', result.weeks[4].reduce((a, b) => a + b.lessons.length, 0));

const code = exportToRegistryCode(result, 'faid-310');
fs.writeFileSync('tests/faid_schedule_generated.ts', code, 'utf-8');
console.log('Done writing tests/faid_schedule_generated.ts');
