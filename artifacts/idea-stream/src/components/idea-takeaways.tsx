import { useEffect, useState } from "react";
import { getIdeaTakeaways, makeIdeaTakeaways, type IdeaTakeawaysResult, type TakeawayPoint } from "@workspace/api-client-react";
import {
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  HelpCircle,
  Lightbulb,
  Loader2,
  Puzzle,
  Quote,
  RefreshCw,
  Scale,
  Sparkles,
  Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLanguage } from "@/lib/i18n";

type Copy = (en: string, ar: string) => string;

const KIND: Record<TakeawayPoint["kind"], { icon: typeof Lightbulb; en: string; ar: string; tone: string }> = {
  insight: { icon: Lightbulb, en: "Insight", ar: "فكرة", tone: "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200" },
  fact: { icon: BarChart3, en: "Fact", ar: "حقيقة", tone: "bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200" },
  action: { icon: CheckCircle2, en: "To do", ar: "إجراء", tone: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200" },
  question: { icon: HelpCircle, en: "Question", ar: "سؤال", tone: "bg-violet-100 text-violet-900 dark:bg-violet-950/50 dark:text-violet-200" },
  argument: { icon: Scale, en: "Argument", ar: "حجة", tone: "bg-rose-100 text-rose-900 dark:bg-rose-950/50 dark:text-rose-200" },
  example: { icon: Puzzle, en: "Example", ar: "مثال", tone: "bg-teal-100 text-teal-900 dark:bg-teal-950/50 dark:text-teal-200" },
};
// Each number gets its own colour, so "number 3" is easy to find again.
const NUMBER_COLORS = ["from-violet-600 to-indigo-500", "from-sky-600 to-cyan-500", "from-emerald-600 to-teal-500", "from-amber-500 to-orange-500", "from-rose-600 to-pink-500", "from-fuchsia-600 to-purple-500", "from-lime-600 to-green-500", "from-blue-700 to-sky-500"];

const asText = (result: NonNullable<IdeaTakeawaysResult["takeaways"]>) => [
  result.gist, "",
  ...result.points.map((point, index) => [`${index + 1}. ${point.title}`, `   ${point.summary}`, point.details && `   ${point.details}`, point.why && `   → ${point.why}`, point.quote && `   “${point.quote}”`].filter(Boolean).join("\n")),
].join("\n").trim();

/**
 * The key takeaways of one idea: the whole idea in one sentence, then its most important points as
 * a numbered list; tap a number to open it (details, why it matters, the words from the source).
 */
export function IdeaTakeaways({ ideaId, preview, open, onOpenChange }: { ideaId: number; preview: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { isArabic } = useLanguage();
  const copy: Copy = (en, ar) => (isArabic ? ar : en);
  const [result, setResult] = useState<IdeaTakeawaysResult | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openPoints, setOpenPoints] = useState<Set<number>>(new Set([0]));
  const [copied, setCopied] = useState<number | "all" | null>(null);
  const [step, setStep] = useState(0);

  async function analyse(fresh = false) {
    setWorking(true); setError(null);
    try {
      const made = await makeIdeaTakeaways(ideaId, fresh ? { fresh: true } : {});
      setResult(made);
      setOpenPoints(new Set([0]));
    } catch (failure) {
      setError((failure as { data?: { error?: string } })?.data?.error ?? copy("The idea couldn't be analysed. Please try again.", "تعذر تحليل الفكرة. حاول مجددًا."));
    } finally { setWorking(false); }
  }
  // Opening: show what was made before, or make it now.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    void getIdeaTakeaways(ideaId).then((found) => {
      if (cancelled) return;
      if (found.takeaways) { setResult(found); setOpenPoints(new Set([0])); }
      else void analyse();
    }).catch(() => { if (!cancelled) void analyse(); });
    return () => { cancelled = true; };
  }, [open, ideaId]); // eslint-disable-line react-hooks/exhaustive-deps
  // What's happening while it reads.
  useEffect(() => {
    if (!working) return;
    setStep(0);
    const timer = window.setInterval(() => setStep((current) => Math.min(current + 1, 3)), 2600);
    return () => window.clearInterval(timer);
  }, [working]);
  // Number keys open and close points.
  useEffect(() => {
    if (!open || !result?.takeaways) return;
    const keys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable=true]")) return;
      const index = Number(event.key) - 1;
      if (index >= 0 && index < (result.takeaways?.points.length ?? 0)) toggle(index);
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (index: number) => setOpenPoints((current) => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; });
  const copyText = (value: string, which: number | "all") => { void navigator.clipboard?.writeText(value); setCopied(which); setTimeout(() => setCopied(null), 1500); };
  const takeaways = result?.takeaways;
  const allOpen = !!takeaways && openPoints.size === takeaways.points.length;
  const steps = [copy("Reading the whole idea…", "جارٍ قراءة الفكرة كاملة…"), copy("Finding what matters most…", "جارٍ استخراج الأهم…"), copy("Explaining each point…", "جارٍ شرح كل نقطة…"), copy("Checking quotes against the text…", "جارٍ مطابقة الاقتباسات مع النص…")];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[96vw] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 space-y-1 border-b bg-gradient-to-br from-violet-500/10 via-primary/5 to-amber-400/15 px-5 py-4 pe-12 text-start">
          <DialogTitle className="flex items-center gap-2.5 font-serif text-2xl">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-violet-600 to-amber-500 text-white shadow-md"><Sparkles size={18} /></span>
            {copy("Key takeaways", "أهم ما في الفكرة")}
          </DialogTitle>
          <DialogDescription dir="auto" className="line-clamp-1">{preview}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {working ? (
            <div className="space-y-4" role="status">
              <p className="flex items-center gap-2 text-sm font-medium text-violet-800 dark:text-violet-200"><Loader2 size={16} className="animate-spin" />{steps[step]}</p>
              <div className="h-20 animate-pulse rounded-3xl bg-muted" />
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="flex animate-pulse items-center gap-3 rounded-2xl border p-3" style={{ animationDelay: `${index * 120}ms` }}>
                  <span className="h-9 w-9 rounded-full bg-muted" />
                  <span className="h-4 flex-1 rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="py-10 text-center">
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button className="mt-4 rounded-full" onClick={() => void analyse()}><RefreshCw size={15} className="me-1.5" />{copy("Try again", "حاول مجددًا")}</Button>
            </div>
          ) : takeaways ? (
            <div className="space-y-5">
              {takeaways.gist && (
                <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 to-slate-700 p-5 text-white shadow-lg dark:from-slate-800 dark:to-slate-900">
                  <span aria-hidden="true" className="pointer-events-none absolute -end-6 -top-6 h-28 w-28 rounded-full bg-amber-400/20 blur-2xl" />
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-300">{copy("In one sentence", "في جملة واحدة")}</p>
                  <p dir="auto" className="mt-1.5 font-serif text-xl leading-snug text-white">{takeaways.gist}</p>
                </section>
              )}
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded-full bg-secondary px-2.5 py-1 font-semibold text-foreground">{copy(`${takeaways.points.length} takeaways`, `${takeaways.points.length} نقاط`)}</span>
                <span className="rounded-full bg-secondary px-2.5 py-1">{copy(`from ${takeaways.words.toLocaleString()} words`, `من ${takeaways.words.toLocaleString("ar")} كلمة`)}</span>
                {takeaways.words > 400 && <span className="rounded-full bg-secondary px-2.5 py-1">{copy(`≈ ${Math.round(takeaways.words / 230)} min of reading`, `≈ ${Math.round(takeaways.words / 230)} دقائق قراءة`)}</span>}
                <button type="button" onClick={() => setOpenPoints(allOpen ? new Set() : new Set(takeaways.points.map((_, index) => index)))}
                  className="ms-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium text-primary hover:bg-primary/10">
                  {allOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}{allOpen ? copy("Close all", "أغلق الكل") : copy("Open all", "افتح الكل")}
                </button>
              </div>
              {result?.stale && (
                <p className="flex flex-wrap items-center gap-2 rounded-2xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                  {copy("The idea changed since these were made.", "تغيّرت الفكرة منذ إعداد هذه النقاط.")}
                  <button type="button" onClick={() => void analyse(true)} className="font-semibold underline">{copy("Analyse again", "حلّلها مجددًا")}</button>
                </p>
              )}
              <ol className="space-y-2.5">
                {takeaways.points.map((point, index) => {
                  const isOpen = openPoints.has(index);
                  const kind = KIND[point.kind] ?? KIND.insight;
                  return (
                    <li key={index} className={`overflow-hidden rounded-2xl border bg-card transition-shadow ${isOpen ? "shadow-md ring-1 ring-primary/15" : "shadow-sm hover:shadow-md"}`}>
                      <button type="button" onClick={() => toggle(index)} aria-expanded={isOpen} className="flex w-full items-start gap-3 p-3.5 text-start">
                        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br ${NUMBER_COLORS[index % NUMBER_COLORS.length]} text-lg font-bold text-white shadow-sm`}>{index + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span dir="auto" className="block text-[15px] font-semibold leading-snug">{point.title}</span>
                          <span dir="auto" className={`mt-0.5 block text-sm leading-6 text-muted-foreground ${isOpen ? "" : "line-clamp-2"}`}>{point.summary}</span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1.5">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${kind.tone}`}><kind.icon size={11} />{copy(kind.en, kind.ar)}</span>
                          <ChevronDown size={18} className={`text-muted-foreground transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`} />
                        </span>
                      </button>
                      {/* Opens smoothly to its full height. */}
                      <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                        <div className="min-h-0 overflow-hidden">
                          <div className="space-y-3 px-3.5 pb-4 sm:ps-[4.25rem]">
                            {point.details && <p dir="auto" className="text-start text-[15px] leading-7">{point.details}</p>}
                            {point.why && (
                              <div className="flex gap-2 rounded-xl border-s-4 border-amber-400 bg-amber-50/80 px-3 py-2 text-sm leading-6 dark:bg-amber-950/20">
                                <Target size={15} className="mt-1 shrink-0 text-amber-600" />
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">{copy("Why it matters", "لماذا يهم")}</p>
                                  <p dir="auto">{point.why}</p>
                                </div>
                              </div>
                            )}
                            {point.quote && (
                              <blockquote dir="auto" className="relative rounded-xl bg-muted/60 px-4 py-3 font-serif text-[15px] italic leading-7 text-foreground/90">
                                <Quote size={14} className="mb-1 text-primary/70" />
                                “{point.quote}”
                                <span className="mt-1 block font-sans text-[11px] not-italic text-muted-foreground">{copy("From the idea, word for word", "من الفكرة بنصّها")}</span>
                              </blockquote>
                            )}
                            <button type="button" onClick={() => copyText([`${index + 1}. ${point.title}`, point.summary, point.details, point.why].filter(Boolean).join("\n"), index)}
                              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground">
                              {copied === index ? <Check size={13} /> : <Copy size={13} />}{copied === index ? copy("Copied", "نُسخ") : copy("Copy this point", "انسخ هذه النقطة")}
                            </button>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}
        </div>

        {takeaways && !working && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-card px-5 py-3">
            <Button variant="ghost" size="sm" className="rounded-full" onClick={() => void analyse(true)}><RefreshCw size={14} className="me-1.5" />{copy("Analyse again", "حلّل مجددًا")}</Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="rounded-full" onClick={() => copyText(asText(takeaways), "all")}>
                {copied === "all" ? <Check size={14} className="me-1.5" /> : <Copy size={14} className="me-1.5" />}{copied === "all" ? copy("Copied", "نُسخ") : copy("Copy all", "انسخ الكل")}
              </Button>
              <Button size="sm" className="rounded-full" onClick={() => onOpenChange(false)}>{copy("Done", "تم")}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
