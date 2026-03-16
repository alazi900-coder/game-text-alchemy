import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FileText, Download, Ghost, Sparkles } from "lucide-react";
import GameInfoSection from "@/components/GameInfoSection";
import ExtractionGuideSection from "@/components/ExtractionGuideSection";
import heroBg from "@/assets/lm2-hero-bg.jpg";
import { APP_VERSION } from "@/lib/version";

const steps = [
  { icon: FileText, title: "ارفع ملفات NLOC", desc: "ارفع ملفات .loc أو .data — يتم استخراج النصوص تلقائياً" },
  { icon: Ghost, title: "ترجمة ومعالجة", desc: "ترجم النصوص في المحرر مع ربط الحروف العربية تلقائياً" },
  { icon: Download, title: "حمّل الملفات المعرّبة", desc: "حمّل ملفات NLOC جاهزة للعبة مباشرة — بدون أدوات خارجية" },
];

const extractionSteps = [
  {
    title: "تثبيت nxdumptool على السويتش",
    desc: "على جهاز سويتش مهكّر، ثبّت nxdumptool من Homebrew App Store",
  },
  {
    title: "فك romFS",
    desc: "افتح nxdumptool > Dump gamecard content > RomFS options > Dump RomFS section data",
    warning: "تأكد من وجود مساحة كافية على بطاقة SD (اللعبة ~3GB)",
  },
  {
    title: "باستخدام المحاكي (yuzu/Ryujinx)",
    desc: "كليك يمين على اللعبة > Extract Data > RomFS",
    code: "Right-click Luigi's Mansion 2 HD > Extract Data > RomFS",
  },
  {
    title: "الوصول لملفات النصوص",
    desc: "ملفات النصوص موجودة في مجلدات .dict/.data داخل romfs",
    code: "romfs/message/",
  },
  {
    title: "رفع الملفات للأداة",
    desc: "ارفع ملفات .loc أو .data مباشرة — الأداة تفك وتستخرج النصوص تلقائياً",
  },
];

const packingSteps = [
  {
    title: "إنشاء بنية المجلدات",
    desc: "أنشئ مجلد romfs بنفس بنية الملفات الأصلية",
    code: "atmosphere/contents/010048701995E000/romfs/",
  },
  {
    title: "نسخ الملفات المعرّبة",
    desc: "ضع ملفات NLOC المعدّلة في مسار romfs الصحيح",
    code: "romfs/message/",
  },
];

const installSteps = [
  {
    title: "على السويتش (Atmosphere)",
    desc: "انسخ مجلد atmosphere إلى جذر بطاقة SD",
    code: "SD:/atmosphere/contents/010048701995E000/romfs/",
  },
  {
    title: "تفعيل LayeredFS",
    desc: "Atmosphere يدعم LayeredFS تلقائياً — فقط ضع الملفات وشغّل اللعبة",
  },
  {
    title: "على المحاكي",
    desc: "في yuzu/Ryujinx: كليك يمين على اللعبة > Open Mod Data Location",
    code: "yuzu/load/010048701995E000/arabic-mod/romfs/",
  },
];

const requiredTools = [
  { name: "nxdumptool", url: "https://github.com/DarkMatterCore/nxdumptool", desc: "لفك ملفات اللعبة من السويتش مباشرة" },
  { name: "Atmosphere", url: "https://github.com/Atmosphere-NX/Atmosphere", desc: "Custom Firmware للسويتش" },
];

const filePaths = [
  { path: "romfs/message/", desc: "المجلد الرئيسي لملفات النصوص" },
  { path: "*.loc / *.data", desc: "ملفات NLOC تحتوي على كل نصوص اللعبة" },
];

export default function LuigiMansion() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="relative flex flex-col items-center justify-center min-h-[80vh] px-4 text-center overflow-hidden">
        <div className="absolute inset-0">
          <img src={heroBg} alt="Luigi's Mansion 2 HD" className="w-full h-full object-cover" fetchPriority="high" decoding="sync" />
          <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-background/50 to-background" />
        </div>
        <div className="relative z-10 max-w-2xl mx-auto">
          <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-4 font-body text-sm">
            ← العودة لقائمة الألعاب
          </Link>
          <div className="inline-flex items-center gap-2 mb-6 px-4 py-2 rounded-full bg-background/60 backdrop-blur-md border border-[hsl(120,60%,40%)]/30">
            <Sparkles className="w-4 h-4 text-[hsl(120,70%,50%)]" />
            <span className="text-sm text-[hsl(120,70%,50%)] font-display font-semibold">أداة تعريب تلقائية</span>
          </div>
          <h1 className="text-4xl md:text-6xl font-display font-black mb-6 leading-tight drop-shadow-lg">
            عرّب{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-l from-[hsl(120,70%,50%)] to-[hsl(270,70%,60%)]">
              Luigi's Mansion 2 HD
            </span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-lg mx-auto font-body bg-background/40 backdrop-blur-sm rounded-lg px-4 py-2">
            ارفع ملفات NLOC (.loc / .data) واحصل على نسخة معرّبة بالكامل
          </p>
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-center">
            <Link to="/luigis-mansion/process">
              <Button size="lg" className="font-display font-bold text-lg px-10 py-6 bg-[hsl(120,50%,40%)] hover:bg-[hsl(120,50%,35%)] text-white shadow-xl shadow-[hsl(120,50%,40%)]/30">
                ابدأ التعريب 👻
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
              <div key={i} className="flex flex-col items-center text-center p-6 rounded-xl bg-card border border-border hover:border-[hsl(120,50%,40%)]/40 transition-colors">
                <div className="w-14 h-14 rounded-full bg-[hsl(120,50%,40%)]/10 flex items-center justify-center mb-4">
                  <step.icon className="w-7 h-7 text-[hsl(120,70%,50%)]" />
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
        accentColor="hsl(120, 50%, 40%)"
        gameTitle="Luigi's Mansion 2 HD"
        titleId="010048701995E000"
        extractionSteps={extractionSteps}
        packingSteps={packingSteps}
        installSteps={installSteps}
        requiredTools={requiredTools}
        filePaths={filePaths}
      />

      <GameInfoSection
        accentColor="hsl(120, 50%, 40%)"
        secondaryColor="hsl(270, 60%, 50%)"
        fileFormat=".loc / .data (NLOC)"
        fileFormatDesc="Luigi's Mansion 2 HD تستخدم صيغة NLOC (Next Level LOCalization) لتخزين النصوص. الملفات مشفرة بـ UTF-16 وتحتوي على هاشات للمعرّفات."
        requiredFiles={[
          { name: "ملفات .loc", desc: "ملفات NLOC مباشرة — تحتوي على كل نصوص اللعبة" },
          { name: "ملفات .data", desc: "ملفات أرشيف تحتوي على NLOC داخلها (مع ترويسة 0x10 بايت)" },
        ]}
        tools={[
          { name: "محلل NLOC المدمج", desc: "محلل ثنائي مدمج — يقرأ ملفات NLOC مباشرة" },
        ]}
        method="يتم رفع ملفات NLOC المستخرجة من romFS. يتم استخراج النصوص وترجمتها وتطبيق ربط الحروف العربية، ثم إعادة بناء ملف NLOC."
        notes="Luigi's Mansion 2 HD من تطوير Next Level Games وتستخدم نظام ملفات خاص بها. تأكد من الحفاظ على نفس بنية المجلدات عند تثبيت الملفات المعرّبة."
      />

      <footer className="mt-auto py-6 text-center text-sm text-muted-foreground border-t border-border">
        <div>أداة تعريب Luigi's Mansion 2 HD 🇸🇦</div>
        <div className="mt-1 text-xs opacity-60">الإصدار {APP_VERSION}</div>
      </footer>
    </div>
  );
}
