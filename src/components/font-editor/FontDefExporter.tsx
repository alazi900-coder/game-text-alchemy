/**
 * FontDefExporter — Export font definition as text, CSV, or compare before/after.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Download, FileText, FileSpreadsheet, Copy, Check, Eye } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { serializeNLGFontDef, type NLGFontDef, type NLGGlyphEntry } from "@/lib/nlg-font-def";

interface FontDefExporterProps {
  fontDef: NLGFontDef;
  originalFontDef?: NLGFontDef | null;
}

export default function FontDefExporter({ fontDef, originalFontDef }: FontDefExporterProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [copied, setCopied] = useState(false);

  const exportAsText = () => {
    const text = serializeNLGFontDef(fontDef);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = `${fontDef.header.fontName}_fontdef.txt`;
    a.click();
    toast({ title: "✅ تم تصدير جدول الخط" });
  };

  const exportAsCSV = () => {
    const header = "Code,Char,CharSpec,Width,RenderWidth,XOffset,X1,Y1,X2,Y2,Page,PixelW,PixelH\n";
    const rows = fontDef.glyphs.map(g => {
      const ch = String.fromCodePoint(g.code);
      return `${g.code},${ch === "," ? '","' : ch},${g.charSpec},${g.width},${g.renderWidth},${g.xOffset},${g.x1},${g.y1},${g.x2},${g.y2},${g.page},${g.x2 - g.x1},${g.y2 - g.y1}`;
    }).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([header + rows], { type: "text/csv" }));
    a.download = `${fontDef.header.fontName}_glyphs.csv`;
    a.click();
    toast({ title: "✅ تم تصدير CSV" });
  };

  const copyFontDef = async () => {
    const text = serializeNLGFontDef(fontDef);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "📋 تم النسخ" });
  };

  // Diff calculation
  const diffEntries = originalFontDef ? (() => {
    const origMap = new Map(originalFontDef.glyphs.map(g => [g.code, g]));
    const changes: Array<{ glyph: NLGGlyphEntry; original?: NLGGlyphEntry; type: "added" | "modified" | "unchanged" }> = [];
    for (const g of fontDef.glyphs) {
      const orig = origMap.get(g.code);
      if (!orig) {
        changes.push({ glyph: g, type: "added" });
      } else if (orig.width !== g.width || orig.renderWidth !== g.renderWidth || orig.xOffset !== g.xOffset) {
        changes.push({ glyph: g, original: orig, type: "modified" });
      }
    }
    return changes;
  })() : [];

  return (
    <>
      <Card>
        <CardHeader className="px-3 pt-3 pb-2">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-primary" />
            تصدير جدول الخط
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 space-y-2">
          <div className="grid grid-cols-2 gap-1.5">
            <Button size="sm" variant="outline" className="h-7 text-[9px] gap-1" onClick={exportAsText}>
              <FileText className="w-3 h-3" /> NLG Text
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-[9px] gap-1" onClick={exportAsCSV}>
              <FileSpreadsheet className="w-3 h-3" /> CSV
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-[9px] gap-1" onClick={copyFontDef}>
              {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
              {copied ? "تم النسخ" : "نسخ"}
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-[9px] gap-1" onClick={() => setShowPreview(true)}>
              <Eye className="w-3 h-3" /> معاينة
            </Button>
          </div>

          {originalFontDef && diffEntries.length > 0 && (
            <Button size="sm" variant="secondary" className="w-full h-7 text-[9px] gap-1 border-primary/20" onClick={() => setShowDiff(true)}>
              <FileText className="w-3 h-3" />
              مقارنة التعديلات ({diffEntries.filter(d => d.type !== "unchanged").length} تغيير)
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg max-h-[80vh]" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-sm">معاينة جدول الخط</DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-[400px]">
            <pre className="text-[8px] font-mono p-2 bg-muted/30 rounded whitespace-pre-wrap break-all leading-relaxed" dir="ltr">
              {serializeNLGFontDef(fontDef)}
            </pre>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowPreview(false)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diff Dialog */}
      <Dialog open={showDiff} onOpenChange={setShowDiff}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg max-h-[80vh]" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              مقارنة التعديلات
              <Badge className="text-[8px] bg-green-500/20 text-green-600">{diffEntries.filter(d => d.type === "added").length} جديد</Badge>
              <Badge className="text-[8px] bg-yellow-500/20 text-yellow-600">{diffEntries.filter(d => d.type === "modified").length} معدّل</Badge>
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-[400px]">
            <div className="space-y-0.5">
              {diffEntries.filter(d => d.type !== "unchanged").map((d, i) => (
                <div key={i} className={`p-1.5 rounded text-[9px] border ${d.type === "added" ? "bg-green-500/5 border-green-500/20" : "bg-yellow-500/5 border-yellow-500/20"}`}>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[7px] font-mono px-1 h-4">
                      U+{d.glyph.code.toString(16).toUpperCase().padStart(4, "0")}
                    </Badge>
                    <span className="text-sm">{String.fromCodePoint(d.glyph.code)}</span>
                    <Badge className={`text-[7px] h-4 px-1 ${d.type === "added" ? "bg-green-500/20 text-green-600" : "bg-yellow-500/20 text-yellow-600"}`}>
                      {d.type === "added" ? "جديد" : "معدّل"}
                    </Badge>
                  </div>
                  {d.type === "modified" && d.original && (
                    <div className="mt-1 grid grid-cols-3 gap-1 text-[8px]" dir="ltr">
                      <DiffValue label="W" old={d.original.width} cur={d.glyph.width} />
                      <DiffValue label="RW" old={d.original.renderWidth} cur={d.glyph.renderWidth} />
                      <DiffValue label="XOff" old={d.original.xOffset} cur={d.glyph.xOffset} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowDiff(false)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DiffValue({ label, old, cur }: { label: string; old: number; cur: number }) {
  const changed = old !== cur;
  return (
    <div className={`p-1 rounded text-center ${changed ? "bg-yellow-500/10" : "bg-muted/20"}`}>
      <span className="text-muted-foreground">{label}: </span>
      {changed ? (
        <span><span className="line-through text-muted-foreground">{old}</span> → <span className="font-bold text-yellow-600">{cur}</span></span>
      ) : (
        <span className="font-mono">{cur}</span>
      )}
    </div>
  );
}
