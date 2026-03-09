/**
 * MSBT (MsgStdBn) binary parser and writer.
 * Supports Nintendo Switch (little-endian, UTF-16LE) MSBT files
 * used by Animal Crossing: New Horizons, Fire Emblem Engage, Zelda, etc.
 */

export interface MsbtEntry {
  label: string;
  text: string;
  /** Raw UTF-16LE bytes of the text (includes control tags) */
  rawBytes: Uint8Array;
  /** Attribute bytes (game-specific, preserved for roundtrip) */
  attribute?: Uint8Array;
}

export interface MsbtFile {
  /** Original byte order: 0xFEFF = big, 0xFFFE = little */
  byteOrder: number;
  encoding: number;
  version: number;
  sectionCount: number;
  fileSize: number;
  /** Parsed message entries */
  entries: MsbtEntry[];
  /** Raw file buffer for roundtrip rebuild */
  rawBuffer: ArrayBuffer;
  /** Whether ATR1 section exists */
  hasAttributes: boolean;
}

// ─── Helpers ───

function readU16(dv: DataView, offset: number, le: boolean): number {
  return dv.getUint16(offset, le);
}

function readU32(dv: DataView, offset: number, le: boolean): number {
  return dv.getUint32(offset, le);
}

function writeU16(dv: DataView, offset: number, value: number, le: boolean) {
  dv.setUint16(offset, value, le);
}

function writeU32(dv: DataView, offset: number, value: number, le: boolean) {
  dv.setUint32(offset, value, le);
}

/** Known MSBT control tag descriptions (English labels for consistency across all games) */
const MSBT_TAG_NAMES: Record<string, string> = {
  '0.0': 'Ruby',
  '0.1': 'Size',
  '0.2': 'Color',
  '0.3': 'PageBreak',
  '0.4': 'Delay',
  '1.0': 'Variable',
  '1.1': 'Number',
  '1.2': 'String',
  '2.0': 'Condition',
  '2.1': 'Choice',
  '3.0': 'Sound',
  '4.0': 'Animation',
};

function getMsbtTagLabel(group: number, type: number): string {
  return MSBT_TAG_NAMES[`${group}.${type}`] || `G${group}T${type}`;
}

/** Decode UTF-16 string from Uint8Array, stopping at null terminator.
 *  Control tags (0x0E/0x0F) are converted to [MSBT:label] placeholders. */
function decodeUtf16(bytes: Uint8Array, le: boolean): string {
  const chars: string[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = le ? (bytes[i] | (bytes[i + 1] << 8)) : ((bytes[i] << 8) | bytes[i + 1]);
    if (code === 0) break;
    if (code === 0x0E) {
      let group = 0, type = 0, paramSize = 0;
      if (i + 3 < bytes.length) { i += 2; group = le ? (bytes[i] | (bytes[i + 1] << 8)) : ((bytes[i] << 8) | bytes[i + 1]); }
      if (i + 3 < bytes.length) { i += 2; type = le ? (bytes[i] | (bytes[i + 1] << 8)) : ((bytes[i] << 8) | bytes[i + 1]); }
      if (i + 3 < bytes.length) { i += 2; paramSize = le ? (bytes[i] | (bytes[i + 1] << 8)) : ((bytes[i] << 8) | bytes[i + 1]); i += paramSize; }
      chars.push(`[MSBT:${getMsbtTagLabel(group, type)}]`);
      continue;
    }
    if (code === 0x0F) {
      let group = 0, type = 0;
      if (i + 3 < bytes.length) { i += 2; group = le ? (bytes[i] | (bytes[i + 1] << 8)) : ((bytes[i] << 8) | bytes[i + 1]); }
      if (i + 3 < bytes.length) { i += 2; type = le ? (bytes[i] | (bytes[i + 1] << 8)) : ((bytes[i] << 8) | bytes[i + 1]); }
      chars.push(`[/MSBT:${getMsbtTagLabel(group, type)}]`);
      continue;
    }
    if (code >= 0xD800 && code <= 0xDBFF) {
      if (i + 3 < bytes.length) {
        const low = le ? (bytes[i + 2] | (bytes[i + 3] << 8)) : ((bytes[i + 2] << 8) | bytes[i + 3]);
        chars.push(String.fromCharCode(code, low));
        i += 2;
        continue;
      }
    }
    chars.push(String.fromCharCode(code));
  }
  return chars.join('');
}

/** Encode string to UTF-16LE with null terminator */
function encodeUtf16(str: string, le: boolean): Uint8Array {
  // Each char = 2 bytes + null terminator
  const buf = new Uint8Array((str.length + 1) * 2);
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (le) {
      buf[i * 2] = code & 0xFF;
      buf[i * 2 + 1] = (code >> 8) & 0xFF;
    } else {
      buf[i * 2] = (code >> 8) & 0xFF;
      buf[i * 2 + 1] = code & 0xFF;
    }
  }
  // Null terminator already 0
  return buf;
}

/** Align offset to 16-byte boundary */
function align16(offset: number): number {
  return (offset + 15) & ~15;
}

// ─── Parser ───

export function parseMsbtFile(data: Uint8Array): MsbtFile {
  if (data.length < 0x20) throw new Error("File too small for MSBT header");

  const magic = String.fromCharCode(data[0], data[1], data[2], data[3], data[4], data[5], data[6], data[7]);
  if (magic !== "MsgStdBn") throw new Error(`Invalid MSBT magic: ${magic}`);

  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const bom = dv.getUint16(0x08, false); // BOM is always read big-endian
  const le = bom === 0xFFFE;

  const encoding = data[0x0C]; // 0=UTF-8, 1=UTF-16
  const version = data[0x0D];
  const sectionCount = readU16(dv, 0x0E, le);
  const fileSize = readU32(dv, 0x12, le);

  // Parse sections
  let offset = 0x20; // After header
  let labels: string[] = [];
  let labelIndices: number[] = []; // maps label order → TXT2 index
  let texts: { text: string; rawBytes: Uint8Array }[] = [];
  let attributes: Uint8Array[] = [];
  let hasAttributes = false;

  for (let s = 0; s < sectionCount && offset < data.length; s++) {
    if (offset + 0x10 > data.length) break;
    const secMagic = String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
    const secSize = readU32(dv, offset + 0x04, le);
    const secDataStart = offset + 0x10;

    if (secMagic === "LBL1") {
      // Parse label groups
      const groupCount = readU32(dv, secDataStart, le);
      const parsedLabels: { label: string; index: number }[] = [];
      
      for (let g = 0; g < groupCount; g++) {
        const groupOffset = secDataStart + 4 + g * 8;
        const labelCount = readU32(dv, groupOffset, le);
        let lblOffset = secDataStart + readU32(dv, groupOffset + 4, le);

        for (let l = 0; l < labelCount; l++) {
          const nameLen = data[lblOffset];
          lblOffset++;
          let name = "";
          for (let c = 0; c < nameLen; c++) {
            name += String.fromCharCode(data[lblOffset + c]);
          }
          lblOffset += nameLen;
          const idx = readU32(dv, lblOffset, le);
          lblOffset += 4;
          parsedLabels.push({ label: name, index: idx });
        }
      }

      // Sort by index to match TXT2 order
      parsedLabels.sort((a, b) => a.index - b.index);
      labels = parsedLabels.map(p => p.label);
      labelIndices = parsedLabels.map(p => p.index);
    } else if (secMagic === "TXT2") {
      const entryCount = readU32(dv, secDataStart, le);
      for (let i = 0; i < entryCount; i++) {
        const strOffset = secDataStart + readU32(dv, secDataStart + 4 + i * 4, le);
        const nextOffset = i + 1 < entryCount
          ? secDataStart + readU32(dv, secDataStart + 4 + (i + 1) * 4, le)
          : secDataStart + secSize;
        
        const rawBytes = data.slice(strOffset, nextOffset);
        const text = decodeUtf16(rawBytes, le);
        texts.push({ text, rawBytes });
      }
    } else if (secMagic === "ATR1") {
      hasAttributes = true;
      const entryCount = readU32(dv, secDataStart, le);
      const attrSize = readU32(dv, secDataStart + 4, le);
      for (let i = 0; i < entryCount; i++) {
        const attrStart = secDataStart + 8 + i * attrSize;
        attributes.push(data.slice(attrStart, attrStart + attrSize));
      }
    }
    // Skip to next section (aligned to 16 bytes)
    offset = align16(secDataStart + secSize);
  }

  // Build entries: match labels to texts by index
  const entries: MsbtEntry[] = [];
  if (labels.length > 0 && texts.length > 0) {
    for (let i = 0; i < labels.length; i++) {
      const txtIdx = labelIndices[i];
      if (txtIdx < texts.length) {
        entries.push({
          label: labels[i],
          text: texts[txtIdx].text,
          rawBytes: texts[txtIdx].rawBytes,
          attribute: attributes[txtIdx],
        });
      }
    }
  } else {
    // No labels — use index-based entries
    for (let i = 0; i < texts.length; i++) {
      entries.push({
        label: `entry_${i}`,
        text: texts[i].text,
        rawBytes: texts[i].rawBytes,
        attribute: attributes[i],
      });
    }
  }

  return {
    byteOrder: bom,
    encoding,
    version,
    sectionCount,
    fileSize,
    entries,
    rawBuffer: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
    hasAttributes,
  };
}

// ─── Writer ───

/** 
 * Rebuild MSBT file with new text strings while preserving structure.
 * translations: map of label → new Arabic text
 */
export function rebuildMsbt(
  original: MsbtFile,
  translations: Record<string, string>,
): Uint8Array {
  const le = original.byteOrder === 0xFFFE;
  const origData = new Uint8Array(original.rawBuffer);
  const origDv = new DataView(original.rawBuffer);

  // Re-encode all texts with translations applied
  const newTexts: Uint8Array[] = [];
  for (const entry of original.entries) {
    const translated = translations[entry.label];
    if (translated && translated.trim()) {
      newTexts.push(encodeUtf16(translated, le));
    } else {
      // Keep original raw bytes
      newTexts.push(entry.rawBytes);
    }
  }

  // Rebuild TXT2 section
  const entryCount = newTexts.length;
  const offsetTableSize = 4 + entryCount * 4; // count + offsets
  let totalStringsSize = 0;
  for (const t of newTexts) totalStringsSize += t.length;
  const txt2DataSize = offsetTableSize + totalStringsSize;

  // Build offset table
  const txt2Data = new Uint8Array(txt2DataSize);
  const txt2Dv = new DataView(txt2Data.buffer);
  writeU32(txt2Dv, 0, entryCount, le);
  let strPos = offsetTableSize;
  for (let i = 0; i < entryCount; i++) {
    writeU32(txt2Dv, 4 + i * 4, strPos, le);
    txt2Data.set(newTexts[i], strPos);
    strPos += newTexts[i].length;
  }

  // Now rebuild the entire file: copy all sections, replacing TXT2
  const sections: { magic: string; data: Uint8Array }[] = [];
  let offset = 0x20;
  for (let s = 0; s < original.sectionCount && offset < origData.length; s++) {
    if (offset + 0x10 > origData.length) break;
    const secMagic = String.fromCharCode(origData[offset], origData[offset + 1], origData[offset + 2], origData[offset + 3]);
    const secSize = readU32(origDv, offset + 0x04, le);
    const secDataStart = offset + 0x10;

    if (secMagic === "TXT2") {
      sections.push({ magic: "TXT2", data: txt2Data });
    } else {
      sections.push({ magic: secMagic, data: origData.slice(secDataStart, secDataStart + secSize) });
    }
    offset = align16(secDataStart + secSize);
  }

  // Calculate total file size
  let totalSize = 0x20; // header
  for (const sec of sections) {
    totalSize = align16(totalSize + 0x10 + sec.data.length);
  }

  const result = new Uint8Array(totalSize);
  const resultDv = new DataView(result.buffer);

  // Copy header
  result.set(origData.slice(0, 0x20));
  // Update file size
  writeU32(resultDv, 0x12, totalSize, le);

  // Write sections
  let writeOffset = 0x20;
  for (const sec of sections) {
    // Section header: magic(4) + size(4) + padding(8)
    for (let c = 0; c < 4; c++) result[writeOffset + c] = sec.magic.charCodeAt(c);
    writeU32(resultDv, writeOffset + 4, sec.data.length, le);
    // 8 bytes padding (zeros)
    result.set(sec.data, writeOffset + 0x10);
    writeOffset = align16(writeOffset + 0x10 + sec.data.length);
  }

  return result;
}

// ─── Extraction helpers ───

export interface MsbtExtractedEntry {
  msbtFile: string;
  index: number;
  label: string;
  original: string;
  type: "msbt";
}

/** Extract all text entries from an MSBT file for the editor */
export function extractMsbtStrings(msbt: MsbtFile, filename: string): MsbtExtractedEntry[] {
  return msbt.entries.map((entry, i) => ({
    msbtFile: `msbt:${filename}:${entry.label}`,
    index: i,
    label: entry.label,
    original: entry.text,
    type: "msbt" as const,
  }));
}
