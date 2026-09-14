import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background p-6">
      <div className="text-center max-w-md">
        <h1 className="text-6xl font-serif font-bold text-primary mb-4">404</h1>
        <h2 className="text-2xl font-serif font-medium mb-4">Page not found</h2>
        <p className="text-muted-foreground mb-8">
          The fragment you're looking for doesn't exist or has been moved.
        </p>
        <Button onClick={() => setLocation("/")} size="lg" className="w-full sm:w-auto">
          Return to Subjects
        </Button>
      </div>
    </div>
  );
}
