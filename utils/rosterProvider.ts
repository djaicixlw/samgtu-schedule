import { Student } from '../types';
import { STUDENTS_REGISTRY } from '../attendance';
import { fetchGroupCloudData, pushGroupCloudData } from './cloudSync';
import { getLocalStudents } from './attendanceStorage';

/**
 * Synchronous group roster getter: reads from local storage via getLocalStudents(groupId),
 * falling back to STUDENTS_REGISTRY only if local storage is empty.
 */
export function getGroupStudents(groupId: string): Student[] {
  if (!groupId) return [];
  const local = getLocalStudents(groupId);
  if (local && local.length > 0) {
    return local;
  }
  return STUDENTS_REGISTRY[groupId] ? [...STUDENTS_REGISTRY[groupId]] : [];
}

/**
 * 152-FZ Compliant Roster Abstraction Interface.
 * Encapsulates group roster management and student personal data access behind a unified provider.
 * Allows transparent plugging of university directories (LDAP, Active Directory, internal APIs)
 * or mock anonymized providers for security audits and automated QA.
 */
export interface RosterProvider {
  /**
   * Retrieves the student roster for a given group.
   * Resolves cascading data sources (local cache, cloud gateway, static registry).
   */
  getRoster(groupId: string): Promise<Student[]>;

  /**
   * Persists an updated student roster for a given group.
   */
  saveRoster(groupId: string, students: Student[]): Promise<boolean>;
}

/**
 * Default implementation of RosterProvider combining localStorage caching
 * and multi-device cloud synchronization.
 */
export class LocalCloudRosterProvider implements RosterProvider {
  /**
   * Synchronous helper to read local roster with fallback
   */
  getGroupStudents(groupId: string): Student[] {
    return getGroupStudents(groupId);
  }

  /**
   * Cleans up legacy/stale student anomalies (e.g. historical duplicates or removed students).
   */
  private healRoster(groupId: string, students: Student[]): Student[] {
    if (!Array.isArray(students)) return STUDENTS_REGISTRY[groupId] ? [...STUDENTS_REGISTRY[groupId]] : [];
    // Generic cleanup: deduplicate by student id and valid name
    const seenIds = new Set<number>();
    const cleaned = students.filter(s => {
      if (!s || typeof s.id !== 'number' || !s.name) return false;
      if (seenIds.has(s.id)) return false;
      seenIds.add(s.id);
      return true;
    });
    return cleaned;
  }

  /**
   * Cascading roster fetch:
   * 1. Checks localStorage. If valid non-empty array exists, returns it.
   * 2. If empty, invokes fetchGroupCloudData(false, groupId). Caches result if non-empty.
   * 3. Falls back to STUDENTS_REGISTRY[groupId] or empty array.
   */
  async getRoster(groupId: string): Promise<Student[]> {
    if (!groupId) return [];

    // Step 1: Inspect local cache
    try {
      const local = getLocalStudents(groupId);
      if (local && local.length > 0) {
        return this.healRoster(groupId, local);
      }
    } catch (e) {
      console.warn(`[LocalCloudRosterProvider] Error reading local storage for ${groupId}:`, e);
    }

    // Step 2: Fetch from cloud gateway
    try {
      const cloudData = await fetchGroupCloudData(false, groupId);
      if (cloudData && Array.isArray(cloudData.students) && cloudData.students.length > 0) {
        const healed = this.healRoster(groupId, cloudData.students);
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(`students_${groupId}`, JSON.stringify(healed));
          }
        } catch (e) {
          console.warn(`[LocalCloudRosterProvider] Error writing cloud cache for ${groupId}:`, e);
        }
        return healed;
      }
    } catch (e) {
      console.warn(`[LocalCloudRosterProvider] Cloud sync error for ${groupId}:`, e);
    }

    // Step 3: Static registry fallback
    const staticList = STUDENTS_REGISTRY[groupId] || [];
    return [...staticList];
  }

  /**
   * Persists roster:
   * 1. Writes to localStorage (`students_${groupId}`).
   * 2. Dispatches update to cloud backend via pushGroupCloudData({ students }, groupId).
   */
  async saveRoster(groupId: string, students: Student[]): Promise<boolean> {
    if (!groupId) return false;

    // 1) Local save
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(`students_${groupId}`, JSON.stringify(students));
      }
    } catch (e) {
      console.warn(`[LocalCloudRosterProvider] Error saving local roster for ${groupId}:`, e);
    }

    // 2) Cloud push
    try {
      await pushGroupCloudData({ students }, groupId);
    } catch (e) {
      console.warn(`[LocalCloudRosterProvider] Error pushing roster to cloud for ${groupId}:`, e);
    }

    return true;
  }
}

/**
 * Singleton instance of default RosterProvider.
 */
export const defaultRosterProvider: RosterProvider = new LocalCloudRosterProvider();
