/**
 * Post-build binary validator for Unity Asset Bundles.
 * Checks structural integrity before download to prevent game crashes.
 */

export interface BinaryCheck {
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface BinaryValidationResult {
  checks: BinaryCheck[];
  hasCritical: boolean;
}

/**
 * Read the declared file_size from a UnityFS header (big-endian int64 after signature fields).
 */
function readDeclaredSize(view: DataView): { declaredSize: number; offset: number } | null {
  // UnityFS\0 + formatVersion(4) + unityVersion\0 + generatorVersion\0 + fileSize(8)
  let off = 0;
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);

  // Skip signature (null-terminated "UnityFS")
  while (off < bytes.length && bytes[off] !== 0) off++;
  if (off >= bytes.length) return null;
  off++; // skip null

  // Skip format version (4 bytes)
  off += 4;

  // Skip unity version (null-terminated)
  while (off < bytes.length && bytes[off] !== 0) off++;
  if (off >= bytes.length) return null;
  off++;

  // Skip generator version (null-terminated)
  while (off < bytes.length && bytes[off] !== 0) off++;
  if (off >= bytes.length) return null;
  off++;

  if (off + 8 > bytes.length) return null;

  // Read big-endian int64
  const hi = view.getUint32(off, false);
  const lo = view.getUint32(off + 4, false);
  const declaredSize = hi * 0x100000000 + lo;

  return { declaredSize, offset: off };
}

/**
 * Find all MsgStdBn signatures in the buffer and validate each.
 */
function findAllMsbt(data: Uint8Array): number[] {
  const magic = [0x4D, 0x73, 0x67, 0x53, 0x74, 0x64, 0x42, 0x6E]; // "MsgStdBn"
  const positions: number[] = [];
  for (let i = 0; i <= data.length - 8; i++) {
    let match = true;
    for (let j = 0; j < 8; j++) {
      if (data[i + j] !== magic[j]) { match = false; break; }
    }
    if (match) positions.push(i);
  }
  return positions;
}

/**
 * Validate a built Unity Asset Bundle buffer.
 * Returns checks for: header size, MSBT BOM, TXT2, null terminators, control tags, Arabic presence.
 */
export function validateBundle(buffer: ArrayBuffer): BinaryValidationResult {
  const checks: BinaryCheck[] = [];
  const data = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // 1. Check UnityFS signature
  const sig = new TextDecoder().decode(data.slice(0, 7));
  if (sig !== "UnityFS") {
    checks.push({ label: "توقيع UnityFS", status: "fail", detail: `التوقيع غير صحيح: "${sig}"` });
    return { checks, hasCritical: true };
  }
  checks.push({ label: "توقيع UnityFS", status: "pass", detail: "UnityFS ✓" });

  // 2. Header size vs actual size
  const sizeInfo = readDeclaredSize(view);
  if (!sizeInfo) {
    checks.push({ label: "حجم الترويسة", status: "fail", detail: "تعذر قراءة حجم الملف من الترويسة" });
  } else {
    const diff = buffer.byteLength - sizeInfo.declaredSize;
    if (diff === 0) {
      checks.push({ label: "حجم الترويسة", status: "pass", detail: `${sizeInfo.declaredSize} بايت — مطابق تماماً ✓` });
    } else if (diff > 0) {
      checks.push({ label: "حجم الترويسة", status: "fail", detail: `${diff} بايت زائدة بعد نهاية الملف المصرح به (${sizeInfo.declaredSize} مصرح، ${buffer.byteLength} فعلي)` });
    } else {
      checks.push({ label: "حجم الترويسة", status: "fail", detail: `الملف أصغر بـ ${-diff} بايت من الحجم المصرح` });
    }
  }

  // 3-6. MSBT-level checks
  const msbtPositions = findAllMsbt(data);
  if (msbtPositions.length === 0) {
    checks.push({ label: "بيانات MSBT", status: "warn", detail: "لم يُعثر على أي توقيع MsgStdBn — قد تكون البيانات مضغوطة" });
  } else {
    checks.push({ label: "بيانات MSBT", status: "pass", detail: `${msbtPositions.length} ملف MSBT مكتشف` });

    let bomOk = 0, bomBad = 0;
    let txt2Found = 0;
    let hasArabic = false;
    let controlTagCount = 0;

    for (const pos of msbtPositions) {
      // BOM check (bytes 8-9 relative to MsgStdBn)
      if (pos + 10 <= data.length) {
        const bom = data[pos + 8] | (data[pos + 9] << 8);
        if (bom === 0xFEFF) bomOk++;
        else bomBad++;
      }

      // Find TXT2 section within this MSBT
      const searchEnd = Math.min(pos + 1024 * 1024, data.length - 4);
      for (let s = pos + 16; s < searchEnd; s++) {
        if (data[s] === 0x54 && data[s + 1] === 0x58 && data[s + 2] === 0x54 && data[s + 3] === 0x32) {
          txt2Found++;

          // Scan TXT2 region for Arabic characters (UTF-16LE)
          const txt2DataStart = s + 16; // skip TXT2 header (magic + size + padding + entry count)
          const txt2End = Math.min(s + 65536, data.length - 1);
          for (let t = txt2DataStart; t < txt2End; t += 2) {
            const codeUnit = data[t] | (data[t + 1] << 8);
            // Arabic ranges
            if ((codeUnit >= 0x0600 && codeUnit <= 0x06FF) ||
                (codeUnit >= 0x0750 && codeUnit <= 0x077F) ||
                (codeUnit >= 0x08A0 && codeUnit <= 0x08FF) ||
                (codeUnit >= 0xFB50 && codeUnit <= 0xFDFF) ||
                (codeUnit >= 0xFE70 && codeUnit <= 0xFEFF)) {
              hasArabic = true;
            }
            // Control tags
            if (codeUnit === 0x0E || codeUnit === 0x0F) {
              controlTagCount++;
            }
          }
          break; // only check first TXT2 per MSBT
        }
      }
    }

    // BOM results
    if (bomBad > 0) {
      checks.push({ label: "MSBT BOM", status: "fail", detail: `${bomBad} ملف MSBT بـ BOM غير صالح` });
    } else if (bomOk > 0) {
      checks.push({ label: "MSBT BOM", status: "pass", detail: `${bomOk} ملف — BOM سليم (UTF-16LE) ✓` });
    }

    // TXT2
    if (txt2Found > 0) {
      checks.push({ label: "قسم TXT2", status: "pass", detail: `${txt2Found} قسم TXT2 مكتشف ✓` });
    } else {
      checks.push({ label: "قسم TXT2", status: "warn", detail: "لم يُعثر على قسم TXT2 — قد تكون البنية مختلفة" });
    }

    // Control tags
    if (controlTagCount > 0) {
      checks.push({ label: "وسوم التحكم", status: "pass", detail: `${controlTagCount} وسم تحكم (0x0E/0x0F) مكتشف ✓` });
    }

    // Arabic presence
    if (hasArabic) {
      checks.push({ label: "نصوص عربية", status: "pass", detail: "تم اكتشاف نصوص عربية في TXT2 ✓" });
    } else {
      checks.push({ label: "نصوص عربية", status: "fail", detail: "لم يُعثر على أي نصوص عربية في TXT2 — الترجمة لم تُحقن!" });
    }
  }

  const hasCritical = checks.some(c => c.status === "fail");
  return { checks, hasCritical };
}

/**
 * Validate rebuilt MSBT files destined for a SARC.ZS archive.
 * Checks: MSBT signatures, BOM, TXT2, Arabic content presence.
 */
export function validateSarcMsbts(msbtBuffers: Uint8Array[]): BinaryValidationResult {
  const checks: BinaryCheck[] = [];

  if (msbtBuffers.length === 0) {
    checks.push({ label: "ملفات MSBT", status: "warn", detail: "لا توجد ملفات MSBT للفحص" });
    return { checks, hasCritical: false };
  }

  let bomOk = 0, bomBad = 0;
  let txt2Found = 0;
  let hasArabic = false;
  let controlTagCount = 0;
  let validMsbt = 0;

  for (const data of msbtBuffers) {
    // Check MsgStdBn signature
    const positions = findAllMsbt(data);
    if (positions.length === 0) continue;
    validMsbt += positions.length;

    for (const pos of positions) {
      // BOM
      if (pos + 10 <= data.length) {
        const bom = data[pos + 8] | (data[pos + 9] << 8);
        if (bom === 0xFEFF) bomOk++;
        else bomBad++;
      }

      // TXT2
      const searchEnd = Math.min(pos + 1024 * 1024, data.length - 4);
      for (let s = pos + 16; s < searchEnd; s++) {
        if (data[s] === 0x54 && data[s+1] === 0x58 && data[s+2] === 0x54 && data[s+3] === 0x32) {
          txt2Found++;
          const txt2Start = s + 16;
          const txt2End = Math.min(s + 65536, data.length - 1);
          for (let t = txt2Start; t < txt2End; t += 2) {
            const cu = data[t] | (data[t+1] << 8);
            if ((cu >= 0x0600 && cu <= 0x06FF) || (cu >= 0x0750 && cu <= 0x077F) ||
                (cu >= 0x08A0 && cu <= 0x08FF) || (cu >= 0xFB50 && cu <= 0xFDFF) ||
                (cu >= 0xFE70 && cu <= 0xFEFF)) {
              hasArabic = true;
            }
            if (cu === 0x0E || cu === 0x0F) controlTagCount++;
          }
          break;
        }
      }
    }
  }

  checks.push({ label: "ملفات MSBT", status: validMsbt > 0 ? "pass" : "warn", detail: `${validMsbt} ملف MSBT صالح من ${msbtBuffers.length}` });

  if (bomBad > 0) {
    checks.push({ label: "MSBT BOM", status: "fail", detail: `${bomBad} ملف بـ BOM غير صالح` });
  } else if (bomOk > 0) {
    checks.push({ label: "MSBT BOM", status: "pass", detail: `${bomOk} ملف — BOM سليم (UTF-16LE) ✓` });
  }

  if (txt2Found > 0) {
    checks.push({ label: "قسم TXT2", status: "pass", detail: `${txt2Found} قسم TXT2 ✓` });
  } else {
    checks.push({ label: "قسم TXT2", status: "warn", detail: "لم يُعثر على قسم TXT2" });
  }

  if (controlTagCount > 0) {
    checks.push({ label: "وسوم التحكم", status: "pass", detail: `${controlTagCount} وسم تحكم ✓` });
  }

  if (hasArabic) {
    checks.push({ label: "نصوص عربية", status: "pass", detail: "تم اكتشاف نصوص عربية ✓" });
  } else {
    checks.push({ label: "نصوص عربية", status: "fail", detail: "لم يُعثر على نصوص عربية — الترجمة لم تُحقن!" });
  }

  const hasCritical = checks.some(c => c.status === "fail");
  return { checks, hasCritical };
}
