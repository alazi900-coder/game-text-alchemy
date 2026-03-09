import { forwardRef } from "react";
import { Download, FolderOpen, Wrench, Package, Play, AlertTriangle } from "lucide-react";

interface ExtractionStep {
  title: string;
  desc: string;
  code?: string;
  warning?: string;
}

interface ExtractionGuideProps {
  accentColor: string;
  gameTitle: string;
  titleId: string;
  extractionSteps: ExtractionStep[];
  packingSteps: ExtractionStep[];
  installSteps: ExtractionStep[];
  requiredTools: { name: string; url: string; desc: string }[];
  filePaths: { path: string; desc: string }[];
}

const ExtractionGuideSection = forwardRef<HTMLElement, ExtractionGuideProps>(({
  accentColor,
  gameTitle,
  titleId,
  extractionSteps,
  packingSteps,
  installSteps,
  requiredTools,
  filePaths,
}, ref) => {
  return (
    <section ref={ref} className="py-16 px-4 border-t border-border" dir="rtl">
      <div className="max-w-4xl mx-auto space-y-10">
        <h2 className="text-2xl md:text-3xl font-display font-bold text-center mb-8">
          دليل استخراج وتجميع الملفات
        </h2>

        {/* Required Tools */}
        <div className="rounded-xl bg-card border border-border p-6">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${accentColor}20` }}
            >
              <Wrench className="w-5 h-5" style={{ color: accentColor }} />
            </div>
            <h3 className="text-lg font-display font-bold">الأدوات المطلوبة</h3>
          </div>
          <div className="space-y-3">
            {requiredTools.map((tool, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <a
                  href={tool.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-display font-bold text-sm shrink-0 hover:underline"
                  style={{ color: accentColor }}
                >
                  {tool.name} ↗
                </a>
                <span className="text-sm text-muted-foreground">{tool.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* File Paths */}
        <div className="rounded-xl bg-card border border-border p-6">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${accentColor}20` }}
            >
              <FolderOpen className="w-5 h-5" style={{ color: accentColor }} />
            </div>
            <h3 className="text-lg font-display font-bold">مسارات الملفات</h3>
            <code className="text-xs bg-muted px-2 py-1 rounded font-mono" dir="ltr">
              Title ID: {titleId}
            </code>
          </div>
          <div className="space-y-2">
            {filePaths.map((fp, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-background border border-border">
                <code
                  className="px-2 py-0.5 rounded text-xs font-mono shrink-0"
                  style={{ backgroundColor: `${accentColor}15`, color: accentColor }}
                  dir="ltr"
                >
                  {fp.path}
                </code>
                <span className="text-sm text-muted-foreground">{fp.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Step 1: Extraction */}
        <div className="rounded-xl bg-card border border-border p-6">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold"
              style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
            >
              1
            </div>
            <div>
              <h3 className="text-lg font-display font-bold">فك ملفات romFS</h3>
              <p className="text-xs text-muted-foreground">استخراج ملفات اللعبة من نسخة NSP/XCI</p>
            </div>
          </div>
          <div className="space-y-4">
            {extractionSteps.map((step, i) => (
              <div key={i} className="border-r-2 pr-4" style={{ borderColor: accentColor }}>
                <p className="font-display font-semibold text-sm mb-1">{step.title}</p>
                <p className="text-sm text-muted-foreground mb-2">{step.desc}</p>
                {step.code && (
                  <code className="block bg-background p-3 rounded-lg text-xs font-mono overflow-x-auto" dir="ltr">
                    {step.code}
                  </code>
                )}
                {step.warning && (
                  <div className="flex items-start gap-2 mt-2 p-2 rounded bg-amber-500/10 border border-amber-500/30">
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <span className="text-xs text-amber-600 dark:text-amber-400">{step.warning}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Step 2: Arabization (handled by this tool) */}
        <div className="rounded-xl border p-6" style={{ backgroundColor: `${accentColor}08`, borderColor: `${accentColor}30` }}>
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold"
              style={{ backgroundColor: `${accentColor}30`, color: accentColor }}
            >
              2
            </div>
            <div>
              <h3 className="text-lg font-display font-bold" style={{ color: accentColor }}>تعريب الملفات</h3>
              <p className="text-xs text-muted-foreground">استخدم هذه الأداة لترجمة وتعريب الملفات</p>
            </div>
          </div>
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>اضغط على زر <strong className="text-foreground">"ابدأ التعريب"</strong> في الأعلى</li>
            <li>ارفع ملفات النصوص من المجلدات المذكورة أعلاه</li>
            <li>استخدم المحرر للترجمة — يدعم الترجمة التلقائية والقاموس</li>
            <li>اضغط <strong className="text-foreground">"بناء"</strong> لإنشاء الملفات المعرّبة</li>
            <li>حمّل الملفات المعرّبة</li>
          </ol>
        </div>

        {/* Step 3: Packing */}
        <div className="rounded-xl bg-card border border-border p-6">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold"
              style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
            >
              3
            </div>
            <div>
              <h3 className="text-lg font-display font-bold">تجميع الملفات</h3>
              <p className="text-xs text-muted-foreground">وضع الملفات المعرّبة في المكان الصحيح</p>
            </div>
          </div>
          <div className="space-y-4">
            {packingSteps.map((step, i) => (
              <div key={i} className="border-r-2 pr-4" style={{ borderColor: accentColor }}>
                <p className="font-display font-semibold text-sm mb-1">{step.title}</p>
                <p className="text-sm text-muted-foreground mb-2">{step.desc}</p>
                {step.code && (
                  <code className="block bg-background p-3 rounded-lg text-xs font-mono overflow-x-auto" dir="ltr">
                    {step.code}
                  </code>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Step 4: Installation */}
        <div className="rounded-xl bg-card border border-border p-6">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold"
              style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
            >
              4
            </div>
            <div>
              <h3 className="text-lg font-display font-bold">تثبيت المود</h3>
              <p className="text-xs text-muted-foreground">تشغيل اللعبة بالترجمة العربية</p>
            </div>
          </div>
          <div className="space-y-4">
            {installSteps.map((step, i) => (
              <div key={i} className="border-r-2 pr-4" style={{ borderColor: accentColor }}>
                <p className="font-display font-semibold text-sm mb-1">{step.title}</p>
                <p className="text-sm text-muted-foreground mb-2">{step.desc}</p>
                {step.code && (
                  <code className="block bg-background p-3 rounded-lg text-xs font-mono overflow-x-auto" dir="ltr">
                    {step.code}
                  </code>
                )}
                {step.warning && (
                  <div className="flex items-start gap-2 mt-2 p-2 rounded bg-amber-500/10 border border-amber-500/30">
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <span className="text-xs text-amber-600 dark:text-amber-400">{step.warning}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

      </div>
    </section>
  );
});

ExtractionGuideSection.displayName = "ExtractionGuideSection";

export default ExtractionGuideSection;
