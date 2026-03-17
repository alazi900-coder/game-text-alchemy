/**
 * .dict/.data archive parser for Luigi's Mansion 2 HD (Next Level Games).
 *
 * Format (from KillzXGaming/NextLevelLibrary wiki):
 *   .dict header:
 *     [0x00] magic: u32 (0x5824F3A9)
 *     [0x04] flags: u16 (0x0401)
 *     [0x06] compressed: u8 (1 = zlib, 0 = raw)
 *     [0x07] padding: u8
 *     [0x08] blockCount: u32
 *     [0x0C] largestBlockSize: u32
 *     [0x10] fileTableCount: u8
 *
 *   Block table (after header + file table refs):
 *     u32 offset       — offset in .data file
 *     u32 decompSize   — decompressed size
 *     u32 compSize     — compressed size (zlib)
 *     u8  usageType    — 0x08 = chunk table, 0x80 = file data
 *     u8  always0
 *     u8  extIndex     — 0 = .data, 1 = .debug
 *     u8  unknownFlag
 */

import { inflate } from "pako";

export interface DictBlock {
  offset: number;
  decompressedSize: number;
  compressedSize: number;
  usageType: number;
  extIndex: number;
}

export interface DictArchive {
  compressed: boolean;
  blocks: DictBlock[];
}

const DICT_MAGIC_BE = 0x5824F3A9;
const DICT_MAGIC_LE = 0xA9F32458;

/**
 * Parse a .dict file header to extract block table info.
 */
export function parseDictHeader(dictData: Uint8Array): DictArchive {
  if (dictData.length < 0x14) throw new Error("ملف .dict صغير جداً");

  const view = new DataView(dictData.buffer, dictData.byteOffset, dictData.byteLength);
  const magic = view.getUint32(0x00, true);

  if (magic !== DICT_MAGIC_BE && magic !== DICT_MAGIC_LE) {
    throw new Error(`ليس ملف .dict صالح (magic: 0x${magic.toString(16)})`);
  }

  const compressed = dictData[0x06] === 1;
  const blockCount = view.getUint32(0x08, true);
  const fileTableCount = dictData[0x10];

  // File table references come after the header (0x11 bytes, aligned)
  // Each file table ref is 12 bytes
  const fileTableRefsStart = 0x14; // after header (with some alignment)
  const blockTableStart = fileTableRefsStart + fileTableCount * 12;

  const blocks: DictBlock[] = [];
  for (let i = 0; i < blockCount; i++) {
    const off = blockTableStart + i * 16;
    if (off + 16 > dictData.length) break;

    blocks.push({
      offset: view.getUint32(off, true),
      decompressedSize: view.getUint32(off + 4, true),
      compressedSize: view.getUint32(off + 8, true),
      usageType: dictData[off + 12],
      extIndex: dictData[off + 14],
    });
  }

  return { compressed, blocks };
}

/**
 * Extract all decompressed blocks from a .data file using .dict block info.
 * Returns an array of decompressed buffers.
 */
export function extractDataBlocks(
  dataBytes: Uint8Array,
  archive: DictArchive,
  log?: (msg: string) => void
): Uint8Array[] {
  const results: Uint8Array[] = [];

  for (let i = 0; i < archive.blocks.length; i++) {
    const block = archive.blocks[i];

    // Only extract .data blocks (extIndex 0), skip .debug (extIndex 1)
    if (block.extIndex !== 0) continue;

    const start = block.offset;
    const size = archive.compressed ? block.compressedSize : block.decompressedSize;

    if (start + size > dataBytes.length) {
      log?.(`⚠️ Block ${i}: offset ${start} + size ${size} exceeds file (${dataBytes.length})`);
      continue;
    }

    const raw = dataBytes.subarray(start, start + size);

    if (archive.compressed && block.compressedSize > 0 && block.compressedSize !== block.decompressedSize) {
      try {
        const decompressed = inflate(raw);
        log?.(`📦 Block ${i}: ${block.compressedSize} → ${decompressed.length} bytes (zlib)`);
        results.push(decompressed);
      } catch (e) {
        log?.(`⚠️ Block ${i}: فشل فك الضغط — ${e instanceof Error ? e.message : 'خطأ'}`);
        // Try raw
        results.push(raw);
      }
    } else {
      log?.(`📦 Block ${i}: ${raw.length} bytes (raw)`);
      results.push(raw);
    }
  }

  return results;
}

/**
 * Full pipeline: parse .dict, extract and decompress blocks from .data,
 * concatenate all blocks and return the combined buffer.
 */
export function extractDictDataArchive(
  dictBytes: Uint8Array,
  dataBytes: Uint8Array,
  log?: (msg: string) => void
): Uint8Array {
  const archive = parseDictHeader(dictBytes);
  log?.(`📋 .dict: ${archive.blocks.length} blocks, compressed=${archive.compressed}`);

  const blocks = extractDataBlocks(dataBytes, archive, log);

  if (blocks.length === 0) {
    throw new Error("لم يتم استخراج أي بيانات من الأرشيف");
  }

  // If single block, return it directly
  if (blocks.length === 1) return blocks[0];

  // Concatenate all blocks
  const totalSize = blocks.reduce((s, b) => s + b.length, 0);
  const combined = new Uint8Array(totalSize);
  let offset = 0;
  for (const block of blocks) {
    combined.set(block, offset);
    offset += block.length;
  }

  return combined;
}

/**
 * Try brute-force zlib decompression on a .data file
 * when no .dict companion is available.
 */
export function tryDecompressDataFile(dataBytes: Uint8Array, log?: (msg: string) => void): Uint8Array | null {
  // Try skipping various header sizes and decompressing
  const offsets = [0, 0x10, 0x14, 0x20];

  for (const off of offsets) {
    if (off >= dataBytes.length) continue;
    const slice = dataBytes.subarray(off);

    // Check for zlib header (0x78)
    if (slice[0] === 0x78) {
      try {
        const result = inflate(slice);
        log?.(`✅ Decompressed from offset 0x${off.toString(16)}: ${result.length} bytes`);
        return result;
      } catch { /* continue */ }
    }
  }

  // Full scan for zlib headers
  for (let i = 0; i < Math.min(dataBytes.length, 0x200); i++) {
    if (dataBytes[i] === 0x78 && (dataBytes[i + 1] === 0x01 || dataBytes[i + 1] === 0x9C || dataBytes[i + 1] === 0xDA)) {
      try {
        const result = inflate(dataBytes.subarray(i));
        log?.(`✅ Found zlib at offset 0x${i.toString(16)}: ${result.length} bytes`);
        return result;
      } catch { /* continue */ }
    }
  }

  return null;
}
