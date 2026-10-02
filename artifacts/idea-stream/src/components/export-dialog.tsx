import { useEffect, useState } from "react";
import { Check, Download, FileAudio, Loader2 } from "lucide-react";
import type { AudioLibraryItem } from "@workspace/api-client-react";
import { appPath } from "@/lib/app-path";
import { useLanguage } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type Format = "original" | "mp3" | "wav" | "m4a" | "ogg" | "opus" | "flac";
type Quality = "standard" | "high" | "best";
type Copy = (en: string, ar: string) => string;

const CHOICE_KEY = "idea-stream-export-choice";

/** What each format is for, and its three qualities with bytes per second (mono), for the size estimate. */
const FORMATS: { id: Exclude<Format, "original">; name: string; about: (copy: Copy) => string; qualities: Record<Quality, { label: string; bytesPerSecond: number }> }[] = [
  { id: "mp3", name: "MP3", about: (copy) => copy("Plays everywhere: phones, cars, WhatsApp", "يعمل في كل مكان: الهواتف والسيارات وواتساب"),
    qualities: { standard: { label: "128 kbps", bytesPerSecond: 16_000 }, high: { label: "192 kbps", bytesPerSecond: 24_000 }, best: { label: "320 kbps", bytesPerSecond: 40_000 } } },
  { id: "wav", name: "WAV", about: (copy) => copy("Uncompressed, for editing software. Large files", "غير مضغوط، لبرامج التحرير. ملفات كبيرة"),
    qualities: { standard: { label: "16 kHz", bytesPerSecond: 32_000 }, high: { label: "44.1 kHz", bytesPerSecond: 88_200 }, best: { label: "48 kHz", bytesPerSecond: 96_000 } } },
  { id: "m4a", name: "M4A (AAC)", about: (copy) => copy("Apple devices and iTunes; small and clear", "لأجهزة Apple؛ صغير وواضح"),
    qualities: { standard: { label: "96 kbps", bytesPerSecond: 12_000 }, high: { label: "128 kbps", bytesPerSecond: 16_000 }, best: { label: "192 kbps", bytesPerSecond: 24_000 } } },
  { id: "ogg", name: "OGG (Vorbis)", about: (copy) => copy("Open format for Android and the web", "صيغة مفتوحة لأندرويد والويب"),
    qualities: { standard: { label: "~40 kbps", bytesPerSecond: 5_000 }, high: { label: "~60 kbps", bytesPerSecond: 7_500 }, best: { label: "~80 kbps", bytesPerSecond: 10_000 } } },
  { id: "opus", name: "Opus", about: (copy) => copy("Smallest files, made for speech", "أصغر حجم، مصمم للكلام"),
    qualities: { standard: { label: "32 kbps", bytesPerSecond: 4_000 }, high: { label: "64 kbps", bytesPerSecond: 8_000 }, best: { label: "96 kbps", bytesPerSecond: 12_000 } } },
  { id: "flac", name: "FLAC", about: (copy) => copy("Lossless and smaller than WAV, for archiving", "بلا فقد وأصغر من WAV، للأرشفة"),
    qualities: { standard: { label: "16 kHz", bytesPerSecond: 19_000 }, high: { label: "44.1 kHz", bytesPerSecond: 48_000 }, best: { label: "48 kHz", bytesPerSecond: 50_000 } } },
];

function readChoice(): { format: Format; quality: Quality } {
  try {
    const saved = JSON.parse(localStorage.getItem(CHOICE_KEY) ?? "");
    if ((saved.format === "original" || FORMATS.some((f) => f.id === saved.format)) && ["standard", "high", "best"].includes(saved.quality)) return saved;
  } catch { /* first time or blocked storage */ }
  return { format: "mp3", quality: "high" };
}

function megabytes(bytes: number) {
  return bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** The file name the server chose (RFC 6266 filename* first, so Arabic names survive). */
function fileName(header: string | null, fallback: string) {
  const star = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (star) try { return decodeURIComponent(star); } catch { /* fall through */ }
  return header?.match(/filename="([^"]+)"/i)?.[1] ?? fallback;
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** "Download as…": pick a format and quality; the server converts and the file downloads. The library copy is unchanged. */
export function ExportDialog({ item, title, onClose }: { item: AudioLibraryItem | null; title: string; onClose: () => void }) {
  const { isArabic } = useLanguage();
  const copy: Copy = (en, ar) => (isArabic ? ar : en);
  const { toast } = useToast();
  const [choice, setChoice] = useState(readChoice);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (item) setChoice(readChoice()); }, [item]);

  const seconds = item?.durationSeconds ?? null;
  const originalExt = item?.mimeType?.includes("mp4") ? "m4a" : "webm";
  const selected = FORMATS.find((format) => format.id === choice.format);

  async function convert() {
    if (!item) return;
    try { localStorage.setItem(CHOICE_KEY, JSON.stringify(choice)); } catch { /* optional */ }
    setBusy(true);
    try {
      const url = choice.format === "original"
        ? appPath(item.url, import.meta.env.BASE_URL)
        : appPath(`/api/audio-library/${item.id}/export?format=${choice.format}&quality=${choice.quality}`, import.meta.env.BASE_URL);
      const response = await fetch(url, { credentials: "same-origin" });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? copy("The server couldn't convert this recording.", "تعذر على الخادم تحويل هذا التسجيل."));
      }
      const fallback = `${title.replace(/[<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Voice note"}.${choice.format === "original" ? originalExt : choice.format}`;
      const name = choice.format === "original" ? fallback : fileName(response.headers.get("Content-Disposition"), fallback);
      save(await response.blob(), name);
      toast({ title: copy("Downloaded", "تم التنزيل"), description: name });
      onClose();
    } catch (error) {
      toast({ variant: "destructive", title: copy("Couldn't convert", "تعذر التحويل"), description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const option = (active: boolean) =>
    `flex w-full items-start gap-3 rounded-xl border p-3 text-start transition-colors ${active ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-secondary"}`;

  return (
    <Dialog open={!!item} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
        <DialogTitle className="flex items-center gap-2"><FileAudio size={18} className="text-primary" />{copy("Download as…", "تنزيل بصيغة…")}</DialogTitle>
        <DialogDescription>
          <span dir="auto" className="font-medium text-foreground">{title}</span>
          {" · "}
          {copy("Choose a format. Your library copy stays as it is.", "اختر الصيغة. تبقى نسخة المكتبة كما هي.")}
        </DialogDescription>

        <div role="radiogroup" aria-label={copy("Format", "الصيغة")} className="grid gap-2 sm:grid-cols-2">
          {FORMATS.map((format) => {
            const active = choice.format === format.id;
            return (
              <button key={format.id} type="button" role="radio" aria-checked={active} disabled={busy}
                onClick={() => setChoice((current) => ({ ...current, format: format.id }))} className={option(active)}>
                <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${active ? "border-primary bg-primary text-primary-foreground" : ""}`}>
                  {active && <Check size={11} strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{format.name}</span>
                  <span className="block text-xs text-muted-foreground">{format.about(copy)}</span>
                </span>
              </button>
            );
          })}
          <button type="button" role="radio" aria-checked={choice.format === "original"} disabled={busy}
            onClick={() => setChoice((current) => ({ ...current, format: "original" }))} className={`${option(choice.format === "original")} sm:col-span-2`}>
            <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${choice.format === "original" ? "border-primary bg-primary text-primary-foreground" : ""}`}>
              {choice.format === "original" && <Check size={11} strokeWidth={3} />}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{copy("Original", "الأصل")} <span className="font-normal text-muted-foreground">(.{originalExt})</span></span>
              <span className="block text-xs text-muted-foreground">{copy("As recorded, no conversion", "كما سُجّل، بدون تحويل")}</span>
            </span>
          </button>
        </div>

        {selected && (
          <div>
            <p className="mb-1.5 text-sm font-medium">{copy("Quality", "الجودة")}</p>
            <div role="radiogroup" aria-label={copy("Quality", "الجودة")} className="grid grid-cols-3 gap-2">
              {(["standard", "high", "best"] as const).map((quality) => {
                const active = choice.quality === quality;
                const spec = selected.qualities[quality];
                return (
                  <button key={quality} type="button" role="radio" aria-checked={active} disabled={busy}
                    onClick={() => setChoice((current) => ({ ...current, quality }))}
                    className={`rounded-xl border px-2 py-2 text-center transition-colors ${active ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-secondary"}`}>
                    <span className="block text-sm font-medium">
                      {quality === "standard" ? copy("Standard", "عادية") : quality === "high" ? copy("High", "عالية") : copy("Best", "الأفضل")}
                    </span>
                    <span className="block text-[11px] text-muted-foreground" dir="ltr">{spec.label}</span>
                    {seconds != null && <span className="block text-[11px] tabular-nums text-muted-foreground" dir="ltr">≈ {megabytes(seconds * spec.bytesPerSecond)}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>{copy("Cancel", "إلغاء")}</Button>
          <Button disabled={busy} onClick={() => void convert()}>
            {busy ? <Loader2 size={16} className="me-2 animate-spin" /> : <Download size={16} className="me-2" />}
            {busy
              ? copy("Converting…", "جارٍ التحويل…")
              : choice.format === "original"
                ? copy("Download", "تنزيل")
                : copy(`Convert to ${selected?.name.split(" ")[0]} & download`, `حوّل إلى ${selected?.name.split(" ")[0]} ونزّل`)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
