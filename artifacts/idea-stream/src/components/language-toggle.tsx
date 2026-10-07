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
        className="h-9 w-auto gap-1.5 bg-background/90 px-2.5 shadow-sm backdrop-blur sm:w-32 sm:gap-2 sm:px-3"
        aria-label={t("appLanguage")}
      >
        <Languages className="h-4 w-4" />
        {/* Phones: a short code, so the top bar fits; wider screens: the full name. */}
        <span className="text-xs font-semibold sm:hidden">{language === "ar" ? "ع" : "EN"}</span>
        <div className="hidden sm:block"><SelectValue /></div>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="en">{t("englishLanguage")}</SelectItem>
        <SelectItem value="ar">{t("arabicLanguage")}</SelectItem>
      </SelectContent>
    </Select>
  );
}