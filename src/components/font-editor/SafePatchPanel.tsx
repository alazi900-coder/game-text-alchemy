import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { Shield, Replace, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { reshapeArabic } from "@/lib/arabic-processing";
import type { NLGFontDef, NLGGlyphEntry } from "@/lib/nlg-font-def";

/**
 * Essential Arabic characters for basic game UI text.
 * Prioritized by frequency in Arabic text.
 */
const ESSENTIAL_ARABIC: { char: string; code: number; label: string }[] = [
  // Basic Arabic letters (isolated forms only for safe patch)
  { char: "ا", code: 0x0627, label: "ألف" },
  { char: "ب", code: 0x0628, label: "باء" },
  { char: "ت", code: 0x062A, label: "تاء" },
  { char: "ث", code: 0x062B, label: "ثاء" },
  { char: "ج", code: 0x062C, label: "جيم" },
  { char: "ح", code: 0x062D, label: "حاء" },
  { char: "خ", code: 0x062E, label: "خاء" },
  { char: "د", code: 0x062F, label: "دال" },
  { char: "ذ", code: 0x0630, label: "ذال" },
  { char: "ر", code: 0x0631, label: "راء" },
  { char: "ز", code: 0x0632, label: "زاي" },
  { char: "س", code: 0x0633, label: "سين" },
  { char: "ش", code: 0x0634, label: "شين" },
  { char: "ص", code: 0x0635, label: "صاد" },
  { char: "ض", code: 0x0636, label: "ضاد" },
  { char: "ط", code: 0x0637, label: "طاء" },
  { char: "ظ", code: 0x0638, label: "ظاء" },
  { char: "ع", code: 0x0639, label: "عين" },
  { char: "غ", code: 0x063A, label: "غين" },
  { char: "ف", code: 0x0641, label: "فاء" },
  { char: "ق", code: 0x0642, label: "قاف" },
  { char: "ك", code: 0x0643, label: "كاف" },
  { char: "ل", code: 0x0644, label: "لام" },
  { char: "م", code: 0x0645, label: "ميم" },
  { char: "ن", code: 0x0646, label: "نون" },
  { char: "ه", code: 0x0647, label: "هاء" },
  { char: "و", code: 0x0648, label: "واو" },
  { char: "ي", code: 0x064A, label: "ياء" },
  { char: "ة", code: 0x0629, label: "تاء مربوطة" },
  { char: "ى", code: 0x0649, label: "ألف مقصورة" },
  { char: "ء", code: 0x0621, label: "همزة" },
  { char: "أ", code: 0x0623, label: "ألف+همزة فوق" },
  { char: "إ", code: 0x0625, label: "ألف+همزة تحت" },
  { char: "آ", code: 0x0622, label: "ألف+مدة" },
  { char: "ؤ", code: 0x0624, label: "واو+همزة" },
  { char: "ئ", code: 0x0626, label: "ياء+همزة" },
];

/**
 * Latin characters that are safe to replace (rarely used in Luigi's Mansion 2 HD).
 * Excludes basic ASCII letters, digits, and common punctuation.
 */
const REPLACEABLE_LATIN_RANGES = [
  // Extended Latin characters unlikely to appear in game
  { from: 0x00C0, to: 0x00FF, label: "Latin Extended (À-ÿ)" },
  // Additional symbols
  { from: 0x2018, to: 0x201F, label: "Typographic quotes" },
  { from: 0x2013, to: 0x2014, label: "En/Em dashes" },
];

interface SafePatchPanelProps {
  fontDef: NLGFontDef;
  textures: HTMLCanvasElement[];
  onApplyPatch: (result: SafePatchResult) => void;
}

export interface SafePatchResult {
  /** Updated font def with Arabic glyphs replacing Latin ones */
  updatedFontDef: NLGFontDef;
  /** Map of page index → updated canvas with Arabic rendered on it */
  updatedPages: Map<number, HTMLCanvasElement>;
  /** How many Latin glyphs were replaced */
  replacedCount: number;
  /** How many Arabic glyphs were added */
  arabicCount: number;
  /** Which Latin glyphs were replaced */
  replacedGlyphs: Array<{ code: number; char: string }>;
}

export default function SafePatchPanel({ fontDef, textures, onApplyPatch }: SafePatchPanelProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedArabic, setSelectedArabic] = useState<Set<number>>(() => {
    // Select all essential Arabic by default
    return new Set(ESSENTIAL_ARABIC.map(a => a.code));
  });

  // Find replaceable Latin glyphs in the current font def
  const replaceableGlyphs = useMemo(() => {
    const replaceable: NLGGlyphEntry[] = [];
    for (const g of fontDef.glyphs) {
      // Check if glyph is in replaceable ranges
      for (const range of REPLACEABLE_LATIN_RANGES) {
        if (g.code >= range.from && g.code <= range.to) {
          replaceable.push(g);
          break;
        }
      }
    }
    return replaceable;
  }, [fontDef]);

  const maxArabicSlots = replaceableGlyphs.length;
  const selectedCount = selectedArabic.size;
  const canPatch = selectedCount > 0 && selectedCount <= maxArabicSlots;

  const toggleArabic = (code: number) => {
    setSelectedArabic(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const selectAll = () => setSelectedArabic(new Set(ESSENTIAL_ARABIC.map(a => a.code)));
  const selectNone = () => setSelectedArabic(new Set());

  const applyPatch = useCallback(async () => {
    if (!canPatch) return;
    setIsProcessing(true);

    try {
      // Get selected Arabic chars sorted by code
      const arabicChars = ESSENTIAL_ARABIC
        .filter(a => selectedArabic.has(a.code))
        .slice(0, maxArabicSlots);

      // Sort replaceable glyphs by code to have deterministic replacement
      const sortedReplaceable = [...replaceableGlyphs].sort((a, b) => a.code - b.code);
      const toReplace = sortedReplaceable.slice(0, arabicChars.length);

      // We'll render Arabic glyphs into the same atlas positions as the Latin ones
      const updatedPages = new Map<number, HTMLCanvasElement>();
      const newGlyphs = [...fontDef.glyphs];
      const replacedGlyphs: Array<{ code: number; char: string }> = [];

      // Determine font size from header
      const fontSize = fontDef.header.renderHeight || fontDef.header.height || 24;

      for (let i = 0; i < arabicChars.length; i++) {
        const arabic = arabicChars[i];
        const latin = toReplace[i];
        const glyphIdx = newGlyphs.findIndex(g => g.code === latin.code);
        if (glyphIdx === -1) continue;

        // Get or create page canvas copy
        const pageIdx = latin.page;
        let pageCanvas = updatedPages.get(pageIdx);
        if (!pageCanvas && textures[pageIdx]) {
          pageCanvas = document.createElement("canvas");
          pageCanvas.width = textures[pageIdx].width;
          pageCanvas.height = textures[pageIdx].height;
          const ctx = pageCanvas.getContext("2d")!;
          ctx.drawImage(textures[pageIdx], 0, 0);
          updatedPages.set(pageIdx, pageCanvas);
        }
        if (!pageCanvas) continue;

        const ctx = pageCanvas.getContext("2d")!;

        // Clear the old Latin glyph area
        const gw = latin.x2 - latin.x1;
        const gh = latin.y2 - latin.y1;
        ctx.clearRect(latin.x1, latin.y1, gw, gh);

        // Render Arabic character in the same slot
        ctx.save();
        ctx.fillStyle = "white";
        ctx.font = `${Math.min(fontSize, gh)}px "Tajawal", "Noto Sans Arabic", "Arial", sans-serif`;
        ctx.textBaseline = "top";
        ctx.textAlign = "center";

        // Reshape the Arabic character
        const shaped = reshapeArabic(arabic.char);
        ctx.fillText(shaped, latin.x1 + gw / 2, latin.y1 + 1);
        ctx.restore();

        // Update the glyph entry to point to Arabic
        const updatedEntry: NLGGlyphEntry = {
          charSpec: arabic.code.toString(),
          code: arabic.code,
          width: latin.width,
          renderWidth: latin.renderWidth,
          xOffset: latin.xOffset,
          x1: latin.x1,
          y1: latin.y1,
          x2: latin.x2,
          y2: latin.y2,
          page: latin.page,
        };

        newGlyphs[glyphIdx] = updatedEntry;
        replacedGlyphs.push({ code: latin.code, char: String.fromCodePoint(latin.code) });
      }

      // Sort glyphs by code
      newGlyphs.sort((a, b) => a.code - b.code);

      const updatedFontDef: NLGFontDef = {
        header: { ...fontDef.header },
        glyphs: newGlyphs,
        rawText: "",
      };

      const result: SafePatchResult = {
        updatedFontDef,
        updatedPages,
        replacedCount: replacedGlyphs.length,
        arabicCount: arabicChars.length,
        replacedGlyphs,
      };

      onApplyPatch(result);
      toast({
        title: "✅ Safe Patch مكتمل",
        description: `تم استبدال ${replacedGlyphs.length} حرف لاتيني بـ ${arabicChars.length} حرف عربي — بدون تغيير الحجم`,
      });
    } catch (err) {
      toast({ title: "خطأ", description: String(err), variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  }, [canPatch, selectedArabic, maxArabicSlots, replaceableGlyphs, fontDef, textures, onApplyPatch]);

  return (
    <Card className="border-yellow-500/30">
      <CardHeader className="px-3 pt-3 pb-2">
        <CardTitle className="text-xs flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5 text-yellow-500" />
          Safe Patch — استبدال بدون تغيير الحجم
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-2">
        <p className="text-[9px] text-muted-foreground">
          يستبدل حروف لاتينية نادرة الاستخدام (مثل À, Ñ, ü) بحروف عربية مباشرة على نفس الصفحات — الحجم لا يتغير.
        </p>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-1">
          <div className="p-1.5 rounded bg-muted/30 text-center">
            <p className="text-[7px] text-muted-foreground">خانات متاحة</p>
            <p className="text-lg font-bold">{maxArabicSlots}</p>
          </div>
          <div className="p-1.5 rounded bg-primary/10 text-center border border-primary/20">
            <p className="text-[7px] text-muted-foreground">محددة</p>
            <p className="text-lg font-bold text-primary">{selectedCount}</p>
          </div>
          <div className={`p-1.5 rounded text-center ${canPatch ? "bg-green-500/10 border border-green-500/20" : "bg-destructive/10 border border-destructive/20"}`}>
            <p className="text-[7px] text-muted-foreground">الحالة</p>
            <p className={`text-[10px] font-bold ${canPatch ? "text-green-600" : "text-destructive"}`}>
              {selectedCount === 0 ? "اختر حروف" : selectedCount > maxArabicSlots ? "كثيرة!" : "جاهز"}
            </p>
          </div>
        </div>

        {maxArabicSlots === 0 && (
          <div className="p-2 rounded bg-destructive/10 border border-destructive/30 text-[9px] text-destructive flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">لا توجد خانات قابلة للاستبدال</p>
              <p className="text-destructive/70">الخط لا يحتوي على أحرف Latin Extended — استخدم وضع الإضافة بدلاً من ذلك</p>
            </div>
          </div>
        )}

        {/* Replaceable Latin glyphs info */}
        {maxArabicSlots > 0 && (
          <div className="p-2 rounded bg-muted/20 text-[9px]">
            <p className="font-semibold text-foreground mb-0.5">سيتم استبدال:</p>
            <div className="flex flex-wrap gap-0.5">
              {replaceableGlyphs.slice(0, Math.min(selectedCount, 30)).map(g => (
                <Badge key={g.code} variant="secondary" className="text-[7px] h-4 px-1 font-mono">
                  {String.fromCodePoint(g.code)} U+{g.code.toString(16).toUpperCase()}
                </Badge>
              ))}
              {selectedCount > 30 && <Badge variant="secondary" className="text-[7px] h-4 px-1">+{selectedCount - 30}</Badge>}
            </div>
          </div>
        )}

        {/* Arabic character selection */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-semibold text-foreground">الحروف العربية ({selectedCount}/{ESSENTIAL_ARABIC.length})</p>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" className="h-5 text-[8px] px-1.5" onClick={selectAll}>تحديد الكل</Button>
              <Button variant="ghost" size="sm" className="h-5 text-[8px] px-1.5" onClick={selectNone}>إلغاء</Button>
            </div>
          </div>
          <ScrollArea className="h-[120px] rounded border border-border">
            <div className="grid grid-cols-2 gap-0">
              {ESSENTIAL_ARABIC.map(a => {
                const isSelected = selectedArabic.has(a.code);
                const isOverLimit = !isSelected && selectedCount >= maxArabicSlots;
                return (
                  <label
                    key={a.code}
                    className={`flex items-center gap-1.5 px-2 py-0.5 text-[9px] cursor-pointer hover:bg-muted/30 ${isOverLimit ? "opacity-40" : ""}`}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => !isOverLimit && toggleArabic(a.code)}
                      className="h-3 w-3"
                      disabled={isOverLimit}
                    />
                    <span className="text-sm font-bold w-4 text-center">{a.char}</span>
                    <span className="text-muted-foreground truncate">{a.label}</span>
                  </label>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        {/* Apply button */}
        <Button
          onClick={applyPatch}
          disabled={!canPatch || isProcessing}
          className="w-full gap-1.5 text-xs h-8"
          variant={canPatch ? "default" : "secondary"}
        >
          {isProcessing ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> جاري التطبيق...</>
          ) : (
            <><Replace className="w-3.5 h-3.5" /> تطبيق Safe Patch ({selectedCount} حرف)</>
          )}
        </Button>

        <p className="text-[8px] text-muted-foreground text-center">
          ⚡ لن يتغير حجم الملف — آمن 100% لتوافق اللعبة
        </p>
      </CardContent>
    </Card>
  );
}
