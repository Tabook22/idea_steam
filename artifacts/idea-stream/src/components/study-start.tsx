import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { BookOpenCheck, GraduationCap, Layers, Loader2, ListChecks, NotebookText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/i18n";
import { LiveError } from "@/lib/live-api";
import { listPacks, makePack, type StudyKind, type StudyOptions, type StudySummary } from "@/lib/study-api";

const PREFS = "idea-stream-study-options";
const readOptions = (): StudyOptions => {
  try { return { questions: 10, difficulty: "mixed", audience: "students", language: "auto", ...JSON.parse(localStorage.getItem(PREFS) || "{}") }; }
  catch { return { questions: 10, difficulty: "mixed", audience: "students", language: "auto" }; }
};

/**
 * "Make a study pack" from a recording, notebook or draft: study notes with a concept map, key
 * terms, a quiz and flashcards, plus printable handouts. Shows packs already made from it.
 */
export function StudyStart({ open, onOpenChange, kind, sourceId, title }: { open: boolean; onOpenChange: (open: boolean) => void; kind: StudyKind; sourceId: number; title: string }) {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [options, setOptionsState] = useState<StudyOptions>(readOptions);
  const [existing, setExisting] = useState<StudySummary[]>([]);
  const [busy, setBusy] = useState(false);
  const setOptions = (patch: Partial<StudyOptions>) => setOptionsState((current) => {
    const next = { ...current, ...patch };
    try { localStorage.setItem(PREFS, JSON.stringify(next)); } catch { /* optional */ }
    return next;
  });
  useEffect(() => { if (open) void listPacks({ kind, id: sourceId }).then(setExisting).catch(() => setExisting([])); }, [open, kind, sourceId]);

  async function start() {
    setBusy(true);
    try {
      const pack = await makePack(kind, sourceId, options);
      onOpenChange(false);
      navigate(`/study/${pack.id}`);
    } catch (error) { toast({ variant: "destructive", title: error instanceof LiveError ? error.message : copy("It couldn't be started.", "تعذر البدء.") }); }
    finally { setBusy(false); }
  }
  const chip = (active: boolean) => `rounded-full border px-3 py-1.5 text-sm font-medium transition ${active ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`;
  const row = (label: string, children: React.ReactNode) => (
    <div><p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><div className="flex flex-wrap gap-1.5">{children}</div></div>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-2xl"><span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-600 to-sky-600 text-white"><GraduationCap size={19} /></span>{copy("Study pack", "حزمة دراسية")}</DialogTitle>
          <DialogDescription dir="auto" className="line-clamp-1">{title}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {[[NotebookText, copy("Study notes and a concept map", "ملخص وخريطة مفاهيم")], [BookOpenCheck, copy("Key terms", "المصطلحات الأساسية")], [ListChecks, copy("A quiz with answers", "اختبار بالإجابات")], [Layers, copy("Flashcards to remember", "بطاقات للحفظ")]].map(([Icon, label], index) => {
            const I = Icon as typeof NotebookText;
            return <span key={index} className="flex items-center gap-2 rounded-xl bg-secondary/60 px-3 py-2"><I size={16} className="shrink-0 text-primary" />{label as string}</span>;
          })}
        </div>
        <div className="space-y-4">
          {row(copy("Quiz questions", "عدد الأسئلة"), [5, 10, 15, 20].map((n) => <button key={n} type="button" onClick={() => setOptions({ questions: n })} aria-pressed={options.questions === n} className={chip(options.questions === n)}>{n}</button>))}
          {row(copy("Level", "المستوى"), ([["easy", copy("Easy", "سهل")], ["mixed", copy("Mixed", "متنوع")], ["hard", copy("Challenging", "متقدم")]] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setOptions({ difficulty: value })} aria-pressed={options.difficulty === value} className={chip(options.difficulty === value)}>{label}</button>))}
          {row(copy("For", "لمن"), ([["kids", copy("Children", "أطفال")], ["students", copy("Students", "طلاب")], ["adults", copy("Adults", "بالغون")]] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setOptions({ audience: value })} aria-pressed={options.audience === value} className={chip(options.audience === value)}>{label}</button>))}
          {row(copy("Language", "اللغة"), ([["auto", copy("As the material", "كلغة المحتوى")], ["ar", "العربية"], ["en", "English"]] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setOptions({ language: value })} aria-pressed={options.language === value} className={chip(options.language === value)}>{label}</button>))}
        </div>
        {existing.length > 0 && (
          <div className="rounded-2xl border bg-muted/30 p-3">
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">{copy("Already made from this", "حزم سابقة من هذا المحتوى")}</p>
            <div className="flex flex-wrap gap-1.5">
              {existing.slice(0, 4).map((pack) => (
                <Link key={pack.id} href={`/study/${pack.id}`} onClick={() => onOpenChange(false)} className="rounded-full border bg-background px-3 py-1 text-xs hover:border-primary/50">
                  {new Date(pack.createdAt).toLocaleDateString(isArabic ? "ar" : undefined, { day: "numeric", month: "short" })} · {copy(`${pack.questionCount} questions`, `${pack.questionCount} سؤال`)}
                </Link>
              ))}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{copy("Cancel", "إلغاء")}</Button>
          <Button onClick={() => void start()} disabled={busy} className="bg-gradient-to-r from-emerald-600 to-sky-600">
            {busy ? <Loader2 size={16} className="me-1.5 animate-spin" /> : <GraduationCap size={16} className="me-1.5" />}{copy("Make the study pack", "اصنع الحزمة")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
