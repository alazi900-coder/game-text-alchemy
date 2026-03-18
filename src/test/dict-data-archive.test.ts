import { describe, it, expect } from "vitest";
import { deflate } from "pako";

import { buildNloc, findAndParseNloc, isNloc } from "@/lib/nloc-parser";
import { extractDictDataArchive, parseDictHeader, tryDecompressDataFile } from "@/lib/dict-data-archive";

function createMinimalNloc(text: string): Uint8Array {
  return buildNloc({
    langId: 1,
    endian: "little",
    rawBuffer: new ArrayBuffer(0),
    messages: [{ id: 0x12345678, idHex: "12345678", text }],
  });
}

function createSyntheticDictAndData() {
  const nloc = createMinimalNloc("Hello Luigi");
  const compressedNloc = deflate(nloc);

  const dict = new Uint8Array(0x34 + 2 * 16);
  const view = new DataView(dict.buffer);

  // Header
  view.setUint32(0x00, 0x5824f3a9, true); // magic
  view.setUint16(0x04, 0x0401, true);
  dict[0x06] = 1; // compressed
  dict[0x07] = 0;
  view.setUint32(0x08, 2, true); // block count
  view.setUint32(0x0c, compressedNloc.length, true);
  dict[0x10] = 1; // file table count
  dict[0x11] = 0;
  dict[0x12] = 2; // file table ref count
  dict[0x13] = 2; // ext count

  // File table refs (first one is standard)
  view.setUint32(0x14, 0x11111111, true);
  dict.set([1, 0, 0, 0, 0, 0, 0, 0], 0x18); // points to block index 1
  view.setUint32(0x20, 0x22222222, true);
  dict.set([0, 0, 0, 0, 0, 0, 0, 0], 0x24);

  // File table info (2 refs * 1 table = 8 bytes)
  view.setUint16(0x2c, 1, true);
  view.setUint16(0x2e, 0, true);
  view.setUint16(0x30, 0, true);
  view.setUint16(0x32, 0, true);

  // Block table at 0x34
  // Block 0: tiny chunk table (ignored for final payload)
  view.setUint32(0x34 + 0x00, 0, true);
  view.setUint32(0x34 + 0x04, 8, true);
  view.setUint32(0x34 + 0x08, 8, true);
  dict[0x34 + 0x0c] = 0x08;
  dict[0x34 + 0x0d] = 0;
  dict[0x34 + 0x0e] = 0;
  dict[0x34 + 0x0f] = 0;

  // Block 1: compressed NLOC payload
  view.setUint32(0x44 + 0x00, 8, true);
  view.setUint32(0x44 + 0x04, nloc.length, true);
  view.setUint32(0x44 + 0x08, compressedNloc.length, true);
  dict[0x44 + 0x0c] = 0x80;
  dict[0x44 + 0x0d] = 0;
  dict[0x44 + 0x0e] = 0;
  dict[0x44 + 0x0f] = 0;

  const data = new Uint8Array(8 + compressedNloc.length);
  data.set([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x11, 0x22], 0);
  data.set(compressedNloc, 8);

  return { dict, data };
}

describe("dict-data-archive", () => {
  it("parses canonical LM2 dict header and extracts NLOC payload", () => {
    const { dict, data } = createSyntheticDictAndData();

    const parsedHeader = parseDictHeader(dict, data.length);
    expect(parsedHeader.blocks.length).toBe(2);
    expect(parsedHeader.preferredDataBlockIndices).toContain(1);

    const extracted = extractDictDataArchive(dict, data);
    expect(isNloc(extracted)).toBe(true);

    const parsedNloc = findAndParseNloc(extracted);
    expect(parsedNloc).not.toBeNull();
    expect(parsedNloc?.messages[0]?.text).toBe("Hello Luigi");
  });

  it("finds zlib stream even when it starts far inside .data", () => {
    const nloc = createMinimalNloc("Hidden stream");
    const compressedNloc = deflate(nloc);

    const noisyData = new Uint8Array(0x1200 + compressedNloc.length + 32);
    noisyData.fill(0x55);
    noisyData.set(compressedNloc, 0x1200);

    const decompressed = tryDecompressDataFile(noisyData);
    expect(decompressed).not.toBeNull();

    const parsed = findAndParseNloc(decompressed!);
    expect(parsed).not.toBeNull();
    expect(parsed?.messages[0]?.text).toBe("Hidden stream");
  });
});
