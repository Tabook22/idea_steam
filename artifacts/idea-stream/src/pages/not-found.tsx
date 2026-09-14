import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n";

export default function NotFound() {
  const [, setLocation] = useLocation();
  const { t } = useLanguage();

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background p-6">
      <div className="text-center max-w-md">
        <h1 className="text-6xl font-serif font-bold text-primary mb-4">404</h1>
        <h2 className="text-2xl font-serif font-medium mb-4">{t("pageNotFound")}</h2>
        <p className="text-muted-foreground mb-8">
          {t("pageMissing")}
        </p>
        <Button onClick={() => setLocation("/")} size="lg" className="w-full sm:w-auto">
          {t("returnSubjects")}
        </Button>
      </div>
    </div>
  );
}
