/**
 * AUD-034: group-chunk generator, mojibake renamer and SAMGTU_GROUP_MAP extender.
 *
 * Why: the schedules corpus grew faster than the hand-maintained map —
 * SAMGTU_GROUP_MAP covered 17 groups while public/schedules/ holds 64 chunks,
 * and 19 of those chunks have DOUBLE-ENCODED (mojibake) file names of the form
 * `25РёРЅРіС‚-101Рј.json` (the UTF-8 bytes of «25ингт-101м» misread as cp1251).
 *
 * DRY-RUN BY DEFAULT. The script NEVER touches anything without an explicit
 * flag:
 *   npx tsx scripts/generate_group_chunks.ts
 *       — scan + report only (mojibake candidates, map coverage, suggested
 *         AUTO-GENERATED map section). Nothing is modified.
 *   --rename            rename mojibake chunk files to the decoded UTF-8 names
 *   --write-map         insert/refresh the AUTO-GENERATED section of
 *                       utils/samgtuGroupMap.ts (marked BEGIN/END, dated)
 *   --generate-from <file> [--group-name «25ингт-101м»] [--out <path>]
 *                       build a chunk from a personal-cabinet (ЛК) HTML export
 *                       via the existing samgtuParser, validate against
 *                       scheduleSchema and write public/schedules/<id>.json
 *   --dir <path>        schedules dir override (default public/schedules)
 *   --report <file>     additionally write the plain-text report to a file
 *
 * Unknown mojibake patterns are REPORTED, never guessed: a rename happens only
 * with confidence 'high' (see decodeMojibakeName).
 *
 * The AUTO-GENERATED map section intentionally carries samgtuGroupId: 0 — the
 * numeric portal ID cannot be derived from a chunk file and is NOT guessed.
 * nightly_sync.ts skips entries with samgtuGroupId === 0 until a human fills
 * them in.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SAMGTU_GROUP_MAP, SamgtuGroupMeta } from '../utils/samgtuGroupMap';
import { makeGroupId, isValidGroupId } from '../utils/groupId';
import { normalizeGroupId } from '../utils/groupAliases';
import { parseSamgtuSchedule } from '../utils/samgtuParser';
import { validateWeekData } from '../utils/scheduleSchema';
import { WeekData } from '../types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const DEFAULT_SCHEDULES_DIR = path.resolve(__dirname, '../public/schedules');
export const GROUP_MAP_PATH = path.resolve(__dirname, '../utils/samgtuGroupMap.ts');

// ---------------------------------------------------------------------------
// cp1251 <-> utf-8 double-decoding of file names
// ---------------------------------------------------------------------------

/**
 * cp1251 table: byte value -> character. Bytes 0x00-0x7F are ASCII.
 * Built once; the reverse map is derived from it.
 */
const CP1251_TABLE: string[] = (() => {
  const t: string[] = new Array(256);
  for (let i = 0; i < 128; i++) t[i] = String.fromCharCode(i);
  const hi: Record<number, string> = {
    0x80: 'Ђ', 0x81: 'Ѓ', 0x82: '‚', 0x83: 'ѓ', 0x84: '„', 0x85: '…', 0x86: '†',
    0x87: '‡', 0x88: '€', 0x89: '‰', 0x8A: 'Љ', 0x8B: '‹', 0x8C: 'Њ', 0x8D: 'Ќ',
    0x8E: 'Ћ', 0x8F: 'Џ',
    0x90: 'ђ', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–',
    0x97: '—', 0x98: '\u0098', 0x99: '™', 0x9A: '›', 0x9B: 'љ', 0x9C: 'њ',
    0x9D: 'ќ', 0x9E: 'ћ', 0x9F: 'џ',
    0xA0: '\u00A0', 0xA1: 'Ў', 0xA2: 'ў', 0xA3: 'Ј', 0xA4: '¤', 0xA5: 'Ґ',
    0xA6: '¦', 0xA7: '§', 0xA8: 'Ё', 0xA9: '©', 0xAA: 'Є', 0xAB: '«', 0xAC: '¬',
    0xAD: '\u00AD', 0xAE: '®', 0xAF: 'Ї',
    0xB0: '°', 0xB1: '±', 0xB2: 'І', 0xB3: 'і', 0xB4: 'ґ', 0xB5: 'µ', 0xB6: '¶',
    0xB7: '·', 0xB8: 'ё', 0xB9: '№', 0xBA: 'є', 0xBB: '»', 0xBC: 'ј', 0xBD: 'Ѕ',
    0xBE: 'ѕ', 0xBF: 'ї'
  };
  for (const k of Object.keys(hi)) t[Number(k)] = hi[Number(k)];
  for (let i = 0xC0; i <= 0xFF; i++) t[i] = String.fromCharCode(i - 0xC0 + 0x410);
  return t;
})();

const CHAR_TO_CP1251_BYTE: Map<string, number> = (() => {
  const m = new Map<string, number>();
  CP1251_TABLE.forEach((ch, byte) => {
    // 0x98 is an unmapped control slot in cp1251; never match it.
    if (byte !== 0x98 && !m.has(ch)) m.set(ch, byte);
  });
  return m;
})();

/** Encodes a string into cp1251 bytes; returns null for unmappable characters. */
export function encodeCp1251(text: string): Uint8Array | null {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const byte = CHAR_TO_CP1251_BYTE.get(text[i]);
    if (byte === undefined) return null;
    out[i] = byte;
  }
  return out;
}

/** Decodes UTF-8 bytes; returns null when the bytes are not valid UTF-8. */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    const dec = new TextDecoder('utf-8', { fatal: true });
    return dec.decode(bytes);
  } catch {
    return null;
  }
}

export interface MojibakeDecodeResult {
  /** The best-known correct name (== input when nothing better was found). */
  name: string;
  changed: boolean;
  /** high = safe to rename; none = unknown pattern, report only. */
  confidence: 'high' | 'none';
}

const PLAUSIBLE_CHUNK_NAME_RE = /^[0-9A-Za-zА-Яа-яЁё][0-9A-Za-zА-Яа-яЁё\-_. ]*$/;
/**
 * Detection alphabet: characters that trigger the decode attempt. Includes
 * ё/Ё (0xB8/0xA8 — the mojibake of the extremely common «и») plus the
 * cp1251-only typographic letters. ё/Ё are also legitimate Russian letters,
 * so the DECODED side is checked with the narrower residual alphabet below.
 */
const MOJIBAKE_DETECT_RE = /[‚„…†‡€‰‹ЊЌЋЏ‘’“”•–—™›љњќћџђҐґёЁїЇјЅѕЎў¤¦©«¬®°±µ¶·№]/;
/** Residual mojibake in a DECODED name (ё/Ё excluded — they are legitimate). */
const MOJIBAKE_RESIDUAL_RE = /[‚„…†‡€‰‹ЊЌЋЏ‘’“”•–—™›љњќћџђҐґїЇјЅѕЎў¤¦«¬®°±µ¶·№]/;

/**
 * Reverses ONE layer of "UTF-8 bytes shown as cp1251" mojibake:
 * `25РёРЅРіС‚-101Рј.json` -> `25ингт-101м.json`.
 *
 * Confidence rules (AUD-034: не гадать):
 *   - the input must contain mojibake-only characters AND be cp1251-encodable;
 *   - the decoded bytes must be valid UTF-8;
 *   - the decoded name must look like a plausible chunk name and must itself
 *     be free of the mojibake alphabet;
 *   - decoding must be idempotent (decoding the result changes nothing).
 * Otherwise the name is returned unchanged with confidence 'none'.
 */
export function decodeMojibakeName(name: string): MojibakeDecodeResult {
  if (!name || !MOJIBAKE_DETECT_RE.test(name)) {
    return { name, changed: false, confidence: 'none' };
  }
  const bytes = encodeCp1251(name);
  if (!bytes) return { name, changed: false, confidence: 'none' };
  const decoded = decodeUtf8(bytes);
  if (!decoded || decoded === name) return { name, changed: false, confidence: 'none' };
  if (MOJIBAKE_RESIDUAL_RE.test(decoded)) return { name, changed: false, confidence: 'none' };
  if (!PLAUSIBLE_CHUNK_NAME_RE.test(decoded.replace(/\.json$/i, ''))) {
    return { name, changed: false, confidence: 'none' };
  }
  // Idempotence: a second decoding round must change nothing.
  const again = decodeMojibakeName(decoded);
  if (again.changed) return { name, changed: false, confidence: 'none' };
  return { name: decoded, changed: true, confidence: 'high' };
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

export interface ChunkScanEntry {
  fileName: string;
  /** Group id derived from the (decoded) file stem via makeGroupId. */
  groupId: string;
  decoded: MojibakeDecodeResult;
  inMap: boolean;
  /** Cross-check: decoded stem matches the lesson-id prefixes inside the JSON. */
  idPrefixMatch: 'yes' | 'no' | 'unknown';
  lessonCount: number;
  error?: string;
}

export interface ChunkScanReport {
  dir: string;
  files: ChunkScanEntry[];
  mojibake: ChunkScanEntry[];
  notInMap: ChunkScanEntry[];
  coveredInMap: ChunkScanEntry[];
}

/** Stem -> id: strip .json, run the single canonicalizer (AUD-027). */
export function chunkIdFromFileName(fileName: string): string {
  const stem = fileName.replace(/\.json$/i, '');
  return normalizeGroupId(stem);
}

/**
 * The chunk JSON has no explicit group field; the lesson ids embed the group
 * stem (`25ингт-101м-w1-tu-1`), which we use as a cross-check of the decoded
 * file name.
 */
function crossCheckIdPrefix(data: any, stem: string): { verdict: 'yes' | 'no' | 'unknown'; lessonCount: number } {
  let lessonCount = 0;
  let checked = 0;
  let matched = 0;
  try {
    for (const w of Object.keys(data)) {
      const days = data[w];
      if (!Array.isArray(days)) continue;
      for (const day of days) {
        if (!Array.isArray(day?.lessons)) continue;
        for (const lesson of day.lessons) {
          if (!lesson?.id) continue;
          lessonCount++;
          const m = String(lesson.id).match(/^(.+)-w\d+-[a-z]{2}-\d+$/);
          if (!m) continue;
          checked++;
          if (m[1] === stem) matched++;
        }
      }
    }
  } catch {
    return { verdict: 'unknown', lessonCount };
  }
  if (checked === 0) return { verdict: 'unknown', lessonCount };
  return { verdict: matched === checked ? 'yes' : 'no', lessonCount };
}

export function scanSchedulesDir(dir: string = DEFAULT_SCHEDULES_DIR): ChunkScanReport {
  const files: ChunkScanEntry[] = [];
  const names = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.json')).sort();

  for (const fileName of names) {
    const decoded = decodeMojibakeName(fileName);
    const groupId = chunkIdFromFileName(decoded.name);
    const entry: ChunkScanEntry = {
      fileName,
      groupId,
      decoded,
      inMap: Object.prototype.hasOwnProperty.call(SAMGTU_GROUP_MAP, groupId),
      idPrefixMatch: 'unknown',
      lessonCount: 0
    };
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, fileName), 'utf8'));
      const cc = crossCheckIdPrefix(data, decoded.name.replace(/\.json$/i, ''));
      entry.idPrefixMatch = cc.verdict;
      entry.lessonCount = cc.lessonCount;
    } catch (e) {
      entry.error = e instanceof Error ? e.message : String(e);
    }
    files.push(entry);
  }

  return {
    dir,
    files,
    mojibake: files.filter(f => f.decoded.changed),
    notInMap: files.filter(f => !f.inMap),
    coveredInMap: files.filter(f => f.inMap)
  };
}

// ---------------------------------------------------------------------------
// AUTO-GENERATED map section
// ---------------------------------------------------------------------------

export const MAP_SECTION_BEGIN = '// BEGIN AUTO-GENERATED (AUD-034)';
export const MAP_SECTION_END = '// END AUTO-GENERATED (AUD-034)';

export interface AutoMapEntry extends SamgtuGroupMeta {
  /** The chunk file this entry was derived from. */
  chunkFile: string;
  /** 'yes' when lesson-id prefixes inside the JSON confirm the decoded name. */
  idPrefixMatch: 'yes' | 'no' | 'unknown';
}

/**
 * Builds map entries for chunks missing from the hand-maintained map.
 * samgtuGroupId is 0 = UNKNOWN: the portal numeric id cannot be derived from a
 * chunk file and is deliberately NOT guessed (fill manually after looking it
 * up on samgtu.ru; nightly_sync skips entries with 0).
 */
export function buildAutoMapEntries(report: ChunkScanReport): Record<string, AutoMapEntry> {
  const entries: Record<string, AutoMapEntry> = {};
  for (const file of report.notInMap) {
    if (!file.groupId || !isValidGroupId(file.groupId)) continue;
    const stem = file.decoded.name.replace(/\.json$/i, '');
    entries[file.groupId] = {
      name: stem,
      samgtuName: `Группа ${stem}`,
      samgtuGroupId: 0,
      chunkFile: file.fileName,
      idPrefixMatch: file.idPrefixMatch
    };
  }
  return entries;
}

/** Renders the dated AUTO-GENERATED section body (entries sorted by id). */
export function renderAutoGeneratedSection(entries: Record<string, AutoMapEntry>, dateISO: string): string {
  const lines: string[] = [];
  lines.push(MAP_SECTION_BEGIN);
  lines.push(`// Сгенерировано scripts/generate_group_chunks.ts ${dateISO}.`);
  lines.push('// samgtuGroupId: 0 = ID портала НЕИЗВЕСТЕН (из файла чанка не выводится — заполняется вручную).');
  lines.push('// nightly_sync пропускает записи с samgtuGroupId === 0.');
  for (const gid of Object.keys(entries).sort()) {
    const e = entries[gid];
    const check = e.idPrefixMatch === 'yes' ? 'id-prefix подтверждён' : e.idPrefixMatch === 'no' ? 'id-prefix НЕ совпал' : 'id-prefix не проверен';
    lines.push(
      `  '${gid}': { name: ${JSON.stringify(e.name)}, samgtuName: ${JSON.stringify(e.samgtuName)}, samgtuGroupId: ${e.samgtuGroupId} }, // ${e.chunkFile}; ${check}`
    );
  }
  lines.push(MAP_SECTION_END);
  return lines.join('\n');
}

/**
 * Inserts (or replaces) the AUTO-GENERATED section inside samgtuGroupMap.ts.
 * Idempotent: a second call replaces the previous section. Returns the new
 * file content (does not write).
 */
export function applyMapSection(mapTsContent: string, section: string): string {
  const beginIdx = mapTsContent.indexOf(MAP_SECTION_BEGIN);
  const endIdx = mapTsContent.indexOf(MAP_SECTION_END);
  if (beginIdx >= 0 && endIdx > beginIdx) {
    const before = mapTsContent.slice(0, beginIdx);
    const after = mapTsContent.slice(endIdx + MAP_SECTION_END.length);
    return before + section + after;
  }
  // Append before the final closing brace of the map literal.
  const lastBrace = mapTsContent.lastIndexOf('};');
  if (lastBrace < 0) {
    throw new Error('Не найдена закрывающая скобка SAMGTU_GROUP_MAP — проверьте utils/samgtuGroupMap.ts');
  }
  return mapTsContent.slice(0, lastBrace) + '\n' + section + '\n' + mapTsContent.slice(lastBrace);
}

// ---------------------------------------------------------------------------
// Chunk generation from a ЛК export (reuses samgtuParser, no network)
// ---------------------------------------------------------------------------

export interface GenerateChunkResult {
  ok: boolean;
  reason?: 'invalid' | 'empty' | 'bad-group-id';
  groupId?: string;
  weeks?: WeekData;
  lessonCount?: number;
}

/**
 * Builds a schedule chunk from a personal-cabinet HTML (or pre-parsed JSON
 * weeks) export. Group name/id resolution: explicit groupNameOverride wins,
 * otherwise the parser extracts «Студент: <группа>» from the export; the id is
 * produced by makeGroupId — the same canonicalizer the app uses, so the chunk
 * file name equals the id the app will request.
 */
export function generateChunkFromExport(
  rawContent: string,
  opts: { groupNameOverride?: string; groupIdOverride?: string } = {}
): GenerateChunkResult {
  const parsed = parseSamgtuSchedule(rawContent, {
    groupNameOverride: opts.groupNameOverride,
    groupIdOverride: opts.groupIdOverride
  });

  const groupId = opts.groupIdOverride || parsed.meta.normalizedGroupId || '';
  if (!groupId || !isValidGroupId(groupId)) {
    return { ok: false, reason: 'bad-group-id' };
  }

  const validation = validateWeekData(parsed.weeks);
  if (!validation.ok) {
    return { ok: false, reason: validation.reason === 'empty' ? 'empty' : 'invalid', groupId };
  }

  const lessonCount = Object.values(validation.data).reduce(
    (acc, days) => acc + days.reduce((a, d) => a + d.lessons.length, 0),
    0
  );
  if (lessonCount === 0) {
    return { ok: false, reason: 'empty', groupId };
  }

  return { ok: true, groupId, weeks: validation.data, lessonCount };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const o: {
    rename: boolean; writeMap: boolean; dir?: string; report?: string;
    generateFrom?: string; groupName?: string; groupId?: string; out?: string;
  } = { rename: false, writeMap: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rename') o.rename = true;
    else if (a === '--write-map') o.writeMap = true;
    else if (a === '--dir') o.dir = argv[++i];
    else if (a === '--report') o.report = argv[++i];
    else if (a === '--generate-from') o.generateFrom = argv[++i];
    else if (a === '--group-name') o.groupName = argv[++i];
    else if (a === '--group-id') o.groupId = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else { console.error(`Неизвестный параметр: ${a}`); process.exit(2); }
  }
  return o;
}

function runCli() {
  const o = parseArgs(process.argv.slice(2));
  const dir = o.dir ? path.resolve(o.dir) : DEFAULT_SCHEDULES_DIR;
  const reportLines: string[] = [];
  const say = (m: string) => { console.log(m); reportLines.push(m); };

  // --generate-from: chunk generation path -------------------------------
  if (o.generateFrom) {
    const raw = fs.readFileSync(o.generateFrom, 'utf8');
    const gen = generateChunkFromExport(raw, { groupNameOverride: o.groupName, groupIdOverride: o.groupId });
    if (!gen.ok || !gen.weeks) {
      say(`❌ Генерация чанка не удалась: ${gen.reason}${gen.groupId ? ` (группа ${gen.groupId})` : ''}`);
      process.exit(1);
    }
    const outPath = o.out ? path.resolve(o.out) : path.join(dir, `${gen.groupId}.json`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(gen.weeks, null, 2), 'utf8');
    say(`✅ Чанк записан: ${outPath} (id=${gen.groupId}, пар: ${gen.lessonCount})`);
    if (o.report) fs.writeFileSync(o.report, reportLines.join('\n') + '\n', 'utf8');
    return;
  }

  // Default: scan + report (and optional --rename / --write-map) ----------
  say('================================================================');
  say('AUD-034: сканирование public/schedules (DRY-RUN по умолчанию)');
  say(`Каталог: ${dir}`);
  say('================================================================');

  const report = scanSchedulesDir(dir);
  say(`Файлов-чанков: ${report.files.length}`);

  say('\n--- Карта SAMGTU_GROUP_MAP ---');
  say(`Покрыто картой: ${report.coveredInMap.length}; НЕ в карте: ${report.notInMap.length}`);
  for (const f of report.notInMap) {
    say(`  НЕ В КАРТЕ: ${f.fileName} -> id=${f.groupId} (пар: ${f.lessonCount}${f.idPrefixMatch === 'yes' ? ', id-prefix подтверждён' : f.idPrefixMatch === 'no' ? ', id-prefix НЕ совпал!' : ''})${f.error ? ` [ошибка чтения: ${f.error}]` : ''}`);
  }

  say('\n--- Mojibake-имена ---');
  if (report.mojibake.length === 0) {
    say('Mojibake-имён не обнаружено.');
  }
  for (const f of report.mojibake) {
    say(`  ${f.decoded.confidence === 'high' ? '✔' : '?'} ${f.fileName} -> ${f.decoded.name}${f.decoded.confidence === 'high' ? '' : ' (шаблон не распознан — НЕ переименовывать)'}`);
  }

  const entries = buildAutoMapEntries(report);
  const section = renderAutoGeneratedSection(entries, new Date().toISOString().slice(0, 10));

  if (o.rename) {
    say('\n--- Переименование (--rename) ---');
    for (const f of report.mojibake) {
      if (f.decoded.confidence !== 'high') {
        say(`  ⚠️ пропуск (низкая уверенность): ${f.fileName}`);
        continue;
      }
      const from = path.join(dir, f.fileName);
      const to = path.join(dir, f.decoded.name);
      if (fs.existsSync(to)) {
        say(`  ⚠️ пропуск (цель существует): ${f.decoded.name}`);
        continue;
      }
      fs.renameSync(from, to);
      say(`  переименован: ${f.fileName} -> ${f.decoded.name}`);
    }
  } else if (report.mojibake.length > 0) {
    say('\n(DRY-RUN: переименование не выполнялось. Для применения добавьте --rename.)');
  }

  if (o.writeMap) {
    const mapPath = GROUP_MAP_PATH;
    const current = fs.readFileSync(mapPath, 'utf8');
    const updated = applyMapSection(current, section);
    fs.writeFileSync(mapPath, updated, 'utf8');
    say(`\nСекция AUTO-GENERATED записана в ${mapPath} (${Object.keys(entries).length} записей).`);
  } else {
    say('\n--- Предлагаемая секция AUTO-GENERATED для utils/samgtuGroupMap.ts ---');
    say(section);
    say('\n(DRY-RUN: карта не изменялась. Для применения добавьте --write-map.)');
  }

  if (o.report) fs.writeFileSync(o.report, reportLines.join('\n') + '\n', 'utf8');
}

const isCli = process.argv[1] && (process.argv[1].endsWith('generate_group_chunks.ts'));
if (isCli) {
  runCli();
}
