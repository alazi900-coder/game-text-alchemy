/**
 * UTF-32-LE brute-force string scanner for Luigi's Mansion 2 HD.
 *
 * In the HD remaster, text data inside .data files is stored as raw UTF-32-LE
 * (4 bytes per character) without NLOC headers. This scanner finds readable
 * strings by looking for the XX 00 00 00 pattern (ASCII range) or valid
 * Unicode code-points encoded as little-endian 32-bit values, terminated by
 * 00 00 00 00 (null in UTF-32).
 */

export interface Utf32String {
  /** Byte offset in the source buffer where this string starts */
  offset: number;
  /** Decoded text */
  text: string;
  /** Length in UTF-32 code units (characters) */
  codeUnits: number;
}

/**
 * Check whether a 32-bit value is a printable / meaningful Unicode code-point.
 * More tolerant version: accepts game control codes as "inline" markers
 * so strings don't get split by embedded formatting codes.
 */
function isPrintableCodePoint(cp: number): boolean {
  if (cp === 0) return false; // null terminator
  // Allow common whitespace
  if (cp === 0x09 || cp === 0x0a || cp === 0x0d) return true;
  // Reject other C0 control characters EXCEPT common game control codes
  // Many games use 0x01-0x1F as inline formatting/variable markers
  if (cp < 0x20) return false;
  if (cp >= 0x7f && cp <= 0x9f) return false;
  // Reject surrogates
  if (cp >= 0xd800 && cp <= 0xdfff) return false;
  // Reject beyond valid Unicode
  if (cp > 0x10ffff) return false;
  return true;
}

/**
 * More lenient check: is this code point possibly part of game text?
 * Allows control codes 0x01-0x1F that games use for formatting.
 */
function isGameTextCodePoint(cp: number): boolean {
  if (cp === 0) return false;
  // Allow all control codes 0x01-0x1F (game formatting)
  if (cp >= 0x01 && cp <= 0x1f) return true;
  // Then same as printable
  return isPrintableCodePoint(cp);
}

/**
 * Scan a buffer for UTF-32-LE encoded strings.
 * Uses a tolerant approach: allows game control codes within strings,
 * only splits on null terminators or truly invalid values.
 */
export function scanUtf32LEStrings(
  data: Uint8Array,
  startOffset = 0,
  minLength = 2,
): Utf32String[] {
  const results: Utf32String[] = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const end = data.length - 3;

  let i = startOffset;
  // Align to 4 bytes
  i = (i + 3) & ~3;

  while (i < end) {
    const cp = view.getUint32(i, true);

    if (!isPrintableCodePoint(cp)) {
      i += 4;
      continue;
    }

    // Start of a potential string
    const stringStart = i;
    const codePoints: number[] = [];
    let nonPrintableRun = 0;

    while (i < end) {
      const c = view.getUint32(i, true);
      if (c === 0) {
        // Null terminator — clean end
        i += 4;
        break;
      }
      if (isGameTextCodePoint(c)) {
        // Game control code — keep it but don't add to visible text
        if (c < 0x20) {
          nonPrintableRun++;
          // If too many consecutive control codes, probably not real text
          if (nonPrintableRun > 3) {
            break;
          }
          i += 4;
          continue;
        }
        nonPrintableRun = 0;
        codePoints.push(c);
        i += 4;
      } else {
        // Truly invalid — check if it's just a small gap (1-2 bad values)
        // before more text. Games sometimes have padding bytes.
        if (i + 8 < end) {
          const next1 = view.getUint32(i + 4, true);
          const next2 = view.getUint32(i + 8, true);
          if (isPrintableCodePoint(next1) || isPrintableCodePoint(next2)) {
            // Skip this one bad value
            i += 4;
            continue;
          }
        }
        break;
      }
    }

    if (codePoints.length >= minLength) {
      const text = String.fromCodePoint(...codePoints);
      results.push({
        offset: stringStart,
        text,
        codeUnits: codePoints.length,
      });
    }
  }

  return results;
}

/**
 * Quick check: does this buffer likely contain UTF-32-LE text data?
 */
export function looksLikeUtf32LE(data: Uint8Array, sampleStart = 0x4000, sampleSize = 256): boolean {
  if (data.length < sampleStart + sampleSize) return false;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let hits = 0;
  const end = Math.min(sampleStart + sampleSize, data.length - 3);

  for (let i = sampleStart; i < end; i += 4) {
    const cp = view.getUint32(i, true);
    if (cp >= 0x20 && cp <= 0x7e) hits++;
    if (cp === 0) hits++;
  }

  const total = Math.floor(sampleSize / 4);
  return hits / total > 0.4;
}

/**
 * Full extraction pipeline for LM2 HD .data files.
 * Always scans the ENTIRE file from offset 0 to capture all strings.
 */
export function extractUtf32LEStrings(
  data: Uint8Array,
  log?: (msg: string) => void,
): Utf32String[] | null {
  log?.(`🔍 UTF-32-LE: مسح شامل للملف (${(data.length / 1024).toFixed(0)} KB)...`);

  // Always do a full scan from offset 0 with minimum length 1
  // to catch even short game strings
  const allStrings = scanUtf32LEStrings(data, 0, 1);

  if (allStrings.length > 0) {
    // Filter: keep strings that are likely real game text
    // Must have a significant ratio of ASCII printable characters
    // Binary garbage decoded as UTF-32 produces mostly CJK/symbol noise
    const meaningful = allStrings.filter(s => {
      const trimmed = s.text.trim();
      if (trimmed.length < 2) return false;

      // Count ASCII printable chars (letters, digits, common punctuation, spaces)
      let asciiPrintable = 0;
      let arabicChars = 0;
      let cjkOrExotic = 0;
      for (const ch of trimmed) {
        const cp = ch.codePointAt(0)!;
        if (cp >= 0x20 && cp <= 0x7E) asciiPrintable++;
        else if ((cp >= 0x0600 && cp <= 0x06FF) || (cp >= 0xFB50 && cp <= 0xFDFF) || (cp >= 0xFE70 && cp <= 0xFEFF)) arabicChars++;
        else if (cp >= 0x2E80 && cp <= 0x9FFF) cjkOrExotic++;
        else if (cp >= 0xAC00 && cp <= 0xD7AF) cjkOrExotic++;
      }

      const totalChars = trimmed.length;
      const readableRatio = (asciiPrintable + arabicChars) / totalChars;

      // Real game text (English/Arabic): at least 60% ASCII+Arabic
      // If mostly CJK/exotic symbols, it's binary garbage
      if (readableRatio < 0.5) return false;

      // Must contain at least some actual letters (not just punctuation/symbols)
      if (!/[a-zA-Z\u0600-\u06FF]/.test(trimmed)) return false;

      // If CJK chars dominate, reject (binary data decoded as CJK)
      if (cjkOrExotic > asciiPrintable + arabicChars) return false;

      return true;
    });

    log?.(`✅ UTF-32-LE: ${allStrings.length} نص خام → ${meaningful.length} نص حقيقي (تمت فلترة ${allStrings.length - meaningful.length} قيمة ثنائية)`);

    if (meaningful.length > 0) {
      return meaningful;
    }

    // Fallback: only strings with high ASCII ratio and length >= 3
    const fallback = allStrings.filter(s => {
      if (s.codeUnits < 3) return false;
      let ascii = 0;
      for (const ch of s.text) {
        const cp = ch.codePointAt(0)!;
        if (cp >= 0x20 && cp <= 0x7E) ascii++;
      }
      return ascii / s.text.length > 0.6;
    });
    if (fallback.length > 0) {
      log?.(`✅ UTF-32-LE: إعادة بـ ${fallback.length} نص (فلترة ASCII فقط)`);
      return fallback;
    }
  }

  log?.(`❌ UTF-32-LE: لم يتم العثور على نصوص`);
  return null;
}
