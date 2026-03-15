import { Link, useNavigate } from "react-router-dom";
import { Sparkles, Package, FileText, Upload, FolderArchive } from "lucide-react";
import { APP_VERSION } from "@/lib/version";
import { Button } from "@/components/ui/button";
import { useRef, useState, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { idbSet } from "@/lib/idb-storage";
import type { ExtractedEntry, EditorState } from "@/components/editor/types";
import JSZip from "jszip";
import heroBgAcnh from "@/assets/acnh-hero-bg.jpg";
import heroBgFe from "@/assets/fe-hero-bg.jpg";

interface CobaltParsedEntry { label: string; text: string; lineIndex: number; lineCount: number; }
interface CobaltParsedFile { name: string; entries: CobaltParsedEntry[]; rawLines: string[]; hasLabels: boolean; }

function parseCobaltTxt(content: string): { entries: CobaltParsedEntry[]; rawLines: string[]; hasLabels: boolean } {
  const clean = content.replace(/^\uFEFF/, '');
  const rawLines = clean.split(/\r?\n/);
  const entries: CobaltParsedEntry[] = [];
  const hasLabels = rawLines.some(l => /^\[([^\]]+)\]\s*$/.test(l));

  if (hasLabels) {
    let currentLabel: string | null = null;
    let textStartLine = -1;
    let currentLines: string[] = [];

    const flush = () => {
      if (currentLabel !== null && textStartLine >= 0) {
        // Keep trailing empty lines as part of the entry to preserve structure
        entries.push({ label: currentLabel, text: currentLines.join("\n"), lineIndex: textStartLine, lineCount: currentLines.length });
      }
    };

    for (let i = 0; i < rawLines.length; i++) {
      const m = rawLines[i].match(/^\[([^\]]+)\]\s*$/);
      if (m) {
        flush();
        currentLabel = m[1].trim();
        textStartLine = i + 1;
        currentLines = [];
      } else if (currentLabel !== null) {
        currentLines.push(rawLines[i]);
      }
    }
    flush();
  } else {
    // Each non-empty line is an entry; track its exact position
    let idx = 0;
    for (let i = 0; i < rawLines.length; i++) {
      if (rawLines[i].trim()) {
        idx++;
        entries.push({ label: `Line_${idx}`, text: rawLines[i], lineIndex: i, lineCount: 1 });
      }
    }
  }

  return { entries, rawLines, hasLabels };
}

function cobaltToEditorEntries(files: CobaltParsedFile[]) {
  const editorEntries: ExtractedEntry[] = [];
  const translations: Record<string, string> = {};
  for (const file of files) {
    for (let i = 0; i < file.entries.length; i++) {
      const entry = file.entries[i];
      const msbtFile = `cobalt:${file.name}:${entry.label}`;
      editorEntries.push({ msbtFile, index: i, label: `${file.name} → ${entry.label}`, original: entry.text || "(فارغ)", maxBytes: 0 });
      if (/[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(entry.text)) {
        translations[`${msbtFile}:${i}`] = entry.text;
      }
    }
  }
  return { entries: editorEntries, translations };
}

const games = [
  {
    id: "animal-crossing",
    title: "Animal Crossing: New Horizons",
    titleAr: "أنيمال كروسينج: نيو هورايزنز",
    desc: "ملفات MSBT — حوارات، عناصر، أسماء القرويين",
    image: heroBgAcnh,
    href: "/animal-crossing",
    accent: "from-[hsl(140,70%,50%)] to-[hsl(160,80%,55%)]",
    border: "border-[hsl(140,60%,40%)]/30",
    bg: "bg-[hsl(140,60%,40%)]/10",
  },
  {
    id: "fire-emblem",
    title: "Fire Emblem Engage",
    titleAr: "فاير إمبلم إنغيج",
    desc: "ملفات MSBT — حوارات، أسماء الشخصيات، المهام",
    image: heroBgFe,
    href: "/fire-emblem",
    accent: "from-[hsl(0,80%,60%)] to-[hsl(220,80%,60%)]",
    border: "border-[hsl(0,60%,50%)]/30",
    bg: "bg-[hsl(0,60%,50%)]/10",
  },
];

export default function GameHub() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  const loadIntoEditor = useCallback(async (files: { name: string; entries: CobaltParsedEntry[] }[]) => {
    if (files.length === 0) {
      toast({ title: "لم يتم العثور على مدخلات", description: "الملف فارغ أو لا يحتوي على نصوص", variant: "destructive" });
      return;
    }
    const { entries, translations } = cobaltToEditorEntries(files);
    await idbSet("editorState", { entries, translations, protectedEntries: [], technicalBypass: [] });
    await idbSet("editorGameType", "cobalt");
    toast({ title: `تم تحميل ${files.length} ملف (${entries.length} مدخل)`, description: "جارٍ فتح المحرر..." });
    navigate("/editor");
  }, [toast, navigate]);

  const handleImportTxt = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputFiles = e.target.files;
    if (!inputFiles || inputFiles.length === 0) return;
    setLoading(true);
    try {
      const parsed: { name: string; entries: CobaltParsedEntry[] }[] = [];
      for (const file of Array.from(inputFiles)) {
        const content = await file.text();
        const name = file.name.replace(/\.txt$/i, "");
        const entries = parseCobaltTxt(content);
        if (entries.length > 0) parsed.push({ name, entries });
        else toast({ title: `ملف فارغ: ${file.name}`, variant: "destructive" });
      }
      await loadIntoEditor(parsed);
    } catch (err) {
      toast({ title: "خطأ في القراءة", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  }, [loadIntoEditor, toast]);

  const handleImportZip = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const parsed: { name: string; entries: CobaltParsedEntry[] }[] = [];
      const promises: Promise<void>[] = [];
      zip.forEach((path, entry) => {
        if (entry.dir || !path.endsWith(".txt")) return;
        promises.push(entry.async("string").then(content => {
          const name = path.split("/").pop()!.replace(/\.txt$/i, "");
          const entries = parseCobaltTxt(content);
          if (entries.length > 0) parsed.push({ name, entries });
        }));
      });
      await Promise.all(promises);
      await loadIntoEditor(parsed);
    } catch (err) {
      toast({ title: "خطأ في قراءة الأرشيف", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  }, [loadIntoEditor, toast]);

  return (
    <div className="min-h-screen flex flex-col">
      <input ref={fileInputRef} type="file" accept=".txt" multiple className="hidden" onChange={handleImportTxt} />
      <input ref={zipInputRef} type="file" accept=".zip" className="hidden" onChange={handleImportZip} />

      <header className="py-16 px-4 text-center">
        <div className="max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 mb-6 px-4 py-2 rounded-full bg-primary/10 border border-primary/30">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm text-primary font-display font-semibold">أداة تعريب ألعاب نينتندو سويتش</span>
          </div>
          <h1 className="text-4xl md:text-6xl font-display font-black mb-6 leading-tight">
            عرّب{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-l from-primary to-secondary">
              ألعابك المفضلة
            </span>
          </h1>
          <p className="text-lg text-muted-foreground font-body max-w-lg mx-auto">
            ارفع ملفات TXT أو حزم اللعبة — ترجم واحصل على نسخة معرّبة بالكامل
          </p>
        </div>
      </header>

      {/* ===== Main TXT Editor Section ===== */}
      <section className="px-4 pb-8">
        <div className="max-w-4xl mx-auto">
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-6 md:p-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/15 text-primary">
                <FileText className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-display font-black text-foreground">محرر النصوص الرئيسي</h2>
                <p className="text-sm text-muted-foreground">ارفع ملفات TXT للترجمة — يدعم وسوم [LABEL] والنصوص العادية</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Button
                size="lg"
                className="h-16 text-base gap-3"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
              >
                <Upload className="w-5 h-5" />
                <div className="text-right">
                  <div className="font-bold">{loading ? "جارٍ التحميل..." : "استيراد ملفات TXT"}</div>
                  <div className="text-xs opacity-80">ملف واحد أو عدة ملفات</div>
                </div>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-16 text-base gap-3"
                onClick={() => zipInputRef.current?.click()}
                disabled={loading}
              >
                <FolderArchive className="w-5 h-5" />
                <div className="text-right">
                  <div className="font-bold">استيراد أرشيف ZIP</div>
                  <div className="text-xs opacity-80">مجلد يحتوي ملفات .txt</div>
                </div>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              بعد الاستيراد يفتح المحرر الكامل بأدوات الترجمة والمراجعة • البناء يدعم تصدير TXT معربة أو MSBT ثنائية
            </p>
          </div>
        </div>
      </section>

      {/* ===== Game-specific workflows ===== */}
      <section className="flex-1 px-4 pb-12">
        <div className="max-w-4xl mx-auto">
          <h3 className="text-sm font-display font-bold text-muted-foreground mb-4 px-1">مسارات تعريب خاصة باللعبة</h3>
          <div className="grid md:grid-cols-2 gap-6">
            {games.map((game) => (
              <Link
                key={game.id}
                to={game.href}
                className={`group relative rounded-2xl border ${game.border} overflow-hidden transition-all hover:scale-[1.02] hover:shadow-2xl`}
              >
                <div className="relative h-48 overflow-hidden">
                  <img src={game.image} alt={game.title} className="w-full h-full object-cover transition-transform group-hover:scale-110" loading="lazy" />
                  <div className="absolute inset-0 bg-gradient-to-t from-card via-card/60 to-transparent" />
                </div>
                <div className="relative p-6 -mt-8">
                  <h2 className={`text-xl font-display font-black mb-1 text-transparent bg-clip-text bg-gradient-to-l ${game.accent}`}>{game.title}</h2>
                  <p className="text-sm font-display font-bold text-foreground mb-2">{game.titleAr}</p>
                  <p className="text-xs text-muted-foreground font-body">{game.desc}</p>
                  <div className={`mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg ${game.bg} text-sm font-display font-semibold`}>ابدأ التعريب →</div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Bundle Extractor link */}
        <div className="max-w-4xl mx-auto mt-6">
          <Link
            to="/bundle-extractor"
            className="group flex items-center gap-4 rounded-2xl border border-border/50 p-5 transition-all hover:scale-[1.01] hover:shadow-xl hover:border-primary/30 bg-card/50"
          >
            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 text-primary">
              <Package className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-display font-bold text-foreground">أداة فك حزم Unity Asset Bundle</h3>
              <p className="text-xs text-muted-foreground font-body">استخراج واستبدال ملفات MSBT داخل حزم .bundle و .bytes.bundle</p>
            </div>
            <span className="mr-auto text-muted-foreground group-hover:text-primary transition-colors">←</span>
          </Link>
        </div>
      </section>

      <footer className="mt-auto py-6 text-center text-sm text-muted-foreground border-t border-border">
        <div>أداة تعريب ألعاب نينتندو سويتش — مشروع مفتوح المصدر 🇸🇦</div>
        <div className="mt-1 text-xs opacity-60">الإصدار {APP_VERSION}</div>
      </footer>
    </div>
  );
}
