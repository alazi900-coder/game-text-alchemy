import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FileText, Download, Shield, Sparkles } from "lucide-react";
import GameInfoSection from "@/components/GameInfoSection";
import ExtractionGuideSection from "@/components/ExtractionGuideSection";
import heroBg from "@/assets/acnh-hero-bg.jpg";
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
    warning: "تأكد من وجود مساحة كافية على بطاقة SD (اللعبة ~7GB)",
  },
  {
    title: "باستخدام المحاكي (yuzu/Ryujinx)",
    desc: "كليك يمين على اللعبة > Extract Data > RomFS",
    code: "Right-click ACNH > Extract Data > RomFS",
  },
  {
    title: "الوصول لملفات النصوص",
    desc: "بعد الفك، انتقل لمجلد Message للوصول لملفات MSBT",
    code: "romfs/Message/String/USen/*.msbt",
  },
];

const packingSteps = [
  {
    title: "إنشاء بنية المجلدات",
    desc: "أنشئ مجلد romfs بنفس بنية الملفات الأصلية",
    code: "atmosphere/contents/01006F8002326000/romfs/Message/",
  },
  {
    title: "نسخ الملفات المعرّبة",
    desc: "ضع ملفات MSBT المعرّبة في نفس المسار الأصلي داخل مجلد romfs",
    code: "romfs/Message/String/USen/Item.msbt",
  },
  {
    title: "الحفاظ على بنية المجلدات",
    desc: "يجب أن تكون بنية المجلدات مطابقة تماماً للأصل",
  },
];

const installSteps = [
  {
    title: "على السويتش (Atmosphere)",
    desc: "انسخ مجلد atmosphere إلى جذر بطاقة SD",
    code: "SD:/atmosphere/contents/01006F8002326000/romfs/",
  },
  {
    title: "تفعيل LayeredFS",
    desc: "Atmosphere يدعم LayeredFS تلقائياً — فقط ضع الملفات وشغّل اللعبة",
    warning: "تأكد أن إصدار Atmosphere محدّث لآخر نسخة",
  },
  {
    title: "على المحاكي",
    desc: "في yuzu/Ryujinx: كليك يمين على اللعبة > Open Mod Data Location > ضع المجلد هناك",
    code: "yuzu/load/01006F8002326000/arabic-mod/romfs/",
  },
];

const requiredTools = [
  { name: "nxdumptool", url: "https://github.com/DarkMatterCore/nxdumptool", desc: "لفك ملفات اللعبة من السويتش مباشرة" },
  { name: "Switch Toolbox", url: "https://github.com/KillzXGaming/Switch-Toolbox", desc: "لفتح وتعديل ملفات SARC archives" },
  { name: "Atmosphere", url: "https://github.com/Atmosphere-NX/Atmosphere", desc: "Custom Firmware للسويتش لتشغيل المودات" },
  { name: "yuzu/Ryujinx", url: "https://yuzu-emu.org/", desc: "محاكي نينتندو سويتش للكمبيوتر" },
];

const filePaths = [
  { path: "romfs/Message/String/{lang}/", desc: "أسماء العناصر والأثاث والحشرات والأسماك" },
  { path: "romfs/Message/Mail/{lang}/", desc: "رسائل البريد والخطابات" },
  { path: "romfs/Message/TalkNNpc/{lang}/", desc: "حوارات القرويين (حسب الشخصية)" },
  { path: "romfs/Message/TalkSNpc/{lang}/", desc: "حوارات الشخصيات الخاصة (Tom Nook, Isabelle...)" },
];


export default function AnimalCrossing() {
  const navigate = useNavigate();

  const handleLoadEnglishTexts = async () => {
    const { idbSet } = await import("@/lib/idb-storage");
    await idbSet("editorGame", "animal-crossing");
    navigate("/editor?autoload=animal-crossing");
  };


  return (
    <div className="min-h-screen flex flex-col">
      <header className="relative flex flex-col items-center justify-center min-h-[80vh] px-4 text-center overflow-hidden">
        <div className="absolute inset-0">
          <img src={heroBg} alt="Animal Crossing: New Horizons" className="w-full h-full object-cover" fetchPriority="high" decoding="sync" />
          <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-background/50 to-background" />
        </div>
        <div className="relative z-10 max-w-2xl mx-auto">
          <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-4 font-body text-sm">
            ← العودة لقائمة الألعاب
          </Link>
          <div className="inline-flex items-center gap-2 mb-6 px-4 py-2 rounded-full bg-background/60 backdrop-blur-md border border-[hsl(140,60%,40%)]/30">
            <Sparkles className="w-4 h-4 text-[hsl(140,70%,50%)]" />
            <span className="text-sm text-[hsl(140,70%,50%)] font-display font-semibold">أداة تعريب تلقائية</span>
          </div>
          <h1 className="text-4xl md:text-6xl font-display font-black mb-6 leading-tight drop-shadow-lg">
            عرّب{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-l from-[hsl(140,70%,50%)] to-[hsl(160,80%,55%)]">
              Animal Crossing: NH
            </span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-lg mx-auto font-body bg-background/40 backdrop-blur-sm rounded-lg px-4 py-2">
            ارفع ملفات MSBT واحصل على نسخة معرّبة بالكامل مع ربط الحروف وعكس الاتجاه تلقائياً
          </p>
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-center">
            <Link to="/animal-crossing/process">
              <Button size="lg" className="font-display font-bold text-lg px-10 py-6 bg-[hsl(140,60%,40%)] hover:bg-[hsl(140,60%,35%)] text-white shadow-xl shadow-[hsl(140,60%,40%)]/30">
                ابدأ التعريب 🌿
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
              <div key={i} className="flex flex-col items-center text-center p-6 rounded-xl bg-card border border-border hover:border-[hsl(140,60%,40%)]/40 transition-colors">
                <div className="w-14 h-14 rounded-full bg-[hsl(140,60%,40%)]/10 flex items-center justify-center mb-4">
                  <step.icon className="w-7 h-7 text-[hsl(140,70%,50%)]" />
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
        accentColor="hsl(140, 60%, 40%)"
        gameTitle="Animal Crossing: New Horizons"
        titleId="01006F8002326000"
        extractionSteps={extractionSteps}
        packingSteps={packingSteps}
        installSteps={installSteps}
        requiredTools={requiredTools}
        filePaths={filePaths}
      />

      <GameInfoSection
        accentColor="hsl(140, 60%, 40%)"
        secondaryColor="hsl(160, 50%, 35%)"
        fileFormat=".msbt"
        fileFormatDesc="Animal Crossing: New Horizons تستخدم ملفات MSBT (MsgStdBn) لتخزين جميع النصوص: الحوارات، أسماء العناصر، أسماء القرويين، وصف الأثاث، والمزيد."
        requiredFiles={[
          { name: "ملفات MSBT", desc: "تحتوي على جميع نصوص اللعبة — موجودة في مجلد Message داخل romFS" },
          { name: "مجلد String", desc: "يحتوي على ملفات MSBT لأسماء العناصر والأوصاف" },
          { name: "مجلد Dialog", desc: "يحتوي على ملفات MSBT لحوارات القرويين والشخصيات" },
        ]}
        tools={[
          { name: "محلل MSBT المدمج", desc: "محلل ثنائي مدمج — يقرأ ملفات .msbt مباشرة في المتصفح" },
          { name: "NX Editor", desc: "لاستخراج وإعادة حزم ملفات romFS" },
        ]}
        method="يتم رفع ملفات MSBT مباشرة وتحليلها في المتصفح. يتم استخراج Labels والنصوص، ترجمتها، تطبيق ربط الحروف العربية وعكس الاتجاه، ثم إعادة بناء ملف MSBT مع تحديث كافة الأوفست تلقائياً."
        notes="Animal Crossing: NH تحتوي على كمية كبيرة من النصوص (حوارات، عناصر، أحداث). يُنصح بالبدء بالقوائم والعناصر أولاً."
      />

      <footer className="mt-auto py-6 text-center text-sm text-muted-foreground border-t border-border">
        <div>أداة تعريب Animal Crossing: New Horizons 🇸🇦</div>
        <div className="mt-1 text-xs opacity-60">الإصدار {APP_VERSION}</div>
      </footer>
    </div>
  );
}
