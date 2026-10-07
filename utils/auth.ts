import { UserRole } from '../types';
import { claimStaffRole } from './attendanceStorage';

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
 * Validates entered access code via modern v3 blind server (POST /v3/staff/claim).
 * Legacy PIN auth endpoint is eliminated for privacy compliance (P0-02).
 */
export async function verifyPinCode(inputPin: string, targetGroupId?: string): Promise<AuthResult | null> {
  const code = inputPin?.trim();
  if (!code) return null;

  try {
    const res = await claimStaffRole(targetGroupId || 'admin', code);
    if (res && res.ok) {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('user_role', res.role || 'starosta');
          if (res.role === 'starosta' && res.gid) {
            localStorage.setItem('starosta_group_id', res.gid);
          } else if (res.role === 'admin') {
            localStorage.removeItem('starosta_group_id');
          }
        }
      } catch (e) {}

      return {
        role: res.role || 'starosta',
        groupId: res.gid || targetGroupId,
        targetGroupId: res.gid || targetGroupId,
        groupName: res.gid || targetGroupId
      };
    }

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
