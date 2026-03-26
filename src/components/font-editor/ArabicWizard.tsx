/**
 * ArabicWizard — One-click automated Arabic font injection workflow.
 * Guides through: font selection → character config → atlas generation → injection.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Wand2, Download, Loader2, CheckCircle2, Paintbrush, Settings2,
  ChevronDown, ChevronUp, Palette, Type, Sparkles, ArrowLeft, ArrowRight
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { getArabicChars, ARABIC_LETTERS, TASHKEEL } from "@/lib/arabic-forms-data";
import { generateFontAtlas, type AtlasResult } from "@/lib/font-atlas-engine";

interface ArabicPresetFont {
  id: string;
  label: string;
  family: string;
  url: string;
  format: "truetype" | "opentype" | "woff" | "woff2";
}

const PRESET_FONTS: ArabicPresetFont[] = [
  { id: "noto-kufi-bold", label: "Noto Kufi Arabic (موصى به)", family: "Noto Kufi Arabic", url: "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoKufiArabic/NotoKufiArabic-Bold.ttf", format: "truetype" },
  { id: "noto-naskh-bold", label: "Noto Naskh Arabic", family: "Noto Naskh Arabic", url: "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoNaskhArabic/NotoNaskhArabic-Bold.ttf", format: "truetype" },
  { id: "cairo-bold", label: "Cairo Bold", family: "Cairo", url: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/cairo/Cairo-Bold.ttf", format: "truetype" },
];

interface ArabicWizardProps {
  textureSize: number;
  onAtlasGenerated: (result: AtlasResult, fontName: string, settings: ArabicWizardSettings) => void;
}

export interface ArabicWizardSettings {
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  fontColor: string;
  strokeWidth: number;
  strokeColor: string;
  padding: number;
  antiAlias: boolean;
  includeIsolated: boolean;
  includeInitial: boolean;
  includeMedial: boolean;
  includeFinal: boolean;
  includeTashkeel: boolean;
  includeEnglish: boolean;
  replaceMode: "append" | "replace";
}

export default function ArabicWizard({ textureSize, onAtlasGenerated }: ArabicWizardProps) {
  const [step, setStep] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [presetFontId, setPresetFontId] = useState(PRESET_FONTS[0].id);
  const [fontFamily, setFontFamily] = useState("Tajawal");
  const [customFontLoaded, setCustomFontLoaded] = useState(false);
  
  // Settings
  const [fontSize, setFontSize] = useState(52);
  const [fontWeight, setFontWeight] = useState("700");
  const [fontColor, setFontColor] = useState("#ffffff");
  const [strokeWidth, setStrokeWidth] = useState(0);
  const [strokeColor, setStrokeColor] = useState("#000000");
  const [padding, setPadding] = useState(3);
  const [antiAlias, setAntiAlias] = useState(true);

  // Char selection
  const [includeIsolated, setIncludeIsolated] = useState(true);
  const [includeInitial, setIncludeInitial] = useState(true);
  const [includeMedial, setIncludeMedial] = useState(true);
  const [includeFinal, setIncludeFinal] = useState(true);
  const [includeTashkeel, setIncludeTashkeel] = useState(true);
  const [includeEnglish, setIncludeEnglish] = useState(false);
  const [replaceMode, setReplaceMode] = useState<"append" | "replace">("append");
  
  const [showAdvanced, setShowAdvanced] = useState(false);

  const objectUrlsRef = useState<string[]>([])[0];

  const arabicChars = getArabicChars({
    isolated: includeIsolated, initial: includeInitial,
    medial: includeMedial, final: includeFinal,
    tashkeel: includeTashkeel, english: includeEnglish,
  });

  const handleDownloadPreset = async () => {
    const preset = PRESET_FONTS.find(p => p.id === presetFontId);
    if (!preset) return;
    setIsLoading(true);
    try {
      const resp = await fetch(preset.url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      objectUrlsRef.push(url);
      const face = new FontFace(preset.family, `url(${url}) format('${preset.format}')`);
      const loaded = await face.load();
      document.fonts.add(loaded);
      await document.fonts.ready;
      setFontFamily(preset.family);
      setCustomFontLoaded(true);
      toast({ title: "✅ تم تحميل الخط", description: preset.label });
      setStep(1);
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCustomFont = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const face = new FontFace("CustomArabicFont", `url(${url})`);
      const loaded = await face.load();
      document.fonts.add(loaded);
      setFontFamily("CustomArabicFont");
      setCustomFontLoaded(true);
      toast({ title: "✅ تم تحميل الخط", description: file.name });
      setStep(1);
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    }
  };

  const handleGenerate = () => {
    if (arabicChars.length === 0) return;
    setIsLoading(true);
    
    // Use setTimeout to allow UI to update
    setTimeout(() => {
      try {
        const result = generateFontAtlas({
          chars: arabicChars,
          fontFamily,
          fontSize,
          fontWeight,
          textureSize,
          padding,
          color: fontColor,
          strokeWidth,
          strokeColor,
          antiAlias,
        });

        onAtlasGenerated(result, fontFamily, {
          fontFamily, fontSize, fontWeight, fontColor,
          strokeWidth, strokeColor, padding, antiAlias,
          includeIsolated, includeInitial, includeMedial, includeFinal,
          includeTashkeel, includeEnglish, replaceMode,
        });

        setStep(3);
        toast({
          title: "✅ تم توليد الأطلس العربي",
          description: `${result.glyphs.length} حرف على ${result.pages.length} صفحة`,
        });
      } catch (err: any) {
        toast({ title: "خطأ في التوليد", description: err.message, variant: "destructive" });
      } finally {
        setIsLoading(false);
      }
    }, 50);
  };

  const steps = [
    { label: "الخط", icon: Type },
    { label: "الحروف", icon: Settings2 },
    { label: "الإعدادات", icon: Palette },
    { label: "✓", icon: CheckCircle2 },
  ];

  return (
    <Card className="border-primary/20">
      <CardHeader className="px-3 pt-3 pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Wand2 className="w-4 h-4 text-primary" />
          معالج إضافة العربية
        </CardTitle>
        {/* Step indicator */}
        <div className="flex items-center gap-1 mt-2">
          {steps.map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={i} className="flex items-center gap-0.5">
                <button
                  onClick={() => { if (i <= step || (i === step + 1 && i <= 2)) setStep(i); }}
                  className={`flex items-center gap-1 px-2 py-1 rounded-full text-[9px] transition-all ${
                    i === step
                      ? "bg-primary text-primary-foreground"
                      : i < step
                        ? "bg-primary/20 text-primary"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {s.label}
                </button>
                {i < steps.length - 1 && <div className={`w-4 h-0.5 rounded ${i < step ? "bg-primary" : "bg-muted"}`} />}
              </div>
            );
          })}
        </div>
      </CardHeader>

      <CardContent className="px-3 pb-3">
        {/* Step 0: Font Selection */}
        {step === 0 && (
          <div className="space-y-3">
            <p className="text-[10px] text-muted-foreground">اختر خطاً عربياً مناسباً للعبة. يُفضل خط عريض واضح.</p>
            
            <div className="space-y-2">
              <Label className="text-[10px]">خطوط جاهزة:</Label>
              <div className="space-y-1">
                {PRESET_FONTS.map(font => (
                  <button
                    key={font.id}
                    className={`w-full p-2 rounded border text-right text-xs transition-all ${
                      presetFontId === font.id
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-muted-foreground/30"
                    }`}
                    onClick={() => setPresetFontId(font.id)}
                  >
                    {font.label}
                  </button>
                ))}
              </div>
              <Button onClick={handleDownloadPreset} disabled={isLoading} className="w-full gap-1.5 h-8 text-xs">
                {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                تحميل وتفعيل
              </Button>
            </div>

            <div className="relative">
              <div className="absolute inset-x-0 top-1/2 border-t border-border" />
              <p className="relative text-center text-[9px] text-muted-foreground bg-card px-2 w-fit mx-auto">أو ارفع خط مخصص</p>
            </div>

            <Input type="file" accept=".ttf,.otf,.woff,.woff2" onChange={handleCustomFont} className="h-7 text-[10px]" />
          </div>
        )}

        {/* Step 1: Character Selection */}
        {step === 1 && (
          <div className="space-y-3">
            <p className="text-[10px] text-muted-foreground">اختر أشكال الحروف المطلوبة. يُنصح بتفعيل جميع الأشكال.</p>
            
            <div className="flex flex-wrap gap-2">
              {[
                { label: "معزول", checked: includeIsolated, set: setIncludeIsolated, count: ARABIC_LETTERS.filter(l => l.isolated).length },
                { label: "بداية", checked: includeInitial, set: setIncludeInitial, count: ARABIC_LETTERS.filter(l => l.initial).length },
                { label: "وسط", checked: includeMedial, set: setIncludeMedial, count: ARABIC_LETTERS.filter(l => l.medial).length },
                { label: "نهاية", checked: includeFinal, set: setIncludeFinal, count: ARABIC_LETTERS.filter(l => l.final).length },
                { label: "تشكيل", checked: includeTashkeel, set: setIncludeTashkeel, count: TASHKEEL.length },
                { label: "إنجليزي", checked: includeEnglish, set: setIncludeEnglish, count: 94 },
              ].map(f => (
                <label key={f.label} className="flex items-center gap-1 cursor-pointer">
                  <Checkbox checked={f.checked} onCheckedChange={v => f.set(!!v)} className="h-3.5 w-3.5" />
                  <span className="text-[10px]">{f.label} ({f.count})</span>
                </label>
              ))}
            </div>

            <ScrollArea className="h-[160px] rounded border bg-background p-1">
              <div className="grid grid-cols-[repeat(auto-fill,minmax(36px,1fr))] gap-0.5">
                {arabicChars.slice(0, 400).map(c => (
                  <div key={c.code} className="flex flex-col items-center p-0.5 rounded border border-border/50 text-center">
                    <span className="text-xs" dir="rtl">{c.code >= 0x064B && c.code <= 0x0652 ? `ـ${c.char}` : c.char}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="flex items-center justify-between">
              <Badge variant="secondary" className="text-[9px]">{arabicChars.length} حرف</Badge>
              <div className="flex gap-1.5">
                <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={() => setStep(0)}>
                  <ArrowRight className="w-3 h-3" />
                  السابق
                </Button>
                <Button size="sm" className="h-7 text-[10px] gap-1" onClick={() => setStep(2)}>
                  التالي
                  <ArrowLeft className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Settings & Generate */}
        {step === 2 && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px]">الحجم: {fontSize}px</Label>
                <Slider value={[fontSize]} onValueChange={v => setFontSize(v[0])} min={16} max={120} step={1} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">الوزن</Label>
                <Select value={fontWeight} onValueChange={setFontWeight}>
                  <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="400">عادي</SelectItem>
                    <SelectItem value="600">شبه عريض</SelectItem>
                    <SelectItem value="700">عريض</SelectItem>
                    <SelectItem value="900">أسود</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px] flex items-center gap-1"><Palette className="w-3 h-3" /> اللون</Label>
                <Input type="color" value={fontColor} onChange={e => setFontColor(e.target.value)} className="w-10 h-7 cursor-pointer p-0.5" />
              </div>
              <div className="flex items-center gap-1.5 pt-4">
                <Switch checked={antiAlias} onCheckedChange={setAntiAlias} id="aa-wiz" />
                <Label htmlFor="aa-wiz" className="text-[10px] cursor-pointer">Anti-alias</Label>
              </div>
            </div>

            <Button variant="ghost" size="sm" className="w-full h-6 text-[9px] text-muted-foreground gap-1" onClick={() => setShowAdvanced(!showAdvanced)}>
              {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              متقدم
            </Button>
            {showAdvanced && (
              <div className="space-y-2 p-2 rounded bg-muted/30 border border-border text-[10px]">
                <div className="space-y-1">
                  <Label className="text-[10px]">حدود: {strokeWidth}px</Label>
                  <Slider value={[strokeWidth]} onValueChange={v => setStrokeWidth(v[0])} min={0} max={6} step={0.5} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">هامش: {padding}px</Label>
                  <Slider value={[padding]} onValueChange={v => setPadding(v[0])} min={0} max={10} step={1} />
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant={replaceMode === "append" ? "default" : "outline"} className="flex-1 text-[9px] h-6" onClick={() => setReplaceMode("append")}>إلحاق</Button>
                  <Button size="sm" variant={replaceMode === "replace" ? "default" : "outline"} className="flex-1 text-[9px] h-6" onClick={() => setReplaceMode("replace")}>استبدال</Button>
                </div>
              </div>
            )}

            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" className="h-8 text-[10px] gap-1" onClick={() => setStep(1)}>
                <ArrowRight className="w-3 h-3" />
                السابق
              </Button>
              <Button onClick={handleGenerate} disabled={isLoading || arabicChars.length === 0} className="flex-1 h-8 gap-1.5 text-xs">
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                توليد الأطلس ({arabicChars.length} حرف)
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Done */}
        {step === 3 && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-primary" />
            </div>
            <p className="text-sm font-bold text-foreground">تم توليد الأطلس بنجاح!</p>
            <p className="text-[10px] text-muted-foreground">يمكنك الآن معاينة النتيجة وبناء الملف النهائي من تبويب "البناء"</p>
            <Badge variant="secondary" className="text-[9px]">{fontFamily} — {fontSize}px</Badge>
            <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={() => setStep(0)}>
              <Paintbrush className="w-3 h-3" />
              إعادة التوليد
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
