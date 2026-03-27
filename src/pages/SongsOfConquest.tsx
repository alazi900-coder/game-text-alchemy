import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useCallback, useRef, useState } from "react";
import { Upload, FileJson, RotateCcw } from "lucide-react";
import heroBg from "@/assets/soc-hero-bg.jpg";
import { APP_VERSION } from "@/lib/version";
import { idbGet, idbSet } from "@/lib/idb-storage";
import type { ExtractedEntry, EditorState } from "@/components/editor/types";

/* ─── Helpers ─── */
function parseSOCJson(raw: string): { keys: { id: string; original: string }[]; name: string; code: string } {
  const obj = JSON.parse(raw);
  const keys: { id: string; original: string }[] = [];

  // Format: { keys: [{ "key": "value" }, ...] }
  if (Array.isArray(obj.keys)) {
    for (const entry of obj.keys) {
      if (typeof entry === "object" && entry !== null) {
        for (const [k, v] of Object.entries(entry)) {
          keys.push({ id: k, original: String(v) });
        }
      }
    }
  }
  // Flat format: { "key": "value", ... }
  else if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (k === "type" || k === "name" || k === "code" || k === "nativeName") continue;
      if (typeof v === "string") {
        keys.push({ id: k, original: v });
      }
    }
  }

  return { keys, name: obj.name || "English", code: obj.code || "en" };
}

/** Categorize SOC keys by their path prefix */
function categorizeSocKey(id: string): string {
  const lower = id.toLowerCase();
  if (lower.startsWith("mainmenu") || lower.startsWith("main_menu")) return "soc-menu";
  if (lower.startsWith("settings") || lower.startsWith("options")) return "soc-settings";
  if (lower.startsWith("tutorial") || lower.startsWith("help")) return "soc-tutorial";
  if (lower.startsWith("unit") || lower.startsWith("troop")) return "soc-units";
  if (lower.startsWith("spell") || lower.startsWith("magic") || lower.startsWith("skill")) return "soc-skills";
  if (lower.startsWith("building") || lower.startsWith("structure")) return "soc-buildings";
  if (lower.startsWith("map") || lower.startsWith("terrain") || lower.startsWith("world")) return "soc-map";
  if (lower.startsWith("campaign") || lower.startsWith("story") || lower.startsWith("quest")) return "soc-campaign";
  if (lower.startsWith("multiplayer") || lower.startsWith("lobby")) return "soc-multiplayer";
  if (lower.startsWith("item") || lower.startsWith("artifact") || lower.startsWith("resource")) return "soc-items";
  if (lower.startsWith("faction") || lower.startsWith("hero")) return "soc-factions";
  if (lower.includes("/")) {
    const prefix = lower.split("/")[0];
    return `soc-${prefix}`;
  }
  return "soc-misc";
}

/** Convert SOC JSON keys → ExtractedEntry[] for the main editor */
function convertToEditorEntries(keys: { id: string; original: string }[]): ExtractedEntry[] {
  return keys.map((k, i) => ({
    msbtFile: categorizeSocKey(k.id),
    index: i,
    label: k.id,
    original: k.original,
    maxBytes: 0, // JSON has no byte limit
  }));
}

/* ─── Main Component ─── */
export default function SongsOfConquest() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  /* ─── Import & redirect to editor ─── */
  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const raw = await file.text();
      const { keys } = parseSOCJson(raw);
      if (keys.length === 0) {
        toast({ title: "ملف فارغ", description: "لم يتم العثور على مفاتيح نصية", variant: "destructive" });
        return;
      }

      const entries = convertToEditorEntries(keys);
      const editorState: EditorState = {
        entries,
        translations: {},
        protectedEntries: new Set(),
        technicalBypass: new Set(),
      };

      // Save to IDB (same format the main editor expects)
      await idbSet("editorState", {
        entries: editorState.entries,
        translations: editorState.translations,
        protectedEntries: [],
        technicalBypass: [],
      });
      await idbSet("editorGame", "songs-of-conquest");

      toast({ title: `تم استيراد ${keys.length} نص`, description: "جارٍ فتح المحرر..." });

      // Navigate to the main editor
      navigate("/editor");
    } catch (err) {
      toast({ title: "خطأ في القراءة", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  }, [toast, navigate]);

  /* ─── Load saved project ─── */
  const loadSaved = useCallback(async () => {
    const savedGame = await idbGet<string>("editorGame");
    const savedState = await idbGet("editorState");
    if (savedGame === "songs-of-conquest" && savedState) {
      navigate("/editor");
    } else {
      toast({ title: "لا يوجد مشروع محفوظ", description: "قم باستيراد ملف JSON أولاً", variant: "destructive" });
    }
  }, [toast, navigate]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />

      {/* Hero */}
      <div className="relative h-64 md:h-80 overflow-hidden">
        <img src={heroBg} alt="Songs of Conquest" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-6 md:p-10">
          <Link to="/" className="text-xs text-muted-foreground hover:text-primary mb-2 inline-block">← الصفحة الرئيسية</Link>
          <h1 className="text-3xl md:text-5xl font-display font-black text-foreground">Songs of Conquest</h1>
          <p className="text-sm text-muted-foreground mt-1">تعريب عبر ملفات JSON — نظام Modding رسمي</p>
        </div>
      </div>

      {/* Import section */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileJson className="w-5 h-5 text-primary" />
              استيراد ملف اللغة
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              ارفع ملف JSON الخاص باللغة الإنجليزية من اللعبة. سيتم فتح المحرر الكامل بنفس ميزات Fire Emblem Engage.
            </p>
            <div className="grid grid-cols-1 gap-3">
              <Button
                size="lg"
                className="h-14 gap-3"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
              >
                <Upload className="w-5 h-5" />
                {loading ? "جارٍ التحميل..." : "استيراد ملف JSON"}
              </Button>
              <Button variant="outline" size="lg" className="h-14 gap-3" onClick={loadSaved}>
                <RotateCcw className="w-5 h-5" />
                استعادة مشروع محفوظ
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* How-to guide */}
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle className="text-base">كيفية الحصول على ملف اللغة</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div className="flex gap-3">
              <Badge variant="outline" className="shrink-0">1</Badge>
              <p>افتح مجلد اللعبة على جهازك أو السويتش</p>
            </div>
            <div className="flex gap-3">
              <Badge variant="outline" className="shrink-0">2</Badge>
              <p>ابحث عن ملفات اللغة بصيغة <code className="text-xs bg-muted px-1 rounded">.json</code> — عادة في مجلد <code className="text-xs bg-muted px-1 rounded">Languages/</code> أو <code className="text-xs bg-muted px-1 rounded">Mods/</code></p>
            </div>
            <div className="flex gap-3">
              <Badge variant="outline" className="shrink-0">3</Badge>
              <p>ارفع ملف اللغة الإنجليزية هنا — سيتم فتح المحرر الكامل</p>
            </div>
            <div className="flex gap-3">
              <Badge variant="outline" className="shrink-0">4</Badge>
              <p>بعد الترجمة، صدّر ملف <code className="text-xs bg-muted px-1 rounded">Arabic.json</code> من المحرر وضعه في مجلد اللعبة</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <footer className="py-4 text-center text-xs text-muted-foreground border-t border-border">
        الإصدار {APP_VERSION}
      </footer>
    </div>
  );
}
