/**
 * BDAT Schema Inspector for Xenoblade Chronicles 3
 *
 * Analyzes a parsed BdatFile and produces a lightweight schema report
 * with translation decisions, tag discovery, byte statistics, and safety rules.
 * Never dumps full text — sampling + masking only.
 */

import type { BdatFile, BdatTable, BdatColumn } from "./bdat-parser";
import { BdatValueType } from "./bdat-parser";

// ============= Options =============

export interface InspectorOptions {
  include_samples?: boolean;          // default: false
  sample_per_field?: number;          // 1–10, default: 3
  sample_mask_mode?: "prefix5" | "statsOnly";
  max_records_for_full_scan?: number; // default: 5000
  sample_record_cap?: number;         // default: 1000
  /** Safety margin multiplier for max_utf8_bytes (e.g. 1.2 = 20%). Default: read from settings or 1.2 */
  safety_margin?: number;
  /** Arabic byte multiplier. Default: read from settings or 2.0 */
  arabic_multiplier?: number;
}

// ============= Output Interfaces =============

export interface BdatFieldSchema {
  field_name: string;
  data_type: "string" | "int" | "float" | "bool" | "hash" | "other";
  translate: boolean;
  translate_reason: string[];
  record_count: number;
  non_empty_count: number;
  max_chars: number;
  avg_chars: number;
  max_utf8_bytes: number;
  avg_utf8_bytes: number;
  multiline: boolean;
  duplicate_ratio: number;
  allowed_tags: string[];
  tag_counts: Record<string, number>;
  samples?: string[];
  notes?: string;
}

export interface BdatTableSchema {
  table: string;
  primary_key: string | null;
  translatable_count: number;
  fields: BdatFieldSchema[];
}

export interface BdatSchemaReport {
  file: string;
  generated_at: string;
  table_count: number;
  translatable_tables: number;
  all_discovered_tags: string[];
  safety_contract: string[];
  tables: BdatTableSchema[];
}

// ============= Constants =============

const SAFETY_CONTRACT = [
  "لا تغيّر ترتيب الصفوف أو عددها داخل BDAT",
  "لا تغيّر IDs أو الحقول غير القابلة للترجمة (translate=false)",
  "لا تحذف الوسوم الموجودة — اعتبرها محفوظة",
  "لا تُضِف وسوماً خارج allowed_tags لكل حقل",
  "لا تتجاوز max_utf8_bytes لكل نص",
  "لا تُضِف أسطراً جديدة إذا كان multiline=false",
];

/** Column name keywords that always mean translate=false */
const EXCLUDE_KEYWORDS = [
  "_id", "_key", "hash", "ref", "index", "idx", "ptr",
  "guid", "uuid", "crc", "offset", "count", "size", "flag", "type",
];

/** Field name allowlist → translate=true */
const TRANSLATE_ALLOWLIST = new Set([
  "name", "title", "desc", "description", "text", "help",
  "caption", "label", "message", "msg", "hint", "detail",
  "note", "tooltip",
]);

/** Known game-specific tag patterns */
const NAMED_TAG_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "<color>",  re: /<color[^>]*>/gi },
  { name: "<br>",     re: /<br\s*\/?>/gi },
  { name: "<item>",   re: /<item[^>]*>/gi },
  { name: "<voice>",  re: /<voice[^>]*>/gi },
  { name: "<target>", re: /<target[^>]*>/gi },
  { name: "<ruby>",   re: /<ruby[^>]*>/gi },
];
const GENERIC_TAG_RE = /<[^>]{1,24}>/g;
const UNICODE_CTRL_RE = /[\uFFF9-\uFFFC\uE000-\uF8FF]/;

// ============= Helpers =============

function utf8ByteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

function maskSample(text: string): string {
  const prefix = [...text].slice(0, 5).join("");
  return prefix + "***";
}

function mapDataType(vt: BdatValueType): BdatFieldSchema["data_type"] {
  if (vt === BdatValueType.String || vt === BdatValueType.DebugString) return "string";
  if (vt === BdatValueType.Float || vt === BdatValueType.Percent) return "float";
  if (vt === BdatValueType.HashRef) return "hash";
  if (
    vt === BdatValueType.UnsignedByte ||
    vt === BdatValueType.UnsignedShort ||
    vt === BdatValueType.UnsignedInt ||
    vt === BdatValueType.SignedByte ||
    vt === BdatValueType.SignedShort ||
    vt === BdatValueType.SignedInt ||
    vt === BdatValueType.MessageId
  ) return "int";
  return "other";
}

/** Sample strategy: first N + middle N + last N records */
function sampleRows(count: number, cap: number): number[] {
  if (count <= cap) return Array.from({ length: count }, (_, i) => i);
  const third = Math.floor(cap / 3);
  const mid = Math.floor(count / 2);
  const indices = new Set<number>();
  for (let i = 0; i < third; i++) indices.add(i);
  for (let i = -Math.floor(third / 2); i < Math.ceil(third / 2); i++) indices.add(mid + i);
  for (let i = count - third; i < count; i++) indices.add(i);
  return [...indices].filter(i => i >= 0 && i < count).sort((a, b) => a - b);
}

/** Detect primary key column: first column named 'id' or ending with 'Id' or 'ID' */
function detectPrimaryKey(table: BdatTable): string | null {
  for (const col of table.columns) {
    const n = col.name.toLowerCase();
    if (n === "id" || n.endsWith("_id") || n === "key" || n.endsWith("_key")) {
      return col.name;
    }
  }
  return null;
}

// ============= Translate Decision =============

function decideTranslate(
  col: BdatColumn,
  tableName: string,
  avgChars: number,
): { translate: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const colLower = col.name.toLowerCase();
  const tableIsMs = tableName.toLowerCase().endsWith("_ms");

  // Step 1: type gate
  if (col.valueType !== BdatValueType.String && col.valueType !== BdatValueType.DebugString) {
    return { translate: false, reasons: ["نوع البيانات ليس نصياً (String/DebugString)"] };
  }

  // Step 2: exclude keywords
  const hit = EXCLUDE_KEYWORDS.find(kw => colLower.includes(kw));
  if (hit) {
    return { translate: false, reasons: [`اسم العمود يحتوي كلمة محجوزة: "${hit}"`] };
  }

  // Step 3: _ms table → true (priority)
  if (tableIsMs) {
    reasons.push("الجدول ينتهي بـ _ms (Message Strings)");
    if (avgChars < 3) {
      reasons.push("⚠️ متوسط الطول < 3 أحرف (تحذير، وليس رفضاً لأن الجدول _ms)");
    }
    return { translate: true, reasons };
  }

  // Step 4: allowlist field name
  const fieldBase = colLower.replace(/[^a-z0-9]/g, "");
  if (TRANSLATE_ALLOWLIST.has(fieldBase)) {
    reasons.push(`اسم الحقل ضمن القائمة المسموح بها: "${col.name}"`);
    return { translate: true, reasons };
  }

  // Step 5: avg length filter
  if (avgChars < 3) {
    return { translate: false, reasons: ["متوسط الطول أقل من 3 أحرف"] };
  }

  return { translate: false, reasons: ["لم يطابق أي شرط تفعيل (allowlist / _ms)"] };
}

// ============= Tag Discovery =============

function discoverTags(texts: string[]): { allowed_tags: string[]; tag_counts: Record<string, number> } {
  const tagCounts: Record<string, number> = {};
  const hasUnicode: number[] = [];

  for (const text of texts) {
    // Named patterns
    for (const { name, re } of NAMED_TAG_PATTERNS) {
      const matches = text.match(re);
      if (matches) tagCounts[name] = (tagCounts[name] || 0) + matches.length;
    }
    // Generic fallback (excluding already-named)
    const namedMatched = NAMED_TAG_PATTERNS.flatMap(({ re }) => text.match(re) || []);
    const genericMatches = (text.match(GENERIC_TAG_RE) || []).filter(
      m => !namedMatched.includes(m)
    );
    for (const m of genericMatches) {
      const key = m.toLowerCase().replace(/\s+/g, "").slice(0, 20);
      tagCounts[key] = (tagCounts[key] || 0) + 1;
    }
    // Unicode controls
    if (UNICODE_CTRL_RE.test(text)) hasUnicode.push(1);
  }

  if (hasUnicode.length > 0) {
    tagCounts["[unicode-ctrl]"] = hasUnicode.length;
  }

  const allowed_tags = Object.keys(tagCounts).filter(k => tagCounts[k] > 0);
  return { allowed_tags, tag_counts: tagCounts };
}

// ============= Field Inspector =============

function inspectField(
  col: BdatColumn,
  table: BdatTable,
  tableName: string,
  opts: Required<InspectorOptions>,
): BdatFieldSchema {
  const dataType = mapDataType(col.valueType);
  const isString = dataType === "string";

  // Collect string values
  const rowIndices = sampleRows(table.rows.length, opts.sample_record_cap);
  const texts: string[] = [];

  for (const ri of rowIndices) {
    const val = table.rows[ri]?.values[col.name];
    if (typeof val === "string" && val.trim().length > 0) {
      texts.push(val);
    }
  }

  const isApprox = table.rows.length > opts.sample_record_cap;

  // Stats
  let maxChars = 0, totalChars = 0;
  let maxBytes = 0, totalBytes = 0;
  let multiline = false;
  const seenHashes = new Set<string>();

  for (const t of texts) {
    const len = [...t].length; // Unicode-safe char count
    const bytes = utf8ByteLength(t);
    if (len > maxChars) maxChars = len;
    totalChars += len;
    if (bytes > maxBytes) maxBytes = bytes;
    totalBytes += bytes;
    if (!multiline && (t.includes("\n") || /<br\s*\/?>/i.test(t))) multiline = true;
    seenHashes.add(t.slice(0, 32)); // lightweight dedup proxy
  }

  const nonEmpty = texts.length;
  const avgChars = nonEmpty > 0 ? totalChars / nonEmpty : 0;
  const avgBytes = nonEmpty > 0 ? totalBytes / nonEmpty : 0;

  // Duplicate ratio (approximate via 32-char prefix hashing)
  const allValues: string[] = [];
  for (const ri of rowIndices) {
    const val = table.rows[ri]?.values[col.name];
    if (typeof val === "string" && val.length > 0) allValues.push(val.slice(0, 32));
  }
  const uniqueCount = new Set(allValues).size;
  const dupRatio = allValues.length > 0 ? 1 - uniqueCount / allValues.length : 0;

  // Tag discovery (strings only)
  let allowed_tags: string[] = [];
  let tag_counts: Record<string, number> = {};
  if (isString && texts.length > 0) {
    ({ allowed_tags, tag_counts } = discoverTags(texts));
  }

  // Translation decision (needs avg_chars)
  const { translate, reasons } = decideTranslate(col, tableName, avgChars);

  // Samples
  let samples: string[] | undefined;
  if (opts.include_samples && isString && texts.length > 0 && opts.sample_mask_mode !== "statsOnly") {
    const n = Math.min(opts.sample_per_field, texts.length);
    const step = Math.max(1, Math.floor(texts.length / n));
    samples = Array.from({ length: n }, (_, i) => maskSample(texts[i * step] ?? texts[0]));
  }

  // Notes
  const notesParts: string[] = [];
  if (isApprox) notesParts.push(`الإحصاءات تقريبية (عينة من ${opts.sample_record_cap} من ${table.rows.length} سجل)`);

  return {
    field_name: col.name,
    data_type: dataType,
    translate,
    translate_reason: reasons,
    record_count: table.rows.length,
    non_empty_count: nonEmpty,
    max_chars: maxChars,
    avg_chars: Math.round(avgChars * 10) / 10,
    // Arabic chars cost 2 bytes each in UTF-8.
    // We multiply by 3 to give extra room because:
    //   - Arabic translations are typically 30-50% longer than English
    //   - The binary writer rebuilds the string table dynamically, so no hard cap exists
    //   - The byte limit here is a soft warning only, not a hard binary constraint
    max_utf8_bytes: Math.max(Math.ceil(maxChars * 3 * opts.safety_margin * opts.arabic_multiplier), 4),
    avg_utf8_bytes: Math.round(avgBytes * 10) / 10,
    multiline,
    duplicate_ratio: Math.round(dupRatio * 100) / 100,
    allowed_tags,
    tag_counts,
    ...(samples ? { samples } : {}),
    ...(notesParts.length ? { notes: notesParts.join(" | ") } : {}),
  };
}

// ============= Main Export =============

export function inspectBdatSchema(
  bdatFile: BdatFile,
  fileName: string,
  options?: InspectorOptions,
): BdatSchemaReport {
  // Resolve safety margin & arabic multiplier from persisted settings
  const settingsRaw = (() => {
    try {
      const raw = localStorage.getItem("bdat-settings-v1");
      if (raw) return JSON.parse(raw) as { safetyMargin?: number; arabicMultiplier?: number };
    } catch { /* ignore */ }
    return {} as { safetyMargin?: number; arabicMultiplier?: number };
  })();
  const resolvedMargin = options?.safety_margin !== undefined ? Math.max(options.safety_margin, 1.0) : Math.max(settingsRaw.safetyMargin ?? 1.2, 1.0);
  const resolvedArabicMul = Math.min(Math.max(settingsRaw.arabicMultiplier ?? 2.0, 1.5), 3.0);

  const opts: Required<InspectorOptions> = {
    include_samples: options?.include_samples ?? false,
    sample_per_field: Math.min(10, Math.max(1, options?.sample_per_field ?? 3)),
    sample_mask_mode: options?.sample_mask_mode ?? "prefix5",
    max_records_for_full_scan: options?.max_records_for_full_scan ?? 5000,
    sample_record_cap: options?.sample_record_cap ?? 1000,
    safety_margin: resolvedMargin,
    arabic_multiplier: resolvedArabicMul,
  };

  const tables: BdatTableSchema[] = [];
  const allTagsSet = new Set<string>();

  for (const table of bdatFile.tables) {
    const primaryKey = detectPrimaryKey(table);

    const fields: BdatFieldSchema[] = table.columns.map(col =>
      inspectField(col, table, table.name, opts)
    );

    const translatableCount = fields.filter(f => f.translate).length;

    // Collect all tags from this table
    for (const f of fields) {
      for (const tag of f.allowed_tags) allTagsSet.add(tag);
    }

    tables.push({
      table: table.name,
      primary_key: primaryKey,
      translatable_count: translatableCount,
      fields,
    });
  }

  const translatableTables = tables.filter(t => t.translatable_count > 0).length;

  return {
    file: fileName,
    generated_at: new Date().toISOString(),
    table_count: tables.length,
    translatable_tables: translatableTables,
    all_discovered_tags: [...allTagsSet],
    safety_contract: SAFETY_CONTRACT,
    tables,
  };
}
