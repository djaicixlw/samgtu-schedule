import { UserRole } from '../types';
import { WORKER_BASE } from './cloudSync';

declare global {
  interface Window {
    Telegram?: any;
  }
}

/**
 * Computes SHA-256 hash using native Web Crypto API (browser, TMA, and Node.js 18+).
 */
export async function computeSHA256(text: string): Promise<string> {
  const clean = text.trim();
  const cryptoObj = (typeof window !== 'undefined' ? window.crypto : null) || (globalThis as any).crypto;

  if (cryptoObj && cryptoObj.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(clean);
    const hashBuffer = await cryptoObj.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b: number) => b.toString(16).padStart(2, '0')).join('');
  }

  return '';
}

export interface AuthResult {
  role: UserRole;
  targetGroupId?: string;
  groupId?: string;
  groupName?: string;
  userId?: number;
}

/**
 * Validates entered PIN by delegating to server endpoint POST /auth/pin.
 * All PIN hashes and authorization verification reside strictly on the server (Cloudflare Worker).
 */
export async function verifyPinCode(inputPin: string, targetGroupId?: string): Promise<AuthResult | null> {
  const pin = inputPin?.trim();
  if (!pin) return null;

  const initData = (typeof window !== 'undefined' && window.Telegram?.WebApp?.initData)
    || (typeof globalThis !== 'undefined' && (globalThis as any).Telegram?.WebApp?.initData)
    || '';

  try {
    const res = await fetch(`${WORKER_BASE}/auth/pin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        pin,
        initData,
        targetGroupId
      })
    });

    if (res.status === 200) {
      const data = await res.json();
      if (data && data.ok) {
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('user_role', data.role);
            if (data.role === 'starosta' && data.groupId) {
              localStorage.setItem('starosta_group_id', data.groupId);
            } else if (data.role === 'admin') {
              localStorage.removeItem('starosta_group_id');
            }
          }
        } catch (e) {}

        return {
          role: data.role,
          groupId: data.groupId,
          targetGroupId: data.groupId,
          groupName: data.groupId,
          userId: data.userId
        };
      }
    }

    if (res.status === 401 || res.status === 403) {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('user_role');
          localStorage.removeItem('starosta_group_id');
        }
      } catch (e) {}
      return null;
    }

    // Any other error
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('user_role');
        localStorage.removeItem('starosta_group_id');
      }
    } catch (e) {}
    return null;
  } catch (err) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('user_role');
        localStorage.removeItem('starosta_group_id');
      }
    } catch (e) {}
    return null;
  }
}
