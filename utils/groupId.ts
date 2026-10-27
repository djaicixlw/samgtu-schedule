/**
 * AUD-027: THE single canonicalizer of group identifiers.
 *
 * Historically three normalizers coexisted with DIFFERENT results on the same
 * input (makeGroupId = raw transliteration, normalizeGroupId = lowercase + exact
 * alias table, normalizeSamgtuGroupName = course/number structural parsing).
 * That produced divergent storage keys, dedup keys and schedule chunk ids.
 *
 * Now every normalization path delegates here. makeGroupId implements the
 * SUPERSET of the old behaviors, in priority order:
 *
 *   0. clean:    strip "Группа " prefix, dash-lookalikes, "(...)/[...]" tail,
 *                unify separators (spaces/underscores/slashes/dots) to hyphens,
 *                collapse and trim hyphens, lowercase;
 *   1. aliases:  exact legacy alias table (history beats structure: 'фаид-110'
 *                -> 'faid-310', 'ингт-1' -> 'ingt-301', ...);
 *   2. structure: the SamGTU course/number scheme — the app's canonical id space
 *                ('3-ИНГТ-110' -> 'ingt-310', '24ИНГТ-110' -> 'ingt-310',
 *                '2-ХТФ-115' -> 'htf-215', 'ingt-310' -> 'ingt-310');
 *   3. fallback: the historical transliteration slug for everything else
 *                (custom/master groups: '25ингт-104м' -> '25ingt-104m').
 *
 * The result is always strictly [a-z0-9-] (or '' for empty input).
 */

import { CANONICAL_GROUP_ALIASES } from './groupAliases';

export const FACULTY_TRANSLIT_MAP: Record<string, string> = {
  'ингт': 'ingt',
  'фаид': 'faid',
  'иаит': 'iait',
  'хтф': 'htf',
  'итф': 'itf',
  'этф': 'etf',
  'тэф': 'tef',
  'фммт': 'fmmt',
  'фпп': 'fpp',
  'ииэго': 'iiego',
  'аса': 'asa'
};

export const CYRILLIC_CHAR_MAP: Record<string, string> = {
  'а': 'a',
  'б': 'b',
  'в': 'v',
  'г': 'g',
  'д': 'd',
  'е': 'e',
  'ё': 'e',
  'ж': 'zh',
  'з': 'z',
  'и': 'i',
  'й': 'y',
  'к': 'k',
  'л': 'l',
  'м': 'm',
  'н': 'n',
  'о': 'o',
  'п': 'p',
  'р': 'r',
  'с': 's',
  'т': 't',
  'у': 'u',
  'ф': 'f',
  'х': 'kh',
  'ц': 'ts',
  'ч': 'ch',
  'ш': 'sh',
  'щ': 'shch',
  'ъ': '',
  'ы': 'y',
  'ь': '',
  'э': 'e',
  'ю': 'yu',
  'я': 'ya'
};

/** Faculty code by (lowercased) Cyrillic/Latin faculty name of the SamGTU scheme. */
const FACULTY_TO_ID: Record<string, string> = {
  'ингт': 'ingt',
  'аса': 'asa',
  'иаит': 'iait',
  'итф': 'itf',
  'этф': 'etf',
  'хтф': 'htf',
  'тэф': 'tef',
  'фммт': 'fmmt',
  'фпп': 'fpp',
  'ииэго': 'iiego',
  'фаид': 'faid'
};

/**
 * Transliterates Russian characters to Latin alphabet, prioritizing standard SamGTU faculty abbreviations.
 */
export function transliterateCyrillic(text: string): string {
  let lower = text.toLowerCase();

  // 1. Prioritize multi-character faculty names (longest first to avoid partial substring matches)
  const sortedFaculties = Object.keys(FACULTY_TRANSLIT_MAP).sort((a, b) => b.length - a.length);
  for (const fac of sortedFaculties) {
    const replacement = FACULTY_TRANSLIT_MAP[fac];
    lower = lower.replace(new RegExp(fac, 'g'), replacement);
  }

  // 2. Character-by-character transliteration for any remaining Cyrillic letters
  let result = '';
  for (const char of lower) {
    if (Object.prototype.hasOwnProperty.call(CYRILLIC_CHAR_MAP, char)) {
      result += CYRILLIC_CHAR_MAP[char];
    } else {
      result += char;
    }
  }
  return result;
}

/** Pre-cleaning shared by the structural and fallback stages (idempotent on ids). */
function cleanGroupInput(name: string): string {
  return name
    .replace(/^группа\s+/i, '')
    .replace(/[\u2010\u2011\u2012\u2013\u2014]/g, '-')
    .replace(/\s*[\(\[].*?[\)\]]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\\\/.,;]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Resolves the structural SamGTU patterns into the app-canonical id
 * (`<fac>-<course><num2>`). Returns null when nothing matches or the faculty is
 * unknown (the caller falls back to transliteration — a Cyrillic faculty must
 * never leak into the id).
 */
function structuralGroupId(cleaned: string): string | null {
  // Portal year-code names carry the ADMISSION year, not the course:
  // 23 -> 4 курс, 24 -> 3 курс, 25 -> 2 курс, 26 -> 1 курс.
  const yearCodeToCourse = (code: number): number =>
    code === 23 ? 4 : code === 24 ? 3 : code === 25 ? 2 : code === 26 ? 1 : 3;

  // 1. Portal names: 24ИНГТ-110 (no dashes between year code and faculty).
  const portal = cleaned.match(/^(\d{2})([а-яёa-z]+)-(\d+)$/);
  if (portal) {
    const facId = FACULTY_TO_ID[portal[2]] || (/^[a-z]+$/.test(portal[2]) ? portal[2] : null);
    if (facId) {
      return `${facId}-${yearCodeToCourse(parseInt(portal[1], 10))}${portal[3].slice(-2)}`;
    }
  }

  // 2. Dashed names: 3-ИНГТ-24ИНГТ-110 and plain 3-ИНГТ-110.
  const patterns: RegExp[] = [
    /^(\d+)-([а-яёa-z]+)-\d+[а-яёa-z]+-(\d+)$/,  // 3-ИНГТ-24ИНГТ-110
    /^(\d+)-([а-яёa-z]+)-(\d+)$/                 // 3-ИНГТ-110
  ];
  for (const re of patterns) {
    const m = cleaned.match(re);
    if (!m) continue;
    const facId = FACULTY_TO_ID[m[2]] || (/^[a-z]+$/.test(m[2]) ? m[2] : null);
    if (!facId) continue;
    return `${facId}-${m[1]}${m[3].slice(-2)}`;
  }
  // 3. Built-in id form (idempotency): ingt-310 / faid-310 / htf-215 ...
  const builtin = cleaned.match(/^([a-z]+)-([1-6])(\d{2})$/);
  if (builtin) return `${builtin[1]}-${builtin[2]}${builtin[3]}`;
  return null;
}

/**
 * Normalizes ANY group name or id into the single canonical form
 * (see the module header for the pipeline). This is the ONLY entry point the
 * rest of the codebase should use for group-id normalization.
 */
export function makeGroupId(name: string): string {
  if (!name || typeof name !== 'string') return '';

  const cleaned = cleanGroupInput(name);
  if (!cleaned) return '';

  // 1. Legacy exact aliases (highest priority: they encode history, not structure).
  const aliased = CANONICAL_GROUP_ALIASES[cleaned];
  if (aliased) return aliased;

  // 2. Structural SamGTU course/number scheme -> the app-canonical id.
  const structural = structuralGroupId(cleaned);
  if (structural) return structural;

  // 3. Historical transliteration fallback (custom/master groups).
  const withHyphens = transliterateCyrillic(cleaned).replace(/[^a-z0-9-]+/g, '-');
  return withHyphens.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Strict validation of group identifier format:
 * Must be non-empty and consist strictly of lowercase Latin letters, digits, and hyphens.
 */
export function isValidGroupId(id: string): boolean {
  if (!id || typeof id !== 'string') return false;
  return /^[a-z0-9-]+$/.test(id);
}
