import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';
import { initTelegram } from './utils/tma';
import { setSemesterConfig } from './utils/samaraDate';
import { migrateLegacyGroupKeys } from './utils/groupMigration';

async function bootstrap() {
  initTelegram();
  // AUD-005: migrate legacy group keys BEFORE anything reads my_group_id. Without this
  // call (it existed but was never invoked from production code), changing groups
  // (e.g. faid-110 -> faid-310) permanently orphaned the previous group's local
  // attendance, homework and schedule data.
  try {
    const migration = migrateLegacyGroupKeys();
    if (migration.migratedCount > 0) {
      console.info(`[bootstrap] migrated ${migration.migratedCount} legacy group key(s)`);
    }
  } catch (e) {
    console.warn('[bootstrap] legacy group key migration failed:', e);
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000); // 2s таймаут для оффлайна
    const res = await fetch(`${import.meta.env.BASE_URL}semester.json`, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const cfg = await res.json();
      if (cfg && cfg.semesterName && Array.isArray(cfg.blocks)) {
        setSemesterConfig(cfg);
      }
    }
  } catch {
    // Offline or network error fallback: samaraDate will use compiled default semester
  }

  const rootElement = document.getElementById('root');
  if (!rootElement) throw new Error("Could not find root element to mount to");
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}
bootstrap();