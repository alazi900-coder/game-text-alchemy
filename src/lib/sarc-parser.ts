/**
 * SARC (SEAD Archive) parser for Nintendo Switch games.
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

function readNullTermString(data: Uint8Array, offset: number): string {
  let end = offset;
  while (end < data.length && data[end] !== 0) end++;
  return new TextDecoder("utf-8").decode(data.subarray(offset, end));
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
  // hash multiplier at sfatOffset + 0x08

  // FAT entries start at sfatOffset + 0x0C
  const fatStart = sfatOffset + 0x0C;

  // Each FAT entry is 16 bytes
  interface FatEntry {
    nameHash: number;
    fileAttrs: number; // bit 24 = has name, bits 0-15 = name offset / 4
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
    entries.push({ name, data: fileData });
  }

  return { entries, endian: le ? "little" : "big" };
}

/**
 * Decompress a .zs (Zstandard) buffer, then parse as SARC.
 */
export async function parseSarcZs(compressedData: Uint8Array): Promise<SarcArchive> {
  const { init, decompress } = await import("@bokuweb/zstd-wasm");
  await init();
  const decompressed = decompress(compressedData);
  return parseSarc(new Uint8Array(decompressed));
}

/**
 * Extract only MSBT files from a SARC archive.
 */
export function extractMsbtFromSarc(archive: SarcArchive): { name: string; data: Uint8Array }[] {
  return archive.entries.filter(e => e.name.toLowerCase().endsWith(".msbt"));
}
