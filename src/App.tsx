import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import ErrorBoundary from "@/components/ErrorBoundary";
import UpdateBanner from "@/components/UpdateBanner";

import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";

const GameHub = lazy(() => import("./pages/GameHub"));
const AnimalCrossing = lazy(() => import("./pages/AnimalCrossing"));
const FireEmblem = lazy(() => import("./pages/FireEmblem"));
const MsbtProcess = lazy(() => import("./pages/MsbtProcess"));
const Editor = lazy(() => import("./pages/Editor"));
const Auth = lazy(() => import("./pages/Auth"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Install = lazy(() => import("./pages/Install"));
const BundleExtractor = lazy(() => import("./pages/BundleExtractor"));


const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <Loader2 className="w-8 h-8 animate-spin text-primary" />
  </div>
);


const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <Toaster />
        <Sonner />
        <UpdateBanner />
        
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ErrorBoundary fallbackTitle="حدث خطأ في التطبيق">
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<GameHub />} />
                <Route path="/animal-crossing" element={<AnimalCrossing />} />
                <Route path="/animal-crossing/process" element={<ErrorBoundary fallbackTitle="خطأ في المعالجة"><MsbtProcess key="ac" /></ErrorBoundary>} />
                <Route path="/fire-emblem" element={<FireEmblem />} />
                <Route path="/fire-emblem/process" element={<ErrorBoundary fallbackTitle="خطأ في المعالجة"><MsbtProcess key="fe" /></ErrorBoundary>} />
                <Route path="/editor" element={<ErrorBoundary fallbackTitle="خطأ في المحرر"><Editor /></ErrorBoundary>} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/install" element={<Install />} />
                <Route path="/bundle-extractor" element={<ErrorBoundary fallbackTitle="خطأ في فاك الحزم"><BundleExtractor /></ErrorBoundary>} />
                <Route path="/cobalt" element={<ErrorBoundary fallbackTitle="خطأ في المحرر"><Editor /></ErrorBoundary>} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
