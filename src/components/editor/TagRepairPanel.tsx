import React, { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Check, X, Wrench } from "lucide-react";
import { previewTagRestore } from "@/lib/xc3-tag-restoration";
import type { ExtractedEntry } from "./types";

export interface TagRepairItem {
  key: string;
  label: string;
  before: string;
  after: string;
}

interface TagRepairPanelProps {
  entries: ExtractedEntry[];
  translations: Record<string, string>;
  damagedTagKeys: Set<string>;
  onApplySelected: (keys: string[]) => void;
  onClose: () => void;
}

const TagRepairPanel: React.FC<TagRepairPanelProps> = ({
  entries, translations, damagedTagKeys, onApplySelected, onClose,
}) => {
  const items = useMemo(() => {
    const result: TagRepairItem[] = [];
    for (const entry of entries) {
      const key = `${entry.msbtFile}:${entry.index}`;
      if (!damagedTagKeys.has(key)) continue;
      const translation = translations[key] || '';
      if (!translation.trim()) continue;
      const preview = previewTagRestore(entry.original, translation);
      if (preview.hasDiff) {
        result.push({ key, label: key, before: preview.before, after: preview.after });
      }
    }
    return result;
  }, [entries, translations, damagedTagKeys]);

  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [rejected, setRejected] = useState<Set<string>>(new Set());

  const toggleAccept = (key: string) => {
    setAccepted(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    setRejected(prev => { const next = new Set(prev); next.delete(key); return next; });
  };

  const toggleReject = (key: string) => {
    setRejected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    setAccepted(prev => { const next = new Set(prev); next.delete(key); return next; });
  };

  const acceptAll = () => {
    setAccepted(new Set(items.map(i => i.key)));
    setRejected(new Set());
  };

  const rejectAll = () => {
    setRejected(new Set(items.map(i => i.key)));
    setAccepted(new Set());
  };

  const handleApply = () => {
    const keys = [...accepted];
    if (keys.length > 0) onApplySelected(keys);
    onClose();
  };

  if (items.length === 0) {
    return (
      <Card className="mb-4 border-secondary/30 bg-secondary/5">
        <CardContent className="p-4 text-center font-display">
          لا توجد رموز تالفة يمكن إصلاحها ✅
          <div className="mt-2">
            <Button size="sm" variant="outline" onClick={onClose}>إغلاق</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Helper to render text with PUA chars visible
  const renderTagText = (text: string) => {
    return text.replace(/[\uE000-\uE0FF]/g, (ch) => `[${ch.codePointAt(0)!.toString(16).toUpperCase()}]`);
  };

  return (
    <Card className="mb-4 border-destructive/30 bg-destructive/5">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-display font-bold text-sm flex items-center gap-2">
            <Wrench className="w-4 h-4 text-destructive" />
            إصلاح الوسوم التالفة ({items.length} نص)
          </h3>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={acceptAll} className="text-xs font-display">
              <CheckCircle2 className="w-3 h-3" /> قبول الكل ✅
            </Button>
            <Button size="sm" variant="outline" onClick={rejectAll} className="text-xs font-display">
              <XCircle className="w-3 h-3" /> رفض الكل ❌
            </Button>
          </div>
        </div>

        <div className="max-h-[400px] overflow-y-auto space-y-2 pr-1">
          {items.map(item => {
            const isAccepted = accepted.has(item.key);
            const isRejected = rejected.has(item.key);
            return (
              <div
                key={item.key}
                className={`rounded-lg border p-3 text-xs transition-colors ${
                  isAccepted ? 'border-secondary/50 bg-secondary/10' :
                  isRejected ? 'border-muted bg-muted/30 opacity-60' :
                  'border-border/50 bg-card/50'
                }`}
              >
                <p className="font-mono text-[10px] text-muted-foreground mb-2 truncate" dir="ltr">{item.label}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] text-destructive font-bold">قبل:</span>
                    <p className="font-body text-xs mt-0.5 bg-destructive/10 rounded px-2 py-1 break-all" dir="auto">
                      {renderTagText(item.before)}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] text-secondary font-bold">بعد:</span>
                    <p className="font-body text-xs mt-0.5 bg-secondary/10 rounded px-2 py-1 break-all" dir="auto">
                      {renderTagText(item.after)}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 mt-2 justify-end">
                  <Button
                    size="sm" variant={isAccepted ? "default" : "outline"}
                    onClick={() => toggleAccept(item.key)}
                    className="text-[10px] h-6 px-2"
                  >
                    <Check className="w-3 h-3" /> موافقة
                  </Button>
                  <Button
                    size="sm" variant={isRejected ? "destructive" : "outline"}
                    onClick={() => toggleReject(item.key)}
                    className="text-[10px] h-6 px-2"
                  >
                    <X className="w-3 h-3" /> رفض
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border/30">
          <span className="text-xs font-display text-muted-foreground">
            {accepted.size} مقبول • {rejected.size} مرفوض • {items.length - accepted.size - rejected.size} بدون قرار
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onClose} className="font-display">إغلاق</Button>
            <Button size="sm" onClick={handleApply} disabled={accepted.size === 0} className="font-display">
              <CheckCircle2 className="w-3 h-3" /> تطبيق المقبول ({accepted.size})
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default TagRepairPanel;
