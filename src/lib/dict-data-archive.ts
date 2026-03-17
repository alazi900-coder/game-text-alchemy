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

interface DictParseCandidate {
  archive: DictArchive;
  blockTableStart: number;
  littleEndian: boolean;
  blockCount: number;
  score: number;
  validBlocks: number;
}

const align4 = (v: number) => (v + 3) & ~3;

function parseBlocksWithStrategy(
  view: DataView,
  dictData: Uint8Array,
  blockTableStart: number,
  blockCount: number,
  littleEndian: boolean
): DictBlock[] {
  const blocks: DictBlock[] = [];

  for (let i = 0; i < blockCount; i++) {
    const off = blockTableStart + i * 16;
    if (off + 16 > dictData.length) break;

    blocks.push({
      offset: view.getUint32(off, littleEndian),
      decompressedSize: view.getUint32(off + 4, littleEndian),
      compressedSize: view.getUint32(off + 8, littleEndian),
      usageType: dictData[off + 12],
      extIndex: dictData[off + 14],
    });
  }

  return blocks;
}

function scoreBlocks(blocks: DictBlock[], dataFileLength?: number): { score: number; validBlocks: number } {
  let score = 0;
  let validBlocks = 0;

  for (const block of blocks) {
    const validType = block.usageType === 0x08 || block.usageType === 0x80;
    const validExt = block.extIndex === 0 || block.extIndex === 1;

    if (validType) score += 2;
    if (validExt) score += 2;

    if (dataFileLength != null) {
      const fitsComp = block.compressedSize > 0 && block.offset + block.compressedSize <= dataFileLength;
      const fitsDecomp = block.decompressedSize > 0 && block.offset + block.decompressedSize <= dataFileLength;
      if (fitsComp || fitsDecomp) {
        validBlocks += 1;
        score += 6;
      } else {
        score -= 3;
      }
      if (block.offset < dataFileLength) score += 1;
    }
  }

  return { score, validBlocks };
}

/**
 * Parse a .dict file header to extract block table info.
 * Tries multiple table alignments + endian modes and picks the most plausible one.
 */
export function parseDictHeader(
  dictData: Uint8Array,
  dataFileLength?: number,
  log?: (msg: string) => void
): DictArchive {
  if (dictData.length < 0x11) throw new Error("ملف .dict صغير جداً");

  const view = new DataView(dictData.buffer, dictData.byteOffset, dictData.byteLength);
  const magicLE = view.getUint32(0x00, true);
  const magicBE = view.getUint32(0x00, false);

  if (magicLE !== DICT_MAGIC_BE && magicLE !== DICT_MAGIC_LE && magicBE !== DICT_MAGIC_BE) {
    throw new Error(`ليس ملف .dict صالح (magicLE: 0x${magicLE.toString(16)})`);
  }

  const compressedFromHeader = dictData[0x06] === 1;
  const fileTableCount = dictData[0x10];

  const blockCountCandidates = Array.from(
    new Set([view.getUint32(0x08, true), view.getUint32(0x08, false)])
  ).filter((v) => v > 0 && v < 100000);

  const safeBlockCounts = blockCountCandidates.length > 0 ? blockCountCandidates : [view.getUint32(0x08, true)];

  const base = 0x11 + fileTableCount * 12;
  const tableStarts = Array.from(new Set([base, align4(base), 0x14 + fileTableCount * 12]));

  const candidates: DictParseCandidate[] = [];

  for (const blockCount of safeBlockCounts) {
    for (const blockTableStart of tableStarts) {
      for (const littleEndian of [true, false]) {
        const blocks = parseBlocksWithStrategy(view, dictData, blockTableStart, blockCount, littleEndian);
        if (blocks.length === 0) continue;

        const scored = scoreBlocks(blocks, dataFileLength);
        candidates.push({
          archive: { compressed: compressedFromHeader, blocks },
          blockTableStart,
          littleEndian,
          blockCount,
          score: scored.score,
          validBlocks: scored.validBlocks,
        });
      }
    }
  }

  if (candidates.length === 0) {
    throw new Error("تعذر قراءة جدول البلوكات من ملف .dict");
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.validBlocks !== a.validBlocks) return b.validBlocks - a.validBlocks;
    return b.archive.blocks.length - a.archive.blocks.length;
  });

  const best = candidates[0];
  const blocks = best.archive.blocks;

  // Infer compression in case the header flag is wrong.
  let inferredCompressed = compressedFromHeader;
  if (dataFileLength != null) {
    const compFits = blocks.filter((b) => b.compressedSize > 0 && b.offset + b.compressedSize <= dataFileLength).length;
    const decompFits = blocks.filter((b) => b.decompressedSize > 0 && b.offset + b.decompressedSize <= dataFileLength).length;
    const looksCompressed = blocks.some((b) => b.compressedSize > 0 && b.decompressedSize > b.compressedSize);

    if (!compressedFromHeader && looksCompressed && compFits >= decompFits) {
      inferredCompressed = true;
    }
    if (compressedFromHeader && compFits === 0 && decompFits > 0) {
      inferredCompressed = false;
    }
  }

  log?.(
    `📋 .dict strategy: start=0x${best.blockTableStart.toString(16)}, endian=${best.littleEndian ? "LE" : "BE"}, blocks=${best.archive.blocks.length}, valid=${best.validBlocks}`
  );

  return {
    compressed: inferredCompressed,
    blocks,
  };
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
    const preferredCompressedSize = archive.compressed || (block.compressedSize > 0 && block.compressedSize < block.decompressedSize);
    let size = preferredCompressedSize ? block.compressedSize : block.decompressedSize;

    if (size <= 0 || start + size > dataBytes.length) {
      const fallbackSize = preferredCompressedSize ? block.decompressedSize : block.compressedSize;
      if (fallbackSize > 0 && start + fallbackSize <= dataBytes.length) {
        log?.(`ℹ️ Block ${i}: استخدام حجم بديل ${fallbackSize} بدل ${size}`);
        size = fallbackSize;
      } else {
        log?.(`⚠️ Block ${i}: offset ${start} + size ${size} exceeds file (${dataBytes.length})`);
        continue;
      }
    }

    const raw = dataBytes.subarray(start, start + size);

    const shouldTryInflate =
      archive.compressed ||
      (block.compressedSize > 0 && block.decompressedSize > block.compressedSize) ||
      (raw.length > 2 && raw[0] === 0x78);

    if (shouldTryInflate && raw.length > 2) {
      try {
        const decompressed = inflate(raw);
        log?.(`📦 Block ${i}: ${raw.length} → ${decompressed.length} bytes (zlib)`);
        results.push(decompressed);
        continue;
      } catch (e) {
        log?.(`⚠️ Block ${i}: فشل فك الضغط — ${e instanceof Error ? e.message : 'خطأ'} (سيتم استخدام raw)`);
      }
    }

    log?.(`📦 Block ${i}: ${raw.length} bytes (raw)`);
    results.push(raw);
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
  const archive = parseDictHeader(dictBytes, dataBytes.length, log);
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
