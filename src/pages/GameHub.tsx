import { Link } from "react-router-dom";
import { Sparkles, Package, FileText } from "lucide-react";
import { APP_VERSION } from "@/lib/version";
import heroBgAcnh from "@/assets/acnh-hero-bg.jpg";
import heroBgFe from "@/assets/fe-hero-bg.jpg";

const games = [
  {
    id: "animal-crossing",
    title: "Animal Crossing: New Horizons",
    titleAr: "أنيمال كروسينج: نيو هورايزنز",
    desc: "ملفات MSBT — حوارات، عناصر، أسماء القرويين",
    image: heroBgAcnh,
    href: "/animal-crossing",
    accent: "from-[hsl(140,70%,50%)] to-[hsl(160,80%,55%)]",
    border: "border-[hsl(140,60%,40%)]/30",
    bg: "bg-[hsl(140,60%,40%)]/10",
  },
  {
    id: "fire-emblem",
    title: "Fire Emblem Engage",
    titleAr: "فاير إمبلم إنغيج",
    desc: "ملفات MSBT — حوارات، أسماء الشخصيات، المهام",
    image: heroBgFe,
    href: "/fire-emblem",
    accent: "from-[hsl(0,80%,60%)] to-[hsl(220,80%,60%)]",
    border: "border-[hsl(0,60%,50%)]/30",
    bg: "bg-[hsl(0,60%,50%)]/10",
  },
];

export default function GameHub() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="py-20 px-4 text-center">
        <div className="max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 mb-6 px-4 py-2 rounded-full bg-primary/10 border border-primary/30">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm text-primary font-display font-semibold">أداة تعريب ألعاب نينتندو سويتش</span>
          </div>
          <h1 className="text-4xl md:text-6xl font-display font-black mb-6 leading-tight">
            عرّب{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-l from-primary to-secondary">
              ألعابك المفضلة
            </span>
          </h1>
          <p className="text-lg text-muted-foreground font-body max-w-lg mx-auto">
            اختر اللعبة التي تريد تعريبها — ارفع الملفات واحصل على نسخة معرّبة بالكامل
          </p>
        </div>
      </header>

      <section className="flex-1 px-4 pb-20">
        <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-6">
          {games.map((game) => (
            <Link
              key={game.id}
              to={game.href}
              className={`group relative rounded-2xl border ${game.border} overflow-hidden transition-all hover:scale-[1.02] hover:shadow-2xl`}
            >
              <div className="relative h-48 overflow-hidden">
                <img
                  src={game.image}
                  alt={game.title}
                  className="w-full h-full object-cover transition-transform group-hover:scale-110"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-card via-card/60 to-transparent" />
              </div>
              <div className="relative p-6 -mt-8">
                <h2 className={`text-xl font-display font-black mb-1 text-transparent bg-clip-text bg-gradient-to-l ${game.accent}`}>
                  {game.title}
                </h2>
                <p className="text-sm font-display font-bold text-foreground mb-2">{game.titleAr}</p>
                <p className="text-xs text-muted-foreground font-body">{game.desc}</p>
                <div className={`mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg ${game.bg} text-sm font-display font-semibold`}>
                  ابدأ التعريب →
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* Bundle Extractor link */}
        <div className="max-w-4xl mx-auto mt-8">
          <Link
            to="/bundle-extractor"
            className="group flex items-center gap-4 rounded-2xl border border-border/50 p-5 transition-all hover:scale-[1.01] hover:shadow-xl hover:border-primary/30 bg-card/50"
          >
            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 text-primary">
              <Package className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-display font-bold text-foreground">أداة فك حزم Unity Asset Bundle</h3>
              <p className="text-xs text-muted-foreground font-body">استخراج واستبدال ملفات MSBT داخل حزم .bundle و .bytes.bundle</p>
            </div>
            <span className="mr-auto text-muted-foreground group-hover:text-primary transition-colors">←</span>
          </Link>
        </div>
      </section>

      <footer className="mt-auto py-6 text-center text-sm text-muted-foreground border-t border-border">
        <div>أداة تعريب ألعاب نينتندو سويتش — مشروع مفتوح المصدر 🇸🇦</div>
        <div className="mt-1 text-xs opacity-60">الإصدار {APP_VERSION}</div>
      </footer>
    </div>
  );
}
