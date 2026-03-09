import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, X, ChevronDown, ChevronUp } from "lucide-react";

interface ConsistencyGroup {
  term: string;
  variants: { key: string; translation: string; file: string }[];
}

interface ConsistencyResultsPanelProps {
  results: { groups: ConsistencyGroup[]; aiSuggestions: { best: string; reason: string }[] };
  onApplyFix: (groupIndex: number, bestTranslation: string) => void;
  onApplyAll: () => void;
  onClose: () => void;
}

const ConsistencyResultsPanel: React.FC<ConsistencyResultsPanelProps> = ({ results, onApplyFix, onApplyAll, onClose }) => {
  const [expandedGroup, setExpandedGroup] = React.useState<number | null>(0);

  if (results.groups.length === 0) return null;

  return (
    <Card className="mb-6 border-amber-500/30 bg-amber-500/5">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display font-bold text-sm">🔍 فحص اتساق المصطلحات — {results.groups.length} تناقض</h3>
          <div className="flex gap-2">
            {results.aiSuggestions.length > 0 && (
              <Button variant="default" size="sm" onClick={onApplyAll} className="text-xs font-display">
                <CheckCircle2 className="w-3 h-3" /> توحيد الكل تلقائياً ✨
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onClose}><X className="w-4 h-4" /></Button>
          </div>
        </div>

        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {results.groups.map((group, i) => {
            const suggestion = results.aiSuggestions[i];
            const isExpanded = expandedGroup === i;
            const uniqueTranslations = [...new Set(group.variants.map(v => v.translation.trim()))];

            return (
              <div key={i} className="rounded-lg border border-border/50 bg-card/50 overflow-hidden">
                <button
                  onClick={() => setExpandedGroup(isExpanded ? null : i)}
                  className="w-full flex items-center justify-between p-3 text-right hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    <span className="text-xs text-muted-foreground">{uniqueTranslations.length} ترجمات مختلفة • {group.variants.length} موضع</span>
                  </div>
                  <span className="font-mono text-sm font-bold" dir="ltr">"{group.term}"</span>
                </button>

                {isExpanded && (
                  <div className="px-3 pb-3 space-y-2">
                    {/* Show unique translations */}
                    <div className="space-y-1">
                      {uniqueTranslations.map((t, j) => {
                        const count = group.variants.filter(v => v.translation.trim() === t).length;
                        const isBest = suggestion?.best === t;
                        return (
                          <div key={j} className={`flex items-center justify-between text-xs p-2 rounded ${isBest ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-muted/30'}`}>
                            <div className="flex items-center gap-2">
                              {isBest && <span className="text-emerald-500 text-[10px]">✅ مقترح</span>}
                              <Button
                                variant="ghost" size="sm"
                                onClick={() => onApplyFix(i, t)}
                                className="h-6 px-2 text-[10px] font-display"
                              >
                                توحيد بهذه
                              </Button>
                            </div>
                            <div className="text-right">
                              <span className="font-body">{t}</span>
                              <span className="text-muted-foreground mr-2">({count}×)</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* AI suggestion reason */}
                    {suggestion?.reason && (
                      <p className="text-[10px] text-muted-foreground bg-muted/20 rounded p-2">
                        💡 {suggestion.reason}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};

export default ConsistencyResultsPanel;
