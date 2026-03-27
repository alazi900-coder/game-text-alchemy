import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useCallback, useRef, useState, useMemo } from "react";
import {
  Upload, Download, FileJson, Search, Languages, ArrowRight, ArrowLeft,
  CheckCircle2, AlertTriangle, Sparkles, Filter, RotateCcw, Copy, Save,
  FileText, ChevronDown, ChevronUp, Trash2
} from "lucide-react";
import heroBg from "@/assets/soc-hero-bg.jpg";
import { APP_VERSION } from "@/lib/version";
import { idbGet, idbSet } from "@/lib/idb-storage";
import { supabase } from "@/integrations/supabase/client";

/* ─── Types ─── */
interface LangKey {
  id: string;        // e.g. "MainMenu/Quit"
  original: string;  // English value
  translated: string;
}

interface SocProject {
  name: string;
  code: string;
  keys: LangKey[];
  importedAt: number;
}

/* ─── Helpers ─── */
function parseSOCJson(raw: string): { keys: LangKey[]; name: string; code: string } {
  const obj = JSON.parse(raw);
  const keys: LangKey[] = [];
  
  // Format: { keys: [{ "key": "value" }, ...] }
  if (Array.isArray(obj.keys)) {
    for (const entry of obj.keys) {
      if (typeof entry === "object" && entry !== null) {
        for (const [k, v] of Object.entries(entry)) {
          keys.push({ id: k, original: String(v), translated: "" });
        }
      }
    }
  }
  // Flat format: { "key": "value", ... }
  else if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (k === "type" || k === "name" || k === "code" || k === "nativeName") continue;
      if (typeof v === "string") {
        keys.push({ id: k, original: v, translated: "" });
      }
    }
  }
  
  return {
    keys,
    name: obj.name || "English",
    code: obj.code || "en",
  };
}

function buildArabicJson(keys: LangKey[]): string {
  const output: Record<string, unknown> = {
    type: "language",
    name: "Arabic",
    code: "ar",
    nativeName: "العربية",
    keys: keys.map(k => ({ [k.id]: k.translated || k.original })),
  };
  return JSON.stringify(output, null, 2);
}

/* ─── Main Component ─── */
export default function SongsOfConquest() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [project, setProject] = useState<SocProject | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "translated" | "untranslated">("all");
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  /* ─── Import ─── */
  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const raw = await file.text();
      const { keys, name, code } = parseSOCJson(raw);
      if (keys.length === 0) {
        toast({ title: "ملف فارغ", description: "لم يتم العثور على مفاتيح نصية", variant: "destructive" });
        return;
      }
      const proj: SocProject = { name, code, keys, importedAt: Date.now() };
      setProject(proj);
      setPage(0);
      await idbSet("socProject", proj);
      toast({ title: `تم استيراد ${keys.length} نص`, description: `من ملف ${file.name}` });
    } catch (err) {
      toast({ title: "خطأ في القراءة", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  }, [toast]);

  /* ─── Load saved project ─── */
  const loadSaved = useCallback(async () => {
    const saved = await idbGet("socProject") as SocProject | undefined;
    if (saved) {
      setProject(saved);
      toast({ title: "تم استعادة المشروع المحفوظ" });
    }
  }, [toast]);

  /* ─── Translation update ─── */
  const updateTranslation = useCallback((idx: number, value: string) => {
    if (!project) return;
    const updated = { ...project, keys: [...project.keys] };
    updated.keys[idx] = { ...updated.keys[idx], translated: value };
    setProject(updated);
  }, [project]);

  /* ─── Save ─── */
  const handleSave = useCallback(async () => {
    if (!project) return;
    await idbSet("socProject", project);
    toast({ title: "تم الحفظ" });
  }, [project, toast]);

  /* ─── Export ─── */
  const handleExport = useCallback(() => {
    if (!project) return;
    const json = buildArabicJson(project.keys);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Arabic.json";
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "تم تصدير Arabic.json" });
  }, [project, toast]);

  /* ─── AI Translate batch ─── */
  const handleAiTranslate = useCallback(async () => {
    if (!project) return;
    const untranslated = project.keys
      .map((k, i) => ({ ...k, _idx: i }))
      .filter(k => !k.translated);
    
    if (untranslated.length === 0) {
      toast({ title: "كل النصوص مترجمة بالفعل!" });
      return;
    }

    setAiLoading(true);
    try {
      const batch = untranslated.slice(0, 30);
      const texts = batch.map(k => k.original);
      
      const { data, error } = await supabase.functions.invoke("translate-entries", {
        body: {
          texts,
          context: "Songs of Conquest - لعبة استراتيجية خيالية من القرون الوسطى",
          gameType: "songs-of-conquest",
        },
      });

      if (error) throw error;
      
      const translations: string[] = data?.translations || [];
      const updated = { ...project, keys: [...project.keys] };
      
      for (let i = 0; i < Math.min(translations.length, batch.length); i++) {
        if (translations[i]) {
          updated.keys[batch[i]._idx] = {
            ...updated.keys[batch[i]._idx],
            translated: translations[i],
          };
        }
      }
      
      setProject(updated);
      await idbSet("socProject", updated);
      toast({ title: `تمت ترجمة ${translations.length} نص بالذكاء الاصطناعي` });
    } catch (err) {
      toast({ title: "خطأ في الترجمة", description: String(err), variant: "destructive" });
    } finally {
      setAiLoading(false);
    }
  }, [project, toast]);

  /* ─── Stats ─── */
  const stats = useMemo(() => {
    if (!project) return { total: 0, translated: 0, pct: 0 };
    const total = project.keys.length;
    const translated = project.keys.filter(k => k.translated).length;
    return { total, translated, pct: total > 0 ? Math.round((translated / total) * 100) : 0 };
  }, [project]);

  /* ─── Filtered keys ─── */
  const filtered = useMemo(() => {
    if (!project) return [];
    let keys = project.keys.map((k, i) => ({ ...k, _idx: i }));
    if (search) {
      const s = search.toLowerCase();
      keys = keys.filter(k =>
        k.id.toLowerCase().includes(s) ||
        k.original.toLowerCase().includes(s) ||
        k.translated.toLowerCase().includes(s)
      );
    }
    if (filterMode === "translated") keys = keys.filter(k => k.translated);
    if (filterMode === "untranslated") keys = keys.filter(k => !k.translated);
    return keys;
  }, [project, search, filterMode]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageKeys = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  /* ─── No project loaded ─── */
  if (!project) {
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
                ارفع ملف JSON الخاص باللغة الإنجليزية من اللعبة. يمكنك العثور عليه في مجلد اللعبة أو استخراجه من ملفات الموديفيكات.
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
                <p>ارفع ملف اللغة الإنجليزية هنا — سنقوم بترجمته للعربية</p>
              </div>
              <div className="flex gap-3">
                <Badge variant="outline" className="shrink-0">4</Badge>
                <p>بعد الترجمة، صدّر ملف <code className="text-xs bg-muted px-1 rounded">Arabic.json</code> وضعه في مجلد اللعبة</p>
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

  /* ─── Editor view ─── */
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />

      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center gap-3 flex-wrap">
          <Link to="/" className="text-xs text-muted-foreground hover:text-primary">← الرئيسية</Link>
          <h1 className="font-display font-bold text-foreground text-sm md:text-base">Songs of Conquest</h1>
          <div className="flex-1" />
          <Badge variant="outline" className="text-xs">
            {stats.translated}/{stats.total} ({stats.pct}%)
          </Badge>
          <Button size="sm" variant="ghost" onClick={handleSave}>
            <Save className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => fileInputRef.current?.click()}>
            <Upload className="w-4 h-4" />
          </Button>
          <Button size="sm" onClick={handleExport}>
            <Download className="w-4 h-4 ml-1" />
            تصدير
          </Button>
        </div>
      </header>

      {/* Stats bar */}
      <div className="px-4 py-3 border-b border-border bg-muted/30">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-4 mb-2">
            <span className="text-xs text-muted-foreground">التقدم</span>
            <Progress value={stats.pct} className="flex-1 h-2" />
            <span className="text-xs font-bold text-primary">{stats.pct}%</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant={aiLoading ? "secondary" : "default"}
              className="gap-2"
              onClick={handleAiTranslate}
              disabled={aiLoading}
            >
              <Sparkles className="w-4 h-4" />
              {aiLoading ? "جارٍ الترجمة..." : "ترجمة تلقائية (30 نص)"}
            </Button>
            <div className="flex-1" />
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant={filterMode === "all" ? "secondary" : "ghost"}
                onClick={() => { setFilterMode("all"); setPage(0); }}
                className="text-xs h-7 px-2"
              >الكل</Button>
              <Button
                size="sm"
                variant={filterMode === "untranslated" ? "secondary" : "ghost"}
                onClick={() => { setFilterMode("untranslated"); setPage(0); }}
                className="text-xs h-7 px-2"
              >غير مترجم</Button>
              <Button
                size="sm"
                variant={filterMode === "translated" ? "secondary" : "ghost"}
                onClick={() => { setFilterMode("translated"); setPage(0); }}
                className="text-xs h-7 px-2"
              >مترجم</Button>
            </div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="px-4 py-2 border-b border-border">
        <div className="max-w-5xl mx-auto">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="بحث بالمفتاح أو النص..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
              className="pr-10 text-sm"
              dir="auto"
            />
          </div>
        </div>
      </div>

      {/* Entries list */}
      <div className="flex-1 overflow-auto px-4 py-4">
        <div className="max-w-5xl mx-auto space-y-2">
          {pageKeys.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">لا توجد نتائج</div>
          )}
          {pageKeys.map((key) => (
            <Card
              key={key._idx}
              className={`transition-all ${key.translated ? "border-primary/20 bg-primary/5" : "border-border"}`}
            >
              <CardContent className="p-3 space-y-2">
                {/* Key ID */}
                <div className="flex items-center gap-2">
                  <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground font-mono truncate max-w-[70%]">
                    {key.id}
                  </code>
                  {key.translated && <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />}
                </div>
                
                {/* Original */}
                <div className="text-sm text-foreground bg-muted/50 rounded p-2" dir="auto">
                  {key.original}
                </div>
                
                {/* Translation input */}
                {editingIdx === key._idx ? (
                  <div className="space-y-2">
                    <Textarea
                      value={key.translated}
                      onChange={e => updateTranslation(key._idx, e.target.value)}
                      placeholder="اكتب الترجمة العربية..."
                      className="text-sm min-h-[60px]"
                      dir="rtl"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setEditingIdx(null)}>
                        إغلاق
                      </Button>
                      {key.translated && (
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => updateTranslation(key._idx, "")}>
                          <Trash2 className="w-3 h-3 ml-1" />
                          مسح
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <button
                    className="w-full text-right text-sm rounded p-2 border border-dashed border-border hover:border-primary/50 hover:bg-primary/5 transition-colors min-h-[36px]"
                    dir="rtl"
                    onClick={() => setEditingIdx(key._idx)}
                  >
                    {key.translated || (
                      <span className="text-muted-foreground text-xs">انقر للترجمة...</span>
                    )}
                  </button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="sticky bottom-0 border-t border-border bg-background/95 backdrop-blur px-4 py-2">
          <div className="max-w-5xl mx-auto flex items-center justify-center gap-3">
            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              <ArrowRight className="w-4 h-4" />
            </Button>
            <span className="text-xs text-muted-foreground">
              {page + 1} / {totalPages} ({filtered.length} نص)
            </span>
            <Button size="sm" variant="ghost" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
