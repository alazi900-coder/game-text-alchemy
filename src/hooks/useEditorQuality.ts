import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { hasArabicPresentationForms } from "@/lib/arabic-processing";
import { ExtractedEntry, EditorState, categorizeFile, categorizeBdatTable, hasTechnicalTags } from "@/components/editor/types";

export interface QualityStats {
  tooLong: number;
  nearLimit: number;
  missingTags: number;
  placeholderMismatch: number;
  total: number;
  problemKeys: Set<string>;
  damagedTags: number;
  damagedTagKeys: Set<string>;
}

export interface NeedsImproveCount {
  total: number;
  tooShort: number;
  tooLong: number;
  stuck: number;
  mixed: number;
}

interface UseEditorQualityProps {
  state: EditorState | null;
}

export function useEditorQuality({ state }: UseEditorQualityProps) {
  const [categoryProgress, setCategoryProgress] = useState<Record<string, { total: number; translated: number }>>({});
  const [qualityStats, setQualityStats] = useState<QualityStats>({ tooLong: 0, nearLimit: 0, missingTags: 0, placeholderMismatch: 0, total: 0, problemKeys: new Set<string>(), damagedTags: 0, damagedTagKeys: new Set<string>() });
  const [needsImproveCount, setNeedsImproveCount] = useState<NeedsImproveCount>({ total: 0, tooShort: 0, tooLong: 0, stuck: 0, mixed: 0 });
  const [translatedCount, setTranslatedCount] = useState(0);
  const combinedStatsTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // === Quality helper functions ===
  const isTranslationTooShort = useCallback((entry: ExtractedEntry, translation: string): boolean => {
    if (!translation?.trim() || !entry.original?.trim()) return false;
    return translation.trim().length < entry.original.trim().length * 0.3 && entry.original.trim().length > 5;
  }, []);

  const isTranslationTooLong = useCallback((entry: ExtractedEntry, translation: string): boolean => {
    if (!translation?.trim() || entry.maxBytes <= 0) return false;
    return new TextEncoder().encode(translation).length > entry.maxBytes;
  }, []);

  const hasStuckChars = useCallback((translation: string): boolean => {
    if (!translation?.trim()) return false;
    return hasArabicPresentationForms(translation);
  }, []);

  const isMixedLanguage = useCallback((translation: string): boolean => {
    if (!translation?.trim()) return false;
    const stripped = translation.replace(/\[[^\]]*\]/g, '').replace(/\uFFFC/g, '').trim();
    if (!stripped) return false;
    const hasArabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(stripped);
    const englishWords = stripped.match(/[a-zA-Z]{2,}/g) || [];
    const whitelist = new Set([
      // Technical
      'HP', 'MP', 'AP', 'TP', 'EXP', 'ATK', 'DEF', 'NPC', 'HUD', 'FPS', 'XP', 'DLC', 'UI', 'OK', 'NG',
      // Characters
      'NOAH', 'MIO', 'LANZ', 'SENA', 'TAION', 'EUNIE', 'RIKU', 'MANANA',
      // Locations
      'AIONIOS', 'KEVES', 'AGNUS', 'COLONY',
      // Game terms
      'ARTS', 'TALENT', 'CHAIN', 'ATTACK', 'OUROBOROS', 'INTERLINK', 'BLADE', 'BLADES',
      // Controller
      'ZL', 'ZR', 'PLUS', 'MINUS',
    ]);
    const realEnglish = englishWords.filter(w => !whitelist.has(w.toUpperCase()));
    return hasArabic && realEnglish.length > 0;
  }, []);

  const needsImprovement = useCallback((entry: ExtractedEntry, translation: string): boolean => {
    return isTranslationTooShort(entry, translation) || 
           isTranslationTooLong(entry, translation) || 
           hasStuckChars(translation) || 
           isMixedLanguage(translation);
  }, [isTranslationTooShort, isTranslationTooLong, hasStuckChars, isMixedLanguage]);

  // === Combined stats computation ===
  useEffect(() => {
    if (!state) return;
    if (combinedStatsTimerRef.current) clearTimeout(combinedStatsTimerRef.current);
    combinedStatsTimerRef.current = setTimeout(() => {
      const progress: Record<string, { total: number; translated: number }> = {};
      let qTooLong = 0, qNearLimit = 0, qMissingTags = 0, qPlaceholderMismatch = 0;
      const problemKeys = new Set<string>();
      let niTooShort = 0, niTooLong = 0, niStuck = 0, niMixed = 0;
      const needsImproveKeys = new Set<string>();
      let translated = 0;
      let damagedTags = 0;
      const damagedTagKeys = new Set<string>();

      for (const entry of state.entries) {
        const key = `${entry.msbtFile}:${entry.index}`;
        const translation = state.translations[key] || '';
        const trimmed = translation.trim();
        const isTranslated = trimmed !== '';
        const isBdat = /^.+?\[\d+\]\./.test(entry.label);
        const sourceFile = entry.msbtFile.startsWith('bdat-bin:') ? entry.msbtFile.split(':')[1] : entry.msbtFile.startsWith('bdat:') ? entry.msbtFile.slice(5) : undefined;
        const cat = isBdat ? categorizeBdatTable(entry.label, sourceFile) : categorizeFile(entry.msbtFile);

        if (!progress[cat]) progress[cat] = { total: 0, translated: 0 };
        progress[cat].total++;
        if (isTranslated) { progress[cat].translated++; translated++; }
        if (!isTranslated) continue;

        if (entry.maxBytes > 0) {
          const bytes = new TextEncoder().encode(trimmed).length;
          if (bytes > entry.maxBytes) { qTooLong++; problemKeys.add(key); }
          else if (bytes / entry.maxBytes > 0.8) { qNearLimit++; problemKeys.add(key); }
        }
        const origTags = entry.original.match(/\[[^\]]*\]/g) || [];
        for (const tag of origTags) {
          if (!trimmed.includes(tag)) { qMissingTags++; problemKeys.add(key); break; }
        }
        const origPh = (entry.original.match(/\uFFFC/g) || []).length;
        const transPh = (trimmed.match(/\uFFFC/g) || []).length;
        if (origPh !== transPh) { qPlaceholderMismatch++; problemKeys.add(key); }

        // Check for damaged technical tags (present in original, missing in translation)
        if (hasTechnicalTags(entry.original)) {
          const origControlChars = entry.original.match(/[\uFFF9-\uFFFC\uE000-\uF8FF]/g) || [];
          const transControlChars = trimmed.match(/[\uFFF9-\uFFFC\uE000-\uF8FF]/g) || [];
          if (transControlChars.length < origControlChars.length) {
            damagedTags++;
            damagedTagKeys.add(key);
            problemKeys.add(key);
          }
        }

        if (isTranslationTooShort(entry, trimmed)) { niTooShort++; needsImproveKeys.add(key); }
        if (isTranslationTooLong(entry, trimmed)) { niTooLong++; needsImproveKeys.add(key); }
        if (hasStuckChars(trimmed)) { niStuck++; needsImproveKeys.add(key); }
        if (isMixedLanguage(trimmed)) { niMixed++; needsImproveKeys.add(key); }
      }

      setCategoryProgress(progress);
      setQualityStats({ tooLong: qTooLong, nearLimit: qNearLimit, missingTags: qMissingTags, placeholderMismatch: qPlaceholderMismatch, total: problemKeys.size, problemKeys, damagedTags, damagedTagKeys });
      setNeedsImproveCount({ total: needsImproveKeys.size, tooShort: niTooShort, tooLong: niTooLong, stuck: niStuck, mixed: niMixed });
      setTranslatedCount(translated);
    }, 800);
    return () => { if (combinedStatsTimerRef.current) clearTimeout(combinedStatsTimerRef.current); };
  }, [state?.entries, state?.translations, isTranslationTooShort, isTranslationTooLong, hasStuckChars, isMixedLanguage]);

  return {
    // Stats
    categoryProgress,
    qualityStats,
    needsImproveCount,
    translatedCount,

    // Quality helpers
    isTranslationTooShort,
    isTranslationTooLong,
    hasStuckChars,
    isMixedLanguage,
    needsImprovement,
  };
}
