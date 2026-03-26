/**
 * FontQualityEnhancer — Tools to improve glyph rendering quality in the atlas.
 * Handles: supersampling, padding adjustments, contrast enhancement, size optimization.
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Sparkles, Loader2, Eye, Maximize2, ZoomIn } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { generateFontAtlas, type AtlasResult } from "@/lib/font-atlas-engine";
import { getArabicChars } from "@/lib/arabic-forms-data";

interface FontQualityEnhancerProps {
  currentAtlas: AtlasResult | null;
  fontFamily: string;
  textureSize: number;
  onEnhancedAtlas: (result: AtlasResult) => void;
}

export default function FontQualityEnhancer({
  currentAtlas, fontFamily, textureSize, onEnhancedAtlas
}: FontQualityEnhancerProps) {
  const [fontSize, setFontSize] = useState(currentAtlas?.fontSize ?? 52);
  const [padding, setPadding] = useState(3);
  const [superSample, setSuperSample] = useState(false);
  const [boldWeight, setBoldWeight] = useState("700");
  const [enhancing, setEnhancing] = useState(false);

  const handleEnhance = () => {
    setEnhancing(true);
    setTimeout(() => {
      try {
        const chars = getArabicChars({
          isolated: true, initial: true, medial: true,
          final: true, tashkeel: true, english: false,
        });

        // Supersampling: render at 2x then the engine will scale down
        const renderSize = superSample ? fontSize * 2 : fontSize;
        const renderTexSize = superSample ? textureSize * 2 : textureSize;

        const result = generateFontAtlas({
          chars,
          fontFamily,
          fontSize: renderSize,
          fontWeight: boldWeight,
          textureSize: renderTexSize,
          padding: superSample ? padding * 2 : padding,
          color: "#ffffff",
          antiAlias: true,
        });

        if (superSample) {
          // Downscale each atlas page to target size for sharper result
          const downscaled: typeof result.pages = [];
          for (const page of result.pages) {
            const canvas = document.createElement("canvas");
            canvas.width = textureSize;
            canvas.height = textureSize;
            const ctx = canvas.getContext("2d")!;
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(page.canvas, 0, 0, textureSize, textureSize);
            downscaled.push({ canvas, ctx });
          }

          // Adjust glyph coordinates for downscale
          const scale = textureSize / renderTexSize;
          const adjustedGlyphs = result.glyphs.map(g => ({
            ...g,
            atlasX: Math.round(g.atlasX * scale),
            atlasY: Math.round(g.atlasY * scale),
            width: Math.max(1, Math.round(g.width * scale)),
            height: Math.max(1, Math.round(g.height * scale)),
            bearingX: Math.round(g.bearingX * scale),
            bearingY: Math.round(g.bearingY * scale),
            advance: Math.max(1, Math.round(g.advance * scale)),
          }));

          onEnhancedAtlas({
            ...result,
            pages: downscaled,
            glyphs: adjustedGlyphs,
            fontSize,
            textureSize,
            ascent: Math.round(result.ascent * scale),
            descent: Math.round(result.descent * scale),
            lineHeight: Math.round(result.lineHeight * scale),
          });
        } else {
          onEnhancedAtlas(result);
        }

        toast({ title: "✅ تحسين الجودة", description: `${result.glyphs.length} حرف بجودة محسّنة` });
      } catch (err: any) {
        toast({ title: "خطأ", description: err.message, variant: "destructive" });
      } finally {
        setEnhancing(false);
      }
    }, 50);
  };

  return (
    <Card>
      <CardHeader className="px-3 pt-3 pb-2">
        <CardTitle className="text-xs flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          تحسين جودة الحروف
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-3">
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-[10px]">حجم الخط: {fontSize}px</Label>
            <Badge variant="outline" className="text-[7px]">
              {fontSize < 40 ? "صغير" : fontSize < 60 ? "متوسط" : "كبير"}
            </Badge>
          </div>
          <Slider value={[fontSize]} onValueChange={v => setFontSize(v[0])} min={24} max={96} step={2} />
          <p className="text-[8px] text-muted-foreground">حجم أكبر = وضوح أعلى لكن يحتاج صفحات أكثر</p>
        </div>

        <div className="space-y-1">
          <Label className="text-[10px]">هامش الأمان: {padding}px</Label>
          <Slider value={[padding]} onValueChange={v => setPadding(v[0])} min={1} max={8} step={1} />
          <p className="text-[8px] text-muted-foreground">هامش أكبر يمنع التداخل بين الحروف على الأطلس</p>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Switch checked={superSample} onCheckedChange={setSuperSample} id="ss" />
            <Label htmlFor="ss" className="text-[10px] cursor-pointer">SuperSampling (2x)</Label>
          </div>
          <Badge variant={superSample ? "default" : "secondary"} className="text-[7px]">
            {superSample ? "عالي الدقة" : "عادي"}
          </Badge>
        </div>
        {superSample && (
          <p className="text-[8px] text-yellow-600 bg-yellow-500/10 p-1.5 rounded border border-yellow-500/20">
            ⚠ الرسم بضعف الحجم ثم التصغير يعطي حواف أنعم لكنه أبطأ
          </p>
        )}

        <Button onClick={handleEnhance} disabled={enhancing} className="w-full h-8 gap-1.5 text-xs">
          {enhancing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          إعادة توليد بجودة محسّنة
        </Button>
      </CardContent>
    </Card>
  );
}
