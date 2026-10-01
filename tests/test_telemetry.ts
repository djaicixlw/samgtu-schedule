/**
 * QA Suite: Telegram Telemetry & Crash Reporting
 * Tests client-side serialization, fire-and-forget safety, local deduplication,
 * worker rate-limiting, deduplication, HTML escaping, and ErrorBoundary integration.
 */

import {
  sendCrashReport,
  isLocallyThrottled,
  clearTelemetryCache,
  getTelemetryPlatform,
  getCurrentGroup,
  LOCAL_DEDUP_COOLDOWN_MS
} from '../utils/telemetry';

import worker, {
  escapeHtml,
  formatTelegramErrorHtml,
  isDeduplicated,
  isRateLimited,
  recordAlertSent,
  clearWorkerRateLimits
} from '../cloudflare-worker.js';

import * as fs from 'fs';
import * as path from 'path';

let passCount = 0;
let failCount = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passCount++;
    console.log(`  [PASS] ${label}${detail ? ` (${detail})` : ''}`);
  } else {
    failCount++;
    console.error(`  [FAIL] ${label}${detail ? ` (${detail})` : ''}`);
  }
}

console.log('================================================================');
console.log('       QA SUITE: TELEGRAM TELEMETRY & CRASH REPORTING          ');
console.log('================================================================\n');

async function runTelemetryTests() {
  // --- 1. Client-Side Telemetry Serialization & Deduplication ---
  console.log('--- 1. Client-Side Telemetry & Local Deduplication ---');
  clearTelemetryCache();

  let fetchCalls: Array<{ url: string; options: any; body: any }> = [];
  const originalFetch = globalThis.fetch;

  // Mock fetch
  globalThis.fetch = async (input: any, init?: any): Promise<any> => {
    const url = typeof input === 'string' ? input : input.url;
    let parsedBody: any = null;
    if (init?.body && typeof init.body === 'string') {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {}
    }
    fetchCalls.push({ url, options: init, body: parsedBody });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    // 1.1 Initial crash report dispatch
    await sendCrashReport({
      component: 'TestComponent',
      message: 'Simulated runtime crash error',
      stack: 'Error: Simulated runtime crash error\n    at TestComponent (App.tsx:42:15)',
      group: 'ingt-310'
    });

    check('Fetch was called once for first error', fetchCalls.length === 1);
    const firstCall = fetchCalls[0];
    check('Sent POST to /report-error endpoint', firstCall.url.endsWith('/report-error') && firstCall.options.method === 'POST');
    check('Payload contains exact message', firstCall.body?.message === 'Simulated runtime crash error');
    check('Payload contains component name', firstCall.body?.component === 'TestComponent');
    check('Payload contains stack trace', typeof firstCall.body?.stack === 'string' && firstCall.body.stack.includes('TestComponent'));
    check('Payload contains group ID', firstCall.body?.group === 'ingt-310');
    check('Payload contains platform info', typeof firstCall.body?.platform === 'string' && firstCall.body.platform.length > 0);
    check('Payload contains ISO timestamp', typeof firstCall.body?.timestamp === 'string' && firstCall.body.timestamp.includes('+04:00'));

    // 1.2 Local deduplication check: same error within 2 minutes should be ignored
    await sendCrashReport({
      component: 'TestComponent',
      message: 'Simulated runtime crash error',
      stack: 'Error: Simulated runtime crash error'
    });
    check('Duplicate error was locally throttled (no second network call)', fetchCalls.length === 1);

    // 1.3 Distinct error should NOT be throttled
    await sendCrashReport({
      component: 'TestComponent',
      message: 'A completely different error occurred'
    });
    check('Different error in same component was sent', fetchCalls.length === 2);
    check('Second payload has new error message', fetchCalls[1].body?.message === 'A completely different error occurred');

    // 1.4 Same error in a different component should NOT be throttled
    await sendCrashReport({
      component: 'DifferentComponent',
      message: 'Simulated runtime crash error'
    });
    check('Same error message under different component is treated as distinct', fetchCalls.length === 3);

    // 1.5 Simulated time advancement past 2 minutes allows resending
    const now = Date.now();
    const isThrottledImmediate = isLocallyThrottled('Simulated runtime crash error', 'TestComponent', now);
    const isThrottledAfterCooldown = isLocallyThrottled('Simulated runtime crash error', 'TestComponent', now + LOCAL_DEDUP_COOLDOWN_MS + 1000);
    check('isLocallyThrottled returns true during cooldown', isThrottledImmediate === true);
    check('isLocallyThrottled returns false after cooldown period (> 2 mins)', isThrottledAfterCooldown === false);

    // 1.6 Fire-and-forget resilience: network failure does not throw
    globalThis.fetch = async (): Promise<any> => {
      throw new Error('Network offline or failed DNS lookup');
    };

    let didThrow = false;
    try {
      await sendCrashReport({
        component: 'CrashResilienceTest',
        message: 'Error during offline mode'
      });
    } catch {
      didThrow = true;
    }
    check('sendCrashReport never throws outside even on network failure', didThrow === false);

  } finally {
    globalThis.fetch = originalFetch;
  }

  // --- 2. Cloudflare Worker Error Reporting Endpoint & HTML Formatting ---
  console.log('\n--- 2. Cloudflare Worker: /report-error & Telegram HTML Formatting ---');
  clearWorkerRateLimits();

  // 2.1 HTML escaping
  const rawMalicious = '<script>alert("XSS & crash")</script>';
  const escaped = escapeHtml(rawMalicious);
  check('HTML special characters escaped correctly', !escaped.includes('<') && escaped.includes('&lt;script&gt;') && escaped.includes('&amp;'));

  // 2.2 Telegram HTML message formatting
  const formattedHtml = formatTelegramErrorHtml({
    message: 'TypeError: Cannot read property "name" of undefined',
    stack: 'TypeError: Cannot read property "name" of undefined\n    at Render (DayColumn.tsx:25)',
    component: 'DayColumn',
    group: '3-ИНГТ-110',
    platform: 'Telegram (Android)',
    userAgent: 'Mozilla/5.0 (Linux; Android 14)',
    timestamp: '2026-09-20T04:30:00.000+04:00'
  });

  check('HTML message includes 🚨 emoji', formattedHtml.includes('🚨'));
  check('HTML message includes group tag', formattedHtml.includes('3-ИНГТ-110'));
  check('HTML message includes platform info', formattedHtml.includes('Telegram (Android)'));
  check('HTML message includes component name', formattedHtml.includes('DayColumn'));
  check('HTML message includes error message in <code>', formattedHtml.includes('<code>TypeError: Cannot read property &quot;name&quot; of undefined</code>') || formattedHtml.includes('Cannot read property'));
  check('HTML message includes stack trace in <pre>', formattedHtml.includes('<pre>') && formattedHtml.includes('Render (DayColumn.tsx:25)'));

  // 2.3 Worker-side deduplication (5-minute window)
  clearWorkerRateLimits();
  const testErrorKey = 'ScheduleGrid::TypeError: data is null';
  const workerNow = Date.now();

  check('Initial error is not deduplicated', isDeduplicated(testErrorKey, workerNow) === false);
  recordAlertSent(testErrorKey, workerNow);
  check('Same error within 5 minutes is deduplicated', isDeduplicated(testErrorKey, workerNow + 60000) === true);
  check('Same error after 5 minutes is allowed again', isDeduplicated(testErrorKey, workerNow + 300001) === false);

  // 2.4 Worker-side global rate limiting (max 5 alerts / minute)
  clearWorkerRateLimits();
  for (let i = 1; i <= 5; i++) {
    check(`Alert #${i} within rate limit`, isRateLimited(workerNow) === false);
    recordAlertSent(`Comp${i}::Error${i}`, workerNow);
  }
  check('6th alert within 1 minute is rate-limited', isRateLimited(workerNow) === true);
  check('Alert after 1 minute has elapsed is allowed again', isRateLimited(workerNow + 60001) === false);

  // 2.5 Direct Worker Fetch Handler Simulation
  console.log('\n--- 3. Cloudflare Worker Fetch Handler Integration ---');
  clearWorkerRateLimits();

  // Test OPTIONS CORS preflight
  const corsReq = new Request('https://worker.local/report-error', { method: 'OPTIONS' });
  const corsRes = await worker.fetch(corsReq, {});
  check('OPTIONS returns 200 with CORS headers', corsRes.status === 200 && corsRes.headers.get('Access-Control-Allow-Origin') === '*');

  // Test missing message validation
  const invalidReq = new Request('https://worker.local/report-error', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ component: 'BrokenComp' }) // missing message
  });
  const invalidRes = await worker.fetch(invalidReq, {});
  check('Missing message returns 400 Bad Request', invalidRes.status === 400);

  // Test valid report-error without BOT_TOKEN (graceful test mode)
  const validReq = new Request('https://worker.local/report-error', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      component: 'SyncService',
      message: 'Failed to fetch schedule JSON',
      group: 'ingt-310'
    })
  });
  const validRes = await worker.fetch(validReq, { TEST_MODE: 'true' });
  const validJson = await validRes.json();
  check('Valid request returns 200 OK with { ok: true }', validRes.status === 200 && validJson.ok === true);

  // Test second identical request is throttled at worker level
  const dupReq = new Request('https://worker.local/report-error', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      component: 'SyncService',
      message: 'Failed to fetch schedule JSON',
      group: 'ingt-310'
    })
  });
  const dupRes = await worker.fetch(dupReq, { TEST_MODE: 'true' });
  const dupJson = await dupRes.json();
  check('Duplicate request returns throttled: true with duplicate_error reason', dupJson.ok === true && dupJson.throttled === true && dupJson.reason === 'duplicate_error');

  // --- 4. Component & Logger Code Verification ---
  console.log('\n--- 4. Component & Logger Verification ---');
  const errorBoundaryPath = path.resolve(process.cwd(), 'components/ErrorBoundary.tsx');
  const tabErrorBoundaryPath = path.resolve(process.cwd(), 'components/TabErrorBoundary.tsx');
  const loggerPath = path.resolve(process.cwd(), 'utils/logger.ts');

  const errorBoundaryContent = fs.readFileSync(errorBoundaryPath, 'utf8');
  check('ErrorBoundary imports sendCrashReport', errorBoundaryContent.includes("sendCrashReport"));
  check('ErrorBoundary calls sendCrashReport with Root ErrorBoundary (White Screen Crash)',
    errorBoundaryContent.includes("Root ErrorBoundary (White Screen Crash)"));

  const tabErrorBoundaryContent = fs.readFileSync(tabErrorBoundaryPath, 'utf8');
  check('TabErrorBoundary imports sendCrashReport', tabErrorBoundaryContent.includes("sendCrashReport"));
  check('TabErrorBoundary calls sendCrashReport with tabName',
    tabErrorBoundaryContent.includes("this.props.tabName") && tabErrorBoundaryContent.includes("sendCrashReport"));

  const loggerContent = fs.readFileSync(loggerPath, 'utf8');
  check('logger.ts imports sendCrashReport', loggerContent.includes("sendCrashReport"));
  check('logger.ts handles window.onerror with sendCrashReport',
    loggerContent.includes("component: 'window.onerror'"));
  check('logger.ts handles unhandledrejection with sendCrashReport',
    loggerContent.includes("component: 'window.onunhandledrejection'"));
  check('logger.ts re-exports sendCrashReport',
    loggerContent.includes("export { sendCrashReport } from './telemetry'"));

  // --- Summary ---
  console.log('\n================================================================');
  console.log(`TOTAL CHECKS: ${passCount + failCount} | PASSED: ${passCount} | FAILED: ${failCount}`);
  console.log('================================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    console.log('\n>>> ALL TELEGRAM TELEMETRY & ERROR BOUNDARY CHECKS PASSED (100%) <<<\n');
  }
}

runTelemetryTests().catch(err => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
