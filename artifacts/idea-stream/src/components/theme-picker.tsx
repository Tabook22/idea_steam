import { Check, Monitor, Moon, Palette as PaletteIcon, Sun } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLanguage } from "@/lib/i18n";
import { PALETTES, setTheme, useTheme, type ThemeMode } from "@/lib/theme";

/** Top-bar button: light / dark / auto, and the colour palette, previewed live. */
export function ThemePicker() {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const theme = useTheme();
  const modes: [ThemeMode, typeof Sun, string][] = [
    ["light", Sun, copy("Light", "فاتح")],
    ["dark", Moon, copy("Dark", "داكن")],
    ["system", Monitor, copy("Auto", "تلقائي")],
  ];

  return (
    <Popover>
      <PopoverTrigger
        aria-label={copy("Theme and colours", "المظهر والألوان")}
        title={copy("Theme and colours", "المظهر والألوان")}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border bg-background/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-secondary data-[state=open]:bg-secondary"
      >
        {theme.dark ? <Moon size={16} /> : <PaletteIcon size={16} />}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[19rem] rounded-2xl p-3" dir={isArabic ? "rtl" : "ltr"}>
        <p className="px-1 text-sm font-semibold">{copy("Appearance", "المظهر")}</p>

        <div role="radiogroup" aria-label={copy("Light or dark", "فاتح أو داكن")} className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
          {modes.map(([id, Icon, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={theme.mode === id}
              onClick={() => setTheme({ mode: id })}
              className={`flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors ${theme.mode === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Icon size={14} />{label}
            </button>
          ))}
        </div>

        <p className="mt-3 px-1 text-xs font-medium text-muted-foreground">{copy("Colours", "الألوان")}</p>
        <div role="radiogroup" aria-label={copy("Colours", "الألوان")} className="mt-1.5 grid grid-cols-4 gap-2">
          {PALETTES.map((palette) => {
            const [background, card, brand] = theme.dark ? palette.dark : palette.light;
            const active = theme.palette === palette.id;
            const name = isArabic ? palette.ar : palette.en;
            return (
              <button
                key={palette.id}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={name}
                title={name}
                onClick={() => setTheme({ palette: palette.id })}
                className="group flex flex-col items-center gap-1 rounded-xl p-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {/* A tiny page: background, a card with two text lines, and a brand button. */}
                <span
                  className={`relative block h-14 w-full overflow-hidden rounded-lg border transition-shadow ${active ? "ring-2 ring-primary ring-offset-2 ring-offset-popover" : "group-hover:ring-1 group-hover:ring-border"}`}
                  style={{ background }}
                >
                  <span className="absolute inset-x-1.5 top-1.5 h-6 rounded-md shadow-sm" style={{ background: card }}>
                    <span className="absolute start-1.5 top-1.5 h-1 w-6 rounded-full opacity-40" style={{ background: brand }} />
                    <span className="absolute start-1.5 top-3.5 h-1 w-4 rounded-full opacity-25" style={{ background: brand }} />
                  </span>
                  <span className="absolute bottom-1.5 end-1.5 h-3.5 w-7 rounded-full" style={{ background: brand }} />
                  {active && (
                    <span className="absolute bottom-1.5 start-1.5 grid h-3.5 w-3.5 place-items-center rounded-full" style={{ background: brand }}>
                      <Check size={9} strokeWidth={3.5} style={{ color: background }} />
                    </span>
                  )}
                </span>
                <span className={`truncate ${active ? "text-foreground" : ""}`}>{name}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 px-1 text-[11px] leading-4 text-muted-foreground">
          {copy("Saved on this device. Auto follows your phone or computer's day and night setting.", "يُحفظ على هذا الجهاز. «تلقائي» يتبع وضع النهار والليل في جهازك.")}
        </p>
      </PopoverContent>
    </Popover>
  );
}
