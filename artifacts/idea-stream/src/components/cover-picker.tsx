import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, Check, Loader2 } from "lucide-react";
import {
  getGetSubjectQueryKey,
  getListSubjectsQueryKey,
  updateSubject,
  type Subject,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { COVER_COLORS, COVER_EMOJI, COVER_NAMES, coverStyle, type CoverColor } from "@/lib/covers";
import { useLanguage } from "@/lib/i18n";

type Coverable = Pick<Subject, "id" | "title" | "color" | "icon">;

/** Choose a notebook's cover: a colour and an emoji, with a live preview. */
export function CoverPicker({ subject, onClose }: { subject: Coverable | null; onClose: () => void }) {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [color, setColor] = useState<CoverColor | null>(null);
  const [icon, setIcon] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!subject) return;
    setColor((subject.color as CoverColor | null) ?? null);
    setIcon(subject.icon ?? null);
    setCustom(subject.icon && !COVER_EMOJI.includes(subject.icon) ? subject.icon : "");
  }, [subject]);

  if (!subject) return null;
  const preview = { id: subject.id, color };

  async function save() {
    if (!subject) return;
    setSaving(true);
    try {
      await updateSubject(subject.id, { color, icon });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListSubjectsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetSubjectQueryKey(subject.id) }),
      ]);
      onClose();
    } catch {
      toast({ variant: "destructive", title: copy("Couldn't save the cover. Please try again.", "تعذر حفظ الغلاف. حاول مجددًا.") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">{copy("Notebook cover", "غلاف الدفتر")}</DialogTitle>
        <DialogDescription className="sr-only">{copy("Choose a colour and an emoji for this notebook.", "اختر لونًا ورمزًا لهذا الدفتر.")}</DialogDescription>
        <div className="relative flex h-32 items-end gap-3 p-5 text-white" style={coverStyle(preview)}>
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/20 text-3xl shadow-inner backdrop-blur-sm">
            {icon ?? <BookOpen size={26} />}
          </span>
          <div className="min-w-0 pb-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/75">{copy("Notebook cover", "غلاف الدفتر")}</p>
            <p dir="auto" className="truncate font-serif text-xl">{subject.title}</p>
          </div>
        </div>

        <div className="space-y-5 p-5">
          <div>
            <p className="mb-2 text-sm font-medium">{copy("Colour", "اللون")}</p>
            <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label={copy("Colour", "اللون")}>
              <button type="button" role="radio" aria-checked={color === null} onClick={() => setColor(null)}
                className={`h-9 rounded-full border px-3 text-xs font-medium ${color === null ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary"}`}>
                {copy("Auto", "تلقائي")}
              </button>
              {COVER_NAMES.map((name) => (
                <button key={name} type="button" role="radio" aria-checked={color === name} onClick={() => setColor(name)}
                  aria-label={isArabic ? COVER_COLORS[name].ar : COVER_COLORS[name].en} title={isArabic ? COVER_COLORS[name].ar : COVER_COLORS[name].en}
                  className={`grid h-9 w-9 place-items-center rounded-full text-white ring-offset-2 ring-offset-background transition ${color === name ? "ring-2 ring-foreground" : "hover:scale-110"}`}
                  style={{ backgroundImage: `linear-gradient(135deg, ${COVER_COLORS[name].from}, ${COVER_COLORS[name].to})` }}>
                  {color === name && <Check size={15} />}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">{copy("Emoji", "الرمز")}</p>
            <div className="grid grid-cols-8 gap-1.5" role="radiogroup" aria-label={copy("Emoji", "الرمز")}>
              {COVER_EMOJI.map((emoji) => (
                <button key={emoji} type="button" role="radio" aria-checked={icon === emoji} onClick={() => { setIcon(emoji); setCustom(""); }}
                  className={`grid aspect-square place-items-center rounded-xl text-xl transition ${icon === emoji ? "bg-primary/15 ring-2 ring-primary" : "hover:bg-secondary"}`}>
                  {emoji}
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <input value={custom} maxLength={8}
                onChange={(event) => { setCustom(event.target.value); setIcon(event.target.value.trim() || null); }}
                placeholder={copy("Or type any emoji", "أو اكتب أي رمز")} aria-label={copy("Your own emoji", "رمزك الخاص")}
                className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm outline-none focus:border-primary" />
              <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => { setIcon(null); setCustom(""); }}>
                {copy("No emoji", "بلا رمز")}
              </Button>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>{copy("Cancel", "إلغاء")}</Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving && <Loader2 size={15} className="me-1.5 animate-spin" />}{copy("Save cover", "احفظ الغلاف")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
