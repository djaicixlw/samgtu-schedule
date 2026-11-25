import * as fs from 'fs';
import * as path from 'path';
import { SCHEDULE_REGISTRY } from '../constants';
import { registerScheduleAliases, setNodeArchiveDiskLoader, parseWeekData } from './scheduleLoader';

/**
 * Preloads all schedule chunks synchronously in Node.js environments (test suites and audits).
 */
export function preloadAllSchedulesSync(): void {
  try {
    setNodeArchiveDiskLoader((windowStart, canonicalId) => {
      const localPath = path.resolve(
        process.cwd(),
        'public',
        'schedules',
        'archive',
        `block-from-week-${windowStart}`,
        `${canonicalId}.json`
      );
      if (!fs.existsSync(localPath)) return null;
      const raw = fs.readFileSync(localPath, 'utf8');
      return parseWeekData(JSON.parse(raw));
    });

    const schedulesDir = path.resolve(process.cwd(), 'public', 'schedules');
    if (!fs.existsSync(schedulesDir)) return;

    const files = fs.readdirSync(schedulesDir).filter((f: string) => f.endsWith('.json'));
    for (const file of files) {
      const canonicalId = file.replace(/\.json$/, '');
      const filePath = path.join(schedulesDir, file);
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      registerScheduleAliases(canonicalId, data);
    }
  } catch (e) {
    console.error('[ScheduleNodeLoader] Failed to preload schedules synchronously:', e);
  }
}
