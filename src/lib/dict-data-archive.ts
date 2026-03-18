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

function looksLikeZlibHeader(data: Uint8Array): boolean {
  return data.length >= 2 && data[0] === 0x78 && (data[1] === 0x01 || data[1] === 0x5e || data[1] === 0x9c || data[1] === 0xda);
}

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

function chooseBestBlockSize(block: DictBlock, preferCompressed: boolean): number {
  const primary = preferCompressed ? block.compressedSize : block.decompressedSize;
  const secondary = preferCompressed ? block.decompressedSize : block.compressedSize;

  if (primary > 0) return primary;
  return secondary > 0 ? secondary : 0;
}

function scoreBlocks(blocks: DictBlock[], dataFileLength?: number): { score: number; validBlocks: number } {
  let score = 0;
  let validBlocks = 0;
  let largeBlocks = 0;
  let sortedOffsets = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const validType = block.usageType === 0x08 || block.usageType === 0x80;
    const validExt = block.extIndex === 0 || block.extIndex === 1;

    if (validType) score += 2;
    else score -= 2;

    if (block.usageType === 0x80) score += 3;

    if (validExt) score += 2;
    else score -= 1;

    const hasSizes = block.compressedSize > 0 || block.decompressedSize > 0;
    if (hasSizes) score += 1;
    else score -= 3;

    const likelyDataSize = Math.max(block.compressedSize, block.decompressedSize);
    if (likelyDataSize >= 256) score += 2;
    if (likelyDataSize >= 4096) {
      score += 3;
      largeBlocks += 1;
    }

    if (i > 0 && block.offset >= blocks[i - 1].offset) sortedOffsets += 1;

    if (dataFileLength != null) {
      const fitsComp = block.compressedSize > 0 && block.offset + block.compressedSize <= dataFileLength;
      const fitsDecomp = block.decompressedSize > 0 && block.offset + block.decompressedSize <= dataFileLength;

      if (fitsComp || fitsDecomp) {
        validBlocks += 1;
        score += 8;
      } else {
        score -= 5;
      }

      if (block.offset < dataFileLength) score += 1;
      else score -= 2;
    }
  }

  if (largeBlocks >= 2) score += 8;
  if (sortedOffsets >= Math.max(1, blocks.length - 2)) score += 4;

  return { score, validBlocks };
}

function collectTableStarts(base: number, dictLength: number): number[] {
  const starts = new Set<number>();

  starts.add(base);
  starts.add(align4(base));
  starts.add(0x14);

  const localStart = Math.max(0x11, base - 0x20);
  const localEnd = Math.min(dictLength - 16, base + 0x120);
  for (let off = localStart; off <= localEnd; off++) starts.add(off);

  const globalEnd = Math.min(dictLength - 16, 0x200);
  for (let off = 0x11; off <= globalEnd; off += 4) starts.add(off);

  return Array.from(starts).filter((v) => v >= 0x11 && v + 16 <= dictLength);
}

function inferCompression(compressedFromHeader: boolean, blocks: DictBlock[], dataFileLength?: number): boolean {
  if (dataFileLength == null) return compressedFromHeader;

  const compFits = blocks.filter((b) => b.compressedSize > 0 && b.offset + b.compressedSize <= dataFileLength).length;
  const decompFits = blocks.filter((b) => b.decompressedSize > 0 && b.offset + b.decompressedSize <= dataFileLength).length;
  const looksCompressed = blocks.some((b) => b.compressedSize > 0 && b.decompressedSize > b.compressedSize);

  if (!compressedFromHeader && looksCompressed && compFits >= decompFits) return true;
  if (compressedFromHeader && compFits === 0 && decompFits > 0) return false;

  return compressedFromHeader;
}

function collectDictParseCandidates(dictData: Uint8Array, dataFileLength?: number): DictParseCandidate[] {
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
  const tableStarts = collectTableStarts(base, dictData.length);

  const candidates: DictParseCandidate[] = [];

  for (const blockCount of safeBlockCounts) {
    for (const blockTableStart of tableStarts) {
      for (const littleEndian of [true, false]) {
        const blocks = parseBlocksWithStrategy(view, dictData, blockTableStart, blockCount, littleEndian);
        if (blocks.length === 0) continue;

        const scored = scoreBlocks(blocks, dataFileLength);
        const inferredCompressed = inferCompression(compressedFromHeader, blocks, dataFileLength);

        candidates.push({
          archive: { compressed: inferredCompressed, blocks },
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

  return candidates;
}

function indexOfNlocMagic(data: Uint8Array): number {
  for (let i = 0; i <= data.length - 8; i++) {
    if (data[i] !== 0x4e || data[i + 1] !== 0x4c || data[i + 2] !== 0x4f || data[i + 3] !== 0x43) continue;

    const v0 = data[i + 4];
    const v1 = data[i + 5];
    const v2 = data[i + 6];
    const v3 = data[i + 7];

    const isVersionOne = (v0 === 1 && v1 === 0 && v2 === 0 && v3 === 0) || (v0 === 0 && v1 === 0 && v2 === 0 && v3 === 1);
    if (isVersionOne) return i;
  }

  return -1;
}

function concatenateBlocks(blocks: Uint8Array[]): Uint8Array {
  if (blocks.length === 1) return blocks[0];

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
 * Parse a .dict file header to extract block table info.
 * Tries multiple table alignments + endian modes and picks the most plausible one.
 */
export function parseDictHeader(
  dictData: Uint8Array,
  dataFileLength?: number,
  log?: (msg: string) => void
): DictArchive {
  const candidates = collectDictParseCandidates(dictData, dataFileLength);
  const best = candidates[0];

  log?.(
    `📋 .dict strategy: start=0x${best.blockTableStart.toString(16)}, endian=${best.littleEndian ? "LE" : "BE"}, blocks=${best.archive.blocks.length}, valid=${best.validBlocks}`
  );

  return best.archive;
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
  const blocks = [...archive.blocks].sort((a, b) => a.offset - b.offset);

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    // Keep likely data blocks; skip only obvious non-data metadata.
    const likelyDataBlock = block.extIndex === 0 || block.usageType === 0x80 || (block.usageType !== 0x08 && block.extIndex !== 1);
    if (!likelyDataBlock) continue;

    const start = block.offset;
    const preferCompressed = archive.compressed || (block.compressedSize > 0 && block.decompressedSize > block.compressedSize);
    let size = chooseBestBlockSize(block, preferCompressed);

    if (size <= 0 || start + size > dataBytes.length) {
      const fallbackSize = chooseBestBlockSize(block, !preferCompressed);
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
      looksLikeZlibHeader(raw);

    if (shouldTryInflate && raw.length > 2) {
      try {
        const decompressed = inflate(raw);
        log?.(`📦 Block ${i}: ${raw.length} → ${decompressed.length} bytes (zlib)`);
        results.push(decompressed);
        continue;
      } catch (e) {
        log?.(`⚠️ Block ${i}: فشل فك الضغط — ${e instanceof Error ? e.message : "خطأ"} (سيتم استخدام raw)`);
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
  const candidates = collectDictParseCandidates(dictBytes, dataBytes.length);

  let chosenBlocks: Uint8Array[] | null = null;
  let chosenCandidate: DictParseCandidate | null = null;
  let chosenMagic = -1;
  let chosenScore = Number.NEGATIVE_INFINITY;

  const maxCandidates = Math.min(candidates.length, 20);

  for (let i = 0; i < maxCandidates; i++) {
    const candidate = candidates[i];
    const blocks = extractDataBlocks(dataBytes, candidate.archive);
    if (blocks.length === 0) continue;

    const combined = concatenateBlocks(blocks);
    const magicIndex = indexOfNlocMagic(combined);

    // Prefer candidates that reveal NLOC magic, then longer meaningful payloads.
    const candidateScore =
      (magicIndex >= 0 ? 1_000_000 - Math.min(magicIndex, 200_000) : 0) +
      Math.min(combined.length, 2_000_000) / 8 +
      candidate.validBlocks * 20 +
      candidate.score;

    if (candidateScore > chosenScore) {
      chosenScore = candidateScore;
      chosenBlocks = blocks;
      chosenCandidate = candidate;
      chosenMagic = magicIndex;

      if (magicIndex >= 0 && magicIndex <= 0x200) break;
    }
  }

  if (!chosenCandidate || !chosenBlocks || chosenBlocks.length === 0) {
    throw new Error("لم يتم استخراج أي بيانات من الأرشيف");
  }

  log?.(
    `📋 .dict strategy: start=0x${chosenCandidate.blockTableStart.toString(16)}, endian=${chosenCandidate.littleEndian ? "LE" : "BE"}, blocks=${chosenCandidate.archive.blocks.length}, valid=${chosenCandidate.validBlocks}`
  );
  log?.(`📋 .dict: ${chosenCandidate.archive.blocks.length} blocks, compressed=${chosenCandidate.archive.compressed}`);

  // Re-run selected strategy with verbose logs for diagnostics.
  const verboseBlocks = extractDataBlocks(dataBytes, chosenCandidate.archive, log);
  if (verboseBlocks.length === 0) {
    throw new Error("تم اختيار استراتيجية .dict لكنها لم تُنتج بلوكات صالحة");
  }

  const combined = concatenateBlocks(verboseBlocks);
  if (chosenMagic >= 0) {
    log?.(`✅ تم اكتشاف ترويسة NLOC عند offset 0x${chosenMagic.toString(16)} داخل البيانات المفكوكة`);
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

    if (looksLikeZlibHeader(slice)) {
      try {
        const result = inflate(slice);
        log?.(`✅ Decompressed from offset 0x${off.toString(16)}: ${result.length} bytes`);
        return result;
      } catch {
        /* continue */
      }
    }
  }

  // Wider scan for zlib headers.
  const scanLimit = Math.min(dataBytes.length - 2, 2 * 1024 * 1024);
  for (let i = 0; i < scanLimit; i++) {
    if (dataBytes[i] !== 0x78) continue;

    const candidate = dataBytes.subarray(i);
    if (!looksLikeZlibHeader(candidate)) continue;

    try {
      const result = inflate(candidate);
      if (result.length > 0x100) {
        log?.(`✅ Found zlib at offset 0x${i.toString(16)}: ${result.length} bytes`);
        return result;
      }
    } catch {
      /* continue */
    }
  }

  return null;
}
