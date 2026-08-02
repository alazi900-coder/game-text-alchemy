import { Link, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileDown, Loader2, ArrowLeft, Package } from "lucide-react";
import heroBg from "@/assets/ygo-hero-bg.jpg";
import { idbGet, idbSet } from "@/lib/idb-storage";
import type { ExtractedEntry } from "@/components/editor/types";
import {
  parseTagForceBinary,
  parseTagForceTxt,
  categorizeTagForce,
  rebuildTagForceBinary,
  type TagForceString,
} from "@/lib/tagforce-parser";

const IDB_STRINGS = "ygoTagForceStrings";
const IDB_FILENAME = "ygoTagForceFileName";

export default function YugiohTagForce() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const originalRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [savedCount, setSavedCount] = useState(0);

  useEffect(() => {
    (async () => {
      const strings = await idbGet<TagForceString[]>(IDB_STRINGS);
      if (strings) setSavedCount(strings.length);
    })();
  }, []);

  const loadIntoEditor = useCallback(
    async (strings: TagForceString[], fileName: string) => {
      if (strings.length === 0) {
        toast({ title: "لم يتم العثور على نصوص", description: "تأكد أن الملف يحتوي على نصوص اللعبة", variant: "destructive" });
        return;
      }

      const entries: ExtractedEntry[] = strings.map((s) => ({
        msbtFile: categorizeTagForce(s),
        index: s.offset,
        label: `0x${s.offset.toString(16).toUpperCase()}`,
        original: s.text,
        maxBytes: s.maxBytes,
      }));

      await idbSet("editorState", {
        entries,
        translations: {},
        protectedEntries: [],
        technicalBypass: [],
      });
      await idbSet("editorGame", "yugioh-tagforce");
      await idbSet(IDB_STRINGS, strings);
      await idbSet(IDB_FILENAME, fileName);
      setSavedCount(strings.length);

      toast({ title: `تم استيراد ${strings.length} نص`, description: "جارٍ فتح المحرر..." });
      navigate("/editor");
    },
    [navigate, toast],
  );

  const handleFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setLoading(true);
      try {
        const isText = /\.(txt|csv|json)$/i.test(file.name);
        const strings = isText ? parseTagForceTxt(await file.text()) : parseTagForceBinary(await file.arrayBuffer());
        await loadIntoEditor(strings, file.name);
      } catch (err) {
        toast({ title: "خطأ في القراءة", description: String(err), variant: "destructive" });
      } finally {
        setLoading(false);
        e.target.value = "";
      }
    },
    [loadIntoEditor, toast],
  );

  /** Re-inject the translations saved in the editor back into the original binary */
  const handleRebuild = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setLoading(true);
      try {
        const strings = await idbGet<TagForceString[]>(IDB_STRINGS);
        const state = await idbGet<{ entries: ExtractedEntry[]; translations: Record<string, string> }>("editorState");
        if (!strings || !state) {
          toast({ title: "لا توجد بيانات", description: "استورد ملف النصوص وترجمه في المحرر أولاً", variant: "destructive" });
          return;
        }

        const byOffset: Record<number, string> = {};
        for (const entry of state.entries) {
          const tr = state.translations?.[`${entry.msbtFile}:${entry.index}`];
          if (tr && tr.trim()) byOffset[entry.index] = tr;
        }

        const { data, written, truncated } = rebuildTagForceBinary(await file.arrayBuffer(), strings, byOffset);
        const url = URL.createObjectURL(new Blob([data], { type: "application/octet-stream" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name.replace(/(\.[^.]+)?$/, "_ar$1");
        a.click();
        URL.revokeObjectURL(url);

        toast({
          title: `تم حقن ${written} نص`,
          description: truncated > 0 ? `${truncated} نص تم اقتطاعه لتجاوز الحد المسموح` : "بدون اقتطاع ✓",
        });
      } catch (err) {
        toast({ title: "خطأ في البناء", description: String(err), variant: "destructive" });
      } finally {
        setLoading(false);
        e.target.value = "";
      }
    },
    [toast],
  );

  return (
    <main className="min-h-screen bg-background" dir="rtl">
      <section className="relative overflow-hidden border-b border-border">
        <img src={heroBg} alt="ساحة نزال Yu-Gi-Oh" width={1536} height={768} className="absolute inset-0 w-full h-full object-cover opacity-30" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/40" />
        <div className="relative container mx-auto px-4 py-12">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6">
            <ArrowLeft className="w-4 h-4 rotate-180" /> رجوع إلى الألعاب
          </Link>
          <Badge variant="secondary" className="mb-3 font-body">PSP · Tag Force Special</Badge>
          <h1 className="text-3xl md:text-4xl font-display font-bold mb-3">Yu-Gi-Oh! ARC-V Tag Force Special</h1>
          <p className="text-muted-foreground font-body max-w-2xl">
            استخراج نصوص اللعبة من الملفات الثنائية، ترجمتها في المحرر الرئيسي، ثم إعادة حقنها في نفس الملف بنفس الأحجام دون كسر المؤشرات.
          </p>
        </div>
      </section>

      <section className="container mx-auto px-4 py-8 grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <Upload className="w-5 h-5 text-primary" /> 1 — استيراد النصوص
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground font-body">
              ارفع ملف النصوص المستخرج من اللعبة (‎.bin‎ أو أي ملف ثنائي) أو ملف ‎.txt‎ بصيغة <code>offset=text</code>.
            </p>
            <input ref={fileRef} type="file" className="hidden" onChange={handleFile} />
            <Button onClick={() => fileRef.current?.click()} disabled={loading} className="w-full font-body">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} اختر ملف النصوص
            </Button>
            {savedCount > 0 && (
              <Button variant="outline" className="w-full font-body" onClick={() => navigate("/editor")}>
                <Package className="w-4 h-4" /> فتح المحرر ({savedCount} نص محفوظ)
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <FileDown className="w-5 h-5 text-accent" /> 2 — إعادة الحقن والبناء
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground font-body">
              بعد الترجمة، ارفع الملف الأصلي نفسه مرة أخرى ليُحقن فيه النص العربي ويُحمّل الملف المعرّب جاهزاً للاستخدام.
            </p>
            <input ref={originalRef} type="file" className="hidden" onChange={handleRebuild} />
            <Button variant="secondary" onClick={() => originalRef.current?.click()} disabled={loading || savedCount === 0} className="w-full font-body">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} بناء الملف المعرّب
            </Button>
            <p className="text-xs text-muted-foreground font-body">
              ملاحظة: ملفات ‎.xdelta‎ مضغوطة ولا يمكن قراءة نصوصها مباشرة — طبّق الباتش على اللعبة أولاً ثم استخرج ملف النصوص منها.
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}