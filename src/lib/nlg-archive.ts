/**
 * NLG Archive parser/repacker for Luigi's Mansion 2 HD font files.
 * Handles FEBundleFonts_res.dict / .data pairs.
 *
 * Format:
 *   .dict — index file with magic 0xA9F32458
 *   .data — raw data blob referenced by .dict offsets
 */

import pako from "pako";

export const NLG_MAGIC = 0xA9F32458;

export interface NLGFileEntry {
  index: number;
  offset: number;
  decompressedLength: number;
  compressedLength: number;
  unk: number; // unknown field preserved for repacking
}

export interface NLGArchiveInfo {
  magic: number;
  isCompressed: boolean;
  fileCount: number;
  entries: NLGFileEntry[];
  /** Raw bytes between magic and file table (header region) */
  headerBytes: Uint8Array;
  /** Unknown byte array between 0x2C and file table */
  unkArray: Uint8Array;
  /** Any footer bytes after the file table */
  footerBytes: Uint8Array;
}

export interface NLGExtractedFile {
  index: number;
  data: Uint8Array;
  wasCompressed: boolean;
  /** How this file was compressed originally (used to preserve round-trip fidelity) */
  compressionMode?: "none" | "zlib" | "raw";
  originalEntry: NLGFileEntry;
}

/**
 * Parse a .dict file and return archive metadata + file table.
 */
export function parseNLGDict(dictData: Uint8Array): NLGArchiveInfo {
  const view = new DataView(dictData.buffer, dictData.byteOffset, dictData.byteLength);

  const magic = view.getUint32(0, true);
  if (magic !== NLG_MAGIC) {
    throw new Error(`Invalid NLG magic: 0x${magic.toString(16).toUpperCase()}, expected 0x${NLG_MAGIC.toString(16).toUpperCase()}`);
  }

  const compressionFlag = dictData[0x6];
  const isCompressed = compressionFlag !== 0;

  const fileCount = view.getUint32(0x8, true);

  // Save header bytes (0x00 to 0x2C)
  const headerBytes = dictData.slice(0, 0x2C);

  // Unknown array: fileCount bytes starting at 0x2C
  const unkArray = dictData.slice(0x2C, 0x2C + fileCount);

  // File table starts at 0x2C + fileCount
  const tableStart = 0x2C + fileCount;
  const entries: NLGFileEntry[] = [];

  for (let i = 0; i < fileCount; i++) {
    const entryOff = tableStart + i * 16;
    if (entryOff + 16 > dictData.length) break;

    entries.push({
      index: i,
      offset: view.getUint32(entryOff, true),
      decompressedLength: view.getUint32(entryOff + 4, true),
      compressedLength: view.getUint32(entryOff + 8, true),
      unk: view.getUint32(entryOff + 12, true),
    });
  }

  // Footer: anything after the file table
  const tableEnd = tableStart + fileCount * 16;
  const footerBytes = tableEnd < dictData.length
    ? dictData.slice(tableEnd)
    : new Uint8Array(0);

  return { magic, isCompressed, fileCount, entries, headerBytes, unkArray, footerBytes };
}

/**
 * Extract all files from .data using parsed .dict info.
 * Handles zlib decompression if the archive is compressed.
 */
export function extractNLGFiles(
  archiveInfo: NLGArchiveInfo,
  dataData: Uint8Array,
): NLGExtractedFile[] {
  const files: NLGExtractedFile[] = [];

  for (const entry of archiveInfo.entries) {
    try {
      const readLength = archiveInfo.isCompressed && entry.compressedLength > 0
        ? entry.compressedLength
        : entry.decompressedLength;

      if (entry.offset + readLength > dataData.length) {
        console.warn(`NLG: File ${entry.index} extends beyond data (offset=0x${entry.offset.toString(16)}, len=${readLength}, dataLen=${dataData.length})`);
        // Extract what we can
        const available = dataData.slice(entry.offset, Math.min(entry.offset + readLength, dataData.length));
        files.push({
          index: entry.index,
          data: available,
          wasCompressed: false,
          compressionMode: "none",
          originalEntry: entry,
        });
        continue;
      }

      const rawData = dataData.slice(entry.offset, entry.offset + readLength);

      if (archiveInfo.isCompressed && entry.compressedLength > 0 && entry.compressedLength !== entry.decompressedLength) {
        try {
          const decompressed = pako.inflate(rawData);
          files.push({
            index: entry.index,
            data: decompressed,
            wasCompressed: true,
            compressionMode: "zlib",
            originalEntry: entry,
          });
        } catch {
          // If decompression fails, try raw inflate (no header)
          try {
            const decompressed = pako.inflateRaw(rawData);
            files.push({
              index: entry.index,
              data: decompressed,
              wasCompressed: true,
              compressionMode: "raw",
              originalEntry: entry,
            });
          } catch {
            console.warn(`NLG: Failed to decompress file ${entry.index}, saving raw`);
            files.push({
              index: entry.index,
              data: rawData,
              wasCompressed: false,
              compressionMode: "none",
              originalEntry: entry,
            });
          }
        }
      } else {
        files.push({
          index: entry.index,
          data: rawData,
          wasCompressed: false,
          compressionMode: "none",
          originalEntry: entry,
        });
      }
    } catch (err) {
      console.error(`NLG: Error extracting file ${entry.index}:`, err);
    }
  }

  return files;
}

/**
 * Detect file type from content.
 */
export function detectFileType(data: Uint8Array): string {
  if (data.length < 4) return "unknown";

  // DDS magic: "DDS "
  if (data[0] === 0x44 && data[1] === 0x44 && data[2] === 0x53 && data[3] === 0x20) {
    return "DDS";
  }

  // Check for common patterns
  // Text-like (high ASCII content)
  let textCount = 0;
  const checkLen = Math.min(data.length, 256);
  for (let i = 0; i < checkLen; i++) {
    if ((data[i] >= 0x20 && data[i] <= 0x7E) || data[i] === 0x0A || data[i] === 0x0D) {
      textCount++;
    }
  }
  if (textCount / checkLen > 0.8) return "text";

  return "binary";
}

/** Alignment constant for repacking */
const ALIGNMENT = 0x10; // 16-byte alignment

/**
 * Repack extracted (possibly modified) files back into .dict + .data pair.
 * Supports adding new files beyond the original count.
 */
export function repackNLGArchive(
  originalInfo: NLGArchiveInfo,
  files: NLGExtractedFile[],
): { dict: Uint8Array; data: Uint8Array } {
  // Sort files by index
  const sorted = [...files].sort((a, b) => a.index - b.index);
  const newFileCount = sorted.length;

  // Build new .data
  const dataChunks: Uint8Array[] = [];
  const newEntries: NLGFileEntry[] = [];
  let currentOffset = 0;

  for (let i = 0; i < sorted.length; i++) {
    const file = sorted[i];

    // Align to ALIGNMENT boundary (except first file)
    if (i > 0 && currentOffset % ALIGNMENT !== 0) {
      const padding = ALIGNMENT - (currentOffset % ALIGNMENT);
      dataChunks.push(new Uint8Array(padding));
      currentOffset += padding;
    }

    let writeData: Uint8Array;
    let compressedLength: number;
    let decompressedLength: number;

    if (originalInfo.isCompressed && file.wasCompressed) {
      // Re-compress
      decompressedLength = file.data.length;
      try {
        const compressionMode = file.compressionMode ?? "zlib";
        writeData = compressionMode === "raw"
          ? pako.deflateRaw(file.data)
          : pako.deflate(file.data);
        compressedLength = writeData.length;
      } catch {
        writeData = file.data;
        compressedLength = decompressedLength;
      }
    } else {
      writeData = file.data;
      decompressedLength = file.data.length;
      compressedLength = decompressedLength;
    }

    // Preserve unk from original entry if available
    const unk = file.originalEntry?.unk ?? 0;

    newEntries.push({
      index: i,
      offset: currentOffset,
      decompressedLength,
      compressedLength,
      unk,
    });

    dataChunks.push(writeData);
    currentOffset += writeData.length;
  }

  // Concatenate data
  const totalDataSize = dataChunks.reduce((s, c) => s + c.length, 0);
  const newData = new Uint8Array(totalDataSize);
  let writePos = 0;
  for (const chunk of dataChunks) {
    newData.set(chunk, writePos);
    writePos += chunk.length;
  }

  // Build new .dict
  // Header (0x2C bytes) + unkArray (fileCount bytes) + file table (fileCount * 16 bytes) + footer
  const newUnkArray = new Uint8Array(newFileCount);
  const inferredUnkByte = (() => {
    if (originalInfo.unkArray.length === 0) return 0;
    const counts = new Map<number, number>();
    for (const v of originalInfo.unkArray) {
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    let bestValue = 0;
    let bestCount = -1;
    for (const [value, count] of counts) {
      if (count > bestCount) {
        bestValue = value;
        bestCount = count;
      }
    }
    return bestValue;
  })();

  // Copy from original unkArray where available
  for (let i = 0; i < newFileCount; i++) {
    newUnkArray[i] = i < originalInfo.unkArray.length ? originalInfo.unkArray[i] : inferredUnkByte;
  }

  const dictSize = 0x2C + newFileCount + newFileCount * 16 + originalInfo.footerBytes.length;
  const newDict = new Uint8Array(dictSize);
  const dictView = new DataView(newDict.buffer);

  // Copy header
  newDict.set(originalInfo.headerBytes.slice(0, 0x2C), 0);

  // Update file count
  dictView.setUint32(0x8, newFileCount, true);

  // Write unkArray
  newDict.set(newUnkArray, 0x2C);

  // Write file table
  const tableStart = 0x2C + newFileCount;
  for (let i = 0; i < newEntries.length; i++) {
    const e = newEntries[i];
    const off = tableStart + i * 16;
    dictView.setUint32(off, e.offset, true);
    dictView.setUint32(off + 4, e.decompressedLength, true);
    dictView.setUint32(off + 8, e.compressedLength, true);
    dictView.setUint32(off + 12, e.unk, true);
  }

  // Write footer
  if (originalInfo.footerBytes.length > 0) {
    newDict.set(originalInfo.footerBytes, tableStart + newFileCount * 16);
  }

  return { dict: newDict, data: newData };
}

/**
 * Human-readable file size.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
