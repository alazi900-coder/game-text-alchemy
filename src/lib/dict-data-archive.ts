/**
 * .dict/.data archive parser for Luigi's Mansion 2 HD (Next Level Games).
 *
 * Official structure reference:
 * https://github-wiki-see.page/m/KillzXGaming/NextLevelLibrary/wiki/LM2-Dictionary-File-(.dict-.data)
 */

import { inflate, Inflate } from "pako";

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
  preferredDataBlockIndices: number[];
}

interface DictHeaderCore {
  compressed: boolean;
  fileTableCount: number;
  fileTableRefCount: number;
  extCount: number;
  canonicalBlockTableStart: number;
}

interface DictFileTableReference {
  hash: number;
  blockIndices: number[];
}

interface DictParseCandidate {
  archive: DictArchive;
  blockTableStart: number;
  littleEndian: boolean;
  blockCount: number;
  score: number;
  validBlocks: number;
}

const DICT_MAGIC = 0x5824f3a9;

const align4 = (v: number) => (v + 3) & ~3;

function looksLikeZlibHeaderAt(data: Uint8Array, index: number): boolean {
  if (index + 1 >= data.length) return false;
  const cmf = data[index];
  const flg = data[index + 1];

  // CM = 8 (deflate), CINFO <= 7, and FCHECK valid.
  if ((cmf & 0x0f) !== 8) return false;
  if ((cmf >> 4) > 7) return false;
  return (((cmf << 8) | flg) % 31) === 0;
}

function indexOfNlocMagic(data: Uint8Array): number {
  for (let i = 0; i <= data.length - 8; i++) {
    if (data[i] !== 0x4e || data[i + 1] !== 0x4c || data[i + 2] !== 0x4f || data[i + 3] !== 0x43) continue;

    const v0 = data[i + 4];
    const v1 = data[i + 5];
    const v2 = data[i + 6];
    const v3 = data[i + 7];

    const versionOne =
      (v0 === 1 && v1 === 0 && v2 === 0 && v3 === 0) ||
      (v0 === 0 && v1 === 0 && v2 === 0 && v3 === 1);

    if (versionOne) return i;
  }

  return -1;
}

function concatBuffers(buffers: Uint8Array[]): Uint8Array {
  if (buffers.length === 0) return new Uint8Array(0);
  if (buffers.length === 1) return buffers[0];

  const total = buffers.reduce((sum, b) => sum + b.length, 0);
  const out = new Uint8Array(total);
  let at = 0;

  for (const b of buffers) {
    out.set(b, at);
    at += b.length;
  }

  return out;
}

function detectPreferredEndianness(dictData: Uint8Array): boolean {
  const view = new DataView(dictData.buffer, dictData.byteOffset, dictData.byteLength);
  const magicLE = view.getUint32(0x00, true);
  const magicBE = view.getUint32(0x00, false);

  if (magicLE === DICT_MAGIC) return true;
  if (magicBE === DICT_MAGIC) return false;

  throw new Error(`ليس ملف .dict صالح (magicLE=0x${magicLE.toString(16)}, magicBE=0x${magicBE.toString(16)})`);
}

function parseHeaderCore(dictData: Uint8Array): DictHeaderCore {
  if (dictData.length < 0x14) throw new Error("ملف .dict صغير جداً");

  const fileTableCount = dictData[0x10];
  const fileTableRefCount = dictData[0x12];
  const extCount = dictData[0x13];

  if (fileTableRefCount === 0) {
    throw new Error("ملف .dict غير صالح: File Table Reference Count = 0");
  }

  const fileTableRefsStart = 0x14;
  const fileTableRefsSize = fileTableRefCount * 12;
  const fileTableInfoStart = fileTableRefsStart + fileTableRefsSize;
  const fileTableInfoSize = fileTableRefCount * fileTableCount * 4;
  const canonicalBlockTableStart = fileTableInfoStart + fileTableInfoSize;

  if (canonicalBlockTableStart + 16 > dictData.length) {
    throw new Error("ملف .dict غير مكتمل: Block Table خارج حدود الملف");
  }

  return {
    compressed: dictData[0x06] === 1,
    fileTableCount,
    fileTableRefCount,
    extCount,
    canonicalBlockTableStart,
  };
}

function parseFileTableRefs(dictData: Uint8Array, core: DictHeaderCore, littleEndian: boolean): DictFileTableReference[] {
  const view = new DataView(dictData.buffer, dictData.byteOffset, dictData.byteLength);
  const refs: DictFileTableReference[] = [];
  let off = 0x14;

  for (let i = 0; i < core.fileTableRefCount; i++) {
    if (off + 12 > dictData.length) break;
    const hash = view.getUint32(off, littleEndian);
    const blockIndices = Array.from(dictData.subarray(off + 4, off + 12));
    refs.push({ hash, blockIndices });
    off += 12;
  }

  return refs;
}

function parseBlocks(
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

function evaluateBlocks(blocks: DictBlock[], dataFileLength?: number): { score: number; validBlocks: number } {
  let score = 0;
  let validBlocks = 0;
  let overlaps = 0;
  let lastEnd = -1;

  const sorted = blocks
    .map((b) => ({ ...b, likelySize: Math.max(b.compressedSize, b.decompressedSize) }))
    .sort((a, b) => a.offset - b.offset);

  for (const block of sorted) {
    const validType = block.usageType === 0x08 || block.usageType === 0x80;
    const validExt = block.extIndex <= 2;

    if (validType) score += 2;
    else score -= 3;

    if (block.usageType === 0x80) score += 2;
    if (validExt) score += 2;
    else score -= 2;

    if (block.likelySize > 0) score += 1;
    else score -= 4;

    if (block.offset < lastEnd && block.likelySize > 0) {
      overlaps += 1;
      score -= 4;
    }

    if (block.likelySize > 0) {
      lastEnd = Math.max(lastEnd, block.offset + block.likelySize);
    }

    if (dataFileLength != null) {
      const fitsComp = block.compressedSize > 0 && block.offset + block.compressedSize <= dataFileLength;
      const fitsDecomp = block.decompressedSize > 0 && block.offset + block.decompressedSize <= dataFileLength;

      if (fitsComp || fitsDecomp) {
        validBlocks += 1;
        score += 7;
      } else {
        score -= 6;
      }
    }
  }

  if (overlaps === 0) score += 6;
  return { score, validBlocks };
}

function collectBlockCountCandidates(
  view: DataView,
  dictLength: number,
  blockTableStart: number,
  preferredEndian: boolean
): number[] {
  const maxByLength = Math.max(1, Math.floor((dictLength - blockTableStart) / 16));

  const raw = [
    view.getUint32(0x08, preferredEndian),
    view.getUint32(0x08, !preferredEndian),
  ];

  const values = Array.from(new Set(raw)).filter((v) => v > 0 && v <= maxByLength + 2);

  if (values.length > 0) return values;

  // Fallback: try a conservative cap when header block count is corrupt.
  return [Math.min(maxByLength, 4096)];
}

function collectTableStartCandidates(core: DictHeaderCore, dictLength: number): number[] {
  const base = core.canonicalBlockTableStart;
  const starts = new Set<number>([
    base,
    align4(base),
    base + 4,
    Math.max(0x14, base - 4),
  ]);

  for (let delta = -16; delta <= 16; delta += 4) {
    starts.add(base + delta);
  }

  return Array.from(starts)
    .filter((s) => s >= 0x14 && s + 16 <= dictLength)
    .sort((a, b) => a - b);
}

function buildPreferredDataIndices(refs: DictFileTableReference[], blocks: DictBlock[]): number[] {
  if (refs.length === 0) return [];

  const standard = refs[0].blockIndices;
  const chosen: number[] = [];

  for (const idx of standard) {
    if (idx >= blocks.length) continue;
    const block = blocks[idx];
    if (!block) continue;
    if (block.extIndex !== 0) continue;
    if (block.usageType !== 0x80) continue;

    const likelySize = Math.max(block.compressedSize, block.decompressedSize);
    if (likelySize <= 0) continue;

    if (!chosen.includes(idx)) chosen.push(idx);
  }

  return chosen;
}

export function collectDictParseCandidates(dictData: Uint8Array, dataFileLength?: number): DictParseCandidate[] {
  const core = parseHeaderCore(dictData);
  const preferredEndian = detectPreferredEndianness(dictData);
  const view = new DataView(dictData.buffer, dictData.byteOffset, dictData.byteLength);

  const tableStarts = collectTableStartCandidates(core, dictData.length);
  const candidates: DictParseCandidate[] = [];

  for (const blockTableStart of tableStarts) {
    const blockCountCandidates = collectBlockCountCandidates(view, dictData.length, blockTableStart, preferredEndian);

    for (const littleEndian of [preferredEndian, !preferredEndian]) {
      const refs = parseFileTableRefs(dictData, core, littleEndian);

      for (const blockCount of blockCountCandidates) {
        const blocks = parseBlocks(view, dictData, blockTableStart, blockCount, littleEndian);
        if (blocks.length === 0) continue;

        const judged = evaluateBlocks(blocks, dataFileLength);
        const preferredDataBlockIndices = buildPreferredDataIndices(refs, blocks);

        let score = judged.score;
        if (blockTableStart === core.canonicalBlockTableStart) score += 20;
        if (blockTableStart === align4(core.canonicalBlockTableStart)) score += 6;
        if (littleEndian === preferredEndian) score += 10;
        if (preferredDataBlockIndices.length > 0) score += 8;

        candidates.push({
          archive: {
            compressed: core.compressed,
            blocks,
            preferredDataBlockIndices,
          },
          blockTableStart,
          littleEndian,
          blockCount,
          score,
          validBlocks: judged.validBlocks,
        });
      }
    }
  }

  if (candidates.length === 0) {
    throw new Error("تعذر استخراج جدول الكتل من ملف .dict");
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.validBlocks !== a.validBlocks) return b.validBlocks - a.validBlocks;
    return b.archive.blocks.length - a.archive.blocks.length;
  });

  return candidates;
}

function chooseReadSize(block: DictBlock, preferCompressed: boolean): { size: number; fallback: number } {
  const primary = preferCompressed ? block.compressedSize : block.decompressedSize;
  const secondary = preferCompressed ? block.decompressedSize : block.compressedSize;
  return { size: primary, fallback: secondary };
}

function blockIndicesForExtraction(archive: DictArchive): number[] {
  if (archive.preferredDataBlockIndices.length > 0) {
    return archive.preferredDataBlockIndices;
  }

  const strong = archive.blocks
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.extIndex === 0 && b.usageType === 0x80 && Math.max(b.compressedSize, b.decompressedSize) > 0)
    .map(({ i }) => i);
  if (strong.length > 0) return strong;

  const extData = archive.blocks
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.extIndex === 0 && Math.max(b.compressedSize, b.decompressedSize) > 0)
    .map(({ i }) => i);
  if (extData.length > 0) return extData;

  return archive.blocks
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => Math.max(b.compressedSize, b.decompressedSize) > 0)
    .map(({ i }) => i);
}

/**
 * Parse a .dict file header to extract block table info.
 */
export function parseDictHeader(
  dictData: Uint8Array,
  dataFileLength?: number,
  log?: (msg: string) => void
): DictArchive {
  const best = collectDictParseCandidates(dictData, dataFileLength)[0];

  log?.(
    `📋 .dict strategy: start=0x${best.blockTableStart.toString(16)}, endian=${best.littleEndian ? "LE" : "BE"}, blocks=${best.archive.blocks.length}, valid=${best.validBlocks}`
  );

  return best.archive;
}

/**
 * Extract all decompressed blocks from a .data file using .dict block info.
 */
export function extractDataBlocks(
  dataBytes: Uint8Array,
  archive: DictArchive,
  log?: (msg: string) => void
): Uint8Array[] {
  const out: Uint8Array[] = [];
  const indices = blockIndicesForExtraction(archive);

  for (const idx of indices) {
    const block = archive.blocks[idx];
    const start = block.offset;

    const preferCompressed = archive.compressed || block.compressedSize > 0;
    let { size, fallback } = chooseReadSize(block, preferCompressed);

    if (size <= 0 || start + size > dataBytes.length) {
      if (fallback > 0 && start + fallback <= dataBytes.length) {
        log?.(`ℹ️ Block ${idx}: استخدام حجم بديل ${fallback} بدل ${size}`);
        size = fallback;
      } else {
        log?.(`⚠️ Block ${idx}: offset ${start} + size ${size} exceeds file (${dataBytes.length})`);
        continue;
      }
    }

    const raw = dataBytes.subarray(start, start + size);
    const shouldInflate = archive.compressed || looksLikeZlibHeaderAt(raw, 0);

    if (shouldInflate && raw.length > 2) {
      try {
        const inflated = inflate(raw);
        log?.(`📦 Block ${idx}: ${raw.length} → ${inflated.length} bytes (zlib)`);
        out.push(inflated);
        continue;
      } catch (e) {
        log?.(`⚠️ Block ${idx}: فشل فك الضغط — ${e instanceof Error ? e.message : "خطأ"} (سيتم استخدام raw)`);
      }
    }

    log?.(`📦 Block ${idx}: ${raw.length} bytes (raw)`);
    out.push(raw);
  }

  return out;
}

/**
 * Full pipeline: parse .dict, extract/decompress blocks from .data, concatenate and return.
 */
export function extractDictDataArchive(
  dictBytes: Uint8Array,
  dataBytes: Uint8Array,
  log?: (msg: string) => void
): Uint8Array {
  const candidates = collectDictParseCandidates(dictBytes, dataBytes.length).slice(0, 12);

  let chosen: { candidate: DictParseCandidate; buffers: Uint8Array[]; combined: Uint8Array; score: number; magicAt: number } | null = null;

  for (const c of candidates) {
    const buffers = extractDataBlocks(dataBytes, c.archive);
    if (buffers.length === 0) continue;

    const combined = concatBuffers(buffers);
    const magicAt = indexOfNlocMagic(combined);

    let score = c.score + c.validBlocks * 10 + Math.min(combined.length, 4_000_000) / 64;
    if (magicAt >= 0) score += 1_000_000 - Math.min(magicAt, 100_000);

    if (!chosen || score > chosen.score) {
      chosen = { candidate: c, buffers, combined, score, magicAt };
      if (magicAt >= 0 && magicAt <= 0x200) break;
    }
  }

  if (!chosen) {
    throw new Error("لم يتم استخراج أي بيانات من الأرشيف");
  }

  const { candidate } = chosen;
  log?.(
    `📋 .dict strategy: start=0x${candidate.blockTableStart.toString(16)}, endian=${candidate.littleEndian ? "LE" : "BE"}, blocks=${candidate.archive.blocks.length}, valid=${candidate.validBlocks}`
  );
  log?.(`📋 .dict: ${candidate.archive.blocks.length} blocks, compressed=${candidate.archive.compressed}`);

  // Re-run chosen strategy with detailed logs for the UI.
  const detailed = extractDataBlocks(dataBytes, candidate.archive, log);
  if (detailed.length === 0) {
    throw new Error("الاستراتيجية المختارة لم تُنتج بيانات صالحة");
  }

  const combined = concatBuffers(detailed);
  const nlocAt = indexOfNlocMagic(combined);
  if (nlocAt >= 0) {
    log?.(`✅ تم اكتشاف ترويسة NLOC عند offset 0x${nlocAt.toString(16)}`);
  }

  return combined;
}

/**
 * Try brute-force zlib decompression on a .data file when no reliable .dict strategy is available.
 */
export function tryDecompressDataFile(dataBytes: Uint8Array, log?: (msg: string) => void): Uint8Array | null {
  const directOffsets = [0, 0x10, 0x14, 0x20];

  for (const off of directOffsets) {
    if (!looksLikeZlibHeaderAt(dataBytes, off)) continue;

    try {
      const out = inflate(dataBytes.subarray(off));
      log?.(`✅ Decompressed from offset 0x${off.toString(16)}: ${out.length} bytes`);
      return out;
    } catch {
      // continue
    }
  }

  const streams: Uint8Array[] = [];
  const seenKeys = new Set<string>();

  // Full scan (bounded attempts) for embedded zlib streams.
  let attempts = 0;
  for (let i = 0; i < dataBytes.length - 2; i++) {
    if (!looksLikeZlibHeaderAt(dataBytes, i)) continue;
    if (++attempts > 4000) break;

    try {
      const out = inflate(dataBytes.subarray(i));
      const nlocAt = indexOfNlocMagic(out);
      if (nlocAt >= 0) {
        log?.(`✅ Found NLOC zlib stream at offset 0x${i.toString(16)} (${out.length} bytes)`);
        return out;
      }

      if (out.length < 16) continue;

      const key = `${out.length}:${out[0]}:${out[1]}:${out[2]}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      streams.push(out);
    } catch {
      // continue
    }
  }

  if (streams.length === 0) return null;

  // Try combined streams in scan order.
  const combined = concatBuffers(streams);
  const combinedMagic = indexOfNlocMagic(combined);
  if (combinedMagic >= 0) {
    log?.(`✅ NLOC detected after combining ${streams.length} zlib streams`);
    return combined;
  }

  // Fallback: return largest stream.
  streams.sort((a, b) => b.length - a.length);
  log?.(`ℹ️ لم يُعثر على NLOC مباشرة — استخدام أكبر zlib stream (${streams[0].length} bytes)`);
  return streams[0];
}
