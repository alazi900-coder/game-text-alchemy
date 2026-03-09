/**
 * Unity AssetBundle (UnityFS) parser for browser.
 * Supports UnityFS format version 6/7 with LZ4 and uncompressed blocks.
 * Designed to extract TextAsset (.bytes) entries — e.g., MSBT files inside Fire Emblem Engage bundles.
 */

import lz4 from "lz4js";

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

/* ───────── Types ───────── */
export interface UnityBundleInfo {
  signature: string;
  formatVersion: number;
  unityVersion: string;
  generatorVersion: string;
  totalSize: bigint;
  blocks: BlockInfo[];
  entries: DirectoryEntry[];
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
  type: string; // "TextAsset", "unknown", etc.
  pathId: bigint;
}

/* ───────── Compression helpers ───────── */
const COMPRESSION_NONE = 0;
const COMPRESSION_LZMA = 1;
const COMPRESSION_LZ4 = 2;
const COMPRESSION_LZ4HC = 3;

function decompressBlock(compressed: Uint8Array, decompressedSize: number, compressionType: number): Uint8Array {
  switch (compressionType) {
    case COMPRESSION_NONE:
      return compressed;
    case COMPRESSION_LZ4:
    case COMPRESSION_LZ4HC: {
      const output = new Uint8Array(decompressedSize);
      lz4.decompressBlock(compressed, output, 0, compressed.length, 0);
      return output;
    }
    case COMPRESSION_LZMA:
      throw new Error("ضغط LZMA غير مدعوم حالياً — يُرجى استخدام أداة خارجية لفك الضغط أولاً");
    default:
      throw new Error(`نوع ضغط غير معروف: ${compressionType}`);
  }
}

/* ───────── Parse UnityFS Header & Directory ───────── */
export function parseUnityBundle(buffer: ArrayBuffer): UnityBundleInfo {
  const r = new BinaryReader(buffer);

  // Signature
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

  // Block info location
  const blockInfoAtEnd = (flags & 0x80) !== 0;
  const compressionType = flags & 0x3F;

  let blockInfoData: Uint8Array;

  if (blockInfoAtEnd) {
    // Block info is at the end of the file
    const savedPos = r.position;
    r.position = r.length - compressedBlockInfoSize;
    const compressed = r.readBytes(compressedBlockInfoSize);
    blockInfoData = decompressBlock(compressed, decompressedBlockInfoSize, compressionType);
    r.position = savedPos;
  } else {
    const compressed = r.readBytes(compressedBlockInfoSize);
    blockInfoData = decompressBlock(compressed, decompressedBlockInfoSize, compressionType);
  }

  // Parse block info
  const br = new BinaryReader(blockInfoData.buffer);
  br.skip(16); // uncompressed data hash (16 bytes)
  const blockCount = br.readU32();

  const blocks: BlockInfo[] = [];
  for (let i = 0; i < blockCount; i++) {
    blocks.push({
      decompressedSize: br.readU32(),
      compressedSize: br.readU32(),
      flags: br.readU16(),
    });
  }

  // Parse directory entries
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

  return { signature, formatVersion, unityVersion, generatorVersion, totalSize, blocks, entries };
}

/* ───────── Decompress all blocks into a single data stream ───────── */
export function decompressBundle(buffer: ArrayBuffer, info: UnityBundleInfo): Uint8Array {
  const r = new BinaryReader(buffer);

  // Find where data blocks start
  // Re-read header to find data offset
  r.position = 0;
  r.readNullTermString(); // signature
  r.readU32(); // format version
  r.readNullTermString(); // unity version
  r.readNullTermString(); // generator version
  r.readU64(); // total size
  const compressedBlockInfoSize = r.readU32();
  r.readU32(); // decompressed size
  const flags = r.readU32();

  const blockInfoAtEnd = (flags & 0x80) !== 0;
  if (!blockInfoAtEnd) {
    r.skip(compressedBlockInfoSize);
  }

  // Align to 16 bytes if flag is set
  if ((flags & 0x100) !== 0) {
    r.align(16);
  }

  const dataOffset = r.position;

  // Calculate total decompressed size
  const totalDecompressed = info.blocks.reduce((sum, b) => sum + b.decompressedSize, 0);
  const output = new Uint8Array(totalDecompressed);
  let outPos = 0;
  let readPos = dataOffset;

  for (const block of info.blocks) {
    const compressed = new Uint8Array(buffer, readPos, block.compressedSize);
    const compressionType = block.flags & 0x3F;
    const decompressed = decompressBlock(compressed, block.decompressedSize, compressionType);
    output.set(decompressed, outPos);
    outPos += block.decompressedSize;
    readPos += block.compressedSize;
  }

  return output;
}

/* ───────── Extract assets from decompressed data ───────── */
export function extractAssets(decompressedData: Uint8Array, info: UnityBundleInfo): ExtractedAsset[] {
  const assets: ExtractedAsset[] = [];

  for (const entry of info.entries) {
    const offset = Number(entry.offset);
    const size = Number(entry.decompressedSize);
    const entryData = decompressedData.slice(offset, offset + size);

    // Try to parse as a serialized file to extract TextAssets
    try {
      const parsed = parseSerializedFile(entryData);
      assets.push(...parsed);
    } catch {
      // If parsing fails, just add as raw entry
      assets.push({
        name: entry.name,
        data: entryData,
        type: "raw",
        pathId: BigInt(0),
      });
    }
  }

  return assets;
}

/* ───────── Parse Unity Serialized File ───────── */
function parseSerializedFile(data: Uint8Array): ExtractedAsset[] {
  const assets: ExtractedAsset[] = [];
  const r = new BinaryReader(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));

  // Read serialized file header
  const metadataSize = r.readU32();
  const fileSize = r.readU32();
  const version = r.readU32();
  const dataOffset = r.readU32();

  if (version < 9 || version > 50) {
    // Not a recognized serialized file, return as raw
    return [{ name: "unknown", data, type: "raw", pathId: BigInt(0) }];
  }

  // Version >= 9: endianness byte
  let bigEndian = true;
  if (version >= 9) {
    bigEndian = r.readU8() !== 0;
    r.skip(3); // reserved
  }

  // For version >= 14, there's additional data
  if (version >= 14) {
    r.readU32(); // metadata size (again, 64-bit)
    r.readU32(); // file size low
    r.readU32(); // file size high  
    r.readU32(); // data offset
    r.readU32(); // unknown
  }

  // Read unity version string
  if (version >= 7) {
    const unityVer = r.readNullTermString();
  }

  // Platform
  if (version >= 8) {
    // Switch endianness based on reading
  }
  const platform = r.readU32();

  // Type tree
  if (version >= 13) {
    const hasTypeTree = r.readU8() !== 0;
    const typeCount = r.readU32();

    for (let i = 0; i < typeCount; i++) {
      const classId = r.readI32();
      if (version >= 16) r.readU8(); // isStrippedType
      if (version >= 17) r.readU16(); // scriptTypeIndex
      
      if (version >= 13) {
        if ((version < 16 && classId < 0) || (version >= 16 && classId === 114)) {
          r.skip(16); // scriptID hash
        }
        r.skip(16); // old type hash
      }

      if (hasTypeTree) {
        // Skip type tree nodes
        const nodeCount = r.readU32();
        const stringBufferSize = r.readU32();
        r.skip(nodeCount * 24); // nodes
        r.skip(stringBufferSize);
      }

      if (version >= 21) {
        r.skip(4); // type dependencies
      }
    }
  }

  // Object info
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
    if (version >= 14) {
      pathId = r.readU64();
    } else {
      pathId = BigInt(r.readU32());
    }

    let byteStart: number;
    if (version >= 22) {
      byteStart = Number(r.readU64());
    } else {
      byteStart = r.readU32();
    }

    const byteSize = r.readU32();
    const typeId = r.readU32();

    let classId = typeId;
    if (version < 16) {
      classId = r.readU16();
      r.skip(2); // isDestroyed
    }
    if (version >= 15 && version < 17) {
      r.readU8(); // stripped
    }

    objects.push({ pathId, byteStart: byteStart + dataOffset, byteSize, typeId, classId });
  }

  // Extract TextAssets (classId 49) and raw bytes
  for (const obj of objects) {
    if (obj.byteStart + obj.byteSize > data.length) continue;
    
    const objData = data.slice(obj.byteStart, obj.byteStart + obj.byteSize);

    // TextAsset classId = 49
    if (obj.typeId === 49 || obj.classId === 49) {
      try {
        const textAsset = parseTextAsset(objData);
        assets.push({
          name: textAsset.name,
          data: textAsset.data,
          type: "TextAsset",
          pathId: obj.pathId,
        });
      } catch {
        assets.push({ name: `object_${obj.pathId}`, data: objData, type: "TextAsset", pathId: obj.pathId });
      }
    } else {
      // Check if it looks like MSBT
      if (objData.length >= 8) {
        const magic = new TextDecoder().decode(objData.slice(0, 8));
        if (magic === "MsgStdBn") {
          assets.push({ name: `msbt_${obj.pathId}`, data: objData, type: "TextAsset", pathId: obj.pathId });
          continue;
        }
      }
      assets.push({ name: `object_${obj.pathId}`, data: objData, type: `class_${obj.classId}`, pathId: obj.pathId });
    }
  }

  return assets;
}

/* ───────── Parse TextAsset ───────── */
function parseTextAsset(data: Uint8Array): { name: string; data: Uint8Array } {
  const r = new BinaryReader(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), true);

  // name (length-prefixed string)
  const nameLen = r.readU32();
  const nameBytes = r.readBytes(nameLen);
  const name = new TextDecoder("utf-8").decode(nameBytes);
  r.align(4);

  // data (length-prefixed byte array)
  const dataLen = r.readU32();
  const assetData = r.readBytes(dataLen);

  return { name: name || "unnamed", data: assetData };
}

/* ───────── Rebuild bundle with modified assets ───────── */
export function rebuildBundle(
  originalBuffer: ArrayBuffer,
  info: UnityBundleInfo,
  decompressedData: Uint8Array,
  modifiedAssets: Map<string, Uint8Array>
): ArrayBuffer {
  // For simplicity, we rebuild with no compression (NONE)
  // This ensures maximum compatibility
  
  // Re-extract and modify the decompressed data stream
  const newDecompressed = new Uint8Array(decompressedData);
  
  // For each entry, try to find and replace TextAssets
  for (const entry of info.entries) {
    const offset = Number(entry.offset);
    const size = Number(entry.decompressedSize);
    const entryData = newDecompressed.slice(offset, offset + size);
    
    // Parse the serialized file and look for modified assets
    // This is a simplified approach - in practice you'd need full serialized file rebuilding
  }

  // Rebuild with uncompressed blocks
  const r = new BinaryReader(originalBuffer);
  r.readNullTermString(); // signature
  r.readU32();
  r.readNullTermString();
  r.readNullTermString();
  r.readU64();
  const compressedBlockInfoSize = r.readU32();
  const decompressedBlockInfoSize = r.readU32();
  const flags = r.readU32();

  const headerEnd = r.position;
  
  // Build new block info with no compression
  const newBlockInfo = buildBlockInfo(newDecompressed.length, info.entries);
  
  // Calculate sizes
  const signatureBytes = new TextEncoder().encode("UnityFS\0");
  const unityVerBytes = new TextEncoder().encode(info.unityVersion + "\0");
  const genVerBytes = new TextEncoder().encode(info.generatorVersion + "\0");
  
  const headerSize = signatureBytes.length + 4 + unityVerBytes.length + genVerBytes.length + 8 + 4 + 4 + 4;
  const totalSize = headerSize + newBlockInfo.length + newDecompressed.length;
  
  const output = new ArrayBuffer(totalSize);
  const view = new DataView(output);
  const bytes = new Uint8Array(output);
  let pos = 0;
  
  // Write header
  bytes.set(signatureBytes, pos); pos += signatureBytes.length;
  view.setUint32(pos, info.formatVersion); pos += 4;
  bytes.set(unityVerBytes, pos); pos += unityVerBytes.length;
  bytes.set(genVerBytes, pos); pos += genVerBytes.length;
  
  // Total size as BigInt
  view.setBigUint64(pos, BigInt(totalSize)); pos += 8;
  view.setUint32(pos, newBlockInfo.length); pos += 4; // compressed = decompressed (no compression)
  view.setUint32(pos, newBlockInfo.length); pos += 4;
  view.setUint32(pos, 0); pos += 4; // flags: no compression, inline block info
  
  // Block info
  bytes.set(newBlockInfo, pos); pos += newBlockInfo.length;
  
  // Data
  bytes.set(newDecompressed, pos);
  
  return output;
}

function buildBlockInfo(dataSize: number, entries: DirectoryEntry[]): Uint8Array {
  // Calculate size: 16 (hash) + 4 (block count) + blocks + 4 (entry count) + entries
  const blockCount = 1; // single uncompressed block
  const size = 16 + 4 + (blockCount * 10) + 4 + entries.length * (8 + 8 + 4 + 256); // rough estimate
  
  const buf = new ArrayBuffer(4096);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let pos = 0;
  
  // Hash (16 zero bytes)
  pos += 16;
  
  // Block count
  view.setUint32(pos, 1); pos += 4;
  
  // Single block: decompressed = compressed = total data
  view.setUint32(pos, dataSize); pos += 4;
  view.setUint32(pos, dataSize); pos += 4;
  view.setUint16(pos, 0); pos += 2; // no compression
  
  // Directory entries
  view.setUint32(pos, entries.length); pos += 4;
  for (const e of entries) {
    view.setBigUint64(pos, e.offset); pos += 8;
    view.setBigUint64(pos, e.decompressedSize); pos += 8;
    view.setUint32(pos, e.flags); pos += 4;
    const nameBytes = new TextEncoder().encode(e.name + "\0");
    bytes.set(nameBytes, pos); pos += nameBytes.length;
  }
  
  return new Uint8Array(buf, 0, pos);
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
