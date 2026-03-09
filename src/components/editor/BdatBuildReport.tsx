import React from "react";
import { CheckCircle2, AlertTriangle, FileDown, XCircle } from "lucide-react";
import { BdatFileStat } from "@/hooks/useEditorBuild";

interface BdatBuildReportProps {
  stats: BdatFileStat[];
}

const BdatBuildReport: React.FC<BdatBuildReportProps> = ({ stats }) => {
  if (!stats.length) return null;

  const totalFiles = stats.length;
  const totalStrings = stats.reduce((s, f) => s + f.total, 0);
  const totalTranslated = stats.reduce((s, f) => s + f.translated, 0);

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/30 overflow-hidden" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border">
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <FileDown className="w-3.5 h-3.5 text-primary" />
          <span>تقرير البناء</span>
          <span className="text-muted-foreground">— {totalFiles} {totalFiles === 1 ? 'ملف' : 'ملفات'}</span>
        </div>
        <div className="text-xs font-mono font-bold text-primary">
          {totalTranslated} / {totalStrings}
          <span className="font-normal text-muted-foreground mr-1">نص مترجم</span>
        </div>
      </div>

      {/* Per-file rows */}
      <div className="divide-y divide-border/50 max-h-48 overflow-y-auto">
        {stats.map((f) => {
          const pct = f.total > 0 ? Math.round((f.translated / f.total) * 100) : 0;
          const isFullyTranslated = f.translated === f.total && f.total > 0;
          const isPartial = f.translated > 0 && f.translated < f.total;
          const isNone = f.translated === 0;

          return (
            <div key={f.fileName} className="flex items-center gap-2 px-3 py-2">
              {/* Icon */}
              <div className="shrink-0">
                {f.hasError ? (
                  <XCircle className="w-3.5 h-3.5 text-destructive" />
                ) : isFullyTranslated ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-secondary" />
                ) : isPartial ? (
                  <AlertTriangle className="w-3.5 h-3.5 text-accent" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-muted-foreground" />
                )}
              </div>

              {/* File name */}
              <span className="flex-1 truncate text-xs font-mono text-foreground" title={f.fileName}>
                {f.fileName}
              </span>

              {/* Progress bar + count */}
              <div className="flex items-center gap-2 shrink-0">
                {!f.hasError && f.total > 0 && (
                  <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        isFullyTranslated
                          ? "bg-secondary"
                          : isPartial
                          ? "bg-accent"
                          : "bg-muted-foreground/30"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
                <span className={`text-xs font-mono font-bold tabular-nums ${
                  f.hasError
                    ? "text-destructive"
                    : isFullyTranslated
                    ? "text-secondary"
                    : isPartial
                    ? "text-accent"
                    : "text-muted-foreground"
                }`}>
                  {f.hasError ? (f.hasError === true ? "خطأ" : f.hasError) : `${f.translated}/${f.total}`}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default BdatBuildReport;
