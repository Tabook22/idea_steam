import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import HomePage from '@/pages/home';
import SubjectDetailPage from '@/pages/subject-detail';
import { LanguageProvider } from '@/lib/i18n';
import { LanguageToggle } from '@/components/language-toggle';
import {
  Route,
  Redirect,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function TopNav() {
  return (
    <div className="fixed end-4 top-4 z-50 flex items-center gap-3">
      <LanguageToggle />
    </div>
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
          <TopNav />
          <Router />
          <Toaster />
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
