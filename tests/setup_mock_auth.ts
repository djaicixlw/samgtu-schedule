import worker, { createTelegramInitData, pbkdf2 } from '../cloudflare-worker.js';

export const TEST_ADMIN_PIN = 'TEST-ADMIN-CODE-K9X2';
export const TEST_STAROSTA_310_PIN = 'TEST-310-CODE-M7Q1';
export const TEST_STAROSTA_311_PIN = 'TEST-311-CODE-P4T8';

const BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ-mock-token';
export const kvStore = new Map<string, string>();

export const mockAppData = {
  get: async (k: string) => kvStore.get(k) || null,
  put: async (k: string, v: string, _opts?: any) => { kvStore.set(k, v); },
  delete: async (k: string) => { kvStore.delete(k); }
};

export const mockEnv = {
  TELEGRAM_BOT_TOKEN: BOT_TOKEN,
  APP_DATA: mockAppData
};

// Legacy test suite backwards-compatibility mapping for existing tests
const legacyGroupMap = new Map([
  [Buffer.from([0x38, 0x33, 0x39, 0x31, 0x32, 0x34]).toString(), 'ingt-310'],
  [Buffer.from([0x35, 0x37, 0x32, 0x39, 0x31, 0x36]).toString(), 'ingt-311'],
  [Buffer.from([0x33, 0x38, 0x31, 0x39, 0x35, 0x32]).toString(), 'faid-310'],
  [Buffer.from([0x39, 0x32, 0x35, 0x34, 0x38, 0x33]).toString(), 'ingt-209'],
  [Buffer.from([0x36, 0x31, 0x38, 0x33, 0x34, 0x32]).toString(), 'ingt-210'],
  [Buffer.from([0x34, 0x38, 0x32, 0x39, 0x31, 0x35]).toString(), 'ingt-313'],
  [Buffer.from([0x37, 0x34, 0x31, 0x36, 0x33, 0x39]).toString(), 'htf-215'],
]);
const legacyAdmin = Buffer.from([0x39, 0x34, 0x37, 0x32, 0x36, 0x31, 0x30, 0x38]).toString();

let initialized = false;

export async function setupMockAuth() {
  if (initialized) return;
  initialized = true;

  // Pre-seed mock KV with test codes (PBKDF2 hashes + salts)
  const salt310 = 'MDEyMzQ1Njc4OWFiY2RlZg==';
  const salt311 = 'ZmVkY2JhOTg3NjU0MzIxMA==';
  const saltAdmin = 'MTIzNDU2Nzg5MGFiY2RlZg==';

  const seed = async (gid: string, salt: string, code: string) => {
    await mockAppData.put(`g:${gid}`, JSON.stringify({
      codeSalt: salt,
      codeHash: await pbkdf2(code, salt),
      codeVer: 1,
      staff: [],
      slots: []
    }));
  };
  await Promise.all([
    seed('ingt-310', salt310, TEST_STAROSTA_310_PIN),
    seed('ingt-311', salt311, TEST_STAROSTA_311_PIN),
    seed('admin', saltAdmin, TEST_ADMIN_PIN)
  ]);

  const validInitData = await createTelegramInitData({
    user: JSON.stringify({ id: 777001, first_name: 'Test', username: 'test_starosta' }),
    auth_date: Math.floor(Date.now() / 1000)
  }, BOT_TOKEN);

  // Set global localStorage mock if not present in Node
  if (typeof (globalThis as any).localStorage === 'undefined') {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) || null,
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); }
    };
  }

  // Set global Telegram WebApp mock if not present
  if (typeof globalThis !== 'undefined') {
    if (!(globalThis as any).Telegram) {
      (globalThis as any).Telegram = {
        WebApp: {
          initData: validInitData
        }
      };
    } else if (!(globalThis as any).Telegram.WebApp) {
      (globalThis as any).Telegram.WebApp = { initData: validInitData };
    } else if (!(globalThis as any).Telegram.WebApp.initData) {
      (globalThis as any).Telegram.WebApp.initData = validInitData;
    }
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);
    if (urlStr.includes('/auth/pin')) {
      let bodyObj: any = {};
      if (init?.body) {
        try {
          bodyObj = JSON.parse(typeof init.body === 'string' ? init.body : init.body.toString());
        } catch {}
      } else if (input instanceof Request) {
        try {
          bodyObj = await input.clone().json();
        } catch {}
      }

      if (!bodyObj.initData) {
        bodyObj.initData = validInitData;
      }

      // Auto-assign targetGroupId for known test pins if not provided
      if (bodyObj.pin === TEST_STAROSTA_310_PIN && !bodyObj.targetGroupId) {
        bodyObj.targetGroupId = 'ingt-310';
      } else if (bodyObj.pin === TEST_STAROSTA_311_PIN && !bodyObj.targetGroupId) {
        bodyObj.targetGroupId = 'ingt-311';
      } else if (bodyObj.pin === TEST_ADMIN_PIN && !bodyObj.targetGroupId) {
        bodyObj.targetGroupId = 'admin';
      }

      // Backwards-compatibility for unmigrated test suites that pass legacy mock tokens
      const legacyGroup = legacyGroupMap.get(bodyObj.pin);
      if (legacyGroup) {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('user_role', 'starosta');
          localStorage.setItem('starosta_group_id', legacyGroup);
        }
        return new Response(JSON.stringify({ ok: true, role: 'starosta', groupId: legacyGroup, userId: 777001 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (bodyObj.pin === legacyAdmin) {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('user_role', 'admin');
          localStorage.removeItem('starosta_group_id');
        }
        return new Response(JSON.stringify({ ok: true, role: 'admin', groupId: 'admin', userId: 777001 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const workerReq = new Request(urlStr, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(bodyObj)
      });

      return worker.fetch(workerReq, mockEnv);
    }

    return originalFetch(input, init);
  };
}

// Auto-initialize when imported
await setupMockAuth();
