import React, { useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Upload, Download, FileText, Trash2, Plus, Search,
  ChevronLeft, Package, Eye, EyeOff, Filter,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { buildMsbtFromEntries, type CobaltEntry } from "@/lib/msbt-parser";
import JSZip from "jszip";

interface CobaltFile {
  name: string; // e.g. "accessories" (without .txt)
  entries: CobaltEntry[];
}

/** Parse a Cobalt .txt file: [LABEL] followed by text lines */
function parseCobaltTxt(content: string, fileName: string): CobaltEntry[] {
  const lines = content.split(/\r?\n/);
  const entries: CobaltEntry[] = [];
  let currentLabel: string | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (currentLabel !== null) {
      entries.push({ label: currentLabel, text: currentLines.join("\n") });
    }
  };

  for (const line of lines) {
    const labelMatch = line.match(/^\[([^\]]+)\]\s*$/);
    if (labelMatch) {
      flush();
      currentLabel = labelMatch[1];
      currentLines = [];
    } else if (currentLabel !== null) {
      currentLines.push(line);
    }
  }
  flush();
  return entries;
}

export default function CobaltMod() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<CobaltFile[]>([]);
  const [selectedFileIdx, setSelectedFileIdx] = useState<number>(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [showOriginal, setShowOriginal] = useState(true);
  const [filterEmpty, setFilterEmpty] = useState(false);
  const [building, setBuilding] = useState(false);

  const handleImportTxt = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const inputFiles = e.target.files;
    if (!inputFiles) return;

    const newFiles: CobaltFile[] = [];
    let loaded = 0;

    Array.from(inputFiles).forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        const name = file.name.replace(/\.txt$/i, "");
        const entries = parseCobaltTxt(content, name);
        if (entries.length > 0) {
          newFiles.push({ name, entries });
        }
        loaded++;
        if (loaded === inputFiles.length) {
          setFiles(prev => {
            const merged = [...prev];
            for (const nf of newFiles) {
              const existingIdx = merged.findIndex(f => f.name === nf.name);
              if (existingIdx >= 0) {
                // Merge: update existing entries, add new ones
                const existing = merged[existingIdx];
                for (const entry of nf.entries) {
                  const idx = existing.entries.findIndex(e => e.label === entry.label);
                  if (idx >= 0) {
                    existing.entries[idx].text = entry.text;
                  } else {
                    existing.entries.push(entry);
                  }
                }
              } else {
                merged.push(nf);
              }
            }
            return merged;
          });
          toast({
            title: `تم استيراد ${newFiles.length} ملف`,
            description: `${newFiles.reduce((s, f) => s + f.entries.length, 0)} مدخل`,
          });
        }
      };
      reader.readAsText(file);
    });
    e.target.value = "";
  }, [toast]);

  const handleImportZip = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const newFiles: CobaltFile[] = [];
      const promises: Promise<void>[] = [];

      zip.forEach((path, entry) => {
        if (entry.dir || !path.endsWith(".txt")) return;
        promises.push(
          entry.async("string").then(content => {
            const name = path.split("/").pop()!.replace(/\.txt$/i, "");
            const entries = parseCobaltTxt(content, name);
            if (entries.length > 0) newFiles.push({ name, entries });
          })
        );
      });

      await Promise.all(promises);
      setFiles(prev => {
        const merged = [...prev];
        for (const nf of newFiles) {
          const existingIdx = merged.findIndex(f => f.name === nf.name);
          if (existingIdx >= 0) {
            for (const entry of nf.entries) {
              const idx = merged[existingIdx].entries.findIndex(e => e.label === entry.label);
              if (idx >= 0) merged[existingIdx].entries[idx].text = entry.text;
              else merged[existingIdx].entries.push(entry);
            }
          } else {
            merged.push(nf);
          }
        }
        return merged;
      });
      toast({
        title: `تم استيراد ${newFiles.length} ملف من الأرشيف`,
        description: `${newFiles.reduce((s, f) => s + f.entries.length, 0)} مدخل`,
      });
    } catch {
      toast({ title: "خطأ في قراءة الأرشيف", variant: "destructive" });
    }
    e.target.value = "";
  }, [toast]);

  const zipInputRef = useRef<HTMLInputElement>(null);

  const handleAddEntry = useCallback(() => {
    if (files.length === 0) return;
    setFiles(prev => {
      const updated = [...prev];
      updated[selectedFileIdx] = {
        ...updated[selectedFileIdx],
        entries: [...updated[selectedFileIdx].entries, { label: `NEW_LABEL_${Date.now()}`, text: "" }],
      };
      return updated;
    });
  }, [files.length, selectedFileIdx]);

  const handleAddFile = useCallback(() => {
    const name = prompt("اسم الملف (بدون .txt):");
    if (!name?.trim()) return;
    setFiles(prev => [...prev, { name: name.trim(), entries: [] }]);
    setSelectedFileIdx(files.length);
  }, [files.length]);

  const handleDeleteFile = useCallback((idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
    if (selectedFileIdx >= files.length - 1) setSelectedFileIdx(Math.max(0, files.length - 2));
  }, [selectedFileIdx, files.length]);

  const updateEntry = useCallback((entryIdx: number, field: "label" | "text", value: string) => {
    setFiles(prev => {
      const updated = [...prev];
      const file = { ...updated[selectedFileIdx] };
      const entries = [...file.entries];
      entries[entryIdx] = { ...entries[entryIdx], [field]: value };
      file.entries = entries;
      updated[selectedFileIdx] = file;
      return updated;
    });
  }, [selectedFileIdx]);

  const deleteEntry = useCallback((entryIdx: number) => {
    setFiles(prev => {
      const updated = [...prev];
      const file = { ...updated[selectedFileIdx] };
      file.entries = file.entries.filter((_, i) => i !== entryIdx);
      updated[selectedFileIdx] = file;
      return updated;
    });
  }, [selectedFileIdx]);

  const handleBuildMsbt = useCallback(async () => {
    if (files.length === 0) return;
    setBuilding(true);
    try {
      const zip = new JSZip();
      const msgFolder = zip.folder("romfs/Data/StreamingAssets/aa/Switch/fe_assets_message");

      for (const file of files) {
        if (file.entries.length === 0) continue;
        const msbtBytes = buildMsbtFromEntries(file.entries);
        // Each file goes in its own subfolder matching the bundle name
        msgFolder!.file(`${file.name}/${file.name}.msbt`, msbtBytes);
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "cobalt-msbt-mod.zip";
      a.click();
      URL.revokeObjectURL(url);

      toast({ title: "تم بناء الملفات بنجاح!", description: `${files.length} ملف MSBT` });
    } catch (err) {
      toast({ title: "خطأ في البناء", description: String(err), variant: "destructive" });
    } finally {
      setBuilding(false);
    }
  }, [files, toast]);

  const handleExportTxt = useCallback(async () => {
    if (files.length === 0) return;
    const zip = new JSZip();
    for (const file of files) {
      let content = "";
      for (const entry of file.entries) {
        content += `[${entry.label}]\n${entry.text}\n\n`;
      }
      zip.file(`${file.name}.txt`, content);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cobalt-txt-export.zip";
    a.click();
    URL.revokeObjectURL(url);
  }, [files]);

  const currentFile = files[selectedFileIdx];
  const filteredEntries = currentFile?.entries.filter(e => {
    if (searchTerm && !e.label.toLowerCase().includes(searchTerm.toLowerCase()) && !e.text.includes(searchTerm)) return false;
    if (filterEmpty && e.text.trim()) return false;
    return true;
  }) ?? [];

  const totalEntries = files.reduce((s, f) => s + f.entries.length, 0);
  const filledEntries = files.reduce((s, f) => s + f.entries.filter(e => e.text.trim()).length, 0);
  const progress = totalEntries > 0 ? (filledEntries / totalEntries) * 100 : 0;

  return (
    <div className="min-h-screen bg-background flex flex-col" dir="rtl">
      {/* Header */}
      <header className="border-b border-border px-4 py-3 flex items-center gap-3">
        <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <Package className="w-5 h-5 text-primary" />
        <h1 className="font-display font-bold text-foreground text-lg">
          محرر Cobalt — ملفات MSBT
        </h1>
        <div className="mr-auto flex items-center gap-2">
          {totalEntries > 0 && (
            <span className="text-xs text-muted-foreground">
              {filledEntries}/{totalEntries} مدخل
            </span>
          )}
        </div>
      </header>

      {/* Toolbar */}
      <div className="border-b border-border px-4 py-2 flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt"
          multiple
          className="hidden"
          onChange={handleImportTxt}
        />
        <input
          ref={zipInputRef}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={handleImportZip}
        />
        <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
          <Upload className="w-4 h-4" />
          استيراد TXT
        </Button>
        <Button size="sm" variant="outline" onClick={() => zipInputRef.current?.click()}>
          <Upload className="w-4 h-4" />
          استيراد ZIP
        </Button>
        <Button size="sm" variant="outline" onClick={handleAddFile}>
          <Plus className="w-4 h-4" />
          ملف جديد
        </Button>
        <div className="mr-auto" />
        <Button size="sm" variant="outline" onClick={handleExportTxt} disabled={files.length === 0}>
          <FileText className="w-4 h-4" />
          تصدير TXT
        </Button>
        <Button size="sm" onClick={handleBuildMsbt} disabled={files.length === 0 || building}>
          <Download className="w-4 h-4" />
          {building ? "جارٍ البناء..." : "بناء MSBT"}
        </Button>
      </div>

      {files.length === 0 ? (
        /* Empty state */
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Package className="w-10 h-10 text-primary" />
          </div>
          <h2 className="text-xl font-display font-bold text-foreground">محرر Cobalt لملفات MSBT</h2>
          <p className="text-muted-foreground max-w-md text-sm">
            استورد ملفات TXT بصيغة Cobalt (تحتوي وسوم [LABEL])، عدّل الترجمات، ثم ابنِ ملفات MSBT جاهزة للاستخدام مع Cobalt في Fire Emblem Engage.
          </p>
          <div className="flex gap-3">
            <Button onClick={() => fileInputRef.current?.click()}>
              <Upload className="w-4 h-4" />
              استيراد ملفات TXT
            </Button>
            <Button variant="outline" onClick={() => zipInputRef.current?.click()}>
              <Upload className="w-4 h-4" />
              استيراد أرشيف ZIP
            </Button>
          </div>
          <div className="mt-6 text-xs text-muted-foreground border border-border rounded-lg p-4 max-w-lg text-right">
            <p className="font-display font-semibold mb-2">صيغة ملف TXT المدعومة:</p>
            <pre className="bg-muted/30 rounded p-3 text-left font-mono text-[11px] leading-relaxed" dir="ltr">
{`[MID_Tutorial_Begin]
مرحباً بك في عالم إمبلم!

[MID_Tutorial_Move]
حرّك الشخصية باستخدام عصا التحكم.

[MID_SomeLabel]
نص الترجمة هنا...`}
            </pre>
            <p className="mt-3">
              المسار في Cobalt:{" "}
              <code className="text-primary text-[10px]" dir="ltr">
                romfs/Data/StreamingAssets/aa/Switch/fe_assets_message/
              </code>
            </p>
          </div>
        </div>
      ) : (
        /* Main editor */
        <div className="flex-1 flex overflow-hidden">
          {/* File sidebar */}
          <aside className="w-56 border-l border-border bg-card/50 overflow-y-auto shrink-0">
            <div className="p-2 border-b border-border">
              <p className="text-xs text-muted-foreground font-display px-2 py-1">
                الملفات ({files.length})
              </p>
            </div>
            {files.map((file, idx) => (
              <div
                key={file.name}
                className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-sm transition-colors ${
                  idx === selectedFileIdx
                    ? "bg-primary/10 text-primary border-r-2 border-primary"
                    : "hover:bg-muted/50 text-foreground"
                }`}
                onClick={() => setSelectedFileIdx(idx)}
              >
                <FileText className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate flex-1 font-display text-xs">{file.name}.txt</span>
                <span className="text-[10px] text-muted-foreground">{file.entries.length}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteFile(idx); }}
                  className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </aside>

          {/* Entries editor */}
          <main className="flex-1 flex flex-col overflow-hidden">
            {/* Search bar */}
            <div className="border-b border-border px-4 py-2 flex items-center gap-2">
              <Search className="w-4 h-4 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="بحث في الـ Labels أو النصوص..."
                className="h-8 text-sm flex-1"
              />
              <Button
                size="sm"
                variant={filterEmpty ? "default" : "ghost"}
                onClick={() => setFilterEmpty(!filterEmpty)}
                className="h-8"
              >
                <Filter className="w-3.5 h-3.5" />
                فارغة
              </Button>
              <Button size="sm" variant="ghost" onClick={handleAddEntry} className="h-8">
                <Plus className="w-3.5 h-3.5" />
                إضافة
              </Button>
            </div>

            {/* Progress */}
            {totalEntries > 0 && (
              <div className="px-4 py-1.5 border-b border-border flex items-center gap-3">
                <Progress value={progress} className="h-1.5 flex-1" />
                <span className="text-[10px] text-muted-foreground">{Math.round(progress)}%</span>
              </div>
            )}

            {/* Entry list */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {filteredEntries.map((entry, i) => {
                const realIdx = currentFile.entries.indexOf(entry);
                return (
                  <Card key={`${entry.label}-${realIdx}`} className="border-border/50">
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <code className="text-xs font-mono text-primary bg-primary/10 px-2 py-0.5 rounded flex-1 truncate" dir="ltr">
                          [{entry.label}]
                        </code>
                        <button
                          onClick={() => deleteEntry(realIdx)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <Input
                        value={entry.label}
                        onChange={e => updateEntry(realIdx, "label", e.target.value)}
                        className="h-7 text-xs font-mono"
                        dir="ltr"
                        placeholder="LABEL_NAME"
                      />
                      <Textarea
                        value={entry.text}
                        onChange={e => updateEntry(realIdx, "text", e.target.value)}
                        className="text-sm min-h-[60px] resize-y"
                        dir="rtl"
                        placeholder="أدخل النص المترجم هنا..."
                      />
                    </CardContent>
                  </Card>
                );
              })}
              {filteredEntries.length === 0 && (
                <div className="text-center text-muted-foreground text-sm py-12">
                  {searchTerm || filterEmpty ? "لا توجد نتائج" : "لا توجد مدخلات — أضف مدخلاً جديداً"}
                </div>
              )}
            </div>
          </main>
        </div>
      )}
    </div>
  );
}
