/**
 * Full NLOC rebuild logic — builds a complete NLOC file from scratch
 * instead of in-place patching. Supports unlimited text length.
 * Ported from the LM2HD standalone tool's buildTextFile().
 */

export interface NlocInfo {
  nlocOffset: number;
  version: number;
  langHash: number;
  count: number;
  flags: number;
  littleEndian: boolean;
  unitBytes: number; // 2 (UTF-16) or 4 (UTF-32)
  tableStart: number;
  textDataStart: number;
  originalStringEnd: number;
  suffixBytes: Uint8Array;
}

export interface NlocTextEntry {
  index: number;
  hash: number;
  offsetUnits: number;
  byteOffset: number;
  original: string;
  translated: string;
}

/**
 * Parse NLOC header from a binary buffer.
 */
export function findNLOCInfo(data: Uint8Array): NlocInfo | null {
  let nlocOffset = -1;
  for (let i = 0; i <= data.length - 4; i++) {
    if (data[i] === 0x4E && data[i + 1] === 0x4C && data[i + 2] === 0x4F && data[i + 3] === 0x43) {
      nlocOffset = i;
      break;
    }
  }
  if (nlocOffset < 0) return null;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = view.getUint32(nlocOffset + 4, true);
  const langHash = view.getUint32(nlocOffset + 8, true);
  const count = view.getUint32(nlocOffset + 12, true);
  const flags = view.getUint32(nlocOffset + 16, true);
  const littleEndian = (flags === 0);
  const unitBytes = version >= 2 ? 4 : 2;
  const tableStart = nlocOffset + 0x14;
  const textDataStart = tableStart + count * 8;

  return {
    nlocOffset,
    version,
    langHash,
    count,
    flags,
    littleEndian,
    unitBytes,
    tableStart,
    textDataStart,
    originalStringEnd: textDataStart,
    suffixBytes: new Uint8Array(),
  };
}

function encodeUTF32String(str: string, littleEndian: boolean): { bytes: Uint8Array; unitCount: number } {
  const codePoints = [...str].map(ch => ch.codePointAt(0)!);
  const bytes = new Uint8Array((codePoints.length + 1) * 4);
  const view = new DataView(bytes.buffer);
  codePoints.forEach((cp, i) => view.setUint32(i * 4, cp, littleEndian));
  view.setUint32(codePoints.length * 4, 0, littleEndian); // null terminator
  return { bytes, unitCount: codePoints.length + 1 };
}

function encodeUTF16String(str: string, littleEndian: boolean): { bytes: Uint8Array; unitCount: number } {
  const units: number[] = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0xFFFF) {
      units.push(cp);
    } else {
      const v = cp - 0x10000;
      units.push(0xD800 + (v >> 10));
      units.push(0xDC00 + (v & 0x3FF));
    }
  }
  units.push(0); // null terminator
  const bytes = new Uint8Array(units.length * 2);
  const view = new DataView(bytes.buffer);
  units.forEach((cu, i) => view.setUint16(i * 2, cu, littleEndian));
  return { bytes, unitCount: units.length };
}

function encodeNLOCString(str: string, unitBytes: number, littleEndian: boolean) {
  return unitBytes === 4
    ? encodeUTF32String(str, littleEndian)
    : encodeUTF16String(str, littleEndian);
}

export interface FullRebuildResult {
  data: Uint8Array;
  stats: {
    totalStrings: number;
    translatedStrings: number;
    totalBytes: number;
  };
}

/**
 * Fully rebuild an NLOC file with translated texts.
 * This creates a new NLOC structure (Header + TOC + Strings) instead of in-place patching.
 */
export function rebuildNlocFull(
  originalData: Uint8Array,
  info: NlocInfo,
  texts: NlocTextEntry[],
): FullRebuildResult {
  const newStrings: { hash: number; offsetUnits: number; bytes: Uint8Array }[] = [];
  let totalUnits = 0;
  let translatedCount = 0;

  for (const t of texts) {
    const text = t.translated || t.original || '';
    if (t.translated) translatedCount++;
    const encoded = encodeNLOCString(text, info.unitBytes, info.littleEndian);
    newStrings.push({
      hash: t.hash >>> 0,
      offsetUnits: totalUnits,
      bytes: encoded.bytes,
    });
    totalUnits += encoded.unitCount;
  }

  // Build NLOC header (0x14 bytes)
  const header = new Uint8Array(0x14);
  const hView = new DataView(header.buffer);
  header.set([0x4E, 0x4C, 0x4F, 0x43], 0); // "NLOC"
  hView.setUint32(4, info.version, true);
  hView.setUint32(8, info.langHash, true);
  hView.setUint32(12, newStrings.length, true);
  hView.setUint32(16, info.flags, true);

  // Build TOC (Table of Contents)
  const toc = new Uint8Array(newStrings.length * 8);
  const tocView = new DataView(toc.buffer);
  newStrings.forEach((entry, i) => {
    tocView.setUint32(i * 8, entry.hash, info.littleEndian);
    tocView.setUint32(i * 8 + 4, entry.offsetUnits, info.littleEndian);
  });

  // Build string data
  const totalStringBytes = newStrings.reduce((sum, s) => sum + s.bytes.length, 0);
  const stringData = new Uint8Array(totalStringBytes);
  let writePos = 0;
  for (const s of newStrings) {
    stringData.set(s.bytes, writePos);
    writePos += s.bytes.length;
  }

  // Assemble new NLOC block
  const newNLOC = new Uint8Array(header.length + toc.length + stringData.length);
  newNLOC.set(header, 0);
  newNLOC.set(toc, header.length);
  newNLOC.set(stringData, header.length + toc.length);

  // Preserve prefix (data before NLOC) and suffix (data after NLOC)
  const prefix = originalData.slice(0, info.nlocOffset);
  const suffix = info.suffixBytes || new Uint8Array();
  const newFileData = new Uint8Array(prefix.length + newNLOC.length + suffix.length);
  newFileData.set(prefix, 0);
  newFileData.set(newNLOC, prefix.length);
  newFileData.set(suffix, prefix.length + newNLOC.length);

  // Update the size field in the file header (offset 4 = file size - 8)
  if (newFileData.length >= 8) {
    const mainView = new DataView(newFileData.buffer);
    mainView.setUint32(4, newFileData.length - 8, true);
  }

  return {
    data: newFileData,
    stats: {
      totalStrings: texts.length,
      translatedStrings: translatedCount,
      totalBytes: newFileData.length,
    },
  };
}
