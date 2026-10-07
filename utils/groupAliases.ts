/**
 * Canonical Group Aliases and Identifier Normalization (P0-18)
 *
 * Provides a single source of truth for group aliases.
 * Strictly exact matches only. Substring matching (.includes) is strictly prohibited
 * to prevent cross-group privilege escalation and false group collations (e.g. faid-210 -> faid-310).
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
  '2-ингт-109': 'ingt-209',
  '2-ingt-109': 'ingt-209',
  'ingt-109': 'ingt-209',

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
 * Normalizes a group identifier:
 * 1. Trims leading and trailing whitespace.
 * 2. Converts to lowercase.
 * 3. Resolves strictly exact matches against CANONICAL_GROUP_ALIASES.
 *
 * Does NOT perform substring matching (.includes) to avoid group collation bugs.
 */
export function normalizeGroupId(gid: string): string {
  if (!gid || typeof gid !== 'string') return '';
  const clean = gid.trim().toLowerCase();
  return CANONICAL_GROUP_ALIASES[clean] || clean;
}
