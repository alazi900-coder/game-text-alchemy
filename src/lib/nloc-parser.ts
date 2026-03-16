/**
 * NLOC (Next Level LOCalization) parser and writer.
 * Used by Luigi's Mansion: Dark Moon / Luigi's Mansion 2 HD.
 *
 * Format:
 *   Header (0x14 bytes):
 *     [0x00] magic: "NLOC" (4 bytes)
 *     [0x04] version: u32 (always 1)
 *     [0x08] langId: u32
 *     [0x0C] stringCount: u32
 *     [0x10] endianMarker: u32 (0 = LE, 1 = BE)
 *   String table (stringCount * 8 bytes):
 *     [+0] messageId: u32  (hash of the key name)
 *     [+4] textOffset: u32 (in UTF-16 code units from start of text blob)
 *   Text blob: UTF-16 encoded null-terminated strings
 *
 * Reference: https://github.com/RoadrunnerWMC/NLOC-Tool
 */

export interface NlocMessage {
  id: number;       // Hash ID
  text: string;     // Decoded UTF-16 string
  idHex: string;    // Hex representation for display
}

export interface NlocFile {
  langId: number;
  messages: NlocMessage[];
  endian: "little" | "big";
  /** Raw buffer for roundtrip rebuild */
  rawBuffer: ArrayBuffer;
}

/**
 * Parse NLOC binary data.
 */
export function parseNloc(data: Uint8Array): NlocFile {
  if (data.length < 0x14) throw new Error("الملف صغير جداً ليكون NLOC");

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // Check magic "NLOC"
  const magic = String.fromCharCode(data[0], data[1], data[2], data[3]);
  if (magic !== "NLOC") throw new Error(`صيغة غير صالحة: توقعنا NLOC لكن وجدنا "${magic}"`);

  // Detect endianness from version field
  const versionLE = view.getUint32(0x04, true);
  const le = versionLE === 1;

  const readU32 = (off: number) => view.getUint32(off, le);

  const langId = readU32(0x08);
  const strCount = readU32(0x0C);

  const endianName = le ? "le" : "be";

  // Read string table entries (sorted by message ID in file, but we preserve order)
  interface RawEntry {
    id: number;
    textOffset: number; // in UTF-16 code units
  }

  const entries: RawEntry[] = [];
  for (let i = 0; i < strCount; i++) {
    const off = 0x14 + i * 8;
    if (off + 8 > data.length) break;
    entries.push({
      id: readU32(off),
      textOffset: readU32(off + 4),
    });
  }

  // Decode the full text blob as UTF-16
  const textBlobStart = 0x14 + strCount * 8;
  const textBlobBytes = data.subarray(textBlobStart);

  // Decode full blob to string
  const decoder = new TextDecoder(le ? "utf-16le" : "utf-16be");
  const fullStr = decoder.decode(textBlobBytes);

  // Extract individual messages
  const messages: NlocMessage[] = [];
  for (const entry of entries) {
    const start = entry.textOffset;
    let end = fullStr.indexOf("\0", start);
    if (end === -1) end = fullStr.length;
    const text = fullStr.substring(start, end);
    messages.push({
      id: entry.id,
      text,
      idHex: entry.id.toString(16).toUpperCase().padStart(8, "0"),
    });
  }

  return {
    langId,
    messages,
    endian: le ? "little" : "big",
    rawBuffer: (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength),
  };
}

/**
 * Build NLOC binary from messages.
 */
export function buildNloc(file: NlocFile): Uint8Array {
  const le = file.endian === "little";
  const endianName = le ? "le" : "be";
  const encoder = new TextEncoder();

  // Build text blob and track offsets
  const textParts: Uint8Array[] = [];
  const textOffsets: number[] = [];
  let currentOffset = 0; // in UTF-16 code units

  for (const msg of file.messages) {
    textOffsets.push(currentOffset);
    // Encode as UTF-16
    const encoded = encodeUtf16(msg.text, le);
    // Add null terminator (2 bytes)
    const withNull = new Uint8Array(encoded.length + 2);
    withNull.set(encoded);
    textParts.push(withNull);
    currentOffset += msg.text.length + 1; // +1 for null terminator in code units
  }

  // Sort entries by message ID for the header table
  const sorted = file.messages.map((m, i) => ({ msg: m, offset: textOffsets[i], idx: i }));
  sorted.sort((a, b) => (a.msg.id >>> 0) - (b.msg.id >>> 0));

  // Calculate sizes
  const headerSize = 0x14;
  const tableSize = file.messages.length * 8;
  const textBlobSize = textParts.reduce((sum, p) => sum + p.length, 0);
  const totalSize = headerSize + tableSize + textBlobSize;

  const output = new Uint8Array(totalSize);
  const view = new DataView(output.buffer);

  const writeU32 = (off: number, val: number) => view.setUint32(off, val, le);

  // Header
  output[0] = 0x4E; output[1] = 0x4C; output[2] = 0x4F; output[3] = 0x43; // "NLOC"
  writeU32(0x04, 1); // version
  writeU32(0x08, file.langId);
  writeU32(0x0C, file.messages.length);
  writeU32(0x10, le ? 0 : 1); // endian marker

  // String table (sorted by ID)
  for (let i = 0; i < sorted.length; i++) {
    const off = headerSize + i * 8;
    writeU32(off, sorted[i].msg.id);
    writeU32(off + 4, sorted[i].offset);
  }

  // Text blob (in original message order)
  let blobOff = headerSize + tableSize;
  for (const part of textParts) {
    output.set(part, blobOff);
    blobOff += part.length;
  }

  return output;
}

/**
 * Encode a string to UTF-16 bytes (without null terminator).
 */
function encodeUtf16(text: string, le: boolean): Uint8Array {
  const buf = new Uint8Array(text.length * 2);
  const view = new DataView(buf.buffer);
  for (let i = 0; i < text.length; i++) {
    view.setUint16(i * 2, text.charCodeAt(i), le);
  }
  return buf;
}

/**
 * Parse a .dict/.data archive pair to extract NLOC data.
 * The .data file has a 0x10-byte header, then NLOC data.
 */
export function parseNlocFromDictData(dataFileBytes: Uint8Array): NlocFile {
  if (dataFileBytes.length < 0x10) throw new Error("ملف .data صغير جداً");

  const view = new DataView(dataFileBytes.buffer, dataFileBytes.byteOffset, dataFileBytes.byteLength);
  const magic = view.getUint32(0x00, true);

  // .data header: magic 0x12027020, then u32 size, then 8 bytes padding
  if (magic === 0x12027020) {
    const nlocData = dataFileBytes.subarray(0x10);
    return parseNloc(nlocData);
  }

  // Fallback: scan for NLOC magic anywhere in the file
  const result = findAndParseNloc(dataFileBytes);
  if (result) return result;

  throw new Error(`ترويسة .data غير صالحة: 0x${magic.toString(16)} — لم يتم العثور على بيانات NLOC`);
}

/**
 * Scan a buffer for the "NLOC" magic bytes and try to parse from there.
 * Useful when the NLOC data is embedded at an unknown offset.
 */
export function findAndParseNloc(data: Uint8Array): NlocFile | null {
  // Try common offsets first, then scan
  const commonOffsets = [0x00, 0x10, 0x20, 0x30, 0x40, 0x80, 0x100];
  
  for (const off of commonOffsets) {
    if (off + 0x14 <= data.length && 
        data[off] === 0x4E && data[off+1] === 0x4C && data[off+2] === 0x4F && data[off+3] === 0x43) {
      try {
        return parseNloc(data.subarray(off));
      } catch { /* continue scanning */ }
    }
  }

  // Full scan
  for (let i = 0; i < data.length - 0x14; i++) {
    if (data[i] === 0x4E && data[i+1] === 0x4C && data[i+2] === 0x4F && data[i+3] === 0x43) {
      try {
        return parseNloc(data.subarray(i));
      } catch { /* continue scanning */ }
    }
  }

  return null;
}

/**
 * Check if a buffer looks like an NLOC file.
 */
export function isNloc(data: Uint8Array): boolean {
  if (data.length < 8) return false;
  return data[0] === 0x4E && data[1] === 0x4C && data[2] === 0x4F && data[3] === 0x43; // "NLOC"
}

/**
 * Check if a buffer looks like a .dict file (contains NLOC inside .data companion).
 */
export function isDictFile(data: Uint8Array): boolean {
  if (data.length < 8) return false;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const magic = view.getUint32(0x00, true);
  return magic === 0x58_24_F3_A9; // dict magic from NLOC-Tool
}

/**
 * Build a .data file wrapper around NLOC data.
 */
export function buildDictData(nlocData: Uint8Array): Uint8Array {
  const alignedSize = Math.ceil((0x10 + nlocData.length) / 8) * 8;
  const output = new Uint8Array(alignedSize);
  const view = new DataView(output.buffer);

  // Header
  view.setUint32(0x00, 0x12027020, true);
  view.setUint32(0x04, nlocData.length, true);
  view.setUint32(0x08, 0, true);
  view.setUint32(0x0C, 0, true);

  // NLOC data
  output.set(nlocData, 0x10);

  return output;
}
