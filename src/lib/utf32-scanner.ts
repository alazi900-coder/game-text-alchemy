/**
 * UTF-32-LE brute-force string scanner for Luigi's Mansion 2 HD.
 *
 * In the HD remaster, text data inside .data files is stored as raw UTF-32-LE
 * (4 bytes per character) without NLOC headers. This scanner finds readable
 * strings by looking for the XX 00 00 00 pattern (ASCII range) or valid
 * Unicode code-points encoded as little-endian 32-bit values, terminated by
 * 00 00 00 00 (null in UTF-32).
 *
 * Reference: advice from reverse-engineering community (Manus).
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
 * Minimum number of characters for a string to be considered "real"
 * (filters out noise / alignment padding).
 */
const MIN_STRING_LENGTH = 2;

/**
 * Check whether a 32-bit value is a printable / meaningful Unicode code-point.
 * Accepts Latin, Arabic, CJK, punctuation, digits, common symbols, etc.
 * Rejects control chars (except \n \r \t) and surrogates.
 */
function isPrintableCodePoint(cp: number): boolean {
  if (cp === 0) return false; // null terminator — not part of string
  // Allow common whitespace
  if (cp === 0x09 || cp === 0x0a || cp === 0x0d) return true;
  // Reject other C0/C1 control characters
  if (cp < 0x20) return false;
  if (cp >= 0x7f && cp <= 0x9f) return false;
  // Reject surrogates
  if (cp >= 0xd800 && cp <= 0xdfff) return false;
  // Reject beyond valid Unicode
  if (cp > 0x10ffff) return false;
  return true;
}

/**
 * Scan a buffer for UTF-32-LE encoded strings.
 *
 * @param data  Raw bytes to scan
 * @param startOffset  Byte offset to begin scanning (default 0)
 * @param minLength  Minimum string length in characters (default 2)
 * @returns Array of discovered strings with their offsets
 */
export function scanUtf32LEStrings(
  data: Uint8Array,
  startOffset = 0,
  minLength = MIN_STRING_LENGTH,
): Utf32String[] {
  const results: Utf32String[] = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const end = data.length - 3; // need at least 4 bytes to read a u32

  let i = startOffset;
  // Align to 4 bytes
  i = (i + 3) & ~3;

  while (i < end) {
    const cp = view.getUint32(i, true); // little-endian

    if (!isPrintableCodePoint(cp)) {
      i += 4;
      continue;
    }

    // Start of a potential string
    const stringStart = i;
    const codePoints: number[] = [];

    while (i < end) {
      const c = view.getUint32(i, true);
      if (c === 0) {
        // Null terminator
        i += 4;
        break;
      }
      if (!isPrintableCodePoint(c)) {
        break; // not a clean terminator, string is cut short
      }
      codePoints.push(c);
      i += 4;
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
 * Looks for a cluster of XX 00 00 00 patterns in the first portion.
 */
export function looksLikeUtf32LE(data: Uint8Array, sampleStart = 0x4000, sampleSize = 256): boolean {
  if (data.length < sampleStart + sampleSize) return false;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let hits = 0;
  const end = Math.min(sampleStart + sampleSize, data.length - 3);

  for (let i = sampleStart; i < end; i += 4) {
    const cp = view.getUint32(i, true);
    if (cp >= 0x20 && cp <= 0x7e) hits++; // printable ASCII as UTF-32-LE
    if (cp === 0) hits++; // null terminators are expected
  }

  // If >40% of sampled u32 values are ASCII/null, likely UTF-32-LE text
  const total = Math.floor(sampleSize / 4);
  return hits / total > 0.4;
}

/**
 * Full extraction pipeline for LM2 HD .data files.
 * Scans the entire file for UTF-32-LE strings starting from common offsets.
 *
 * @returns Array of strings found, or null if the file doesn't look like UTF-32-LE text
 */
export function extractUtf32LEStrings(
  data: Uint8Array,
  log?: (msg: string) => void,
): Utf32String[] | null {
  // Try known offset first (0x43fc from Manus's analysis)
  const knownOffsets = [0x43fc, 0x4000, 0x3000, 0x2000, 0x1000, 0x0800, 0x0400, 0x0100, 0x0000];

  for (const off of knownOffsets) {
    if (off + 16 > data.length) continue;

    // Quick check: are there readable UTF-32-LE chars around this offset?
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let readableCount = 0;
    const checkEnd = Math.min(off + 64, data.length - 3);

    for (let j = off; j < checkEnd; j += 4) {
      const cp = view.getUint32(j, true);
      if (isPrintableCodePoint(cp) || cp === 0) readableCount++;
    }

    const checkTotal = Math.floor((checkEnd - off) / 4);
    if (checkTotal > 0 && readableCount / checkTotal > 0.5) {
      log?.(`🔍 UTF-32-LE: بدء المسح من offset 0x${off.toString(16)}`);
      const strings = scanUtf32LEStrings(data, off, 2);

      if (strings.length > 0) {
        log?.(`✅ UTF-32-LE: تم العثور على ${strings.length} نص بدءاً من 0x${off.toString(16)}`);
        return strings;
      }
    }
  }

  // Fallback: full scan from beginning
  log?.(`🔍 UTF-32-LE: مسح شامل من بداية الملف...`);
  const allStrings = scanUtf32LEStrings(data, 0, 3);

  if (allStrings.length > 10) {
    log?.(`✅ UTF-32-LE: تم العثور على ${allStrings.length} نص بالمسح الشامل`);
    return allStrings;
  }

  return null;
}
