/**
 * GlyphBatchEditor — Batch operations on selected glyphs (bulk adjust metrics, presets).
 */
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Layers, Settings2, Zap, AlertTriangle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { NLGFontDef, NLGGlyphEntry } from "@/lib/nlg-font-def";

interface GlyphBatchEditorProps {
  fontDef: NLGFontDef;
  onBatchUpdate: (updates: Array<{ index: number; changes: Partial<NLGGlyphEntry> }>) => void;
}

type GlyphRange = "all-arabic" | "pres-b" | "pres-a" | "basic-arabic" | "all";

const RANGE_LABELS: Record<GlyphRange, string> = {
  "all-arabic": "كل العربية",
  "pres-b": "أشكال العرض ب",
  "pres-a": "أشكال العرض أ",
  "basic-arabic": "العربية الأساسية",
  "all": "جميع الحروف",
};

function filterByRange(glyphs: NLGGlyphEntry[], range: GlyphRange): number[] {
  const indices: number[] = [];
  glyphs.forEach((g, i) => {
    switch (range) {
      case "all-arabic": if (g.code >= 0x0600) indices.push(i); break;
      case "pres-b": if (g.code >= 0xFE70 && g.code <= 0xFEFF) indices.push(i); break;
      case "pres-a": if (g.code >= 0xFB50 && g.code <= 0xFDFF) indices.push(i); break;
      case "basic-arabic": if (g.code >= 0x0600 && g.code <= 0x06FF) indices.push(i); break;
      case "all": indices.push(i); break;
    }
  });
  return indices;
}

interface Preset {
  id: string;
  label: string;
  description: string;
  apply: (g: NLGGlyphEntry) => Partial<NLGGlyphEntry>;
}

const PRESETS: Preset[] = [
  {
    id: "auto-fit",
    label: "ملاءمة تلقائية",
    description: "Width = حجم البكسل + 1، RenderWidth = حجم البكسل + 2",
    apply: (g) => {
      const pw = g.x2 - g.x1;
      return { width: pw + 1, renderWidth: Math.max(pw + 2, g.renderWidth), xOffset: Math.min(g.xOffset, 2) };
    },
  },
  {
    id: "tight",
    label: "متقارب",
    description: "تقليل المسافات بين الحروف للاتصال الأفضل",
    apply: (g) => {
      const pw = g.x2 - g.x1;
      return { width: Math.max(1, pw - 1), renderWidth: pw, xOffset: 0 };
    },
  },
  {
    id: "wide",
    label: "واسع",
    description: "زيادة المسافات للوضوح",
    apply: (g) => {
      const pw = g.x2 - g.x1;
      return { width: pw + 3, renderWidth: pw + 4, xOffset: 1 };
    },
  },
  {
    id: "pixel-match",
    label: "مطابقة البكسل",
    description: "Width = حجم البكسل بالضبط",
    apply: (g) => {
      const pw = g.x2 - g.x1;
      return { width: pw, renderWidth: pw, xOffset: 0 };
    },
  },
  {
    id: "reset-offset",
    label: "صفر الإزاحة",
    description: "XOffset = 0 لجميع الحروف المحددة",
    apply: () => ({ xOffset: 0 }),
  },
];

export default function GlyphBatchEditor({ fontDef, onBatchUpdate }: GlyphBatchEditorProps) {
  const [showDialog, setShowDialog] = useState(false);
  const [range, setRange] = useState<GlyphRange>("all-arabic");
  const [mode, setMode] = useState<"preset" | "adjust">("preset");
  const [selectedPreset, setSelectedPreset] = useState<string>("auto-fit");
  const [widthDelta, setWidthDelta] = useState(0);
  const [rwDelta, setRwDelta] = useState(0);
  const [xOffDelta, setXOffDelta] = useState(0);

  const affectedIndices = useMemo(() => filterByRange(fontDef.glyphs, range), [fontDef.glyphs, range]);

  const applyChanges = () => {
    if (affectedIndices.length === 0) {
      toast({ title: "لا توجد حروف مطابقة", variant: "destructive" });
      return;
    }

    const updates: Array<{ index: number; changes: Partial<NLGGlyphEntry> }> = [];

    if (mode === "preset") {
      const preset = PRESETS.find(p => p.id === selectedPreset);
      if (!preset) return;
      for (const idx of affectedIndices) {
        updates.push({ index: idx, changes: preset.apply(fontDef.glyphs[idx]) });
      }
    } else {
      for (const idx of affectedIndices) {
        const g = fontDef.glyphs[idx];
        const changes: Partial<NLGGlyphEntry> = {};
        if (widthDelta !== 0) changes.width = Math.max(0, g.width + widthDelta);
        if (rwDelta !== 0) changes.renderWidth = Math.max(0, g.renderWidth + rwDelta);
        if (xOffDelta !== 0) changes.xOffset = Math.max(0, g.xOffset + xOffDelta);
        if (Object.keys(changes).length > 0) updates.push({ index: idx, changes });
      }
    }

    if (updates.length > 0) {
      onBatchUpdate(updates);
      toast({ title: "✅ تم التعديل الجماعي", description: `${updates.length} حرف` });
      setShowDialog(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="px-3 pt-3 pb-2">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-primary" />
            تعديل جماعي
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 space-y-2">
          <p className="text-[9px] text-muted-foreground">تعديل Width و RenderWidth و XOffset لمجموعة حروف دفعة واحدة</p>
          <div className="grid grid-cols-2 gap-1.5">
            {PRESETS.slice(0, 4).map(p => (
              <Button key={p.id} size="sm" variant="outline" className="h-auto py-1.5 text-[9px] flex-col items-start gap-0 text-right"
                onClick={() => { setSelectedPreset(p.id); setMode("preset"); setShowDialog(true); }}>
                <span className="font-semibold">{p.label}</span>
                <span className="text-[7px] text-muted-foreground">{p.description.slice(0, 30)}...</span>
              </Button>
            ))}
          </div>
          <Button size="sm" variant="secondary" className="w-full h-7 text-[9px] gap-1" onClick={() => { setMode("adjust"); setShowDialog(true); }}>
            <Settings2 className="w-3 h-3" /> تعديل مخصص
          </Button>
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-[95vw] sm:max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-primary" />
              تعديل جماعي
            </DialogTitle>
            <DialogDescription className="text-[9px]">
              {mode === "preset" ? `تطبيق: ${PRESETS.find(p => p.id === selectedPreset)?.label}` : "تعديل يدوي للقيم"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {/* Range selector */}
            <div className="space-y-1">
              <Label className="text-[10px]">نطاق الحروف</Label>
              <Select value={range} onValueChange={v => setRange(v as GlyphRange)}>
                <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(RANGE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Badge variant="outline" className="text-[8px]">{affectedIndices.length} حرف سيتأثر</Badge>
            </div>

            {mode === "preset" ? (
              <div className="space-y-1.5">
                <Label className="text-[10px]">النمط</Label>
                <Select value={selectedPreset} onValueChange={setSelectedPreset}>
                  <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRESETS.map(p => (
                      <SelectItem key={p.id} value={p.id} className="text-xs">{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[9px] text-muted-foreground p-1.5 rounded bg-muted/30">
                  {PRESETS.find(p => p.id === selectedPreset)?.description}
                </p>
              </div>
            ) : (
              <div className="space-y-2.5 p-2 rounded bg-muted/20 border border-border">
                <div className="space-y-1">
                  <div className="flex justify-between"><Label className="text-[10px]">Width ±</Label><span className="text-[9px] font-mono text-primary">{widthDelta > 0 ? "+" : ""}{widthDelta}</span></div>
                  <Slider value={[widthDelta]} onValueChange={v => setWidthDelta(v[0])} min={-10} max={10} step={1} />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between"><Label className="text-[10px]">RenderWidth ±</Label><span className="text-[9px] font-mono text-primary">{rwDelta > 0 ? "+" : ""}{rwDelta}</span></div>
                  <Slider value={[rwDelta]} onValueChange={v => setRwDelta(v[0])} min={-10} max={10} step={1} />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between"><Label className="text-[10px]">XOffset ±</Label><span className="text-[9px] font-mono text-primary">{xOffDelta > 0 ? "+" : ""}{xOffDelta}</span></div>
                  <Slider value={[xOffDelta]} onValueChange={v => setXOffDelta(v[0])} min={-5} max={5} step={1} />
                </div>
              </div>
            )}

            {affectedIndices.length > 100 && (
              <div className="flex items-center gap-1 text-[9px] text-yellow-600 p-1.5 rounded bg-yellow-500/10">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                سيتم تعديل {affectedIndices.length} حرف — تأكد من الحفظ
              </div>
            )}
          </div>

          <DialogFooter className="gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setShowDialog(false)}>إلغاء</Button>
            <Button size="sm" className="gap-1" onClick={applyChanges}>
              <Zap className="w-3 h-3" /> تطبيق ({affectedIndices.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
