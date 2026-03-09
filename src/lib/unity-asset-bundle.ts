/**
 * Unity AssetBundle (UnityFS) parser for browser.
 * Supports UnityFS format version 6/7 with LZ4, Zstd, and uncompressed blocks.
 * Designed to extract and REPACK TextAsset (.bytes) entries — e.g., MSBT files inside Fire Emblem Engage bundles.
 */

import lz4 from "lz4js";
import { init as initZstd, decompress as zstdDecompress } from "@bokuweb/zstd-wasm";

let zstdReady: Promise<void> | null = null;
function ensureZstd() {
  if (!zstdReady) zstdReady = initZstd();
  return zstdReady;
}

/* ───────── Binary Reader ───────── */
class BinaryReader {
  private view: DataView;
  private pos = 0;
  private le: boolean;

  constructor(buffer: ArrayBuffer, littleEndian = false) {
    this.view = new DataView(buffer);
    this.le = littleEndian;
  }

  get position() { return this.pos; }
  set position(v: number) { this.pos = v; }
  get length() { return this.view.byteLength; }

  readU8(): number { return this.view.getUint8(this.pos++); }
  readU16(): number { const v = this.view.getUint16(this.pos, this.le); this.pos += 2; return v; }
  readU32(): number { const v = this.view.getUint32(this.pos, this.le); this.pos += 4; return v; }
  readI32(): number { const v = this.view.getInt32(this.pos, this.le); this.pos += 4; return v; }
  readU64(): bigint { const v = this.view.getBigUint64(this.pos, this.le); this.pos += 8; return v; }

  readNullTermString(): string {
    const start = this.pos;
    while (this.pos < this.length && this.view.getUint8(this.pos) !== 0) this.pos++;
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + start, this.pos - start);
    this.pos++; // skip null
    return new TextDecoder("utf-8").decode(bytes);
  }

  readBytes(count: number): Uint8Array {
    const out = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, count);
    this.pos += count;
    return new Uint8Array(out); // copy
  }

  skip(n: number) { this.pos += n; }
  align(n: number) { const m = this.pos % n; if (m) this.pos += n - m; }

  slice(offset: number, length: number): ArrayBuffer {
    return (this.view.buffer as ArrayBuffer).slice(this.view.byteOffset + offset, this.view.byteOffset + offset + length);
  }
}

/* ───────── Binary Writer ───────── */
class BinaryWriter {
  private buf: Uint8Array;
  private view: DataView;
  private pos = 0;
  private le: boolean;

  constructor(initialSize = 65536, littleEndian = false) {
    this.buf = new Uint8Array(initialSize);
    this.view = new DataView(this.buf.buffer);
    this.le = littleEndian;
  }

  private ensure(n: number) {
    while (this.pos + n > this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
      this.view = new DataView(this.buf.buffer);
    }
  }

  get position() { return this.pos; }
  set position(v: number) { this.pos = v; }

  writeU8(v: number) { this.ensure(1); this.view.setUint8(this.pos, v); this.pos += 1; }
  writeU16(v: number) { this.ensure(2); this.view.setUint16(this.pos, v, this.le); this.pos += 2; }
  writeU32(v: number) { this.ensure(4); this.view.setUint32(this.pos, v, this.le); this.pos += 4; }
  writeI32(v: number) { this.ensure(4); this.view.setInt32(this.pos, v, this.le); this.pos += 4; }
  writeU64(v: bigint) { this.ensure(8); this.view.setBigUint64(this.pos, v, this.le); this.pos += 8; }

  writeBytes(data: Uint8Array) { this.ensure(data.length); this.buf.set(data, this.pos); this.pos += data.length; }
  writeNullTermString(s: string) { const b = new TextEncoder().encode(s); this.writeBytes(b); this.writeU8(0); }
  
  align(n: number) { const m = this.pos % n; if (m) { const pad = n - m; this.ensure(pad); this.pos += pad; } }

  // Patch a U32 at a specific position without advancing pos
  patchU32(offset: number, value: number) { this.view.setUint32(offset, value, this.le); }
  patchU64(offset: number, value: bigint) { this.view.setBigUint64(offset, value, this.le); }

  toUint8Array(): Uint8Array { return new Uint8Array(this.buf.buffer, 0, this.pos); }
}

/* ───────── Types ───────── */
export interface UnityBundleInfo {
  signature: string;
  formatVersion: number;
  unityVersion: string;
  generatorVersion: string;
  totalSize: bigint;
  blocks: BlockInfo[];
  entries: DirectoryEntry[];
  /** Offset where data blocks start in the original file */
  dataOffset: number;
  /** Original header flags */
  flags: number;
}

interface BlockInfo {
  decompressedSize: number;
  compressedSize: number;
  flags: number;
}

export interface DirectoryEntry {
  offset: bigint;
  decompressedSize: bigint;
  flags: number;
  name: string;
}

export interface ExtractedAsset {
  name: string;
  data: Uint8Array;
  type: string;
  pathId: bigint;
  /** Index of the directory entry this asset belongs to */
  entryIndex: number;
  /** Absolute byte offset of this asset's DATA (not header) within the decompressed stream */
  absoluteDataOffset: number;
  /** Total byte size of this object in the serialized file */
  objectByteSize: number;
  /** For TextAssets: offset of the data length prefix within the entry's serialized file */
  textAssetDataLenOffset: number;
  /** For TextAssets: offset of the actual data bytes within the entry's serialized file */
  textAssetDataBytesOffset: number;
}

/* ───────── Compression helpers ───────── */
const COMPRESSION_NONE = 0;
const COMPRESSION_LZMA = 1;
const COMPRESSION_LZ4 = 2;
const COMPRESSION_LZ4HC = 3;

const COMPRESSION_ZSTD = 4;

async function decompressBlock(compressed: Uint8Array, decompressedSize: number, compressionType: number): Promise<Uint8Array> {
  switch (compressionType) {
    case COMPRESSION_NONE:
      return compressed;
    case COMPRESSION_LZ4:
    case COMPRESSION_LZ4HC: {
      const output = new Uint8Array(decompressedSize);
      lz4.decompressBlock(compressed, output, 0, compressed.length, 0);
      return output;
    }
    case COMPRESSION_ZSTD: {
      await ensureZstd();
      return zstdDecompress(compressed);
    }
    case COMPRESSION_LZMA:
      throw new Error("ضغط LZMA غير مدعوم حالياً — يُرجى استخدام أداة خارجية لفك الضغط أولاً");
    default:
      throw new Error(`نوع ضغط غير معروف: ${compressionType}`);
  }
}

/* ───────── Parse UnityFS Header & Directory ───────── */
export async function parseUnityBundle(buffer: ArrayBuffer): Promise<UnityBundleInfo> {
  const r = new BinaryReader(buffer);

  const signature = r.readNullTermString();
  if (signature !== "UnityFS") {
    throw new Error(`تنسيق غير مدعوم: "${signature}" — المتوقع "UnityFS"`);
  }

  const formatVersion = r.readU32();
  const unityVersion = r.readNullTermString();
  const generatorVersion = r.readNullTermString();
  const totalSize = r.readU64();
  const compressedBlockInfoSize = r.readU32();
  const decompressedBlockInfoSize = r.readU32();
  const flags = r.readU32();

  const blockInfoAtEnd = (flags & 0x80) !== 0;
  const compressionType = flags & 0x3F;

  let blockInfoData: Uint8Array;

  if (blockInfoAtEnd) {
    const savedPos = r.position;
    r.position = r.length - compressedBlockInfoSize;
    const compressed = r.readBytes(compressedBlockInfoSize);
    blockInfoData = await decompressBlock(compressed, decompressedBlockInfoSize, compressionType);
    r.position = savedPos;
  } else {
    const compressed = r.readBytes(compressedBlockInfoSize);
    blockInfoData = await decompressBlock(compressed, decompressedBlockInfoSize, compressionType);
  }

  // Align to 16 bytes if flag is set
  if ((flags & 0x100) !== 0) {
    r.align(16);
  }

  const dataOffset = r.position;

  // Parse block info
  const br = new BinaryReader(blockInfoData.buffer as ArrayBuffer);
  br.skip(16); // uncompressed data hash
  const blockCount = br.readU32();

  const blocks: BlockInfo[] = [];
  for (let i = 0; i < blockCount; i++) {
    blocks.push({
      decompressedSize: br.readU32(),
      compressedSize: br.readU32(),
      flags: br.readU16(),
    });
  }

  const entryCount = br.readU32();
  const entries: DirectoryEntry[] = [];
  for (let i = 0; i < entryCount; i++) {
    entries.push({
      offset: br.readU64(),
      decompressedSize: br.readU64(),
      flags: br.readU32(),
      name: br.readNullTermString(),
    });
  }

  return { signature, formatVersion, unityVersion, generatorVersion, totalSize, blocks, entries, dataOffset, flags };
}

/* ───────── Decompress all blocks into a single data stream ───────── */
export async function decompressBundle(buffer: ArrayBuffer, info: UnityBundleInfo): Promise<Uint8Array> {
  const totalDecompressed = info.blocks.reduce((sum, b) => sum + b.decompressedSize, 0);
  const output = new Uint8Array(totalDecompressed);
  let outPos = 0;
  let readPos = info.dataOffset;

  for (const block of info.blocks) {
    const compressed = new Uint8Array(buffer, readPos, block.compressedSize);
    const compressionType = block.flags & 0x3F;
    const decompressed = await decompressBlock(compressed, block.decompressedSize, compressionType);
    output.set(decompressed, outPos);
    outPos += block.decompressedSize;
    readPos += block.compressedSize;
  }

  return output;
}
}

/* ───────── Extract assets from decompressed data ───────── */
export function extractAssets(decompressedData: Uint8Array, info: UnityBundleInfo): ExtractedAsset[] {
  const assets: ExtractedAsset[] = [];

  for (let ei = 0; ei < info.entries.length; ei++) {
    const entry = info.entries[ei];
    const entryOffset = Number(entry.offset);
    const size = Number(entry.decompressedSize);
    const entryData = decompressedData.slice(entryOffset, entryOffset + size);

    try {
      const parsed = parseSerializedFile(entryData, ei, entryOffset);
      assets.push(...parsed);
    } catch {
      assets.push({
        name: entry.name, data: entryData, type: "raw", pathId: BigInt(0),
        entryIndex: ei, absoluteDataOffset: entryOffset, objectByteSize: size,
        textAssetDataLenOffset: -1, textAssetDataBytesOffset: -1,
      });
    }
  }

  return assets;
}

/* ───────── Parse Unity Serialized File ───────── */
function parseSerializedFile(data: Uint8Array, entryIndex: number, entryAbsoluteOffset: number): ExtractedAsset[] {
  const assets: ExtractedAsset[] = [];
  const r = new BinaryReader((data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength));

  const metadataSize = r.readU32();
  const fileSize = r.readU32();
  const version = r.readU32();
  const dataOffset = r.readU32();

  if (version < 9 || version > 50) {
    return [{
      name: "unknown", data, type: "raw", pathId: BigInt(0),
      entryIndex, absoluteDataOffset: entryAbsoluteOffset, objectByteSize: data.length,
      textAssetDataLenOffset: -1, textAssetDataBytesOffset: -1,
    }];
  }

  if (version >= 9) {
    r.readU8(); // bigEndian
    r.skip(3);
  }

  if (version >= 14) {
    r.readU32(); r.readU32(); r.readU32(); r.readU32(); r.readU32();
  }

  if (version >= 7) { r.readNullTermString(); }

  const platform = r.readU32();

  if (version >= 13) {
    const hasTypeTree = r.readU8() !== 0;
    const typeCount = r.readU32();

    for (let i = 0; i < typeCount; i++) {
      const classId = r.readI32();
      if (version >= 16) r.readU8();
      if (version >= 17) r.readU16();

      if (version >= 13) {
        if ((version < 16 && classId < 0) || (version >= 16 && classId === 114)) {
          r.skip(16);
        }
        r.skip(16);
      }

      if (hasTypeTree) {
        const nodeCount = r.readU32();
        const stringBufferSize = r.readU32();
        r.skip(nodeCount * 24);
        r.skip(stringBufferSize);
      }

      if (version >= 21) { r.skip(4); }
    }
  }

  const objectCount = r.readU32();

  interface ObjectInfo {
    pathId: bigint;
    byteStart: number;
    byteSize: number;
    typeId: number;
    classId: number;
  }

  const objects: ObjectInfo[] = [];

  for (let i = 0; i < objectCount; i++) {
    if (version >= 14) r.align(4);
    let pathId: bigint;
    if (version >= 14) { pathId = r.readU64(); } else { pathId = BigInt(r.readU32()); }
    let byteStart: number;
    if (version >= 22) { byteStart = Number(r.readU64()); } else { byteStart = r.readU32(); }
    const byteSize = r.readU32();
    const typeId = r.readU32();
    let classId = typeId;
    if (version < 16) { classId = r.readU16(); r.skip(2); }
    if (version >= 15 && version < 17) { r.readU8(); }
    objects.push({ pathId, byteStart: byteStart + dataOffset, byteSize, typeId, classId });
  }

  for (const obj of objects) {
    if (obj.byteStart + obj.byteSize > data.length) continue;

    const objData = data.slice(obj.byteStart, obj.byteStart + obj.byteSize);
    const absObjOffset = entryAbsoluteOffset + obj.byteStart;

    if (obj.typeId === 49 || obj.classId === 49) {
      try {
        const textAsset = parseTextAssetWithOffsets(objData);
        assets.push({
          name: textAsset.name,
          data: textAsset.data,
          type: "TextAsset",
          pathId: obj.pathId,
          entryIndex,
          absoluteDataOffset: absObjOffset,
          objectByteSize: obj.byteSize,
          textAssetDataLenOffset: obj.byteStart + textAsset.dataLenOffset,
          textAssetDataBytesOffset: obj.byteStart + textAsset.dataBytesOffset,
        });
      } catch {
        assets.push({
          name: `object_${obj.pathId}`, data: objData, type: "TextAsset", pathId: obj.pathId,
          entryIndex, absoluteDataOffset: absObjOffset, objectByteSize: obj.byteSize,
          textAssetDataLenOffset: -1, textAssetDataBytesOffset: -1,
        });
      }
    } else {
      if (objData.length >= 8) {
        const magic = new TextDecoder().decode(objData.slice(0, 8));
        if (magic === "MsgStdBn") {
          assets.push({
            name: `msbt_${obj.pathId}`, data: objData, type: "TextAsset", pathId: obj.pathId,
            entryIndex, absoluteDataOffset: absObjOffset, objectByteSize: obj.byteSize,
            textAssetDataLenOffset: -1, textAssetDataBytesOffset: -1,
          });
          continue;
        }
      }
      assets.push({
        name: `object_${obj.pathId}`, data: objData, type: `class_${obj.classId}`, pathId: obj.pathId,
        entryIndex, absoluteDataOffset: absObjOffset, objectByteSize: obj.byteSize,
        textAssetDataLenOffset: -1, textAssetDataBytesOffset: -1,
      });
    }
  }

  return assets;
}

/* ───────── Parse TextAsset with offset tracking ───────── */
function parseTextAssetWithOffsets(data: Uint8Array): {
  name: string; data: Uint8Array; dataLenOffset: number; dataBytesOffset: number;
} {
  const r = new BinaryReader((data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength), true);

  const nameLen = r.readU32();
  const nameBytes = r.readBytes(nameLen);
  const name = new TextDecoder("utf-8").decode(nameBytes);
  r.align(4);

  const dataLenOffset = r.position;
  const dataLen = r.readU32();
  const dataBytesOffset = r.position;
  const assetData = r.readBytes(dataLen);

  return { name: name || "unnamed", data: assetData, dataLenOffset, dataBytesOffset };
}

/* ─────────────────────────────────────────────────────────────────────
   REPACK: Replace TextAssets in the decompressed stream and rebuild
   the entire UnityFS bundle.
   
   Strategy:
   For each entry (serialized file) in the bundle:
   1. Find all TextAsset objects whose data was replaced
   2. Rebuild the serialized file by copying byte-by-byte, but when we
      hit a TextAsset data region, substitute the new data
   3. Update the object table sizes and the serialized file header sizes
   4. Reassemble entries into a decompressed stream
   5. Write new UnityFS header + uncompressed block
   ───────────────────────────────────────────────────────────────────── */

export interface RepackResult {
  buffer: ArrayBuffer;
  replacedCount: number;
  newSize: number;
  originalSize: number;
}

/**
 * Repack a bundle with modified assets.
 * `replacements` maps asset name → new Uint8Array data.
 * Only TextAssets with valid offset tracking can be replaced.
 */
export function repackBundle(
  originalBuffer: ArrayBuffer,
  info: UnityBundleInfo,
  decompressedData: Uint8Array,
  assets: ExtractedAsset[],
  replacements: Map<string, Uint8Array>,
): RepackResult {
  let replacedCount = 0;

  // Group assets by entry index
  const assetsByEntry = new Map<number, ExtractedAsset[]>();
  for (const a of assets) {
    const list = assetsByEntry.get(a.entryIndex) ?? [];
    list.push(a);
    assetsByEntry.set(a.entryIndex, list);
  }

  // Build new entries data
  const newEntryBuffers: Uint8Array[] = [];
  const newEntryOffsets: number[] = [];
  let currentOffset = 0;

  for (let ei = 0; ei < info.entries.length; ei++) {
    const entry = info.entries[ei];
    const entryOffset = Number(entry.offset);
    const entrySize = Number(entry.decompressedSize);
    const entryData = decompressedData.slice(entryOffset, entryOffset + entrySize);

    const entryAssets = assetsByEntry.get(ei) ?? [];
    
    // Check if any assets in this entry need replacement
    const entryReplacements: { asset: ExtractedAsset; newData: Uint8Array }[] = [];
    for (const a of entryAssets) {
      const newData = replacements.get(a.name);
      if (newData && a.textAssetDataLenOffset >= 0 && a.textAssetDataBytesOffset >= 0) {
        entryReplacements.push({ asset: a, newData });
      }
    }

    if (entryReplacements.length === 0) {
      // No changes — copy as-is
      newEntryBuffers.push(entryData);
      newEntryOffsets.push(currentOffset);
      currentOffset += entryData.length;
      continue;
    }

    // Rebuild this serialized file with replacements
    const rebuilt = rebuildSerializedFile(entryData, entryReplacements);
    replacedCount += entryReplacements.length;
    newEntryBuffers.push(rebuilt);
    newEntryOffsets.push(currentOffset);
    currentOffset += rebuilt.length;
  }

  // Assemble new decompressed data
  const totalDecompressedSize = newEntryBuffers.reduce((s, b) => s + b.length, 0);
  const newDecompressed = new Uint8Array(totalDecompressedSize);
  let writePos = 0;
  for (const buf of newEntryBuffers) {
    newDecompressed.set(buf, writePos);
    writePos += buf.length;
  }

  // Build new directory entries
  const newEntries: DirectoryEntry[] = info.entries.map((e, i) => ({
    ...e,
    offset: BigInt(newEntryOffsets[i]),
    decompressedSize: BigInt(newEntryBuffers[i].length),
  }));

  // Write new UnityFS file (uncompressed)
  const w = new BinaryWriter(totalDecompressedSize + 4096);
  
  // Header (big-endian)
  w.writeNullTermString("UnityFS");
  w.writeU32(info.formatVersion);
  w.writeNullTermString(info.unityVersion);
  w.writeNullTermString(info.generatorVersion);

  // Placeholder for total size
  const totalSizePos = w.position;
  w.writeU64(BigInt(0));

  // Build block info
  const blockInfoBuf = buildBlockInfoBuffer(totalDecompressedSize, newEntries);

  // Compressed = decompressed (no compression)
  w.writeU32(blockInfoBuf.length);
  w.writeU32(blockInfoBuf.length);
  w.writeU32(0); // flags: no compression, inline

  // Block info
  w.writeBytes(blockInfoBuf);

  // Data
  w.writeBytes(newDecompressed);

  // Patch total size
  const totalFileSize = w.position;
  w.patchU64(totalSizePos, BigInt(totalFileSize));

  const result = w.toUint8Array();

  return {
    buffer: result.buffer as ArrayBuffer,
    replacedCount,
    newSize: totalFileSize,
    originalSize: originalBuffer.byteLength,
  };
}

/** Rebuild a serialized file with TextAsset data replacements */
function rebuildSerializedFile(
  originalData: Uint8Array,
  replacements: { asset: ExtractedAsset; newData: Uint8Array }[],
): Uint8Array {
  // Sort replacements by their data position (ascending) to process in order
  const sorted = [...replacements].sort(
    (a, b) => a.asset.textAssetDataBytesOffset - b.asset.textAssetDataBytesOffset
  );

  // We need to parse the serialized file header to know the data offset and object table
  const r = new BinaryReader((originalData.buffer as ArrayBuffer).slice(
    originalData.byteOffset, originalData.byteOffset + originalData.byteLength
  ));

  const metadataSize = r.readU32();
  const fileSize = r.readU32();
  const version = r.readU32();
  const dataOffset = r.readU32();

  // Simple approach: rebuild by segments
  // Copy everything, but replace data regions and update sizes
  
  // Build a list of "patches": regions to replace
  interface Patch {
    /** Offset of the data-length U32 (LE) in the serialized file */
    lenOffset: number;
    /** Offset of the data bytes in the serialized file */
    dataOffset: number;
    /** Original data length */
    originalLen: number;
    /** New data bytes */
    newData: Uint8Array;
  }

  const patches: Patch[] = sorted.map(({ asset, newData }) => {
    // Read original data length from the serialized file
    const lenView = new DataView(
      (originalData.buffer as ArrayBuffer).slice(originalData.byteOffset, originalData.byteOffset + originalData.byteLength)
    );
    const originalLen = lenView.getUint32(asset.textAssetDataLenOffset, true);
    const alignedOriginalLen = originalLen + ((4 - (originalLen % 4)) % 4);

    return {
      lenOffset: asset.textAssetDataLenOffset,
      dataOffset: asset.textAssetDataBytesOffset,
      originalLen: alignedOriginalLen, // include alignment padding
      newData,
    };
  });

  // Calculate new size
  let sizeDelta = 0;
  for (const p of patches) {
    const alignedNewLen = p.newData.length + ((4 - (p.newData.length % 4)) % 4);
    sizeDelta += alignedNewLen - p.originalLen;
  }

  const newSize = originalData.length + sizeDelta;
  const output = new Uint8Array(newSize);
  let srcPos = 0;
  let dstPos = 0;

  for (const p of patches) {
    // Copy everything before this patch's data-length field
    const beforeLen = p.lenOffset - srcPos;
    if (beforeLen > 0) {
      output.set(originalData.slice(srcPos, srcPos + beforeLen), dstPos);
      dstPos += beforeLen;
      srcPos += beforeLen;
    }

    // Write new data length (LE)
    const lenView = new DataView(output.buffer);
    lenView.setUint32(dstPos, p.newData.length, true);
    dstPos += 4;
    srcPos += 4; // skip original len field

    // Write new data + alignment padding
    output.set(p.newData, dstPos);
    dstPos += p.newData.length;
    const alignPad = (4 - (p.newData.length % 4)) % 4;
    dstPos += alignPad; // zero-padded (Uint8Array is zeroed)

    // Skip original data + original alignment
    srcPos += p.originalLen;
  }

  // Copy remainder
  if (srcPos < originalData.length) {
    output.set(originalData.slice(srcPos), dstPos);
    dstPos += originalData.length - srcPos;
  }

  // Update serialized file header: fileSize and metadataSize
  // The header is big-endian
  const headerView = new DataView(output.buffer);
  // metadataSize stays the same (metadata/type tree didn't change)
  headerView.setUint32(4, dstPos); // fileSize

  return output.slice(0, dstPos);
}

/** Build block info buffer for the new bundle */
function buildBlockInfoBuffer(dataSize: number, entries: DirectoryEntry[]): Uint8Array {
  const w = new BinaryWriter(4096);

  // Hash (16 zero bytes)
  for (let i = 0; i < 16; i++) w.writeU8(0);

  // Block count = 1 (single uncompressed block)
  w.writeU32(1);
  w.writeU32(dataSize); // decompressed size
  w.writeU32(dataSize); // compressed size (same, no compression)
  w.writeU16(0); // flags: no compression

  // Directory entries
  w.writeU32(entries.length);
  for (const e of entries) {
    w.writeU64(e.offset);
    w.writeU64(e.decompressedSize);
    w.writeU32(e.flags);
    w.writeNullTermString(e.name);
  }

  return w.toUint8Array();
}

/* ───────── High-level API ───────── */
export function extractBundleAssets(buffer: ArrayBuffer): {
  info: UnityBundleInfo;
  assets: ExtractedAsset[];
  decompressedData: Uint8Array;
} {
  const info = parseUnityBundle(buffer);
  const decompressedData = decompressBundle(buffer, info);
  const assets = extractAssets(decompressedData, info);
  return { info, assets, decompressedData };
}

/** Helper: check if data looks like MSBT */
export function isMsbt(data: Uint8Array): boolean {
  if (data.length < 8) return false;
  const magic = new TextDecoder().decode(data.slice(0, 8));
  return magic === "MsgStdBn";
}

/** Get human-readable info about a bundle */
export function getBundleSummary(info: UnityBundleInfo): string {
  const totalCompressed = info.blocks.reduce((s, b) => s + b.compressedSize, 0);
  const totalDecompressed = info.blocks.reduce((s, b) => s + b.decompressedSize, 0);

  return [
    `التنسيق: ${info.signature} v${info.formatVersion}`,
    `إصدار Unity: ${info.generatorVersion}`,
    `عدد الكتل: ${info.blocks.length}`,
    `الحجم المضغوط: ${(totalCompressed / 1024).toFixed(1)} KB`,
    `الحجم بعد الفك: ${(totalDecompressed / 1024).toFixed(1)} KB`,
    `عدد الملفات: ${info.entries.length}`,
  ].join("\n");
}
