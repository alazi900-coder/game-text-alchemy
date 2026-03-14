import { describe, it, expect } from "vitest";
import { replaceEmbeddedMsbt } from "@/lib/unity-asset-bundle";
import type { ExtractedAsset } from "@/lib/unity-asset-bundle";

/**
 * Build a fake serialized file containing an embedded MSBT.
 * Layout:
 *   [0-3]   metadataSize (BE u32)
 *   [4-7]   fileSize (BE u32) = total length
 *   [8-11]  version (BE u32) = 22
 *   [12-15] dataOffset (BE u32) = 0
 *   [16-19] padding
 *   [20-23] dataLen (LE u32) = msbtData.length  ← TextAsset data length field
 *   [24..]  MsgStdBn header + body
 */
function buildFakeEntry(msbtBody: Uint8Array): Uint8Array {
  // MSBT header: "MsgStdBn" (8) + BOM (2) + padding (8) + file_size LE u32 (4) = 22 bytes min
  const msbtHeader = new Uint8Array(22);
  // Magic: MsgStdBn
  const magic = [0x4D, 0x73, 0x67, 0x53, 0x74, 0x64, 0x42, 0x6E];
  msbtHeader.set(magic, 0);
  // BOM at offset 8
  msbtHeader[8] = 0xFF; msbtHeader[9] = 0xFE;
  // file_size at offset 18 (LE u32) = total MSBT size (header + body)
  const totalMsbtSize = 22 + msbtBody.length;
  new DataView(msbtHeader.buffer).setUint32(18, totalMsbtSize, true);

  const msbtData = new Uint8Array(totalMsbtSize);
  msbtData.set(msbtHeader, 0);
  msbtData.set(msbtBody, 22);

  // Serialized file prefix: 20 bytes header + 4 bytes dataLen + MSBT + 4 bytes trailer
  const prefixLen = 20;
  const dataLenFieldLen = 4;
  const trailerLen = 4;
  const totalLen = prefixLen + dataLenFieldLen + totalMsbtSize + trailerLen;

  const entry = new Uint8Array(totalLen);
  const view = new DataView(entry.buffer);

  // Header (BE)
  view.setUint32(0, 0, false);           // metadataSize
  view.setUint32(4, totalLen, false);     // fileSize
  view.setUint32(8, 22, false);           // version = 22
  view.setUint32(12, 0, false);           // dataOffset
  // padding at 16-19

  // dataLen at offset 20 (LE) = totalMsbtSize
  view.setUint32(20, totalMsbtSize, true);

  // MSBT at offset 24
  entry.set(msbtData, 24);

  // Trailer bytes (simulate post-MSBT data)
  entry[totalLen - 4] = 0xDE;
  entry[totalLen - 3] = 0xAD;
  entry[totalLen - 2] = 0xBE;
  entry[totalLen - 1] = 0xEF;

  return entry;
}

function makeDummyAsset(): ExtractedAsset {
  return {
    name: "test.msbt",
    data: new Uint8Array(0),
    type: "TextAsset",
    pathId: BigInt(0),
    entryIndex: 0,
    absoluteDataOffset: 0,
    objectByteSize: 0,
    textAssetDataLenOffset: -1,
    textAssetDataBytesOffset: -1,
  };
}

describe("replaceEmbeddedMsbt", () => {
  it("replaces MSBT data with same-size payload", () => {
    const origBody = new TextEncoder().encode("Hello World!");
    const entry = buildFakeEntry(origBody);
    const origLen = entry.length;

    // New MSBT: same total size (22 header + 12 body = 34)
    const newMsbtBody = new TextEncoder().encode("Marhaba!!!!!");
    const newMsbt = new Uint8Array(22 + newMsbtBody.length);
    const magic = [0x4D, 0x73, 0x67, 0x53, 0x74, 0x64, 0x42, 0x6E];
    newMsbt.set(magic, 0);
    newMsbt[8] = 0xFF; newMsbt[9] = 0xFE;
    new DataView(newMsbt.buffer).setUint32(18, newMsbt.length, true);
    newMsbt.set(newMsbtBody, 22);

    const result = replaceEmbeddedMsbt(entry, [{ asset: makeDummyAsset(), newData: newMsbt }]);

    // Same total size
    expect(result.length).toBe(origLen);
    // New MSBT magic present at offset 24
    expect(String.fromCharCode(...result.slice(24, 32))).toBe("MsgStdBn");
    // New body content at offset 24+22
    const bodyOut = new TextDecoder().decode(result.slice(46, 46 + newMsbtBody.length));
    expect(bodyOut).toBe("Marhaba!!!!!");
    // Trailer preserved
    expect(result[result.length - 4]).toBe(0xDE);
    expect(result[result.length - 1]).toBe(0xEF);
    // dataLen updated
    const dataLen = new DataView(result.buffer, 20, 4).getUint32(0, true);
    expect(dataLen).toBe(newMsbt.length);
    // fileSize header updated
    const fileSize = new DataView(result.buffer, 4, 4).getUint32(0, false);
    expect(fileSize).toBe(result.length);
  });

  it("handles larger replacement MSBT (size grows)", () => {
    const origBody = new TextEncoder().encode("Hi");
    const entry = buildFakeEntry(origBody);

    const newMsbtBody = new TextEncoder().encode("This is a much longer replacement text!");
    const newMsbt = new Uint8Array(22 + newMsbtBody.length);
    const magic = [0x4D, 0x73, 0x67, 0x53, 0x74, 0x64, 0x42, 0x6E];
    newMsbt.set(magic, 0);
    newMsbt[8] = 0xFF; newMsbt[9] = 0xFE;
    new DataView(newMsbt.buffer).setUint32(18, newMsbt.length, true);
    newMsbt.set(newMsbtBody, 22);

    const result = replaceEmbeddedMsbt(entry, [{ asset: makeDummyAsset(), newData: newMsbt }]);

    // Size should grow
    const sizeDiff = newMsbt.length - (22 + origBody.length);
    expect(result.length).toBe(entry.length + sizeDiff);
    // Trailer still at end
    expect(result[result.length - 4]).toBe(0xDE);
    expect(result[result.length - 1]).toBe(0xEF);
    // dataLen updated
    const dataLen = new DataView(result.buffer, 20, 4).getUint32(0, true);
    expect(dataLen).toBe(newMsbt.length);
  });

  it("handles smaller replacement MSBT (size shrinks)", () => {
    const origBody = new TextEncoder().encode("A very long original text here");
    const entry = buildFakeEntry(origBody);

    const newMsbtBody = new TextEncoder().encode("XY");
    const newMsbt = new Uint8Array(22 + newMsbtBody.length);
    const magic = [0x4D, 0x73, 0x67, 0x53, 0x74, 0x64, 0x42, 0x6E];
    newMsbt.set(magic, 0);
    newMsbt[8] = 0xFF; newMsbt[9] = 0xFE;
    new DataView(newMsbt.buffer).setUint32(18, newMsbt.length, true);
    newMsbt.set(newMsbtBody, 22);

    const result = replaceEmbeddedMsbt(entry, [{ asset: makeDummyAsset(), newData: newMsbt }]);

    const sizeDiff = newMsbt.length - (22 + origBody.length);
    expect(result.length).toBe(entry.length + sizeDiff);
    // Trailer preserved
    expect(result[result.length - 4]).toBe(0xDE);
    expect(result[result.length - 1]).toBe(0xEF);
  });

  it("returns original data when no MsgStdBn found", () => {
    const entry = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const newMsbt = new Uint8Array(30);
    const result = replaceEmbeddedMsbt(entry, [{ asset: makeDummyAsset(), newData: newMsbt }]);
    expect(result).toEqual(entry);
  });
});
