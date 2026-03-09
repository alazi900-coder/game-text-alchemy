import { forwardRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Shield, FileText, Download, Sparkles, FolderOpen } from "lucide-react";
import GameInfoSection from "@/components/GameInfoSection";
import ExtractionGuideSection from "@/components/ExtractionGuideSection";
import heroBg from "@/assets/xc3-hero-bg.jpg";
import { APP_VERSION } from "@/lib/version";

const steps = [
  { icon: FileText, title: "ارفع الملفات", desc: "ارفع ملف BDAT أو MSBT وملف القاموس الخاص باللعبة" },
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
    warning: "اللعبة كبيرة جداً (~15GB) — تأكد من وجود مساحة كافية",
  },
  {
    title: "باستخدام المحاكي (yuzu/Ryujinx)",
    desc: "كليك يمين على اللعبة > Extract Data > RomFS",
    code: "Right-click Xenoblade 3 > Extract Data > RomFS",
  },
  {
    title: "الوصول لملفات BDAT",
    desc: "ملفات BDAT موجودة في مجلد bdat — تحتوي على جميع البيانات النصية",
    code: "romfs/bdat/gb/",
  },
  {
    title: "الوصول لملفات MSBT",
    desc: "ملفات الحوارات موجودة في مجلد Message",
    code: "romfs/menu/message/{lang}/",
  },
];

const packingSteps = [
  {
    title: "إنشاء بنية المجلدات",
    desc: "أنشئ مجلد romfs بنفس بنية الملفات الأصلية",
    code: "atmosphere/contents/010074F013262000/romfs/",
  },
  {
    title: "نسخ ملفات BDAT المعرّبة",
    desc: "ضع ملفات BDAT المعرّبة في مجلد bdat",
    code: "romfs/bdat/gb/*.bdat",
  },
  {
    title: "نسخ ملفات MSBT المعرّبة",
    desc: "ضع ملفات MSBT في مجلد message",
    code: "romfs/menu/message/gb/*.msbt",
  },
  {
    title: "تثبيت مود تحميل الملفات الخارجية",
    desc: "Xenoblade 3 تحتاج مود خاص لتحميل ملفات romfs المعدّلة",
    warning: "بدون هذا المود، اللعبة لن تقرأ الملفات المعدّلة!",
  },
];

const installSteps = [
  {
    title: "تثبيت File Replacement Mod",
    desc: "حمّل وثبّت مود استبدال الملفات الخاص بـ Xenoblade 3",
    code: "https://github.com/masagrator/XC3-file-replacement",
  },
  {
    title: "على السويتش (Atmosphere)",
    desc: "انسخ مجلدات atmosphere و romfs إلى بطاقة SD",
    code: "SD:/atmosphere/contents/010074F013262000/",
  },
  {
    title: "على المحاكي",
    desc: "في yuzu/Ryujinx: كليك يمين على اللعبة > Open Mod Data Location",
    code: "yuzu/load/010074F013262000/arabic-mod/",
  },
  {
    title: "التحقق من عمل المود",
    desc: "شغّل اللعبة وتحقق من ظهور النصوص العربية في القوائم",
    warning: "إذا ظهرت مربعات بدل الحروف، تحتاج تثبيت خط عربي",
  },
];

const requiredTools = [
  { name: "nxdumptool", url: "https://github.com/DarkMatterCore/nxdumptool", desc: "لفك ملفات اللعبة من السويتش" },
  { name: "bdat-toolset", url: "https://github.com/RoccoDev/bdat-rs", desc: "لتحويل BDAT إلى JSON والعكس (للمتقدمين)" },
  { name: "XC3 File Replacement", url: "https://github.com/masagrator/XC3-file-replacement", desc: "مود ضروري لتحميل الملفات المعدّلة" },
  { name: "Atmosphere", url: "https://github.com/Atmosphere-NX/Atmosphere", desc: "Custom Firmware للسويتش" },
];

const filePaths = [
  { path: "romfs/bdat/gb/", desc: "ملفات BDAT — جداول البيانات (أسماء، أوصاف، إحصائيات)" },
  { path: "romfs/menu/message/gb/", desc: "ملفات MSBT — الحوارات والقوائم" },
  { path: "bdat/gb/btl_*.bdat", desc: "نصوص القتال والمهارات" },
  { path: "bdat/gb/fld_*.bdat", desc: "نصوص الخريطة والمناطق" },
  { path: "bdat/gb/menu_*.bdat", desc: "نصوص القوائم" },
  { path: "bdat/gb/msg_*.bdat", desc: "الحوارات والمشاهد السينمائية" },
];

const Xenoblade = forwardRef<HTMLDivElement>((_, ref) => {
  const navigate = useNavigate();

  const handleLoadEnglishTexts = async () => {
    const { idbSet } = await import("@/lib/idb-storage");
    await idbSet("editorGame", "xenoblade");
    navigate("/editor?autoload=xenoblade");
  };

  return (
    <div ref={ref} className="min-h-screen flex flex-col">
      {/* Hero with background */}
      <header className="relative flex flex-col items-center justify-center min-h-[80vh] px-4 text-center overflow-hidden">
        {/* Background image */}
        <div className="absolute inset-0">
          <img
            src={heroBg}
            alt="Xenoblade Chronicles 3 Aionios"
            className="w-full h-full object-cover"
            fetchPriority="high"
            decoding="sync"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-background/50 to-background" />
        </div>

        <div className="relative z-10 max-w-2xl mx-auto">
          <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-4 font-body text-sm">
            ← العودة لقائمة الألعاب
          </Link>
          <div className="inline-flex items-center gap-2 mb-6 px-4 py-2 rounded-full bg-background/60 backdrop-blur-md border border-primary/30">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm text-primary font-display font-semibold">أداة تعريب تلقائية</span>
          </div>
          <h1 className="text-4xl md:text-6xl font-display font-black mb-6 leading-tight drop-shadow-lg">
            عرّب{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-l from-[hsl(180,80%,60%)] to-[hsl(200,90%,65%)]">
              Xenoblade Chronicles 3
            </span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-lg mx-auto font-body bg-background/40 backdrop-blur-sm rounded-lg px-4 py-2">
            ارفع ملفات اللعبة واحصل على نسخة معرّبة بالكامل مع ربط الحروف وعكس الاتجاه تلقائياً
          </p>
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-center">
            <Link to="/process">
              <Button size="lg" className="font-display font-bold text-lg px-10 py-6 bg-primary hover:bg-primary/90 shadow-xl shadow-primary/30">
                ابدأ التعريب 🔮
              </Button>
            </Link>
            <Link to="/mod-packager">
              <Button size="lg" variant="outline" className="font-display font-bold text-lg px-10 py-6 border-primary/40 hover:bg-primary/10">
                بناء حزمة المود 📦
              </Button>
            </Link>
            <Link to="/mod-packager#dat-extractor">
              <Button size="lg" variant="ghost" className="font-display font-bold text-lg px-10 py-6 hover:bg-primary/10">
                <FolderOpen className="w-5 h-5 ml-2" />
                فك ملفات DAT 🔬
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Steps */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-display font-bold text-center mb-12">كيف تعمل الأداة؟</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {steps.map((step, i) => (
              <div key={i} className="flex flex-col items-center text-center p-6 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <step.icon className="w-7 h-7 text-primary" />
                </div>
                <div className="text-sm text-secondary font-display font-bold mb-1">الخطوة {i + 1}</div>
                <h3 className="text-xl font-display font-bold mb-2">{step.title}</h3>
                <p className="text-muted-foreground text-sm">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Extraction Guide */}
      <ExtractionGuideSection
        accentColor="hsl(180, 60%, 40%)"
        gameTitle="Xenoblade Chronicles 3"
        titleId="010074F013262000"
        extractionSteps={extractionSteps}
        packingSteps={packingSteps}
        installSteps={installSteps}
        requiredTools={requiredTools}
        filePaths={filePaths}
      />

      {/* Game Info */}
      <GameInfoSection
        accentColor="hsl(200, 70%, 45%)"
        secondaryColor="hsl(180, 60%, 40%)"
        fileFormat=".bdat / .msbt"
        fileFormatDesc="Xenoblade Chronicles 3 تستخدم ملفات BDAT لتخزين البيانات الجدولية (أسماء، أوصاف، إحصائيات) وملفات MSBT للحوارات والنصوص السردية."
        requiredFiles={[
          { name: "ملفات BDAT", desc: "تحتوي على أسماء الشخصيات والأسلحة والمهام والأوصاف — موجودة في مجلد bdat داخل romFS" },
          { name: "ملفات MSBT", desc: "تحتوي على الحوارات والنصوص السردية — موجودة في مجلد Message داخل romFS" },
          { name: "ملف القاموس", desc: "قاموس المصطلحات العربية لترجمة الأسماء والمصطلحات الخاصة باللعبة" },
        ]}
        tools={[
          { name: "محلل BDAT المدمج", desc: "محلل ثنائي مدمج في الأداة — يقرأ ملفات .bdat مباشرة دون الحاجة لأدوات خارجية" },
          { name: "MSBT Editor", desc: "لقراءة وتعديل ملفات MSBT الثنائية للحوارات" },
          { name: "NX Editor", desc: "لاستخراج وإعادة حزم ملفات romFS" },
        ]}
        method="يتم رفع ملفات BDAT مباشرة وتحليلها في المتصفح. يتم استخراج النصوص، ترجمتها، تطبيق ربط الحروف العربية وعكس الاتجاه، ثم إعادة بناء الملف الثنائي مع تحديث كافة الأوفست تلقائياً."
        notes="Xenoblade 3 تحتوي على كمية ضخمة من النصوص (أكثر من 100,000 سطر). التعريب الكامل يتطلب وقتاً طويلاً. يُنصح بالبدء بالقوائم والأسماء أولاً."
      />

      {/* Footer */}
      <footer className="mt-auto py-6 text-center text-sm text-muted-foreground border-t border-border">
        <div>أداة تعريب زينوبليد كرونيكلز 3 — مشروع مفتوح المصدر 🇸🇦</div>
        <div className="mt-1 text-xs opacity-60">الإصدار {APP_VERSION}</div>
      </footer>
    </div>
  );
});

Xenoblade.displayName = "Xenoblade";

export default Xenoblade;
