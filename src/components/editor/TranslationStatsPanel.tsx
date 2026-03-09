import { Card, CardContent } from "@/components/ui/card";
import { BookOpen, Lock, FileText, Zap, TrendingUp } from "lucide-react";

export interface GlossarySessionStats {
  directMatches: number;
  lockedTerms: number;
  contextTerms: number;
  batchesCompleted: number;
  totalBatches: number;
  textsTranslated: number;
  freeTranslations: number; // TM + glossary exact
}

interface TranslationStatsPanelProps {
  stats: GlossarySessionStats;
  translating: boolean;
}

const TranslationStatsPanel = ({ stats, translating }: TranslationStatsPanelProps) => {
  const hasAnyStats = stats.directMatches > 0 || stats.lockedTerms > 0 || stats.contextTerms > 0 || stats.freeTranslations > 0;
  if (!hasAnyStats && !translating) return null;

  const totalAI = stats.textsTranslated;
  const totalFree = stats.freeTranslations;
  const estimatedCostPerBatch = 0.003; // rough estimate per batch in $
  const estimatedCost = stats.batchesCompleted * estimatedCostPerBatch;

  return (
    <Card className="mb-4 border-primary/20 bg-gradient-to-r from-primary/5 to-accent/5">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-primary" />
          <span className="text-sm font-display font-bold">📊 إحصائيات الترجمة الحية</span>
          {translating && (
            <span className="text-xs text-muted-foreground animate-pulse font-body">
              (الدفعة {stats.batchesCompleted}/{stats.totalBatches})
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Locked Terms */}
          <div className="flex items-center gap-2 bg-background/60 rounded-lg p-2.5">
            <Lock className="w-4 h-4 text-orange-500 shrink-0" />
            <div>
              <p className="text-lg font-display font-bold leading-none">{stats.lockedTerms}</p>
              <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">🔒 مصطلح مُقفَل</p>
            </div>
          </div>

          {/* Direct Matches */}
          <div className="flex items-center gap-2 bg-background/60 rounded-lg p-2.5">
            <BookOpen className="w-4 h-4 text-green-500 shrink-0" />
            <div>
              <p className="text-lg font-display font-bold leading-none">{stats.directMatches}</p>
              <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">📖 مطابقة مباشرة</p>
            </div>
          </div>

          {/* Context Terms */}
          <div className="flex items-center gap-2 bg-background/60 rounded-lg p-2.5">
            <FileText className="w-4 h-4 text-blue-500 shrink-0" />
            <div>
              <p className="text-lg font-display font-bold leading-none">{stats.contextTerms}</p>
              <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">📋 مصطلح سياقي</p>
            </div>
          </div>

          {/* Free vs AI */}
          <div className="flex items-center gap-2 bg-background/60 rounded-lg p-2.5">
            <Zap className="w-4 h-4 text-yellow-500 shrink-0" />
            <div>
              <p className="text-lg font-display font-bold leading-none">{totalFree}</p>
              <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">🆓 ترجمة مجانية</p>
            </div>
          </div>
        </div>

        {/* Cost estimation row */}
        {stats.batchesCompleted > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground font-body border-t border-border/50 pt-2">
            <span>🤖 AI: <strong className="text-foreground">{totalAI}</strong> نص في <strong className="text-foreground">{stats.batchesCompleted}</strong> دفعة</span>
            <span>💰 التكلفة التقديرية: <strong className="text-foreground">~${estimatedCost.toFixed(3)}</strong></span>
            {totalFree > 0 && (
              <span className="text-green-600">✨ وفّرت {totalFree} طلب AI مجاناً</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default TranslationStatsPanel;
