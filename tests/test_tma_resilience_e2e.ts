import assert from 'node:assert';
import { exportAttendanceToWord } from '../utils/exportWord';
import { AVAILABLE_GROUPS, FACULTIES } from '../constants';

console.log('================================================================');
console.log('   END-TO-END RESILIENCE & ZERO-SECRET FALLBACK TEST            ');
console.log('================================================================\n');

// Mock browser globals for Node test environment
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = globalThis;
}
if (typeof (globalThis as any).document === 'undefined') {
  (globalThis as any).document = {
    createElement: () => ({ style: {}, appendChild: () => {}, click: () => {} }),
    body: { appendChild: () => {}, removeChild: () => {} }
  };
}
if (typeof (globalThis as any).window.URL === 'undefined') {
  (globalThis as any).window.URL = {
    createObjectURL: () => 'blob:mock-url',
    revokeObjectURL: () => {}
  };
}

async function runResilienceTests() {
  console.log('>>> 1. Testing Word Export resilience when Worker /export-doc fails with HTTP 500...');
  const groupConfig = AVAILABLE_GROUPS.find(g => g.id === 'ingt-310')!;
  const faculty = FACULTIES[0];
  const sampleStudents = [{ id: 1, name: 'Иванов И.И.' }];
  const sampleRecords = [
    {
      docId: 'ingt-310_2026-09-02_l1',
      groupId: 'ingt-310',
      date: '2026-09-02',
      lessonId: 'l1',
      absentStudentIds: [1],
      isCancelled: false
    }
  ];

  // Intercept fetch to simulate Cloudflare Worker 500 error
  const realFetch = globalThis.fetch;
  (globalThis as any).fetch = async (url: string | URL | Request, init?: any) => {
    const urlStr = url.toString();
    if (urlStr.includes('/export-doc') || urlStr.includes('/upload')) {
      // Simulate Cloudflare Worker returning 500 TELEGRAM_BOT_TOKEN is not configured
      return new Response(JSON.stringify({ error: 'TELEGRAM_BOT_TOKEN is not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return realFetch(url, init);
  };

  try {
    const exportResult = await exportAttendanceToWord(sampleRecords, sampleStudents, groupConfig, faculty);
    assert.strictEqual(exportResult.success, true, 'exportAttendanceToWord must succeed even when worker returns 500');
    assert.strictEqual(exportResult.method, 'browser_blob', 'Fallback method must be browser_blob when worker is down');
    console.log(`  ✅ PASS: Word export successfully recovered via fallback (method: ${exportResult.method})`);
  } finally {
    globalThis.fetch = realFetch;
  }

  console.log('\n================================================================');
  console.log('   ALL END-TO-END RESILIENCE TESTS PASSED (100%) 🎉             ');
  console.log('================================================================\n');
}

runResilienceTests().catch(err => {
  console.error('Resilience tests failed:', err);
  process.exit(1);
});
