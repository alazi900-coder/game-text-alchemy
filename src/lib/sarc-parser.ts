/**
 * SARC (SEAD Archive) parser and writer for Nintendo Switch games.
 * Handles .sarc and .sarc.zs (Zstandard-compressed) files.
 *
 * Format reference: https://nintendo-formats.com/libs/sead/sarc.html
 */

export interface SarcEntry {
  name: string;
  data: Uint8Array;
}

export interface SarcArchive {
  entries: SarcEntry[];
  endian: "big" | "little";
}

function readU16(view: DataView, offset: number, le: boolean): number {
  return view.getUint16(offset, le);
}

function readU32(view: DataView, offset: number, le: boolean): number {
  return view.getUint32(offset, le);
}

function writeU16(view: DataView, offset: number, value: number, le: boolean) {
  view.setUint16(offset, value, le);
}

function writeU32(view: DataView, offset: number, value: number, le: boolean) {
  view.setUint32(offset, value, le);
}

function readNullTermString(data: Uint8Array, offset: number): string {
  let end = offset;
  while (end < data.length && data[end] !== 0) end++;
  return new TextDecoder("utf-8").decode(data.subarray(offset, end));
}

/**
 * Calculate SARC filename hash (multiplier = 101).
 */
function calcNameHash(name: string, multiplier: number = 101): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    // Sign-extend byte on Switch
    let c = name.charCodeAt(i);
    if (c > 127) c = c - 256;
    hash = (Math.imul(hash, multiplier) + c) >>> 0;
  }
  return hash;
}

/**
 * Align a value up to alignment boundary.
 */
function alignUp(value: number, alignment: number): number {
  return (value + alignment - 1) & ~(alignment - 1);
}

export function parseSarc(data: Uint8Array): SarcArchive {
  if (data.length < 0x14) throw new Error("الملف صغير جداً ليكون SARC");

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // Check magic "SARC"
  const magic = String.fromCharCode(data[0], data[1], data[2], data[3]);
  if (magic !== "SARC") throw new Error(`صيغة غير صالحة: توقعنا SARC لكن وجدنا "${magic}"`);

  const bom = view.getUint16(0x06, false);
  const le = bom === 0xFFFE; // little endian (Switch)

  const fileSize = readU32(view, 0x08, le);
  const dataOffset = readU32(view, 0x0C, le);

  // SFAT section at offset 0x14
  const sfatOffset = 0x14;
  const sfatMagic = String.fromCharCode(data[sfatOffset], data[sfatOffset + 1], data[sfatOffset + 2], data[sfatOffset + 3]);
  if (sfatMagic !== "SFAT") throw new Error("لم يتم العثور على قسم SFAT");

  const sfatHeaderSize = readU16(view, sfatOffset + 0x04, le);
  const nodeCount = readU16(view, sfatOffset + 0x06, le);

  // FAT entries start at sfatOffset + 0x0C
  const fatStart = sfatOffset + 0x0C;

  interface FatEntry {
    nameHash: number;
    fileAttrs: number;
    dataStart: number;
    dataEnd: number;
  }

  const fatEntries: FatEntry[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const off = fatStart + i * 16;
    fatEntries.push({
      nameHash: readU32(view, off, le),
      fileAttrs: readU32(view, off + 4, le),
      dataStart: readU32(view, off + 8, le),
      dataEnd: readU32(view, off + 12, le),
    });
  }

  // SFNT section follows FAT entries
  const sfntOffset = fatStart + nodeCount * 16;
  const sfntMagic = String.fromCharCode(data[sfntOffset], data[sfntOffset + 1], data[sfntOffset + 2], data[sfntOffset + 3]);
  if (sfntMagic !== "SFNT") throw new Error("لم يتم العثور على قسم SFNT");

  const sfntHeaderSize = readU16(view, sfntOffset + 0x04, le);
  const nameTableStart = sfntOffset + sfntHeaderSize;

  const entries: SarcEntry[] = [];
  for (const fat of fatEntries) {
    const hasName = (fat.fileAttrs >> 24) & 1;
    let name = "";
    if (hasName) {
      const nameOffset = (fat.fileAttrs & 0xFFFF) * 4;
      name = readNullTermString(data, nameTableStart + nameOffset);
    } else {
      name = `0x${fat.nameHash.toString(16).padStart(8, "0")}`;
    }

    const fileData = data.subarray(dataOffset + fat.dataStart, dataOffset + fat.dataEnd);
    entries.push({ name, data: new Uint8Array(fileData) });
  }

  return { entries, endian: le ? "little" : "big" };
}

// Singleton WASM init to prevent race conditions
let zstdReady: Promise<typeof import("@bokuweb/zstd-wasm")> | null = null;

async function getZstd() {
  if (!zstdReady) {
    zstdReady = import("@bokuweb/zstd-wasm").then(async (mod) => {
      await mod.init();
      return mod;
    });
  }
  return zstdReady;
}

/**
 * Decompress a .zs (Zstandard) buffer, then parse as SARC.
 */
export async function parseSarcZs(compressedData: Uint8Array): Promise<SarcArchive> {
  const { decompress } = await getZstd();
  const decompressed = decompress(compressedData);
  return parseSarc(new Uint8Array(decompressed));
}

/**
 * Extract only MSBT files from a SARC archive.
 */
export function extractMsbtFromSarc(archive: SarcArchive): { name: string; data: Uint8Array }[] {
  return archive.entries.filter(e => e.name.toLowerCase().endsWith(".msbt"));
}

/**
 * Build a SARC archive from entries.
 * File data alignment defaults to 0x100 (common for MSBT).
 */
export function buildSarc(entries: SarcEntry[], endian: "big" | "little" = "little", dataAlignment: number = 0x100): Uint8Array {
  const le = endian === "little";
  const hashMultiplier = 101;

  // Sort entries by name hash for proper SFAT ordering
  const sorted = [...entries].sort((a, b) => {
    const ha = calcNameHash(a.name, hashMultiplier);
    const hb = calcNameHash(b.name, hashMultiplier);
    return ha - hb;
  });

  const nodeCount = sorted.length;

  // Build name table
  const encoder = new TextEncoder();
  const nameBytes: Uint8Array[] = [];
  const nameOffsets: number[] = [];
  let nameTableSize = 0;
  for (const entry of sorted) {
    nameOffsets.push(nameTableSize);
    const encoded = encoder.encode(entry.name);
    const paddedLen = alignUp(encoded.length + 1, 4); // null-terminated, aligned to 4
    const padded = new Uint8Array(paddedLen);
    padded.set(encoded);
    nameBytes.push(padded);
    nameTableSize += paddedLen;
  }

  // Calculate section sizes
  const sarcHeaderSize = 0x14;
  const sfatHeaderSize = 0x0C;
  const sfatSize = sfatHeaderSize + nodeCount * 16;
  const sfntHeaderSize = 0x08;
  const sfntSize = sfntHeaderSize + nameTableSize;
  const headerTotalSize = sarcHeaderSize + sfatSize + sfntSize;
  const dataOffset = alignUp(headerTotalSize, dataAlignment);

  // Calculate data section with alignment
  let totalDataSize = 0;
  const dataStarts: number[] = [];
  const dataEnds: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const alignedStart = i === 0 ? 0 : alignUp(totalDataSize, dataAlignment);
    dataStarts.push(alignedStart);
    dataEnds.push(alignedStart + sorted[i].data.length);
    totalDataSize = alignedStart + sorted[i].data.length;
  }

  const totalSize = dataOffset + totalDataSize;
  const output = new Uint8Array(totalSize);
  const view = new DataView(output.buffer);

  // SARC header
  output[0] = 0x53; output[1] = 0x41; output[2] = 0x52; output[3] = 0x43; // "SARC"
  writeU16(view, 0x04, 0x14, le);
  // BOM: write as big-endian always, value depends on endianness
  view.setUint16(0x06, le ? 0xFFFE : 0xFEFF, false);
  writeU32(view, 0x08, totalSize, le);
  writeU32(view, 0x0C, dataOffset, le);
  writeU16(view, 0x10, 0x0100, le); // version
  writeU16(view, 0x12, 0, le); // padding

  // SFAT header
  let off = sarcHeaderSize;
  output[off] = 0x53; output[off + 1] = 0x46; output[off + 2] = 0x41; output[off + 3] = 0x54; // "SFAT"
  writeU16(view, off + 0x04, 0x0C, le);
  writeU16(view, off + 0x06, nodeCount, le);
  writeU32(view, off + 0x08, hashMultiplier, le);

  // FAT entries
  off = sarcHeaderSize + sfatHeaderSize;
  for (let i = 0; i < nodeCount; i++) {
    const hash = calcNameHash(sorted[i].name, hashMultiplier);
    const nameOff = nameOffsets[i] / 4;
    const attrs = (1 << 24) | (nameOff & 0xFFFF); // has_name flag + offset
    writeU32(view, off, hash, le);
    writeU32(view, off + 4, attrs, le);
    writeU32(view, off + 8, dataStarts[i], le);
    writeU32(view, off + 12, dataEnds[i], le);
    off += 16;
  }

  // SFNT header
  output[off] = 0x53; output[off + 1] = 0x46; output[off + 2] = 0x4E; output[off + 3] = 0x54; // "SFNT"
  writeU16(view, off + 0x04, 0x08, le);
  writeU16(view, off + 0x06, 0, le); // padding

  // Name table
  off += sfntHeaderSize;
  for (const nb of nameBytes) {
    output.set(nb, off);
    off += nb.length;
  }

  // Data section
  for (let i = 0; i < sorted.length; i++) {
    output.set(sorted[i].data, dataOffset + dataStarts[i]);
  }

  return output;
}

/**
 * Build SARC and compress with Zstandard.
 */
export async function buildSarcZs(entries: SarcEntry[], endian: "big" | "little" = "little"): Promise<Uint8Array> {
  const sarc = buildSarc(entries, endian);
  const { init, compress } = await import("@bokuweb/zstd-wasm");
  await init();
  const compressed = compress(sarc, 3); // level 3 = good balance
  return new Uint8Array(compressed);
}
