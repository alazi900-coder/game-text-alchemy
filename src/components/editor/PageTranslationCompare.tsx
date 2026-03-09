import React from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckCircle2, X } from "lucide-react";

interface PageTranslationCompareProps {
  open: boolean;
  originals: Record<string, string>; // key -> English original
  oldTranslations: Record<string, string>; // key -> previous Arabic (may be empty)
  newTranslations: Record<string, string>; // key -> new Arabic
  onApply: (selectedKeys: Set<string>) => void;
  onDiscard: () => void;
}

const PageTranslationCompare: React.FC<PageTranslationCompareProps> = ({
  open, originals, oldTranslations, newTranslations, onApply, onDiscard,
}) => {
  const keys = Object.keys(newTranslations);
  const [selected, setSelected] = React.useState<Set<string>>(new Set(keys));

  // Reset selection when new data comes in
  React.useEffect(() => {
    setSelected(new Set(Object.keys(newTranslations)));
  }, [newTranslations]);

  const toggleKey = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === keys.length) setSelected(new Set());
    else setSelected(new Set(keys));
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onDiscard(); }}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col" dir="rtl">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">📄 مقارنة ترجمة الصفحة</DialogTitle>
          <DialogDescription className="font-body">
            تم ترجمة <span className="font-bold text-primary">{keys.length}</span> نص — راجع النتائج قبل التطبيق
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 border rounded-md overflow-y-auto" style={{ maxHeight: '60vh', WebkitOverflowScrolling: 'touch' }}>
          <div className="p-2">
            {/* Header row */}
            <div className="grid grid-cols-[40px_1fr_1fr_1fr] gap-2 px-2 py-2 text-xs font-display font-bold text-muted-foreground border-b sticky top-0 bg-background z-10">
              <div className="flex items-center">
                <Checkbox
                  checked={selected.size === keys.length}
                  onCheckedChange={toggleAll}
                />
              </div>
              <div>النص الأصلي</div>
              <div>الترجمة السابقة</div>
              <div>الترجمة الجديدة</div>
            </div>

            {keys.map((key) => {
              const original = originals[key] || '';
              const old = oldTranslations[key] || '';
              const newT = newTranslations[key] || '';
              const changed = old !== newT;

              return (
                <div
                  key={key}
                  className={`grid grid-cols-[40px_1fr_1fr_1fr] gap-2 px-2 py-2 text-sm border-b last:border-0 ${
                    !selected.has(key) ? 'opacity-40' : ''
                  } ${changed ? '' : 'bg-muted/30'}`}
                >
                  <div className="flex items-start pt-1">
                    <Checkbox
                      checked={selected.has(key)}
                      onCheckedChange={() => toggleKey(key)}
                    />
                  </div>
                  <div className="font-body text-muted-foreground break-all text-xs leading-relaxed" dir="ltr">
                    {original}
                  </div>
                  <div className="font-body break-all text-xs leading-relaxed" dir="rtl">
                    {old || <span className="text-muted-foreground italic">— فارغ —</span>}
                  </div>
                  <div className={`font-body break-all text-xs leading-relaxed ${changed ? 'text-primary font-semibold' : ''}`} dir="rtl">
                    {newT}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <DialogFooter className="flex-row-reverse gap-2 pt-2">
          <Button variant="outline" onClick={onDiscard} className="font-display gap-1">
            <X className="w-4 h-4" /> إلغاء — تجاهل الكل
          </Button>
          <Button onClick={() => onApply(selected)} className="font-display gap-1" disabled={selected.size === 0}>
            <CheckCircle2 className="w-4 h-4" /> تطبيق ({selected.size}/{keys.length}) ✅
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PageTranslationCompare;
