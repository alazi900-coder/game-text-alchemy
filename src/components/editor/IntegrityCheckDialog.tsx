import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, XCircle, RefreshCw, ShieldCheck } from "lucide-react";

export interface IntegrityFileResult {
  fileName: string;
  /** عدد المفاتيح المترجمة التي تتطابق مع ملف IDB */
  matched: number;
  /** إجمالي النصوص في الملف */
  total: number;
  /** مفاتيح مترجمة لكن لا يوجد لها ملف في IDB (جلسة قديمة) */
  orphaned: number;
  /** هل المفاتيح تستخدم الصيغة القديمة التسلسلية */
  isLegacyFormat: boolean;
  /** هل الملف موجود في IDB */
  fileExists: boolean;
}

export interface IntegrityCheckResult {
  /** ملفات BDAT المفحوصة */
  files: IntegrityFileResult[];
  /** إجمالي الترجمات التي ستُطبَّق فعلاً */
  willApply: number;
  /** ترجمات ستُضيَّع (جلسة قديمة) */
  orphaned: number;
  /** هل يوجد جلسة قديمة تحتاج إعادة رفع */
  hasLegacy: boolean;
  /** هل الجلسة سليمة تماماً */
  isHealthy: boolean;
}

interface IntegrityCheckDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: IntegrityCheckResult | null;
  checking: boolean;
  onRecheck: () => void;
}

const IntegrityCheckDialog = ({ open, onOpenChange, result, checking, onRecheck }: IntegrityCheckDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="font-display text-lg flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            التحقق من سلامة الترجمة
          </DialogTitle>
          <DialogDescription className="font-body text-sm">
            فحص تطابق مفاتيح الترجمة مع ملفات اللعبة المرفوعة
          </DialogDescription>
        </DialogHeader>

        {checking && (
          <div className="flex items-center justify-center gap-3 py-8 text-muted-foreground font-body">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span>جارٍ الفحص...</span>
          </div>
        )}

        {!checking && result && (
          <div className="space-y-4">
            {/* Overall status */}
            <div className={`p-4 rounded-lg border text-center ${
              result.isHealthy
                ? "bg-secondary/10 border-secondary/30"
                : result.hasLegacy
                ? "bg-destructive/10 border-destructive/30"
                : "bg-accent/10 border-accent/30"
            }`}>
              <div className="flex items-center justify-center gap-2 mb-1">
                {result.isHealthy ? (
                  <CheckCircle2 className="w-6 h-6 text-secondary" />
                ) : result.hasLegacy ? (
                  <XCircle className="w-6 h-6 text-destructive" />
                ) : (
                  <AlertTriangle className="w-6 h-6 text-accent" />
                )}
                <p className="font-display font-bold text-lg">
                  {result.isHealthy
                    ? "الجلسة سليمة ✅"
                    : result.hasLegacy
                    ? "جلسة قديمة — يجب إعادة الرفع ⚠️"
                    : "يوجد تحذيرات"}
                </p>
              </div>
              <p className="text-sm font-body text-muted-foreground">
                <span className="font-bold text-foreground">{result.willApply}</span> نص مُترجم سيُطبَّق
                {result.orphaned > 0 && ` • ${result.orphaned} مفتاح بلا ملف`}
              </p>
              <p className="text-xs font-body text-muted-foreground mt-1">
                الأرقام تُظهر النصوص المُترجمة فعلاً (ذات محتوى)، ليس إجمالي النصوص المستخرجة</p>
            </div>

            {/* Legacy warning */}
            {result.hasLegacy && (
              <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/20 text-sm font-body space-y-1">
                <p className="font-bold text-destructive">سبب المشكلة:</p>
                <p className="text-muted-foreground">
                  الجلسة الحالية تستخدم نظام مفاتيح قديم (تسلسلي) لا يتطابق مع نظام البناء الجديد.
                  يجب العودة لصفحة المعالجة ورفع الملفات من جديد لتوليد مفاتيح صحيحة.
                </p>
                <p className="text-xs text-destructive/80 font-display font-bold mt-2">
                  ⚡ الحل: العودة للمعالجة ← رفع ملفات BDAT ← الترجمة ← البناء
                </p>
              </div>
            )}

            {/* Per-file breakdown */}
            {result.files.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-display font-bold text-muted-foreground">تفاصيل الملفات:</p>
                <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                  {result.files.map(f => (
                    <div
                      key={f.fileName}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-body ${
                        !f.fileExists
                          ? "bg-destructive/5 border-destructive/20"
                          : f.isLegacyFormat
                          ? "bg-destructive/5 border-destructive/20"
                          : f.matched === 0
                          ? "bg-muted/40 border-border"
                          : "bg-secondary/5 border-secondary/20"
                      }`}
                    >
                      {/* Icon */}
                      {!f.fileExists || f.isLegacyFormat ? (
                        <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
                      ) : f.matched > 0 ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-secondary shrink-0" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      )}

                      {/* File name */}
                      <span className="truncate flex-1 font-mono text-[11px]">{f.fileName}</span>

                      {/* Badges */}
                      <div className="flex items-center gap-1 shrink-0">
                        {f.isLegacyFormat && (
                          <Badge variant="destructive" className="text-[10px] px-1 py-0">قديم</Badge>
                        )}
                        {!f.fileExists && (
                          <Badge variant="destructive" className="text-[10px] px-1 py-0">غير موجود</Badge>
                        )}
                        <span className={`font-bold text-xs ${f.matched > 0 ? "text-secondary" : "text-muted-foreground"}`}>
                          {f.matched} مُترجم
                        </span>
                        {f.total > 0 && (
                          <span className="text-muted-foreground text-[10px]">/ {f.total}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* No files */}
            {result.files.length === 0 && (
              <div className="p-3 rounded bg-muted/30 text-center text-sm font-body text-muted-foreground">
                لا توجد ملفات BDAT ثنائية مرفوعة في الجلسة الحالية
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onRecheck} disabled={checking} className="font-body gap-1">
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? "animate-spin" : ""}`} />
            إعادة الفحص
          </Button>
          <Button onClick={() => onOpenChange(false)} className="font-display font-bold">
            حسناً
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default IntegrityCheckDialog;
