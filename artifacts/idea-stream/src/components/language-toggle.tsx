import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n";

export function LanguageToggle() {
  const { language, setLanguage } = useLanguage();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => setLanguage(language === "en" ? "ar" : "en")}
      className="gap-2 bg-background/90 shadow-sm backdrop-blur"
      aria-label={language === "en" ? "التبديل إلى العربية" : "Switch to English"}
    >
      <Languages className="h-4 w-4" />
      {language === "en" ? "العربية" : "English"}
    </Button>
  );
}