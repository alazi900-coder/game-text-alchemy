import { describe, expect, it } from "vitest";
import pako from "pako";
import { extractNLGFiles, parseNLGDict, repackNLGArchive, type NLGArchiveInfo, type NLGExtractedFile } from "@/lib/nlg-archive";

function makeDict(info: {
  isCompressed: boolean;
  entries: Array<{ offset: number; decompressedLength: number; compressedLength: number; unk?: number }>;
  unkFill?: number;
}): Uint8Array {
  const fileCount = info.entries.length;
  const dictSize = 0x2c + fileCount + fileCount * 16;
  const dict = new Uint8Array(dictSize);
  const view = new DataView(dict.buffer);

  view.setUint32(0, 0xa9f32458, true);
  dict[0x6] = info.isCompressed ? 1 : 0;
  view.setUint32(0x8, fileCount, true);

  const unkFill = info.unkFill ?? 0x7f;
  for (let i = 0; i < fileCount; i++) {
    dict[0x2c + i] = unkFill;
  }

  const tableStart = 0x2c + fileCount;
  for (let i = 0; i < fileCount; i++) {
    const e = info.entries[i];
    const off = tableStart + i * 16;
    view.setUint32(off, e.offset, true);
    view.setUint32(off + 4, e.decompressedLength, true);
    view.setUint32(off + 8, e.compressedLength, true);
    view.setUint32(off + 12, e.unk ?? 0x12345678, true);
  }

  return dict;
}

describe("nlg-archive compression round-trip", () => {
  it("preserves raw-deflate compression for files extracted with inflateRaw", () => {
    const payload = new TextEncoder().encode("DDS RAW TEST DATA");
    const rawCompressed = pako.deflateRaw(payload);

    const dict = makeDict({
      isCompressed: true,
      entries: [{ offset: 0, decompressedLength: payload.length, compressedLength: rawCompressed.length }],
      unkFill: 0xaa,
    });

    const info = parseNLGDict(dict);
    const extracted = extractNLGFiles(info, rawCompressed);
    expect(extracted).toHaveLength(1);
    expect(extracted[0].compressionMode).toBe("raw");
    expect(Array.from(extracted[0].data)).toEqual(Array.from(payload));

    const repacked = repackNLGArchive(info, extracted);
    const reparsedInfo = parseNLGDict(repacked.dict);
    const reExtracted = extractNLGFiles(reparsedInfo, repacked.data);

    expect(reExtracted[0].compressionMode).toBe("raw");
    expect(Array.from(reExtracted[0].data)).toEqual(Array.from(payload));
  });

  it("fills new unkArray slots from original dominant pattern when appending files", () => {
    const fileA = new TextEncoder().encode("DDSA");
    const dict = makeDict({
      isCompressed: false,
      entries: [{ offset: 0, decompressedLength: fileA.length, compressedLength: fileA.length }],
      unkFill: 0xcc,
    });

    const info = parseNLGDict(dict);
    const extracted = extractNLGFiles(info, fileA);

    const appended: NLGExtractedFile = {
      index: 1,
      data: new TextEncoder().encode("DDSB"),
      wasCompressed: false,
      compressionMode: "none",
      originalEntry: {
        index: 1,
        offset: 0,
        decompressedLength: 4,
        compressedLength: 4,
        unk: 0x1234,
      },
    };

    const repacked = repackNLGArchive(info as NLGArchiveInfo, [...extracted, appended]);
    const reparsed = parseNLGDict(repacked.dict);

    expect(reparsed.fileCount).toBe(2);
    expect(reparsed.unkArray[0]).toBe(0xcc);
    expect(reparsed.unkArray[1]).toBe(0xcc);
  });
});
