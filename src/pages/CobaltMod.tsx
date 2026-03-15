import React, { useState, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Upload, FileText, ChevronLeft, Package, FolderArchive,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { idbSet } from "@/lib/idb-storage";
import type { ExtractedEntry, EditorState } from "@/components/editor/types";
import JSZip from "jszip";

interface CobaltParsedEntry {
  label: string;
  text: string;
}

/** Parse a Cobalt .txt file: [LABEL] followed by text lines */
function parseCobaltTxt(content: string): CobaltParsedEntry[] {
  // Strip BOM
  const clean = content.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/);
  const entries: CobaltParsedEntry[] = [];
  let currentLabel: string | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (currentLabel !== null) {
      while (currentLines.length > 0 && currentLines[currentLines.length - 1].trim() === '') {
        currentLines.pop();
      }
      entries.push({ label: currentLabel, text: currentLines.join("\n") });
    }
  };

  for (const line of lines) {
    const labelMatch = line.match(/^\[([^\]]+)\]\s*$/);
    if (labelMatch) {
      flush();
      currentLabel = labelMatch[1].trim();
      currentLines = [];
    } else if (currentLabel !== null) {
      currentLines.push(line);
    }
  }
  flush();
  return entries;
}

/** Convert Cobalt parsed entries to ExtractedEntry[] for the main editor */
function cobaltToEditorEntries(
  files: { name: string; entries: CobaltParsedEntry[] }[]
): { entries: ExtractedEntry[]; translations: Record<string, string> } {
  const editorEntries: ExtractedEntry[] = [];
  const translations: Record<string, string> = {};

  for (const file of files) {
    for (let i = 0; i < file.entries.length; i++) {
      const entry = file.entries[i];
      const msbtFile = `cobalt:${file.name}:${entry.label}`;
      const editorEntry: ExtractedEntry = {
        msbtFile,
        index: i,
        label: `${file.name} → ${entry.label}`,
        original: entry.text || "(فارغ)",
        maxBytes: 0, // no limit for Cobalt
      };
      editorEntries.push(editorEntry);
      // If the text has Arabic content, pre-fill as translation
      const arabicRegex = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
      if (arabicRegex.test(entry.text)) {
        translations[`${msbtFile}:${i}`] = entry.text;
      }
    }
  }

  return { entries: editorEntries, translations };
}

export default function CobaltMod() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");

  const loadIntoEditor = useCallback(async (files: { name: string; entries: CobaltParsedEntry[] }[]) => {
    if (files.length === 0) {
      toast({
        title: "لم يتم العثور على مدخلات",
        description: "تأكد أن الملف يحتوي على وسوم [LABEL] بالصيغة الصحيحة",
        variant: "destructive",
      });
      return;
    }

    const totalEntries = files.reduce((s, f) => s + f.entries.length, 0);
    setLoadingMsg(`جارٍ تحميل ${totalEntries} مدخل إلى المحرر...`);

    const { entries, translations } = cobaltToEditorEntries(files);

    const editorState: EditorState = {
      entries,
      translations,
      protectedEntries: new Set<string>(),
      technicalBypass: new Set<string>(),
    };

    // Save to IndexedDB so the main editor picks it up
    await idbSet("editorState", {
      entries: editorState.entries,
      translations: editorState.translations,
      protectedEntries: [],
      technicalBypass: [],
    });

    // Store game type hint
    await idbSet("editorGameType", "cobalt");

    toast({
      title: `تم تحميل ${files.length} ملف (${totalEntries} مدخل)`,
      description: "جارٍ فتح المحرر...",
    });

    // Navigate to the main editor
    navigate("/editor");
  }, [toast, navigate]);

  const handleImportTxt = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputFiles = e.target.files;
    if (!inputFiles || inputFiles.length === 0) return;
    setLoading(true);
    setLoadingMsg("جارٍ قراءة الملفات...");

    try {
      const parsed: { name: string; entries: CobaltParsedEntry[] }[] = [];

      for (const file of Array.from(inputFiles)) {
        const content = await file.text();
        const name = file.name.replace(/\.txt$/i, "");
        const entries = parseCobaltTxt(content);
        if (entries.length > 0) {
          parsed.push({ name, entries });
        } else {
          console.warn(`No [LABEL] entries in ${file.name}. Preview:`, content.slice(0, 300));
        }
      }

      await loadIntoEditor(parsed);
    } catch (err) {
      toast({ title: "خطأ في القراءة", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
      setLoadingMsg("");
      e.target.value = "";
    }
  }, [loadIntoEditor, toast]);

  const handleImportZip = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setLoadingMsg("جارٍ فك الأرشيف...");

    try {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const parsed: { name: string; entries: CobaltParsedEntry[] }[] = [];
      const promises: Promise<void>[] = [];

      zip.forEach((path, entry) => {
        if (entry.dir || !path.endsWith(".txt")) return;
        promises.push(
          entry.async("string").then(content => {
            const name = path.split("/").pop()!.replace(/\.txt$/i, "");
            const entries = parseCobaltTxt(content);
            if (entries.length > 0) parsed.push({ name, entries });
          })
        );
      });

      await Promise.all(promises);
      await loadIntoEditor(parsed);
    } catch (err) {
      toast({ title: "خطأ في قراءة الأرشيف", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
      setLoadingMsg("");
      e.target.value = "";
    }
  }, [loadIntoEditor, toast]);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6" dir="rtl">
      <input ref={fileInputRef} type="file" accept=".txt" multiple className="hidden" onChange={handleImportTxt} />
      <input ref={zipInputRef} type="file" accept=".zip" className="hidden" onChange={handleImportZip} />

      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <Package className="w-6 h-6 text-primary" />
          <h1 className="font-display font-bold text-foreground text-xl">محرر Cobalt — MSBT</h1>
        </div>

        <p className="text-muted-foreground text-sm">
          استورد ملفات TXT بصيغة Cobalt (تحتوي وسوم [LABEL]) وسيتم فتحها في المحرر الرئيسي بكل الميزات — الترجمة، فحص الجودة، البناء، والتصدير.
        </p>

        {loading ? (
          <Card className="border-primary/30">
            <CardContent className="p-6 flex flex-col items-center gap-4">
              <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
              <p className="text-sm text-muted-foreground">{loadingMsg}</p>
              <Progress value={50} className="h-1.5" />
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Import buttons */}
            <div className="grid grid-cols-1 gap-3">
              <Button
                size="lg"
                className="h-20 text-base gap-3"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileText className="w-6 h-6" />
                <div className="text-right">
                  <div className="font-bold">استيراد ملفات TXT</div>
                  <div className="text-xs opacity-80">ملف واحد أو عدة ملفات .txt</div>
                </div>
              </Button>

              <Button
                size="lg"
                variant="outline"
                className="h-20 text-base gap-3"
                onClick={() => zipInputRef.current?.click()}
              >
                <FolderArchive className="w-6 h-6" />
                <div className="text-right">
                  <div className="font-bold">استيراد أرشيف ZIP</div>
                  <div className="text-xs opacity-80">مجلد يحتوي ملفات .txt</div>
                </div>
              </Button>
            </div>

            {/* Format guide */}
            <Card className="border-border/50">
              <CardContent className="p-4 space-y-3">
                <p className="font-display font-semibold text-sm text-foreground">صيغة ملف TXT المدعومة:</p>
                <pre className="bg-muted/30 rounded-lg p-3 text-left font-mono text-[11px] leading-relaxed overflow-x-auto" dir="ltr">
{`[MID_Tutorial_Begin]
مرحباً بك في عالم إمبلم!

[MID_Tutorial_Move]
حرّك الشخصية باستخدام عصا التحكم.

[MID_SomeLabel]
نص الترجمة هنا...`}
                </pre>

                <div className="text-xs text-muted-foreground space-y-1">
                  <p>• كل وسم <code className="text-primary">[LABEL]</code> يمثل مدخلاً في ملف MSBT</p>
                  <p>• يدعم وسوم التحكم مثل <code className="text-primary">[MSBT:Color]</code> و <code className="text-primary">[MSBT:PageBreak]</code></p>
                  <p>• بعد الاستيراد ستفتح الملفات في المحرر الرئيسي بجميع أدوات الترجمة</p>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
