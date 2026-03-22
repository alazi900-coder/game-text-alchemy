import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Paintbrush } from "lucide-react";
import { ARABIC_LETTERS, TASHKEEL, getArabicChars } from "@/lib/arabic-forms-data";

interface ArabicCharsPanelProps {
  onGenerate: (chars: { char: string; code: number }[]) => void;
  hasTextures: boolean;
}

export default function ArabicCharsPanel({ onGenerate, hasTextures }: ArabicCharsPanelProps) {
  const [includeIsolated, setIncludeIsolated] = useState(true);
  const [includeInitial, setIncludeInitial] = useState(true);
  const [includeMedial, setIncludeMedial] = useState(true);
  const [includeFinal, setIncludeFinal] = useState(true);
  const [includeTashkeel, setIncludeTashkeel] = useState(true);
  const [includeEnglish, setIncludeEnglish] = useState(false);
  const [selectedCodes, setSelectedCodes] = useState<Set<number>>(new Set());

  const chars = useMemo(() => getArabicChars({
    isolated: includeIsolated,
    initial: includeInitial,
    medial: includeMedial,
    final: includeFinal,
    tashkeel: includeTashkeel,
    english: includeEnglish,
  }), [includeIsolated, includeInitial, includeMedial, includeFinal, includeTashkeel, includeEnglish]);

  const toggleChar = (code: number) => {
    setSelectedCodes(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const arabicCount = chars.filter(c => c.code >= 0xFE70).length;
  const tashkeelCount = chars.filter(c => c.code >= 0x064B && c.code <= 0x0652).length;
  const englishCount = chars.filter(c => c.code >= 0x21 && c.code <= 0x7E).length;

  const handleGenerate = () => {
    onGenerate(chars);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">الأحرف العربية وأشكالها</CardTitle>
          <p className="text-xs text-muted-foreground">كل حرف عربي له 4 أشكال: معزول، بداية، وسط، نهاية</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Form filters */}
          <div className="flex flex-wrap gap-4">
            {[
              { label: "معزول", checked: includeIsolated, set: setIncludeIsolated },
              { label: "بداية", checked: includeInitial, set: setIncludeInitial },
              { label: "وسط", checked: includeMedial, set: setIncludeMedial },
              { label: "نهاية", checked: includeFinal, set: setIncludeFinal },
              { label: "تشكيل", checked: includeTashkeel, set: setIncludeTashkeel },
              { label: "إنجليزي", checked: includeEnglish, set: setIncludeEnglish },
            ].map(f => (
              <div key={f.label} className="flex items-center gap-1.5">
                <Checkbox checked={f.checked} onCheckedChange={v => f.set(!!v)} id={`cb-${f.label}`} />
                <Label htmlFor={`cb-${f.label}`} className="text-xs cursor-pointer">{f.label}</Label>
              </div>
            ))}
          </div>

          {/* Char grid */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))] gap-1 max-h-[300px] overflow-y-auto p-1">
            {chars.filter(c => c.code >= 0xFE00 || c.code >= 0x064B && c.code <= 0x0652).map(c => (
              <button
                key={c.code}
                onClick={() => toggleChar(c.code)}
                className={`flex flex-col items-center p-1 rounded border text-center transition-colors ${
                  selectedCodes.has(c.code)
                    ? "border-[hsl(120,50%,40%)] bg-[hsl(120,50%,40%)]/10"
                    : "border-border hover:border-muted-foreground/40 bg-card"
                }`}
              >
                <span className="text-lg leading-tight">{c.code >= 0x064B && c.code <= 0x0652 ? `ـ${c.char}` : c.char}</span>
                <span className="text-[9px] text-muted-foreground font-mono">{c.code.toString(16).toUpperCase()}</span>
              </button>
            ))}
          </div>

          {/* Summary */}
          <div className="flex flex-wrap gap-3 text-xs">
            <span>عربي: <Badge variant="secondary">{arabicCount}</Badge></span>
            <span>تشكيل: <Badge variant="secondary">{tashkeelCount}</Badge></span>
            <span>إنجليزي: <Badge variant="secondary">{englishCount}</Badge></span>
            <span>المجموع: <Badge>{chars.length}</Badge></span>
          </div>

          {/* Generate button */}
          <Button
            onClick={handleGenerate}
            disabled={!hasTextures || chars.length === 0}
            className="w-full bg-[hsl(270,60%,50%)] hover:bg-[hsl(270,60%,45%)] text-white"
          >
            <Paintbrush className="w-4 h-4 ml-2" />
            توليد أطلس عربي كامل ({chars.length} حرف)
          </Button>
        </CardContent>
      </Card>

      {/* Tashkeel section */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">التشكيل</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-2">
            {TASHKEEL.map(t => (
              <div key={t.code} className="flex flex-col items-center p-2 rounded border border-border bg-card text-center">
                <span className="text-xl">ـ{t.char}</span>
                <span className="text-[10px] text-muted-foreground">{t.name}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
