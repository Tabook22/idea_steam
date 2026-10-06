import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowUp,
  BookOpen,
  FileText,
  Loader2,
  Mic,
  Pause,
  PenLine,
  Play,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { askLibrary, useListSubjects, type AskAnswer, type AskSource } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { answerBlocks, clock } from "@/lib/ask-text";
import { appPath } from "@/lib/app-path";
import { isInbox } from "@/lib/inbox";
import { useLanguage } from "@/lib/i18n";

const OPEN_ASK_EVENT = "idea-stream:ask";
/** Opens "Ask your library", optionally with a question to ask right away. */
export const openAsk = (question?: string) => window.dispatchEvent(new CustomEvent(OPEN_ASK_EVENT, { detail: question }));

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

type Turn = { question: string; result: AskAnswer | null; error: string | null };

const EXAMPLES = {
  en: ["What tasks did I mention that I haven't done yet?", "Which of my ideas could become a video?", "What did I say about money or budget?", "Summarize my ideas about teaching"],
  ar: ["ما المهام التي ذكرتها ولم أنجزها بعد؟", "أي أفكاري تصلح لفيديو؟", "ماذا قلت عن المال أو الميزانية؟", "لخّص أفكاري عن التعليم"],
};

export function AskLibrary() {
  const { isArabic, language } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const { data: subjects = [] } = useListSubjects({ query: { enabled: open } as never });
  const thread = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<{ key: string; end: number | null } | null>(null);
  const date = useMemo(() => new Intl.DateTimeFormat(language, { dateStyle: "medium" }), [language]);

  async function ask(question: string) {
    const text = question.trim();
    if (text.length < 2 || busy) return;
    setDraft("");
    setBusy(true);
    const history = turns.filter((turn) => turn.result?.answer).slice(-3).map((turn) => ({ question: turn.question, answer: turn.result!.answer! }));
    setTurns((current) => [...current, { question: text, result: null, error: null }]);
    try {
      const result = await askLibrary({ question: text, subjectId, history });
      setTurns((current) => current.map((turn, index) => (index === current.length - 1 ? { ...turn, result } : turn)));
    } catch (error) {
      const message = (error as { data?: { error?: string } })?.data?.error ?? copy("Couldn't ask right now. Please try again.", "تعذر السؤال الآن. حاول مجددًا.");
      setTurns((current) => current.map((turn, index) => (index === current.length - 1 ? { ...turn, error: message } : turn)));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const show = (event: Event) => {
      setOpen(true);
      const question = (event as CustomEvent<string | undefined>).detail;
      if (question) setTimeout(() => void ask(question), 0);
    };
    window.addEventListener(OPEN_ASK_EVENT, show);
    return () => window.removeEventListener(OPEN_ASK_EVENT, show);
  });

  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  useEffect(() => {
    if (!open) { audio.current?.pause(); setPlaying(null); }
  }, [open]);

  const stopAudio = () => { audio.current?.pause(); setPlaying(null); };
  function play(source: AskSource, key: string) {
    if (!source.url) return;
    if (playing?.key === key) { stopAudio(); return; }
    const element = audio.current ?? (audio.current = new Audio());
    const src = appPath(source.url, import.meta.env.BASE_URL);
    if (!element.src.endsWith(src)) element.src = src;
    const start = Math.max(0, (source.start ?? 0) - 0.5);
    const begin = () => { element.currentTime = start; void element.play().catch(() => setPlaying(null)); };
    if (element.readyState >= 1) begin(); else element.addEventListener("loadedmetadata", begin, { once: true });
    element.onended = () => setPlaying(null);
    // Plays the moment (about 40 seconds), not the whole recording.
    element.ontimeupdate = () => { if (source.start !== null && element.currentTime > start + 40) stopAudio(); };
    setPlaying({ key, end: null });
  }

  const openSource = (source: AskSource) => {
    setOpen(false);
    if (source.kind === "idea" && source.subjectId) navigate(`/subjects/${source.subjectId}#idea-${source.id}`);
    else if (source.kind === "draft" && source.subjectId) navigate(`/subjects/${source.subjectId}#draft-studio`);
    else navigate(`/library#item-${source.id}`);
    setTimeout(() => window.dispatchEvent(new HashChangeEvent("hashchange")), 50);
  };

  const icon = (kind: AskSource["kind"]) =>
    kind === "recording" ? <Mic size={15} /> : kind === "draft" ? <PenLine size={15} /> : <FileText size={15} />;
  const kindLabel = (kind: AskSource["kind"]) =>
    kind === "recording" ? copy("Recording", "تسجيل") : kind === "draft" ? copy("Draft", "مسودة") : copy("Idea", "فكرة");

  const showSource = (turnIndex: number, n: number) => {
    const key = `${turnIndex}-${n}`;
    setFocus(key);
    thread.current?.querySelector(`[data-source="${key}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    setTimeout(() => setFocus((current) => (current === key ? null : current)), 1600);
  };

  const notebooks = subjects.filter((subject) => !isInbox(subject));
  const examples = isArabic ? EXAMPLES.ar : EXAMPLES.en;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={copy("Ask your library", "اسأل مكتبتك")}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-sm font-medium text-primary shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5"
      >
        <Sparkles size={16} />
        <span className="hidden sm:inline">{copy("Ask", "اسأل")}</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="flex h-[100dvh] max-w-2xl flex-col gap-0 overflow-hidden rounded-none p-0 sm:top-[8vh] sm:h-[84vh] sm:translate-y-0 sm:rounded-2xl data-[state=open]:sm:slide-in-from-top-[2%] [&>button:last-child]:hidden"
          onOpenAutoFocus={(event) => { event.preventDefault(); input.current?.focus(); }}
        >
          <DialogTitle className="sr-only">{copy("Ask your library", "اسأل مكتبتك")}</DialogTitle>
          <DialogDescription className="sr-only">
            {copy("Ask a question; the answer comes from your recordings, ideas and drafts, with links to where you said it.", "اطرح سؤالًا؛ تأتي الإجابة من تسجيلاتك وأفكارك ومسوداتك، مع روابط إلى حيث قلتها.")}
          </DialogDescription>

          <div className="flex items-center gap-2 border-b px-4 py-3" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><Sparkles size={16} /></span>
            <div className="min-w-0 flex-1">
              <p className="font-serif text-base leading-tight">{copy("Ask your library", "اسأل مكتبتك")}</p>
              <p className="text-xs text-muted-foreground">{copy("Answers from your own recordings, ideas and drafts", "إجابات من تسجيلاتك وأفكارك ومسوداتك")}</p>
            </div>
            {turns.length > 0 && (
              <button type="button" onClick={() => { stopAudio(); setTurns([]); input.current?.focus(); }} disabled={busy}
                className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50">
                <RotateCcw size={13} />{copy("New", "جديد")}
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)} aria-label={copy("Close", "إغلاق")} className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary">
              <X size={17} />
            </button>
          </div>

          <div ref={thread} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4" aria-live="polite">
            {turns.length === 0 ? (
              <div className="flex flex-col items-center py-6 text-center">
                <span className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-primary/20 to-accent/20 text-primary"><Sparkles size={24} /></span>
                <p className="mt-3 font-serif text-xl">{copy("What would you like to know?", "ماذا تريد أن تعرف؟")}</p>
                <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
                  {copy("Ask in Arabic or English. Every answer shows where it came from, and recordings play from the moment you said it.",
                    "اسأل بالعربية أو الإنجليزية. كل إجابة تبيّن مصدرها، والتسجيلات تُشغَّل من اللحظة التي قلتها فيها.")}
                </p>
                <div className="mt-5 flex w-full max-w-md flex-col gap-2">
                  {examples.map((example) => (
                    <button key={example} type="button" dir="auto" onClick={() => void ask(example)}
                      className="rounded-2xl border bg-card px-4 py-2.5 text-start text-sm transition-colors hover:border-primary/40 hover:bg-primary/5">
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                {turns.map((turn, turnIndex) => (
                  <div key={turnIndex} className="flex flex-col gap-3">
                    <p dir="auto" className="ms-auto max-w-[85%] rounded-2xl rounded-ee-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">{turn.question}</p>
                    {!turn.result && !turn.error && (
                      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                        <Loader2 size={15} className="animate-spin text-primary" />
                        {copy("Searching your recordings and ideas…", "جارٍ البحث في تسجيلاتك وأفكارك…")}
                      </p>
                    )}
                    {turn.error && <p className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm text-destructive" role="alert">{turn.error}</p>}
                    {turn.result && (
                      <div className="flex flex-col gap-3">
                        {turn.result.answer && (
                          <div dir="auto" className="rounded-2xl rounded-ss-md border bg-card px-4 py-3 text-[15px] leading-7" data-answer>
                            {answerBlocks(turn.result.answer).map((block, index) => {
                              const shown = new Set(turn.result!.sources.map((source) => source.n));
                              // A citation without a source to show is left out.
                              const body = block.parts.filter((part) => !("cite" in part) || shown.has(part.cite)).map((part, i) => ("cite" in part ? (
                                <button key={i} type="button" onClick={() => showSource(turnIndex, part.cite)}
                                  aria-label={copy(`Source ${part.cite}`, `المصدر ${part.cite}`)}
                                  className="mx-0.5 inline-grid h-5 min-w-5 -translate-y-0.5 place-items-center rounded-full bg-primary/12 px-1 align-middle text-[11px] font-bold text-primary hover:bg-primary hover:text-primary-foreground">
                                  {part.cite}
                                </button>
                              ) : <span key={i}>{part.text}</span>));
                              return block.kind === "li"
                                ? <p key={index} className="relative ps-4 before:absolute before:start-0 before:top-[0.7em] before:h-1.5 before:w-1.5 before:rounded-full before:bg-primary/60">{body}</p>
                                : <p key={index} className="[&:not(:first-child)]:mt-2">{body}</p>;
                            })}
                          </div>
                        )}
                        {turn.result.notice && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">{turn.result.notice}</p>}
                        {turn.result.sources.length > 0 && (
                          <div className="flex flex-col gap-2">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                              {turn.result.aiAnswer ? copy("Sources", "المصادر") : copy("Best matches", "أقرب النتائج")}
                            </p>
                            {turn.result.sources.map((source) => {
                              const key = `${turnIndex}-${source.n}`;
                              const isPlaying = playing?.key === key;
                              return (
                                <div key={key} data-source={key}
                                  className={`rounded-2xl border bg-card p-3 transition-shadow ${focus === key ? "ring-2 ring-primary" : ""}`}>
                                  <div className="flex items-start gap-2.5">
                                    <span className="relative mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                                      {icon(source.kind)}
                                      <span className="absolute -end-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">{source.n}</span>
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <p dir="auto" className="line-clamp-1 text-sm font-medium">{source.title}</p>
                                      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                                        <span>{kindLabel(source.kind)}</span>
                                        {source.subjectTitle && <><span aria-hidden="true">·</span><span dir="auto" className="font-medium text-foreground/75">{source.subjectTitle}</span></>}
                                        <span aria-hidden="true">·</span><span>{date.format(new Date(source.date))}</span>
                                      </p>
                                    </div>
                                  </div>
                                  <p dir="auto" className="mt-2 line-clamp-4 text-sm leading-6 text-foreground/85">{source.excerpt}</p>
                                  <div className="mt-2.5 flex flex-wrap gap-2">
                                    {source.kind === "recording" && source.url && (
                                      <button type="button" onClick={() => play(source, key)}
                                        className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors ${isPlaying ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary hover:bg-primary/15"}`}>
                                        {isPlaying ? <Pause size={13} /> : <Play size={13} />}
                                        {isPlaying ? copy("Stop", "إيقاف")
                                          : source.start !== null ? copy(`Play from ${clock(source.start)}`, `شغّل من ${clock(source.start)}`) : copy("Play", "شغّل")}
                                      </button>
                                    )}
                                    <button type="button" onClick={() => openSource(source)}
                                      className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground">
                                      <BookOpen size={13} />
                                      {source.kind === "recording" ? copy("Open in library", "افتح في المكتبة") : copy("Open", "افتح")}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <p className="text-[11px] text-muted-foreground">
                          {copy(`Searched ${plural(turn.result.searched.recordings, "recording")}, ${plural(turn.result.searched.ideas, "idea")} and ${plural(turn.result.searched.drafts, "draft")}`,
                            `بُحث في ${turn.result.searched.recordings} تسجيلًا و${turn.result.searched.ideas} فكرة و${turn.result.searched.drafts} مسودة`)}
                          {" · "}
                          {turn.result.mode === "smart" ? copy("by meaning and words", "بالمعنى والكلمات") : copy("by words", "بالكلمات")}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <form
            className="border-t bg-card/60 px-3 py-3"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
            onSubmit={(event) => { event.preventDefault(); void ask(draft); }}
          >
            <div className="mb-2 flex items-center gap-2">
              <label className="text-xs text-muted-foreground" htmlFor="ask-scope">{copy("Search in", "ابحث في")}</label>
              <select id="ask-scope" value={subjectId ?? ""} onChange={(event) => setSubjectId(event.target.value ? Number(event.target.value) : null)}
                className="h-8 max-w-[60%] rounded-full border bg-background px-3 text-xs">
                <option value="">{copy("Everything", "كل شيء")}</option>
                {notebooks.map((subject) => <option key={subject.id} value={subject.id}>{subject.title}</option>)}
              </select>
            </div>
            <div className="flex items-end gap-2 rounded-2xl border bg-background p-1.5 ps-3 focus-within:border-primary/50">
              <textarea
                ref={input}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(draft); } }}
                rows={1}
                dir="auto"
                maxLength={500}
                data-bare-field
                placeholder={turns.length ? copy("Ask a follow-up…", "اسأل سؤالًا آخر…") : copy("Ask your recordings and ideas…", "اسأل تسجيلاتك وأفكارك…")}
                aria-label={copy("Your question", "سؤالك")}
                className="max-h-32 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[15px] outline-none placeholder:text-muted-foreground"
              />
              <button type="submit" disabled={busy || draft.trim().length < 2} aria-label={copy("Ask", "اسأل")}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40">
                {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={17} />}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
