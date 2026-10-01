/**
 * CLI Tool for importing diagnostic bug reports into Obsidian knowledge base.
 * Usage:
 *   npx tsx scripts/import_bugreport.ts <path-to-diagnostic.json> [description]
 */

import * as fs from 'fs';
import * as path from 'path';

interface DiagnosticDump {
  system?: {
    timestamp?: string;
    telegramPlatform?: string;
    tgWebAppVersion?: string;
    userAgent?: string;
    currentGroupId?: string;
    errorLogsCount?: number;
    totalLogsCount?: number;
  };
  exportedAt?: string;
  diagnostics?: any;
  recentLogs?: Array<{
    timestamp: string;
    level: string;
    category: string;
    message: string;
    data?: any;
  }>;
  logs?: Array<any>;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Usage: npx tsx scripts/import_bugreport.ts <path-to-diagnostic.json> [optional description]');
    process.exit(1);
  }

  const inputFilePath = path.resolve(args[0]);
  if (!fs.existsSync(inputFilePath)) {
    console.error(`File not found: ${inputFilePath}`);
    process.exit(1);
  }

  const customDesc = args.slice(1).join(' ') || 'Автоматически импортированный баг-репорт';
  const fileContent = fs.readFileSync(inputFilePath, 'utf-8');
  let data: DiagnosticDump;
  try {
    data = JSON.parse(fileContent);
  } catch (err) {
    console.error(`Error parsing JSON: ${err}`);
    process.exit(1);
  }

  const sys = data.system || data.diagnostics || {};
  const logs = data.recentLogs || data.logs || [];
  const timestamp = sys.timestamp || data.exportedAt || new Date().toISOString();
  const group = sys.currentGroupId || 'unknown';
  const platform = sys.telegramPlatform || 'unknown';
  const errorCount = sys.errorLogsCount ?? logs.filter(l => l.level === 'ERROR').length;
  const dateStr = timestamp.slice(0, 10);
  const timeStr = timestamp.slice(11, 19);

  const reportsDir = path.resolve(__dirname, '../samgtu_schedule/05 - Надежность и Тестирование/Баг-репорты');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const baseFileName = path.basename(inputFilePath);
  const targetJsonPath = path.join(reportsDir, baseFileName);
  if (inputFilePath !== targetJsonPath) {
    fs.copyFileSync(inputFilePath, targetJsonPath);
  }

  const noteTitle = `${dateStr} - ${group} - Баг-репорт`;
  const noteFileName = `${noteTitle.replace(/[^a-zA-Z0-9а-яА-ЯёЁ_ -]/g, '')}.md`;
  const targetNotePath = path.join(reportsDir, noteFileName);

  const errorLogs = logs.filter(l => l.level === 'ERROR');
  const warnLogs = logs.filter(l => l.level === 'WARN');

  const mdContent = `---
title: "${noteTitle}"
date: ${dateStr}
group: ${group}
platform: ${platform}
status: open
error_count: ${errorCount}
tags:
  - bugreport
  - diagnostics
  - ${platform}
  - ${group.replace(/[^a-zA-Z0-9]/g, '')}
---

# 🚨 ${noteTitle}

📊 **Сводка**: [OS: ${platform} | Ошибок в логе: ${errorCount} | Логов всего: ${logs.length}]

- 👥 **Группа**: \`${group}\`
- 📱 **Платформа**: ${platform}
- ⏰ **Время**: ${dateStr} ${timeStr} (UTC+4)
- 🌐 **User Agent**: \`${sys.userAgent || 'unknown'}\`
- 📝 **Описание**: ${customDesc}

---

## 🔍 Ошибки в логе (${errorLogs.length})

${errorLogs.length === 0 ? '_Ошибок уровня ERROR в логе не обнаружено._' : ''}
${errorLogs.map((l, i) => `### Ошибка #${i + 1}: [${l.category}] ${l.message}
- **Время**: ${l.timestamp}
- **Детали**:
\`\`\`json
${JSON.stringify(l.data || {}, null, 2)}
\`\`\`
`).join('\n')}

${warnLogs.length > 0 ? `## ⚠️ Предупреждения (${warnLogs.length})
${warnLogs.map((l, i) => `- **[${l.category}]** \`${l.message}\` (${l.timestamp})`).join('\n')}
` : ''}

---

## 📋 Диагностический дамп
Файл дампа: [[${baseFileName}]]
`;

  fs.writeFileSync(targetNotePath, mdContent, 'utf-8');
  console.log(`✅ Successfully imported bug report into Obsidian:`);
  console.log(`   Note: ${targetNotePath}`);
  console.log(`   Dump: ${targetJsonPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
