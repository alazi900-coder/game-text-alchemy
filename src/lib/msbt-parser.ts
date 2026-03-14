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

function readCodeUnit(bytes: Uint8Array, offset: number, le: boolean): number {
  return le ? (bytes[offset] | (bytes[offset + 1] << 8)) : ((bytes[offset] << 8) | bytes[offset + 1]);
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
    const code = readCodeUnit(bytes, i, le);
    if (code === 0) break;

    if (code === 0x0E) {
      let p = i + 2;
      if (p + 5 >= bytes.length) {
        chars.push("[MSBT:G0T0]");
        break;
      }

      const group = readCodeUnit(bytes, p, le); p += 2;
      const type = readCodeUnit(bytes, p, le); p += 2;
      const paramSize = readCodeUnit(bytes, p, le); p += 2;

      p += paramSize;
      if ((p & 1) !== 0) p += 1; // keep UTF-16 alignment when param size is odd
      if (p > bytes.length) p = bytes.length - (bytes.length % 2);

      chars.push(`[MSBT:${getMsbtTagLabel(group, type)}]`);
      i = p - 2;
      continue;
    }

    if (code === 0x0F) {
      let p = i + 2;
      if (p + 3 >= bytes.length) {
        chars.push("[/MSBT:G0T0]");
        break;
      }

      const group = readCodeUnit(bytes, p, le); p += 2;
      const type = readCodeUnit(bytes, p, le); p += 2;

      chars.push(`[/MSBT:${getMsbtTagLabel(group, type)}]`);
      i = p - 2;
      continue;
    }

    if (code >= 0xD800 && code <= 0xDBFF) {
      if (i + 3 < bytes.length) {
        const low = readCodeUnit(bytes, i + 2, le);
        chars.push(String.fromCharCode(code, low));
        i += 2;
        continue;
      }
    }

    chars.push(String.fromCharCode(code));
  }

  // Normalize Presentation Forms (U+FB50–U+FDFF, U+FE70–U+FEFF) to standard Arabic
  const raw = chars.join("");
  return raw.normalize("NFKC");
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

/**
 * Extract binary tag chunks from original rawBytes.
 * Each tag starts with 0x0E (open) or 0x0F (close) as a UTF-16 code unit.
 * Returns array of Uint8Array chunks in order of appearance.
 */
function extractBinaryTags(rawBytes: Uint8Array, le: boolean): Uint8Array[] {
  const tags: Uint8Array[] = [];

  for (let i = 0; i + 1 < rawBytes.length; i += 2) {
    const code = readCodeUnit(rawBytes, i, le);
    if (code === 0) break;

    if (code === 0x0E) {
      let p = i + 2;
      if (p + 5 >= rawBytes.length) break;

      p += 2; // group
      p += 2; // type
      const paramSize = readCodeUnit(rawBytes, p, le); p += 2;
      p += paramSize;
      if ((p & 1) !== 0) p += 1; // keep UTF-16 alignment when param size is odd
      if (p > rawBytes.length) p = rawBytes.length;

      tags.push(rawBytes.slice(i, p));
      i = p - 2;
      continue;
    }

    if (code === 0x0F) {
      const end = i + 6;
      if (end > rawBytes.length) break;
      tags.push(rawBytes.slice(i, end));
      i = end - 2;
      continue;
    }

    if (code >= 0xD800 && code <= 0xDBFF) {
      i += 2; // skip surrogate pair low
    }
  }

  return tags;
}

/**
 * Encode translated string to UTF-16 bytes, restoring binary MSBT tags
 * from original rawBytes wherever [MSBT:...] or [/MSBT:...] placeholders appear.
 */
function encodeUtf16WithTags(translated: string, originalRawBytes: Uint8Array, le: boolean): Uint8Array {
  const binaryTags = extractBinaryTags(originalRawBytes, le);
  let tagIdx = 0;

  // Regex to match [MSBT:...] and [/MSBT:...] placeholders
  const tagPlaceholder = /\[\/?MSBT:[^\]]*\]/g;

  // Split translated text by tag placeholders
  const parts: (string | 'TAG')[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = tagPlaceholder.exec(translated)) !== null) {
    if (m.index > lastIdx) parts.push(translated.slice(lastIdx, m.index));
    parts.push('TAG');
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < translated.length) parts.push(translated.slice(lastIdx));

  // Build output: encode text parts as UTF-16, insert binary tags for TAG markers
  const chunks: Uint8Array[] = [];
  for (const part of parts) {
    if (part === 'TAG') {
      if (tagIdx < binaryTags.length) {
        chunks.push(binaryTags[tagIdx++]);
      }
    } else {
      // Encode text as UTF-16 (no null terminator)
      for (let ci = 0; ci < part.length; ci++) {
        const code = part.charCodeAt(ci);
        const b = new Uint8Array(2);
        if (le) { b[0] = code & 0xFF; b[1] = (code >> 8) & 0xFF; }
        else { b[0] = (code >> 8) & 0xFF; b[1] = code & 0xFF; }
        chunks.push(b);
      }
    }
  }
  // Null terminator
  chunks.push(new Uint8Array(2));

  // Concatenate
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) { result.set(c, offset); offset += c.length; }
  return result;
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
      // Use tag-aware encoding to restore binary MSBT tags from [MSBT:...] placeholders
      newTexts.push(encodeUtf16WithTags(translated, entry.rawBytes, le));
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

// ─── Build MSBT from scratch ───

/**
 * Nintendo LBL1 hash function.
 * hash = (hash * 0x492 + charCode) for each character, then bucket = hash % numSlots
 */
function msbtLabelHash(label: string, numSlots: number): number {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = ((hash * 0x492) + label.charCodeAt(i)) >>> 0;
  }
  return hash % numSlots;
}

export interface CobaltEntry {
  label: string;
  text: string;
}

/**
 * Build a complete MSBT binary file from scratch given label/text pairs.
 * Creates LBL1 + ATR1 + TXT2 sections with proper Nintendo MSBT format.
 * Used for Cobalt mod workflow where no original MSBT template exists.
 */
export function buildMsbtFromEntries(entries: CobaltEntry[]): Uint8Array {
  const le = true; // Nintendo Switch = little-endian
  const numSlots = 101; // Standard Nintendo hash table size
  const sectionCount = 3; // LBL1, ATR1, TXT2

  // ── Encode all texts as UTF-16LE with null terminators ──
  const encodedTexts: Uint8Array[] = entries.map(e => encodeUtf16(e.text, le));

  // ── Build TXT2 section data ──
  const txt2OffsetTableSize = 4 + entries.length * 4;
  let txt2StringsSize = 0;
  for (const t of encodedTexts) txt2StringsSize += t.length;
  const txt2DataSize = txt2OffsetTableSize + txt2StringsSize;
  const txt2Data = new Uint8Array(txt2DataSize);
  const txt2Dv = new DataView(txt2Data.buffer);
  writeU32(txt2Dv, 0, entries.length, le);
  let strPos = txt2OffsetTableSize;
  for (let i = 0; i < entries.length; i++) {
    writeU32(txt2Dv, 4 + i * 4, strPos, le);
    txt2Data.set(encodedTexts[i], strPos);
    strPos += encodedTexts[i].length;
  }

  // ── Build ATR1 section data (minimal: 4 bytes per entry, all zeros) ──
  const attrSize = 4;
  const atr1DataSize = 8 + entries.length * attrSize;
  const atr1Data = new Uint8Array(atr1DataSize);
  const atr1Dv = new DataView(atr1Data.buffer);
  writeU32(atr1Dv, 0, entries.length, le);
  writeU32(atr1Dv, 4, attrSize, le);

  // ── Build LBL1 section data ──
  // Hash table: numSlots groups, each with (count: u32, offset: u32)
  // Then label entries grouped by hash bucket
  const buckets: { label: string; index: number }[][] = Array.from({ length: numSlots }, () => []);
  for (let i = 0; i < entries.length; i++) {
    const slot = msbtLabelHash(entries[i].label, numSlots);
    buckets[slot].push({ label: entries[i].label, index: i });
  }

  // Calculate label data area
  const hashTableSize = 4 + numSlots * 8; // count + slots*(labelCount + offset)
  // Label entries: for each label: 1 byte len + N bytes name + 4 bytes index
  let labelDataSize = 0;
  for (const bucket of buckets) {
    for (const item of bucket) {
      labelDataSize += 1 + item.label.length + 4;
    }
  }
  const lbl1DataSize = hashTableSize + labelDataSize;
  const lbl1Data = new Uint8Array(lbl1DataSize);
  const lbl1Dv = new DataView(lbl1Data.buffer);

  writeU32(lbl1Dv, 0, numSlots, le);
  let labelWritePos = hashTableSize;
  for (let s = 0; s < numSlots; s++) {
    const bucket = buckets[s];
    writeU32(lbl1Dv, 4 + s * 8, bucket.length, le);
    writeU32(lbl1Dv, 4 + s * 8 + 4, labelWritePos, le);
    for (const item of bucket) {
      lbl1Data[labelWritePos] = item.label.length;
      labelWritePos++;
      for (let c = 0; c < item.label.length; c++) {
        lbl1Data[labelWritePos + c] = item.label.charCodeAt(c);
      }
      labelWritePos += item.label.length;
      writeU32(lbl1Dv, labelWritePos, item.index, le);
      labelWritePos += 4;
    }
  }

  // ── Assemble full file ──
  const sections = [
    { magic: "LBL1", data: lbl1Data },
    { magic: "ATR1", data: atr1Data },
    { magic: "TXT2", data: txt2Data },
  ];

  let totalSize = 0x20; // header
  for (const sec of sections) {
    totalSize = align16(totalSize + 0x10 + sec.data.length);
  }

  const result = new Uint8Array(totalSize);
  const resultDv = new DataView(result.buffer);

  // Header: MsgStdBn
  const magic = "MsgStdBn";
  for (let i = 0; i < 8; i++) result[i] = magic.charCodeAt(i);
  // BOM: 0xFFFE (little-endian)
  result[0x08] = 0xFF;
  result[0x09] = 0xFE;
  // Reserved
  result[0x0A] = 0x00;
  result[0x0B] = 0x00;
  // Encoding: 1 = UTF-16
  result[0x0C] = 0x01;
  // Version: 3
  result[0x0D] = 0x03;
  // Section count
  writeU16(resultDv, 0x0E, sectionCount, le);
  // Reserved
  writeU16(resultDv, 0x10, 0, le);
  // File size
  writeU32(resultDv, 0x12, totalSize, le);
  // Reserved padding (10 bytes at 0x16..0x1F)

  let writeOffset = 0x20;
  for (const sec of sections) {
    for (let c = 0; c < 4; c++) result[writeOffset + c] = sec.magic.charCodeAt(c);
    writeU32(resultDv, writeOffset + 4, sec.data.length, le);
    // 8 bytes padding (zeros) at writeOffset+8..writeOffset+0xF
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
