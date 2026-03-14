import { describe, it, expect } from "vitest";
import {
  parseUnityBundle,
  decompressBundle,
  extractAssets,
  repackBundle,
  isMsbt,
} from "@/lib/unity-asset-bundle";
import type { ExtractedAsset } from "@/lib/unity-asset-bundle";

/* ───────── Helpers to build a synthetic UnityFS bundle ───────── */

class TestWriter {
  private buf: Uint8Array;
  private view: DataView;
  private pos = 0;

  constructor(size = 8192) {
    this.buf = new Uint8Array(size);
    this.view = new DataView(this.buf.buffer);
  }

  get position() { return this.pos; }
  set position(v: number) { this.pos = v; }

  writeU8(v: number) { this.view.setUint8(this.pos++, v); }
  writeU16BE(v: number) { this.view.setUint16(this.pos, v, false); this.pos += 2; }
  writeU32BE(v: number) { this.view.setUint32(this.pos, v, false); this.pos += 4; }
  writeU32LE(v: number) { this.view.setUint32(this.pos, v, true); this.pos += 4; }
  writeU64BE(v: bigint) { this.view.setBigUint64(this.pos, v, false); this.pos += 8; }

  writeNullTermString(s: string) {
    const b = new TextEncoder().encode(s);
    this.buf.set(b, this.pos);
    this.pos += b.length;
    this.writeU8(0);
  }

  writeBytes(data: Uint8Array) {
    this.buf.set(data, this.pos);
    this.pos += data.length;
  }

  align(n: number) {
    const m = this.pos % n;
    if (m) this.pos += n - m;
  }

  patchU32BE(offset: number, value: number) {
    this.view.setUint32(offset, value, false);
  }
  patchU64BE(offset: number, value: bigint) {
    this.view.setBigUint64(offset, value, false);
  }

  toArrayBuffer(): ArrayBuffer {
    return this.buf.slice(0, this.pos).buffer as ArrayBuffer;
  }
}

/**
 * Build a fake MSBT binary with MsgStdBn header.
 * Layout: "MsgStdBn" (8) + BOM (2) + padding (8) + file_size LE u32 (4) + body
 */
function buildMsbt(body: Uint8Array): Uint8Array {
  const headerSize = 22;
  const totalSize = headerSize + body.length;
  const msbt = new Uint8Array(totalSize);
  // Magic
  const magic = new TextEncoder().encode("MsgStdBn");
  msbt.set(magic, 0);
  // BOM
  msbt[8] = 0xFF; msbt[9] = 0xFE;
  // file_size at offset 18 (LE)
  new DataView(msbt.buffer).setUint32(18, totalSize, true);
  msbt.set(body, headerSize);
  return msbt;
}

/**
 * Build a fake serialized file that triggers the v22 fallback path
 * (version read as 0 → createRawOrEmbeddedMsbtAsset → offsets = -1).
 *
 * We simulate a v22 serialized file where the first 4 bytes are metadataSize,
 * then 8 bytes fileSize (u64), then version at a different offset.
 * Since parseSerializedFile reads version at offset 8 as u32 (expecting old format),
 * it gets 0 and falls back to createRawOrEmbeddedMsbtAsset.
 *
 * Layout:
 *   [0-3]   metadataSize = 0 (BE u32)
 *   [4-11]  fileSize = totalLen (BE u64, but parser reads only [4-7] as u32 = 0)
 *   [8-11]  (parser reads this as version = 0 since fileSize high bytes = 0)
 *   [12-15] dataOffset = 0 (BE u32, parser reads [12-15])
 *   [16-19] padding
 *   [20-23] dataLen = msbt.length (LE u32) ← the TextAsset data length
 *   [24..]  MSBT data
 *   [after]  trailer bytes
 */
function buildFakeSerializedFileV22(msbt: Uint8Array): Uint8Array {
  const prefixLen = 20; // header
  const dataLenFieldLen = 4;
  const trailerLen = 8;
  const totalLen = prefixLen + dataLenFieldLen + msbt.length + trailerLen;

  const data = new Uint8Array(totalLen);
  const view = new DataView(data.buffer);

  // metadataSize (BE u32) = 0
  view.setUint32(0, 0, false);
  // fileSize (BE u64) — high 32 bits = 0, low 32 bits = totalLen
  // The parser reads offset 4 as u32 → 0, offset 8 as u32 → totalLen (but that's > 50, hmm)
  // Actually we need version to be read as < 9 or > 50 at offset 8
  // Let's make the full u64 such that bytes [4-7] = 0 and bytes [8-11] = something out of [9,50]
  view.setUint32(4, 0, false);      // fileSize high = 0 → parser reads as fileSize=0
  view.setUint32(8, 0, false);      // parser reads this as version=0 → falls back!
  view.setUint32(12, 0, false);     // dataOffset=0

  // dataLen at offset 20 (LE) = msbt length
  view.setUint32(20, msbt.length, true);

  // MSBT data at offset 24
  data.set(msbt, 24);

  // Trailer
  const trailerStart = 24 + msbt.length;
  data[trailerStart] = 0xCA;
  data[trailerStart + 1] = 0xFE;
  data[trailerStart + 2] = 0xBA;
  data[trailerStart + 3] = 0xBE;
  data[trailerStart + 4] = 0xDE;
  data[trailerStart + 5] = 0xAD;
  data[trailerStart + 6] = 0x00;
  data[trailerStart + 7] = 0x00;

  return data;
}

/**
 * Build a complete synthetic UnityFS bundle (uncompressed, no LZ4).
 * Format version 6, flags = 0 (no compression, block info inline).
 */
function buildSyntheticBundle(entryData: Uint8Array, entryName: string): ArrayBuffer {
  // Block info (uncompressed)
  const blockInfo = buildBlockInfo(entryData.length, entryName);

  const w = new TestWriter(entryData.length + blockInfo.length + 512);

  // Header
  w.writeNullTermString("UnityFS");  // signature
  w.writeU32BE(6);                    // formatVersion
  w.writeNullTermString("5.x.x");    // unityVersion
  w.writeNullTermString("2020.3.18f1"); // generatorVersion

  const totalSizePos = w.position;
  w.writeU64BE(BigInt(0));            // totalSize placeholder

  w.writeU32BE(blockInfo.length);     // compressed block info size
  w.writeU32BE(blockInfo.length);     // decompressed block info size
  w.writeU32BE(0);                    // flags = 0 (no compression, inline block info)

  // Block info (inline, before data)
  w.writeBytes(blockInfo);

  // Data
  w.writeBytes(entryData);

  // Patch total size
  const totalSize = w.position;
  w.patchU64BE(totalSizePos, BigInt(totalSize));

  return w.toArrayBuffer();
}

/**
 * Build block info buffer matching parseUnityBundle expectations:
 *   16 bytes hash + blockCount(u32) + [decompSize(u32) + compSize(u32) + flags(u16)] + entryCount(u32) + entries
 */
function buildBlockInfo(dataSize: number, entryName: string): Uint8Array {
  const w = new TestWriter(512);

  // 16 bytes hash (zeros)
  for (let i = 0; i < 16; i++) w.writeU8(0);

  // 1 block
  w.writeU32BE(1);
  w.writeU32BE(dataSize);  // decompressed
  w.writeU32BE(dataSize);  // compressed (same, no compression)
  w.writeU16BE(0);         // flags = COMPRESSION_NONE

  // 1 directory entry
  w.writeU32BE(1);
  w.writeU64BE(BigInt(0));             // offset
  w.writeU64BE(BigInt(dataSize));      // decompressed size
  w.writeU32BE(0);                     // flags
  w.writeNullTermString(entryName);    // name

  return new Uint8Array(w.toArrayBuffer());
}

/**
 * Build a serialized file with a valid header but zero objects.
 * This simulates files where parser metadata succeeds but object table is empty,
 * while MSBT bytes still exist in the payload tail.
 */
function buildSerializedWithZeroObjectsAndEmbeddedMsbt(msbt: Uint8Array): Uint8Array {
  const w = new TestWriter(1024 + msbt.length);

  // Header (big-endian)
  w.writeU32BE(0);   // metadataSize
  w.writeU32BE(0);   // fileSize (not trusted by parser here)
  w.writeU32BE(22);  // version
  w.writeU32BE(0);   // dataOffset

  // Endianness flag + padding
  w.writeU8(1);      // bigEndian = true
  w.writeU8(0); w.writeU8(0); w.writeU8(0);

  // v14+ extra header fields
  w.writeU32BE(0); w.writeU32BE(0); w.writeU32BE(0); w.writeU32BE(0); w.writeU32BE(0);

  // v7+ unity version string (empty)
  w.writeU8(0);

  // platform
  w.writeU32BE(0);

  // v13+ type tree metadata
  w.writeU8(0);      // hasTypeTree=false
  w.writeU32BE(0);   // typeCount=0

  // objectCount = 0
  w.writeU32BE(0);

  // Tail payload containing embedded MSBT
  w.writeBytes(msbt);

  return new Uint8Array(w.toArrayBuffer());
}

/* ───────── Tests ───────── */

describe("repackBundle with embedded MSBT (v22 fallback)", () => {
  it("full round-trip: parse → extract → repack with new MSBT", async () => {
    // 1. Build original MSBT
    const originalBody = new TextEncoder().encode("Original English text here");
    const originalMsbt = buildMsbt(originalBody);

    // 2. Build fake v22 serialized file containing the MSBT
    const serializedFile = buildFakeSerializedFileV22(originalMsbt);

    // 3. Wrap in UnityFS bundle
    const bundleBuffer = buildSyntheticBundle(serializedFile, "test_entry.msbt");

    // 4. Parse the bundle
    const info = await parseUnityBundle(bundleBuffer);
    expect(info.signature).toBe("UnityFS");
    expect(info.entries.length).toBe(1);

    // 5. Decompress (no compression, should return as-is)
    const decompressed = await decompressBundle(bundleBuffer, info);
    expect(decompressed.length).toBe(serializedFile.length);

    // 6. Extract assets — should find the embedded MSBT with offsets = -1
    const assets = extractAssets(decompressed, info);
    const msbtAssets = assets.filter(a => isMsbt(a.data));
    expect(msbtAssets.length).toBe(1);
    expect(msbtAssets[0].textAssetDataLenOffset).toBe(-1);
    expect(msbtAssets[0].textAssetDataBytesOffset).toBe(-1);

    // 7. Build replacement MSBT (Arabic)
    const newBody = new TextEncoder().encode("النص العربي المترجم هنا");
    const newMsbt = buildMsbt(newBody);

    // 8. Create replacements map
    const replacements = new Map<string, Uint8Array>();
    const key = `${msbtAssets[0].name}#${msbtAssets[0].pathId.toString()}`;
    replacements.set(key, newMsbt);

    // 9. Repack
    const result = repackBundle(bundleBuffer, info, decompressed, assets, replacements);

    // Should have replaced 1 asset
    expect(result.replacedCount).toBe(1);

    // 10. Re-parse the repacked bundle to verify
    const newInfo = await parseUnityBundle(result.buffer);
    expect(newInfo.signature).toBe("UnityFS");

    const newDecompressed = await decompressBundle(result.buffer, newInfo);
    const newAssets = extractAssets(newDecompressed, newInfo);
    const newMsbtAssets = newAssets.filter(a => isMsbt(a.data));

    expect(newMsbtAssets.length).toBe(1);

    // Verify Arabic text is in the repacked MSBT
    const msbtData = newMsbtAssets[0].data;
    const textDecoder = new TextDecoder();
    const msbtText = textDecoder.decode(msbtData);
    expect(msbtText).toContain("النص العربي المترجم هنا");
  });

  it("returns original buffer when replacement is byte-identical", async () => {
    const body = new TextEncoder().encode("Same text");
    const msbt = buildMsbt(body);
    const serialized = buildFakeSerializedFileV22(msbt);
    const bundle = buildSyntheticBundle(serialized, "same.msbt");

    const info = await parseUnityBundle(bundle);
    const decompressed = await decompressBundle(bundle, info);
    const assets = extractAssets(decompressed, info);
    const msbtAssets = assets.filter(a => isMsbt(a.data));

    // Replace with identical MSBT data
    const replacements = new Map<string, Uint8Array>();
    const key = `${msbtAssets[0].name}#${msbtAssets[0].pathId.toString()}`;
    replacements.set(key, msbtAssets[0].data);

    const result = repackBundle(bundle, info, decompressed, assets, replacements);

    // No replacement should occur (byte-identical skip)
    expect(result.replacedCount).toBe(0);
  });

  it("handles size growth correctly (larger MSBT)", async () => {
    const smallBody = new TextEncoder().encode("Hi");
    const smallMsbt = buildMsbt(smallBody);
    const serialized = buildFakeSerializedFileV22(smallMsbt);
    const bundle = buildSyntheticBundle(serialized, "grow.msbt");

    const info = await parseUnityBundle(bundle);
    const decompressed = await decompressBundle(bundle, info);
    const assets = extractAssets(decompressed, info);
    const msbtAssets = assets.filter(a => isMsbt(a.data));

    // Much larger replacement
    const bigBody = new TextEncoder().encode("This is a significantly larger replacement text with lots of Arabic: مرحبا بالعالم العربي الكبير");
    const bigMsbt = buildMsbt(bigBody);

    const replacements = new Map<string, Uint8Array>();
    replacements.set(`${msbtAssets[0].name}#${msbtAssets[0].pathId.toString()}`, bigMsbt);

    const result = repackBundle(bundle, info, decompressed, assets, replacements);
    expect(result.replacedCount).toBe(1);
    expect(result.newSize).toBeGreaterThan(bundle.byteLength);

    // Verify repacked bundle header size matches actual buffer
    const headerView = new DataView(result.buffer);
    // Skip "UnityFS\0" (8 bytes) + formatVersion (4) + "5.x.x\0" (6) + "2020.3.18f1\0" (12) = 30
    // totalSize is at offset 30 as u64
    // Just verify buffer is consistent
    expect(result.buffer.byteLength).toBe(result.newSize);
  });

  it("handles size shrink correctly (smaller MSBT)", async () => {
    const bigBody = new TextEncoder().encode("A relatively long original text that will be shortened");
    const bigMsbt = buildMsbt(bigBody);
    const serialized = buildFakeSerializedFileV22(bigMsbt);
    const bundle = buildSyntheticBundle(serialized, "shrink.msbt");

    const info = await parseUnityBundle(bundle);
    const decompressed = await decompressBundle(bundle, info);
    const assets = extractAssets(decompressed, info);
    const msbtAssets = assets.filter(a => isMsbt(a.data));

    const tinyBody = new TextEncoder().encode("XY");
    const tinyMsbt = buildMsbt(tinyBody);

    const replacements = new Map<string, Uint8Array>();
    replacements.set(`${msbtAssets[0].name}#${msbtAssets[0].pathId.toString()}`, tinyMsbt);

    const result = repackBundle(bundle, info, decompressed, assets, replacements);
    expect(result.replacedCount).toBe(1);
    expect(result.newSize).toBeLessThan(bundle.byteLength);
    expect(result.buffer.byteLength).toBe(result.newSize);
  });

  it("skips assets with no matching replacement key", async () => {
    const body = new TextEncoder().encode("No match");
    const msbt = buildMsbt(body);
    const serialized = buildFakeSerializedFileV22(msbt);
    const bundle = buildSyntheticBundle(serialized, "nomatch.msbt");

    const info = await parseUnityBundle(bundle);
    const decompressed = await decompressBundle(bundle, info);
    const assets = extractAssets(decompressed, info);

    // Empty replacements
    const replacements = new Map<string, Uint8Array>();

    const result = repackBundle(bundle, info, decompressed, assets, replacements);
    expect(result.replacedCount).toBe(0);
    // Should return original buffer copy
    expect(result.buffer.byteLength).toBe(bundle.byteLength);
  });

  it("falls back to raw MSBT scan when serialized parser returns zero objects", async () => {
    const msbt = buildMsbt(new TextEncoder().encode("Fallback text payload"));
    const serialized = buildSerializedWithZeroObjectsAndEmbeddedMsbt(msbt);
    const bundle = buildSyntheticBundle(serialized, "zero-objects.bundle");

    const info = await parseUnityBundle(bundle);
    const decompressed = await decompressBundle(bundle, info);
    const assets = extractAssets(decompressed, info);
    const msbtAssets = assets.filter(a => isMsbt(a.data));

    expect(msbtAssets.length).toBe(1);
    expect(new TextDecoder().decode(msbtAssets[0].data)).toContain("Fallback text payload");
  });

  it("falls back to decompressed stream scan when directory entries are empty", () => {
    const msbt = buildMsbt(new TextEncoder().encode("stream-level fallback"));
    const noise = new Uint8Array([0x00, 0x11, 0x22, 0x33]);
    const decompressedData = new Uint8Array(noise.length + msbt.length);
    decompressedData.set(noise, 0);
    decompressedData.set(msbt, noise.length);

    const assets = extractAssets(decompressedData, {
      signature: "UnityFS",
      formatVersion: 6,
      unityVersion: "5.x.x",
      generatorVersion: "2020.3.18f1",
      totalSize: BigInt(decompressedData.length),
      blocks: [],
      entries: [],
      dataOffset: 0,
      flags: 0,
    });

    expect(assets.length).toBe(1);
    expect(isMsbt(assets[0].data)).toBe(true);
  });
});
