/**
 * GlyphPreviewGrid — Visual grid showing actual glyph crops from the atlas textures.
 * Each glyph is cropped from its exact coordinates and displayed as a thumbnail.
 */
import { useEffect, useRef, useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, ZoomIn, Grid3x3, Maximize2, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { NLGGlyphEntry, NLGFontDef } from "@/lib/nlg-font-def";

interface GlyphPreviewGridProps {
  fontDef: NLGFontDef;
  textures: HTMLCanvasElement[];
  onGlyphSelect?: (glyph: NLGGlyphEntry, index: number) => void;
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
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext("2d")!;

  // Scale to fit maintaining aspect ratio
  const scale = Math.min(targetSize / w, targetSize / h) * 0.85;
  const drawW = w * scale;
  const drawH = h * scale;
  const drawX = (targetSize - drawW) / 2;
  const drawY = (targetSize - drawH) / 2;

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sourceCanvas, x1, y1, w, h, drawX, drawY, drawW, drawH);
  return canvas;
}

export default function GlyphPreviewGrid({ fontDef, textures, onGlyphSelect, selectedGlyphCode }: GlyphPreviewGridProps) {
  const [search, setSearch] = useState("");
  const [filterRange, setFilterRange] = useState<string>("all");
  const [inspectedGlyph, setInspectedGlyph] = useState<NLGGlyphEntry | null>(null);
  const inspectCanvasRef = useRef<HTMLCanvasElement>(null);
  const thumbnailCacheRef = useRef<Map<number, string>>(new Map());

  // Generate thumbnail data URLs
  const thumbnails = useMemo(() => {
    const cache = new Map<number, string>();
    for (const g of fontDef.glyphs) {
      if (g.page >= textures.length) continue;
      const tex = textures[g.page];
      if (!tex) continue;
      const cropped = cropGlyphToCanvas(tex, g.x1, g.y1, g.x2, g.y2, 48);
      if (cropped) {
        cache.set(g.code, cropped.toDataURL());
      }
    }
    thumbnailCacheRef.current = cache;
    return cache;
  }, [fontDef.glyphs, textures]);

  // Filter glyphs
  const filtered = useMemo(() => {
    return fontDef.glyphs.filter(g => {
      // Search filter
      if (search) {
        const s = search.toLowerCase();
        const ch = String.fromCodePoint(g.code);
        if (!ch.includes(s) && !g.code.toString(16).includes(s) && !g.charSpec.includes(s)) return false;
      }
      // Range filter
      if (filterRange === "arabic") return g.code >= 0x0600 && g.code <= 0x06FF;
      if (filterRange === "pres-b") return g.code >= 0xFE70 && g.code <= 0xFEFF;
      if (filterRange === "pres-a") return g.code >= 0xFB50 && g.code <= 0xFDFF;
      if (filterRange === "latin") return g.code >= 0x0020 && g.code <= 0x024F;
      if (filterRange === "all-arabic") return g.code >= 0x0600;
      return true;
    });
  }, [fontDef.glyphs, search, filterRange]);

  // Unicode range summary
  const rangeSummary = useMemo(() => {
    const ranges: Record<string, number> = {};
    for (const g of fontDef.glyphs) {
      const r = getUnicodeRange(g.code);
      ranges[r.label] = (ranges[r.label] || 0) + 1;
    }
    return ranges;
  }, [fontDef.glyphs]);

  // Inspect glyph detail
  useEffect(() => {
    if (!inspectedGlyph || !inspectCanvasRef.current) return;
    const canvas = inspectCanvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const size = 200;
    canvas.width = size;
    canvas.height = size;

    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, size, size);

    // Draw grid
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
        const drawW = w * scale;
        const drawH = h * scale;
        const drawX = (size - drawW) / 2;
        const drawY = (size - drawH) / 2;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tex, inspectedGlyph.x1, inspectedGlyph.y1, w, h, drawX, drawY, drawW, drawH);

        // Draw bounding box
        ctx.strokeStyle = "hsl(var(--primary))";
        ctx.lineWidth = 1;
        ctx.strokeRect(drawX, drawY, drawW, drawH);
      }
    }
  }, [inspectedGlyph, textures]);

  return (
    <>
      <Card>
        <CardHeader className="pb-2 px-3 pt-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-xs flex items-center gap-1.5">
              <Grid3x3 className="w-3.5 h-3.5 text-primary" />
              فحص الحروف ({fontDef.glyphs.length})
            </CardTitle>
            <div className="relative">
              <Search className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="بحث..."
                className="pr-7 w-28 sm:w-36 h-7 text-[10px]"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Range summary badges */}
          <div className="flex gap-1 flex-wrap mt-1.5">
            <Badge
              variant={filterRange === "all" ? "default" : "outline"}
              className="text-[8px] cursor-pointer h-5 px-1.5"
              onClick={() => setFilterRange("all")}
            >
              الكل ({fontDef.glyphs.length})
            </Badge>
            {Object.entries(rangeSummary).map(([name, count]) => (
              <Badge
                key={name}
                variant={filterRange === name ? "default" : "secondary"}
                className="text-[8px] cursor-pointer h-5 px-1.5"
                onClick={() => {
                  if (name === "عربي") setFilterRange("arabic");
                  else if (name === "عرض-ب") setFilterRange("pres-b");
                  else if (name === "عرض-أ") setFilterRange("pres-a");
                  else if (name === "ASCII" || name === "لاتيني+") setFilterRange("latin");
                  else setFilterRange("all");
                }}
              >
                {name}: {count}
              </Badge>
            ))}
            {(rangeSummary["عربي"] || 0) + (rangeSummary["عرض-أ"] || 0) + (rangeSummary["عرض-ب"] || 0) > 0 && (
              <Badge
                variant={filterRange === "all-arabic" ? "default" : "outline"}
                className="text-[8px] cursor-pointer h-5 px-1.5 border-primary/30 text-primary"
                onClick={() => setFilterRange("all-arabic")}
              >
                كل العربية
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="px-0 pb-0">
          <ScrollArea className="h-[350px] sm:h-[450px]">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-0.5 px-3 pb-3">
              {filtered.slice(0, 600).map((g, idx) => {
                const ch = String.fromCodePoint(g.code);
                const thumb = thumbnails.get(g.code);
                const isArabic = g.code >= 0x0600;
                const isSelected = selectedGlyphCode === g.code;
                const range = getUnicodeRange(g.code);

                return (
                  <div
                    key={`${g.code}-${idx}`}
                    className={`relative flex flex-col items-center rounded border transition-all cursor-pointer group overflow-hidden ${
                      isSelected
                        ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                        : isArabic
                          ? "border-primary/20 bg-primary/5 hover:border-primary/40"
                          : "border-border bg-card hover:border-muted-foreground/30"
                    }`}
                    onClick={() => onGlyphSelect?.(g, idx)}
                    title={`U+${g.code.toString(16).toUpperCase().padStart(4, "0")} | ${range.label} | W:${g.width} RW:${g.renderWidth} Page:${g.page}`}
                  >
                    {/* Thumbnail or character */}
                    <div className="w-full aspect-square flex items-center justify-center p-0.5">
                      {thumb ? (
                        <img src={thumb} alt={ch} className="w-full h-full object-contain" draggable={false} />
                      ) : (
                        <span className="text-base opacity-50" dir={isArabic ? "rtl" : "ltr"}>{ch}</span>
                      )}
                    </div>

                    {/* Code label */}
                    <div className="w-full text-center py-0.5 bg-muted/40">
                      <span className="text-[6px] sm:text-[7px] font-mono text-muted-foreground">
                        {g.code.toString(16).toUpperCase().padStart(4, "0")}
                      </span>
                    </div>

                    {/* Inspect button on hover */}
                    <button
                      className="absolute top-0.5 left-0.5 w-4 h-4 rounded bg-background/80 items-center justify-center hidden group-hover:flex"
                      onClick={e => { e.stopPropagation(); setInspectedGlyph(g); }}
                    >
                      <ZoomIn className="w-2.5 h-2.5 text-primary" />
                    </button>
                  </div>
                );
              })}
            </div>
            {filtered.length > 600 && (
              <p className="text-center text-[10px] text-muted-foreground pb-3">
                يعرض أول 600 من {filtered.length}
              </p>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Glyph Inspector Dialog */}
      {inspectedGlyph && (
        <Dialog open={!!inspectedGlyph} onOpenChange={open => { if (!open) setInspectedGlyph(null); }}>
          <DialogContent className="max-w-[95vw] sm:max-w-sm" dir="rtl">
            <DialogHeader>
              <DialogTitle className="text-sm flex items-center gap-2">
                <Maximize2 className="w-4 h-4 text-primary" />
                فحص حرف: {String.fromCodePoint(inspectedGlyph.code)}
                <Badge variant="outline" className="text-[9px] font-mono mr-auto">
                  U+{inspectedGlyph.code.toString(16).toUpperCase().padStart(4, "0")}
                </Badge>
              </DialogTitle>
            </DialogHeader>

            <div className="flex flex-col items-center gap-3">
              {/* Large glyph preview */}
              <div className="rounded-lg border border-border overflow-hidden bg-black">
                <canvas ref={inspectCanvasRef} className="block" style={{ width: 200, height: 200, imageRendering: "pixelated" }} />
              </div>

              {/* Metrics table */}
              <div className="w-full grid grid-cols-2 gap-1.5 text-[10px]">
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
            </div>

            <Button variant="outline" size="sm" onClick={() => setInspectedGlyph(null)} className="w-full mt-2">
              إغلاق
            </Button>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
