import React, { useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Wrench, Loader2, CheckCircle2, AlertTriangle, XCircle, Stethoscope,
  ChevronDown, ChevronUp, Zap, Eye, EyeOff, ShieldCheck,
} from "lucide-react";
import { idbGet } from "@/lib/idb-storage";
import type { EditorState, ExtractedEntry } from "@/components/editor/types";
import { toast } from "@/hooks/use-toast";

// ─── Issue Types ──────────────────────────────────────
interface RepairIssue {
  key: string;
  entryLabel: string;
  original: string;
  translation: string;
  category: string;
  type: string;
  message: string;
  fix?: string;
  severity: "error" | "warn" | "info";
}

interface CategorySummary {
  id: string;
  label: string;
  emoji: string;
  issues: RepairIssue[];
  fixableCount: number;
}

interface ComprehensiveRepairPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: EditorState;
  onApplyFix: (key: string, fixedText: string) => void;
  onApplyBatch: (fixes: Record<string, string>) => void;
}

// ─── Category definitions ──────────────────────────────────────
const CATEGORIES: Record<string, { label: string; emoji: string }> = {
  structural: { label: "بنية الملف", emoji: "🏗️" },
  tags: { label: "وسوم ورموز تقنية", emoji: "🏷️" },
  quality: { label: "جودة الترجمة", emoji: "📝" },
  cleanup: { label: "تنظيف النص", emoji: "🧹" },
};

// ─── Check functions (from QualityChecksPanel) ──────────────────
function checkNumbers(original: string, translation: string): { message: string; fix?: string } | null {
  const origNums: string[] = (original.match(/\d+/g) || []).slice().sort();
  const transNums: string[] = (translation.match(/\d+/g) || []).slice().sort();
  if (origNums.length === 0) return null;
  const missing = origNums.filter(n => !transNums.includes(n));
  const extra = transNums.filter(n => !origNums.includes(n));
  if (missing.length > 0 || extra.length > 0) {
    const parts: string[] = [];
    if (missing.length) parts.push(`مفقودة: ${missing.join(', ')}`);
    if (extra.length) parts.push(`زائدة: ${extra.join(', ')}`);
    return { message: `أرقام ${parts.join(' | ')}` };
  }
  return null;
}

function checkVariables(original: string, translation: string): { message: string } | null {
  const origVars = (original.match(/\{[^}]+\}/g) || []).sort();
  if (origVars.length === 0) return null;
  const transVars = (translation.match(/\{[^}]+\}/g) || []).sort();
  const missing = origVars.filter(v => !transVars.includes(v));
  if (missing.length > 0) return { message: `متغيرات مفقودة: ${missing.join(', ')}` };
  return null;
}

function checkExtraSpaces(translation: string): { message: string; fix: string } | null {
  if (/  +/.test(translation)) {
    return { message: "مسافات مزدوجة", fix: translation.replace(/ {2,}/g, ' ') };
  }
  return null;
}

function checkPunctuation(original: string, translation: string): { message: string; fix: string } | null {
  const origEnd = original.trim().slice(-1);
  const transEnd = translation.trim().slice(-1);
  const equivMap: Record<string, string[]> = {
    '.': ['.', '。'], '!': ['!', '！'], '?': ['?', '？', '؟'], ':': [':'], ';': [';', '؛'],
  };
  if (equivMap[origEnd]) {
    const validEnds = equivMap[origEnd];
    if (!validEnds.includes(transEnd) && transEnd !== origEnd) {
      const arabicEquiv: Record<string, string> = { '?': '؟', ';': '؛' };
      const fixChar = arabicEquiv[origEnd] || origEnd;
      const trimmed = translation.trim();
      const fix = /[.!?؟؛:،]$/.test(trimmed) ? trimmed.slice(0, -1) + fixChar : trimmed + fixChar;
      return { message: `علامة ترقيم: "${origEnd}" → "${transEnd}"`, fix };
    }
  }
  return null;
}

function checkRepetition(translation: string): { message: string } | null {
  const stripped = translation.replace(/\[[^\]]*\]/g, '').replace(/\{[^}]*\}/g, '').replace(/[\uFFF9-\uFFFC\uE000-\uF8FF]/g, '').trim();
  const words = stripped.split(/\s+/).filter(w => w.length > 2);
  if (words.length < 4) return null;
  for (let i = 0; i < words.length - 2; i++) {
    if (words[i] === words[i + 1] && words[i] === words[i + 2]) {
      return { message: `تكرار: "${words[i]}" ×3+` };
    }
  }
  return null;
}

function checkGrammar(translation: string): { message: string } | null {
  const stripped = translation.replace(/\[[^\]]*\]/g, '').replace(/\{[^}]*\}/g, '').replace(/[\uFFF9-\uFFFC\uE000-\uF8FF]/g, '').trim();
  if (!stripped || stripped.length < 5) return null;
  if (/الال/.test(stripped)) return { message: 'تعريف مكرر "الال"' };
  if (/ةة/.test(stripped)) return { message: 'تاء مربوطة مكررة "ةة"' };
  return null;
}

function checkLength(entry: ExtractedEntry, translation: string): { message: string } | null {
  if (!entry.original?.trim() || !translation?.trim()) return null;
  const origLen = entry.original.trim().length;
  const transLen = translation.trim().length;
  if (origLen < 5) return null;
  const ratio = transLen / origLen;
  if (ratio < 0.2) return { message: `قصيرة جداً (${Math.round(ratio * 100)}%)` };
  if (ratio > 3.0) return { message: `طويلة جداً (${Math.round(ratio * 100)}%)` };
  return null;
}

// ─── Cleanup functions (from CleanupToolsPanel) ──────────────
function fixQuestionMark(text: string): string {
  return text.replace(/(\p{Script=Arabic})\s*\?/gu, '$1؟');
}

function removeInvisibleChars(text: string): string {
  return text.replace(/[\u200B\u200C\u200D\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, '');
}

function fixUnicode(text: string): string {
  let result = text;
  result = result.replace(/\u0640{2,}/g, '\u0640');
  result = result.replace(/^[\u064B-\u065F\u0670]+/, '');
  return result;
}

function fixMissingAlef(text: string): string {
  const KNOWN = new Set([
    'نت','نط','نف','نق','نش','نح','نس','نك','ند','نذ','نب','نج','نص','نض','نظ','نع','نغ','نم','نو','نه',
    'ست','سم','سن','سر','سل','خت','خف','خر','خل','فت','فر','قت','قر','قص','قل','جت','جر','جم',
    'عت','عم','عر','عص','عل','عد','تف','تص','تح','تج','تق','تخ','تر','تك','تب','تس','تم','تش','تن','تل','تع','تض','تط','تظ','تغ','ته',
    'حت','حر','حم','حل','كت','كر','كم','كف','لت','لر','لم','مت','مر','مل','بت','بر','شت','شم','شر',
    'صط','صر','صل','ضط','ضر','طل','طر','طف','طم','ظل','غت','غر','رت','رم','رف','رس',
  ]);
  return text.replace(/ال([\u0628-\u064A])([\u0628-\u064A])/g, (match, c1: string, c2: string) => {
    return KNOWN.has(c1 + c2) ? 'الا' + c1 + c2 : match;
  });
}

// ─── Main Component ──────────────────────────────────────
const ComprehensiveRepairPanel = ({ open, onOpenChange, state, onApplyFix, onApplyBatch }: ComprehensiveRepairPanelProps) => {
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState<Record<string, boolean>>({});
  const [fixingAll, setFixingAll] = useState(false);
  const [done, setDone] = useState(false);

  const runFullScan = useCallback(async () => {
    if (!state || scanning) return;
    setScanning(true);
    setDone(false);
    setCategories([]);
    setProgress(0);

    const isCobalt = state.entries.some(e => e.msbtFile.startsWith("cobalt:"));
    const allIssues: RepairIssue[] = [];
    const total = state.entries.length;

    // ─── Phase 1: Structural + Tag checks (Cobalt) ───
    setProgressLabel("🏗️ فحص البنية والوسوم...");
    if (isCobalt) {
      const rawFiles = await idbGet<{ name: string; rawLines: string[]; hasLabels: boolean; entries: { label: string; text: string; lineIndex: number; lineCount: number }[] }[]>("cobaltRawFiles");

      for (const entry of state.entries) {
        if (!entry.msbtFile.startsWith("cobalt:")) continue;
        const key = `${entry.msbtFile}:${entry.index}`;
        const trans = state.translations[key]?.trim();
        if (!trans) continue;

        const origLines = entry.original.split("\n");
        const transLines = trans.split("\n");
        const midRegex = /^\[MID_[^\]]+\]$/;

        // Check MID identifiers
        for (const origLine of origLines) {
          if (midRegex.test(origLine.trim())) {
            const found = transLines.some(tl => tl.trim() === origLine.trim());
            if (!found) {
              // Check if arabized
              const arabicMid = transLines.find(tl => /^\[[\u0600-\u06FF\w_]+\]$/.test(tl.trim()) && /[\u0600-\u06FF]/.test(tl));
              const fixedLines = [...transLines];
              if (arabicMid) {
                const idx = transLines.indexOf(arabicMid);
                fixedLines[idx] = origLine.trim();
                allIssues.push({ key, entryLabel: entry.label, original: entry.original, translation: trans, category: "tags", type: "mid_arabized", message: `معرف معرّب: ${arabicMid} ← ${origLine.trim()}`, fix: fixedLines.join("\n"), severity: "error" });
              } else {
                // Missing MID - insert at original position
                const origIdx = origLines.indexOf(origLine);
                fixedLines.splice(Math.min(origIdx, fixedLines.length), 0, origLine.trim());
                allIssues.push({ key, entryLabel: entry.label, original: entry.original, translation: trans, category: "tags", type: "mid_missing", message: `معرف محذوف: ${origLine.trim()}`, fix: fixedLines.join("\n"), severity: "error" });
              }
            }
          }
        }

        // Check $ tags
        const dollarTagRegex = /\$\w+(\([^)]*\))?/g;
        const origDollarTags = entry.original.match(dollarTagRegex);
        if (origDollarTags && /\$[\u0600-\u06FF]/.test(trans)) {
          const arabicDollarPattern = /\$[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\w]+(\([^)]*\))?/g;
          const corruptedMatches = [...trans.matchAll(arabicDollarPattern)].filter(m => /[\u0600-\u06FF]/.test(m[0]));
          if (corruptedMatches.length > 0) {
            let fixedTrans = trans;
            const usedOrig = new Set<number>();
            for (const cm of corruptedMatches) {
              const hasArgs = cm[0].includes("(");
              const matchIdx = origDollarTags.findIndex((ot, idx) => !usedOrig.has(idx) && (hasArgs ? ot.includes("(") : !ot.includes("(")));
              if (matchIdx !== -1) {
                fixedTrans = fixedTrans.replace(cm[0], origDollarTags[matchIdx]);
                usedOrig.add(matchIdx);
              }
            }
            if (fixedTrans !== trans) {
              allIssues.push({ key, entryLabel: entry.label, original: entry.original, translation: trans, category: "tags", type: "dollar_arabized", message: `وسم $ معرّب (${corruptedMatches.length})`, fix: fixedTrans, severity: "error" });
            }
          }
        }

        // Check %s %d format specifiers
        const formatSpecRegex = /%[sd]/g;
        const origFormats = entry.original.match(formatSpecRegex);
        if (origFormats && /%[\u0600-\u06FF]/.test(trans)) {
          const arabicFmtPattern = /%[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g;
          const corruptedFmts = [...trans.matchAll(arabicFmtPattern)];
          if (corruptedFmts.length > 0) {
            let fixedTrans = trans;
            const usedOrig = new Set<number>();
            for (const cm of corruptedFmts) {
              const matchIdx = origFormats.findIndex((_, idx) => !usedOrig.has(idx));
              if (matchIdx !== -1) {
                fixedTrans = fixedTrans.replace(cm[0], origFormats[matchIdx]);
                usedOrig.add(matchIdx);
              }
            }
            if (fixedTrans !== trans) {
              allIssues.push({ key, entryLabel: entry.label, original: entry.original, translation: trans, category: "tags", type: "format_arabized", message: `رمز %s/%d معرّب (${corruptedFmts.length})`, fix: fixedTrans, severity: "error" });
            }
          }
        }

        // Check line count for cobalt
        if (rawFiles) {
          const parts = entry.msbtFile.split(":");
          const fileName = parts[1];
          const rawFile = rawFiles.find(rf => rf.name === fileName);
          if (rawFile) {
            const rawEntry = rawFile.entries.find(re => re.label === entry.label);
            if (rawEntry && transLines.length > rawEntry.lineCount) {
              allIssues.push({ key, entryLabel: entry.label, original: entry.original, translation: trans, category: "structural", type: "extra_lines", message: `${transLines.length} سطر بدلاً من ${rawEntry.lineCount}`, severity: "warn" });
            }
          }
        }
      }
    }

    // Check technical tags (PUA/control chars)
    const tagRegex = /[\uFFF9-\uFFFC\uE000-\uE0FF]/;
    for (const entry of state.entries) {
      if (!tagRegex.test(entry.original)) continue;
      const key = `${entry.msbtFile}:${entry.index}`;
      const trans = state.translations[key]?.trim();
      if (!trans) continue;
      const origTags = (entry.original.match(/[\uFFF9-\uFFFC\uE000-\uE0FF]/g) || []).length;
      const transTags = (trans.match(/[\uFFF9-\uFFFC\uE000-\uE0FF]/g) || []).length;
      if (transTags < origTags) {
        allIssues.push({ key, entryLabel: entry.label, original: entry.original, translation: trans, category: "tags", type: "missing_pua", message: `رموز تقنية مفقودة (${origTags - transTags})`, severity: "warn" });
      }
    }
    setProgress(30);

    // ─── Phase 2: Quality checks ───
    setProgressLabel("📝 فحص جودة الترجمة...");
    let processed = 0;
    for (const entry of state.entries) {
      const key = `${entry.msbtFile}:${entry.index}`;
      const trans = state.translations[key]?.trim();
      if (!trans) continue;

      const r1 = checkNumbers(entry.original, trans);
      if (r1) allIssues.push({ key, entryLabel: entry.label, original: entry.original, translation: trans, category: "quality", type: "numbers", message: r1.message, fix: r1.fix, severity: "warn" });

      const r2 = checkVariables(entry.original, trans);
      if (r2) allIssues.push({ key, entryLabel: entry.label, original: entry.original, translation: trans, category: "quality", type: "variables", message: r2.message, severity: "warn" });

      const r3 = checkExtraSpaces(trans);
      if (r3) allIssues.push({ key, entryLabel: entry.label, original: entry.original, translation: trans, category: "quality", type: "spaces", message: r3.message, fix: r3.fix, severity: "info" });

      const r4 = checkPunctuation(entry.original, trans);
      if (r4) allIssues.push({ key, entryLabel: entry.label, original: entry.original, translation: trans, category: "quality", type: "punctuation", message: r4.message, fix: r4.fix, severity: "info" });

      const r5 = checkRepetition(trans);
      if (r5) allIssues.push({ key, entryLabel: entry.label, original: entry.original, translation: trans, category: "quality", type: "repetition", message: r5.message, severity: "warn" });

      const r6 = checkGrammar(trans);
      if (r6) allIssues.push({ key, entryLabel: entry.label, original: entry.original, translation: trans, category: "quality", type: "grammar", message: r6.message, severity: "warn" });

      const r7 = checkLength(entry, trans);
      if (r7) allIssues.push({ key, entryLabel: entry.label, original: entry.original, translation: trans, category: "quality", type: "length", message: r7.message, severity: "info" });

      processed++;
      if (processed % 200 === 0) setProgress(30 + Math.round((processed / total) * 40));
    }
    setProgress(70);

    // ─── Phase 3: Cleanup checks ───
    setProgressLabel("🧹 فحص التنظيف...");
    processed = 0;
    for (const entry of state.entries) {
      const key = `${entry.msbtFile}:${entry.index}`;
      const trans = state.translations[key]?.trim();
      if (!trans) continue;

      let cleaned = trans;
      const fixes: string[] = [];

      // Question mark
      const qmFixed = fixQuestionMark(cleaned);
      if (qmFixed !== cleaned) { fixes.push("علامة استفهام"); cleaned = qmFixed; }

      // Invisible chars
      const invFixed = removeInvisibleChars(cleaned);
      if (invFixed !== cleaned) { fixes.push("أحرف غير مرئية"); cleaned = invFixed; }

      // Unicode
      const uniFixed = fixUnicode(cleaned);
      if (uniFixed !== cleaned) { fixes.push("Unicode"); cleaned = uniFixed; }

      // Missing alef
      const alefFixed = fixMissingAlef(cleaned);
      if (alefFixed !== cleaned) { fixes.push("ألف محذوفة"); cleaned = alefFixed; }

      if (fixes.length > 0) {
        allIssues.push({ key, entryLabel: entry.label, original: entry.original, translation: trans, category: "cleanup", type: "text_cleanup", message: fixes.join("، "), fix: cleaned, severity: "info" });
      }

      processed++;
      if (processed % 200 === 0) setProgress(70 + Math.round((processed / total) * 30));
    }
    setProgress(100);

    // ─── Build category summaries ───
    const catMap: Record<string, RepairIssue[]> = {};
    for (const issue of allIssues) {
      if (!catMap[issue.category]) catMap[issue.category] = [];
      catMap[issue.category].push(issue);
    }

    const summaries: CategorySummary[] = [];
    for (const [catId, catDef] of Object.entries(CATEGORIES)) {
      const issues = catMap[catId] || [];
      if (issues.length > 0) {
        summaries.push({
          id: catId,
          label: catDef.label,
          emoji: catDef.emoji,
          issues,
          fixableCount: issues.filter(i => i.fix).length,
        });
      }
    }

    setCategories(summaries);
    setScanning(false);
    setDone(true);
    setProgressLabel("");
  }, [state, scanning]);

  // ─── Fix all auto-fixable issues ───
  const handleFixAll = useCallback(() => {
    setFixingAll(true);
    const allFixes: Record<string, string> = {};

    // Collect all fixes, applying them in priority order per key
    // Priority: tags > structural > quality > cleanup
    const priorityOrder = ["tags", "structural", "quality", "cleanup"];
    for (const catId of priorityOrder) {
      const cat = categories.find(c => c.id === catId);
      if (!cat) continue;
      for (const issue of cat.issues) {
        if (!issue.fix) continue;
        // If we already have a fix for this key, chain the fixes
        if (allFixes[issue.key]) {
          // Apply subsequent fix on top of previous
          // Only if the issue type is different category
          // For same-key issues, use the highest priority fix
          continue;
        }
        allFixes[issue.key] = issue.fix;
      }
    }

    const fixCount = Object.keys(allFixes).length;
    if (fixCount > 0) {
      onApplyBatch(allFixes);
      toast({ title: "✅ تم الإصلاح الشامل", description: `تم إصلاح ${fixCount} ترجمة تلقائياً` });
    }

    setFixingAll(false);
    // Re-scan
    setTimeout(() => runFullScan(), 300);
  }, [categories, onApplyBatch, runFullScan]);

  const handleFixCategory = useCallback((catId: string) => {
    const cat = categories.find(c => c.id === catId);
    if (!cat) return;
    const fixes: Record<string, string> = {};
    for (const issue of cat.issues) {
      if (issue.fix && !fixes[issue.key]) fixes[issue.key] = issue.fix;
    }
    const count = Object.keys(fixes).length;
    if (count > 0) {
      onApplyBatch(fixes);
      toast({ title: "✅ تم الإصلاح", description: `تم إصلاح ${count} مشكلة في ${cat.label}` });
    }
    setTimeout(() => runFullScan(), 300);
  }, [categories, onApplyBatch, runFullScan]);

  const totalIssues = categories.reduce((sum, c) => sum + c.issues.length, 0);
  const totalFixable = categories.reduce((sum, c) => sum + c.fixableCount, 0);
  const errorCount = categories.reduce((sum, c) => sum + c.issues.filter(i => i.severity === "error").length, 0);
  const warnCount = categories.reduce((sum, c) => sum + c.issues.filter(i => i.severity === "warn").length, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col" dir="rtl">
        <DialogHeader>
          <DialogTitle className="font-display text-lg flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" /> أداة الإصلاح الشاملة
          </DialogTitle>
          <DialogDescription className="font-body text-sm">
            فحص جميع الترجمات واكتشاف المشاكل مع إصلاح تلقائي بضغطة واحدة
          </DialogDescription>
        </DialogHeader>

        {/* Scan button */}
        {!scanning && !done && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Stethoscope className="w-12 h-12 text-muted-foreground" />
            <p className="text-sm text-muted-foreground font-body text-center">
              سيتم فحص {state.entries.length} مدخل عبر {Object.keys(CATEGORIES).length} فئات تشخيصية
            </p>
            <Button onClick={runFullScan} className="font-display font-bold gap-2" size="lg">
              <Stethoscope className="w-5 h-5" /> بدء الفحص الشامل
            </Button>
          </div>
        )}

        {/* Progress */}
        {scanning && (
          <div className="space-y-3 py-4">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span className="text-sm font-body">{progressLabel}</span>
            </div>
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-muted-foreground text-center font-body">{progress}%</p>
          </div>
        )}

        {/* Results */}
        {done && !scanning && (
          <ScrollArea className="flex-1 min-h-0">
            <div className="space-y-3 pl-2">
              {/* Summary bar */}
              <div className={`p-3 rounded-lg border flex items-center justify-between ${
                totalIssues === 0 ? 'bg-secondary/10 border-secondary/30' :
                errorCount > 0 ? 'bg-destructive/10 border-destructive/30' :
                'bg-yellow-500/10 border-yellow-500/30'
              }`}>
                <div className="flex items-center gap-2">
                  {totalIssues === 0 ? <CheckCircle2 className="w-5 h-5 text-secondary" /> :
                   errorCount > 0 ? <XCircle className="w-5 h-5 text-destructive" /> :
                   <AlertTriangle className="w-5 h-5 text-yellow-500" />}
                  <div>
                    <p className="text-sm font-display font-bold">
                      {totalIssues === 0 ? 'لا توجد مشاكل ✨' : `${totalIssues} مشكلة`}
                    </p>
                    {totalIssues > 0 && (
                      <p className="text-xs text-muted-foreground font-body">
                        {errorCount > 0 && <span className="text-destructive">{errorCount} حرجة</span>}
                        {errorCount > 0 && warnCount > 0 && ' · '}
                        {warnCount > 0 && <span className="text-yellow-500">{warnCount} تحذير</span>}
                        {(errorCount > 0 || warnCount > 0) && totalIssues - errorCount - warnCount > 0 && ' · '}
                        {totalIssues - errorCount - warnCount > 0 && <span>{totalIssues - errorCount - warnCount} تنظيف</span>}
                      </p>
                    )}
                  </div>
                </div>
                {totalFixable > 0 && (
                  <Badge variant="secondary" className="text-xs">{totalFixable} قابلة للإصلاح</Badge>
                )}
              </div>

              {/* Fix all button */}
              {totalFixable > 0 && (
                <Button
                  onClick={handleFixAll}
                  disabled={fixingAll}
                  className="w-full font-display font-bold gap-2"
                  variant="default"
                >
                  {fixingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  إصلاح الكل تلقائياً ({totalFixable} مشكلة)
                </Button>
              )}

              {/* Categories */}
              {categories.map(cat => (
                <Collapsible
                  key={cat.id}
                  open={expandedCat === cat.id}
                  onOpenChange={(open) => setExpandedCat(open ? cat.id : null)}
                >
                  <div className="rounded-lg border bg-muted/20 overflow-hidden">
                    <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-muted/30 transition-colors">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{cat.emoji}</span>
                        <span className="font-display font-bold text-sm">{cat.label}</span>
                        <Badge variant={cat.issues.some(i => i.severity === "error") ? "destructive" : "secondary"} className="text-xs">
                          {cat.issues.length}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        {cat.fixableCount > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-7 gap-1"
                            onClick={(e) => { e.stopPropagation(); handleFixCategory(cat.id); }}
                          >
                            <Wrench className="w-3 h-3" /> إصلاح ({cat.fixableCount})
                          </Button>
                        )}
                        {expandedCat === cat.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </div>
                    </CollapsibleTrigger>

                    <CollapsibleContent>
                      <div className="border-t p-2 space-y-1.5 max-h-60 overflow-y-auto">
                        {cat.issues.slice(0, 100).map((issue, idx) => (
                          <div key={`${issue.key}-${idx}`} className="flex items-start gap-2 p-2 rounded bg-background/50 text-xs">
                            {issue.severity === "error" ? <XCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" /> :
                             issue.severity === "warn" ? <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 shrink-0 mt-0.5" /> :
                             <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />}
                            <div className="flex-1 min-w-0">
                              <span className="font-mono text-muted-foreground truncate block">{issue.entryLabel}</span>
                              <span className="font-body">{issue.message}</span>
                            </div>
                            {issue.fix && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-xs h-6 text-secondary shrink-0"
                                onClick={() => {
                                  onApplyFix(issue.key, issue.fix!);
                                  // Remove from list
                                  setCategories(prev => prev.map(c => c.id === cat.id ? {
                                    ...c,
                                    issues: c.issues.filter((_, i2) => i2 !== idx),
                                    fixableCount: c.fixableCount - 1,
                                  } : c).filter(c => c.issues.length > 0));
                                }}
                              >
                                <Wrench className="w-3 h-3" />
                              </Button>
                            )}
                          </div>
                        ))}
                        {cat.issues.length > 100 && (
                          <p className="text-xs text-muted-foreground text-center py-1">
                            و {cat.issues.length - 100} مشكلة أخرى...
                          </p>
                        )}
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              ))}
            </div>
          </ScrollArea>
        )}

        <DialogFooter className="gap-2 sm:gap-0 mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="font-body">
            إغلاق
          </Button>
          {done && (
            <Button variant="outline" onClick={runFullScan} disabled={scanning} className="font-body gap-1">
              <Stethoscope className="w-4 h-4" /> إعادة الفحص
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ComprehensiveRepairPanel;
