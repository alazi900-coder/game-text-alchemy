import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FileText, Download, Shield, Sparkles } from "lucide-react";
import GameInfoSection from "@/components/GameInfoSection";
import ExtractionGuideSection from "@/components/ExtractionGuideSection";
import heroBg from "@/assets/fe-hero-bg.jpg";
import { APP_VERSION } from "@/lib/version";

const steps = [
  { icon: FileText, title: "ارفع الملفات", desc: "ارفع ملفات MSBT من مجلد Message داخل romFS" },
  { icon: Shield, title: "معالجة تلقائية", desc: "استخراج النصوص ومعالجتها وربط الحروف العربية" },
  { icon: Download, title: "حمّل النتيجة", desc: "حمّل الملف المعرّب جاهزاً للعبة" },
];

const extractionSteps = [
  {
    title: "تثبيت nxdumptool على السويتش",
    desc: "على جهاز سويتش مهكّر، ثبّت nxdumptool من Homebrew App Store",
  },
  {
    title: "فك romFS",
    desc: "افتح nxdumptool > Dump gamecard content > RomFS options > Dump RomFS section data",
    warning: "تأكد من وجود مساحة كافية على بطاقة SD (اللعبة ~15GB)",
  },
  {
    title: "باستخدام المحاكي (yuzu/Ryujinx)",
    desc: "كليك يمين على اللعبة > Extract Data > RomFS",
    code: "Right-click Fire Emblem Engage > Extract Data > RomFS",
  },
  {
    title: "الوصول لملفات النصوص",
    desc: "ملفات MSBT موجودة داخل ملفات .bytes.bundle — تحتاج فكها أولاً",
    code: "romfs/StreamingAssets/aa/Switch/fe_assets_message/",
  },
  {
    title: "فك ملفات Bundle",
    desc: "استخدم AssetStudio أو UABE لفك ملفات .bytes.bundle واستخراج MSBT",
    warning: "Fire Emblem Engage تستخدم Unity — الملفات مضغوطة داخل Asset Bundles",
  },
];

const packingSteps = [
  {
    title: "إنشاء بنية المجلدات",
    desc: "أنشئ مجلد romfs بنفس بنية الملفات الأصلية",
    code: "atmosphere/contents/0100A6301214E000/romfs/",
  },
  {
    title: "إعادة حزم ملفات Bundle",
    desc: "استخدم UABE Avalonia لإعادة حزم ملفات MSBT داخل Asset Bundles",
  },
  {
    title: "نسخ الملفات المعرّبة",
    desc: "ضع ملفات Bundle المعدّلة في مسار romfs الصحيح",
    code: "romfs/StreamingAssets/aa/Switch/fe_assets_message/",
  },
  {
    title: "ملاحظة مهمة",
    desc: "Fire Emblem Engage تتطلب 7 bytes من الـ null terminators (0x00) في نهاية كل نص",
    warning: "MSBT Editor Reloaded يزيل 4 bytes — يجب إضافتها يدوياً بمحرر Hex",
  },
];

const installSteps = [
  {
    title: "على السويتش (Atmosphere)",
    desc: "انسخ مجلد atmosphere إلى جذر بطاقة SD",
    code: "SD:/atmosphere/contents/0100A6301214E000/romfs/",
  },
  {
    title: "تفعيل LayeredFS",
    desc: "Atmosphere يدعم LayeredFS تلقائياً — فقط ضع الملفات وشغّل اللعبة",
  },
  {
    title: "على المحاكي",
    desc: "في yuzu/Ryujinx: كليك يمين على اللعبة > Open Mod Data Location",
    code: "yuzu/load/0100A6301214E000/arabic-mod/romfs/",
  },
];

const requiredTools = [
  { name: "nxdumptool", url: "https://github.com/DarkMatterCore/nxdumptool", desc: "لفك ملفات اللعبة من السويتش مباشرة" },
  { name: "AssetStudio", url: "https://github.com/Perfare/AssetStudio", desc: "لفك ملفات Unity Asset Bundles" },
  { name: "UABE Avalonia", url: "https://github.com/nesrak1/UABEA", desc: "لتعديل وإعادة حزم Asset Bundles" },
  { name: "HxD", url: "https://mh-nexus.de/en/hxd/", desc: "محرر Hex لإصلاح null terminators" },
  { name: "Atmosphere", url: "https://github.com/Atmosphere-NX/Atmosphere", desc: "Custom Firmware للسويتش" },
];

const filePaths = [
  { path: "StreamingAssets/aa/Switch/fe_assets_message/", desc: "جميع ملفات النصوص (داخل .bytes.bundle)" },
  { path: "fe_assets_message_usen.bytes.bundle", desc: "النصوص الإنجليزية الأمريكية" },
  { path: "fe_assets_message_euen.bytes.bundle", desc: "النصوص الإنجليزية الأوروبية" },
  { path: "داخل Bundle: *.msbt", desc: "ملفات MSBT الفعلية داخل كل Bundle" },
];

export default function FireEmblem() {

  return (
    <div className="min-h-screen flex flex-col">
      <header className="relative flex flex-col items-center justify-center min-h-[80vh] px-4 text-center overflow-hidden">
        <div className="absolute inset-0">
          <img src={heroBg} alt="Fire Emblem Engage" className="w-full h-full object-cover" fetchPriority="high" decoding="sync" />
          <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-background/50 to-background" />
        </div>
        <div className="relative z-10 max-w-2xl mx-auto">
          <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-4 font-body text-sm">
            ← العودة لقائمة الألعاب
          </Link>
          <div className="inline-flex items-center gap-2 mb-6 px-4 py-2 rounded-full bg-background/60 backdrop-blur-md border border-[hsl(0,60%,50%)]/30">
            <Sparkles className="w-4 h-4 text-[hsl(0,80%,60%)]" />
            <span className="text-sm text-[hsl(0,80%,60%)] font-display font-semibold">أداة تعريب تلقائية</span>
          </div>
          <h1 className="text-4xl md:text-6xl font-display font-black mb-6 leading-tight drop-shadow-lg">
            عرّب{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-l from-[hsl(0,80%,60%)] to-[hsl(220,80%,60%)]">
              Fire Emblem Engage
            </span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-lg mx-auto font-body bg-background/40 backdrop-blur-sm rounded-lg px-4 py-2">
            ارفع ملفات MSBT واحصل على نسخة معرّبة بالكامل مع ربط الحروف وعكس الاتجاه تلقائياً
          </p>
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-center">
            <Link to="/fire-emblem/process">
              <Button size="lg" className="font-display font-bold text-lg px-10 py-6 bg-[hsl(0,60%,50%)] hover:bg-[hsl(0,60%,45%)] text-white shadow-xl shadow-[hsl(0,60%,50%)]/30">
                ابدأ التعريب ⚔️
              </Button>
            </Link>
            <Link to="/bundle-extractor">
              <Button size="lg" variant="outline" className="font-display font-bold text-lg px-10 py-6">
                فاك ملفات Bundle 📦
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-display font-bold text-center mb-12">كيف تعمل الأداة؟</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {steps.map((step, i) => (
              <div key={i} className="flex flex-col items-center text-center p-6 rounded-xl bg-card border border-border hover:border-[hsl(0,60%,50%)]/40 transition-colors">
                <div className="w-14 h-14 rounded-full bg-[hsl(0,60%,50%)]/10 flex items-center justify-center mb-4">
                  <step.icon className="w-7 h-7 text-[hsl(0,80%,60%)]" />
                </div>
                <div className="text-sm text-secondary font-display font-bold mb-1">الخطوة {i + 1}</div>
                <h3 className="text-xl font-display font-bold mb-2">{step.title}</h3>
                <p className="text-muted-foreground text-sm">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <ExtractionGuideSection
        accentColor="hsl(0, 60%, 50%)"
        gameTitle="Fire Emblem Engage"
        titleId="0100A6301214E000"
        extractionSteps={extractionSteps}
        packingSteps={packingSteps}
        installSteps={installSteps}
        requiredTools={requiredTools}
        filePaths={filePaths}
      />

      <GameInfoSection
        accentColor="hsl(0, 60%, 50%)"
        secondaryColor="hsl(220, 60%, 50%)"
        fileFormat=".msbt (داخل .bytes.bundle)"
        fileFormatDesc="Fire Emblem Engage تستخدم ملفات MSBT داخل Unity Asset Bundles. يجب فك الـ Bundle أولاً للوصول لملفات MSBT، ثم إعادة حزمها بعد التعديل."
        requiredFiles={[
          { name: "ملفات .bytes.bundle", desc: "تحتوي على ملفات MSBT مضغوطة — موجودة في StreamingAssets" },
          { name: "fe_assets_message_*.bundle", desc: "ملفات النصوص حسب اللغة" },
          { name: "ملفات MSBT", desc: "داخل كل Bundle — تحتوي على الحوارات والقوائم" },
        ]}
        tools={[
          { name: "محلل MSBT المدمج", desc: "محلل ثنائي مدمج — يقرأ ملفات .msbt المستخرجة" },
          { name: "AssetStudio", desc: "لفك ملفات Unity Asset Bundles" },
          { name: "UABE Avalonia", desc: "لإعادة حزم الملفات المعدّلة" },
        ]}
        method="يتم رفع ملفات MSBT المستخرجة من Asset Bundles. يتم استخراج النصوص وترجمتها وتطبيق ربط الحروف العربية، ثم إعادة بناء ملف MSBT. بعدها يجب إعادة حزم الملف داخل Bundle باستخدام UABE."
        notes="Fire Emblem Engage تتطلب خطوات إضافية لفك وإعادة حزم ملفات Unity. تأكد من إصلاح null terminators (7 bytes) بعد التعديل."
      />

      <footer className="mt-auto py-6 text-center text-sm text-muted-foreground border-t border-border">
        <div>أداة تعريب Fire Emblem Engage 🇸🇦</div>
        <div className="mt-1 text-xs opacity-60">الإصدار {APP_VERSION}</div>
      </footer>
    </div>
  );
}
