import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileDown, Loader2, AlertTriangle, CheckCircle2, Info } from "lucide-react";

export interface BuildPreview {
  totalTranslations: number;
  protectedCount: number;
  normalCount: number;
  categories: Record<string, number>;
  sampleKeys: string[];
  // Warning stats
  overflowCount?: number;
  unprocessedArabicCount?: number;
  hasBdatFiles?: boolean;
  isDemo?: boolean;
  affectedFileCount?: number;
}

interface BuildConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: BuildPreview | null;
  onConfirm: () => void;
  building: boolean;
}

const BuildConfirmDialog = ({ open, onOpenChange, preview, onConfirm, building }: BuildConfirmDialogProps) => {
  if (!preview) return null;

  const hasWarnings = (preview.overflowCount || 0) > 0 || (preview.unprocessedArabicCount || 0) > 0 || preview.isDemo;
  const hasCritical = (preview.overflowCount || 0) > 0 || preview.isDemo;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">تأكيد البناء 🏗️</DialogTitle>
          <DialogDescription className="font-body text-sm">
            مراجعة الترجمات التي ستُرسل للبناء
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Total count */}
          <div className="text-center p-4 rounded-lg bg-primary/10 border border-primary/20">
            <p className="text-3xl font-display font-bold text-primary">{preview.totalTranslations}</p>
            <p className="text-sm text-muted-foreground font-body">ترجمة ستُرسل للبناء</p>
          </div>

          {/* Breakdown */}
          <div className="grid grid-cols-2 gap-2 text-sm font-body">
            <div className="p-2 rounded bg-secondary/10 border border-secondary/20 text-center">
              <p className="font-bold text-secondary">{preview.normalCount}</p>
              <p className="text-xs text-muted-foreground">عادية</p>
            </div>
            <div className="p-2 rounded bg-accent/10 border border-accent/20 text-center">
              <p className="font-bold text-accent">{preview.protectedCount}</p>
              <p className="text-xs text-muted-foreground">محمية</p>
            </div>
          </div>

          {/* File info */}
          {preview.hasBdatFiles !== undefined && (
            <div className="flex items-center gap-2 text-xs font-body px-2 py-1.5 rounded bg-muted/50">
              {preview.hasBdatFiles ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-secondary shrink-0" />
                  <span>ملفات BDAT حقيقية — {preview.affectedFileCount || 0} ملف سيتأثر</span>
                </>
              ) : (
                <>
                  <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground">لم يتم رفع ملفات BDAT</span>
                </>
              )}
            </div>
          )}

          {/* Warnings Section */}
          {hasWarnings && (
            <div className="space-y-2">
              <p className="text-xs font-display font-bold text-muted-foreground flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> تحذيرات ما قبل البناء:
              </p>

              {preview.isDemo && (
                <div className="flex items-start gap-2 text-xs font-body p-2 rounded border border-destructive/30 bg-destructive/5">
                  <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-destructive">بيانات تجريبية!</span>
                    <span className="text-muted-foreground"> — ارفع ملفات BDAT حقيقية أولاً</span>
                  </div>
                </div>
              )}

              {(preview.overflowCount || 0) > 0 && (
                <div className="flex items-start gap-2 text-xs font-body p-2 rounded border border-destructive/30 bg-destructive/5">
                  <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-destructive">⛔ {preview.overflowCount} ترجمة تتجاوز حد البايت</span>
                    <span className="text-muted-foreground"> — ستُتخطى عند البناء</span>
                  </div>
                </div>
              )}

              {(preview.unprocessedArabicCount || 0) > 0 && (
                <div className="flex items-start gap-2 text-xs font-body p-2 rounded border border-secondary/30 bg-secondary/5">
                  <Info className="w-3.5 h-3.5 text-secondary shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-secondary">⚠️ {preview.unprocessedArabicCount} نص لم يُعالَج</span>
                    <span className="text-muted-foreground"> — سيتم معالجتها تلقائياً</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* All clear */}
          {!hasWarnings && preview.totalTranslations > 0 && (
            <div className="flex items-center gap-2 text-xs font-body p-2 rounded border border-secondary/30 bg-secondary/5">
              <CheckCircle2 className="w-3.5 h-3.5 text-secondary shrink-0" />
              <span className="font-bold text-secondary">✅ جاهز للبناء — لا توجد تحذيرات</span>
            </div>
          )}

          {/* Categories */}
          {Object.keys(preview.categories).length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-display font-bold text-muted-foreground">توزيع حسب الفئة:</p>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {Object.entries(preview.categories)
                  .sort((a, b) => b[1] - a[1])
                  .map(([cat, count]) => (
                    <div key={cat} className="flex justify-between items-center text-xs font-body px-2 py-1 rounded bg-muted/50">
                      <span className="truncate">{cat}</span>
                      <span className="font-bold text-foreground">{count}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {preview.totalTranslations === 0 && (
            <div className="p-3 rounded bg-destructive/10 border border-destructive/20 text-center">
              <p className="text-sm text-destructive font-display font-bold">⚠️ لا توجد ترجمات للإرسال!</p>
              <p className="text-xs text-muted-foreground font-body">تأكد من أنك أدخلت ترجمات في المحرر</p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="font-body">
            إلغاء
          </Button>
          <Button onClick={onConfirm} disabled={building || preview.totalTranslations === 0} className="font-display font-bold">
            {building ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <FileDown className="w-4 h-4 ml-2" />}
            {hasCritical ? 'بناء مع تحذيرات ⚠️' : 'بناء الملف'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BuildConfirmDialog;
