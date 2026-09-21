import { type ReactNode } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { appPath } from "@/lib/app-path";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import HomePage from "@/pages/home";
import SubjectDetailPage from "@/pages/subject-detail";
import RecorderPage from "@/pages/recorder";
import { RecorderProvider } from "@/components/recorder-provider";
import { LanguageProvider, useLanguage } from "@/lib/i18n";
import { LanguageToggle } from "@/components/language-toggle";
import {
  Route,
  Redirect,
  Switch,
  useLocation,
  Router as WouterRouter,
} from "wouter";

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function TopNav() {
  return (
    <div className="flex items-center justify-end gap-3 px-4 py-3">
      <LanguageToggle />
    </div>
  );
}

function ServiceNotice() {
  const { isArabic } = useLanguage();
  const { data } = useQuery({
    queryKey: ["service-capabilities"],
    enabled: import.meta.env.VITE_DESIGN_PREVIEW !== "true",
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const response = await fetch(
        appPath("/api/capabilities", import.meta.env.BASE_URL),
      );
      if (!response.ok) throw new Error("Capabilities unavailable");
      return response.json() as Promise<{ ai: boolean }>;
    },
  });
  if (data?.ai !== false) return null;
  return (
    <p
      className="border-b bg-amber-50 px-4 py-3 text-center text-xs text-amber-950"
      role="status"
    >
      {isArabic
        ? "الكتابة والتفريغ بالذكاء الاصطناعي غير مفعّلين بعد. يمكنك حفظ الملاحظات والصوت وتنظيمهما."
        : "AI writing and transcription are not enabled yet. You can still save and organize notes and audio."}
    </p>
  );
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/">{() => <Redirect to="/app" />}</Route>
        <Route path="/app" component={HomePage} />
        <Route path="/record" component={RecorderPage} />
        <Route path="/subjects/:id" component={SubjectDetailPage} />
        <Route path="/sign-in/*?">{() => <Redirect to="/app" />}</Route>
        <Route path="/sign-up/*?">{() => <Redirect to="/app" />}</Route>
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function AppContent() {
  return (
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <RecorderProvider>
            <ServiceNotice />
            {import.meta.env.VITE_DESIGN_PREVIEW === "true" && (
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900">
                Design preview · AI is simulated · Server data resets on restart
                · Device recordings stay in this browser
              </div>
            )}
            <TopNav />
            <Router />
            <Toaster />
          </RecorderProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </LanguageProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <AppContent />
    </WouterRouter>
  );
}

export default App;
