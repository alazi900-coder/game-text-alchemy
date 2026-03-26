/**
 * FontDiagnosticPanel — Comprehensive font diagnostic and auto-fix for Arabic injection.
 * Detects: missing chars, bad metrics, wrong forms, quality issues, coordinate errors.
 */
import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  AlertTriangle, CheckCircle2, XCircle, Wrench, ScanSearch,
  Loader2, Zap, Shield, ChevronDown, ChevronUp
} from "lucide-react";
import type { NLGFontDef, NLGGlyphEntry } from "@/lib/nlg-font-def";
import { ARABIC_LETTERS, TASHKEEL } from "@/lib/arabic-forms-data";

interface DiagnosticIssue {
  type: "error" | "warning" | "info";
  category: string;
  message: string;
  glyphCode?: number;
  fix?: () => Partial<NLGGlyphEntry>;
}

interface FontDiagnosticPanelProps {
  fontDef: NLGFontDef;
  textures: HTMLCanvasElement[];
  onBatchUpdate?: (updates: Array<{ index: number; changes: Partial<NLGGlyphEntry> }>) => void;
}

/** Get all expected Arabic presentation form codes */
function getExpectedArabicCodes(): Set<number> {
  const codes = new Set<number>();
  for (const letter of ARABIC_LETTERS) {
    if (letter.isolated) codes.add(letter.isolated.codePointAt(0)!);
    if (letter.final) codes.add(letter.final.codePointAt(0)!);
    if (letter.initial) codes.add(letter.initial.codePointAt(0)!);
    if (letter.medial) codes.add(letter.medial.codePointAt(0)!);
  }
  for (const t of TASHKEEL) codes.add(t.code);
  return codes;
}

/** Calculate optimal metrics from pixel dimensions */
function calculateOptimalMetrics(
  g: NLGGlyphEntry,
  header: NLGFontDef["header"],
): Partial<NLGGlyphEntry> {
  const pixW = g.x2 - g.x1;
  const pixH = g.y2 - g.y1;
  if (pixW <= 0 || pixH <= 0) return {};

  const code = g.code;
  const isArabic = code >= 0x0600;

  // Determine form type from Unicode range
  let isInitial = false, isMedial = false, isFinal = false, isIsolated = false;
  if (code >= 0xFE70 && code <= 0xFEFF) {
    // Presentation Forms B — pattern: isolated, final, initial, medial (repeating groups of 4)
    const offset = (code - 0xFE70) % 4;
    if (offset === 0 || offset === 1) isIsolated = offset === 0;
    if (offset === 1) isFinal = true;
    if (offset === 2) isInitial = true;
    if (offset === 3) isMedial = true;
  }

  let width: number;
  let renderWidth: number;
  let xOffset: number;

  if (isInitial || isMedial) {
    // Connected forms: tighter width for better joining
    width = Math.max(1, pixW - 1);
    renderWidth = Math.max(width, pixW);
    xOffset = 0;
  } else if (isFinal) {
    // Final form: slight padding
    width = pixW + 1;
    renderWidth = Math.max(width, pixW + 2);
    xOffset = 1;
  } else if (isIsolated) {
    // Isolated: match pixel width + small padding
    width = pixW + 2;
    renderWidth = Math.max(width, pixW + 2);
    xOffset = 1;
  } else if (isArabic) {
    // Base Arabic range
    width = pixW + 1;
    renderWidth = Math.max(width, pixW + 2);
    xOffset = 0;
  } else {
    // Latin/other
    width = Math.max(g.width, pixW);
    renderWidth = Math.max(width, pixW);
    xOffset = g.xOffset;
  }

  // Ensure renderWidth >= width always
  renderWidth = Math.max(renderWidth, width);

  return { width, renderWidth, xOffset };
}

/** Check if a glyph has pixel data in the texture */
function hasPixelData(g: NLGGlyphEntry, tex: HTMLCanvasElement | undefined): boolean {
  if (!tex) return false;
  const w = g.x2 - g.x1;
  const h = g.y2 - g.y1;
  if (w <= 0 || h <= 0) return false;
  try {
    const ctx = tex.getContext("2d")!;
    const imgData = ctx.getImageData(g.x1, g.y1, w, h);
    let nonZero = 0;
    for (let i = 3; i < imgData.data.length; i += 4) {
      if (imgData.data[i] > 0) nonZero++;
    }
    return nonZero > 0;
  } catch {
    return false;
  }
}

export default function FontDiagnosticPanel({ fontDef, textures, onBatchUpdate }: FontDiagnosticPanelProps) {
  const [scanning, setScanning] = useState(false);
  const [issues, setIssues] = useState<DiagnosticIssue[] | null>(null);
  const [showDetails, setShowDetails] = useState(true);

  const existingCodes = useMemo(() => new Set(fontDef.glyphs.map(g => g.code)), [fontDef.glyphs]);
  const expectedArabic = useMemo(() => getExpectedArabicCodes(), []);

  const runDiagnostic = () => {
    setScanning(true);
    setTimeout(() => {
      const found: DiagnosticIssue[] = [];
      const glyphs = fontDef.glyphs;
      const header = fontDef.header;

      // 1. Missing Arabic characters
      const missingArabic: number[] = [];
      for (const code of expectedArabic) {
        if (!existingCodes.has(code)) missingArabic.push(code);
      }
      if (missingArabic.length > 0) {
        found.push({
          type: "error",
          category: "حروف مفقودة",
          message: `${missingArabic.length} حرف عربي مفقود من جدول الخط. هذا يسبب ظهور علامات الاستفهام ❓`,
        });
        // Show first 10 missing
        for (const code of missingArabic.slice(0, 10)) {
          found.push({
            type: "error",
            category: "مفقود",
            message: `U+${code.toString(16).toUpperCase().padStart(4, "0")} "${String.fromCodePoint(code)}" غير موجود`,
            glyphCode: code,
          });
        }
        if (missingArabic.length > 10) {
          found.push({
            type: "error",
            category: "مفقود",
            message: `... و${missingArabic.length - 10} حرف آخر`,
          });
        }
      } else if (glyphs.some(g => g.code >= 0x0600)) {
        found.push({
          type: "info",
          category: "حروف كاملة",
          message: "جميع أشكال العرض العربية موجودة ✓",
        });
      }

      // 2. Zero-width or negative metrics
      const zeroWidthGlyphs: number[] = [];
      const negativeMetrics: number[] = [];
      for (let i = 0; i < glyphs.length; i++) {
        const g = glyphs[i];
        if (g.code < 0x0600) continue;
        const pixW = g.x2 - g.x1;
        if (g.width <= 0 && pixW > 0) zeroWidthGlyphs.push(i);
        if (g.renderWidth < g.width) negativeMetrics.push(i);
      }
      if (zeroWidthGlyphs.length > 0) {
        found.push({
          type: "error",
          category: "عرض صفري",
          message: `${zeroWidthGlyphs.length} حرف عربي بعرض 0 — يسبب تراكم الحروف فوق بعضها`,
        });
      }
      if (negativeMetrics.length > 0) {
        found.push({
          type: "warning",
          category: "RenderWidth",
          message: `${negativeMetrics.length} حرف RenderWidth أقل من Width — قد يسبب قص الحرف`,
        });
      }

      // 3. Coordinates out of bounds
      const maxSize = textures.length > 0 ? textures[0].width : 1024;
      const outOfBounds: number[] = [];
      for (let i = 0; i < glyphs.length; i++) {
        const g = glyphs[i];
        if (g.x1 < 0 || g.y1 < 0 || g.x2 > maxSize || g.y2 > maxSize || g.x1 >= g.x2 || g.y1 >= g.y2) {
          outOfBounds.push(i);
        }
      }
      if (outOfBounds.length > 0) {
        found.push({
          type: "error",
          category: "إحداثيات",
          message: `${outOfBounds.length} حرف بإحداثيات خارج حدود الأطلس (${maxSize}×${maxSize})`,
        });
      }

      // 4. Page references beyond available textures
      const invalidPages = glyphs.filter(g => g.page >= header.pageCount);
      if (invalidPages.length > 0) {
        found.push({
          type: "error",
          category: "صفحة خاطئة",
          message: `${invalidPages.length} حرف يشير لصفحة غير موجودة (PageCount=${header.pageCount})`,
        });
      }

      // 5. Empty glyphs (have coordinates but no pixels)
      let emptyGlyphs = 0;
      for (const g of glyphs) {
        if (g.code < 0x0600) continue;
        const pixW = g.x2 - g.x1;
        const pixH = g.y2 - g.y1;
        if (pixW > 0 && pixH > 0 && g.page < textures.length) {
          if (!hasPixelData(g, textures[g.page])) emptyGlyphs++;
        }
      }
      if (emptyGlyphs > 0) {
        found.push({
          type: "warning",
          category: "حرف فارغ",
          message: `${emptyGlyphs} حرف عربي بإحداثيات صحيحة لكن بدون بكسلات — يظهر فارغاً`,
        });
      }

      // 6. Spacing issues — detect too-wide or too-narrow metrics
      let tooWide = 0, tooNarrow = 0;
      for (const g of glyphs) {
        if (g.code < 0x0600) continue;
        const pixW = g.x2 - g.x1;
        if (pixW <= 0) continue;
        if (g.width > pixW * 2) tooWide++;
        if (g.width < pixW * 0.5 && g.width > 0) tooNarrow++;
      }
      if (tooWide > 0) {
        found.push({
          type: "warning",
          category: "تباعد زائد",
          message: `${tooWide} حرف Width أكبر من ضعف عرض البكسل — يسبب فراغات كبيرة`,
        });
      }
      if (tooNarrow > 0) {
        found.push({
          type: "warning",
          category: "تداخل",
          message: `${tooNarrow} حرف Width أقل من نصف عرض البكسل — يسبب تداخل الحروف`,
        });
      }

      // 7. Duplicate codes
      const codeCounts = new Map<number, number>();
      for (const g of glyphs) {
        codeCounts.set(g.code, (codeCounts.get(g.code) || 0) + 1);
      }
      const duplicates = [...codeCounts.entries()].filter(([, c]) => c > 1);
      if (duplicates.length > 0) {
        found.push({
          type: "warning",
          category: "مكرر",
          message: `${duplicates.length} رمز مكرر في جدول الخط — قد يسبب سلوك غير متوقع`,
        });
      }

      // 8. PageCount mismatch
      const maxPage = Math.max(0, ...glyphs.map(g => g.page));
      if (maxPage + 1 > header.pageCount) {
        found.push({
          type: "error",
          category: "PageCount",
          message: `الرأس يعلن ${header.pageCount} صفحة لكن الحروف تستخدم ${maxPage + 1} — المحرك يتجاهل الصفحات الزائدة`,
        });
      }

      // Overall health score
      const errors = found.filter(i => i.type === "error").length;
      const warnings = found.filter(i => i.type === "warning").length;

      if (errors === 0 && warnings === 0 && glyphs.some(g => g.code >= 0x0600)) {
        found.unshift({
          type: "info",
          category: "سليم",
          message: "الخط سليم ولا توجد مشاكل ✓",
        });
      }

      setIssues(found);
      setScanning(false);
    }, 100);
  };

  const hasMissingArabic = issues?.some(i => i.category === "حروف مفقودة") ?? false;
  const hasFixableMetrics = useMemo(() => {
    return fontDef.glyphs.some(g => {
      if (g.code < 0x0600) return false;
      const pixW = g.x2 - g.x1;
      if (pixW <= 0) return false;
      const optimal = calculateOptimalMetrics(g, fontDef.header);
      return optimal.width !== g.width || optimal.renderWidth !== g.renderWidth || optimal.xOffset !== g.xOffset;
    });
  }, [fontDef]);

  const handleAutoFix = () => {
    if (!onBatchUpdate) return;
    const updates: Array<{ index: number; changes: Partial<NLGGlyphEntry> }> = [];
    
    for (let i = 0; i < fontDef.glyphs.length; i++) {
      const g = fontDef.glyphs[i];
      if (g.code < 0x0600) continue;
      const pixW = g.x2 - g.x1;
      if (pixW <= 0) continue;

      const optimal = calculateOptimalMetrics(g, fontDef.header);
      if (
        optimal.width !== g.width ||
        optimal.renderWidth !== g.renderWidth ||
        optimal.xOffset !== g.xOffset
      ) {
        updates.push({ index: i, changes: optimal });
      }
    }

    if (updates.length > 0) {
      onBatchUpdate(updates);
      setTimeout(runDiagnostic, 200);
    }
  };

  const errorCount = issues?.filter(i => i.type === "error").length ?? 0;
  const warningCount = issues?.filter(i => i.type === "warning").length ?? 0;
  const infoCount = issues?.filter(i => i.type === "info").length ?? 0;

  const healthScore = issues
    ? Math.max(0, 100 - errorCount * 15 - warningCount * 5)
    : null;

  const healthColor = healthScore !== null
    ? healthScore >= 80 ? "text-green-500" : healthScore >= 50 ? "text-yellow-500" : "text-red-500"
    : "";

  return (
    <Card>
      <CardHeader className="px-3 pt-3 pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-primary" />
            تشخيص شامل للخط
          </CardTitle>
          <div className="flex gap-1.5">
            {onBatchUpdate && issues && errorCount + warningCount > 0 && (
              <Button size="sm" variant="outline" className="h-6 text-[9px] gap-1 px-2 border-primary/30 text-primary"
                onClick={handleAutoFix}>
                <Wrench className="w-3 h-3" /> إصلاح تلقائي
              </Button>
            )}
            <Button size="sm" onClick={runDiagnostic} disabled={scanning} className="h-6 text-[9px] gap-1 px-2">
              {scanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <ScanSearch className="w-3 h-3" />}
              فحص
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-3 pb-3 space-y-2">
        {issues === null && !scanning && (
          <p className="text-[10px] text-muted-foreground text-center py-4">
            اضغط "فحص" لتحليل الخط واكتشاف المشاكل
          </p>
        )}

        {issues !== null && (
          <>
            {/* Health bar */}
            <div className="flex items-center gap-2">
              <Progress value={healthScore ?? 0} className="flex-1 h-2" />
              <span className={`text-sm font-bold ${healthColor}`}>{healthScore}%</span>
            </div>

            {/* Summary badges */}
            <div className="flex gap-1.5 flex-wrap">
              {errorCount > 0 && (
                <Badge variant="destructive" className="text-[8px] gap-0.5">
                  <XCircle className="w-2.5 h-2.5" /> {errorCount} خطأ
                </Badge>
              )}
              {warningCount > 0 && (
                <Badge className="text-[8px] gap-0.5 bg-yellow-500/20 text-yellow-700 border-yellow-500/30">
                  <AlertTriangle className="w-2.5 h-2.5" /> {warningCount} تحذير
                </Badge>
              )}
              {infoCount > 0 && (
                <Badge variant="secondary" className="text-[8px] gap-0.5">
                  <CheckCircle2 className="w-2.5 h-2.5" /> {infoCount} معلومة
                </Badge>
              )}
            </div>

            {/* Issue list */}
            <Button variant="ghost" size="sm" className="w-full h-5 text-[9px] text-muted-foreground gap-1"
              onClick={() => setShowDetails(!showDetails)}>
              {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {showDetails ? "إخفاء التفاصيل" : "عرض التفاصيل"}
            </Button>

            {showDetails && (
              <ScrollArea className="max-h-[250px]">
                <div className="space-y-1">
                  {issues.map((issue, idx) => (
                    <div key={idx} className={`flex items-start gap-1.5 p-1.5 rounded text-[9px] ${
                      issue.type === "error" ? "bg-destructive/5 border border-destructive/20" :
                      issue.type === "warning" ? "bg-yellow-500/5 border border-yellow-500/20" :
                      "bg-muted/30 border border-border"
                    }`}>
                      {issue.type === "error" ? <XCircle className="w-3 h-3 text-destructive shrink-0 mt-0.5" /> :
                       issue.type === "warning" ? <AlertTriangle className="w-3 h-3 text-yellow-500 shrink-0 mt-0.5" /> :
                       <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0 mt-0.5" />}
                      <div className="flex-1 min-w-0">
                        <Badge variant="outline" className="text-[7px] h-3.5 px-1 mb-0.5">{issue.category}</Badge>
                        <p className="text-foreground leading-relaxed">{issue.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}

            {/* Quick fix actions */}
            {onBatchUpdate && (errorCount > 0 || warningCount > 0) && (
              <div className="p-2 rounded bg-primary/5 border border-primary/20 space-y-1.5">
                {hasMissingArabic && !hasFixableMetrics ? (
                  <>
                    <p className="text-[10px] font-semibold text-yellow-600 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> الحروف العربية غير موجودة
                    </p>
                    <p className="text-[9px] text-muted-foreground">
                      يجب أولاً إضافة الحروف العربية من تبويب <strong>"إضافة العربية"</strong> ثم العودة للفحص والإصلاح.
                    </p>
                  </>
                ) : hasFixableMetrics ? (
                  <>
                    <p className="text-[10px] font-semibold text-primary flex items-center gap-1">
                      <Zap className="w-3 h-3" /> إصلاحات متاحة
                    </p>
                    <p className="text-[9px] text-muted-foreground">
                      "إصلاح تلقائي" يعدّل Width و RenderWidth و XOffset لجميع الحروف العربية بناءً على أبعاد البكسل الفعلية ونوع الشكل (معزول/بداية/وسط/نهاية).
                    </p>
                    <Button size="sm" className="w-full h-7 gap-1 text-xs" onClick={handleAutoFix}>
                      <Wrench className="w-3.5 h-3.5" /> تطبيق الإصلاح التلقائي
                    </Button>
                  </>
                ) : (
                  <p className="text-[10px] text-muted-foreground text-center py-1">
                    لا توجد إصلاحات تلقائية متاحة حالياً
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
