import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, XCircle, Loader2, ShieldCheck, FileDown } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";

export interface VerificationCheck {
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface BuildVerificationResult {
  checks: VerificationCheck[];
  outputSizeBytes: number;
  originalSizeBytes?: number;
  translationsApplied: number;
  translationsExpected: number;
  autoProcessedArabic: number;
  tagsFixed: number;
  tagsOk: number;
  filesBuilt: number;
  buildDurationMs: number;
}

interface BuildVerificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: BuildVerificationResult | null;
}

const StatusIcon = ({ status }: { status: VerificationCheck["status"] }) => {
  switch (status) {
    case "pass": return <CheckCircle2 className="w-4 h-4 text-secondary shrink-0" />;
    case "warn": return <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />;
    case "fail": return <XCircle className="w-4 h-4 text-destructive shrink-0" />;
  }
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const BuildVerificationDialog = ({ open, onOpenChange, result }: BuildVerificationDialogProps) => {
  if (!result) return null;

  const failCount = result.checks.filter(c => c.status === "fail").length;
  const warnCount = result.checks.filter(c => c.status === "warn").length;
  const allPass = failCount === 0 && warnCount === 0;
  const pct = result.translationsExpected > 0
    ? Math.round((result.translationsApplied / result.translationsExpected) * 100)
    : 0;

  const sizeRatio = result.originalSizeBytes && result.originalSizeBytes > 0
    ? (result.outputSizeBytes / result.originalSizeBytes * 100).toFixed(0)
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" dir="rtl">
        <DialogHeader>
          <DialogTitle className="font-display text-lg flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            تقرير التحقق بعد البناء
          </DialogTitle>
          <DialogDescription className="font-body text-sm">
            نتائج فحص الملف الناتج
          </DialogDescription>
        </DialogHeader>

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border border-border p-2">
            <div className="text-lg font-bold text-primary">{result.translationsApplied}</div>
            <div className="text-[10px] text-muted-foreground">ترجمة مُطبّقة</div>
          </div>
          <div className="rounded-lg border border-border p-2">
            <div className="text-lg font-bold text-secondary">{result.filesBuilt}</div>
            <div className="text-[10px] text-muted-foreground">ملف مبني</div>
          </div>
          <div className="rounded-lg border border-border p-2">
            <div className="text-lg font-bold text-accent">{(result.buildDurationMs / 1000).toFixed(1)}s</div>
            <div className="text-[10px] text-muted-foreground">مدة البناء</div>
          </div>
        </div>

        {/* Coverage bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs font-body text-muted-foreground">
            <span>تغطية الترجمة</span>
            <span className="font-bold">{pct}%</span>
          </div>
          <Progress value={pct} className="h-2" />
        </div>

        {/* Size comparison */}
        {result.originalSizeBytes != null && result.originalSizeBytes > 0 && (
          <div className="flex justify-between items-center text-xs font-body px-2 py-1.5 rounded bg-muted/50 border border-border/50">
            <span className="text-muted-foreground">الحجم: {formatBytes(result.originalSizeBytes)} → {formatBytes(result.outputSizeBytes)}</span>
            <span className={`font-bold ${Number(sizeRatio) > 120 ? 'text-destructive' : Number(sizeRatio) > 105 ? 'text-yellow-500' : 'text-secondary'}`}>
              {sizeRatio}%
            </span>
          </div>
        )}

        {/* Checks list */}
        <ScrollArea className="max-h-48">
          <div className="space-y-1.5">
            {result.checks.map((check, i) => (
              <div key={i} className="flex items-start gap-2 p-2 rounded bg-muted/30 border border-border/50">
                <StatusIcon status={check.status} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-display font-bold">{check.label}</p>
                  <p className="text-[10px] text-muted-foreground font-body mt-0.5">{check.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        {/* Overall status */}
        <div className={`text-center p-3 rounded-lg border ${
          allPass ? 'bg-secondary/10 border-secondary/30' :
          failCount > 0 ? 'bg-destructive/10 border-destructive/30' :
          'bg-yellow-500/10 border-yellow-500/30'
        }`}>
          <p className="text-sm font-display font-bold">
            {allPass ? '✅ البناء سليم — جاهز للعبة 🎮' :
             failCount > 0 ? `⛔ ${failCount} مشكلة — تحقق من الملف` :
             `⚠️ ${warnCount} تحذير — قد يعمل الملف`}
          </p>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} className="font-display font-bold w-full">
            حسناً
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BuildVerificationDialog;
