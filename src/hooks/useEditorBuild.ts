import { useState, useRef, useEffect } from "react";
import type { IntegrityCheckResult } from "@/components/editor/IntegrityCheckDialog";
import { idbGet } from "@/lib/idb-storage";
import { processArabicText, hasArabicChars as hasArabicCharsProcessing, hasArabicPresentationForms, removeArabicPresentationForms, reverseBidi } from "@/lib/arabic-processing";
import { EditorState, hasTechnicalTags, restoreTagsLocally } from "@/components/editor/types";
import { BuildPreview, BundleDiagnostic, MsbtFileDiagnostic } from "@/components/editor/BuildConfirmDialog";
import type { BuildVerificationResult, VerificationCheck } from "@/components/editor/BuildVerificationDialog";
import type { MutableRefObject } from "react";
import { normalizeMsbtTranslations, extractShortMsbtName } from "@/lib/msbt-key-normalizer";
import { sanitizeTranslations } from "@/lib/sanitize-translations";
import { validateBundle, validateSarcMsbts } from "@/lib/bundle-validator";
import { utf16leByteLength } from "@/lib/byte-utils";

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
  const [buildVerification, setBuildVerification] = useState<BuildVerificationResult | null>(null);
  const [showBuildVerification, setShowBuildVerification] = useState(false);
  const [lastBuildLog, setLastBuildLog] = useState<string[]>([]);
  const [autoTrimMsbt, setAutoTrimMsbt] = useState(() => {
    try { return localStorage.getItem('autoTrimMsbt') === 'true'; } catch { return false; }
  });
  const toggleAutoTrimMsbt = (v: boolean) => {
    setAutoTrimMsbt(v);
    try { localStorage.setItem('autoTrimMsbt', v ? 'true' : 'false'); } catch {}
  };

  const handleApplyArabicProcessing = () => {
    const currentState = stateRef.current;
    if (!currentState) return;
    setApplyingArabic(true);
    const newTranslations = { ...sanitizeTranslations(currentState.translations, 'applyArabic') };
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
    const newTranslations = { ...sanitizeTranslations(currentState.translations, 'undoArabic') };
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

  const buildVerificationChecks = (params: {
    modifiedCount: number;
    totalTranslations: number;
    autoProcessedArabic: number;
    tagFixCount: number;
    tagOkCount: number;
    filesBuilt: number;
    outputSizeBytes: number;
    originalSizeBytes?: number;
    buildStartTime: number;
    skippedOverflow?: number;
    hasOriginalFiles: boolean;
    isDemo?: boolean;
  }): BuildVerificationResult => {
    const checks: VerificationCheck[] = [];
    const elapsed = Date.now() - params.buildStartTime;

    // 1. Translation injection
    if (params.modifiedCount === 0) {
      checks.push({ label: "حقن الترجمات", status: "fail", detail: "لم تُحقن أي ترجمة في الملفات!" });
    } else if (params.modifiedCount < params.totalTranslations * 0.5) {
      checks.push({ label: "حقن الترجمات", status: "warn", detail: `تم حقن ${params.modifiedCount} من ${params.totalTranslations} — أقل من 50%` });
    } else {
      checks.push({ label: "حقن الترجمات", status: "pass", detail: `${params.modifiedCount} ترجمة حُقنت بنجاح` });
    }

    // 2. Arabic processing
    if (params.autoProcessedArabic > 0) {
      checks.push({ label: "المعالجة العربية", status: "pass", detail: `${params.autoProcessedArabic} نص عُولج تلقائياً أثناء البناء` });
    } else {
      checks.push({ label: "المعالجة العربية", status: "pass", detail: "كل النصوص كانت معالجة مسبقاً" });
    }

    // 3. Tag integrity
    if (params.tagFixCount > 0) {
      checks.push({ label: "سلامة الرموز التقنية", status: "warn", detail: `${params.tagFixCount} ترجمة أُصلحت رموزها تلقائياً (${params.tagOkCount} سليمة)` });
    } else if (params.tagOkCount > 0) {
      checks.push({ label: "سلامة الرموز التقنية", status: "pass", detail: `${params.tagOkCount} ترجمة — كل الرموز سليمة ✨` });
    }

    // 4. File output
    if (params.filesBuilt === 0) {
      checks.push({ label: "ملفات الإخراج", status: "fail", detail: "لم يُنتج أي ملف!" });
    } else {
      checks.push({ label: "ملفات الإخراج", status: "pass", detail: `${params.filesBuilt} ملف مبني بنجاح` });
    }

    // 5. Size check
    if (params.originalSizeBytes && params.originalSizeBytes > 0) {
      const ratio = params.outputSizeBytes / params.originalSizeBytes;
      if (ratio > 1.5) {
        checks.push({ label: "حجم الملف", status: "warn", detail: `الناتج أكبر بـ ${Math.round(ratio * 100 - 100)}% من الأصلي — تحقق من الضغط` });
      } else if (ratio < 0.3) {
        checks.push({ label: "حجم الملف", status: "warn", detail: `الناتج أصغر بكثير (${Math.round(ratio * 100)}%) — قد تكون بيانات ناقصة` });
      } else {
        checks.push({ label: "حجم الملف", status: "pass", detail: `الحجم مناسب (${Math.round(ratio * 100)}% من الأصلي)` });
      }
    }

    // 6. Overflow skipped
    if (params.skippedOverflow && params.skippedOverflow > 0) {
      checks.push({ label: "تجاوز البايت", status: "warn", detail: `${params.skippedOverflow} ترجمة تُخطّيت بسبب تجاوز الحد` });
    }

    // 7. Original files
    if (!params.hasOriginalFiles) {
      checks.push({ label: "الملفات الأصلية", status: "warn", detail: "لم يتم العثور على ملفات أصلية — البناء من الذاكرة" });
    }

    // 8. Demo check
    if (params.isDemo) {
      checks.push({ label: "نوع البيانات", status: "fail", detail: "بيانات تجريبية — الملف لن يعمل في اللعبة" });
    }

    return {
      checks,
      outputSizeBytes: params.outputSizeBytes,
      originalSizeBytes: params.originalSizeBytes,
      translationsApplied: params.modifiedCount,
      translationsExpected: params.totalTranslations,
      autoProcessedArabic: params.autoProcessedArabic,
      tagsFixed: params.tagFixCount,
      tagsOk: params.tagOkCount,
      filesBuilt: params.filesBuilt,
      buildDurationMs: elapsed,
    };
  };

  type EditorEntry = EditorState["entries"][number];

  const extractMsbtFileName = (msbtFile: string): string | null => {
    if (!msbtFile.startsWith("msbt:")) return null;
    const payload = msbtFile.slice(5);
    const match = payload.match(/^(.+?\.msbt)(?::|$)/i);
    if (match?.[1]) return match[1];
    const firstColon = payload.indexOf(":");
    return firstColon === -1 ? payload : payload.slice(0, firstColon);
  };

  const buildEntryLookupMaps = (entries: EditorEntry[]) => {
    const validEntryKeySet = new Set<string>();
    const entriesByMsbtName = new Map<string, EditorEntry[]>();
    const keyByMsbtNameAndIndex = new Map<string, Map<number, string>>();

    for (const entry of entries) {
      const key = `${entry.msbtFile}:${entry.index}`;
      validEntryKeySet.add(key);

      const msbtName = extractMsbtFileName(entry.msbtFile);
      if (!msbtName) continue;

      const list = entriesByMsbtName.get(msbtName) ?? [];
      list.push(entry);
      entriesByMsbtName.set(msbtName, list);

      const indexMap = keyByMsbtNameAndIndex.get(msbtName) ?? new Map<number, string>();
      if (!indexMap.has(entry.index)) {
        indexMap.set(entry.index, key);
      }
      keyByMsbtNameAndIndex.set(msbtName, indexMap);
    }

    return { validEntryKeySet, entriesByMsbtName, keyByMsbtNameAndIndex };
  };

  const resolveEntriesForLookup = (entriesByMsbtName: Map<string, EditorEntry[]>, lookupName: string): EditorEntry[] => {
    const exact = entriesByMsbtName.get(lookupName);
    if (exact) return exact;

    for (const [msbtName, list] of entriesByMsbtName.entries()) {
      if (msbtName.endsWith(`__${lookupName}`) || msbtName.endsWith(lookupName)) {
        return list;
      }
    }

    return [];
  };

  const normalizeTranslationsForBuild = (
    translations: Record<string, string>,
    validEntryKeySet: Set<string>,
    _keyByMsbtNameAndIndex: Map<string, Map<number, string>>,
  ) => {
    // Use central normalizer for MSBT keys
    const result = normalizeMsbtTranslations(translations, validEntryKeySet);
    return {
      normalized: result.normalized,
      remapped: result.remapped,
      dropped: result.dropped + result.ambiguous,
    };
  };

  const handlePreBuild = async () => {
    const currentState = stateRef.current;
    if (!currentState) return;

    // Force-save before preview too
    if (forceSaveRef?.current) {
      await forceSaveRef.current();
    }

    const { validEntryKeySet, entriesByMsbtName, keyByMsbtNameAndIndex } = buildEntryLookupMaps(currentState.entries);
    const { normalized: nonEmptyTranslations, remapped, dropped } = normalizeTranslationsForBuild(
      sanitizeTranslations(currentState.translations, 'preBuild'),
      validEntryKeySet,
      keyByMsbtNameAndIndex,
    );

    if (remapped > 0 || dropped > 0) {
      console.log(`[BUILD-PREVIEW] Normalized translations: remapped=${remapped}, dropped=${dropped}`);
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

    // Build bundle diagnostics
    const bundleDiagnostics: BundleDiagnostic[] = [];
    const bundleMeta = await idbGet<any[]>("editorBundleMeta");
    const sarcArchives = await idbGet<any[]>("editorSarcArchives");

    if (bundleMeta && bundleMeta.length > 0) {
      for (const meta of bundleMeta) {
        const msbtFilesInfo: BundleDiagnostic['msbtFiles'] = [];
        let totalKeys = 0;
        let matchedTranslations = 0;

        const scopedMap: Record<string, string> = meta.scopedMsbtByAssetKey || {};
        for (const asset of (meta.assets || [])) {
          const pathId = typeof asset.pathId === 'bigint' ? asset.pathId.toString() : String(asset.pathId ?? asset.entryIndex ?? '0');
          const assetKey = `${asset.name}#${pathId}`;
          const lookupName = scopedMap[assetKey] || (asset.name.endsWith('.msbt') ? asset.name : `${asset.name}.msbt`);

          // Count entries for this MSBT from state
          const entriesForFile = resolveEntriesForLookup(entriesByMsbtName, lookupName);
          const keys = entriesForFile.length;
          const translated = entriesForFile.filter(e => {
            const k = `${e.msbtFile}:${e.index}`;
            return !!nonEmptyTranslations[k];
          }).length;

          if (keys > 0) {
            msbtFilesInfo.push({ name: asset.name || lookupName, keys, translated });
            totalKeys += keys;
            matchedTranslations += translated;
          }
        }

        bundleDiagnostics.push({
          bundleName: meta.originalFileName || 'Unknown Bundle',
          totalKeys,
          matchedTranslations,
          msbtFiles: msbtFilesInfo.sort((a, b) => b.keys - a.keys),
        });
      }
    } else if (sarcArchives && sarcArchives.length > 0) {
      for (const archive of sarcArchives) {
        const msbtFilesInfo: BundleDiagnostic['msbtFiles'] = [];
        let totalKeys = 0;
        let matchedTranslations = 0;

        for (const msbtName of (archive.msbtEntryNames || [])) {
          const shortName = msbtName.replace(/.*[/\\]/, '');
          const scoped = archive.scopedMsbtNames?.find((s: any) => s.entryName === msbtName)?.extractedName || shortName;
          const entriesForFile = resolveEntriesForLookup(entriesByMsbtName, scoped);
          const keys = entriesForFile.length;
          const translated = entriesForFile.filter(e => {
            const k = `${e.msbtFile}:${e.index}`;
            return !!nonEmptyTranslations[k];
          }).length;

          if (keys > 0) {
            msbtFilesInfo.push({ name: shortName, keys, translated });
            totalKeys += keys;
            matchedTranslations += translated;
          }
        }

        bundleDiagnostics.push({
          bundleName: archive.originalFileName || 'Unknown SARC',
          totalKeys,
          matchedTranslations,
          msbtFiles: msbtFilesInfo.sort((a, b) => b.keys - a.keys),
        });
      }
    }

    console.log('[BUILD-PREVIEW] Total translations:', Object.keys(nonEmptyTranslations).length);
    console.log('[BUILD-PREVIEW] Bundle diagnostics:', bundleDiagnostics);

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
      bundleDiagnostics: bundleDiagnostics.length > 0 ? bundleDiagnostics : undefined,
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
    const buildStartTime = Date.now();
    const buildLog: string[] = [];
    const log = (msg: string) => { console.log(msg); buildLog.push(`${((Date.now() - buildStartTime) / 1000).toFixed(2)}s ${msg}`); };

    setBuilding(true); setBuildProgress("تجهيز الترجمات...");
    try {
      log('[BUILD] ═══ بدء عملية البناء ═══');
      log(`[BUILD] نوع اللعبة: ${gameType || 'غير محدد'}`);
      log(`[BUILD] عدد المدخلات: ${currentState.entries.length}`);
      log(`[BUILD] عدد الترجمات: ${Object.keys(currentState.translations || {}).length}`);
      log(`[BUILD] translations type: ${typeof currentState.translations}`);

      const msbtFiles = await idbGet<Record<string, ArrayBuffer>>("editorMsbtFiles");
      const msbtFileNames = await idbGet<string[]>("editorMsbtFileNames");
      const extractionSessionId = await idbGet<string>("extractionSessionId");

      log(`[BUILD] Session ID: ${extractionSessionId}`);
      log(`[BUILD] MSBT files in IDB: ${msbtFileNames?.length ?? 0}`);
      log(`[BUILD] MSBT file keys in buffer map: ${msbtFiles ? Object.keys(msbtFiles).length : 0}`);

      if (!msbtFiles || !msbtFileNames || msbtFileNames.length === 0) {
        log('[BUILD] ❌ لا توجد ملفات MSBT');
        setBuildProgress("❌ لا توجد ملفات MSBT. يرجى العودة لصفحة المعالجة وإعادة رفع الملفات.");
        setBuilding(false);
        return;
      }

      const { validEntryKeySet, entriesByMsbtName, keyByMsbtNameAndIndex } = buildEntryLookupMaps(currentState.entries);
      const activeMsbtFileSet = new Set<string>(entriesByMsbtName.keys());
      
      log(`[BUILD] validEntryKeySet size: ${validEntryKeySet.size}`);
      log(`[BUILD] entriesByMsbtName size: ${entriesByMsbtName.size}`);
      log(`[BUILD] keyByMsbtNameAndIndex size: ${keyByMsbtNameAndIndex.size}`);

      // Match against stored file names — try exact match first, then fallback to contains
      let fileNamesToBuild = Array.from(new Set(msbtFileNames.filter(name => activeMsbtFileSet.has(name))));
      
      // Fallback: if no exact matches, try matching stored names against active set more loosely
      if (fileNamesToBuild.length === 0 && activeMsbtFileSet.size > 0) {
        log('[BUILD] ⚠️ No exact match — using fallback');
        log(`[BUILD] activeMsbtFileSet sample: ${[...activeMsbtFileSet].slice(0, 3).join(', ')}`);
        log(`[BUILD] msbtFileNames sample: ${msbtFileNames.slice(0, 3).join(', ')}`);
        fileNamesToBuild = [...msbtFileNames];
      }

      log(`[BUILD] Active MSBT files from entries: ${activeMsbtFileSet.size}`);
      log(`[BUILD] Files to build: ${fileNamesToBuild.length}`);

      if (fileNamesToBuild.length === 0) {
        log('[BUILD] ❌ لا توجد ملفات مطابقة');
        setBuildProgress("❌ لا توجد ملفات مطابقة لهذه الجلسة. أعد الاستخراج من صفحة الرفع.");
        setBuilding(false);
        return;
      }

      // Defensive: ensure translations is an object — auto-heal if corrupted
      if (!currentState.translations || typeof currentState.translations !== 'object' || Array.isArray(currentState.translations)) {
        log(`[BUILD] ⚠️ translations was ${typeof currentState.translations} — auto-healing to {}`);
        (currentState as any).translations = {};
      }

      const rawNonEmptyTranslationsCount = Object.values(currentState.translations as Record<string, unknown>)
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0).length;

      const { normalized: nonEmptyTranslations, remapped, dropped } = normalizeTranslationsForBuild(
        currentState.translations,
        validEntryKeySet,
        keyByMsbtNameAndIndex,
      );

      const buildableTranslationsCount = Object.keys(nonEmptyTranslations).filter(key => validEntryKeySet.has(key)).length;

      log(`[BUILD] Normalized: ${Object.keys(nonEmptyTranslations).length} total, buildable=${buildableTranslationsCount}, remapped=${remapped}, dropped=${dropped}`);
      log(`[BUILD] Raw non-empty translations in state: ${rawNonEmptyTranslationsCount}`);

      if (rawNonEmptyTranslationsCount > 0 && buildableTranslationsCount === 0) {
        log('[BUILD] ❌ لا توجد مفاتيح ترجمة مطابقة للمدخلات الحالية — تم إيقاف البناء');
        setLastBuildLog([...buildLog]);
        setBuildVerification({
          checks: [
            { label: "مطابقة المفاتيح", status: "fail", detail: `تم العثور على ${rawNonEmptyTranslationsCount} ترجمة محفوظة لكن ولا مفتاح واحد مطابق للملفات الحالية.` },
            { label: "سبب محتمل", status: "warn", detail: "ملف JSON بصيغة مفاتيح قديمة (مثل file.msbt:0) أو مشروع/استخراج مختلف." },
            { label: "الحل", status: "warn", detail: "أعد تصدير/استيراد الترجمات من نفس جلسة الاستخراج الحالية ثم أعد البناء." },
          ],
          outputSizeBytes: 0,
          translationsApplied: 0,
          translationsExpected: rawNonEmptyTranslationsCount,
          autoProcessedArabic: 0,
          tagsFixed: 0,
          tagsOk: 0,
          filesBuilt: 0,
          buildDurationMs: Date.now() - buildStartTime,
        });
        setShowBuildVerification(true);
        setBuildProgress("❌ لا توجد ترجمات مطابقة للجلسة الحالية");
        setBuilding(false);
        return;
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
        log(`[BUILD] Arabic auto-processed: ${autoProcessedCount}`);
        setBuildProgress(`✅ تمت معالجة ${autoProcessedCount} نص عربي تلقائياً...`);
        await new Promise(r => setTimeout(r, 500));
      }

      // Auto-fix tags before MSBT rebuild
      let tagFixCount = 0;
      let tagOkCount = 0;
      for (const entry of currentState.entries) {
        if (!hasTechnicalTags(entry.original)) continue;
        const key = `${entry.msbtFile}:${entry.index}`;
        const trans = nonEmptyTranslations[key];
        if (!trans?.trim()) continue;
        const origTagCount = (entry.original.match(/[\uFFF9-\uFFFC\uE000-\uE0FF]/g) || []).length;
        const transTagCount = (trans.match(/[\uFFF9-\uFFFC\uE000-\uE0FF]/g) || []).length;
        if (transTagCount < origTagCount) {
          nonEmptyTranslations[key] = restoreTagsLocally(entry.original, trans);
          tagFixCount++;
        } else {
          tagOkCount++;
        }
      }
      log(`[BUILD] Tags — fixed: ${tagFixCount}, OK: ${tagOkCount}`);

      // Import MSBT parser + rebuilder
      const { parseMsbtFile, rebuildMsbt } = await import("@/lib/msbt-parser");

      // Rebuild each MSBT file locally with translations injected
      let modifiedCount = 0;
      let matchedTranslationCount = 0;
      let unchangedTranslationCount = 0;
      const rebuiltMsbtFiles: Record<string, Uint8Array> = {};
      let filesWithNoMatch = 0;
      let totalMsbtEntries = 0;
      let filesExpectedButNoMatch = 0;
      const fileMatchStats = new Map<string, {
        expected: number;
        matched: number;
        unchanged: number;
        effectiveExpected: number;
        applied: number;
        total: number;
      }>();

      for (let fi = 0; fi < fileNamesToBuild.length; fi++) {
        const fileName = fileNamesToBuild[fi];
        const buf = msbtFiles[fileName];
        if (!buf) {
          log(`[BUILD] ⚠️ ${fileName}: buffer not found in IDB`);
          continue;
        }
        setBuildProgress(`معالجة ${fi + 1}/${fileNamesToBuild.length}: ${fileName}...`);

        const msbt = parseMsbtFile(new Uint8Array(buf));
        totalMsbtEntries += msbt.entries.length;

        // Build translations map: label → translated text
        const translationsForFile: Record<string, string> = {};
        let indexMap = keyByMsbtNameAndIndex.get(fileName);
        // Fallback: try matching by short MSBT name if scoped name didn't match
        if (!indexMap) {
          const shortName = extractShortMsbtName(`msbt:${fileName}`);
          if (shortName && shortName !== fileName) {
            for (const [k, v] of keyByMsbtNameAndIndex.entries()) {
              const kShort = extractShortMsbtName(`msbt:${k}`);
              if (kShort === shortName) {
                indexMap = v;
                log(`[BUILD] Fallback match: ${fileName} → ${k}`);
                break;
              }
            }
          }
        }

        let expectedForFile = 0;
        if (indexMap) {
          for (const canonicalKey of indexMap.values()) {
            if (nonEmptyTranslations[canonicalKey]?.trim()) expectedForFile++;
          }
        }

        let matchedForFile = 0;
        let unchangedForFile = 0;

        for (let ei = 0; ei < msbt.entries.length; ei++) {
          const entry = msbt.entries[ei];
          const canonicalKey = indexMap?.get(ei) || `msbt:${fileName}:${entry.label}:${ei}`;
          const trans = nonEmptyTranslations[canonicalKey];
          if (!trans || !trans.trim()) continue;

          matchedTranslationCount++;
          matchedForFile++;

          const sourceText = entry.text?.trim() || "";
          const translatedText = trans.trim();
          if (translatedText === sourceText) {
            unchangedTranslationCount++;
            unchangedForFile++;
            continue;
          }

          translationsForFile[entry.label] = trans;
          modifiedCount++;
        }

        const applied = Object.keys(translationsForFile).length;
        const effectiveExpectedForFile = Math.max(0, matchedForFile - unchangedForFile);

        fileMatchStats.set(fileName, {
          expected: expectedForFile,
          matched: matchedForFile,
          unchanged: unchangedForFile,
          effectiveExpected: effectiveExpectedForFile,
          applied,
          total: msbt.entries.length,
        });

        if (applied === 0) {
          filesWithNoMatch++;

          const noIndexMatch = expectedForFile > 0 && matchedForFile === 0;
          const hadEffectiveDiffButNoApply = effectiveExpectedForFile > 0 && applied === 0;

          if (noIndexMatch || hadEffectiveDiffButNoApply) {
            filesExpectedButNoMatch++;
            log(`[BUILD] ❌ ${fileName}: expected=${expectedForFile}, matched=${matchedForFile}, unchanged=${unchangedForFile}, applied=${applied}`);
          } else if (expectedForFile > 0 && effectiveExpectedForFile === 0) {
            log(`[BUILD] ℹ️ ${fileName}: جميع الترجمات المطابقة مطابقة للنص الأصلي (unchanged=${unchangedForFile})`);
          } else {
            log(`[BUILD] ℹ️ ${fileName}: 0/${msbt.entries.length} translations matched (لا توجد ترجمات مخصصة لهذا الملف)`);
          }
        }

        if (applied > 0) {
          const rebuiltData = rebuildMsbt(msbt, translationsForFile);
          rebuiltMsbtFiles[fileName] = rebuiltData;
          log(`[BUILD] ✅ Rebuilt: ${fileName} (${rebuiltData.byteLength} bytes, ${applied} entries)`);
        }
        // Files with no translations are NOT added — they stay untouched in the original bundle
      }

      log(`[BUILD] ═══ MSBT rebuild complete ═══`);
      log(`[BUILD] Matched translations (non-empty): ${matchedTranslationCount}`);
      log(`[BUILD] Unchanged translations (same as source): ${unchangedTranslationCount}`);
      log(`[BUILD] Effective modified entries: ${modifiedCount}`);
      log(`[BUILD] Total MSBT entries parsed: ${totalMsbtEntries}`);
      log(`[BUILD] Files with no matches: ${filesWithNoMatch}/${fileNamesToBuild.length}`);
      log(`[BUILD] Files expected to match but got 0: ${filesExpectedButNoMatch}`);
      log(`[BUILD] Rebuilt files: ${Object.keys(rebuiltMsbtFiles).length}`);
      // Diagnostic: list all rebuilt keys
      log(`[BUILD] ═══ rebuiltMsbtFiles keys ═══`);
      for (const key of Object.keys(rebuiltMsbtFiles)) {
        log(`[BUILD]   📄 ${key} (${rebuiltMsbtFiles[key].byteLength} bytes)`);
      }

      // === STRICT POLICY: fail only when we truly had unresolved effective translations ===
      const criticalUnmatchedFiles = Array.from(fileMatchStats.entries())
        .filter(([, stats]) => {
          const noIndexMatch = stats.expected > 0 && stats.matched === 0;
          const effectiveNotApplied = stats.effectiveExpected > 0 && stats.applied === 0;
          return noIndexMatch || effectiveNotApplied;
        })
        .map(([fileName]) => fileName);

      if (criticalUnmatchedFiles.length > 0) {
        log(`[BUILD] ❌ STRICT POLICY: ${criticalUnmatchedFiles.length} files expected translations but got 0% match — BUILD ABORTED`);
        for (const f of criticalUnmatchedFiles) log(`[BUILD]   ⛔ ${f}`);
        setLastBuildLog([...buildLog]);
        const failChecks: VerificationCheck[] = [
          { label: "سياسة المطابقة الصارمة", status: "fail", detail: `${criticalUnmatchedFiles.length} ملف كان يجب أن يستقبل ترجمات لكنه خرج 0% مطابقة — البناء مرفوض` },
          ...criticalUnmatchedFiles.slice(0, 10).map(f => ({ label: f, status: "fail" as const, detail: "متوقع وجود ترجمات لكن لم تُحقن أي ترجمة" })),
        ];
        if (criticalUnmatchedFiles.length > 10) {
          failChecks.push({ label: "ملفات أخرى", status: "fail", detail: `و ${criticalUnmatchedFiles.length - 10} ملف آخر بنفس المشكلة` });
        }
        setBuildVerification({
          checks: failChecks,
          outputSizeBytes: 0,
          translationsApplied: modifiedCount,
          translationsExpected: buildableTranslationsCount,
          autoProcessedArabic: autoProcessedCount,
          tagsFixed: tagFixCount,
          tagsOk: tagOkCount,
          filesBuilt: 0,
          buildDurationMs: Date.now() - buildStartTime,
        });
        setShowBuildVerification(true);
        setBuildProgress("❌ فشل البناء — خلل مطابقة في ملفات مستهدفة");
        setBuilding(false);
        return;
      }

      // Defensive strict policy: if we had buildable keys but no effective byte-level text changes, abort.
      if (buildableTranslationsCount > 0 && modifiedCount === 0) {
        log('[BUILD] ❌ STRICT POLICY: buildable keys exist but effective modifications = 0 — BUILD ABORTED');
        setLastBuildLog([...buildLog]);
        setBuildVerification({
          checks: [
            { label: "تعديلات فعلية", status: "fail", detail: "تم العثور على مفاتيح مطابقة لكن جميع النصوص مطابقة للأصل (لا يوجد فرق فعلي للبناء)." },
            { label: "سبب محتمل", status: "warn", detail: "تم استيراد نصوص إنجليزية كما هي، أو ملف ترجمة غير مُعبّأ فعلياً." },
            { label: "الحل", status: "warn", detail: "تأكد أن القيم المترجمة تختلف فعلاً عن النص الأصلي ثم أعد البناء." },
          ],
          outputSizeBytes: 0,
          translationsApplied: 0,
          translationsExpected: buildableTranslationsCount,
          autoProcessedArabic: autoProcessedCount,
          tagsFixed: tagFixCount,
          tagsOk: tagOkCount,
          filesBuilt: 0,
          buildDurationMs: Date.now() - buildStartTime,
        });
        setShowBuildVerification(true);
        setBuildProgress("❌ فشل البناء — لا توجد تعديلات فعلية داخل النصوص");
        setBuilding(false);
        return;
      }

      // Now repack into SARC.ZS if archives exist
      type SarcMeta = {
        originalFileName: string;
        endian: "big" | "little";
        nonMsbtEntries: { name: string; data: number[] }[];
        msbtEntryNames: string[];
        scopedMsbtNames?: { entryName: string; extractedName: string }[];
      };
      const sarcArchives = await idbGet<SarcMeta[]>("editorSarcArchives");
      const legacySingle = await idbGet<SarcMeta>("editorSarcArchive");
      const allArchives: SarcMeta[] = sarcArchives && sarcArchives.length > 0
        ? sarcArchives
        : (legacySingle && legacySingle.msbtEntryNames.length > 0 ? [legacySingle] : []);

      const fileNamesToBuildSet = new Set(fileNamesToBuild);
      const scopedArchives = allArchives.filter((archive) => {
        const scopedNames = archive.scopedMsbtNames?.map(item => item.extractedName) ?? [];
        if (scopedNames.length > 0) {
          return scopedNames.some(name => fileNamesToBuildSet.has(name));
        }
        return archive.msbtEntryNames.some(msbtName => fileNamesToBuildSet.has(msbtName.replace(/.*[/\\]/, "")));
      });

      const resolveSarcLookupName = (sarcMeta: SarcMeta, msbtName: string): string => {
        const scoped = sarcMeta.scopedMsbtNames?.find(item => item.entryName === msbtName)?.extractedName;
        return scoped || msbtName.replace(/.*[/\\]/, '');
      };

      /** Resolve rebuilt MSBT data by trying multiple name formats */
      const findRebuiltMsbt = (lookupName: string): Uint8Array | undefined => {
        // 1. Exact match (most common — scoped name matches directly)
        if (rebuiltMsbtFiles[lookupName]) return rebuiltMsbtFiles[lookupName];
        
        // 2. Try matching by short name — but ONLY if exactly one rebuilt file shares that short name
        const shortName = extractShortMsbtName(`msbt:${lookupName}`);
        if (shortName) {
          const candidates: string[] = [];
          for (const key of Object.keys(rebuiltMsbtFiles)) {
            const keyShort = extractShortMsbtName(`msbt:${key}`);
            if (keyShort === shortName) candidates.push(key);
          }
          if (candidates.length === 1) {
            return rebuiltMsbtFiles[candidates[0]];
          }
          // If multiple candidates share the same short name, skip — ambiguous match
        }
        return undefined;
      };

      const makeAssetReplacementKey = (asset: any) => {
        const pathId = typeof asset.pathId === 'bigint'
          ? asset.pathId.toString()
          : String(asset.pathId ?? asset.entryIndex ?? '0');
        return `${asset.name}#${pathId}`;
      };

      const resolveBundleLookupName = (meta: any, asset: any) => {
        const key = makeAssetReplacementKey(asset);
        const scoped = meta?.scopedMsbtByAssetKey?.[key];
        if (scoped) return scoped;
        return asset.name.endsWith('.msbt') ? asset.name : `${asset.name}.msbt`;
      };

      // Check for Unity bundle meta (Fire Emblem flow)
      const bundleMeta = await idbGet<any[]>("editorBundleMeta");
      log(`[BUILD] Bundle meta: ${bundleMeta ? `${bundleMeta.length} bundles` : 'NONE'}`);
      log(`[BUILD] SARC archives: ${allArchives.length > 0 ? `${allArchives.length} archives` : 'NONE'}`);

      if (bundleMeta && bundleMeta.length > 0) {
        // === BUNDLE REPACK FLOW ===
        log(`[BUILD] ═══ Bundle repack flow ═══`);
        const { repackBundle, isMsbt } = await import("@/lib/unity-asset-bundle");
        const JSZip = (await import("jszip")).default;

        if (bundleMeta.length === 1) {
          const meta = bundleMeta[0];
          setBuildProgress("إعادة بناء Bundle...");
          log(`[BUILD] Single bundle: ${meta.originalFileName}, assets: ${meta.assets?.length}`);

          const originalBuffer = meta.originalBuffer instanceof ArrayBuffer ? meta.originalBuffer : new Uint8Array(meta.originalBuffer).buffer;
          const decompressedData = meta.decompressedData instanceof ArrayBuffer ? new Uint8Array(meta.decompressedData) : new Uint8Array(meta.decompressedData);
          const replacements = new Map<string, Uint8Array>();

          for (const asset of meta.assets) {
            const assetData = asset.data instanceof Uint8Array ? asset.data : new Uint8Array(asset.data);
            if (!isMsbt(assetData)) continue;
            const lookupName = resolveBundleLookupName(meta, asset);
            const rebuiltData = findRebuiltMsbt(lookupName);
            log(`[BUILD] 🔍 Bundle lookup: "${lookupName}" → ${rebuiltData ? `✅ found (${rebuiltData.byteLength}b)` : '❌ NOT found'}`);
            if (rebuiltData) {
              replacements.set(makeAssetReplacementKey(asset), rebuiltData);
            }
          }

          log(`[BUILD] Bundle repack requested: ${replacements.size} MSBT replacements`);
          let result: { buffer: ArrayBuffer; replacedCount: number; newSize: number; originalSize: number };
          try {
            result = repackBundle(originalBuffer, meta.info, decompressedData, meta.assets, replacements);
          } catch (repackErr: any) {
            log(`[BUILD] ❌ repackBundle threw: ${repackErr?.message || repackErr}`);
            setLastBuildLog([...buildLog]);
            setBuildVerification({
              checks: [
                { label: "خطأ في إعادة البناء", status: "fail", detail: repackErr?.message || String(repackErr) },
                { label: "سبب محتمل", status: "warn", detail: "بنية الملف الثنائية تالفة أو غير مدعومة — جرّب إعادة رفع الملفات الأصلية." },
              ],
              outputSizeBytes: 0,
              originalSizeBytes: originalBuffer.byteLength,
              translationsApplied: modifiedCount,
              translationsExpected: buildableTranslationsCount,
              autoProcessedArabic: autoProcessedCount,
              tagsFixed: tagFixCount,
              tagsOk: tagOkCount,
              filesBuilt: 0,
              buildDurationMs: Date.now() - buildStartTime,
            });
            setShowBuildVerification(true);
            setBuildProgress("❌ " + (repackErr?.message || "خطأ أثناء إعادة بناء الـBundle"));
            setBuilding(false);
            return;
          }
          log(`[BUILD] Bundle effective replacements: ${result.replacedCount}`);
          log(`[BUILD] Bundle output size: ${result.buffer.byteLength} bytes (original: ${originalBuffer.byteLength})`);

          if (replacements.size > 0 && result.replacedCount === 0) {
            log('[BUILD] ❌ Bundle had replacement candidates but produced 0 effective byte changes — BUILD ABORTED');
            setLastBuildLog([...buildLog]);
            setBuildVerification({
              checks: [
                { label: "حقن الترجمات", status: "fail", detail: "تم تجهيز بدائل للملف لكن لم يُسجل أي تغيير فعلي داخل البايتات." },
                { label: "سبب محتمل", status: "warn", detail: "النصوص المستوردة مطابقة للأصل، أو حصل عدم تطابق بين الأصول والمفاتيح." },
              ],
              outputSizeBytes: 0,
              originalSizeBytes: originalBuffer.byteLength,
              translationsApplied: 0,
              translationsExpected: buildableTranslationsCount,
              autoProcessedArabic: autoProcessedCount,
              tagsFixed: tagFixCount,
              tagsOk: tagOkCount,
              filesBuilt: 0,
              buildDurationMs: Date.now() - buildStartTime,
            });
            setShowBuildVerification(true);
            setBuildProgress("❌ فشل البناء — لا توجد تغييرات فعلية في الـBundle");
            setBuilding(false);
            return;
          }

          // === BINARY VALIDATION before download ===
          setBuildProgress("فحص ثنائي للملف الناتج...");
          const binaryValidation = validateBundle(result.buffer);
          for (const c of binaryValidation.checks) {
            log(`[BUILD] [BINARY] ${c.status === 'pass' ? '✅' : c.status === 'warn' ? '⚠️' : '❌'} ${c.label}: ${c.detail}`);
          }
          if (binaryValidation.hasCritical) {
            log('[BUILD] ❌ BINARY VALIDATION FAILED — download blocked');
            setLastBuildLog([...buildLog]);
            const failChecks: VerificationCheck[] = binaryValidation.checks.map(c => ({
              label: c.label, status: c.status, detail: c.detail,
            }));
            setBuildVerification({
              checks: failChecks,
              outputSizeBytes: result.buffer.byteLength,
              originalSizeBytes: originalBuffer.byteLength,
              translationsApplied: modifiedCount,
              translationsExpected: buildableTranslationsCount,
              autoProcessedArabic: autoProcessedCount,
              tagsFixed: tagFixCount, tagsOk: tagOkCount,
              filesBuilt: 0,
              buildDurationMs: Date.now() - buildStartTime,
            });
            setShowBuildVerification(true);
            setBuildProgress("❌ فشل الفحص الثنائي — التنزيل ممنوع");
            setBuilding(false);
            return;
          }

          const blob = new Blob([new Uint8Array(result.buffer)], { type: "application/octet-stream" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = meta.originalFileName.replace(/\.(bytes\.)?bundle$/i, '_arabized.bytes.bundle');
          a.click();
          URL.revokeObjectURL(url);
          setBuildProgress(`✅ تم بنجاح! تم تعديل ${modifiedCount} نص — ${result.replacedCount} أصل فعلي تم استبداله داخل الـBundle 🎮`);
        } else {
          const outputZip = new JSZip();
          let bundlesRepacked = 0;
          let bundlesUntouched = 0;
          let totalEffectiveBundleReplacements = 0;
          for (let bi = 0; bi < bundleMeta.length; bi++) {
            const meta = bundleMeta[bi];
            setBuildProgress(`إعادة بناء Bundle ${bi + 1}/${bundleMeta.length}: ${meta.originalFileName}...`);
            log(`[BUILD] Bundle ${bi + 1}/${bundleMeta.length}: ${meta.originalFileName}`);

            const originalBuffer = meta.originalBuffer instanceof ArrayBuffer ? meta.originalBuffer : new Uint8Array(meta.originalBuffer).buffer;
            const decompressedData = meta.decompressedData instanceof ArrayBuffer ? new Uint8Array(meta.decompressedData) : new Uint8Array(meta.decompressedData);
            const replacements = new Map<string, Uint8Array>();

            for (const asset of meta.assets) {
              const assetData = asset.data instanceof Uint8Array ? asset.data : new Uint8Array(asset.data);
              if (!isMsbt(assetData)) continue;
              const lookupName = resolveBundleLookupName(meta, asset);
              const rebuiltData = findRebuiltMsbt(lookupName);
              if (rebuiltData) {
                replacements.set(makeAssetReplacementKey(asset), rebuiltData);
              }
            }

            if (replacements.size > 0) {
              log(`[BUILD] 🔧 Bundle ${meta.originalFileName}: ${replacements.size} replacements requested`);
              try {
                const result = repackBundle(originalBuffer, meta.info, decompressedData, meta.assets, replacements);
                if (result.replacedCount > 0) {
                  log(`[BUILD] ✅ Bundle ${meta.originalFileName}: effective replacements=${result.replacedCount} → REPACK`);
                  outputZip.file(meta.originalFileName, new Uint8Array(result.buffer));
                  bundlesRepacked++;
                  totalEffectiveBundleReplacements += result.replacedCount;
                } else {
                  log(`[BUILD] ⚠️ Bundle ${meta.originalFileName}: candidates exist but effective replacements=0 → ORIGINAL`);
                  outputZip.file(meta.originalFileName, new Uint8Array(originalBuffer));
                  bundlesUntouched++;
                }
              } catch (repackErr: any) {
                log(`[BUILD] ❌ Bundle ${meta.originalFileName}: repack error: ${repackErr?.message || repackErr} → ORIGINAL`);
                outputZip.file(meta.originalFileName, new Uint8Array(originalBuffer));
                bundlesUntouched++;
              }
            } else {
              log(`[BUILD] ✅ Bundle ${meta.originalFileName}: no changes → ORIGINAL`);
              outputZip.file(meta.originalFileName, new Uint8Array(originalBuffer));
              bundlesUntouched++;
            }
          }

          log(`[BUILD] ═══ Bundle Diagnostic Summary ═══`);
          log(`[BUILD] 📊 Total: ${bundleMeta.length} | Repacked: ${bundlesRepacked} | Untouched: ${bundlesUntouched}`);
          log(`[BUILD] 📊 Rebuilt MSBT files: ${Object.keys(rebuiltMsbtFiles).length}`);
          log(`[BUILD] 📊 Effective binary replacements: ${totalEffectiveBundleReplacements}`);

          if (modifiedCount > 0 && totalEffectiveBundleReplacements === 0) {
            log('[BUILD] ❌ STRICT POLICY: translations detected but no effective binary replacements in any bundle — BUILD ABORTED');
            setLastBuildLog([...buildLog]);
            setBuildVerification({
              checks: [
                { label: "حقن فعلي داخل Bundle", status: "fail", detail: "تم رصد ترجمات في الجلسة لكن الناتج النهائي لم يحتوِ أي استبدال فعلي داخل الملفات الثنائية." },
                { label: "سبب محتمل", status: "warn", detail: "الترجمات مطابقة للأصل أو حدث عدم تطابق بين مفاتيح MSBT والأصول داخل الـBundle." },
              ],
              outputSizeBytes: 0,
              originalSizeBytes: 0,
              translationsApplied: modifiedCount,
              translationsExpected: buildableTranslationsCount,
              autoProcessedArabic: autoProcessedCount,
              tagsFixed: tagFixCount,
              tagsOk: tagOkCount,
              filesBuilt: 0,
              buildDurationMs: Date.now() - buildStartTime,
            });
            setShowBuildVerification(true);
            setBuildProgress("❌ فشل البناء — لا توجد تعديلات فعلية داخل ملفات الـBundle");
            setBuilding(false);
            return;
          }

          setBuildProgress("ضغط جميع ملفات Bundle في ZIP...");
          const finalBlob = await outputZip.generateAsync({ type: "blob" });
          const finalUrl = URL.createObjectURL(finalBlob);
          const a = document.createElement("a");
          a.href = finalUrl;
          a.download = "arabized_bundles.zip";
          a.click();
          URL.revokeObjectURL(finalUrl);
          setBuildProgress(`✅ تم بنجاح! تم تعديل ${modifiedCount} نص — ${bundlesRepacked} ملف أُعيد بناؤه، ${bundlesUntouched} بقي أصلياً 🎮`);
        }
      } else if (scopedArchives.length > 0) {
        log(`[BUILD] ═══ SARC repack flow (${scopedArchives.length} archives) ═══`);
        const { buildSarcZs } = await import("@/lib/sarc-parser");

        if (scopedArchives.length === 1) {
          const sarcMeta = scopedArchives[0];
          setBuildProgress("إعادة بناء أرشيف SARC.ZS...");
          log(`[BUILD] Single SARC: ${sarcMeta.originalFileName}, MSBT entries: ${sarcMeta.msbtEntryNames.length}, non-MSBT: ${sarcMeta.nonMsbtEntries.length}`);
          const sarcEntries: { name: string; data: Uint8Array }[] = [];
          for (const entry of sarcMeta.nonMsbtEntries) {
            sarcEntries.push({ name: entry.name, data: new Uint8Array(entry.data) });
          }
          let sarcMatched = 0, sarcMissed = 0;
          for (const msbtName of sarcMeta.msbtEntryNames) {
            const lookupName = resolveSarcLookupName(sarcMeta, msbtName);
            const fallbackLegacyName = msbtName.replace(/.*[/\\]/, '');
            const rebuiltData = findRebuiltMsbt(lookupName);
            log(`[BUILD] 🔍 SARC lookup: entry="${msbtName}" → lookup="${lookupName}" → ${rebuiltData ? `✅ found (${rebuiltData.byteLength}b)` : '❌ NOT found'}`);
            if (rebuiltData) {
              sarcEntries.push({ name: msbtName, data: rebuiltData });
              sarcMatched++;
            } else if (msbtFiles[lookupName]) {
              sarcEntries.push({ name: msbtName, data: new Uint8Array(msbtFiles[lookupName]) });
              log(`[BUILD]   ↪ fell back to original msbtFiles["${lookupName}"]`);
              sarcMissed++;
            } else if (msbtFiles[fallbackLegacyName]) {
              sarcEntries.push({ name: msbtName, data: new Uint8Array(msbtFiles[fallbackLegacyName]) });
              log(`[BUILD]   ↪ fell back to legacy msbtFiles["${fallbackLegacyName}"]`);
              sarcMissed++;
            } else {
              log(`[BUILD]   ↪ ⚠️ MISSING entirely (not in rebuilt or original)`);
              sarcMissed++;
            }
          }
          log(`[BUILD] SARC entries: ${sarcEntries.length} total, ${sarcMatched} rebuilt, ${sarcMissed} original/missing`);
          setBuildProgress(`تجميع ${sarcEntries.length} ملف في SARC وضغط ZS...`);
          const compressed = await buildSarcZs(sarcEntries, sarcMeta.endian);
          log(`[BUILD] SARC.ZS output: ${compressed.byteLength} bytes`);

          // === BINARY VALIDATION for SARC before download ===
          setBuildProgress("فحص ثنائي لملفات MSBT في SARC...");
          const sarcMsbtBuffers = sarcEntries.filter(e => e.name.endsWith('.msbt')).map(e => e.data);
          const sarcValidation = validateSarcMsbts(sarcMsbtBuffers);
          for (const c of sarcValidation.checks) {
            log(`[BUILD] [SARC-BINARY] ${c.status === 'pass' ? '✅' : c.status === 'warn' ? '⚠️' : '❌'} ${c.label}: ${c.detail}`);
          }
          if (sarcValidation.hasCritical) {
            log('[BUILD] ❌ SARC BINARY VALIDATION FAILED — download blocked');
            setLastBuildLog([...buildLog]);
            const failChecks: VerificationCheck[] = sarcValidation.checks.map(c => ({
              label: c.label, status: c.status, detail: c.detail,
            }));
            setBuildVerification({
              checks: failChecks,
              outputSizeBytes: compressed.byteLength,
              originalSizeBytes: 0,
              translationsApplied: modifiedCount,
              translationsExpected: buildableTranslationsCount,
              autoProcessedArabic: autoProcessedCount,
              tagsFixed: tagFixCount, tagsOk: tagOkCount,
              filesBuilt: 0,
              buildDurationMs: Date.now() - buildStartTime,
            });
            setShowBuildVerification(true);
            setBuildProgress("❌ فشل الفحص الثنائي لأرشيف SARC — التنزيل ممنوع");
            setBuilding(false);
            return;
          }

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
            log(`[BUILD] SARC ${ai + 1}/${scopedArchives.length}: ${sarcMeta.originalFileName}`);
            const sarcEntries: { name: string; data: Uint8Array }[] = [];
            for (const entry of sarcMeta.nonMsbtEntries) {
              sarcEntries.push({ name: entry.name, data: new Uint8Array(entry.data) });
            }
            for (const msbtName of sarcMeta.msbtEntryNames) {
              const lookupName = resolveSarcLookupName(sarcMeta, msbtName);
              const fallbackLegacyName = msbtName.replace(/.*[/\\]/, '');
              const rebuiltData = findRebuiltMsbt(lookupName);
              if (rebuiltData) {
                sarcEntries.push({ name: msbtName, data: rebuiltData });
              } else if (msbtFiles[lookupName]) {
                sarcEntries.push({ name: msbtName, data: new Uint8Array(msbtFiles[lookupName]) });
              } else if (msbtFiles[fallbackLegacyName]) {
                sarcEntries.push({ name: msbtName, data: new Uint8Array(msbtFiles[fallbackLegacyName]) });
              }
            }
            const compressed = await buildSarcZs(sarcEntries, sarcMeta.endian);

            // Validate MSBT files in this SARC
            const msbtBuffers = sarcEntries.filter(e => e.name.endsWith('.msbt')).map(e => e.data);
            const sarcVal = validateSarcMsbts(msbtBuffers);
            for (const c of sarcVal.checks) {
              log(`[BUILD] [SARC-BINARY ${ai + 1}] ${c.status === 'pass' ? '✅' : c.status === 'warn' ? '⚠️' : '❌'} ${c.label}: ${c.detail}`);
            }
            if (sarcVal.hasCritical) {
              log(`[BUILD] ❌ SARC ${sarcMeta.originalFileName} BINARY VALIDATION FAILED — download blocked`);
              setLastBuildLog([...buildLog]);
              setBuildVerification({
                checks: sarcVal.checks.map(c => ({ label: c.label, status: c.status, detail: c.detail })),
                outputSizeBytes: compressed.byteLength,
                originalSizeBytes: 0,
                translationsApplied: modifiedCount,
                translationsExpected: buildableTranslationsCount,
                autoProcessedArabic: autoProcessedCount,
                tagsFixed: tagFixCount, tagsOk: tagOkCount,
                filesBuilt: 0,
                buildDurationMs: Date.now() - buildStartTime,
              });
              setShowBuildVerification(true);
              setBuildProgress(`❌ فشل الفحص الثنائي لـ ${sarcMeta.originalFileName}`);
              setBuilding(false);
              return;
            }

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
        // No SARC archives or bundles — just export rebuilt MSBT files as ZIP
        log('[BUILD] ═══ Plain MSBT ZIP export ═══');
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

      // Calculate output metrics for verification
      let outputSizeBytes = 0;
      let originalSizeBytes = 0;
      let filesBuilt = 0;

      if (bundleMeta && bundleMeta.length > 0) {
        filesBuilt = bundleMeta.length;
        for (const meta of bundleMeta) {
          const origBuf = meta.originalBuffer instanceof ArrayBuffer ? meta.originalBuffer : new Uint8Array(meta.originalBuffer).buffer;
          originalSizeBytes += origBuf.byteLength;
        }
        for (const data of Object.values(rebuiltMsbtFiles)) {
          outputSizeBytes += data.byteLength;
        }
      } else if (scopedArchives.length > 0) {
        filesBuilt = scopedArchives.length;
        for (const data of Object.values(rebuiltMsbtFiles)) {
          outputSizeBytes += data.byteLength;
        }
      } else {
        filesBuilt = Object.keys(rebuiltMsbtFiles).length;
        for (const data of Object.values(rebuiltMsbtFiles)) {
          outputSizeBytes += data.byteLength;
        }
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

      const buildDuration = ((Date.now() - buildStartTime) / 1000).toFixed(1);
      log(`[BUILD] ═══ اكتمل البناء في ${buildDuration} ثانية ═══`);
      log(`[BUILD] Output: ${filesBuilt} files, ${outputSizeBytes} bytes`);
      if (originalSizeBytes > 0) log(`[BUILD] Original: ${originalSizeBytes} bytes, ratio: ${(outputSizeBytes / originalSizeBytes * 100).toFixed(0)}%`);

      // Store build log for debugging + expose to UI
      setLastBuildLog([...buildLog]);
      try {
        const { idbSet } = await import("@/lib/idb-storage");
        await idbSet("lastBuildLog", buildLog);
      } catch {}

      // Run post-build verification
      const verification = buildVerificationChecks({
        modifiedCount,
        totalTranslations: buildableTranslationsCount,
        autoProcessedArabic: autoProcessedCount,
        tagFixCount,
        tagOkCount,
        filesBuilt,
        outputSizeBytes,
        originalSizeBytes: originalSizeBytes > 0 ? originalSizeBytes : undefined,
        buildStartTime,
        hasOriginalFiles: !!(msbtFiles && Object.keys(msbtFiles).length > 0),
        isDemo: currentState.isDemo,
      });
      setBuildVerification(verification);
      setShowBuildVerification(true);

      setBuilding(false);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'خطأ غير معروف';
      const errStack = err instanceof Error ? err.stack : '';
      console.error('[BUILD] ❌ Build failed:', err);
      console.error('[BUILD] Stack:', errStack);
      console.log('[BUILD] Log up to failure:', buildLog.join('\n'));
      // Store error log + expose to UI
      buildLog.push(`❌ ERROR: ${errMsg}`);
      if (errStack) buildLog.push(`STACK: ${errStack}`);
      setLastBuildLog([...buildLog]);
      try {
        const { idbSet } = await import("@/lib/idb-storage");
        await idbSet("lastBuildLog", buildLog);
      } catch {}
      setBuildProgress(`❌ ${errMsg}`);
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
      const safeTranslationsMap = sanitizeTranslations(currentState.translations, 'integrity');
      const allTransKeys = Object.keys(safeTranslationsMap).filter(k => safeTranslationsMap[k]?.trim());
      // All entry keys (including untranslated) — used to count total extracted strings per file
      const allEntryKeys = currentState.entries
        ? currentState.entries.map(e => `${e.msbtFile}:${e.index}`)
        : Object.keys(safeTranslationsMap);

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
  const [showCobaltBuildChoice, setShowCobaltBuildChoice] = useState(false);
  const cobaltStateRef = useRef<EditorState | null>(null);

  const handleBuildCobalt = async (currentState: EditorState) => {
    cobaltStateRef.current = currentState;
    setShowCobaltBuildChoice(true);
  };

  const handleBuildCobaltAs = async (mode: "txt" | "msbt") => {
    const currentState = cobaltStateRef.current;
    if (!currentState) return;
    setShowCobaltBuildChoice(false);
    setBuilding(true);
    setBuildProgress(mode === "txt" ? "جارٍ بناء ملفات TXT معربة..." : "جارٍ بناء ملفات MSBT...");

    try {
      type CobaltEntry = { label: string; text: string };
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();

      // Build translation lookup: cobalt:fileName:label -> translated text
      const translationsByFileLabel = new Map<string, Map<string, string>>();
      for (const entry of currentState.entries) {
        if (!entry.msbtFile.startsWith("cobalt:")) continue;
        const parts = entry.msbtFile.split(":");
        const fileName = parts[1];
        const label = parts[2];
        const key = `${entry.msbtFile}:${entry.index}`;
        const translated = currentState.translations[key]?.trim();
        if (!translated || translated === entry.original) continue; // skip unchanged
        if (!translationsByFileLabel.has(fileName)) translationsByFileLabel.set(fileName, new Map());
        translationsByFileLabel.get(fileName)!.set(label, translated);
      }

      let builtCount = 0;
      let trimmedCount = 0;

      if (mode === "txt") {
        // Try to load raw file data for structure-preserving rebuild
        const rawFiles = await idbGet<{ name: string; rawLines: string[]; hasLabels: boolean; entries: { label: string; text: string; lineIndex: number; lineCount: number }[] }[]>("cobaltRawFiles");

        if (rawFiles && rawFiles.length > 0) {
          // Structure-preserving rebuild: replace only translated text lines
          for (const rawFile of rawFiles) {
            const fileTrans = translationsByFileLabel.get(rawFile.name);
            if (!fileTrans || fileTrans.size === 0) continue; // skip unmodified files

            const outputLines = [...rawFile.rawLines];

            if (rawFile.hasLabels) {
              // For label-based files: replace text lines after each label
              for (const entry of rawFile.entries) {
                const translation = fileTrans.get(entry.label);
                if (!translation) continue;
                const translatedLines = translation.split("\n");
                // Replace exactly the lines that belong to this entry
                for (let i = 0; i < entry.lineCount; i++) {
                  const lineIdx = entry.lineIndex + i;
                  if (lineIdx < outputLines.length) {
                    outputLines[lineIdx] = i < translatedLines.length ? translatedLines[i] : "";
                  }
                }
                // If translation has more lines than original, we DON'T add extra lines (preserve line count)
              }
            } else {
              // For plain text files: replace each entry's line
              for (const entry of rawFile.entries) {
                const translation = fileTrans.get(entry.label);
                if (!translation) continue;
                if (entry.lineIndex < outputLines.length) {
                  outputLines[entry.lineIndex] = translation;
                }
              }
            }

            zip.file(`${rawFile.name}.txt`, outputLines.join("\n"));
            builtCount++;
          }
        } else {
          // Fallback: no raw data, rebuild from entries (legacy behavior)
          const groups = new Map<string, CobaltEntry[]>();
          for (const entry of currentState.entries) {
            if (!entry.msbtFile.startsWith("cobalt:")) continue;
            const parts = entry.msbtFile.split(":");
            const fileName = parts[1];
            const label = parts[2];
            const key = `${entry.msbtFile}:${entry.index}`;
            const translated = currentState.translations[key]?.trim();
            if (!translated || translated === entry.original) continue; // skip unchanged
            if (!groups.has(fileName)) groups.set(fileName, []);
            groups.get(fileName)!.push({ label, text: translated });
          }
          for (const [fileName, entries] of groups) {
            if (entries.length === 0) continue;
            const hasRealLabels = entries.some(e => !e.label.startsWith("Line_"));
            let content: string;
            if (hasRealLabels) {
              content = entries.map(e => `[${e.label}]\n${e.text}`).join("\n\n");
            } else {
              content = entries.map(e => e.text).join("\n");
            }
            zip.file(`${fileName}.txt`, content);
            builtCount++;
          }
        }
      } else {
        // Build MSBT binary files
        // Step 1: Collect ALL entries per file, marking which have translations
        const allEntriesByFile = new Map<string, { label: string; text: string; originalText: string; hasTranslation: boolean }[]>();
        const filesWithTranslations = new Set<string>();

        for (const entry of currentState.entries) {
          if (!entry.msbtFile.startsWith("cobalt:")) continue;
          const parts = entry.msbtFile.split(":");
          const fileName = parts[1];
          const label = parts[2];
          const key = `${entry.msbtFile}:${entry.index}`;
          const translated = currentState.translations[key]?.trim();
          const hasTranslation = !!translated && translated !== entry.original;

          if (hasTranslation) filesWithTranslations.add(fileName);

          if (!allEntriesByFile.has(fileName)) allEntriesByFile.set(fileName, []);
          allEntriesByFile.get(fileName)!.push({
            label,
            text: hasTranslation ? translated : entry.original,
            originalText: entry.original,
            hasTranslation,
          });
        }

        // Auto-trim: if enabled, trim translated texts that exceed original UTF-16 byte length
        // Auto-trim reuses the outer trimmedCount
        if (autoTrimMsbt) {
          for (const [, entries] of allEntriesByFile) {
            for (const entry of entries) {
              if (!entry.hasTranslation) continue;
              const maxChars = entry.originalText.length;
              if (entry.text.length > maxChars && maxChars > 0) {
                let trimmed = entry.text.slice(0, maxChars);
                const lastSpace = trimmed.lastIndexOf(' ');
                if (lastSpace > maxChars * 0.7) {
                  trimmed = trimmed.slice(0, lastSpace);
                }
                entry.text = trimmed;
                trimmedCount++;
              }
            }
          }
        }

        const { buildMsbtFromEntries } = await import("@/lib/msbt-parser");
        const msgFolder = zip.folder("romfs/Data/StreamingAssets/aa/Switch/fe_assets_message");
        for (const [fileName, entries] of allEntriesByFile) {
          // Only build files that have at least one translation
          if (!filesWithTranslations.has(fileName)) continue;
          if (entries.length === 0) continue;
          const msbtBytes = buildMsbtFromEntries(entries.map(e => ({ label: e.label, text: e.text })));
          msgFolder!.file(`${fileName}/${fileName}.msbt`, msbtBytes);
          builtCount++;
        }
      }

      if (builtCount === 0) {
        setBuildProgress("❌ لا توجد ملفات للبناء");
        setBuilding(false);
        return;
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = mode === "txt" ? "cobalt-translated-txt.zip" : "cobalt-msbt-mod.zip";
      a.click();
      URL.revokeObjectURL(url);

      const typeLabel = mode === "txt" ? "TXT" : "MSBT";
      const trimMsg = trimmedCount > 0 ? ` (تم تقليص ${trimmedCount} نص)` : "";
      setBuildProgress(`✅ تم بناء ${builtCount} ملف ${typeLabel} بنجاح!${trimMsg}`);
      setBuildStats({
        modifiedCount: builtCount,
        expandedCount: 0,
        fileSize: blob.size,
        avgBytePercent: 0,
        maxBytePercent: 0,
        longest: null,
        shortest: null,
        categories: {},
      });
    } catch (err) {
      setBuildProgress(`❌ خطأ في البناء: ${err}`);
    } finally {
      setBuilding(false);
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
    const hasCobaltEntries = currentState.entries.some(entry => entry.msbtFile.startsWith("cobalt:"));
    const hasSarcArchives = !!(hasMsbtEntries && sarcArchivesCheck && sarcArchivesCheck.length > 0);
    
    if (hasCobaltEntries) {
      return handleBuildCobalt(currentState);
    }
    
    if (isXenoblade || hasMsbtEntries || hasSarcArchives) {
      return handleBuildXenoblade();
    }
    
    const langBuf = await idbGet<ArrayBuffer>("editorLangFile");
    const dictBuf = await idbGet<ArrayBuffer>("editorDictFile");
    const langFileName = (await idbGet<string>("editorLangFileName")) || "output.zs";
    if (!langBuf) { setBuildProgress("❌ ملف اللغة غير موجود. يرجى العودة لصفحة المعالجة وإعادة رفع الملفات."); return; }
    const buildStartTime = Date.now();
    setBuilding(true); setBuildProgress("تجهيز الترجمات...");
    try {
      const formData = new FormData();
      formData.append("langFile", new File([new Uint8Array(langBuf)], langFileName));
      if (dictBuf) formData.append("dictFile", new File([new Uint8Array(dictBuf)], (await idbGet<string>("editorDictFileName")) || "ZsDic.pack.zs"));
      const nonEmptyTranslations: Record<string, string> = {};
      const safeTranslations = sanitizeTranslations(currentState.translations, 'serverBuild');
      for (const [k, v] of Object.entries(safeTranslations)) { if (v.trim()) nonEmptyTranslations[k] = v; }

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

        if (scopedArchives.length === 1) {
          // Single SARC — download directly as .zs file
          const sarcMeta = scopedArchives[0];
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
          for (let ai = 0; ai < scopedArchives.length; ai++) {
            const sarcMeta = scopedArchives[ai];
            setBuildProgress(`إعادة بناء ${ai + 1}/${scopedArchives.length}: ${sarcMeta.originalFileName}...`);
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
        setBuildProgress(`✅ تم بنجاح! تم تعديل ${modifiedCount} نص${expandedMsg} — ${scopedArchives.length} ملف SARC.ZS جاهز للعبة 🎮`);
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

      // Run post-build verification for server-side build
      const serverVerification = buildVerificationChecks({
        modifiedCount,
        totalTranslations: Object.keys(nonEmptyTranslations).length,
        autoProcessedArabic: 0, // server handles Arabic processing
        tagFixCount,
        tagOkCount: tagOkCount,
        filesBuilt: scopedArchives.length > 0 ? scopedArchives.length : 1,
        outputSizeBytes: fileSize || blob.size,
        buildStartTime,
        hasOriginalFiles: true,
        isDemo: currentState.isDemo,
      });
      setBuildVerification(serverVerification);
      setShowBuildVerification(true);

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
    buildVerification,
    showBuildVerification,
    setShowBuildVerification,
    lastBuildLog,
    showCobaltBuildChoice,
    setShowCobaltBuildChoice,
    handleBuildCobaltAs,
    autoTrimMsbt,
    toggleAutoTrimMsbt,
  };
}

