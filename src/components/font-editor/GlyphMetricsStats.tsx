/**
 * GlyphMetricsStats — Charts and statistics for glyph metrics distribution.
 */
import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3, TrendingUp, AlertTriangle } from "lucide-react";
import type { NLGFontDef, NLGGlyphEntry } from "@/lib/nlg-font-def";

interface GlyphMetricsStatsProps {
  fontDef: NLGFontDef;
}

function Histogram({ data, label, color }: { data: number[]; label: string; color: string }) {
  if (data.length === 0) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const bucketCount = Math.min(20, Math.max(5, Math.ceil(range)));
  const bucketSize = range / bucketCount;
  const buckets = new Array(bucketCount).fill(0);
  for (const v of data) {
    const idx = Math.min(bucketCount - 1, Math.floor((v - min) / bucketSize));
    buckets[idx]++;
  }
  const maxBucket = Math.max(...buckets);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-semibold text-foreground">{label}</span>
        <span className="text-[8px] text-muted-foreground font-mono">{min}–{max} (avg: {(data.reduce((a, b) => a + b, 0) / data.length).toFixed(1)})</span>
      </div>
      <div className="flex items-end gap-px h-10">
        {buckets.map((count, i) => (
          <div key={i} className="flex-1 rounded-t transition-all" style={{
            height: `${Math.max(2, (count / maxBucket) * 100)}%`,
            backgroundColor: color,
            opacity: count > 0 ? 0.3 + (count / maxBucket) * 0.7 : 0.1,
          }}
            title={`${(min + i * bucketSize).toFixed(0)}–${(min + (i + 1) * bucketSize).toFixed(0)}: ${count}`}
          />
        ))}
      </div>
    </div>
  );
}

export default function GlyphMetricsStats({ fontDef }: GlyphMetricsStatsProps) {
  const stats = useMemo(() => {
    const arabic = fontDef.glyphs.filter(g => g.code >= 0x0600);
    const latin = fontDef.glyphs.filter(g => g.code >= 0x0020 && g.code < 0x0600);
    const all = fontDef.glyphs;

    const calcStats = (glyphs: NLGGlyphEntry[]) => ({
      widths: glyphs.map(g => g.width),
      renderWidths: glyphs.map(g => g.renderWidth),
      xOffsets: glyphs.map(g => g.xOffset),
      pixelWidths: glyphs.map(g => g.x2 - g.x1),
      pixelHeights: glyphs.map(g => g.y2 - g.y1),
      avgWidth: glyphs.length ? glyphs.reduce((s, g) => s + g.width, 0) / glyphs.length : 0,
      avgRW: glyphs.length ? glyphs.reduce((s, g) => s + g.renderWidth, 0) / glyphs.length : 0,
      zeroWidth: glyphs.filter(g => g.width === 0).length,
      oversized: glyphs.filter(g => g.renderWidth > (g.x2 - g.x1) * 2).length,
      tooTight: glyphs.filter(g => g.width < (g.x2 - g.x1) * 0.5 && g.x2 - g.x1 > 3).length,
    });

    return {
      all: calcStats(all),
      arabic: calcStats(arabic),
      latin: calcStats(latin),
      arabicCount: arabic.length,
      latinCount: latin.length,
      pageUsage: Array.from(new Set(all.map(g => g.page))).map(p => ({
        page: p,
        count: all.filter(g => g.page === p).length,
      })).sort((a, b) => a.page - b.page),
    };
  }, [fontDef.glyphs]);

  const warnings = useMemo(() => {
    const w: string[] = [];
    if (stats.arabic.zeroWidth > 0) w.push(`${stats.arabic.zeroWidth} حرف عربي بعرض صفر`);
    if (stats.arabic.oversized > 0) w.push(`${stats.arabic.oversized} حرف بعرض عرض مبالغ`);
    if (stats.arabic.tooTight > 0) w.push(`${stats.arabic.tooTight} حرف ضيق جداً`);
    if (stats.arabicCount === 0) w.push("لا توجد حروف عربية في الخط");
    return w;
  }, [stats]);

  return (
    <Card>
      <CardHeader className="px-3 pt-3 pb-2">
        <CardTitle className="text-xs flex items-center gap-1.5">
          <BarChart3 className="w-3.5 h-3.5 text-primary" />
          إحصائيات القياسات
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-3">
        {/* Summary badges */}
        <div className="flex gap-1.5 flex-wrap">
          <Badge variant="outline" className="text-[8px]">
            <TrendingUp className="w-2.5 h-2.5 ml-1" />
            متوسط العرض: {stats.all.avgWidth.toFixed(1)}
          </Badge>
          <Badge variant="outline" className="text-[8px]">
            متوسط RW: {stats.all.avgRW.toFixed(1)}
          </Badge>
          {stats.arabicCount > 0 && (
            <Badge className="text-[8px] bg-primary/20 text-primary border-primary/30">
              عربي: {stats.arabic.avgWidth.toFixed(1)} avg
            </Badge>
          )}
        </div>

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="p-2 rounded bg-destructive/5 border border-destructive/20 space-y-0.5">
            {warnings.map((w, i) => (
              <p key={i} className="text-[9px] text-destructive flex items-center gap-1">
                <AlertTriangle className="w-2.5 h-2.5 shrink-0" /> {w}
              </p>
            ))}
          </div>
        )}

        {/* Histograms */}
        <div className="space-y-2.5">
          <Histogram data={stats.all.widths} label="Width (الكل)" color="hsl(var(--primary))" />
          <Histogram data={stats.all.renderWidths} label="RenderWidth (الكل)" color="hsl(var(--secondary))" />
          {stats.arabicCount > 0 && (
            <>
              <Histogram data={stats.arabic.widths} label="Width (عربي)" color="hsl(var(--primary))" />
              <Histogram data={stats.arabic.pixelWidths} label="حجم البكسل (عربي)" color="hsl(var(--accent))" />
            </>
          )}
        </div>

        {/* Page usage */}
        <div className="space-y-1">
          <span className="text-[9px] font-semibold">توزيع الصفحات</span>
          <div className="flex gap-1 flex-wrap">
            {stats.pageUsage.map(p => (
              <Badge key={p.page} variant="outline" className="text-[7px] font-mono px-1.5">
                ص{p.page}: {p.count}
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
