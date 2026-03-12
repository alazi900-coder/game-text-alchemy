import { useState, useRef, useEffect } from "react";
import type { IntegrityCheckResult } from "@/components/editor/IntegrityCheckDialog";
import { idbGet } from "@/lib/idb-storage";
import { processArabicText, hasArabicChars as hasArabicCharsProcessing, hasArabicPresentationForms, removeArabicPresentationForms, reverseBidi } from "@/lib/arabic-processing";
import { EditorState, hasTechnicalTags, restoreTagsLocally } from "@/components/editor/types";
import { BuildPreview } from "@/components/editor/BuildConfirmDialog";
import type { MutableRefObject } from "react";

export interface BuildStats {
  modifiedCount: number;
  expandedCount: number;
  fileSize: number;
  compressedSize?: number;
  avgBytePercent: number;
  maxBytePercent: number;
  longest: { key: string; bytes: number } | null;
  shortest: { key: string; bytes: number } | null;
  categories: Record<string, { total: number; modified: number }>;
}

export interface BdatFileStat {
  fileName: string;
  total: number;
  translated: number;
  hasError?: boolean;
}

interface UseEditorBuildProps {
  state: EditorState | null;
  setState: React.Dispatch<React.SetStateAction<EditorState | null>>;
  setLastSaved: (msg: string) => void;
  arabicNumerals: boolean;
  mirrorPunctuation: boolean;
  gameType?: string;
  forceSaveRef?: React.RefObject<() => Promise<void>>;
}

export function useEditorBuild({ state, setState, setLastSaved, arabicNumerals, mirrorPunctuation, gameType, forceSaveRef }: UseEditorBuildProps) {
  // Use a ref to always access the LATEST state in async handlers
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const [building, setBuilding] = useState(false);
  const [buildProgress, setBuildProgress] = useState("");
  const [applyingArabic, setApplyingArabic] = useState(false);
  const [buildStats, setBuildStats] = useState<BuildStats | null>(null);
  const [buildPreview, setBuildPreview] = useState<BuildPreview | null>(null);
  const [showBuildConfirm, setShowBuildConfirm] = useState(false);
  const [bdatFileStats, setBdatFileStats] = useState<BdatFileStat[]>([]);
  const [integrityResult, setIntegrityResult] = useState<IntegrityCheckResult | null>(null);
  const [showIntegrityDialog, setShowIntegrityDialog] = useState(false);
  const [checkingIntegrity, setCheckingIntegrity] = useState(false);


  const handleApplyArabicProcessing = () => {
    const currentState = stateRef.current;
    if (!currentState) return;
    setApplyingArabic(true);
    const newTranslations = { ...currentState.translations };
    let processedCount = 0, skippedCount = 0;
    for (const [key, value] of Object.entries(newTranslations)) {
      if (!value?.trim()) continue;
      if (hasArabicPresentationForms(value)) { skippedCount++; continue; }
      if (!hasArabicCharsProcessing(value)) continue;
      newTranslations[key] = processArabicText(value, { arabicNumerals, mirrorPunct: mirrorPunctuation });
      processedCount++;
    }
    setState(prev => prev ? { ...prev, translations: newTranslations } : null);
    setApplyingArabic(false);
    setLastSaved(`✅ تم تطبيق المعالجة العربية على ${processedCount} نص` + (skippedCount > 0 ? ` (تم تخطي ${skippedCount} نص معالج مسبقاً)` : ''));
    setTimeout(() => setLastSaved(""), 5000);
  };

  const handleUndoArabicProcessing = () => {
    const currentState = stateRef.current;
    if (!currentState) return;
    setApplyingArabic(true);
    const newTranslations = { ...currentState.translations };
    let revertedCount = 0;
    for (const [key, value] of Object.entries(newTranslations)) {
      if (!value?.trim()) continue;
      if (!hasArabicPresentationForms(value)) continue;
      // Reverse BiDi (self-inverse) then map presentation forms back to standard
      const unReversed = reverseBidi(value);
      newTranslations[key] = removeArabicPresentationForms(unReversed);
      revertedCount++;
    }
    setState(prev => prev ? { ...prev, translations: newTranslations } : null);
    setApplyingArabic(false);
    setLastSaved(`↩️ تم التراجع عن المعالجة العربية لـ ${revertedCount} نص`);
    setTimeout(() => setLastSaved(""), 5000);
  };

  const handlePreBuild = async () => {
    const currentState = stateRef.current;
    if (!currentState) return;
    
    // Force-save before preview too
    if (forceSaveRef?.current) {
      await forceSaveRef.current();
    }

    const nonEmptyTranslations: Record<string, string> = {};
    for (const [k, v] of Object.entries(currentState.translations)) {
      if (v.trim()) nonEmptyTranslations[k] = v;
    }

    const protectedCount = Array.from(currentState.protectedEntries || []).filter(k => nonEmptyTranslations[k]).length;
    const normalCount = Object.keys(nonEmptyTranslations).length - protectedCount;

    // Category breakdown
    const categories: Record<string, number> = {};
    for (const key of Object.keys(nonEmptyTranslations)) {
      const parts = key.split(':')[0].split('/');
      const cat = parts.length > 1 ? parts[0] : 'Other';
      categories[cat] = (categories[cat] || 0) + 1;
    }

    // Compute warnings
    let overflowCount = 0;
    let unprocessedArabicCount = 0;
    const arabicRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
    const formsRegex = /[\uFB50-\uFDFF\uFE70-\uFEFF]/;

    for (const entry of currentState.entries) {
      const key = `${entry.msbtFile}:${entry.index}`;
      const trans = nonEmptyTranslations[key];
      if (!trans) continue;

      // Check byte overflow
      if (entry.maxBytes > 0) {
        const byteLen = new TextEncoder().encode(trans).length;
        if (byteLen > entry.maxBytes) overflowCount++;
      }

      // Check unprocessed Arabic
      if (arabicRegex.test(trans) && !formsRegex.test(trans)) {
        unprocessedArabicCount++;
      }
    }

    // Check if real files are loaded
    const bdatBinaryFileNames = await idbGet<string[]>("editorBdatBinaryFileNames");
    const hasBdatFiles = !!(bdatBinaryFileNames && bdatBinaryFileNames.length > 0);
    const isDemo = currentState.isDemo === true;

    // Count affected BDAT files
    let affectedFileCount = 0;
    if (hasBdatFiles && bdatBinaryFileNames) {
      for (const fileName of bdatBinaryFileNames) {
        const prefix = `bdat-bin:${fileName}:`;
        if (Object.keys(nonEmptyTranslations).some(k => k.startsWith(prefix))) {
          affectedFileCount++;
        }
      }
    }

    const sampleKeys = Object.keys(nonEmptyTranslations).slice(0, 10);

    console.log('[BUILD-PREVIEW] Total translations:', Object.keys(nonEmptyTranslations).length);
    console.log('[BUILD-PREVIEW] Overflow:', overflowCount, 'Unprocessed Arabic:', unprocessedArabicCount);
    console.log('[BUILD-PREVIEW] BDAT files:', affectedFileCount, 'isDemo:', isDemo);

    setBuildPreview({
      totalTranslations: Object.keys(nonEmptyTranslations).length,
      protectedCount,
      normalCount,
      categories,
      sampleKeys,
      overflowCount,
      unprocessedArabicCount,
      hasBdatFiles,
      isDemo,
      affectedFileCount,
    });
    setShowBuildConfirm(true);
  };

  const handleBuildXenoblade = async () => {
    const currentState = stateRef.current;
    if (!currentState) return;
    setShowBuildConfirm(false);
    if (forceSaveRef?.current) {
      await forceSaveRef.current();
    }
    setBuilding(true); setBuildProgress("تجهيز الترجمات...");
    try {
      const msbtFiles = await idbGet<Record<string, ArrayBuffer>>("editorMsbtFiles");
      const msbtFileNames = await idbGet<string[]>("editorMsbtFileNames");

      if (!msbtFiles || !msbtFileNames || msbtFileNames.length === 0) {
        setBuildProgress("❌ لا توجد ملفات MSBT. يرجى العودة لصفحة المعالجة وإعادة رفع الملفات.");
        setBuilding(false);
        return;
      }

      const activeMsbtFileSet = new Set(
        currentState.entries
          .map(entry => entry.msbtFile.match(/^msbt:([^:]+):/)?.[1])
          .filter((name): name is string => !!name)
      );
      const fileNamesToBuild = msbtFileNames.filter(name => activeMsbtFileSet.has(name));

      if (fileNamesToBuild.length === 0) {
        setBuildProgress("❌ لا توجد ملفات مطابقة لهذه الجلسة. أعد الاستخراج من صفحة الرفع.");
        setBuilding(false);
        return;
      }

      // Collect non-empty translations
      const nonEmptyTranslations: Record<string, string> = {};
      for (const [k, v] of Object.entries(currentState.translations)) {
        if (v.trim()) nonEmptyTranslations[k] = v;
      }

      // Auto Arabic processing before build
      let autoProcessedCount = 0;
      for (const [key, value] of Object.entries(nonEmptyTranslations)) {
        if (!value?.trim()) continue;
        if (hasArabicPresentationForms(value)) continue;
        if (!hasArabicCharsProcessing(value)) continue;
        nonEmptyTranslations[key] = processArabicText(value, { arabicNumerals, mirrorPunct: mirrorPunctuation });
        autoProcessedCount++;
      }
      if (autoProcessedCount > 0) {
        setBuildProgress(`✅ تمت معالجة ${autoProcessedCount} نص عربي تلقائياً...`);
        await new Promise(r => setTimeout(r, 500));
      }

      // Import MSBT parser + rebuilder
      const { parseMsbtFile, rebuildMsbt } = await import("@/lib/msbt-parser");

      // Rebuild each MSBT file locally with translations injected
      let modifiedCount = 0;
      const rebuiltMsbtFiles: Record<string, Uint8Array> = {};

      for (let fi = 0; fi < fileNamesToBuild.length; fi++) {
        const fileName = fileNamesToBuild[fi];
        const buf = msbtFiles[fileName];
        if (!buf) continue;
        setBuildProgress(`معالجة ${fi + 1}/${fileNamesToBuild.length}: ${fileName}...`);

        const msbt = parseMsbtFile(new Uint8Array(buf));

        // Build translations map: label → translated text
        // Editor keys are "msbt:filename:label:index" where index is the entry's position
        const translationsForFile: Record<string, string> = {};
        for (let ei = 0; ei < msbt.entries.length; ei++) {
          const entry = msbt.entries[ei];
          // The key format matches extractMsbtStrings: msbt:filename:label is msbtFile, index is position
          const key = `msbt:${fileName}:${entry.label}:${ei}`;
          const trans = nonEmptyTranslations[key];
          if (trans && trans.trim()) {
            translationsForFile[entry.label] = trans;
            modifiedCount++;
          }
        }

        if (Object.keys(translationsForFile).length > 0) {
          rebuiltMsbtFiles[fileName] = rebuildMsbt(msbt, translationsForFile);
        } else {
          // No translations for this file — keep original
          rebuiltMsbtFiles[fileName] = new Uint8Array(buf);
        }
      }

      // Now repack into SARC.ZS if archives exist
      type SarcMeta = {
        originalFileName: string;
        endian: "big" | "little";
        nonMsbtEntries: { name: string; data: number[] }[];
        msbtEntryNames: string[];
      };
      const sarcArchives = await idbGet<SarcMeta[]>("editorSarcArchives");
      const legacySingle = await idbGet<SarcMeta>("editorSarcArchive");
      const allArchives: SarcMeta[] = sarcArchives && sarcArchives.length > 0
        ? sarcArchives
        : (legacySingle && legacySingle.msbtEntryNames.length > 0 ? [legacySingle] : []);

      const fileNamesToBuildSet = new Set(fileNamesToBuild);
      const scopedArchives = allArchives.filter(archive =>
        archive.msbtEntryNames.some(msbtName => fileNamesToBuildSet.has(msbtName.replace(/.*[/\\]/, "")))
      );

      if (scopedArchives.length > 0) {
        const { buildSarcZs } = await import("@/lib/sarc-parser");

        if (scopedArchives.length === 1) {
          const sarcMeta = scopedArchives[0];
          setBuildProgress("إعادة بناء أرشيف SARC.ZS...");
          const sarcEntries: { name: string; data: Uint8Array }[] = [];
          for (const entry of sarcMeta.nonMsbtEntries) {
            sarcEntries.push({ name: entry.name, data: new Uint8Array(entry.data) });
          }
          for (const msbtName of sarcMeta.msbtEntryNames) {
            const shortName = msbtName.replace(/.*[/\\]/, '');
            if (rebuiltMsbtFiles[shortName]) {
              sarcEntries.push({ name: msbtName, data: rebuiltMsbtFiles[shortName] });
            } else if (msbtFiles[shortName]) {
              sarcEntries.push({ name: msbtName, data: new Uint8Array(msbtFiles[shortName]) });
            }
          }
          setBuildProgress(`تجميع ${sarcEntries.length} ملف في SARC وضغط ZS...`);
          const compressed = await buildSarcZs(sarcEntries, sarcMeta.endian);
          const sarcBlob = new Blob([new Uint8Array(compressed) as BlobPart], { type: "application/octet-stream" });
          const sarcUrl = URL.createObjectURL(sarcBlob);
          const a = document.createElement("a");
          a.href = sarcUrl;
          a.download = sarcMeta.originalFileName.replace(/\.zs$/i, '_arabized.zs').replace(/\.sarc$/i, '_arabized.sarc.zs');
          if (!a.download.includes('arabized')) a.download = `arabized_${sarcMeta.originalFileName}`;
          a.click();
          URL.revokeObjectURL(sarcUrl);
        } else {
          const JSZip = (await import("jszip")).default;
          const outputZip = new JSZip();
          for (let ai = 0; ai < scopedArchives.length; ai++) {
            const sarcMeta = scopedArchives[ai];
            setBuildProgress(`إعادة بناء ${ai + 1}/${scopedArchives.length}: ${sarcMeta.originalFileName}...`);
            const sarcEntries: { name: string; data: Uint8Array }[] = [];
            for (const entry of sarcMeta.nonMsbtEntries) {
              sarcEntries.push({ name: entry.name, data: new Uint8Array(entry.data) });
            }
            for (const msbtName of sarcMeta.msbtEntryNames) {
              const shortName = msbtName.replace(/.*[/\\]/, '');
              if (rebuiltMsbtFiles[shortName]) {
                sarcEntries.push({ name: msbtName, data: rebuiltMsbtFiles[shortName] });
              } else if (msbtFiles[shortName]) {
                sarcEntries.push({ name: msbtName, data: new Uint8Array(msbtFiles[shortName]) });
              }
            }
            const compressed = await buildSarcZs(sarcEntries, sarcMeta.endian);
            outputZip.file(sarcMeta.originalFileName, compressed);
          }
          setBuildProgress("ضغط جميع ملفات SARC.ZS في ZIP...");
          const finalBlob = await outputZip.generateAsync({ type: "blob" });
          const finalUrl = URL.createObjectURL(finalBlob);
          const a = document.createElement("a");
          a.href = finalUrl;
          a.download = "arabized_sarc_files.zip";
          a.click();
          URL.revokeObjectURL(finalUrl);
        }
        setBuildProgress(`✅ تم بنجاح! تم تعديل ${modifiedCount} نص — ${scopedArchives.length} ملف SARC.ZS جاهز للعبة 🎮`);
      } else {
        // No SARC archives — just export rebuilt MSBT files as ZIP
        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();
        for (const [name, data] of Object.entries(rebuiltMsbtFiles)) {
          zip.file(name, data);
        }
        const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "arabized_msbt_files.zip";
        a.click();
        URL.revokeObjectURL(url);
        setBuildProgress(`✅ تم بنجاح! تم تعديل ${modifiedCount} نص — الملفات في ملف ZIP`);
      }

      // Save translations snapshot
      try {
        const { idbSet } = await import("@/lib/idb-storage");
        const nonEmpty: Record<string, string> = {};
        for (const [k, v] of Object.entries(currentState.translations || {})) {
          if (v && (v as string).trim()) nonEmpty[k] = v as string;
        }
        if (Object.keys(nonEmpty).length > 0) {
          await idbSet("buildTranslations", nonEmpty);
        }
      } catch (e) {
        console.warn("Could not save build translations snapshot:", e);
      }

      setBuilding(false);
    } catch (err) {
      setBuildProgress(`❌ ${err instanceof Error ? err.message : 'خطأ غير معروف'}`);
      setBuilding(false);
    }
  };

  const handleCheckIntegrity = async () => {
    const currentState = stateRef.current;
    if (!currentState) return;
    setCheckingIntegrity(true);
    setShowIntegrityDialog(true);

    try {
      const { idbGet } = await import("@/lib/idb-storage");
      const bdatBinaryFiles = await idbGet<Record<string, ArrayBuffer>>("editorBdatBinaryFiles");
      const bdatBinaryFileNames = await idbGet<string[]>("editorBdatBinaryFileNames");

      // All translated (non-empty) keys
      const allTransKeys = Object.keys(currentState.translations).filter(k => currentState.translations[k]?.trim());
      // All entry keys (including untranslated) — used to count total extracted strings per file
      const allEntryKeys = currentState.entries
        ? currentState.entries.map(e => `${e.msbtFile}:${e.index}`)
        : Object.keys(currentState.translations);

      // Collect unique filenames from entry keys + translated keys
      const newFormatFiles = new Set<string>();
      const oldFormatFiles = new Set<string>();

      const collectFileNames = (keys: string[]) => {
        for (const key of keys) {
          if (key.startsWith('bdat-bin:')) {
            const parts = key.split(':');
            if (parts.length >= 2) newFormatFiles.add(parts[1]);
          } else if (key.startsWith('bdat:')) {
            const parts = key.split(':');
            if (parts.length >= 2) oldFormatFiles.add(parts[1]);
          }
        }
      };
      collectFileNames(allEntryKeys);
      collectFileNames(allTransKeys);

      const allFileNames = new Set([
        ...Array.from(newFormatFiles),
        ...Array.from(oldFormatFiles),
        ...(bdatBinaryFileNames || []),
      ]);

      const files: IntegrityCheckResult['files'] = [];
      let totalWillApply = 0;
      let totalOrphaned = 0;
      let hasLegacy = false;

      for (const fileName of Array.from(allFileNames)) {
        const fileExists = !!(bdatBinaryFiles && bdatBinaryFiles[fileName]);
        const isLegacyFormat = oldFormatFiles.has(fileName) && !newFormatFiles.has(fileName);
        if (isLegacyFormat) hasLegacy = true;

        const prefix = `bdat-bin:${fileName}:`;

        // Count translated (non-empty) for this file
        const matched = allTransKeys.filter(k => k.startsWith(prefix)).length;

        // Count total entries loaded for this file (translated + untranslated)
        const totalLoaded = allEntryKeys.filter(k => k.startsWith(prefix)).length;

        // Count orphaned old-format keys
        const oldPrefix = `bdat:${fileName}:`;
        const orphanedCount = (!fileExists && isLegacyFormat)
          ? allTransKeys.filter(k => k.startsWith(oldPrefix)).length
          : 0;

        // Total = from loaded entries; fallback to re-parsing IDB file
        let total = totalLoaded;
        if (total === 0) {
          total = 0;
        }

        files.push({ fileName, matched, total, orphaned: orphanedCount, isLegacyFormat, fileExists });

        if (fileExists && !isLegacyFormat) totalWillApply += matched;
        if (!fileExists || isLegacyFormat) totalOrphaned += isLegacyFormat
          ? allTransKeys.filter(k => k.startsWith(`bdat:${fileName}:`)).length
          : 0;
      }

      // Count MSBT/other translated entries too
      const msbtTranslated = allTransKeys.filter(k => !k.startsWith('bdat-bin:') && !k.startsWith('bdat:')).length;
      if (msbtTranslated > 0) totalWillApply += msbtTranslated;

      const isHealthy = files.length > 0
        && !hasLegacy
        && files.every(f => f.fileExists)
        && files.some(f => f.matched > 0);

      setIntegrityResult({
        files: files.sort((a, b) => b.matched - a.matched),
        willApply: totalWillApply,
        orphaned: totalOrphaned,
        hasLegacy,
        isHealthy,
      });
    } catch (e) {
      console.error('[INTEGRITY]', e);
      setIntegrityResult({ files: [], willApply: 0, orphaned: 0, hasLegacy: false, isHealthy: false });
    } finally {
      setCheckingIntegrity(false);
    }
  };

  const handleBuild = async () => {
    const currentState = stateRef.current;
    if (!currentState) return;
    setShowBuildConfirm(false);
    // Force-save before build
    if (forceSaveRef?.current) {
      await forceSaveRef.current();
    }
    const isXenoblade = gameType === "xenoblade";
    
    // Check if we have SARC archives (ACNH flow) — use Xenoblade-style individual MSBT build
    type SarcMetaCheck = {
      originalFileName: string;
      endian: "big" | "little";
      nonMsbtEntries: { name: string; data: number[] }[];
      msbtEntryNames: string[];
    };
    const sarcArchivesCheck = await idbGet<SarcMetaCheck[]>("editorSarcArchives");
    const hasMsbtEntries = currentState.entries.some(entry => entry.msbtFile.startsWith("msbt:"));
    const hasSarcArchives = !!(hasMsbtEntries && sarcArchivesCheck && sarcArchivesCheck.length > 0);
    
    if (isXenoblade || hasMsbtEntries || hasSarcArchives) {
      return handleBuildXenoblade();
    }
    
    const langBuf = await idbGet<ArrayBuffer>("editorLangFile");
    const dictBuf = await idbGet<ArrayBuffer>("editorDictFile");
    const langFileName = (await idbGet<string>("editorLangFileName")) || "output.zs";
    if (!langBuf) { setBuildProgress("❌ ملف اللغة غير موجود. يرجى العودة لصفحة المعالجة وإعادة رفع الملفات."); return; }
    setBuilding(true); setBuildProgress("تجهيز الترجمات...");
    try {
      const formData = new FormData();
      formData.append("langFile", new File([new Uint8Array(langBuf)], langFileName));
      if (dictBuf) formData.append("dictFile", new File([new Uint8Array(dictBuf)], (await idbGet<string>("editorDictFileName")) || "ZsDic.pack.zs"));
      const nonEmptyTranslations: Record<string, string> = {};
      for (const [k, v] of Object.entries(currentState.translations)) { if (v.trim()) nonEmptyTranslations[k] = v; }

      // Auto-fix damaged tags before build
      let tagFixCount = 0;
      let tagSkipCount = 0;
      let tagOkCount = 0;
      for (const entry of currentState.entries) {
        if (!hasTechnicalTags(entry.original)) continue;
        const key = `${entry.msbtFile}:${entry.index}`;
        const trans = nonEmptyTranslations[key];
        if (!trans) continue;
        const origTagCount = (entry.original.match(/[\uFFF9-\uFFFC\uE000-\uE0FF]/g) || []).length;
        const transTagCount = (trans.match(/[\uFFF9-\uFFFC\uE000-\uE0FF]/g) || []).length;
        if (transTagCount < origTagCount) {
          const fixed = restoreTagsLocally(entry.original, trans);
          nonEmptyTranslations[key] = fixed;
          tagFixCount++;
          // Log DoCommand/LayoutMsg entries for debugging
          if (entry.msbtFile.includes('DoCommand') || entry.msbtFile.includes('Pouch')) {
            const fixedTagCount = (fixed.match(/[\uFFF9-\uFFFC\uE000-\uE0FF]/g) || []).length;
            console.log(`[TAG-FIX] ${key}: orig=${origTagCount} tags, trans=${transTagCount} tags, fixed=${fixedTagCount} tags`);
            console.log(`[TAG-FIX] Original: ${[...entry.original.substring(0, 30)].map(c => c.charCodeAt(0).toString(16).padStart(4,'0')).join(' ')}`);
            console.log(`[TAG-FIX] Fixed: ${[...fixed.substring(0, 30)].map(c => c.charCodeAt(0).toString(16).padStart(4,'0')).join(' ')}`);
          }
        } else {
          tagOkCount++;
        }
      }
      console.log(`[BUILD-TAGS] Fixed: ${tagFixCount}, Already OK: ${tagOkCount}, Skipped(no tags): ${tagSkipCount}`);
      
      // Validate translations size
      const translationsJson = JSON.stringify(nonEmptyTranslations);
      const translationsSizeKB = Math.round(translationsJson.length / 1024);
      console.log(`[BUILD] Total translations being sent: ${Object.keys(nonEmptyTranslations).length}`);
      console.log(`[BUILD] Translations JSON size: ${translationsSizeKB} KB`);
      console.log('[BUILD] Protected entries:', Array.from(currentState.protectedEntries || []).length);
      console.log('[BUILD] Sample keys:', Object.keys(nonEmptyTranslations).slice(0, 10));
      
      if (translationsSizeKB > 5000) {
        console.warn(`[BUILD] ⚠️ Translations JSON is very large (${translationsSizeKB} KB). This may cause issues.`);
      }
      
      formData.append("translations", JSON.stringify(nonEmptyTranslations));
      formData.append("protectedEntries", JSON.stringify(Array.from(currentState.protectedEntries || [])));
      if (arabicNumerals) formData.append("arabicNumerals", "true");
      if (mirrorPunctuation) formData.append("mirrorPunctuation", "true");
      setBuildProgress("إرسال للمعالجة...");
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const response = await fetch(`${supabaseUrl}/functions/v1/arabize?mode=build`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${supabaseKey}`, 'apikey': supabaseKey },
        body: formData,
      });
      if (!response.ok) {
        const ct = response.headers.get('content-type') || '';
        if (ct.includes('json')) { const err = await response.json(); throw new Error(err.error || `خطأ ${response.status}`); }
        throw new Error(`خطأ ${response.status}`);
      }
      setBuildProgress("تحميل الملف...");
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const modifiedCount = parseInt(response.headers.get('X-Modified-Count') || '0');
      const expandedCount = parseInt(response.headers.get('X-Expanded-Count') || '0');
      const fileSize = parseInt(response.headers.get('X-File-Size') || '0');
      const compressedSize = response.headers.get('X-Compressed-Size');
      
      console.log('[BUILD] Response headers - Modified:', response.headers.get('X-Modified-Count'), 'Expanded:', response.headers.get('X-Expanded-Count'));

      // Check if we need to repack into SARC.ZS (multiple archives supported)
      type SarcMeta = {
        originalFileName: string;
        endian: "big" | "little";
        nonMsbtEntries: { name: string; data: number[] }[];
        msbtEntryNames: string[];
      };
      const sarcArchives = await idbGet<SarcMeta[]>("editorSarcArchives");
      // Fallback to legacy single archive
      const legacySingle = await idbGet<SarcMeta>("editorSarcArchive");
      const allArchives: SarcMeta[] = sarcArchives && sarcArchives.length > 0 
        ? sarcArchives 
        : (legacySingle && legacySingle.msbtEntryNames.length > 0 ? [legacySingle] : []);
      const activeMsbtFileSet = new Set(
        currentState.entries
          .map(entry => entry.msbtFile.match(/^msbt:([^:]+):/)?.[1])
          .filter((name): name is string => !!name)
      );
      const scopedArchives = allArchives.filter(archive =>
        archive.msbtEntryNames.some(msbtName => activeMsbtFileSet.has(msbtName.replace(/.*[/\\]/, "")))
      );

      if (scopedArchives.length > 0) {
        const JSZip = (await import("jszip")).default;
        const { buildSarcZs } = await import("@/lib/sarc-parser");
        const serverZip = await JSZip.loadAsync(blob);
        const msbtFilesFromIdb = await idbGet<Record<string, ArrayBuffer>>("editorMsbtFiles");

        if (allArchives.length === 1) {
          // Single SARC — download directly as .zs file
          const sarcMeta = allArchives[0];
          setBuildProgress("إعادة بناء أرشيف SARC.ZS...");
          const sarcEntries: { name: string; data: Uint8Array }[] = [];
          for (const entry of sarcMeta.nonMsbtEntries) {
            sarcEntries.push({ name: entry.name, data: new Uint8Array(entry.data) });
          }
          for (const msbtName of sarcMeta.msbtEntryNames) {
            const shortName = msbtName.replace(/.*[/\\]/, '');
            const zipFile = serverZip.file(shortName) || serverZip.file(msbtName);
            if (zipFile) {
              sarcEntries.push({ name: msbtName, data: await zipFile.async("uint8array") });
            } else if (msbtFilesFromIdb && msbtFilesFromIdb[shortName]) {
              sarcEntries.push({ name: msbtName, data: new Uint8Array(msbtFilesFromIdb[shortName]) });
            }
          }
          setBuildProgress(`تجميع ${sarcEntries.length} ملف في SARC وضغط ZS...`);
          const compressed = await buildSarcZs(sarcEntries, sarcMeta.endian);
          const sarcBlob = new Blob([new Uint8Array(compressed) as BlobPart], { type: "application/octet-stream" });
          const sarcUrl = URL.createObjectURL(sarcBlob);
          const a = document.createElement("a");
          a.href = sarcUrl;
          a.download = sarcMeta.originalFileName.replace(/\.zs$/i, '_arabized.zs').replace(/\.sarc$/i, '_arabized.sarc.zs');
          if (!a.download.includes('arabized')) a.download = `arabized_${sarcMeta.originalFileName}`;
          a.click();
          URL.revokeObjectURL(sarcUrl);
        } else {
          // Multiple SARC files — rebuild each and pack into a ZIP
          const outputZip = new JSZip();
          for (let ai = 0; ai < allArchives.length; ai++) {
            const sarcMeta = allArchives[ai];
            setBuildProgress(`إعادة بناء ${ai + 1}/${allArchives.length}: ${sarcMeta.originalFileName}...`);
            const sarcEntries: { name: string; data: Uint8Array }[] = [];
            for (const entry of sarcMeta.nonMsbtEntries) {
              sarcEntries.push({ name: entry.name, data: new Uint8Array(entry.data) });
            }
            for (const msbtName of sarcMeta.msbtEntryNames) {
              const shortName = msbtName.replace(/.*[/\\]/, '');
              const zipFile = serverZip.file(shortName) || serverZip.file(msbtName);
              if (zipFile) {
                sarcEntries.push({ name: msbtName, data: await zipFile.async("uint8array") });
              } else if (msbtFilesFromIdb && msbtFilesFromIdb[shortName]) {
                sarcEntries.push({ name: msbtName, data: new Uint8Array(msbtFilesFromIdb[shortName]) });
              }
            }
            const compressed = await buildSarcZs(sarcEntries, sarcMeta.endian);
            const outName = sarcMeta.originalFileName;
            outputZip.file(outName, compressed);
          }
          setBuildProgress("ضغط جميع ملفات SARC.ZS في ZIP...");
          const finalBlob = await outputZip.generateAsync({ type: "blob" });
          const finalUrl = URL.createObjectURL(finalBlob);
          const a = document.createElement("a");
          a.href = finalUrl;
          a.download = "arabized_sarc_files.zip";
          a.click();
          URL.revokeObjectURL(finalUrl);
        }
        const expandedMsg = expandedCount > 0 ? ` (${expandedCount} تم توسيعها 📐)` : '';
        setBuildProgress(`✅ تم بنجاح! تم تعديل ${modifiedCount} نص${expandedMsg} — ${allArchives.length} ملف SARC.ZS جاهز للعبة 🎮`);
      } else {
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = `arabized_${langFileName}`;
        a.click();
        const expandedMsg = expandedCount > 0 ? ` (${expandedCount} تم توسيعها 📐)` : '';
        setBuildProgress(`✅ تم بنجاح! تم تعديل ${modifiedCount} نص${expandedMsg}`);
      }
      
      let buildStatsData: BuildStats | null = null;
      try { buildStatsData = JSON.parse(decodeURIComponent(response.headers.get('X-Build-Stats') || '{}')); } catch {}
      setBuildStats({
        modifiedCount,
        expandedCount,
        fileSize,
        compressedSize: compressedSize ? parseInt(compressedSize) : undefined,
        avgBytePercent: buildStatsData?.avgBytePercent || 0,
        maxBytePercent: buildStatsData?.maxBytePercent || 0,
        longest: buildStatsData?.longest || null,
        shortest: buildStatsData?.shortest || null,
        categories: buildStatsData?.categories || {},
      });
      setBuilding(false);
    } catch (err) {
      setBuildProgress(`❌ ${err instanceof Error ? err.message : 'خطأ غير معروف'}`);
      setBuilding(false);
    }
  };

  const dismissBuildProgress = () => { setBuildProgress(""); };

  return {
    building,
    buildProgress,
    dismissBuildProgress,
    applyingArabic,
    buildStats,
    setBuildStats,
    buildPreview,
    showBuildConfirm,
    setShowBuildConfirm,
    bdatFileStats,
    integrityResult,
    showIntegrityDialog,
    setShowIntegrityDialog,
    checkingIntegrity,
    handleApplyArabicProcessing,
    handleUndoArabicProcessing,
    handlePreBuild,
    handleBuild,
    handleCheckIntegrity,
  };
}

