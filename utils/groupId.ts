/**
 * Utility for normalizing, transliterating and validating group identifiers.
 * Guarantees group IDs strictly match the format /^[a-z0-9-]+$/ to avoid server/URL issues.
 */

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

/**
 * Normalizes any group name or input into a strict URL-safe canonical format:
 * - Lowercases all text
 * - Transliterates Cyrillic letters (e.g. "ингт" -> "ingt", "фаид" -> "faid", "хтф" -> "htf", "м" -> "m")
 * - Converts spaces, slashes and special characters to hyphens
 * - Removes duplicate hyphens and trims leading/trailing hyphens
 * - Returns strictly [a-z0-9-]
 */
export function makeGroupId(name: string): string {
  if (!name || typeof name !== 'string') return '';

  // 1. Transliterate and lowercase
  const transliterated = transliterateCyrillic(name);

  // 2. Replace all non [a-z0-9-] characters with hyphens
  const withHyphens = transliterated.replace(/[^a-z0-9-]+/g, '-');

  // 3. Deduplicate hyphens and trim boundary hyphens
  const clean = withHyphens.replace(/-+/g, '-').replace(/^-+|-+$/g, '');

  return clean;
}

/**
 * Strict validation of group identifier format:
 * Must be non-empty and consist strictly of lowercase Latin letters, digits, and hyphens.
 */
export function isValidGroupId(id: string): boolean {
  if (!id || typeof id !== 'string') return false;
  return /^[a-z0-9-]+$/.test(id);
}
