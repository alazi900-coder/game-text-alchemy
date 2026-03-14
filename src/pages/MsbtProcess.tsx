import { useState, useCallback, useEffect, useRef } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Upload, FileText, ArrowRight, Loader2, CheckCircle2, Clock, Pencil, Sparkles, Download, FolderOpen, XCircle, Timer } from "lucide-react";

type ProcessingStage = "idle" | "uploading" | "extracting" | "done" | "error";

const stageLabels: Record<ProcessingStage, string> = {
  idle: "في انتظار رفع الملفات",
  uploading: "تحميل الملفات...",
  extracting: "استخراج النصوص...",
  done: "اكتمل بنجاح! ✨",
  error: "حدث خطأ",
};

const stageProgress: Record<ProcessingStage, number> = {
  idle: 0, uploading: 30, extracting: 70, done: 100, error: 0,
};

interface GameConfig {
  id: string;
  title: string;
  emoji: string;
  accentClass: string;
  landingPath: string;
  heroBg: string;
}

const gameConfigs: Record<string, GameConfig> = {
  "animal-crossing": {
    id: "animal-crossing",
    title: "Animal Crossing: NH",
    emoji: "🌿",
    accentClass: "text-[hsl(140,70%,50%)]",
    landingPath: "/animal-crossing",
    heroBg: "",
  },
  "fire-emblem": {
    id: "fire-emblem",
    title: "Fire Emblem Engage",
    emoji: "⚔️",
    accentClass: "text-[hsl(0,80%,60%)]",
    landingPath: "/fire-emblem",
    heroBg: "",
  },
};

export default function MsbtProcess() {
  const location = useLocation();
  const gameId = location.pathname.includes("fire-emblem") ? "fire-emblem" : "animal-crossing";
  const config = gameConfigs[gameId];
  
  const [msbtFiles, setMsbtFiles] = useState<{ name: string; size: number; data: ArrayBuffer }[]>([]);
  const [stage, setStage] = useState<ProcessingStage>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [mergeMode, setMergeMode] = useState<"fresh" | "merge">("fresh");
  const [hasPreviousSession, setHasPreviousSession] = useState(false);
  const [fileLoadProgress, setFileLoadProgress] = useState<{ current: number; total: number } | null>(null);
  const [bundleProgress, setBundleProgress] = useState<{ current: number; total: number; fileName: string; msbtFound: number; lastMsbt: string } | null>(null);
  const cancelRef = useRef(false);
  const bundleStartTimeRef = useRef<number>(0);
  const navigate = useNavigate();
  const autoExportedRef = useRef(false);

  useEffect(() => {
    (async () => {
      const { idbGet } = await import("@/lib/idb-storage");
      const existing = await idbGet<{ translations?: Record<string, string> }>("editorState");
      const game = await idbGet<string>("editorGame");
      const hasTranslations = !!(existing?.translations && Object.keys(existing.translations).length > 0);
      setHasPreviousSession(!!(game === config.id && hasTranslations));
    })();
  }, [config.id]);

  const addLog = (msg: string) => setLogs(prev => [...prev, `[${new Date().toLocaleTimeString("ar-SA")}] ${msg}`]);

  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    cancelRef.current = false;
    bundleStartTimeRef.current = Date.now();
    const total = files.length;
    setFileLoadProgress({ current: 0, total });

    // Start a clean extraction session so old files never leak into a new build
    const { idbSet } = await import("@/lib/idb-storage");
    await Promise.all([
      idbSet("editorSarcArchives", []),
      idbSet("editorSarcArchive", null),
      idbSet("editorMsbtFiles", {}),
      idbSet("editorMsbtFileNames", []),
      idbSet("editorBundleMeta", null),
    ]);
    setMsbtFiles([]);

    const newMsbt: { name: string; size: number; data: ArrayBuffer }[] = [];
    let bundleCount = 0;
    let totalMsbtFromBundles = 0;
    const pendingBundleMeta: any[] = [];
    const pendingSarcArchives: Array<{
      originalFileName: string;
      endian: "big" | "little";
      nonMsbtEntries: { name: string; data: number[] }[];
      msbtEntryNames: string[];
      scopedMsbtNames?: { entryName: string; extractedName: string }[];
    }> = [];

    const normalizeMsbtName = (name: string) => name.toLowerCase().endsWith('.msbt') ? name : `${name}.msbt`;
    const sanitizeScope = (value: string) => value.replace(/[\\/:*?"<>|]/g, '_');
    const uniqueMsbtNames = new Set<string>();
    const ensureUniqueMsbtName = (baseName: string) => {
      if (!uniqueMsbtNames.has(baseName)) {
        uniqueMsbtNames.add(baseName);
        return baseName;
      }
      const extMatch = baseName.match(/\.msbt$/i);
      const stem = extMatch ? baseName.slice(0, -5) : baseName;
      const ext = extMatch ? '.msbt' : '';
      let n = 2;
      let candidate = `${stem}__dup${n}${ext}`;
      while (uniqueMsbtNames.has(candidate)) {
        n++;
        candidate = `${stem}__dup${n}${ext}`;
      }
      uniqueMsbtNames.add(candidate);
      return candidate;
    };

    const makeBundleScopedMsbtName = (bundleName: string, assetName: string, assetPathId: bigint | number | string) => {
      const safeBundle = sanitizeScope(bundleName);
      const safeAsset = sanitizeScope(normalizeMsbtName(assetName));
      return `bundle__${safeBundle}__${String(assetPathId)}__${safeAsset}`;
    };

    const makeSarcScopedMsbtName = (archiveName: string, entryName: string, entryIndex: number) => {
      const safeArchive = sanitizeScope(archiveName);
      const safeEntry = sanitizeScope(normalizeMsbtName(entryName.replace(/.*[/\\]/, '')));
      return `sarc__${safeArchive}__${entryIndex}__${safeEntry}`;
    };

    // Count total bundles for progress
    let totalBundles = 0;
    for (let j = 0; j < total; j++) {
      const n = files[j].name.toLowerCase();
      if (n.endsWith('.bundle') || n.endsWith('.bytes')) totalBundles++;
    }

    for (let i = 0; i < total; i++) {
      const f = files[i];
      const lower = f.name.toLowerCase();
      if (cancelRef.current) break;

      if (lower.endsWith('.msbt')) {
        try {
          const buf = await f.arrayBuffer();
          const uniqueName = ensureUniqueMsbtName(normalizeMsbtName(f.name));
          newMsbt.push({ name: uniqueName, size: buf.byteLength, data: buf });
        } catch (err) {
          addLog(`⚠️ فشل قراءة ${f.name}: ${err instanceof Error ? err.message : 'خطأ'}`);
        }
      } else if (lower.endsWith('.bundle') || lower.endsWith('.bytes')) {
        // Auto-filter non-text bundles (graphics, maps, models)
        const baseName = f.name.split('/').pop()?.toLowerCase() || lower;
        const nonTextPrefixes = ['gr_', 'ma_', 'mo_', 'sc_', 'ef_'];
        if (nonTextPrefixes.some(p => baseName.startsWith(p))) {
          addLog(`⏭️ تخطي ${f.name} — ملف رسوميات/نماذج (ليس نصوص)`);
          bundleCount++;
          setBundleProgress(prev => prev ? { ...prev, current: bundleCount } : null);
          continue;
        }
        // Unity Asset Bundle — extract MSBT files automatically
        try {
          setBundleProgress({ current: bundleCount + 1, total: totalBundles, fileName: f.name, msbtFound: totalMsbtFromBundles, lastMsbt: '' });
          const buf = await f.arrayBuffer();
          const { extractBundleAssets, isMsbt } = await import("@/lib/unity-asset-bundle");
          const { info, assets, decompressedData } = await extractBundleAssets(buf);
          const msbtAssets = assets.filter(a => isMsbt(a.data));
          bundleCount++;

          // Log what was found inside the bundle for debugging
          const typesSummary = assets.reduce((acc, a) => { acc[a.type] = (acc[a.type] || 0) + 1; return acc; }, {} as Record<string, number>);
          const typesStr = Object.entries(typesSummary).map(([t, c]) => `${t}:${c}`).join(', ');
          addLog(`🔍 ${f.name}: ${assets.length} عنصر (${typesStr || 'فارغ'})${info.entries.length > 0 ? ` — ${info.entries.length} ملف داخلي` : ''}`);

          if (msbtAssets.length === 0) {
            setBundleProgress(prev => prev ? { ...prev, current: bundleCount } : null);
          } else {
            addLog(`✅ ${f.name}: ${msbtAssets.length} ملف MSBT`);
            const scopedMsbtByAssetKey: Record<string, string> = {};

            for (const asset of msbtAssets) {
              const assetName = normalizeMsbtName(asset.name);
              const assetPathId = typeof asset.pathId === 'bigint' ? asset.pathId.toString() : String(asset.pathId ?? asset.entryIndex);
              const assetKey = `${asset.name}#${assetPathId}`;
              const scopedName = ensureUniqueMsbtName(makeBundleScopedMsbtName(f.name, assetName, assetPathId));
              const assetCopy = new Uint8Array(asset.data);

              scopedMsbtByAssetKey[assetKey] = scopedName;
              newMsbt.push({ name: scopedName, size: assetCopy.length, data: assetCopy.buffer as ArrayBuffer });
              totalMsbtFromBundles++;
              setBundleProgress(prev => prev ? { ...prev, current: bundleCount, msbtFound: totalMsbtFromBundles, lastMsbt: assetName } : null);
            }

            pendingBundleMeta.push({
              originalFileName: f.name,
              info,
              assets,
              decompressedData: decompressedData.buffer,
              originalBuffer: buf,
              scopedMsbtByAssetKey,
            });
          }
        } catch (err) {
          bundleCount++;
          addLog(`⚠️ فشل فك Bundle ${f.name}: ${err instanceof Error ? err.message : 'خطأ'}`);
        }
      } else if (lower.endsWith('.sarc.zs') || lower.endsWith('.sarc')) {
        try {
          addLog(`📦 فك أرشيف ${f.name}...`);
          const buf = await f.arrayBuffer();
          const data = new Uint8Array(buf);
          const { parseSarc, parseSarcZs, extractMsbtFromSarc } = await import("@/lib/sarc-parser");
          const archive = lower.endsWith('.zs') ? await parseSarcZs(data) : parseSarc(data);
          const msbtEntries = extractMsbtFromSarc(archive);
          addLog(`✅ ${f.name}: ${archive.entries.length} ملف داخلي — ${msbtEntries.length} ملف MSBT`);

          const scopedMsbtNames: { entryName: string; extractedName: string }[] = [];

          pendingSarcArchives.push({
            originalFileName: f.name,
            endian: archive.endian,
            nonMsbtEntries: archive.entries
              .filter(e => !e.name.toLowerCase().endsWith(".msbt"))
              .map(e => ({ name: e.name, data: Array.from(e.data) })),
            msbtEntryNames: msbtEntries.map(e => e.name),
            scopedMsbtNames,
          });

          for (let entryIndex = 0; entryIndex < msbtEntries.length; entryIndex++) {
            const entry = msbtEntries[entryIndex];
            const extractedName = ensureUniqueMsbtName(makeSarcScopedMsbtName(f.name, entry.name, entryIndex));
            const entryBuf = new Uint8Array(entry.data);
            scopedMsbtNames.push({ entryName: entry.name, extractedName });
            newMsbt.push({ name: extractedName, size: entryBuf.length, data: entryBuf.buffer as ArrayBuffer });
          }
        } catch (err) {
          addLog(`⚠️ فشل فك ${f.name}: ${err instanceof Error ? err.message : 'خطأ'}`);
        }
      }

      setFileLoadProgress({ current: i + 1, total });
      if (i % 4 === 0) await new Promise(r => setTimeout(r, 0));
      if (cancelRef.current) break;
    }

    if (pendingBundleMeta.length > 0) {
      await idbSet("editorBundleMeta", pendingBundleMeta);
    }

    if (pendingSarcArchives.length > 0) {
      await Promise.all([
        idbSet("editorSarcArchives", pendingSarcArchives),
        idbSet("editorSarcArchive", pendingSarcArchives[pendingSarcArchives.length - 1]),
      ]);
    }

    setFileLoadProgress(null);
    setBundleProgress(null);
    if (cancelRef.current) {
      cancelRef.current = false;
      addLog(`🚫 تم إلغاء المعالجة — ${newMsbt.length} ملف MSBT تم تحميله قبل الإلغاء`);
    } else {
      addLog(`📂 تم تحميل ${newMsbt.length} ملف MSBT` + (bundleCount > 0 ? ` (من ${bundleCount} Bundle)` : ''));
    }
    if (newMsbt.length > 0) setMsbtFiles(newMsbt);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    handleFileSelect(e.dataTransfer.files);
  }, [handleFileSelect]);

  const removeFile = (index: number) => {
    setMsbtFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleExtract = async () => {
    if (msbtFiles.length === 0) return;
    setExtracting(true);
    setStage("uploading");
    setLogs([]);
    addLog("🚀 بدء استخراج النصوص من ملفات MSBT...");
    addLog(`📄 عدد الملفات: ${msbtFiles.length}`);

    try {
      const { parseMsbtFile, extractMsbtStrings } = await import("@/lib/msbt-parser");
      const { hasArabicPresentationForms, removeArabicPresentationForms, reverseBidi } = await import("@/lib/arabic-processing");

      setStage("extracting");
      
      type ExtractedEntry = { msbtFile: string; index: number; label: string; original: string; type: string };
      const allEntries: ExtractedEntry[] = [];
      const fileBuffers: Record<string, ArrayBuffer> = {};

      for (const file of msbtFiles) {
        try {
          const buffer = file.data;
          fileBuffers[file.name] = buffer;
          const data = new Uint8Array(buffer);
          addLog(`📂 ${file.name}: ${(data.length / 1024).toFixed(1)} KB`);
          
          const msbt = parseMsbtFile(data);
          const entries = extractMsbtStrings(msbt, file.name);
          addLog(`✅ ${file.name}: ${entries.length} نص مستخرج (${msbt.entries.length} label)`);
          allEntries.push(...entries);
        } catch (e) {
          addLog(`⚠️ فشل تحليل ${file.name}: ${e instanceof Error ? e.message : 'خطأ'}`);
        }
      }

      if (allEntries.length === 0) {
        setStage("error");
        addLog("⚠️ لم يتم العثور على نصوص قابلة للترجمة في الملفات المرفوعة.");
        setExtracting(false);
        return;
      }

      // Auto-detect existing Arabic
      const autoTranslations: Record<string, string> = {};
      const arabicLetterRegex = /[\u0621-\u064A\u0671-\u06D3\uFB50-\uFDFF\uFE70-\uFEFF]/g;
      const eastAsianRegex = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/g;
      const presentationEntries = allEntries.filter(e => hasArabicPresentationForms(e.original));
      const reuploadThreshold = Math.min(allEntries.length, Math.max(25, Math.ceil(allEntries.length * 0.2)));
      const isReUploadedBuild = presentationEntries.length >= reuploadThreshold;

      if (!isReUploadedBuild) {
        for (const entry of allEntries) {
          const stripped = entry.original.replace(/[\uE000-\uF8FF\uFFF9-\uFFFC\u0000-\u001F\[\]]/g, '').trim();
          if (stripped.length < 6) continue; // skip very short entries (tags, IDs, etc.)
          const arabicCount = (stripped.match(arabicLetterRegex) || []).length;
          const eastAsianCount = (stripped.match(eastAsianRegex) || []).length;
          const latinCount = (stripped.match(/[A-Za-z]/g) || []).length;
          const totalLetters = arabicCount + eastAsianCount + latinCount;

          // Require Arabic to be dominant: ≥50% of all letters AND ≥5 Arabic chars
          const looksLikeArabicText = totalLetters > 0
            && arabicCount >= 5
            && (arabicCount / totalLetters) >= 0.5
            && arabicCount >= eastAsianCount * 2;

          if (looksLikeArabicText) {
            const key = `${entry.msbtFile}:${entry.index}`;
            autoTranslations[key] = stripped;
          }
        }
        addLog(`🎯 كشف تلقائي: ${Object.keys(autoTranslations).length} نص معرّب`);
      } else {
        addLog(`📌 ملف مبني سابقاً — تم تخطي الكشف التلقائي (${presentationEntries.length} نص بصيغ عرض عربية)`);
        for (const entry of allEntries) {
          if (hasArabicPresentationForms(entry.original)) {
            entry.original = removeArabicPresentationForms(reverseBidi(entry.original));
          }
        }
      }

      let finalTranslations: Record<string, string> = { ...autoTranslations };

      if (mergeMode === "merge") {
        const { idbGet } = await import("@/lib/idb-storage");
        const existing = await idbGet<{ translations?: Record<string, string> }>("editorState");
        const existingTranslations = existing?.translations || {};
        const validKeys = new Set(allEntries.map(e => `${e.msbtFile}:${e.index}`));
        for (const [k, v] of Object.entries(existingTranslations)) {
          if (validKeys.has(k) && v && !finalTranslations[k]) {
            finalTranslations[k] = v as string;
          }
        }
      }

      // Save to IDB
      const { idbSet, idbGet, idbClearExcept } = await import("@/lib/idb-storage");

      // Generate a session ID to link extraction ↔ build
      const sessionId = crypto.randomUUID();

      // Keys that must survive the clear (written by handleFileSelect)
      const preserveKeys = ["buildTranslations", "editorBundleMeta", "editorSarcArchives", "editorSarcArchive"];
      
      if (!isReUploadedBuild) {
        const originalTextsMap: Record<string, string> = {};
        for (const entry of allEntries) {
          originalTextsMap[`${entry.msbtFile}:${entry.index}`] = entry.original;
        }
        await idbClearExcept(preserveKeys);
        await idbSet("originalTexts", originalTextsMap);
      } else {
        await idbClearExcept([...preserveKeys, "originalTexts"]);
      }

      // Store session ID so the build step can verify it matches
      await idbSet("extractionSessionId", sessionId);

      await idbSet("editorState", {
        entries: allEntries,
        translations: finalTranslations,
        freshExtraction: true,
      });
      await idbSet("editorGame", config.id);

      // Verify bundle/sarc metadata survived the clear
      const bundleMetaCheck = await idbGet<any[]>("editorBundleMeta");
      const sarcCheck = await idbGet<any[]>("editorSarcArchives");
      if (bundleMetaCheck && bundleMetaCheck.length > 0) {
        addLog(`📦 بيانات ${bundleMetaCheck.length} Bundle محفوظة للبناء`);
      }
      if (sarcCheck && sarcCheck.length > 0) {
        addLog(`📦 بيانات ${sarcCheck.length} أرشيف SARC محفوظة للبناء`);
      }

      try {
        await idbSet("editorMsbtFiles", fileBuffers);
        await idbSet("editorMsbtFileNames", msbtFiles.map(f => f.name));
      } catch {
        addLog("⚠️ لم يتم حفظ الملفات الثنائية — مساحة تخزين محدودة");
      }

      const translationCount = Object.values(finalTranslations).filter(v => v?.trim()).length;
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
        <Link to={config.landingPath} className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-4 font-body text-sm">
          <ArrowRight className="w-4 h-4" />
          العودة لصفحة اللعبة
        </Link>
        <div className="inline-flex items-center gap-2 mb-4 px-4 py-2 rounded-full bg-card border border-border">
          <Sparkles className={`w-4 h-4 ${config.accentClass}`} />
          <span className={`text-sm ${config.accentClass} font-display font-semibold`}>رفع ومعالجة الملفات</span>
        </div>
        <h1 className="text-3xl md:text-4xl font-display font-black mb-3 drop-shadow-lg">
          رفع ملفات {config.title} {config.emoji}
        </h1>
        <p className="text-muted-foreground font-body">
          ارفع ملفات MSBT أو SARC.ZS أو .bytes.bundle — يمكنك رفع عدة ملفات دفعة واحدة
        </p>
      </header>

      <div className="flex-1 py-8 px-4">
        <div className="max-w-3xl mx-auto">
          {/* Upload area */}
          <div
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            className={`relative flex flex-col items-center justify-center p-10 rounded-xl border-2 border-dashed transition-colors cursor-pointer mb-4
              ${msbtFiles.length > 0 ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/30 bg-card"}
              ${isProcessing ? "opacity-50 pointer-events-none" : ""}`}
          >
            <FileText className="w-12 h-12 text-primary mb-3" />
            <p className="font-display font-semibold mb-1">ملفات MSBT أو SARC.ZS أو Bundle</p>
            <p className="text-xs text-muted-foreground mb-4">اسحب الملفات هنا أو اختر من الجهاز — يدعم .msbt و .sarc.zs و .bytes.bundle</p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 border border-primary/30 text-sm font-display font-semibold cursor-pointer hover:bg-primary/20 transition-colors">
                <Upload className="w-4 h-4" />
                اختيار ملفات
                <input type="file" accept=".msbt,.sarc,.zs,.bundle,.bytes" multiple className="hidden" onChange={e => handleFileSelect(e.target.files)} disabled={isProcessing} />
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
            {fileLoadProgress && (
              <div className="mt-3 flex items-center gap-3 px-2 w-full max-w-xs">
                <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round((fileLoadProgress.current / fileLoadProgress.total) * 100)}%` }} />
                </div>
                <span className="text-xs font-mono text-muted-foreground">{fileLoadProgress.current}/{fileLoadProgress.total}</span>
              </div>
            )}
            {bundleProgress && (() => {
              const elapsed = (Date.now() - bundleStartTimeRef.current) / 1000;
              const fraction = bundleProgress.current / bundleProgress.total;
              const remaining = fraction > 0.05 ? (elapsed / fraction) * (1 - fraction) : 0;
              const fmt = (s: number) => {
                const m = Math.floor(s / 60);
                const sec = Math.floor(s % 60);
                return m > 0 ? `${m}:${sec.toString().padStart(2, '0')}` : `${sec}s`;
              };
              return (
              <div className="mt-3 w-full max-w-sm space-y-2 px-2">
                <div className="flex items-center gap-3">
                  <Loader2 className="w-4 h-4 animate-spin text-[hsl(var(--primary))] shrink-0" />
                  <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-[hsl(var(--primary))] transition-all duration-300" style={{ width: `${Math.round(fraction * 100)}%` }} />
                  </div>
                  <span className="text-xs font-mono text-muted-foreground">{bundleProgress.current}/{bundleProgress.total}</span>
                </div>
                <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Timer className="w-3 h-3" /> {fmt(elapsed)}</span>
                  {remaining > 0 && <span className="text-[hsl(var(--primary))]">≈ {fmt(remaining)} متبقي</span>}
                </div>
                <div className="text-xs text-muted-foreground text-center truncate" dir="ltr">
                  📦 {bundleProgress.fileName}
                </div>
                {bundleProgress.msbtFound > 0 && (
                  <div className="text-xs text-center space-y-0.5">
                    <span className="text-[hsl(var(--primary))] font-semibold">{bundleProgress.msbtFound} MSBT</span>
                    {bundleProgress.lastMsbt && (
                      <div className="text-muted-foreground truncate" dir="ltr">← {bundleProgress.lastMsbt}</div>
                    )}
                  </div>
                )}
                <button
                  onClick={() => { cancelRef.current = true; }}
                  className="mx-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs font-display font-semibold hover:bg-destructive/20 transition-colors"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  إلغاء
                </button>
              </div>
              );
            })()}
          </div>

          {/* File list */}
          {msbtFiles.length > 0 && (
            <Card className="mb-4">
              <CardHeader className="pb-2">
                <CardTitle className="font-display text-lg">📄 ملفات MSBT ({msbtFiles.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {msbtFiles.map((f, i) => (
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

          {/* Merge mode */}
          {hasPreviousSession && (
            <div className="flex items-center justify-center gap-3 mb-6">
              <button onClick={() => setMergeMode("fresh")}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-display font-bold transition-all ${
                  mergeMode === "fresh" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                }`}>
                بدء مشروع جديد
              </button>
              <button onClick={() => setMergeMode("merge")}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-display font-bold transition-all ${
                  mergeMode === "merge" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                }`}>
                <CheckCircle2 className="w-4 h-4" />
                دمج مع الترجمات السابقة
              </button>
            </div>
          )}

          {/* Extract button */}
          <div className="flex flex-col items-center gap-4 mb-8">
            <Button size="lg" onClick={handleExtract} disabled={msbtFiles.length === 0 || isProcessing || extracting}
              className="font-display font-bold text-lg px-10 py-6 bg-primary hover:bg-primary/90 text-primary-foreground shadow-xl shadow-primary/30">
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
                <div className="flex justify-between items-center text-xs text-muted-foreground mt-1">
                  <span>{stageProgress[stage]}%</span>
                  {isProcessing && <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> جاري المعالجة...</span>}
                </div>
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
                    a.download = `msbt-log-${new Date().toISOString().slice(0, 10)}.txt`;
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
              <Card className="w-full max-w-md border-primary/30 bg-primary/5">
                <CardContent className="p-4 space-y-2 text-center">
                  <p className="text-sm font-display font-bold">📊 ملخص الاستخراج</p>
                  <div className="flex justify-center gap-6 text-sm">
                    <div className="flex flex-col items-center">
                      <span className="text-lg font-bold text-primary">{msbtFiles.length}</span>
                      <span className="text-xs text-muted-foreground">ملف MSBT</span>
                    </div>
                    <div className="flex flex-col items-center">
                      <span className="text-lg font-bold text-foreground">
                        {logs.find(l => l.includes('من أصل'))?.match(/(\d[\d,]*)\s*ترجمة من أصل\s*(\d[\d,]*)/)?.[2] || '—'}
                      </span>
                      <span className="text-xs text-muted-foreground">نص مستخرج</span>
                    </div>
                    <div className="flex flex-col items-center">
                      <span className="text-lg font-bold text-secondary">
                        {logs.find(l => l.includes('من أصل'))?.match(/(\d[\d,]*)\s*ترجمة/)?.[1] || '0'}
                      </span>
                      <span className="text-xs text-muted-foreground">مترجم</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
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
