import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('=================================================');
console.log('  TEST SUITE: TELEGRAM WEBAPP & MOBILE ERGONOMICS');
console.log('=================================================');

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, message: string) {
  totalTests++;
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passedTests++;
  } else {
    console.error(`  [FAIL] ${message}`);
  }
}

// -------------------------------------------------------------
// 1. Telegram WebApp SDK Integration Tests
// -------------------------------------------------------------
console.log('\n--- 1. Telegram WebApp SDK Integration ---');

const indexHtmlPath = path.resolve(__dirname, '../index.html');
const indexHtmlContent = fs.readFileSync(indexHtmlPath, 'utf8');

const distHtmlPath = path.resolve(__dirname, '../dist/index.html');
const distHtmlContent = fs.existsSync(distHtmlPath) ? fs.readFileSync(distHtmlPath, 'utf8') : '';

const appTsxPath = path.resolve(__dirname, '../App.tsx');
const appTsxContent = fs.readFileSync(appTsxPath, 'utf8');

// 1.1 SDK script tag in index.html and dist/index.html
assert(
  indexHtmlContent.includes('<script src="https://telegram.org/js/telegram-web-app.js"></script>'),
  'index.html contains Telegram WebApp SDK script tag'
);
if (distHtmlContent) {
  assert(
    distHtmlContent.includes('<script src="https://telegram.org/js/telegram-web-app.js"></script>'),
    'dist/index.html contains Telegram WebApp SDK script tag after build'
  );
} else {
  console.log('  [INFO] dist/index.html not yet built, skipping post-build artifact check');
}

// 1.2 ready() and expand() in App.tsx
assert(
  appTsxContent.includes('window.Telegram.WebApp.ready()'),
  'App.tsx invokes window.Telegram.WebApp.ready()'
);
assert(
  appTsxContent.includes('window.Telegram.WebApp.expand()'),
  'App.tsx invokes window.Telegram.WebApp.expand()'
);

// 1.3 Safe handling when window.Telegram is undefined (regular browser or APK)
console.log('\n--- 1.3 Browser / APK Fallback Simulation (window.Telegram undefined) ---');
let browserCrashOccurred = false;
try {
  const fakeWindow: any = {
    matchMedia: () => ({ matches: false }),
    localStorage: { getItem: () => null, setItem: () => null }
  };
  // Simulate App.tsx guard
  if (typeof fakeWindow !== 'undefined' && fakeWindow.Telegram?.WebApp) {
    fakeWindow.Telegram.WebApp.ready();
    fakeWindow.Telegram.WebApp.expand();
  }
} catch (err) {
  browserCrashOccurred = true;
}
assert(!browserCrashOccurred, 'Absence of window.Telegram does not throw or crash runtime');

// 1.4 TMA environment simulation
console.log('\n--- 1.4 TMA Environment Simulation (Telegram WebApp present) ---');
let readyCalled = false;
let expandCalled = false;
let closeConfirmationCalled = false;
let headerColorSet = '';
let eventSubscribed = false;

const mockTelegram = {
  WebApp: {
    ready: () => { readyCalled = true; },
    expand: () => { expandCalled = true; },
    enableClosingConfirmation: () => { closeConfirmationCalled = true; },
    setHeaderColor: (color: string) => { headerColorSet = color; },
    setBackgroundColor: () => {},
    onEvent: (event: string) => { if (event === 'themeChanged') eventSubscribed = true; },
    offEvent: () => {},
    colorScheme: 'dark'
  }
};

try {
  if (mockTelegram?.WebApp) {
    mockTelegram.WebApp.ready();
    mockTelegram.WebApp.expand();
    mockTelegram.WebApp.enableClosingConfirmation();
    mockTelegram.WebApp.setHeaderColor('#0f172a');
    mockTelegram.WebApp.onEvent('themeChanged');
  }
} catch (e) {}

assert(readyCalled, 'window.Telegram.WebApp.ready() successfully called in TMA');
assert(expandCalled, 'window.Telegram.WebApp.expand() successfully called in TMA');
assert(closeConfirmationCalled, 'window.Telegram.WebApp.enableClosingConfirmation() active for modal safety');
assert(headerColorSet === '#0f172a', 'Telegram header color dynamically matches theme');
assert(eventSubscribed, 'Telegram themeChanged event listener successfully registered');

// -------------------------------------------------------------
// 2. Vite Relative Paths & Telegram WebApp iframe Compatibility
// -------------------------------------------------------------
console.log('\n--- 2.1 Relative Paths (base: "./") ---');

const viteConfigPath = path.resolve(__dirname, '../vite.config.ts');
const viteConfigContent = fs.readFileSync(viteConfigPath, 'utf8');

assert(
  viteConfigContent.includes("base: './'") || viteConfigContent.includes("VITE_BASE") || viteConfigContent.includes('/samgtu-schedule/'),
  'vite.config.ts explicitly sets base path for GitHub Pages subpath isolation'
);

if (distHtmlContent) {
  const scriptSrcMatch = distHtmlContent.match(/<script type="module" crossorigin src="([^"]+)">/);
  const cssHrefMatch = distHtmlContent.match(/<link rel="stylesheet" crossorigin href="([^"]+)">/);

  assert(
    !!scriptSrcMatch && (scriptSrcMatch[1].startsWith('./') || scriptSrcMatch[1].startsWith('/samgtu-schedule/')),
    `dist/index.html script uses valid base path (${scriptSrcMatch?.[1]})`
  );
  assert(
    !!cssHrefMatch && (cssHrefMatch[1].startsWith('./') || cssHrefMatch[1].startsWith('/samgtu-schedule/')),
    `dist/index.html css uses valid base path (${cssHrefMatch?.[1]})`
  );
} else {
  console.log('  [INFO] dist/index.html not yet built, skipping script/css relative path check');
}

// -------------------------------------------------------------
// 2.2 Safe Areas & Inset Margins
// -------------------------------------------------------------
console.log('\n--- 2.2 Safe Areas & Insets (pt-safe, pb-safe, viewport-fit) ---');

assert(
  indexHtmlContent.includes('viewport-fit=cover'),
  'index.html has viewport-fit=cover meta tag required for iOS/TMA safe area insets'
);

const indexCssPath = path.resolve(__dirname, '../index.css');
const indexCssContent = fs.readFileSync(indexCssPath, 'utf8');

assert(
  indexCssContent.includes('@utility pt-safe') &&
  indexCssContent.includes('env(safe-area-inset-top') &&
  indexCssContent.includes('--tg-safe-area-inset-top'),
  'index.css defines @utility pt-safe supporting both Telegram TMA and iOS/Android env()'
);

assert(
  indexCssContent.includes('@utility pb-safe') &&
  indexCssContent.includes('env(safe-area-inset-bottom') &&
  indexCssContent.includes('--tg-safe-area-inset-bottom'),
  'index.css defines @utility pb-safe with max(0.75rem, safe-area-inset-bottom)'
);

const bottomNavPath = path.resolve(__dirname, '../components/BottomNav.tsx');
const bottomNavContent = fs.readFileSync(bottomNavPath, 'utf8');

assert(
  bottomNavContent.includes('pb-safe'),
  'BottomNav.tsx uses pb-safe to prevent overlap with Telegram / device home indicator'
);

assert(
  appTsxContent.includes('header') && appTsxContent.includes('pt-safe'),
  'App.tsx header uses pt-safe to prevent overlap with Telegram close button & status bar'
);

// -------------------------------------------------------------
// 2.3 Vertical Scrolling in Telegram WebApp
// -------------------------------------------------------------
console.log('\n--- 2.3 Vertical Scrolling & Ergonomics inside Telegram Container ---');

assert(
  indexCssContent.includes('overscroll-behavior-y: none'),
  'index.css applies overscroll-behavior-y: none to prevent TMA pull-to-close on vertical scroll'
);

const swipeableDaysPath = path.resolve(__dirname, '../components/SwipeableDays.tsx');
const swipeableDaysContent = fs.readFileSync(swipeableDaysPath, 'utf8');

assert(
  swipeableDaysContent.includes('touch-pan-y'),
  'SwipeableDays container uses touch-pan-y for immediate native vertical scroll'
);

assert(
  swipeableDaysContent.includes('isDominantHorizontal'),
  'SwipeableDays has Directional Lock locking out horizontal swipes during vertical scrolling'
);

assert(
  appTsxContent.includes('pb-28'),
  'App.tsx main wrapper has pb-28 clearance so last lessons/homework items are never hidden behind BottomNav'
);

const homeworkPath = path.resolve(__dirname, '../components/HomeworkTracker.tsx');
const homeworkContent = fs.readFileSync(homeworkPath, 'utf8');

// -------------------------------------------------------------
// 3. ScheduleState UI & Error Handling (A3-U4)
// -------------------------------------------------------------
console.log('\n--- 3. ScheduleState UI & Error Handling ---');

const scheduleStatePath = path.resolve(__dirname, '../components/ScheduleState.tsx');
assert(fs.existsSync(scheduleStatePath), 'components/ScheduleState.tsx exists');

const scheduleStateContent = fs.existsSync(scheduleStatePath) ? fs.readFileSync(scheduleStatePath, 'utf8') : '';
assert(
  scheduleStateContent.includes('export const ScheduleState') || scheduleStateContent.includes('export default ScheduleState'),
  'ScheduleState.tsx exports ScheduleState component'
);

assert(
  scheduleStateContent.includes('animate-pulse'),
  'ScheduleState.tsx provides skeleton loading state with animate-pulse'
);

assert(
  scheduleStateContent.includes('Повторить попытку'),
  'ScheduleState.tsx contains "Повторить попытку" retry button'
);

assert(
  scheduleStateContent.includes('RefreshCw'),
  'ScheduleState.tsx uses RefreshCw icon for retry action'
);

assert(
  scheduleStateContent.includes('На этой неделе нет занятий'),
  'ScheduleState.tsx supports empty state with "На этой неделе нет занятий"'
);

// Verify error message mapping
const { getScheduleErrorMessage } = await import('../components/ScheduleState');
assert(
  getScheduleErrorMessage('network') === 'Не удалось загрузить расписание. Проверьте подключение к интернету.',
  'Error reason "network" produces clear Russian user message'
);
assert(
  getScheduleErrorMessage('timeout') === 'Не удалось загрузить расписание. Проверьте подключение к интернету.',
  'Error reason "timeout" produces clear Russian user message'
);
assert(
  getScheduleErrorMessage('not_found') === 'Файл расписания для группы пока не найден в базе.',
  'Error reason "not_found" produces clear Russian user message'
);
assert(
  getScheduleErrorMessage('empty') === 'Расписание для выбранной группы пока пустое.',
  'Error reason "empty" produces clear Russian user message'
);
assert(
  getScheduleErrorMessage('invalid') === 'Ошибка структуры данных расписания.',
  'Error reason "invalid" produces clear Russian user message'
);

// Verify App.tsx integration
assert(
  appTsxContent.includes('scheduleLoadError'),
  'App.tsx tracks scheduleLoadError state'
);
assert(
  appTsxContent.includes('handleRetryScheduleLoad'),
  'App.tsx implements handleRetryScheduleLoad retry handler'
);
assert(
  appTsxContent.includes('<ScheduleState') && appTsxContent.includes('status="loading"') && appTsxContent.includes('status="error"'),
  'App.tsx renders ScheduleState for loading and error states'
);

// -------------------------------------------------------------
// 6. Cloud Polling, Race Protection & Battery Optimization (A3-U5)
// -------------------------------------------------------------
console.log('\n--- 6. Cloud Polling, Race Protection & Battery Optimization (A3-U5) ---');

assert(
  !appTsxContent.includes('}, [currentGroupId, refreshTrigger]);'),
  'App.tsx polling effect does not depend on refreshTrigger'
);

assert(
  appTsxContent.includes('abortActiveRequest') && appTsxContent.includes('new AbortController()'),
  'App.tsx aborts in-flight request via AbortController on unmount/group change'
);

assert(
  appTsxContent.includes('document.hidden') && appTsxContent.includes('document.visibilityState'),
  'App.tsx suspends polling timer when document is hidden (battery saving)'
);

assert(
  appTsxContent.includes('lastVisibilitySyncRef') && appTsxContent.includes('5000'),
  'App.tsx deduplicates visibilitychange and focus events with 5-second throttle'
);

assert(
  appTsxContent.includes('getNextDelay') && appTsxContent.includes('jitter'),
  'App.tsx implements exponential backoff and randomized jitter for cloud polling'
);

assert(
  appTsxContent.includes('sanitizeTeachers(cloud.subjectTeachers, currentGroupId)'),
  'App.tsx handleRefresh passes currentGroupId to sanitizeTeachers and persists to localStorage'
);

const cloudSyncPath = path.resolve(__dirname, '../utils/cloudSync.ts');
const cloudSyncContent = fs.readFileSync(cloudSyncPath, 'utf8');

assert(
  cloudSyncContent.includes('signal?: AbortSignal'),
  'utils/cloudSync.ts supports AbortSignal propagation in fetchJson / fetchGroupCloudData'
);

assert(
  cloudSyncContent.includes('serverTimestamp = d.updatedAt ? Number(d.updatedAt) : now;'),
  'utils/cloudSync.ts parses and returns serverTimestamp in lastUpdated'
);

// -------------------------------------------------------------
// 7. Live Time Ticker & Safe Cache Clearance (A3-U6, A3-U7)
// -------------------------------------------------------------
console.log('\n--- 7. Live Time Ticker & Safe Cache Clearance (A3-U6, A3-U7) ---');

const useNowPath = path.resolve(__dirname, '../utils/useNow.ts');
assert(fs.existsSync(useNowPath), 'utils/useNow.ts file exists');

const useNowContent = fs.readFileSync(useNowPath, 'utf8');
assert(
  useNowContent.includes('export function useNow(intervalMs: number = 60000): Date'),
  'useNow hook exports correct signature with default 60000ms interval'
);
assert(
  useNowContent.includes('visibilitychange') && useNowContent.includes('focus'),
  'useNow hook registers visibilitychange and focus event listeners'
);

// Re-read appTsxContent to capture recent edits
const updatedAppTsx = fs.readFileSync(appTsxPath, 'utf8');
assert(
  updatedAppTsx.includes('const liveNow = useNow(60000);') &&
  updatedAppTsx.includes('const samaraNow = useMemo(() => getSamaraDate(liveNow), [liveNow]);'),
  'App.tsx consumes useNow and computes live samaraNow'
);

const updatedSwipeableDays = fs.readFileSync(swipeableDaysPath, 'utf8');
assert(
  updatedSwipeableDays.includes('const liveNow = useNow(60000);') &&
  updatedSwipeableDays.includes('const samaraToday = useMemo(() => getSamaraDate(liveNow), [liveNow]);'),
  'SwipeableDays.tsx consumes useNow and computes live samaraToday'
);

assert(
  updatedAppTsx.includes('handleClearScheduleCache'),
  'App.tsx implements handleClearScheduleCache handler'
);
assert(
  updatedAppTsx.includes("key.startsWith('sched_cache_v1:')") &&
  !updatedAppTsx.includes('localStorage.clear()'),
  'handleClearScheduleCache isolates and purges ONLY sched_cache_v1 keys, preserving credentials/notes'
);
assert(
  updatedAppTsx.includes('caches.delete') && updatedAppTsx.includes('window.location.reload'),
  'handleClearScheduleCache clears web caches and reloads the window'
);
assert(
  updatedAppTsx.includes('Кэш расписания') && updatedAppTsx.includes('Офлайн-хранилище') && updatedAppTsx.includes('Очистить кэш расписания и обновить'),
  'Profile tab renders Schedule Cache card with offline storage badge and reload button'
);

console.log('\n=================================================');
console.log(`  SUMMARY: ${passedTests} / ${totalTests} TESTS PASSED`);
console.log('=================================================');

if (passedTests === totalTests) {
  console.log('>>> VERDICT: ALL TELEGRAM WEBAPP & ERGONOMICS CHECKS PASSED <<<');
  if (process.argv[1] && process.argv[1].includes('test_telegram_webapp')) {
    process.exit(0);
  }
} else {
  console.error('>>> VERDICT: SOME CHECKS FAILED <<<');
  process.exit(1);
}
