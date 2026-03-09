import React from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { BarChart3, Maximize2, Minimize2, FileText, Layers } from "lucide-react";
import { BuildStats } from "@/hooks/useEditorBuild";

interface BuildStatsDialogProps {
  stats: BuildStats | null;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const BuildStatsDialog: React.FC<BuildStatsDialogProps> = ({ stats, onClose }) => {
  if (!stats) return null;

  const categoryEntries = Object.entries(stats.categories).sort((a, b) => b[1].modified - a[1].modified);

  return (
    <Dialog open={!!stats} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <BarChart3 className="w-5 h-5 text-primary" />
            إحصائيات البناء
          </DialogTitle>
          <DialogDescription>تفاصيل عملية البناء الأخيرة</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Key metrics */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border p-3 text-center">
              <div className="text-2xl font-bold text-primary">{stats.modifiedCount}</div>
              <div className="text-xs text-muted-foreground">نص معدّل</div>
            </div>
            <div className="rounded-lg border border-border p-3 text-center">
              <div className="text-2xl font-bold text-accent">{stats.expandedCount}</div>
              <div className="text-xs text-muted-foreground">نص تم توسيعه 📐</div>
            </div>
          </div>

          {/* Byte usage */}
          <div className="rounded-lg border border-border p-3 space-y-2">
            <div className="text-sm font-medium">استخدام البايت</div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>المتوسط</span>
              <span className={stats.avgBytePercent > 85 ? 'text-amber-600 font-bold' : ''}>{stats.avgBytePercent}%</span>
            </div>
            <Progress value={Math.min(stats.avgBytePercent, 100)} className="h-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>الأقصى</span>
              <span className={stats.maxBytePercent > 100 ? 'text-destructive font-bold' : stats.maxBytePercent > 85 ? 'text-amber-600 font-bold' : ''}>{stats.maxBytePercent}%</span>
            </div>
            <Progress value={Math.min(stats.maxBytePercent, 100)} className="h-2" />
          </div>

          {/* Longest / Shortest */}
          {(stats.longest || stats.shortest) && (
            <div className="rounded-lg border border-border p-3 space-y-2">
              {stats.longest && (
                <div className="flex items-center gap-2 text-xs">
                  <Maximize2 className="w-3.5 h-3.5 text-destructive shrink-0" />
                  <span className="text-muted-foreground">الأطول:</span>
                  <span className="truncate font-mono text-[10px]">{stats.longest.key}</span>
                  <span className="shrink-0 font-bold">{formatBytes(stats.longest.bytes)}</span>
                </div>
              )}
              {stats.shortest && (
                <div className="flex items-center gap-2 text-xs">
                  <Minimize2 className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="text-muted-foreground">الأقصر:</span>
                  <span className="truncate font-mono text-[10px]">{stats.shortest.key}</span>
                  <span className="shrink-0 font-bold">{formatBytes(stats.shortest.bytes)}</span>
                </div>
              )}
            </div>
          )}

          {/* File size */}
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2 text-xs">
              <FileText className="w-3.5 h-3.5 text-muted-foreground" />
              <span>حجم الملف: <strong>{formatBytes(stats.fileSize)}</strong></span>
              {stats.compressedSize && (
                <span className="text-muted-foreground">→ مضغوط: <strong>{formatBytes(stats.compressedSize)}</strong></span>
              )}
            </div>
          </div>

          {/* Category breakdown */}
          {categoryEntries.length > 0 && (
            <div className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Layers className="w-4 h-4 text-primary" />
                توزيع الفئات
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {categoryEntries.map(([cat, data]) => (
                  <div key={cat} className="flex justify-between items-center text-xs">
                    <span className="truncate">{cat}</span>
                    <span className="shrink-0 font-mono text-muted-foreground">{data.modified}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default BuildStatsDialog;
