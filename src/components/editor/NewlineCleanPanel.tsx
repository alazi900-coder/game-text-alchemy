import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, X, XCircle } from "lucide-react";

export interface NewlineCleanResult {
  key: string;
  before: string;
  after: string;
  count: number;
  status: 'pending' | 'accepted' | 'rejected';
}

interface NewlineCleanPanelProps {
  results: NewlineCleanResult[];
  onAccept: (key: string) => void;
  onReject: (key: string) => void;
  onAcceptAll: () => void;
  onClose: () => void;
}

const NewlineCleanPanel: React.FC<NewlineCleanPanelProps> = ({
  results, onAccept, onReject, onAcceptAll, onClose,
}) => {
  const pending = results.filter(r => r.status === 'pending');
  const accepted = results.filter(r => r.status === 'accepted').length;
  const rejected = results.filter(r => r.status === 'rejected').length;

  if (results.length === 0) return null;

  return (
    <Card className="mb-6 border-primary/30 bg-primary/5">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display font-bold text-sm">
            🧹 تنظيف رموز غير مرغوبة — {results.length} نتيجة
            {accepted > 0 && <span className="text-secondary mr-2"> ✅ {accepted}</span>}
            {rejected > 0 && <span className="text-destructive mr-2"> ❌ {rejected}</span>}
          </h3>
          <div className="flex gap-2">
            {pending.length > 0 && (
              <Button variant="default" size="sm" onClick={onAcceptAll} className="text-xs font-display">
                <CheckCircle2 className="w-3 h-3" /> موافقة على الكل ({pending.length}) ✨
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {results.map((item) => {
            if (item.status !== 'pending') return null;
            return (
              <div
                key={item.key}
                className="rounded-lg border border-border/50 bg-card/50 p-3 space-y-2"
              >
                <p className="text-[10px] text-muted-foreground font-mono truncate" dir="ltr">
                  {item.key.split(':').slice(1, 3).join(':')}
                </p>

                <div className="flex items-start gap-2">
                  <span className="text-[10px] text-destructive shrink-0 mt-1">قبل:</span>
                  <p className="text-sm font-body text-foreground bg-destructive/5 rounded px-2 py-1 flex-1" dir="rtl">
                    {item.before}
                  </p>
                </div>

                <div className="flex items-start gap-2">
                  <span className="text-[10px] text-secondary shrink-0 mt-1">بعد:</span>
                  <p className="text-sm font-body text-foreground bg-secondary/5 rounded px-2 py-1 flex-1" dir="rtl">
                    {item.after}
                  </p>
                </div>

                <div className="flex items-center gap-2 justify-end">
                  <span className="text-[10px] text-muted-foreground mr-auto">
                    {item.count} رمز
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onReject(item.key)}
                    className="h-7 px-2 text-xs font-display border-destructive/30 text-destructive hover:text-destructive"
                  >
                    <XCircle className="w-3 h-3" /> رفض
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onAccept(item.key)}
                    className="h-7 px-2 text-xs font-display border-secondary/30 text-secondary hover:text-secondary"
                  >
                    <CheckCircle2 className="w-3 h-3" /> قبول
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {pending.length === 0 && (
          <p className="text-center text-sm text-muted-foreground font-body py-4">
            ✅ تمت مراجعة جميع النتائج — {accepted} مقبولة، {rejected} مرفوضة
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default NewlineCleanPanel;
