import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, XCircle, Shield, Layers, Replace, Plus } from "lucide-react";
import { findDDSPositions, DDS_FULL_SIZE_WITH_MIPS, formatFileSize } from "@/lib/nlg-archive";
import { findFontDefInData, parseNLGFontDef } from "@/lib/nlg-font-def";
import type { NLGArchiveInfo } from "@/lib/nlg-archive";
import type { NLGFontDef } from "@/lib/nlg-font-def";

interface CompatibilityCheckProps {
  fontData: Uint8Array | null;
  dictData: Uint8Array | null;
  archiveInfo: NLGArchiveInfo | null;
  fontDefData: NLGFontDef | null;
  generatedPages: number;
  hasArchive: boolean;
}

interface CheckResult {
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface CompatibilityReport {
  mode: "append" | "replace" | "unknown";
  modeReason: string;
  checks: CheckResult[];
  canBuild: boolean;
  riskLevel: "low" | "medium" | "high";
  estimatedOutputSize: number;
}

export default function CompatibilityCheck({
  fontData, dictData, archiveInfo, fontDefData, generatedPages, hasArchive,
}: CompatibilityCheckProps) {

  const report = useMemo<CompatibilityReport | null>(() => {
    if (!fontData) return null;

    const checks: CheckResult[] = [];
    let mode: "append" | "replace" | "unknown" = "unknown";
    let modeReason = "";
    let canBuild = true;
    let riskLevel: "low" | "medium" | "high" = "low";

    // 1. Check DDS pages exist
    const ddsPositions = findDDSPositions(fontData);
    if (ddsPositions.length === 0) {
      checks.push({ label: "صفحات DDS", status: "fail", detail: "لا توجد صفحات DDS — الملف غير صالح" });
      return { mode: "unknown", modeReason: "ملف غير صالح", checks, canBuild: false, riskLevel: "high", estimatedOutputSize: 0 };
    }
    checks.push({ label: "صفحات DDS", status: "pass", detail: `${ddsPositions.length} صفحة أصلية مكتشفة` });

    // 2. Check FontDef exists
    const fontDefResult = findFontDefInData(fontData);
    if (!fontDefResult) {
      checks.push({ label: "تعريف الخط", status: "fail", detail: "FontDef غير موجود في الملف" });
      return { mode: "unknown", modeReason: "تعريف الخط مفقود", checks, canBuild: false, riskLevel: "high", estimatedOutputSize: 0 };
    }
    const parsedDef = parseNLGFontDef(fontDefResult.text);
    checks.push({ label: "تعريف الخط", status: "pass", detail: `${parsedDef.glyphs.length} حرف — PageCount: ${parsedDef.header.pageCount}` });

    // 3. Check if FontDef PageCount matches actual DDS count
    if (parsedDef.header.pageCount !== ddsPositions.length) {
      checks.push({ label: "تطابق PageCount", status: "warn", detail: `PageCount=${parsedDef.header.pageCount} لكن DDS الفعلية=${ddsPositions.length}` });
      riskLevel = "medium";
    } else {
      checks.push({ label: "تطابق PageCount", status: "pass", detail: `PageCount=${parsedDef.header.pageCount} يطابق ${ddsPositions.length} DDS` });
    }

    // 4. Analyze FontDef position relative to archive structure
    const fontDefEnd = fontDefResult.offset + fontDefResult.length;
    const lastDDSEnd = ddsPositions.length > 0
      ? ddsPositions[ddsPositions.length - 1] + (ddsPositions.length > 1 ? ddsPositions[1] - ddsPositions[0] : DDS_FULL_SIZE_WITH_MIPS)
      : 0;
    const fontDefAfterDDS = fontDefResult.offset >= lastDDSEnd;

    if (fontDefAfterDDS) {
      checks.push({ label: "موقع FontDef", status: "pass", detail: "FontDef بعد آخر صفحة DDS — آمن للإضافة" });
    } else {
      checks.push({ label: "موقع FontDef", status: "warn", detail: "FontDef متداخل مع DDS — يتطلب حذراً إضافياً" });
      riskLevel = "medium";
    }

    // 5. Check dict entries after FontDef (shift risk)
    let entriesAfterFontDef = 0;
    let dictEntryForFontDef = false;
    if (dictData && archiveInfo && archiveInfo.entries.length > 0) {
      const view = new DataView(dictData.buffer, dictData.byteOffset, dictData.byteLength);
      const fileCount = view.getUint32(0x8, true);
      const tableStart = 0x2C + fileCount;

      for (let i = 0; i < fileCount; i++) {
        const entryOffset = tableStart + i * 16;
        if (entryOffset + 16 > dictData.length) break;
        const dataOffset = view.getUint32(entryOffset, true);
        const decompLen = view.getUint32(entryOffset + 4, true);
        const compLen = view.getUint32(entryOffset + 8, true);
        const declaredSpan = Math.max(decompLen, compLen);

        // Check if this entry covers FontDef
        if (dataOffset <= fontDefResult.offset && dataOffset + declaredSpan >= fontDefEnd) {
          dictEntryForFontDef = true;
        }
        // Check entries after FontDef
        if (dataOffset >= fontDefEnd) {
          entriesAfterFontDef++;
        }
      }

      if (dictEntryForFontDef) {
        checks.push({ label: "مرجع FontDef في dict", status: "pass", detail: "FontDef مسجل في جدول الأرشيف — سيتم تحديثه" });
      } else {
        checks.push({ label: "مرجع FontDef في dict", status: "warn", detail: "FontDef غير مسجل صراحة — سيتم التعامل تلقائياً" });
      }

      if (entriesAfterFontDef > 0) {
        checks.push({ label: "بيانات بعد FontDef", status: "warn", detail: `${entriesAfterFontDef} ملف بعد FontDef — سيتم إزاحة offsets` });
        riskLevel = riskLevel === "low" ? "medium" : riskLevel;
      } else {
        checks.push({ label: "بيانات بعد FontDef", status: "pass", detail: "لا توجد بيانات بعد FontDef — آمن تماماً" });
      }
    }

    // 6. Check existing Arabic glyphs
    const existingArabic = parsedDef.glyphs.filter(g => g.code >= 0x0600).length;
    if (existingArabic > 0) {
      checks.push({ label: "حروف عربية موجودة", status: "warn", detail: `${existingArabic} حرف عربي موجود — سيتم استبدالها` });
    }

    // 7. Determine mode
    const ddsSpacing = ddsPositions.length > 1 ? ddsPositions[1] - ddsPositions[0] : DDS_FULL_SIZE_WITH_MIPS;
    const tailSize = fontData.length - fontDefEnd;
    const estimatedNewSize = fontData.length + (generatedPages * ddsSpacing);

    // Decision logic
    if (!hasArchive) {
      // No archive — simple data file, append is safe
      mode = "append";
      modeReason = "ملف .data بدون أرشيف — الإضافة آمنة";
    } else if (entriesAfterFontDef === 0 && fontDefAfterDDS) {
      // Best case: FontDef is at the end, no entries after it
      mode = "append";
      modeReason = "FontDef في نهاية الملف — الإضافة آمنة بأقل مخاطر";
    } else if (entriesAfterFontDef > 0) {
      // Entries after FontDef need shifting
      mode = "append";
      modeReason = `الإضافة ممكنة مع إزاحة ${entriesAfterFontDef} مرجع — مخاطر متوسطة`;
      riskLevel = "medium";
    } else {
      mode = "append";
      modeReason = "البنية تدعم إضافة صفحات جديدة";
    }

    // If file size would increase dramatically, warn
    if (generatedPages > 0) {
      const sizeIncrease = ((estimatedNewSize - fontData.length) / fontData.length) * 100;
      if (sizeIncrease > 100) {
        checks.push({ label: "زيادة الحجم", status: "warn", detail: `الحجم سيزيد بـ ${sizeIncrease.toFixed(0)}% (${formatFileSize(estimatedNewSize)})` });
      } else {
        checks.push({ label: "حجم الملف المتوقع", status: "pass", detail: `${formatFileSize(fontData.length)} → ${formatFileSize(estimatedNewSize)} (+${sizeIncrease.toFixed(0)}%)` });
      }
    }

    // 8. Overall build readiness
    if (generatedPages === 0 && !fontDefData?.glyphs.some(g => g.code >= 0x0600)) {
      checks.push({ label: "جاهزية البناء", status: "warn", detail: "لم يتم توليد صفحات عربية بعد" });
    } else {
      checks.push({ label: "جاهزية البناء", status: "pass", detail: "جاهز للبناء" });
    }

    const hasFailure = checks.some(c => c.status === "fail");
    canBuild = !hasFailure;

    return { mode, modeReason, checks, canBuild, riskLevel, estimatedOutputSize: estimatedNewSize };
  }, [fontData, dictData, archiveInfo, fontDefData, generatedPages, hasArchive]);

  if (!report) return null;

  const riskColors = {
    low: "text-green-600 bg-green-500/10 border-green-500/30",
    medium: "text-yellow-600 bg-yellow-500/10 border-yellow-500/30",
    high: "text-destructive bg-destructive/10 border-destructive/30",
  };

  const riskLabels = { low: "منخفض", medium: "متوسط", high: "مرتفع" };

  const statusIcons = {
    pass: <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />,
    warn: <AlertTriangle className="w-3 h-3 text-yellow-500 shrink-0" />,
    fail: <XCircle className="w-3 h-3 text-destructive shrink-0" />,
  };

  return (
    <Card>
      <CardHeader className="px-3 pt-3 pb-2">
        <CardTitle className="text-xs flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5 text-primary" />
          فحص التوافق
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-2">
        {/* Mode recommendation */}
        <div className={`p-2 rounded-lg border ${report.mode === "append" ? "border-primary/30 bg-primary/5" : "border-yellow-500/30 bg-yellow-500/5"}`}>
          <div className="flex items-center gap-1.5 mb-1">
            {report.mode === "append" ? <Plus className="w-3.5 h-3.5 text-primary" /> : <Replace className="w-3.5 h-3.5 text-yellow-500" />}
            <span className="text-[10px] font-bold">
              {report.mode === "append" ? "الوضع: إضافة صفحات جديدة" : report.mode === "replace" ? "الوضع: استبدال جزئي" : "غير محدد"}
            </span>
          </div>
          <p className="text-[9px] text-muted-foreground">{report.modeReason}</p>
        </div>

        {/* Risk level */}
        <div className="flex items-center gap-2">
          <Badge className={`text-[8px] ${riskColors[report.riskLevel]}`}>
            مستوى المخاطر: {riskLabels[report.riskLevel]}
          </Badge>
          {report.canBuild ? (
            <Badge className="text-[8px] bg-green-500/10 text-green-600 border-green-500/30">✅ يمكن البناء</Badge>
          ) : (
            <Badge className="text-[8px] bg-destructive/10 text-destructive border-destructive/30">⛔ لا يمكن البناء</Badge>
          )}
        </div>

        {/* Checks list */}
        <div className="space-y-0.5">
          {report.checks.map((c, i) => (
            <div key={i} className="flex items-start gap-1.5 py-0.5">
              {statusIcons[c.status]}
              <div className="min-w-0">
                <span className="text-[9px] font-semibold text-foreground">{c.label}: </span>
                <span className="text-[9px] text-muted-foreground">{c.detail}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
