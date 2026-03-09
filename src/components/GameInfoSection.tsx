import { forwardRef } from "react";
import { FileText, Wrench, FolderOpen, Info } from "lucide-react";

interface GameInfoProps {
  accentColor: string;
  secondaryColor: string;
  fileFormat: string;
  fileFormatDesc: string;
  requiredFiles: { name: string; desc: string }[];
  tools: { name: string; desc: string }[];
  method: string;
  notes?: string;
}

const GameInfoSection = forwardRef<HTMLElement, GameInfoProps>(({
  accentColor,
  secondaryColor,
  fileFormat,
  fileFormatDesc,
  requiredFiles,
  tools,
  method,
  notes,
}, ref) => {
  return (
    <section ref={ref} className="py-16 px-4" dir="rtl">
      <div className="max-w-4xl mx-auto space-y-10">
        <h2 className="text-2xl md:text-3xl font-display font-bold text-center mb-8">
          معلومات التعريب
        </h2>

        {/* Method */}
        <div className="rounded-xl bg-card border border-border p-6">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${accentColor}20` }}
            >
              <Info className="w-5 h-5" style={{ color: accentColor }} />
            </div>
            <h3 className="text-lg font-display font-bold">طريقة التعريب</h3>
          </div>
          <p className="text-muted-foreground font-body leading-relaxed">{method}</p>
        </div>

        {/* File Format */}
        <div className="rounded-xl bg-card border border-border p-6">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${accentColor}20` }}
            >
              <FileText className="w-5 h-5" style={{ color: accentColor }} />
            </div>
            <h3 className="text-lg font-display font-bold">صيغة الملفات</h3>
          </div>
          <div className="flex items-center gap-3 mb-2">
            <code
              className="px-3 py-1 rounded-md text-sm font-mono font-bold"
              style={{ backgroundColor: `${accentColor}15`, color: accentColor }}
            >
              {fileFormat}
            </code>
          </div>
          <p className="text-muted-foreground font-body text-sm">{fileFormatDesc}</p>
        </div>

        {/* Required Files */}
        <div className="rounded-xl bg-card border border-border p-6">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${accentColor}20` }}
            >
              <FolderOpen className="w-5 h-5" style={{ color: accentColor }} />
            </div>
            <h3 className="text-lg font-display font-bold">الملفات المطلوبة</h3>
          </div>
          <div className="space-y-3">
            {requiredFiles.map((file, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <code
                  className="px-2 py-0.5 rounded text-xs font-mono shrink-0 mt-0.5"
                  style={{ backgroundColor: `${secondaryColor}15`, color: secondaryColor }}
                >
                  {file.name}
                </code>
                <span className="text-sm text-muted-foreground">{file.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Tools */}
        <div className="rounded-xl bg-card border border-border p-6">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${accentColor}20` }}
            >
              <Wrench className="w-5 h-5" style={{ color: accentColor }} />
            </div>
            <h3 className="text-lg font-display font-bold">الأدوات المستخدمة</h3>
          </div>
          <div className="space-y-3">
            {tools.map((tool, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <span className="font-display font-bold text-sm shrink-0" style={{ color: accentColor }}>
                  {tool.name}
                </span>
                <span className="text-sm text-muted-foreground">{tool.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Notes */}
        {notes && (
          <div
            className="rounded-xl border p-5 text-sm font-body leading-relaxed"
            style={{
              backgroundColor: `${accentColor}08`,
              borderColor: `${accentColor}30`,
              color: accentColor,
            }}
          >
            <strong className="font-display">ملاحظة:</strong> {notes}
          </div>
        )}
      </div>
    </section>
  );
});

GameInfoSection.displayName = "GameInfoSection";

export default GameInfoSection;
