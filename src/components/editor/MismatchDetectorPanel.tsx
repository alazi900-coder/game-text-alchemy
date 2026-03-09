import React, { useState, useMemo, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronUp, AlertTriangle, Trash2, Loader2, Check, X, Search, Eye } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { EditorState } from "@/components/editor/types";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface MismatchResult {
  key: string;
  entryLabel: string;
  original: string;
  translation: string;
  reason: string;
  confidence: "high" | "medium" | "low";
}

interface MismatchDetectorPanelProps {
  state: EditorState;
  onClearTranslation: (key: string) => void;
  onClearMultiple: (keys: string[]) => void;
  onNavigateToEntry?: (key: string) => void;
}

/** Local heuristic checks (no AI needed) */
function detectLocalMismatches(entries: EditorState["entries"], translations: Record<string, string>): MismatchResult[] {
  const results: MismatchResult[] = [];
  
  for (const entry of entries) {
    const key = `${entry.msbtFile}:${entry.index}`;
    const translation = translations[key]?.trim();
    if (!translation) continue;
    
    const original = entry.original?.trim();
    if (!original) continue;

    // 1. Numbers mismatch: original has specific numbers, translation has completely different ones
    const origNums = (original.match(/\d+/g) || []).sort().join(',');
    const transNums = (translation.match(/\d+/g) || []).sort().join(',');
    if (origNums && transNums && origNums !== transNums) {
      const origSet = new Set(original.match(/\d+/g) || []);
      const transSet = new Set(translation.match(/\d+/g) || []);
      const overlap = [...origSet].filter(n => transSet.has(n)).length;
      if (overlap === 0 && origSet.size >= 2) {
        results.push({
          key, entryLabel: entry.label, original, translation,
          reason: `أرقام مختلفة تماماً: الأصل (${origNums}) ≠ الترجمة (${transNums})`,
          confidence: "high",
        });
        continue;
      }
    }

    // 2. Variables mismatch: original has {var}, translation has different {var}
    const origVars = (original.match(/\{[^}]+\}/g) || []).sort();
    const transVars = (translation.match(/\{[^}]+\}/g) || []).sort();
    if (origVars.length > 0 && transVars.length > 0) {
      const origVarStr = origVars.join(',');
      const transVarStr = transVars.join(',');
      if (origVarStr !== transVarStr) {
        const origSet = new Set(origVars);
        const transSet = new Set(transVars);
        const missing = [...origSet].filter(v => !transSet.has(v));
        const extra = [...transSet].filter(v => !origSet.has(v));
        if (missing.length > 0 && extra.length > 0) {
          results.push({
            key, entryLabel: entry.label, original, translation,
            reason: `متغيرات مختلفة: مفقودة (${missing.join(', ')}) — زائدة (${extra.join(', ')})`,
            confidence: "high",
          });
          continue;
        }
      }
    }

    // 3. Length ratio extreme: translation is wildly different length
    const origLen = original.length;
    const transLen = translation.length;
    if (origLen > 10) {
      const ratio = transLen / origLen;
      if (ratio > 5) {
        results.push({
          key, entryLabel: entry.label, original, translation,
          reason: `نسبة الطول مريبة: الترجمة أطول بـ ${Math.round(ratio)}x من الأصل`,
          confidence: "medium",
        });
        continue;
      }
    }

    // 4. Translation is exact copy of another entry's original
    const isExactCopyOfOther = entries.some(other => {
      const otherKey = `${other.msbtFile}:${other.index}`;
      return otherKey !== key && other.original?.trim() === translation;
    });
    if (isExactCopyOfOther) {
      results.push({
        key, entryLabel: entry.label, original, translation,
        reason: "الترجمة هي نسخة حرفية من نص أصلي آخر — ربما وُضعت في المكان الخطأ",
        confidence: "high",
      });
      continue;
    }

    // 5. Translation contains English that doesn't match the original at all
    const origWords = new Set((original.match(/[a-zA-Z]{4,}/g) || []).map(w => w.toLowerCase()));
    const transEnglishWords = (translation.match(/[a-zA-Z]{4,}/g) || []).map(w => w.toLowerCase());
    if (origWords.size > 0 && transEnglishWords.length > 0) {
      const matchingWords = transEnglishWords.filter(w => origWords.has(w));
      if (matchingWords.length === 0 && transEnglishWords.length >= 3) {
        results.push({
          key, entryLabel: entry.label, original, translation,
          reason: `كلمات إنجليزية في الترجمة لا تتطابق مع الأصل: ${transEnglishWords.slice(0, 5).join(', ')}`,
          confidence: "medium",
        });
      }
    }

    // 6. Duplicate translation: same Arabic text used for completely different originals
    // (checked below in a second pass)
  }

  // Second pass: detect duplicate translations for different originals
  const translationMap: Record<string, { key: string; original: string; label: string }[]> = {};
  for (const entry of entries) {
    const key = `${entry.msbtFile}:${entry.index}`;
    const translation = translations[key]?.trim();
    if (!translation || translation.length < 10) continue;
    if (!translationMap[translation]) translationMap[translation] = [];
    translationMap[translation].push({ key, original: entry.original, label: entry.label });
  }
  for (const [trans, users] of Object.entries(translationMap)) {
    if (users.length < 2) continue;
    // Check if the originals are actually different
    const uniqueOriginals = new Set(users.map(u => u.original?.trim()));
    if (uniqueOriginals.size > 1) {
      for (const user of users) {
        // Don't duplicate if already detected
        if (results.some(r => r.key === user.key)) continue;
        results.push({
          key: user.key, entryLabel: user.label, original: user.original, translation: trans,
          reason: `ترجمة متطابقة مع ${users.length - 1} نص آخر مختلف — ربما ترجمة مُزاحة`,
          confidence: "medium",
        });
      }
    }
  }

  return results;
}

export default function MismatchDetectorPanel({ state, onClearTranslation, onClearMultiple, onNavigateToEntry }: MismatchDetectorPanelProps) {
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [results, setResults] = useState<MismatchResult[]>([]);
  const [hasScanned, setHasScanned] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [aiScanning, setAiScanning] = useState(false);

  const translatedCount = useMemo(() => {
    return Object.values(state.translations).filter(t => t?.trim()).length;
  }, [state.translations]);

  // Local scan (fast, no AI)
  const handleLocalScan = useCallback(() => {
    setScanning(true);
    setScanProgress(0);
    setResults([]);
    setSelected(new Set());

    // Use requestAnimationFrame to not block UI
    setTimeout(() => {
      const detected = detectLocalMismatches(state.entries, state.translations);
      setResults(detected);
      setHasScanned(true);
      setScanning(false);
      setScanProgress(100);
      setOpen(true);
      toast({
        title: detected.length > 0 ? `⚠️ تم العثور على ${detected.length} ترجمة مشبوهة` : "✅ لم يتم العثور على مشاكل",
        description: detected.length > 0
          ? `${detected.filter(r => r.confidence === "high").length} عالية الثقة، ${detected.filter(r => r.confidence === "medium").length} متوسطة`
          : "الترجمات تبدو متطابقة مع النصوص الأصلية",
      });
    }, 50);
  }, [state.entries, state.translations]);

  // AI-powered deep scan
  const handleAiScan = useCallback(async () => {
    setAiScanning(true);
    setScanProgress(0);

    // Take a sample of translated entries (max 30 at a time)
    const translatedEntries = state.entries
      .filter(e => {
        const key = `${e.msbtFile}:${e.index}`;
        return state.translations[key]?.trim();
      })
      .slice(0, 30);

    if (translatedEntries.length === 0) {
      setAiScanning(false);
      return;
    }

    try {
      const entries = translatedEntries.map(e => ({
        key: `${e.msbtFile}:${e.index}`,
        original: e.original,
        translation: state.translations[`${e.msbtFile}:${e.index}`],
      }));

      const { data, error } = await supabase.functions.invoke('translation-tools', {
        body: {
          style: 'mismatch-detect',
          entries,
        },
      });

      if (error) throw error;
      if (data?.result) {
        try {
          const parsed = JSON.parse(data.result.replace(/```json\n?|```/g, ''));
          if (Array.isArray(parsed)) {
            const aiResults: MismatchResult[] = parsed.map((item: any) => {
              const entry = translatedEntries.find(e => `${e.msbtFile}:${e.index}` === item.key);
              return {
                key: item.key,
                entryLabel: entry?.label || item.key,
                original: entry?.original || '',
                translation: state.translations[item.key] || '',
                reason: `🤖 ${item.reason}`,
                confidence: item.confidence || "medium",
              };
            }).filter((r: MismatchResult) => r.original);

            // Merge with existing results (avoid duplicates)
            setResults(prev => {
              const existingKeys = new Set(prev.map(r => r.key));
              const newOnes = aiResults.filter(r => !existingKeys.has(r.key));
              return [...prev, ...newOnes];
            });

            toast({
              title: `🤖 فحص AI مكتمل`,
              description: `${aiResults.length} ترجمة مشبوهة إضافية من ${translatedEntries.length} نص`,
            });
          }
        } catch {
          toast({ title: "تحذير", description: "تعذر تحليل نتائج AI", variant: "destructive" });
        }
      }
    } catch (e) {
      toast({ title: "خطأ", description: "فشل فحص AI", variant: "destructive" });
    } finally {
      setAiScanning(false);
      setScanProgress(100);
    }
  }, [state.entries, state.translations]);

  const toggleSelect = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(results.map(r => r.key)));
  const selectHighConfidence = () => setSelected(new Set(results.filter(r => r.confidence === "high").map(r => r.key)));
  const deselectAll = () => setSelected(new Set());

  const handleClearSelected = () => {
    if (selected.size === 0) return;
    onClearMultiple([...selected]);
    toast({ title: "🗑️ تم المسح", description: `تم مسح ${selected.size} ترجمة متضررة` });
    setResults(prev => prev.filter(r => !selected.has(r.key)));
    setSelected(new Set());
  };

  const highCount = results.filter(r => r.confidence === "high").length;
  const medCount = results.filter(r => r.confidence === "medium").length;
  const lowCount = results.filter(r => r.confidence === "low").length;

  return (
    <Card className="mb-4 border-destructive/30 bg-destructive/5">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardContent className="p-3">
          <CollapsibleTrigger className="flex items-center justify-between w-full text-right">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive" />
              <span className="font-display font-bold text-sm">كشف الترجمات المُزاحة</span>
              {results.length > 0 && (
                <Badge variant="destructive" className="text-xs">{results.length} مشبوهة</Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7 gap-1"
                onClick={(e) => { e.stopPropagation(); handleLocalScan(); }}
                disabled={scanning || translatedCount === 0}
              >
                {scanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                فحص سريع
              </Button>
              {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </CollapsibleTrigger>

          <CollapsibleContent className="mt-3 space-y-3">
            {/* Scan buttons */}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="default"
                className="text-xs h-8 gap-1"
                onClick={handleLocalScan}
                disabled={scanning || translatedCount === 0}
              >
                {scanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                فحص محلي ({translatedCount} ترجمة)
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-8 gap-1 border-primary/30 text-primary"
                onClick={handleAiScan}
                disabled={aiScanning || translatedCount === 0}
              >
                {aiScanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
                فحص عميق بالـ AI (30 نص)
              </Button>
            </div>

            {!hasScanned && (
              <p className="text-xs text-muted-foreground">اضغط "فحص محلي" لكشف الترجمات الموضوعة في أماكن خاطئة بدون استهلاك رصيد AI، أو "فحص عميق" لتحليل أعمق.</p>
            )}

            {/* Results */}
            {results.length > 0 && (
              <>
                {/* Summary */}
                <div className="flex flex-wrap gap-2 items-center">
                  {highCount > 0 && (
                    <Badge variant="destructive" className="text-xs gap-1">
                      🔴 عالية الثقة: {highCount}
                    </Badge>
                  )}
                  {medCount > 0 && (
                    <Badge variant="outline" className="text-xs gap-1 border-amber-500/30 text-amber-500">
                      🟡 متوسطة: {medCount}
                    </Badge>
                  )}
                  {lowCount > 0 && (
                    <Badge variant="outline" className="text-xs gap-1">
                      ⚪ منخفضة: {lowCount}
                    </Badge>
                  )}
                </div>

                {/* Selection controls */}
                <div className="flex flex-wrap gap-2 items-center">
                  <Button size="sm" variant="outline" className="text-xs h-7" onClick={selectAll}>تحديد الكل ({results.length})</Button>
                  {highCount > 0 && (
                    <Button size="sm" variant="outline" className="text-xs h-7 text-destructive border-destructive/30" onClick={selectHighConfidence}>
                      تحديد عالية الثقة ({highCount})
                    </Button>
                  )}
                  {selected.size > 0 && (
                    <>
                      <Button size="sm" variant="outline" className="text-xs h-7" onClick={deselectAll}>إلغاء التحديد</Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="text-xs h-7 gap-1"
                        onClick={handleClearSelected}
                      >
                        <Trash2 className="w-3 h-3" /> مسح المحدد ({selected.size})
                      </Button>
                    </>
                  )}
                </div>

                {/* Issue list */}
                <div className="max-h-96 overflow-y-auto space-y-2">
                  {results.map((result) => (
                    <div
                      key={result.key}
                      className={`rounded p-2 space-y-1 border transition-colors ${
                        selected.has(result.key) ? 'bg-destructive/10 border-destructive/40' : 'bg-background/40 border-transparent'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <input
                            type="checkbox"
                            checked={selected.has(result.key)}
                            onChange={() => toggleSelect(result.key)}
                            className="rounded"
                          />
                          <Badge
                            variant={result.confidence === "high" ? "destructive" : "outline"}
                            className="text-[10px] shrink-0"
                          >
                            {result.confidence === "high" ? "🔴" : result.confidence === "medium" ? "🟡" : "⚪"}
                          </Badge>
                          <span className="text-xs font-mono text-muted-foreground truncate">{result.entryLabel}</span>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          {onNavigateToEntry && (
                            <Button size="sm" variant="ghost" className="text-xs h-6 text-primary" onClick={() => onNavigateToEntry(result.key)}>
                              ← انتقل
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="text-xs h-6 text-destructive" onClick={() => {
                            onClearTranslation(result.key);
                            setResults(prev => prev.filter(r => r.key !== result.key));
                          }}>
                            <Trash2 className="w-3 h-3" /> مسح
                          </Button>
                        </div>
                      </div>
                      <p className="text-[11px] text-destructive/80 font-body">{result.reason}</p>
                      <div className="grid grid-cols-2 gap-2 text-[10px]">
                        <div className="bg-background/60 rounded p-1.5">
                          <span className="text-muted-foreground block mb-0.5">🇬🇧 الأصل:</span>
                          <span dir="ltr" className="block truncate">{result.original.slice(0, 80)}{result.original.length > 80 ? '...' : ''}</span>
                        </div>
                        <div className="bg-background/60 rounded p-1.5">
                          <span className="text-muted-foreground block mb-0.5">🇸🇦 الترجمة:</span>
                          <span dir="rtl" className="block truncate">{result.translation.slice(0, 80)}{result.translation.length > 80 ? '...' : ''}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {hasScanned && results.length === 0 && (
              <div className="text-center py-4">
                <Check className="w-6 h-6 text-emerald-400 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">لم يتم العثور على ترجمات مُزاحة ✅</p>
              </div>
            )}
          </CollapsibleContent>
        </CardContent>
      </Collapsible>
    </Card>
  );
}
