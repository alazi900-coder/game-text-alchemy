/**
 * FontDefInspector — Displays font definition header info with visual metrics diagram.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Info } from "lucide-react";
import type { NLGFontDef } from "@/lib/nlg-font-def";

interface FontDefInspectorProps {
  fontDef: NLGFontDef;
}

export default function FontDefInspector({ fontDef }: FontDefInspectorProps) {
  const h = fontDef.header;
  const arabicCount = fontDef.glyphs.filter(g => g.code >= 0x0600).length;
  const latinCount = fontDef.glyphs.filter(g => g.code >= 0x0020 && g.code < 0x0600).length;
  const presFormCount = fontDef.glyphs.filter(g => g.code >= 0xFB50).length;

  return (
    <Card>
      <CardHeader className="px-3 pt-3 pb-2">
        <CardTitle className="text-xs flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5 text-primary" />
          معلومات الخط
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-3">
        {/* Font name & basic info */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-base font-bold text-foreground">{h.fontName}</span>
          <Badge variant="outline" className="text-[9px]">{h.fontSize}px</Badge>
          <Badge className="text-[9px] bg-primary/20 text-primary border-primary/30">
            {fontDef.glyphs.length} حرف
          </Badge>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
          <StatCard label="لاتيني" value={latinCount} />
          <StatCard label="عربي أساسي" value={arabicCount - presFormCount} accent />
          <StatCard label="أشكال عرض" value={presFormCount} accent />
          <StatCard label="الصفحات" value={h.pageCount} />
        </div>

        {/* Metrics visualization */}
        <div className="rounded border border-border bg-background p-2">
          <p className="text-[9px] text-muted-foreground mb-2 flex items-center gap-1">
            <Info className="w-3 h-3" />
            مقاييس الخط
          </p>
          <div className="relative h-20 flex items-end">
            {/* Baseline */}
            <div className="absolute bottom-6 left-0 right-0 border-t border-dashed border-primary/40" />
            <span className="absolute bottom-5 right-0 text-[7px] text-primary/60">Baseline</span>
            
            {/* Height bar */}
            <div className="relative w-8 mx-1">
              <div className="bg-muted/40 rounded-t" style={{ height: `${Math.min(70, h.height * 2)}px` }} />
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[7px] text-muted-foreground">{h.height}</span>
              <span className="text-[6px] text-muted-foreground text-center block mt-0.5">Height</span>
            </div>
            
            <div className="relative w-8 mx-1">
              <div className="bg-primary/20 rounded-t" style={{ height: `${Math.min(70, h.renderHeight * 2)}px` }} />
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[7px] text-primary">{h.renderHeight}</span>
              <span className="text-[6px] text-muted-foreground text-center block mt-0.5">Render</span>
            </div>
            
            <div className="relative w-8 mx-1">
              <div className="bg-secondary/30 rounded-t" style={{ height: `${Math.min(70, h.ascent * 2)}px` }} />
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[7px] text-secondary">{h.ascent}</span>
              <span className="text-[6px] text-muted-foreground text-center block mt-0.5">Ascent</span>
            </div>

            <div className="relative w-8 mx-1">
              <div className="bg-accent/20 rounded-t" style={{ height: `${Math.min(70, h.il * 4)}px` }} />
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[7px]">{h.il}</span>
              <span className="text-[6px] text-muted-foreground text-center block mt-0.5">IL</span>
            </div>
          </div>
        </div>

        {/* Detailed metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-[9px]">
          {[
            { label: "PageSize", value: h.pageSize },
            { label: "CharSpacing", value: h.charSpacing },
            { label: "LineHeight", value: h.lineHeight },
            { label: "RenderAscent", value: h.renderAscent },
          ].map(item => (
            <div key={item.label} className="flex justify-between p-1.5 rounded bg-muted/30">
              <span className="text-muted-foreground font-mono">{item.label}</span>
              <span className="font-bold font-mono">{item.value}</span>
            </div>
          ))}
        </div>

        <div className="flex gap-1.5 flex-wrap">
          <Badge variant="outline" className="text-[8px]">
            Color: RGB({h.colorR},{h.colorG},{h.colorB})
          </Badge>
          <Badge variant="outline" className="text-[8px]">
            TextType: {h.textType}
          </Badge>
          <Badge variant="outline" className="text-[8px]">
            Distribution: {h.distribution}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`p-2 rounded text-center ${accent ? 'bg-primary/10 border border-primary/20' : 'bg-muted/30'}`}>
      <p className="text-[8px] text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold ${accent ? 'text-primary' : 'text-foreground'}`}>{value}</p>
    </div>
  );
}
