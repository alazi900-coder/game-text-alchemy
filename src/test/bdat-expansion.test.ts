/**
 * اختبار تكاملي: بناء ملف BDAT حقيقي مع توسيع جدول النصوص
 * يتحقق أن الترجمات العربية الأطول من النص الأصلي تُكتب بنجاح
 */
import { describe, it, expect } from "vitest";
import { patchBdatFile } from "@/lib/bdat-writer";
import { BdatFile, BdatTable, BdatValueType } from "@/lib/bdat-parser";

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

/**
 * Build a minimal valid BDAT file with one table, one string column, and N rows.
 * Each row has a string pointer into the string table.
 */
function buildTestBdat(strings: string[]): { file: BdatFile; raw: Uint8Array } {
  // Layout:
  // File header: BDAT(4) + version(4) + tableCount(4) + fileSize(4) + tableOffset(4) = 20
  // Table (at offset 20):
  //   BDAT(4) + padding(4) + colCount(2) + padding(2) + rowCount(2) + padding(2) + baseId(2) + padding(2)
  //   + colDefsOff(2) + hashTableOff(2) + rowDataOff(2) + rowLength(2) + strTableOff(4) + strTableLen(4)
  //   = 40 bytes (u16 layout)
  //
  // Col defs (1 col): type(1) + nameRef(2) = 3 bytes
  // Row data: 4 bytes per row (string offset)
  // String table: flag(1) + "T\0" (table name) + "c\0" (col name) + strings...

  const tableOffset = 20;
  const tableHeaderSize = 40; // u16 layout

  // String table content
  const strParts: Uint8Array[] = [];
  const strOffsets: number[] = [];
  
  // Flag byte
  strParts.push(new Uint8Array([1])); // 1 = not hashed (plain text names)
  let pos = 1;
  
  // Table name "T\0"
  const tableNameBytes = encoder.encode("T");
  strParts.push(tableNameBytes);
  strParts.push(new Uint8Array([0]));
  pos += tableNameBytes.length + 1;
  
  // Column name "c\0"
  const colNameOff = pos - 1; // nameRef = offset from (stringTable + 1)
  const colNameBytes = encoder.encode("c");
  strParts.push(colNameBytes);
  strParts.push(new Uint8Array([0]));
  pos += colNameBytes.length + 1;
  
  // Row strings
  for (const s of strings) {
    strOffsets.push(pos); // offset relative to string table start
    const sBytes = encoder.encode(s);
    strParts.push(sBytes);
    strParts.push(new Uint8Array([0]));
    pos += sBytes.length + 1;
  }
  
  const strTableLength = pos;
  
  // Column defs
  const colDefsOffset = tableHeaderSize;
  const colDefSize = 3; // type(1) + nameRef(2)
  
  // Row data
  const rowDataOffset = colDefsOffset + colDefSize;
  const rowLength = 4; // one u32 string pointer
  const rowDataSize = strings.length * rowLength;
  
  // String table offset within table
  const strTableOffset = rowDataOffset + rowDataSize;
  
  const tableSize = strTableOffset + strTableLength;
  const fileSize = tableOffset + tableSize;
  
  const buf = new Uint8Array(fileSize);
  const view = new DataView(buf.buffer);
  
  // File header
  buf.set(encoder.encode("BDAT"), 0);
  view.setUint32(4, 4, true); // version
  view.setUint32(8, 1, true); // tableCount
  view.setUint32(12, fileSize, true);
  view.setUint32(16, tableOffset, true);
  
  // Table header (u16 layout)
  buf.set(encoder.encode("BDAT"), tableOffset);
  view.setUint16(tableOffset + 0x08, 1, true); // colCount
  view.setUint16(tableOffset + 0x0C, strings.length, true); // rowCount
  view.setUint16(tableOffset + 0x10, 0, true); // baseId
  view.setUint16(tableOffset + 0x18, colDefsOffset, true); // colDefsOffset
  view.setUint16(tableOffset + 0x1A, colDefsOffset, true); // hashTableOffset (same, no hashes)
  view.setUint16(tableOffset + 0x1C, rowDataOffset, true); // rowDataOffset
  view.setUint16(tableOffset + 0x1E, rowLength, true); // rowLength
  view.setUint32(tableOffset + 0x20, strTableOffset, true); // strTableOffset
  view.setUint32(tableOffset + 0x24, strTableLength, true); // strTableLen
  
  // Column def: type=String(7), nameRef
  buf[tableOffset + colDefsOffset] = BdatValueType.String;
  view.setUint16(tableOffset + colDefsOffset + 1, colNameOff, true);
  
  // Row data: string offsets
  for (let i = 0; i < strings.length; i++) {
    view.setUint32(tableOffset + rowDataOffset + i * 4, strOffsets[i], true);
  }
  
  // String table
  let stOff = tableOffset + strTableOffset;
  for (const part of strParts) {
    buf.set(part, stOff);
    stOff += part.length;
  }
  
  // Build BdatFile structure
  const tableData = buf.slice(tableOffset, tableOffset + tableSize);
  
  const columns = [{
    valueType: BdatValueType.String,
    nameOffset: colNameOff,
    name: "c",
    offset: 0,
  }];
  
  const rows = strings.map((s, i) => ({
    id: i,
    values: { c: s } as Record<string, unknown>,
  }));
  
  const table: BdatTable = {
    name: "T",
    nameHash: null,
    columns,
    rows,
    baseId: 0,
    _raw: {
      tableOffset,
      tableData,
      columnCount: 1,
      rowCount: strings.length,
      rowLength,
      columnDefsOffset: colDefsOffset,
      hashTableOffset: colDefsOffset,
      rowDataOffset,
      stringTableOffset: strTableOffset,
      stringTableLength: strTableLength,
      hashedNames: false,
      baseId: 0,
      isU32Layout: false,
    },
  };
  
  const file: BdatFile = {
    tables: [table],
    version: 4,
    fileSize,
    _raw: buf,
  };
  
  return { file, raw: buf };
}

/** Read null-terminated string from buffer */
function readStr(data: Uint8Array, offset: number): string {
  let end = offset;
  while (end < data.length && data[end] !== 0) end++;
  return decoder.decode(data.slice(offset, end));
}

describe("BDAT String Table Expansion", () => {
  it("should patch short translations (same size or smaller)", () => {
    const { file } = buildTestBdat(["Hello", "World"]);
    
    const translations = new Map<string, string>();
    translations.set("T:0:c", "Hi"); // shorter
    translations.set("T:1:c", "Earth"); // same length
    
    const result = patchBdatFile(file, translations);
    
    expect(result.patchedCount).toBe(2);
    expect(result.skippedCount).toBe(0);
    expect(result.overflowErrors).toHaveLength(0);
  });

  it("should handle translations LONGER than originals (string table expansion)", () => {
    const { file } = buildTestBdat(["Talk", "Open", "Play"]);
    
    // Arabic translations are much longer in UTF-8 bytes
    const translations = new Map<string, string>();
    translations.set("T:0:c", "تحدث مع الشخصية"); // 30 bytes vs "Talk" = 4 bytes
    translations.set("T:1:c", "افتح القائمة الرئيسية"); // 40 bytes vs "Open" = 4 bytes
    translations.set("T:2:c", "ابدأ اللعب الآن"); // 28 bytes vs "Play" = 4 bytes
    
    const result = patchBdatFile(file, translations);
    
    // ALL should be patched, NONE skipped
    expect(result.patchedCount).toBe(3);
    expect(result.skippedCount).toBe(0);
    expect(result.overflowErrors).toHaveLength(0);
    
    // File should be larger than original
    expect(result.result.length).toBeGreaterThan(file._raw.length);
  });

  it("should preserve untranslated strings when expanding", async () => {
    const { file } = buildTestBdat(["Keep", "Change", "Keep2"]);
    
    const translations = new Map<string, string>();
    translations.set("T:1:c", "هذا نص عربي طويل جداً يتجاوز حجم النص الأصلي بمراحل"); // very long
    
    const result = patchBdatFile(file, translations);
    
    expect(result.patchedCount).toBe(1);
    expect(result.skippedCount).toBe(0);
    
    // Re-parse the result to verify strings
    const { parseBdatFile } = await import("@/lib/bdat-parser");
    const rebuilt = parseBdatFile(result.result);
    
    expect(rebuilt.tables).toHaveLength(1);
    const rows = rebuilt.tables[0].rows;
    expect(rows[0].values["c"]).toBe("Keep");
    expect(rows[1].values["c"]).toBe("هذا نص عربي طويل جداً يتجاوز حجم النص الأصلي بمراحل");
    expect(rows[2].values["c"]).toBe("Keep2");
  });

  it("should handle Arabic Presentation Forms (3 bytes per char)", () => {
    const { file } = buildTestBdat(["Hi", "Go"]);
    
    const presForm = "\uFEE3\uFE98\uFE8E\uFE91\uFECC\uFE94";
    
    const translationsPf = new Map<string, string>();
    translationsPf.set("T:0:c", presForm);
    translationsPf.set("T:1:c", "\uFE8D\uFEDF\uFECC\uFE90");
    
    const result = patchBdatFile(file, translationsPf);
    
    expect(result.patchedCount).toBe(2);
    expect(result.skippedCount).toBe(0);
    expect(result.result.length).toBeGreaterThan(file._raw.length);
  });

  it("should produce a valid BDAT file that can be re-parsed", async () => {
    const origStrings = ["Quest", "Item", "Skill", "Party", "Map"];
    const { file } = buildTestBdat(origStrings);
    
    const translations = new Map<string, string>();
    translations.set("T:0:c", "المهمة الرئيسية");
    translations.set("T:1:c", "العنصر المطلوب");
    translations.set("T:2:c", "المهارة القتالية");
    translations.set("T:3:c", "الفريق");
    translations.set("T:4:c", "الخريطة");
    
    const result = patchBdatFile(file, translations);
    
    expect(result.patchedCount).toBe(5);
    
    // Re-parse to verify
    const { parseBdatFile } = await import("@/lib/bdat-parser");
    const rebuilt = parseBdatFile(result.result);
    
    expect(rebuilt.tables).toHaveLength(1);
    expect(rebuilt.tables[0].rows).toHaveLength(5);
    expect(rebuilt.tables[0].rows[0].values["c"]).toBe("المهمة الرئيسية");
    expect(rebuilt.tables[0].rows[1].values["c"]).toBe("العنصر المطلوب");
    expect(rebuilt.tables[0].rows[2].values["c"]).toBe("المهارة القتالية");
    expect(rebuilt.tables[0].rows[3].values["c"]).toBe("الفريق");
    expect(rebuilt.tables[0].rows[4].values["c"]).toBe("الخريطة");
    
    // Verify file header
    const resultView = new DataView(result.result.buffer);
    const magic = String.fromCharCode(...result.result.slice(0, 4));
    expect(magic).toBe("BDAT");
    expect(resultView.getUint32(8, true)).toBe(1); // tableCount
    expect(resultView.getUint32(12, true)).toBe(result.result.length); // fileSize matches
  });
});
