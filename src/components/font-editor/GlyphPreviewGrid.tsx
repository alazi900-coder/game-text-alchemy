/**
 * GlyphPreviewGrid — Visual grid with inline editing of glyph metrics + AI optimization.
 */
import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, ZoomIn, Grid3x3, Maximize2, Pencil, Wand2, Save, Loader2, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/hooks/use-toast";
import type { NLGGlyphEntry, NLGFontDef } from "@/lib/nlg-font-def";
import { supabase } from "@/integrations/supabase/client";

interface GlyphPreviewGridProps {
  fontDef: NLGFontDef;
  textures: HTMLCanvasElement[];
  onGlyphSelect?: (glyph: NLGGlyphEntry, index: number) => void;
  onGlyphUpdate?: (index: number, updated: Partial<NLGGlyphEntry>) => void;
  onBatchUpdate?: (updates: Array<{ index: number; changes: Partial<NLGGlyphEntry> }>) => void;
  selectedGlyphCode?: number | null;
}

function getUnicodeRange(code: number): { label: string; color: string } {
  if (code >= 0xFE70 && code <= 0xFEFF) return { label: "عرض-ب", color: "hsl(var(--primary))" };
  if (code >= 0xFB50 && code <= 0xFDFF) return { label: "عرض-أ", color: "hsl(var(--primary))" };
  if (code >= 0x0600 && code <= 0x06FF) return { label: "عربي", color: "hsl(var(--primary))" };
  if (code >= 0x0020 && code <= 0x007E) return { label: "ASCII", color: "hsl(var(--muted-foreground))" };
  if (code >= 0x00A0 && code <= 0x024F) return { label: "لاتيني+", color: "hsl(var(--muted-foreground))" };
  return { label: "أخرى", color: "hsl(var(--muted-foreground))" };
}

function cropGlyphToCanvas(
  sourceCanvas: HTMLCanvasElement,
  x1: number, y1: number, x2: number, y2: number,
  targetSize: number,
): HTMLCanvasElement | null {
  const w = x2 - x1;
  const h = y2 - y1;
  if (w <= 0 || h <= 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = targetSize; canvas.height = targetSize;
  const ctx = canvas.getContext("2d")!;
  const scale = Math.min(targetSize / w, targetSize / h) * 0.85;
  const drawW = w * scale, drawH = h * scale;
  const drawX = (targetSize - drawW) / 2, drawY = (targetSize - drawH) / 2;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sourceCanvas, x1, y1, w, h, drawX, drawY, drawW, drawH);
  return canvas;
}

export default function GlyphPreviewGrid({ fontDef, textures, onGlyphSelect, onGlyphUpdate, onBatchUpdate, selectedGlyphCode }: GlyphPreviewGridProps) {
  const [search, setSearch] = useState("");
  const [filterRange, setFilterRange] = useState<string>("all");
  const [inspectedGlyph, setInspectedGlyph] = useState<NLGGlyphEntry | null>(null);
  const [inspectedIndex, setInspectedIndex] = useState<number>(-1);
  const [editMode, setEditMode] = useState(false);
  const [editWidth, setEditWidth] = useState(0);
  const [editRenderWidth, setEditRenderWidth] = useState(0);
  const [editXOffset, setEditXOffset] = useState(0);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiBatchLoading, setAiBatchLoading] = useState(false);
  const inspectCanvasRef = useRef<HTMLCanvasElement>(null);

  // Thumbnails
  const thumbnails = useMemo(() => {
    const cache = new Map<number, string>();
    for (const g of fontDef.glyphs) {
      if (g.page >= textures.length) continue;
      const tex = textures[g.page];
      if (!tex) continue;
      const cropped = cropGlyphToCanvas(tex, g.x1, g.y1, g.x2, g.y2, 48);
      if (cropped) cache.set(g.code, cropped.toDataURL());
    }
    return cache;
  }, [fontDef.glyphs, textures]);

  // Filter
  const filtered = useMemo(() => {
    return fontDef.glyphs.filter(g => {
      if (search) {
        const s = search.toLowerCase();
        const ch = String.fromCodePoint(g.code);
        if (!ch.includes(s) && !g.code.toString(16).includes(s) && !g.charSpec.includes(s)) return false;
      }
      if (filterRange === "arabic") return g.code >= 0x0600 && g.code <= 0x06FF;
      if (filterRange === "pres-b") return g.code >= 0xFE70 && g.code <= 0xFEFF;
      if (filterRange === "pres-a") return g.code >= 0xFB50 && g.code <= 0xFDFF;
      if (filterRange === "latin") return g.code >= 0x0020 && g.code <= 0x024F;
      if (filterRange === "all-arabic") return g.code >= 0x0600;
      return true;
    });
  }, [fontDef.glyphs, search, filterRange]);

  const rangeSummary = useMemo(() => {
    const ranges: Record<string, number> = {};
    for (const g of fontDef.glyphs) {
      const r = getUnicodeRange(g.code);
      ranges[r.label] = (ranges[r.label] || 0) + 1;
    }
    return ranges;
  }, [fontDef.glyphs]);

  // Open inspector with edit values
  const openInspector = useCallback((g: NLGGlyphEntry, idx: number) => {
    setInspectedGlyph(g);
    setInspectedIndex(idx);
    setEditWidth(g.width);
    setEditRenderWidth(g.renderWidth);
    setEditXOffset(g.xOffset);
    setEditMode(false);
  }, []);

  // Draw inspect canvas
  useEffect(() => {
    if (!inspectedGlyph || !inspectCanvasRef.current) return;
    const canvas = inspectCanvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const size = 200;
    canvas.width = size; canvas.height = size;
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    for (let i = 0; i < size; i += 20) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
    }
    const tex = textures[inspectedGlyph.page];
    if (tex) {
      const w = inspectedGlyph.x2 - inspectedGlyph.x1;
      const h = inspectedGlyph.y2 - inspectedGlyph.y1;
      if (w > 0 && h > 0) {
        const scale = Math.min((size - 20) / w, (size - 20) / h);
        const drawW = w * scale, drawH = h * scale;
        const drawX = (size - drawW) / 2, drawY = (size - drawH) / 2;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tex, inspectedGlyph.x1, inspectedGlyph.y1, w, h, drawX, drawY, drawW, drawH);
        // Bounding box
        ctx.strokeStyle = "hsl(var(--primary))";
        ctx.lineWidth = 1;
        ctx.strokeRect(drawX, drawY, drawW, drawH);
        // Width indicator
        const widthPx = editWidth * scale;
        ctx.strokeStyle = "rgba(255, 200, 0, 0.6)";
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(drawX + widthPx, drawY); ctx.lineTo(drawX + widthPx, drawY + drawH); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }, [inspectedGlyph, textures, editWidth]);

  // Save edits
  const handleSave = () => {
    if (!inspectedGlyph || inspectedIndex < 0 || !onGlyphUpdate) return;
    onGlyphUpdate(inspectedIndex, { width: editWidth, renderWidth: editRenderWidth, xOffset: editXOffset });
    setEditMode(false);
    toast({ title: "✅ تم حفظ التعديلات" });
  };

  // AI optimize single glyph
  const handleAiOptimize = async () => {
    if (!inspectedGlyph || !onGlyphUpdate) return;
    setAiLoading(true);
    try {
      const glyphW = inspectedGlyph.x2 - inspectedGlyph.x1;
      const glyphH = inspectedGlyph.y2 - inspectedGlyph.y1;
      const { data, error } = await supabase.functions.invoke("optimize-glyph-metrics", {
        body: {
          mode: "single",
          glyph: {
            code: inspectedGlyph.code,
            char: String.fromCodePoint(inspectedGlyph.code),
            width: inspectedGlyph.width,
            renderWidth: inspectedGlyph.renderWidth,
            xOffset: inspectedGlyph.xOffset,
            pixelWidth: glyphW,
            pixelHeight: glyphH,
          },
          fontHeader: {
            fontSize: fontDef.header.fontSize,
            height: fontDef.header.height,
            renderHeight: fontDef.header.renderHeight,
            charSpacing: fontDef.header.charSpacing,
          },
        },
      });
      if (error) throw error;
      if (data?.width !== undefined) {
        setEditWidth(data.width);
        setEditRenderWidth(data.renderWidth);
        setEditXOffset(data.xOffset);
        setEditMode(true);
        toast({ title: "🤖 اقتراح الذكاء الاصطناعي", description: `Width: ${data.width}, RW: ${data.renderWidth}, XOff: ${data.xOffset}` });
      }
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message || "فشل تحسين الذكاء الاصطناعي", variant: "destructive" });
    } finally {
      setAiLoading(false);
    }
  };

  // AI batch optimize all Arabic glyphs
  const handleAiBatchOptimize = async () => {
    if (!onBatchUpdate) return;
    setAiBatchLoading(true);
    try {
      const arabicGlyphs = fontDef.glyphs
        .map((g, i) => ({ ...g, originalIndex: i }))
        .filter(g => g.code >= 0x0600);
      
      if (arabicGlyphs.length === 0) {
        toast({ title: "لا توجد حروف عربية للتحسين" });
        return;
      }

      // Send in chunks of 50
      const chunkSize = 50;
      const allUpdates: Array<{ index: number; changes: Partial<NLGGlyphEntry> }> = [];
      
      for (let c = 0; c < arabicGlyphs.length; c += chunkSize) {
        const chunk = arabicGlyphs.slice(c, c + chunkSize);
        const { data, error } = await supabase.functions.invoke("optimize-glyph-metrics", {
          body: {
            mode: "batch",
            glyphs: chunk.map(g => ({
              code: g.code,
              char: String.fromCodePoint(g.code),
              width: g.width,
              renderWidth: g.renderWidth,
              xOffset: g.xOffset,
              pixelWidth: g.x2 - g.x1,
              pixelHeight: g.y2 - g.y1,
            })),
            fontHeader: {
              fontSize: fontDef.header.fontSize,
              height: fontDef.header.height,
              renderHeight: fontDef.header.renderHeight,
              charSpacing: fontDef.header.charSpacing,
            },
          },
        });
        if (error) throw error;
        if (data?.results) {
          for (let i = 0; i < data.results.length && i < chunk.length; i++) {
            const r = data.results[i];
            allUpdates.push({
              index: chunk[i].originalIndex,
              changes: { width: r.width, renderWidth: r.renderWidth, xOffset: r.xOffset },
            });
          }
        }
      }

      if (allUpdates.length > 0) {
        onBatchUpdate(allUpdates);
        toast({ title: "🤖 تم تحسين الحروف العربية", description: `${allUpdates.length} حرف تم تعديله` });
      }
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message || "فشل التحسين الجماعي", variant: "destructive" });
    } finally {
      setAiBatchLoading(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-2 px-3 pt-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-xs flex items-center gap-1.5">
              <Grid3x3 className="w-3.5 h-3.5 text-primary" />
              فحص الحروف ({fontDef.glyphs.length})
            </CardTitle>
            <div className="flex items-center gap-1.5">
              {onBatchUpdate && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[9px] gap-1 border-primary/30 text-primary hover:bg-primary/10"
                  onClick={handleAiBatchOptimize}
                  disabled={aiBatchLoading}
                >
                  {aiBatchLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  تحسين العربية بالذكاء
                </Button>
              )}
              <div className="relative">
                <Search className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="بحث..." className="pr-7 w-28 sm:w-36 h-7 text-[10px]" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="flex gap-1 flex-wrap mt-1.5">
            <Badge variant={filterRange === "all" ? "default" : "outline"} className="text-[8px] cursor-pointer h-5 px-1.5" onClick={() => setFilterRange("all")}>
              الكل ({fontDef.glyphs.length})
            </Badge>
            {Object.entries(rangeSummary).map(([name, count]) => (
              <Badge key={name} variant={filterRange === name ? "default" : "secondary"} className="text-[8px] cursor-pointer h-5 px-1.5"
                onClick={() => {
                  if (name === "عربي") setFilterRange("arabic");
                  else if (name === "عرض-ب") setFilterRange("pres-b");
                  else if (name === "عرض-أ") setFilterRange("pres-a");
                  else if (name === "ASCII" || name === "لاتيني+") setFilterRange("latin");
                  else setFilterRange("all");
                }}>
                {name}: {count}
              </Badge>
            ))}
            {(rangeSummary["عربي"] || 0) + (rangeSummary["عرض-أ"] || 0) + (rangeSummary["عرض-ب"] || 0) > 0 && (
              <Badge variant={filterRange === "all-arabic" ? "default" : "outline"} className="text-[8px] cursor-pointer h-5 px-1.5 border-primary/30 text-primary" onClick={() => setFilterRange("all-arabic")}>
                كل العربية
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="px-0 pb-0">
          <ScrollArea className="h-[350px] sm:h-[450px]">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-0.5 px-3 pb-3">
              {filtered.slice(0, 600).map((g, idx) => {
                const realIdx = fontDef.glyphs.indexOf(g);
                const ch = String.fromCodePoint(g.code);
                const thumb = thumbnails.get(g.code);
                const isArabic = g.code >= 0x0600;
                const isSelected = selectedGlyphCode === g.code;
                const range = getUnicodeRange(g.code);
                return (
                  <div key={`${g.code}-${idx}`}
                    className={`relative flex flex-col items-center rounded border transition-all cursor-pointer group overflow-hidden ${
                      isSelected ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                        : isArabic ? "border-primary/20 bg-primary/5 hover:border-primary/40"
                        : "border-border bg-card hover:border-muted-foreground/30"
                    }`}
                    onClick={() => onGlyphSelect?.(g, realIdx)}
                    title={`U+${g.code.toString(16).toUpperCase().padStart(4, "0")} | W:${g.width} RW:${g.renderWidth} XOff:${g.xOffset}`}>
                    <div className="w-full aspect-square flex items-center justify-center p-0.5">
                      {thumb ? (
                        <img src={thumb} alt={ch} className="w-full h-full object-contain" draggable={false} />
                      ) : (
                        <span className="text-base opacity-50" dir={isArabic ? "rtl" : "ltr"}>{ch}</span>
                      )}
                    </div>
                    <div className="w-full text-center py-0.5 bg-muted/40">
                      <span className="text-[6px] sm:text-[7px] font-mono text-muted-foreground">
                        {g.code.toString(16).toUpperCase().padStart(4, "0")}
                      </span>
                    </div>
                    <button
                      className="absolute top-0.5 left-0.5 w-4 h-4 rounded bg-background/80 items-center justify-center hidden group-hover:flex"
                      onClick={e => { e.stopPropagation(); openInspector(g, realIdx); }}>
                      <ZoomIn className="w-2.5 h-2.5 text-primary" />
                    </button>
                  </div>
                );
              })}
            </div>
            {filtered.length > 600 && (
              <p className="text-center text-[10px] text-muted-foreground pb-3">يعرض أول 600 من {filtered.length}</p>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Glyph Inspector Dialog with Editing */}
      {inspectedGlyph && (
        <Dialog open={!!inspectedGlyph} onOpenChange={open => { if (!open) setInspectedGlyph(null); }}>
          <DialogContent className="max-w-[95vw] sm:max-w-md" dir="rtl">
            <DialogHeader>
              <DialogTitle className="text-sm flex items-center gap-2">
                <Maximize2 className="w-4 h-4 text-primary" />
                فحص: {String.fromCodePoint(inspectedGlyph.code)}
                <Badge variant="outline" className="text-[9px] font-mono mr-auto">
                  U+{inspectedGlyph.code.toString(16).toUpperCase().padStart(4, "0")}
                </Badge>
              </DialogTitle>
            </DialogHeader>

            <div className="flex flex-col items-center gap-3">
              <div className="rounded-lg border border-border overflow-hidden bg-black">
                <canvas ref={inspectCanvasRef} className="block" style={{ width: 200, height: 200, imageRendering: "pixelated" }} />
              </div>

              {/* Editable metrics */}
              <div className="w-full space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">القياسات</span>
                  <div className="flex gap-1">
                    {onGlyphUpdate && (
                      <>
                        <Button size="sm" variant={editMode ? "default" : "outline"} className="h-6 text-[9px] gap-1 px-2"
                          onClick={() => setEditMode(!editMode)}>
                          <Pencil className="w-2.5 h-2.5" /> {editMode ? "تحرير" : "تعديل"}
                        </Button>
                        <Button size="sm" variant="outline" className="h-6 text-[9px] gap-1 px-2 border-primary/30 text-primary"
                          onClick={handleAiOptimize} disabled={aiLoading}>
                          {aiLoading ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Wand2 className="w-2.5 h-2.5" />}
                          ذكاء
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {editMode ? (
                  <div className="space-y-2.5 p-2.5 rounded-lg bg-muted/20 border border-border">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-[10px]">Width (العرض)</Label>
                        <span className="text-[9px] font-mono text-primary font-bold">{editWidth}</span>
                      </div>
                      <Slider value={[editWidth]} onValueChange={v => setEditWidth(v[0])} min={0} max={Math.max(100, editWidth + 20)} step={1} />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-[10px]">RenderWidth (عرض العرض)</Label>
                        <span className="text-[9px] font-mono text-primary font-bold">{editRenderWidth}</span>
                      </div>
                      <Slider value={[editRenderWidth]} onValueChange={v => setEditRenderWidth(v[0])} min={0} max={Math.max(100, editRenderWidth + 20)} step={1} />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-[10px]">XOffset (إزاحة X)</Label>
                        <span className="text-[9px] font-mono text-primary font-bold">{editXOffset}</span>
                      </div>
                      <Slider value={[editXOffset]} onValueChange={v => setEditXOffset(v[0])} min={0} max={Math.max(50, editXOffset + 10)} step={1} />
                    </div>
                    <Button size="sm" className="w-full h-7 gap-1 text-xs" onClick={handleSave}>
                      <Save className="w-3 h-3" /> حفظ التعديلات
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                    {[
                      { label: "CharSpec", value: inspectedGlyph.charSpec },
                      { label: "الحرف", value: String.fromCodePoint(inspectedGlyph.code) },
                      { label: "Width", value: inspectedGlyph.width },
                      { label: "RenderWidth", value: inspectedGlyph.renderWidth },
                      { label: "XOffset", value: inspectedGlyph.xOffset },
                      { label: "الصفحة", value: inspectedGlyph.page },
                      { label: "X1,Y1", value: `${inspectedGlyph.x1}, ${inspectedGlyph.y1}` },
                      { label: "X2,Y2", value: `${inspectedGlyph.x2}, ${inspectedGlyph.y2}` },
                      { label: "الأبعاد", value: `${inspectedGlyph.x2 - inspectedGlyph.x1} × ${inspectedGlyph.y2 - inspectedGlyph.y1}` },
                      { label: "النطاق", value: getUnicodeRange(inspectedGlyph.code).label },
                    ].map(item => (
                      <div key={item.label} className="flex justify-between p-1.5 rounded bg-muted/30">
                        <span className="text-muted-foreground">{item.label}</span>
                        <span className="font-bold font-mono">{item.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setInspectedGlyph(null)}>إغلاق</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
