import { Languages } from "lucide-react";
import { useLanguage } from "@/lib/i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function LanguageToggle() {
  const { language, setLanguage, t } = useLanguage();

  return (
    <Select value={language} onValueChange={(value) => setLanguage(value as "en" | "ar")}>
      <SelectTrigger
        className="h-9 w-32 gap-2 bg-background/90 shadow-sm backdrop-blur"
        aria-label={t("appLanguage")}
      >
        <Languages className="h-4 w-4" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="en">{t("englishLanguage")}</SelectItem>
        <SelectItem value="ar">{t("arabicLanguage")}</SelectItem>
      </SelectContent>
    </Select>
  );
}