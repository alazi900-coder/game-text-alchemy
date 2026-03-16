import { useState, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Upload, FileText, ArrowRight, Loader2, Pencil, Sparkles, Download, FolderOpen, Ghost } from "lucide-react";
import type { ExtractedEntry } from "@/components/editor/types";

type Stage = "idle" | "uploading" | "extracting" | "done" | "error";

const stageLabels: Record<Stage, string> = {
  idle: "في انتظار رفع الملفات",
  uploading: "تحميل الملفات...",
  extracting: "استخراج النصوص...",
  done: "اكتمل بنجاح! ✨",
  error: "حدث خطأ",
};

const stageProgress: Record<Stage, number> = {
  idle: 0, uploading: 30, extracting: 70, done: 100, error: 0,
};

export default function NlocProcess() {
  const navigate = useNavigate();
  const [nlocFiles, setNlocFiles] = useState<{ name: string; size: number; data: ArrayBuffer }[]>([]);
  const [stage, setStage] = useState<Stage>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [extracting, setExtracting] = useState(false);

  const addLog = (msg: string) => setLogs(prev => [...prev, `[${new Date().toLocaleTimeString("ar-SA")}] ${msg}`]);

  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const newFiles: { name: string; size: number; data: ArrayBuffer }[] = [];

    for (const f of Array.from(files)) {
      const lower = f.name.toLowerCase();
      if (lower.endsWith('.loc') || lower.endsWith('.data') || lower.endsWith('.dict') || lower.endsWith('.nloc')) {
        try {
          const buf = await f.arrayBuffer();
          newFiles.push({ name: f.name, size: buf.byteLength, data: buf });
        } catch (err) {
          addLog(`⚠️ فشل قراءة ${f.name}: ${err instanceof Error ? err.message : 'خطأ'}`);
        }
      } else {
        addLog(`⏭️ تخطي ${f.name} — صيغة غير مدعومة (يدعم .data و .dict و .loc)`);
      }
    }

    if (newFiles.length > 0) {
      setNlocFiles(prev => [...prev, ...newFiles]);
      addLog(`📂 تم تحميل ${newFiles.length} ملف`);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    handleFileSelect(e.dataTransfer.files);
  }, [handleFileSelect]);

  const removeFile = (index: number) => {
    setNlocFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleExtract = async () => {
    if (nlocFiles.length === 0) return;
    setExtracting(true);
    setStage("uploading");
    setLogs([]);
    addLog("🚀 بدء استخراج النصوص من ملفات NLOC...");
    addLog(`📄 عدد الملفات: ${nlocFiles.length}`);

    try {
      const { parseNloc, parseNlocFromDictData, isNloc, isDictFile } = await import("@/lib/nloc-parser");

      setStage("extracting");

      const allEntries: ExtractedEntry[] = [];
      const autoTranslations: Record<string, string> = {};
      const nlocFilesMap: Record<string, ArrayBuffer> = {};

      // Separate .dict and .data files, pair them by base name
      const dictFiles: Record<string, { name: string; data: Uint8Array }> = {};
      const dataFiles: { name: string; data: Uint8Array }[] = [];

      for (const file of nlocFiles) {
        const data = new Uint8Array(file.data);
        const lower = file.name.toLowerCase();
        if (lower.endsWith('.dict')) {
          const baseName = file.name.replace(/\.dict$/i, '');
          dictFiles[baseName.toLowerCase()] = { name: file.name, data };
        } else {
          dataFiles.push({ name: file.name, data });
        }
      }

      // If only .dict files uploaded, warn
      if (dataFiles.length === 0 && Object.keys(dictFiles).length > 0) {
        setStage("error");
        addLog("⚠️ تم رفع ملفات .dict فقط — يجب رفع ملف .data المرافق أيضاً (مثل English.data)");
        setExtracting(false);
        return;
      }

      for (const file of dataFiles) {
        try {
          nlocFilesMap[file.name] = file.data.buffer.slice(file.data.byteOffset, file.data.byteOffset + file.data.byteLength) as ArrayBuffer;
          addLog(`📂 ${file.name}: ${(file.data.length / 1024).toFixed(1)} KB`);

          // Check for companion .dict file
          const baseName = file.name.replace(/\.data$/i, '');
          const companionDict = dictFiles[baseName.toLowerCase()];
          if (companionDict) {
            addLog(`🔗 تم ربط ${file.name} مع ${companionDict.name}`);
            nlocFilesMap[companionDict.name] = companionDict.data.buffer.slice(companionDict.data.byteOffset, companionDict.data.byteOffset + companionDict.data.byteLength);
          }

          let parsed;
          if (isNloc(file.data)) {
            parsed = parseNloc(file.data);
          } else {
            // Try as .data file (has 0x10 header)
            try {
              parsed = parseNlocFromDictData(file.data);
            } catch {
              addLog(`⚠️ ${file.name}: صيغة غير معروفة — تخطي`);
              continue;
            }
          }

          addLog(`✅ ${file.name}: ${parsed.messages.length} نص (لغة: 0x${parsed.langId.toString(16).toUpperCase()})`);

          for (let i = 0; i < parsed.messages.length; i++) {
            const msg = parsed.messages[i];
            const msbtFile = `nloc:${file.name}`;
            const label = `${file.name} → ${msg.idHex}`;
            allEntries.push({
              msbtFile,
              index: i,
              label,
              original: msg.text || "(فارغ)",
              maxBytes: 0,
            });

            // Auto-detect existing Arabic
            const arabicRegex = /[\u0621-\u064A\u0671-\u06D3\uFB50-\uFDFF\uFE70-\uFEFF]/g;
            const stripped = msg.text.replace(/[\u0000-\u001F]/g, '').trim();
            if (stripped.length >= 5 && (stripped.match(arabicRegex) || []).length >= 3) {
              autoTranslations[`${msbtFile}:${i}`] = stripped;
            }
          }
        } catch (e) {
          addLog(`⚠️ فشل تحليل ${file.name}: ${e instanceof Error ? e.message : 'خطأ'}`);
        }
      }

      if (allEntries.length === 0) {
        setStage("error");
        addLog("⚠️ لم يتم العثور على نصوص قابلة للترجمة.");
        setExtracting(false);
        return;
      }

      // Save to IDB
      const { idbSet, idbClearExcept } = await import("@/lib/idb-storage");

      await idbClearExcept([]);

      // Store original texts
      const originalTextsMap: Record<string, string> = {};
      for (const entry of allEntries) {
        originalTextsMap[`${entry.msbtFile}:${entry.index}`] = entry.original;
      }
      await idbSet("originalTexts", originalTextsMap);

      await idbSet("editorState", {
        entries: allEntries,
        translations: autoTranslations,
        freshExtraction: true,
      });
      await idbSet("editorGame", "luigis-mansion");
      await idbSet("editorGameType", "nloc");

      // Store NLOC files for rebuild
      try {
        await idbSet("editorNlocFiles", nlocFilesMap);
      } catch {
        addLog("⚠️ لم يتم حفظ الملفات الثنائية — مساحة تخزين محدودة");
      }

      const translationCount = Object.values(autoTranslations).filter(v => v?.trim()).length;
      addLog(`📊 ${translationCount} ترجمة من أصل ${allEntries.length} نص`);
      setStage("done");
      addLog("✨ جاهز للتحرير!");
    } catch (err) {
      setStage("error");
      addLog(`❌ ${err instanceof Error ? err.message : "خطأ غير معروف"}`);
    } finally {
      setExtracting(false);
    }
  };

  const isProcessing = !["idle", "done", "error"].includes(stage);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="py-12 px-4 text-center border-b border-border">
        <Link to="/luigis-mansion" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-4 font-body text-sm">
          <ArrowRight className="w-4 h-4" />
          العودة لصفحة اللعبة
        </Link>
        <div className="inline-flex items-center gap-2 mb-4 px-4 py-2 rounded-full bg-card border border-border">
          <Sparkles className="w-4 h-4 text-[hsl(120,70%,50%)]" />
          <span className="text-sm text-[hsl(120,70%,50%)] font-display font-semibold">رفع ومعالجة الملفات</span>
        </div>
        <h1 className="text-3xl md:text-4xl font-display font-black mb-3 drop-shadow-lg">
          رفع ملفات Luigi's Mansion 2 HD 👻
        </h1>
        <p className="text-muted-foreground font-body">
          ارفع ملفات English.data و English.dict معاً — النصوص موجودة في ملف .data
        </p>
      </header>

      <div className="flex-1 py-8 px-4">
        <div className="max-w-3xl mx-auto">
          {/* Upload area */}
          <div
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            className={`relative flex flex-col items-center justify-center p-10 rounded-xl border-2 border-dashed transition-colors cursor-pointer mb-4
              ${nlocFiles.length > 0 ? "border-[hsl(120,50%,40%)]/50 bg-[hsl(120,50%,40%)]/5" : "border-border hover:border-[hsl(120,50%,40%)]/30 bg-card"}
              ${isProcessing ? "opacity-50 pointer-events-none" : ""}`}
          >
            <Ghost className="w-12 h-12 text-[hsl(120,70%,50%)] mb-3" />
            <p className="font-display font-semibold mb-1">ملفات NLOC (.data + .dict)</p>
            <p className="text-xs text-muted-foreground mb-4">ارفع English.data و English.dict معاً</p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(120,50%,40%)]/10 border border-[hsl(120,50%,40%)]/30 text-sm font-display font-semibold cursor-pointer hover:bg-[hsl(120,50%,40%)]/20 transition-colors">
                <Upload className="w-4 h-4" />
                اختيار ملفات
                <input type="file" accept=".loc,.data,.dict,.nloc" multiple className="hidden" onChange={e => handleFileSelect(e.target.files)} disabled={isProcessing} />
              </label>
              <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary/10 border border-secondary/30 text-sm font-display font-semibold cursor-pointer hover:bg-secondary/20 transition-colors">
                <FolderOpen className="w-4 h-4" />
                رفع مجلد كامل
                <input type="file" multiple className="hidden"
                  // @ts-ignore
                  webkitdirectory="" directory=""
                  onChange={e => { handleFileSelect(e.target.files); e.target.value = ''; }}
                  disabled={isProcessing}
                />
              </label>
            </div>
          </div>

          {/* File list */}
          {nlocFiles.length > 0 && (
            <Card className="mb-4">
              <CardHeader className="pb-2">
                <CardTitle className="font-display text-lg">👻 ملفات NLOC ({nlocFiles.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {nlocFiles.map((f, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-1.5 rounded bg-background border border-border text-sm">
                      <span className="font-mono text-xs truncate flex-1" dir="ltr">{f.name}</span>
                      <span className="text-muted-foreground text-xs mx-3">{(f.size / 1024).toFixed(1)} KB</span>
                      <button onClick={() => removeFile(i)} className="text-destructive text-xs hover:underline" disabled={isProcessing}>حذف</button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Extract button */}
          <div className="flex flex-col items-center gap-4 mb-8">
            <Button size="lg" onClick={handleExtract} disabled={nlocFiles.length === 0 || isProcessing || extracting}
              className="font-display font-bold text-lg px-10 py-6 bg-[hsl(120,50%,40%)] hover:bg-[hsl(120,50%,35%)] text-white shadow-xl shadow-[hsl(120,50%,40%)]/30">
              {extracting ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> جاري الاستخراج...</>
              ) : (
                <><Pencil className="w-5 h-5" /> استخراج وتحرير ✍️</>
              )}
            </Button>
          </div>

          {/* Progress */}
          {stage !== "idle" && (
            <Card className={`mb-6 ${stage === "error" ? "border-destructive/50 bg-destructive/5" : stage === "done" ? "border-green-500/50 bg-green-500/5" : ""}`}>
              <CardHeader>
                <CardTitle className="font-display text-lg">{stageLabels[stage]}</CardTitle>
              </CardHeader>
              <CardContent>
                <Progress value={stageProgress[stage]} className="h-3" />
              </CardContent>
            </Card>
          )}

          {/* Logs */}
          {logs.length > 0 && (
            <Card className="mb-6">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="font-display text-lg">📋 سجل العمليات</CardTitle>
                <Button variant="outline" size="sm" className="gap-1.5"
                  onClick={() => {
                    const text = logs.join('\n');
                    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `nloc-log-${new Date().toISOString().slice(0, 10)}.txt`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}>
                  <Download className="w-4 h-4" /> تصدير
                </Button>
              </CardHeader>
              <CardContent>
                <div className="bg-background rounded-lg p-4 max-h-96 overflow-y-auto font-mono text-xs space-y-1 border border-border/40" dir="ltr">
                  {logs.map((log, i) => (
                    <div key={i} className="text-muted-foreground whitespace-pre-wrap">{log}</div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Go to editor */}
          {stage === "done" && (
            <div className="flex flex-col items-center gap-4 mb-6">
              <Button size="lg" onClick={() => navigate("/editor")} className="gap-2 text-lg px-8">
                <Pencil className="w-5 h-5" />
                انتقل إلى المحرر
                <ArrowRight className="w-5 h-5" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
