import fs from 'fs';
import path from 'path';
import { parseSamgtuSchedule, exportToRegistryCode } from '../utils/samgtuParser';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log(`
Использование:
  npx tsx scripts/parse_lk_samgtu.ts <путь_к_файлу.html> [group_id]

Пример:
  npx tsx scripts/parse_lk_samgtu.ts schedule_dump.html ingt-310
    `);
    process.exit(1);
  }

  const filePath = path.resolve(args[0]);
  if (!fs.existsSync(filePath)) {
    console.error(`Файл не найден: ${filePath}`);
    process.exit(1);
  }

  const rawContent = fs.readFileSync(filePath, 'utf-8');
  console.log(`Загружен файл: ${filePath} (${rawContent.length} байт)`);

  const groupIdOverride = args[1];
  const parsed = parseSamgtuSchedule(rawContent, { groupIdOverride });

  console.log('\n=== РЕЗУЛЬТАТЫ ПАРСИНГА САМГТУ ===');
  console.log(`Группа: ${parsed.meta.groupName || 'н/д'} (ID: ${parsed.meta.normalizedGroupId})`);
  if (parsed.meta.studentName) {
    console.log(`Студент: ${parsed.meta.studentName}`);
    console.log(`Зачетная книжка: ${parsed.meta.recordBookNumber || 'н/д'}`);
  }
  console.log(`Всего распознано занятий (сырых): ${parsed.rawLessons.length}`);
  console.log(`Уникальных пар в 4-недельном цикле: ${parsed.totalUniqueLessons}`);
  console.log(`Дисциплин: ${parsed.uniqueSubjects.length}`);
  console.log(`Преподавателей: ${parsed.uniqueTeachers.length}`);
  if (parsed.dateRange.start) {
    console.log(`Диапазон дат: ${parsed.dateRange.start} — ${parsed.dateRange.end}`);
  }

  console.log('\n--- Распределение по 4-недельному циклу ---');
  for (let w = 1; w <= 4; w++) {
    const totalWeekLessons = parsed.weeks[w].reduce((sum, d) => sum + d.lessons.length, 0);
    console.log(`  Неделя ${w}: ${totalWeekLessons} пар`);
    for (const d of parsed.weeks[w]) {
      if (d.lessons.length > 0) {
        console.log(`    ${d.dayName}: ${d.lessons.length} пар [${d.lessons.map(l => l.timeStart).join(', ')}]`);
      }
    }
  }

  // Generate output TS file
  const outTsPath = path.join(path.dirname(filePath), `parsed_${parsed.meta.normalizedGroupId || 'schedule'}.ts`);
  const tsCode = exportToRegistryCode(parsed, groupIdOverride);
  fs.writeFileSync(outTsPath, tsCode, 'utf-8');
  console.log(`\nГотовый TypeScript-код сохранен в: ${outTsPath}`);
}

main().catch(err => {
  console.error('Ошибка при парсинге:', err);
  process.exit(1);
});
