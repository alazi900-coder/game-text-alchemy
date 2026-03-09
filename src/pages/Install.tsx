import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, Download, Smartphone, Check, Share } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const Install = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // Check if already installed
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
    }

    // Detect iOS
    const ua = navigator.userAgent;
    setIsIOS(/iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream);

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setIsInstalled(true);
    }
    setDeferredPrompt(null);
  };

  return (
    <div className="min-h-screen py-12 px-4">
      <div className="max-w-lg mx-auto">
        <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-8 font-body">
          <ArrowRight className="w-4 h-4" />
          العودة للرئيسية
        </Link>

        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto mb-4 rounded-2xl overflow-hidden shadow-lg border-2 border-secondary/30">
            <img src="/pwa-icon-192.png" alt="أيقونة التطبيق" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-3xl font-display font-bold mb-2">تثبيت التطبيق 📱</h1>
          <p className="text-muted-foreground font-body">
            ثبّت أداة تعريب Xenoblade على جهازك للوصول السريع
          </p>
        </div>

        {isInstalled ? (
          <Card className="border-primary/30">
            <CardContent className="p-6 text-center space-y-3">
              <Check className="w-12 h-12 text-primary mx-auto" />
              <h2 className="text-xl font-display font-bold">التطبيق مُثبّت بالفعل! ✅</h2>
              <p className="text-muted-foreground font-body text-sm">
                يمكنك فتحه من الشاشة الرئيسية لجهازك
              </p>
            </CardContent>
          </Card>
        ) : deferredPrompt ? (
          <Card className="border-secondary/30">
            <CardContent className="p-6 text-center space-y-4">
              <Smartphone className="w-12 h-12 text-secondary mx-auto" />
              <h2 className="text-xl font-display font-bold">جاهز للتثبيت!</h2>
              <p className="text-muted-foreground font-body text-sm">
                اضغط الزر أدناه لتثبيت التطبيق على جهازك
              </p>
              <Button size="lg" onClick={handleInstall} className="font-display font-bold px-8">
                <Download className="w-5 h-5" /> تثبيت التطبيق
              </Button>
            </CardContent>
          </Card>
        ) : isIOS ? (
          <Card className="border-secondary/30">
            <CardContent className="p-6 space-y-4">
              <Share className="w-12 h-12 text-secondary mx-auto" />
              <h2 className="text-xl font-display font-bold text-center">التثبيت على iPhone / iPad</h2>
              <ol className="space-y-3 font-body text-sm text-muted-foreground list-decimal list-inside">
                <li>اضغط على أيقونة <strong className="text-foreground">المشاركة</strong> (⬆️) في أسفل المتصفح</li>
                <li>اختر <strong className="text-foreground">"إضافة إلى الشاشة الرئيسية"</strong></li>
                <li>اضغط <strong className="text-foreground">"إضافة"</strong> للتأكيد</li>
              </ol>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-secondary/30">
            <CardContent className="p-6 space-y-4">
              <Smartphone className="w-12 h-12 text-secondary mx-auto" />
              <h2 className="text-xl font-display font-bold text-center">التثبيت على أندرويد</h2>
              <ol className="space-y-3 font-body text-sm text-muted-foreground list-decimal list-inside">
                <li>افتح <strong className="text-foreground">قائمة المتصفح</strong> (⋮) في الأعلى</li>
                <li>اختر <strong className="text-foreground">"تثبيت التطبيق"</strong> أو <strong className="text-foreground">"إضافة إلى الشاشة الرئيسية"</strong></li>
                <li>اضغط <strong className="text-foreground">"تثبيت"</strong> للتأكيد</li>
              </ol>
            </CardContent>
          </Card>
        )}

        <div className="mt-6 grid grid-cols-3 gap-3 text-center">
          {[
            { icon: "⚡", text: "سرعة فائقة" },
            { icon: "📴", text: "يعمل أوفلاين" },
            { icon: "🔔", text: "وصول سريع" },
          ].map((f) => (
            <Card key={f.text} className="border-border/50">
              <CardContent className="p-3">
                <span className="text-2xl">{f.icon}</span>
                <p className="text-xs font-display font-semibold mt-1">{f.text}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Install;
