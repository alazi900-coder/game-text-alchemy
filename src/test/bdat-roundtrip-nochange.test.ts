/**
 * اختبار Round-Trip بدون ترجمات:
 * يتحقق أن rebuildBdatFile لا يُغيّر أي بايت في الـ header
 * ولا في بنية الملف عند تمرير ترجمات فارغة (Map فارغة).
 *
 * يختبر كلا نوعَي الترويسة:
 *   - u32 layout (48-byte header) — شائع في XC3
 *   - u16 layout (40-byte header)
 */
import { describe, it, expect } from "vitest";
import { parseBdatFile } from "../lib/bdat-parser";
import { rebuildBdatFile } from "../lib/bdat-writer";

// ==================== بانيا BDAT وهميَّان ====================

/**
 * يبني ملف BDAT وهمياً بترويسة u16 (40-byte header)
 * جدول واحد، عمود نصي واحد، صفان، جدول نصوص بسيط.
 */
function buildU16Bdat(): Uint8Array {
  const encoder = new TextEncoder();

  // جدول النصوص (String table):
  // [0] = 0x00  (flag byte: لأسماء غير مُجزَّأة)
  // [1..] = "caption\0"
  // [...]  = "Hello\0"
  // [...]  = "World\0"
  const strFlag = new Uint8Array([0x00]);
  const strColName = encoder.encode("caption\0");
  const strVal0 = encoder.encode("Hello\0");
  const strVal1 = encoder.encode("World\0");

  const colNameOff = 1; // بعد الـ flag مباشرة (relative to string table start)
  const val0Off = colNameOff + strColName.length;
  const val1Off = val0Off + strVal0.length;
  const strTableLen = 1 + strColName.length + strVal0.length + strVal1.length;

  // col def: 3 bytes per column: valueType(1) + nameRef(2)
  // valueType 7 = String, nameRef = 0 (index into non-hashed name region)
  const colDef = new Uint8Array([7, 0, 0]); // type=String, nameRef=0

  // Row data: 2 rows × 4 bytes (u32 offset) = 8 bytes
  const rowData = new Uint8Array(8);
  const rowView = new DataView(rowData.buffer);
  rowView.setUint32(0, val0Off, true); // row 0 → "Hello"
  rowView.setUint32(4, val1Off, true); // row 1 → "World"

  // حساب الأوفسات داخل الجدول
  // Table header (40 bytes for u16 layout):
  // 0x00: magic "BDAT" (4)
  // 0x04: version (4)  = 0x0003_0001 (XC2-like for u16)
  // 0x08: colCount (2) = 1
  // 0x0A: padding (2)
  // 0x0C: rowCount (2) = 2
  // 0x0E: padding (2)
  // 0x10: baseId (2)   = 1
  // 0x12: padding (2+2+2) = 6
  // 0x18: colDefsOffset (u16) = 40
  // 0x1A: hashTableOffset (u16) = 0
  // 0x1C: rowDataOffset (u16) = 43
  // 0x1E: rowLength (u16) = 4
  // 0x20: stringTableOffset (u32)
  // 0x24: stringTableLength (u32)

  const headerSize = 40;
  const colDefsOffset = headerSize;                          // 40
  const colDefsSize = colDef.length;                        // 3
  const rowDataOffset = colDefsOffset + colDefsSize;        // 43
  const rowDataSize = rowData.length;                       // 8
  const strTableOffset = rowDataOffset + rowDataSize;       // 51

  const tableHeader = new Uint8Array(headerSize);
  const thv = new DataView(tableHeader.buffer);
  // magic
  tableHeader[0] = 0x42; tableHeader[1] = 0x44; tableHeader[2] = 0x41; tableHeader[3] = 0x54;
  // version (XC2-style to keep u16 layout detection: rowLength field non-zero)
  thv.setUint32(0x04, 0x00030001, true);
  // colCount
  thv.setUint16(0x08, 1, true);
  // rowCount
  thv.setUint16(0x0C, 2, true);
  // baseId
  thv.setUint16(0x10, 1, true);
  // colDefsOffset (u16)
  thv.setUint16(0x18, colDefsOffset, true);
  // hashTableOffset (u16) = 0
  thv.setUint16(0x1A, 0, true);
  // rowDataOffset (u16)
  thv.setUint16(0x1C, rowDataOffset, true);
  // rowLength (u16)
  thv.setUint16(0x1E, 4, true);
  // stringTableOffset (u32)
  thv.setUint32(0x20, strTableOffset, true);
  // stringTableLength (u32)
  thv.setUint32(0x24, strTableLen, true);

  // تجميع بيانات الجدول
  const tableSize = strTableOffset + strTableLen;
  const tableData = new Uint8Array(tableSize);
  tableData.set(tableHeader);
  tableData.set(colDef, colDefsOffset);
  tableData.set(rowData, rowDataOffset);
  tableData[strTableOffset] = 0x00; // flag byte
  tableData.set(strColName, strTableOffset + colNameOff);
  tableData.set(strVal0, strTableOffset + val0Off);
  tableData.set(strVal1, strTableOffset + val1Off);

  // ترويسة الملف: 16 + 1*4 = 20 bytes
  const fileHeader = new Uint8Array(20);
  const fhv = new DataView(fileHeader.buffer);
  fileHeader[0] = 0x42; fileHeader[1] = 0x44; fileHeader[2] = 0x41; fileHeader[3] = 0x54;
  fhv.setUint32(4, 0x00030001, true);  // version
  fhv.setUint32(8, 1, true);           // tableCount
  fhv.setUint32(12, fileHeader.length + tableSize, true); // fileSize
  fhv.setUint32(16, fileHeader.length, true); // table[0] offset

  const file = new Uint8Array(fileHeader.length + tableSize);
  file.set(fileHeader);
  file.set(tableData, fileHeader.length);
  return file;
}

/**
 * يبني ملف BDAT وهمياً بترويسة u32 (48-byte header) — النمط الشائع في XC3.
 * تحديد النمط يعتمد على: rowLength عند 0x1E == 0، وcolDefsOffset عند 0x18 > 0.
 */
function buildU32Bdat(): Uint8Array {
  const encoder = new TextEncoder();

  const strFlag = new Uint8Array([0x00]);
  const strColName = encoder.encode("msg\0");
  const strVal0 = encoder.encode("Quest\0");
  const strVal1 = encoder.encode("Party\0");

  const colNameOff = 1;
  const val0Off = colNameOff + strColName.length;
  const val1Off = val0Off + strVal0.length;
  const strTableLen = 1 + strColName.length + strVal0.length + strVal1.length;

  // col def = 3 bytes
  const colDef = new Uint8Array([7, 0, 0]); // String, nameRef=0

  // Row data: 2 rows × 4 bytes
  const rowData = new Uint8Array(8);
  const rowView = new DataView(rowData.buffer);
  rowView.setUint32(0, val0Off, true);
  rowView.setUint32(4, val1Off, true);

  // u32 header = 48 bytes
  const headerSize = 48;
  const colDefsOffset = headerSize;                         // 48
  const colDefsSize = colDef.length;                       // 3
  // pad to 4-byte alignment
  const colDefsPadded = Math.ceil((colDefsOffset + colDefsSize) / 4) * 4;
  const rowDataOffset = colDefsPadded;
  const rowDataSize = rowData.length;                      // 8
  const strTableOffset = rowDataOffset + rowDataSize;

  const tableHeader = new Uint8Array(headerSize);
  const thv = new DataView(tableHeader.buffer);
  tableHeader[0] = 0x42; tableHeader[1] = 0x44; tableHeader[2] = 0x41; tableHeader[3] = 0x54;
  thv.setUint32(0x04, 0x00040001, true); // version XC3-like
  thv.setUint16(0x08, 1, true);          // colCount
  thv.setUint16(0x0C, 2, true);          // rowCount
  thv.setUint16(0x10, 1, true);          // baseId
  // u32 layout fields:
  thv.setUint32(0x18, colDefsOffset, true);   // colDefsOffset (u32)
  thv.setUint32(0x1C, 0, true);               // hashTableOffset (u32) = 0
  thv.setUint32(0x20, rowDataOffset, true);   // rowDataOffset (u32)
  thv.setUint32(0x24, 4, true);               // rowLength (u32)
  thv.setUint32(0x28, strTableOffset, true);  // stringTableOffset (u32)
  thv.setUint32(0x2C, strTableLen, true);     // stringTableLength (u32)
  // Note: 0x1E (u16) will be 0 because rowLength is at 0x24 — triggers u32 detection

  const tableSize = strTableOffset + strTableLen;
  const tableData = new Uint8Array(tableSize);
  tableData.set(tableHeader);
  tableData.set(colDef, colDefsOffset);
  tableData.set(rowData, rowDataOffset);
  tableData[strTableOffset] = 0x00;
  tableData.set(strColName, strTableOffset + colNameOff);
  tableData.set(strVal0, strTableOffset + val0Off);
  tableData.set(strVal1, strTableOffset + val1Off);

  const fileHeader = new Uint8Array(20);
  const fhv = new DataView(fileHeader.buffer);
  fileHeader[0] = 0x42; fileHeader[1] = 0x44; fileHeader[2] = 0x41; fileHeader[3] = 0x54;
  fhv.setUint32(4, 0x00040001, true);
  fhv.setUint32(8, 1, true);
  fhv.setUint32(12, fileHeader.length + tableSize, true);
  fhv.setUint32(16, fileHeader.length, true);

  const file = new Uint8Array(fileHeader.length + tableSize);
  file.set(fileHeader);
  file.set(tableData, fileHeader.length);
  return file;
}

// ==================== الاختبارات ====================

describe("rebuildBdatFile — Round-Trip بدون ترجمات", () => {

  it("u16 layout: الـ header لا يتغير عند ترجمات فارغة", () => {
    const original = buildU16Bdat();
    const parsed = parseBdatFile(original);
    const rebuilt = rebuildBdatFile(parsed, new Map());

    // يجب أن تتطابق الأبعاد
    expect(rebuilt.length).toBe(original.length);

    // ترويسة الملف (16 bytes الأولى) لا تتغير عدا fileSize المحسوب ديناميكياً
    const origView = new DataView(original.buffer);
    const rebView = new DataView(rebuilt.buffer);

    // magic
    expect(rebuilt[0]).toBe(0x42); // B
    expect(rebuilt[1]).toBe(0x44); // D
    expect(rebuilt[2]).toBe(0x41); // A
    expect(rebuilt[3]).toBe(0x54); // T

    // version
    expect(rebView.getUint32(4, true)).toBe(origView.getUint32(4, true));
    // tableCount
    expect(rebView.getUint32(8, true)).toBe(origView.getUint32(8, true));
    // fileSize
    expect(rebView.getUint32(12, true)).toBe(rebuilt.length);

    // ترويسة الجدول الأول (تبدأ عند offset 20)
    const tableStart = 20;
    // rowCount
    const origRowCount = origView.getUint16(tableStart + 0x0C, true);
    const rebRowCount = rebView.getUint16(tableStart + 0x0C, true);
    expect(rebRowCount).toBe(origRowCount);

    // colCount
    const origColCount = origView.getUint16(tableStart + 0x08, true);
    const rebColCount = rebView.getUint16(tableStart + 0x08, true);
    expect(rebColCount).toBe(origColCount);

    // stringTableOffset (u16 layout: 0x20)
    const origStrOff = origView.getUint32(tableStart + 0x20, true);
    const rebStrOff = rebView.getUint32(tableStart + 0x20, true);
    expect(rebStrOff).toBe(origStrOff);

    // stringTableLength (u16 layout: 0x24) — بدون ترجمات يجب أن تبقى مساوية
    const origStrLen = origView.getUint32(tableStart + 0x24, true);
    const rebStrLen = rebView.getUint32(tableStart + 0x24, true);
    expect(rebStrLen).toBe(origStrLen);
  });

  it("u32 layout: الـ header لا يتغير عند ترجمات فارغة", () => {
    const original = buildU32Bdat();
    const parsed = parseBdatFile(original);

    // تحقق أن المحلل اكتشف النمط الصحيح
    expect(parsed.tables[0]._raw.isU32Layout).toBe(true);

    const rebuilt = rebuildBdatFile(parsed, new Map());

    expect(rebuilt.length).toBe(original.length);

    const origView = new DataView(original.buffer);
    const rebView = new DataView(rebuilt.buffer);
    const tableStart = 20;

    // magic
    expect(rebuilt[0]).toBe(0x42);

    // version
    expect(rebView.getUint32(4, true)).toBe(origView.getUint32(4, true));

    // rowCount
    expect(rebView.getUint16(tableStart + 0x0C, true)).toBe(origView.getUint16(tableStart + 0x0C, true));

    // u32 layout: stringTableOffset at 0x28
    const origStrOff = origView.getUint32(tableStart + 0x28, true);
    const rebStrOff = rebView.getUint32(tableStart + 0x28, true);
    expect(rebStrOff).toBe(origStrOff);

    // u32 layout: stringTableLength at 0x2C
    const origStrLen = origView.getUint32(tableStart + 0x2C, true);
    const rebStrLen = rebView.getUint32(tableStart + 0x2C, true);
    expect(rebStrLen).toBe(origStrLen);
  });

  it("u16 layout: بيانات النصوص لا تتغير عند ترجمات فارغة", () => {
    const original = buildU16Bdat();
    const parsed = parseBdatFile(original);
    const rebuilt = rebuildBdatFile(parsed, new Map());

    // تحقق أن النصوص نفسها موجودة في الملف المُعاد بناؤه
    const decoder = new TextDecoder("utf-8");
    const rebText = decoder.decode(rebuilt);
    expect(rebText).toContain("Hello");
    expect(rebText).toContain("World");
    expect(rebText).toContain("caption");
  });

  it("u32 layout: بيانات النصوص لا تتغير عند ترجمات فارغة", () => {
    const original = buildU32Bdat();
    const parsed = parseBdatFile(original);
    const rebuilt = rebuildBdatFile(parsed, new Map());

    const decoder = new TextDecoder("utf-8");
    const rebText = decoder.decode(rebuilt);
    expect(rebText).toContain("Quest");
    expect(rebText).toContain("Party");
    expect(rebText).toContain("msg");
  });

  it("byte-for-byte: الملف المُعاد بناؤه مطابق للأصل (u16)", () => {
    const original = buildU16Bdat();
    const parsed = parseBdatFile(original);
    const rebuilt = rebuildBdatFile(parsed, new Map());

    expect(rebuilt.length).toBe(original.length);
    // تحقق من كل بايت
    let diffCount = 0;
    const diffs: { offset: number; orig: number; rebuilt: number }[] = [];
    for (let i = 0; i < original.length; i++) {
      if (original[i] !== rebuilt[i]) {
        diffCount++;
        if (diffs.length < 10) diffs.push({ offset: i, orig: original[i], rebuilt: rebuilt[i] });
      }
    }
    expect(diffCount).toBe(0);
  });

  it("byte-for-byte: الملف المُعاد بناؤه مطابق للأصل (u32)", () => {
    const original = buildU32Bdat();
    const parsed = parseBdatFile(original);
    const rebuilt = rebuildBdatFile(parsed, new Map());

    expect(rebuilt.length).toBe(original.length);
    let diffCount = 0;
    const diffs: { offset: number; orig: number; rebuilt: number }[] = [];
    for (let i = 0; i < original.length; i++) {
      if (original[i] !== rebuilt[i]) {
        diffCount++;
        if (diffs.length < 10) diffs.push({ offset: i, orig: original[i], rebuilt: rebuilt[i] });
      }
    }
    // نطبع الفروقات لتسهيل التشخيص إن وُجدت
    if (diffCount > 0) {
      console.error("فروقات بايت:", JSON.stringify(diffs, null, 2));
    }
    expect(diffCount).toBe(0);
  });
});
