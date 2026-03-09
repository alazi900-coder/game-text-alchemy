import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Sparkles, Loader2 } from "lucide-react";
import { FILE_CATEGORIES } from "./types";

interface ReviewPanelProps {
  reviewResults: { issues: any[]; summary: any } | null;
  shortSuggestions: any[] | null;
  improveResults: any[] | null;
  suggestingShort: boolean;
  filterCategory: string[];
  filterFile: string;
  filterStatus: string;
  search: string;
  handleSuggestShorterTranslations: () => void;
  handleApplyShorterTranslation: (key: string, suggested: string) => void;
  handleApplyAllShorterTranslations: () => void;
  handleApplyImprovement: (key: string, improved: string) => void;
  handleApplyAllImprovements: () => void;
  setReviewResults: (r: any) => void;
  setShortSuggestions: (s: any) => void;
  setImproveResults: (r: any) => void;
}

const ReviewPanel: React.FC<ReviewPanelProps> = ({
  reviewResults, shortSuggestions, improveResults, suggestingShort,
  filterCategory, filterFile, filterStatus, search,
  handleSuggestShorterTranslations, handleApplyShorterTranslation, handleApplyAllShorterTranslations,
  handleApplyImprovement, handleApplyAllImprovements,
  setReviewResults, setShortSuggestions, setImproveResults,
}) => {
  return (
    <>
      {reviewResults && (
        <Card className="mb-4 border-border bg-card">
          <CardContent className="p-4">
            <h3 className="font-display font-bold mb-3 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5" />
              تقرير المراجعة الذكية
            </h3>
            <div className="mb-3 p-2 rounded bg-secondary/30 border border-secondary/50 text-xs text-muted-foreground">
              <p className="font-medium mb-1">نطاق المراجعة:</p>
              <p>
                {(() => {
                  const filters: string[] = [];
                  if (filterCategory.length > 0) {
                    for (const catId of filterCategory) {
                      const category = FILE_CATEGORIES.find(c => c.id === catId);
                      if (category) filters.push(`${category.emoji} ${category.label}`);
                    }
                  } else { filters.push("📚 جميع الفئات"); }
                  if (filterFile !== "all") filters.push(`📄 ملف محدد`);
                  if (filterStatus !== "all") {
                    const statusLabels: Record<string, string> = {
                      "translated": "✅ مترجمة", "untranslated": "⬜ غير مترجمة", "problems": "🚨 بها مشاكل",
                      "needs-improve": "⚠️ تحتاج تحسين", "too-short": "📏 قصيرة جداً", "too-long": "📐 طويلة جداً",
                      "stuck-chars": "🔤 أحرف ملتصقة", "mixed-lang": "🌐 عربي + إنجليزي"
                    };
                    if (statusLabels[filterStatus]) filters.push(statusLabels[filterStatus]);
                  }
                  if (search) filters.push(`🔍 بحث: "${search}"`);
                  return filters.join(" • ");
                })()}
              </p>
            </div>
            <div className="flex gap-4 mb-3 text-sm">
              <span>✅ فُحص: {reviewResults.summary.checked}</span>
              <span className="text-destructive">❌ أخطاء: {reviewResults.summary.errors}</span>
              <span className="text-amber-500">⚠️ تحذيرات: {reviewResults.summary.warnings}</span>
            </div>
            {reviewResults.issues.length === 0 ? (
              <p className="text-sm text-muted-foreground">🎉 لا توجد مشاكل! الترجمات تبدو سليمة.</p>
            ) : (
              <div className="max-h-60 overflow-y-auto space-y-2">
                {reviewResults.issues.slice(0, 50).map((issue: any, i: number) => (
                  <div key={i} className={`p-2 rounded text-xs border ${issue.severity === 'error' ? 'border-destructive/30 bg-destructive/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
                    <p className="font-mono text-muted-foreground mb-1">{issue.key}</p>
                    <p>{issue.message}</p>
                    {issue.suggestion && <p className="text-primary mt-1">💡 {issue.suggestion}</p>}
                  </div>
                ))}
                {reviewResults.issues.length > 50 && (
                  <p className="text-xs text-muted-foreground text-center">... و {reviewResults.issues.length - 50} مشكلة أخرى</p>
                )}
              </div>
            )}
            <div className="flex gap-2 mt-3">
              <Button variant="outline" size="sm" onClick={handleSuggestShorterTranslations} disabled={suggestingShort || reviewResults.issues.length === 0} className="text-xs border-primary/30">
                {suggestingShort ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Sparkles className="w-3 h-3 mr-1" />}
                اقترح بدائل أقصر
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setReviewResults(null); setShortSuggestions(null); }} className="text-xs">إغلاق ✕</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {shortSuggestions && shortSuggestions.length > 0 && (
        <Card className="mb-4 border-border bg-card">
          <CardContent className="p-4">
            <h3 className="font-display font-bold mb-3 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              بدائل أقصر مقترحة
            </h3>
            <div className="max-h-64 overflow-y-auto space-y-3">
              {shortSuggestions.map((suggestion: any, i: number) => (
                <div key={i} className="p-3 rounded border border-border/50 bg-background/50">
                  <p className="text-xs text-muted-foreground mb-2">{suggestion.key}</p>
                  <p className="text-xs mb-2"><strong>الأصلي:</strong> {suggestion.original}</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs mb-2">
                    <div>
                      <p className="text-muted-foreground">الحالي ({suggestion.currentBytes}/{suggestion.maxBytes} بايت)</p>
                      <p className="p-2 bg-destructive/5 rounded border border-destructive/30">{suggestion.current}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">المقترح ({suggestion.suggestedBytes}/{suggestion.maxBytes} بايت)</p>
                      <p className="p-2 bg-primary/5 rounded border border-primary/30">{suggestion.suggested}</p>
                    </div>
                  </div>
                  <Button size="sm" onClick={() => { handleApplyShorterTranslation(suggestion.key, suggestion.suggested); setShortSuggestions(shortSuggestions.filter((_: any, idx: number) => idx !== i)); }} className="text-xs h-7">
                    ✓ تطبيق المقترح
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <Button size="sm" onClick={handleApplyAllShorterTranslations} className="text-xs h-7 flex-1">✓ تطبيق الكل ({shortSuggestions.length})</Button>
              <Button variant="ghost" size="sm" onClick={() => setShortSuggestions(null)} className="mt-0 text-xs">إغلاق الاقتراحات ✕</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {improveResults && improveResults.length > 0 && (
        <Card className="mb-4 border-border bg-card">
          <CardContent className="p-4">
            <h3 className="font-display font-bold mb-3 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-secondary" />
              تحسينات مقترحة ({improveResults.length})
            </h3>
            <div className="max-h-80 overflow-y-auto space-y-3">
              {improveResults.map((item: any, i: number) => (
                <div key={i} className="p-3 rounded border border-border/50 bg-background/50">
                  <p className="text-xs text-muted-foreground mb-2 font-mono">{item.key}</p>
                  <p className="text-xs mb-2"><strong>الأصلي:</strong> {item.original}</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs mb-2">
                    <div>
                      <p className="text-muted-foreground">الحالي ({item.currentBytes} بايت)</p>
                      <p className="p-2 bg-muted/30 rounded border border-border/30" dir="rtl">{item.current}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">المحسّن ({item.improvedBytes} بايت){item.maxBytes > 0 && item.improvedBytes > item.maxBytes ? ' ⚠️ يتجاوز الحد' : ''}</p>
                      <p className="p-2 bg-secondary/5 rounded border border-secondary/30" dir="rtl">{item.improved}</p>
                    </div>
                  </div>
                  <Button size="sm" onClick={() => { handleApplyImprovement(item.key, item.improved); setImproveResults(improveResults.filter((_: any, idx: number) => idx !== i)); }} disabled={item.maxBytes > 0 && item.improvedBytes > item.maxBytes} className="text-xs h-7">
                    ✓ تطبيق التحسين
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <Button size="sm" onClick={handleApplyAllImprovements} className="text-xs h-7 flex-1">✓ تطبيق الكل ({improveResults.length})</Button>
              <Button variant="ghost" size="sm" onClick={() => setImproveResults(null)} className="text-xs">إغلاق ✕</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
};

export default ReviewPanel;
