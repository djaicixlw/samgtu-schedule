/**
 * Canonical Group Aliases and Identifier Normalization (P0-18, AUD-027).
 *
 * AUD-027: this module no longer owns its own normalizer — `normalizeGroupId`
 * DELEGATES to `makeGroupId` (utils/groupId.ts), the single canonicalizer of the
 * app. The alias table stays here as the historical home (imported by
 * groupId.ts); keep entries EXACT-match only. Substring matching (.includes) is
 * strictly prohibited to prevent cross-group privilege escalation and false
 * group collations (e.g. faid-210 -> faid-310).
 */

export const CANONICAL_GROUP_ALIASES: Record<string, string> = {
  // FAID (Факультет архитектуры и дизайна)
  '3-фаид-110': 'faid-310',
  '3-faid-110': 'faid-310',
  '3 фаид 110': 'faid-310',
  'фаид-110': 'faid-310',
  'faid-110': 'faid-310',
  '24фад-110': 'faid-310',
  '24фаид-110': 'faid-310',
  'фаид-310': 'faid-310',
  '3-фаид-310': 'faid-310',

  // INGT (Институт нефтегазовых технологий)
  'ingt-1': 'ingt-301',
  '3-ингт-101': 'ingt-301',
  '3-ingt-101': 'ingt-301',
  '3-ингт-110': 'ingt-310',
  '3-ingt-110': 'ingt-310',
  '3-ингт-111': 'ingt-311',
  '3-ingt-111': 'ingt-311',
  '3-ингт-113': 'ingt-313',
  '3-ingt-113': 'ingt-313',
  // AUD-028: the colliding alias 'ingt-109' -> 'ingt-209' is REMOVED.
  // 1-ИНГТ-109 is a real group (chunk public/schedules/ingt-109.json exists),
  // so 'ingt-109' must resolve to ITSELF; the 2nd-course group keeps only its
  // own legacy names ('2-ингт-109' / '2-ingt-109').
  '2-ингт-109': 'ingt-209',
  '2-ingt-109': 'ingt-209',

  // IAIT (Институт автоматики и информационных технологий)
  '3-иаит-108': 'iait-308',
  '3-iait-108': 'iait-308',

  // HTF (Химико-технологический факультет)
  '2 хтф 115': 'htf-215',
  '2-хтф-115': 'htf-215',
  '2-htf-115': 'htf-215',
  'хтф-115': 'htf-215',
  'htf-115': 'htf-215'
};

/**
 * Normalizes a group identifier via the single canonicalizer (AUD-027):
 * trim/lowercase + exact aliases + structural course/number scheme +
 * transliteration fallback — one pipeline for the whole app.
 */
import { makeGroupId } from './groupId';

export function normalizeGroupId(gid: string): string {
  if (!gid || typeof gid !== 'string') return '';
  return makeGroupId(gid);
}
