import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, X, ChevronDown, ChevronUp } from "lucide-react";

export interface MergeToBundledItem {
  key: string;
  bundledValue: string;
  editorValue: string;
  status: 'pending' | 'accepted' | 'rejected';
}

interface MergeToBundledPanelProps {
  items: MergeToBundledItem[];
  onAccept: (key: string) => void;
  onReject: (key: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onClose: () => void;
  onDownload: () => void;
}

const MergeToBundledPanel: React.FC<MergeToBundledPanelProps> = ({
  items, onAccept, onReject, onAcceptAll, onRejectAll, onClose, onDownload,
}) => {
  const [collapsed, setCollapsed] = React.useState(false);
  const pending = items.filter(i => i.status === 'pending');
  const accepted = items.filter(i => i.status === 'accepted');
  const rejected = items.filter(i => i.status === 'rejected');

  return (
    <Card className="mb-4 border-accent/30 bg-accent/5">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="font-display font-bold text-sm">📦 دمج في الترجمات المدمجة</span>
            <span className="text-xs text-muted-foreground">
              ({pending.length} معلق • {accepted.length} مقبول • {rejected.length} مرفوض)
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setCollapsed(!collapsed)} className="h-7 w-7 p-0">
              {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {!collapsed && (
          <>
            <div className="flex gap-2 mb-3 flex-wrap">
              <Button size="sm" variant="default" onClick={onAcceptAll} disabled={pending.length === 0} className="font-display text-xs">
                <CheckCircle2 className="w-3 h-3" /> قبول الكل ({pending.length})
              </Button>
              <Button size="sm" variant="destructive" onClick={onRejectAll} disabled={pending.length === 0} className="font-display text-xs">
                <X className="w-3 h-3" /> رفض الكل
              </Button>
              {accepted.length > 0 && (
                <Button size="sm" variant="secondary" onClick={onDownload} className="font-display text-xs">
                  💾 تحميل المدمجة المحدثة ({accepted.length})
                </Button>
              )}
            </div>

            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {items.filter(i => i.status === 'pending').map(item => (
                <div key={item.key} className="p-3 rounded border border-border bg-background">
                  <div className="text-[10px] text-muted-foreground font-mono mb-1 truncate" title={item.key}>
                    🔑 {item.key}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
                    <div>
                      <span className="text-[10px] text-destructive font-display">المدمجة الحالية:</span>
                      <p className="text-xs font-body bg-destructive/5 rounded p-1.5 mt-0.5 break-words" dir="auto">
                        {item.bundledValue || <span className="text-muted-foreground italic">(فارغ)</span>}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] text-secondary font-display">التعديل الجديد:</span>
                      <p className="text-xs font-body bg-secondary/5 rounded p-1.5 mt-0.5 break-words" dir="auto">
                        {item.editorValue}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1.5 justify-end">
                    <Button size="sm" variant="default" onClick={() => onAccept(item.key)} className="h-7 text-xs font-display">
                      ✅ موافق
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => onReject(item.key)} className="h-7 text-xs font-display">
                      ❌ رفض
                    </Button>
                  </div>
                </div>
              ))}
              {pending.length === 0 && accepted.length > 0 && (
                <div className="text-center py-4 text-sm font-display text-secondary">
                  ✅ تم مراجعة جميع التعديلات — اضغط "تحميل المدمجة المحدثة" لحفظ التغييرات
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default MergeToBundledPanel;
