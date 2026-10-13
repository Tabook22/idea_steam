import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import {
  ArrowLeft, Check, ChevronDown, FileDown, GraduationCap, Layers, ListChecks, Loader2, NotebookText, Quote, RefreshCw, RotateCcw, Trash2, Trophy, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { appPath } from "@/lib/app-path";
import { useLanguage } from "@/lib/i18n";
import { LiveError } from "@/lib/live-api";
import { deletePack, dueCards, getPack, remakePack, resetReviews, reviewCard, type QuizQuestion, type StudyPack } from "@/lib/study-api";
import { renderDiagram } from "@/lib/visual-draw";

type Copy = (en: string, ar: string) => string;
type Tab = "notes" | "quiz" | "cards";

/** One study pack: notes (with a concept map and key terms), a quiz to practise, and flashcards. */
export default function StudyPackPage() {
  const { id } = useParams<{ id: string }>();
  const { isArabic } = useLanguage();
  const copy: Copy = (en, ar) => (isArabic ? ar : en);
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [pack, setPack] = useState<StudyPack | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<Tab>("notes");
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  const [mapSrc, setMapSrc] = useState<string | null>(null);

  // Load, and keep checking while it's being made.
  useEffect(() => {
    let timer: number | undefined;
    let alive = true;
    const load = async () => {
      try {
        const found = await getPack(Number(id));
        if (!alive) return;
        setPack(found);
        if (found.status === "making") timer = window.setTimeout(() => void load(), 3000);
      } catch (error) { if (alive && error instanceof LiveError && error.status === 404) setMissing(true); else timer = window.setTimeout(() => void load(), 5000); }
    };
    void load();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [id]);
  const data = pack?.status === "ready" ? pack.data : null;
  useEffect(() => {
    if (!data?.concept) { setMapSrc(null); return; }
    void renderDiagram("concept", data.concept, pack!.title, "bright").then((canvas) => setMapSrc(canvas.toDataURL("image/png"))).catch(() => setMapSrc(null));
  }, [data, pack?.title]);

  async function pdf(kind: "notes" | "quiz" | "key") {
    if (!pack) return;
    setPdfBusy(kind);
    try {
      const response = await fetch(appPath(`/api/study/packs/${pack.id}/pdf`, import.meta.env.BASE_URL), {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, ...(kind === "notes" && mapSrc ? { conceptPng: mapSrc } : {}) }),
      });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "pdf");
      const blob = await response.blob();
      const name = decodeURIComponent(response.headers.get("Content-Disposition")?.match(/filename\*=UTF-8''([^;]+)/)?.[1] ?? "study.pdf");
      const url = URL.createObjectURL(blob);
      const link = Object.assign(document.createElement("a"), { href: url, download: name });
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (error) { toast({ variant: "destructive", title: (error as Error).message !== "pdf" ? (error as Error).message : copy("The PDF couldn't be made.", "تعذر إنشاء PDF.") }); }
    finally { setPdfBusy(null); }
  }

  if (missing) return <main className="p-10 text-center text-muted-foreground">{copy("This study pack doesn't exist.", "هذه الحزمة غير موجودة.")} <Link href="/study" className="text-primary underline">{copy("All study packs", "كل الحزم")}</Link></main>;
  if (!pack) return <main className="grid min-h-[50vh] place-items-center"><Loader2 className="animate-spin text-muted-foreground" /></main>;
  const due = data ? dueCards(data.cards.length, pack.reviews).length : 0;
  const tabs: Array<[Tab, typeof NotebookText, string, number | null]> = [
    ["notes", NotebookText, copy("Notes", "الملخص"), null],
    ["quiz", ListChecks, copy("Quiz", "الاختبار"), data?.quiz.length ?? null],
    ["cards", Layers, copy("Flashcards", "البطاقات"), due || null],
  ];
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2 sm:px-6" dir={data?.language === "ar" ? "rtl" : undefined}>
      <Link href="/study" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={16} className="rtl:rotate-180" />{copy("Study packs", "الحزم الدراسية")}</Link>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400"><GraduationCap size={15} />{copy("Study pack", "حزمة دراسية")}</p>
          <h1 dir="auto" className="mt-1 font-serif text-3xl leading-tight sm:text-4xl">{pack.title}</h1>
        </div>
        {data && (
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="rounded-full" disabled={!!pdfBusy}>{pdfBusy ? <Loader2 size={16} className="me-1.5 animate-spin" /> : <FileDown size={16} className="me-1.5" />}{copy("Handouts", "مطبوعات")}<ChevronDown size={14} className="ms-1" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void pdf("notes")}>{copy("Study notes (PDF)", "الملخص (PDF)")}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void pdf("quiz")}>{copy("Quiz for learners (PDF)", "الاختبار للطلاب (PDF)")}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void pdf("key")}>{copy("Answer key (PDF)", "مفتاح الإجابات (PDF)")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline" size="icon" className="rounded-full" aria-label={copy("More", "المزيد")}><RefreshCw size={16} /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void remakePack(pack.id).then(setPack)}><RefreshCw size={15} className="me-2" />{copy("Make again (new questions)", "اصنعها مجددًا (أسئلة جديدة)")}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => { if (window.confirm(copy("Delete this study pack?", "حذف هذه الحزمة؟"))) void deletePack(pack.id).then(() => navigate("/study")); }}><Trash2 size={15} className="me-2" />{copy("Delete", "حذف")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </header>

      {pack.status === "making" ? (
        <Preparing copy={copy} />
      ) : pack.status === "failed" || !data ? (
        <div className="rounded-3xl border p-8 text-center">
          <p className="text-sm text-muted-foreground">{pack.error ?? copy("It couldn't be made.", "تعذر الإنشاء.")}</p>
          <Button className="mt-4 rounded-full" onClick={() => void remakePack(pack.id).then(setPack)}><RefreshCw size={15} className="me-1.5" />{copy("Try again", "حاول مجددًا")}</Button>
        </div>
      ) : (
        <>
          <nav className="sticky top-0 z-10 -mx-4 mb-5 flex gap-1 bg-background/90 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-full sm:border sm:p-1" role="tablist">
            {tabs.map(([value, Icon, label, badge]) => (
              <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold transition ${tab === value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                <Icon size={16} />{label}{badge !== null && <span className={`rounded-full px-1.5 text-[11px] ${tab === value ? "bg-white/25" : "bg-secondary"}`}>{badge}</span>}
              </button>
            ))}
          </nav>
          {tab === "notes" && <Notes pack={pack} mapSrc={mapSrc} copy={copy} />}
          {tab === "quiz" && <QuizPractice questions={data.quiz} copy={copy} ar={data.language === "ar"} />}
          {tab === "cards" && <Flashcards pack={pack} onReviews={(reviews) => setPack({ ...pack, reviews })} copy={copy} />}
        </>
      )}
    </main>
  );
}

function Preparing({ copy }: { copy: Copy }) {
  const steps = [copy("Reading the material carefully…", "جارٍ قراءة المحتوى بعناية…"), copy("Writing the study notes…", "جارٍ كتابة الملخص…"), copy("Writing the quiz and answers…", "جارٍ كتابة الاختبار والإجابات…"), copy("Making the flashcards…", "جارٍ إعداد البطاقات…"), copy("Checking quotes against the material…", "جارٍ مطابقة الاقتباسات مع المحتوى…")];
  const [step, setStep] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setStep((s) => Math.min(s + 1, steps.length - 1)), 9000); return () => window.clearInterval(timer); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="rounded-3xl border bg-gradient-to-br from-emerald-50 to-sky-50 p-8 text-center dark:from-emerald-950/20 dark:to-sky-950/20" role="status">
      <GraduationCap size={40} className="mx-auto animate-pulse text-emerald-600" />
      <p className="mt-3 font-serif text-xl">{steps[step]}</p>
      <p className="mt-1 text-sm text-muted-foreground">{copy("About a minute. You can leave this page; it keeps going.", "نحو دقيقة. يمكنك مغادرة الصفحة وسيستمر العمل.")}</p>
      <div className="mx-auto mt-5 h-1.5 max-w-xs overflow-hidden rounded-full bg-white/70 dark:bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-sky-500 transition-all duration-1000" style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div>
    </div>
  );
}

function Notes({ pack, mapSrc, copy }: { pack: StudyPack; mapSrc: string | null; copy: Copy }) {
  const data = pack.data!;
  const [big, setBig] = useState(false);
  return (
    <div className="space-y-5">
      {data.intro && <p dir="auto" className="rounded-3xl bg-gradient-to-br from-slate-900 to-slate-700 p-5 font-serif text-lg leading-relaxed text-white shadow-lg">{data.intro}</p>}
      {mapSrc && (
        <button type="button" onClick={() => setBig(true)} className="block w-full overflow-hidden rounded-3xl border bg-white shadow-sm" aria-label={copy("Enlarge the concept map", "كبّر خريطة المفاهيم")}>
          <img src={mapSrc} alt={copy("Concept map", "خريطة المفاهيم")} className="w-full" />
        </button>
      )}
      {data.sections.map((section, index) => (
        <section key={index} className="rounded-3xl border bg-card p-5 shadow-sm">
          <h2 dir="auto" className="flex items-center gap-3 font-serif text-xl"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-600 font-sans text-sm font-bold text-white">{index + 1}</span>{section.heading}</h2>
          <ul className="mt-3 space-y-2 ps-11">
            {section.points.map((point, i) => <li key={i} dir="auto" className="relative text-[15px] leading-7 before:absolute before:-start-4 before:top-3 before:h-1.5 before:w-1.5 before:rounded-full before:bg-emerald-500">{point}</li>)}
          </ul>
        </section>
      ))}
      {data.terms.length > 0 && (
        <section>
          <h2 className="mb-3 font-serif text-xl">{copy("Key terms", "المصطلحات الأساسية")}</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.terms.map((term, i) => (
              <div key={i} className="rounded-2xl border bg-card p-3.5">
                <p dir="auto" className="font-semibold text-emerald-800 dark:text-emerald-300">{term.term}</p>
                <p dir="auto" className="mt-0.5 text-sm leading-6 text-muted-foreground">{term.meaning}</p>
              </div>
            ))}
          </div>
        </section>
      )}
      {big && mapSrc && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/80 p-4" onClick={() => setBig(false)} role="dialog" aria-label={copy("Concept map", "خريطة المفاهيم")}>
          <img src={mapSrc} alt="" className="max-h-full max-w-full rounded-xl bg-white" />
        </div>
      )}
    </div>
  );
}

/** Practise the quiz: one question at a time, instant feedback, a score at the end. */
function QuizPractice({ questions, copy, ar }: { questions: QuizQuestion[]; copy: Copy; ar: boolean }) {
  const [started, setStarted] = useState(false);
  const [order, setOrder] = useState<number[]>(() => questions.map((_, i) => i));
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [shown, setShown] = useState(false);
  const [written, setWritten] = useState("");
  const [results, setResults] = useState<boolean[]>([]);
  const letters = ar ? ["أ", "ب", "ج", "د", "هـ", "و"] : ["A", "B", "C", "D", "E", "F"];
  const restart = (shuffle: boolean) => {
    const next = questions.map((_, i) => i);
    if (shuffle) for (let i = next.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [next[i], next[j]] = [next[j]!, next[i]!]; }
    setOrder(next); setIndex(0); setPicked(null); setShown(false); setWritten(""); setResults([]); setStarted(true);
  };
  if (!started) return (
    <div className="rounded-3xl border bg-card p-8 text-center shadow-sm">
      <ListChecks size={40} className="mx-auto text-primary" />
      <p className="mt-3 font-serif text-2xl">{copy(`${questions.length} questions`, `${questions.length} سؤالًا`)}</p>
      <p className="mt-1 text-sm text-muted-foreground">{copy("Answer one at a time and see right away why.", "أجب سؤالًا تلو الآخر واعرف السبب فورًا.")}</p>
      <Button size="lg" className="mt-5 rounded-full" onClick={() => restart(false)}>{copy("Start the quiz", "ابدأ الاختبار")}</Button>
    </div>
  );
  if (index >= order.length) {
    const score = results.filter(Boolean).length;
    const percent = Math.round((score / Math.max(1, results.length)) * 100);
    const missed = order.filter((_, i) => !results[i]);
    return (
      <div className="space-y-4">
        <div className="rounded-3xl border bg-gradient-to-br from-amber-50 to-card p-8 text-center shadow-sm dark:from-amber-950/20">
          <Trophy size={44} className="mx-auto text-amber-500" />
          <p className="mt-2 font-serif text-4xl">{score} / {results.length}</p>
          <p className="mt-1 text-muted-foreground">{percent >= 90 ? copy("Excellent!", "ممتاز!") : percent >= 70 ? copy("Well done!", "أحسنت!") : percent >= 50 ? copy("Good start: review the ones you missed.", "بداية جيدة: راجع ما فاتك.") : copy("Keep going: the notes and flashcards will help.", "واصل: الملخص والبطاقات سيساعدانك.")}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button className="rounded-full" onClick={() => restart(true)}><RotateCcw size={15} className="me-1.5" />{copy("Again, shuffled", "مرة أخرى بترتيب جديد")}</Button>
          </div>
        </div>
        {missed.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">{copy("To review", "للمراجعة")}</p>
            {missed.map((q) => (
              <div key={q} className="rounded-2xl border bg-card p-4">
                <p dir="auto" className="font-medium">{questions[q]!.question}</p>
                <p dir="auto" className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">✔ {questions[q]!.answerText}</p>
                {questions[q]!.explanation && <p dir="auto" className="mt-1 text-sm text-muted-foreground">{questions[q]!.explanation}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
  const q = questions[order[index]!]!;
  const answered = q.type === "short" ? shown : picked !== null;
  const record = (right: boolean) => setResults((current) => { const next = [...current]; next[index] = right; return next; });
  const next = () => { setIndex((i) => i + 1); setPicked(null); setShown(false); setWritten(""); };
  return (
    <div className="rounded-3xl border bg-card p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <span className="text-sm font-semibold text-muted-foreground">{index + 1} / {order.length}</span>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(index / order.length) * 100}%` }} /></div>
        <span className="text-sm font-semibold text-emerald-700">{results.filter(Boolean).length} ✔</span>
      </div>
      <p dir="auto" className="font-serif text-xl leading-snug">{q.question}</p>
      {q.type === "short" ? (
        <div className="mt-4 space-y-3">
          <textarea dir="auto" value={written} onChange={(event) => setWritten(event.target.value)} rows={3} disabled={shown} placeholder={copy("Write your answer…", "اكتب إجابتك…")}
            className="w-full rounded-2xl border bg-background px-4 py-3 text-base outline-none focus:border-primary" />
          {!shown ? <Button className="rounded-full" onClick={() => setShown(true)}>{copy("Show the answer", "أظهر الإجابة")}</Button> : (
            <div className="space-y-3">
              <p dir="auto" className="rounded-2xl bg-emerald-50 p-3 text-[15px] dark:bg-emerald-950/30"><b>{copy("Model answer: ", "الإجابة النموذجية: ")}</b>{q.answerText}</p>
              {results[index] === undefined && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" className="rounded-full border-emerald-300" onClick={() => record(true)}><Check size={15} className="me-1.5" />{copy("I got it", "أصبت")}</Button>
                  <Button variant="outline" className="rounded-full border-rose-300" onClick={() => record(false)}><X size={15} className="me-1.5" />{copy("I missed it", "لم أصب")}</Button>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 grid gap-2">
          {q.options.map((option, i) => {
            const right = i === q.answer;
            const state = picked === null ? "" : right ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30" : picked === i ? "border-rose-400 bg-rose-50 dark:bg-rose-950/30" : "opacity-60";
            return (
              <button key={i} type="button" disabled={picked !== null} onClick={() => { setPicked(i); record(i === q.answer); }}
                className={`flex items-center gap-3 rounded-2xl border-2 px-4 py-3 text-start text-[15px] transition ${picked === null ? "hover:border-primary/50 hover:bg-secondary/50" : ""} ${state}`}>
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ${picked !== null && right ? "bg-emerald-600 text-white" : picked === i ? "bg-rose-500 text-white" : "bg-secondary"}`}>{picked !== null && right ? <Check size={16} /> : picked === i ? <X size={16} /> : letters[i]}</span>
                <span dir="auto">{option}</span>
              </button>
            );
          })}
        </div>
      )}
      {answered && (q.explanation || q.quote) && (
        <div className="mt-4 space-y-2">
          {q.explanation && <p dir="auto" className="text-[15px] leading-7">{q.explanation}</p>}
          {q.quote && <p dir="auto" className="flex gap-2 rounded-xl bg-muted/60 px-3 py-2 font-serif text-sm italic"><Quote size={14} className="mt-1 shrink-0 text-primary" />“{q.quote}”</p>}
        </div>
      )}
      {answered && results[index] !== undefined && (
        <div className="mt-5 flex justify-end"><Button className="rounded-full" onClick={next}>{index + 1 === order.length ? copy("See my score", "اعرض نتيجتي") : copy("Next", "التالي")}</Button></div>
      )}
    </div>
  );
}

/** Flashcards with a schedule: the ones you know come back later, the hard ones soon. */
function Flashcards({ pack, onReviews, copy }: { pack: StudyPack; onReviews: (reviews: StudyPack["reviews"]) => void; copy: Copy }) {
  const cards = pack.data!.cards;
  const [all, setAll] = useState(false);
  const queue = useMemo(() => (all ? cards.map((_, i) => i) : dueCards(cards.length, pack.reviews)), [all, cards, pack.reviews]);
  const [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const current = queue[0];
  const known = Object.values(pack.reviews).filter((review) => review.box >= 4).length;
  async function grade(value: "again" | "good" | "easy") {
    if (current === undefined) return;
    setBusy(true);
    try {
      const result = await reviewCard(pack.id, current, value);
      setFlipped(false);
      if (all) setAll(queue.length > 1);
      onReviews(result.reviews);
    } finally { setBusy(false); }
  }
  if (current === undefined) {
    const next = Object.values(pack.reviews).map((review) => Date.parse(review.due)).filter((due) => due > Date.now()).sort((a, b) => a - b)[0];
    return (
      <div className="rounded-3xl border bg-card p-8 text-center shadow-sm">
        <p className="text-5xl">🎉</p>
        <p className="mt-3 font-serif text-2xl">{copy("All done for now", "انتهيت الآن")}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {copy(`${known} of ${cards.length} cards well known.`, `${known} من ${cards.length} بطاقة محفوظة جيدًا.`)}
          {next && ` ${copy("Next review:", "المراجعة القادمة:")} ${new Date(next).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}`}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button className="rounded-full" onClick={() => setAll(true)}>{copy("Go through all cards", "راجع كل البطاقات")}</Button>
          <Button variant="ghost" className="rounded-full" onClick={() => void resetReviews(pack.id).then((r) => onReviews(r.reviews))}>{copy("Start over", "ابدأ من جديد")}</Button>
        </div>
      </div>
    );
  }
  const card = cards[current]!;
  return (
    <div className="space-y-4">
      <p className="text-center text-sm text-muted-foreground">{copy(`${queue.length} to review · ${known} of ${cards.length} known`, `${queue.length} للمراجعة · ${known} من ${cards.length} محفوظة`)}</p>
      <button type="button" onClick={() => setFlipped((value) => !value)} className="block w-full [perspective:1200px]" aria-label={copy("Turn the card", "اقلب البطاقة")}>
        <div className={`relative min-h-[16rem] w-full transition-transform duration-500 [transform-style:preserve-3d] ${flipped ? "[transform:rotateY(180deg)]" : ""}`}>
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-3xl border-2 bg-gradient-to-br from-sky-50 to-card p-6 shadow-md [backface-visibility:hidden] dark:from-sky-950/30">
            <span className="mb-3 text-xs font-bold uppercase tracking-widest text-sky-700 dark:text-sky-300">{copy("Question", "سؤال")}</span>
            <p dir="auto" className="text-center font-serif text-2xl leading-snug">{card.front}</p>
            <span className="mt-4 text-xs text-muted-foreground">{copy("Tap to see the answer", "اضغط لرؤية الإجابة")}</span>
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-3xl border-2 border-emerald-300 bg-gradient-to-br from-emerald-50 to-card p-6 shadow-md [backface-visibility:hidden] [transform:rotateY(180deg)] dark:from-emerald-950/30">
            <span className="mb-3 text-xs font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">{copy("Answer", "الإجابة")}</span>
            <p dir="auto" className="text-center text-xl leading-relaxed">{card.back}</p>
          </div>
        </div>
      </button>
      {flipped ? (
        <div className="grid grid-cols-3 gap-2">
          <Button variant="outline" disabled={busy} className="h-14 flex-col rounded-2xl border-rose-300" onClick={() => void grade("again")}><span className="font-semibold">{copy("Again", "مجددًا")}</span><span className="text-[11px] text-muted-foreground">{copy("didn't know", "لم أعرفها")}</span></Button>
          <Button variant="outline" disabled={busy} className="h-14 flex-col rounded-2xl border-sky-300" onClick={() => void grade("good")}><span className="font-semibold">{copy("Good", "جيد")}</span><span className="text-[11px] text-muted-foreground">{copy("knew it", "عرفتها")}</span></Button>
          <Button variant="outline" disabled={busy} className="h-14 flex-col rounded-2xl border-emerald-300" onClick={() => void grade("easy")}><span className="font-semibold">{copy("Easy", "سهلة")}</span><span className="text-[11px] text-muted-foreground">{copy("very easy", "سهلة جدًا")}</span></Button>
        </div>
      ) : (
        <Button className="h-12 w-full rounded-2xl" onClick={() => setFlipped(true)}>{copy("Show the answer", "أظهر الإجابة")}</Button>
      )}
    </div>
  );
}
