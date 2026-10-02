import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Captions,
  Check,
  CheckCircle2,
  Globe,
  Inbox,
  Loader2,
  Play,
  Quote,
  Share2,
  TriangleAlert,
} from "lucide-react";
import {
  createIdea,
  createSubject,
  extractYoutubeTranscript,
  getListSubjectsQueryKey,
  IdeaAttachmentType,
  IdeaInputSource,
  updateIdea,
  useListSubjects,
  type Idea,
} from "@workspace/api-client-react";
import { useLanguage } from "@/lib/i18n";
import { useRecorderPrefs } from "@/lib/recorder-prefs";
import { parseShared } from "@/lib/share-parse";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const INBOX_TITLES = ["Idea inbox", "صندوق الأفكار"];
function youtubeId(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.hostname === "youtu.be") return url.pathname.slice(1).split("/")[0] || null;
    if (url.hostname.endsWith("youtube.com")) {
      if (url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/live/")) return url.pathname.split("/")[2] || null;
      return url.searchParams.get("v");
    }
  } catch { /* fall through */ }
  return null;
}

type Phase = "edit" | "saving" | "captions" | "done";

export default function SharePage() {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { data: subjects = [], isLoading } = useListSubjects();
  const [prefs] = useRecorderPrefs();
  const shared = useMemo(() => parseShared(new URLSearchParams(window.location.search)), []);
  const video = youtubeId(shared.url);
  const host = shared.url ? new URL(shared.url).hostname.replace(/^www\./, "") : null;

  const choices = [...subjects]
    .filter((subject) => !INBOX_TITLES.includes(subject.title))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const [subjectId, setSubjectId] = useState<number | null | undefined>(undefined);
  const selected = subjectId !== undefined
    ? subjectId
    : prefs.subjectId !== null && choices.some((subject) => subject.id === prefs.subjectId) ? prefs.subjectId : null;
  const selectedTitle = selected === null ? copy("Idea inbox", "صندوق الأفكار") : choices.find((subject) => subject.id === selected)?.title ?? "";

  const [thought, setThought] = useState("");
  const [captions, setCaptions] = useState(true);
  const [phase, setPhase] = useState<Phase>("edit");
  const [error, setError] = useState("");
  const [captionResult, setCaptionResult] = useState<"added" | "unavailable" | null>(null);
  const [saved, setSaved] = useState<Idea | null>(null);
  const saving = useRef(false);

  // Remove the shared values from the address so a refresh can never save twice.
  useEffect(() => {
    if (window.location.search) history.replaceState(history.state, "", window.location.pathname);
  }, []);

  const nothing = !shared.url && !shared.title && !shared.text;

  async function save() {
    if (saving.current) return;
    saving.current = true;
    setError("");
    setPhase("saving");
    try {
      let target = selected;
      if (target === null) {
        const inbox = subjects.find((subject) => INBOX_TITLES.includes(subject.title)) ?? await createSubject({
          title: copy("Idea inbox", "صندوق الأفكار"),
          intro: copy("Capture now. Organize later.", "سجّل الآن ونظّم لاحقًا."),
        });
        target = inbox.id;
      }
      const note = [shared.title, shared.text].filter(Boolean).join("\n\n");
      const content = thought.trim() || note || shared.url || "";
      const link = shared.url
        ? {
            type: IdeaAttachmentType.link,
            url: shared.url,
            name: shared.title || host || shared.url,
            // Keep shared text as the link's note only when the thought took the idea's main text.
            note: thought.trim() && shared.text ? shared.text : undefined,
          }
        : null;
      const idea = await createIdea(target, {
        content,
        source: link ? IdeaInputSource.link : IdeaInputSource.text,
        attachments: link ? [link] : [],
      });
      setSaved(idea);
      void queryClient.invalidateQueries();
      if (video && captions && link) {
        setPhase("captions");
        try {
          const transcript = await extractYoutubeTranscript({ url: link.url });
          if (!transcript.text?.trim()) throw new Error("empty");
          await updateIdea(idea.id, { attachments: [{ ...link, transcript: transcript.text }] });
          setCaptionResult("added");
          void queryClient.invalidateQueries();
        } catch {
          setCaptionResult("unavailable");
        }
      }
      setPhase("done");
    } catch {
      setError(copy("Couldn't save it. Check your connection and try again.", "تعذر الحفظ. تحقق من الاتصال وحاول مجددًا."));
      setPhase("edit");
      saving.current = false;
    }
  }

  if (nothing) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary"><Share2 size={24} /></span>
        <h1 className="mt-5 text-3xl font-medium">{copy("Share to Idea Stream", "شارك إلى Idea Stream")}</h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          {copy(
            "In YouTube, your browser, or WhatsApp, tap Share and choose Idea Stream. The link, its title, and your note land in the subject you pick. Install Idea Stream on your phone's home screen first (Android).",
            "في يوتيوب أو المتصفح أو واتساب اضغط مشاركة واختر Idea Stream. يُحفظ الرابط وعنوانه وملاحظتك في الموضوع الذي تختاره. ثبّت التطبيق على الشاشة الرئيسية أولًا (أندرويد).",
          )}
        </p>
        <Button asChild className="mt-6 rounded-full"><Link href="/app">{copy("Back to my notebooks", "العودة إلى دفاتري")}</Link></Button>
      </main>
    );
  }

  if (phase === "done" && saved) {
    return (
      <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-4 py-12 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25">
          <Check size={30} strokeWidth={2.5} />
        </span>
        <h1 className="mt-6 text-3xl font-medium">{copy("Saved", "تم الحفظ")}</h1>
        <p className="mt-2 text-muted-foreground">
          {copy("Filed in", "حُفظ في")} <strong className="font-semibold text-foreground">{selectedTitle}</strong>
        </p>
        {captionResult === "added" && (
          <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-sm text-primary">
            <Captions size={16} />{copy("Video captions added as a transcript", "أُضيفت ترجمة الفيديو كنص")}
          </p>
        )}
        {captionResult === "unavailable" && (
          <p className="mt-4 max-w-sm text-sm text-muted-foreground">
            {copy("This video has no captions we could fetch. You can add a transcript later from the idea.", "لم نتمكن من جلب ترجمة لهذا الفيديو. يمكنك إضافة نص لاحقًا من الفكرة.")}
          </p>
        )}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild className="h-12 rounded-full px-6">
            <Link href={`/subjects/${saved.subjectId}#idea-${saved.id}`}>{copy("Open it", "افتحها")}<ArrowUpRight size={16} className="ms-2" /></Link>
          </Button>
          <Button variant="outline" className="h-12 rounded-full px-6" onClick={() => navigate("/app")}>
            {copy("Done", "تم")}
          </Button>
        </div>
      </main>
    );
  }

  const busy = phase !== "edit";
  return (
    <main className="mx-auto max-w-xl px-4 pb-32 pt-2 sm:pb-12">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary/80">{copy("Shared to Idea Stream", "مشاركة إلى Idea Stream")}</p>
      <h1 className="mt-2 text-3xl font-medium">{copy("Save this idea", "احفظ هذه الفكرة")}</h1>

      <article className="mt-5 overflow-hidden rounded-3xl border bg-card shadow-sm">
        {video ? (
          <div className="relative aspect-video bg-muted">
            <img src={`https://i.ytimg.com/vi/${video}/hqdefault.jpg`} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
            <span className="absolute inset-0 grid place-items-center"><span className="rounded-full bg-red-600 p-3 text-white shadow-lg"><Play size={22} fill="currentColor" /></span></span>
          </div>
        ) : null}
        <div className="flex gap-3 p-4">
          {!video && (
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              {shared.url ? <Globe size={19} /> : <Quote size={19} />}
            </span>
          )}
          <div className="min-w-0 flex-1">
            {shared.title && <p dir="auto" className="line-clamp-2 font-medium leading-6">{shared.title}</p>}
            {shared.text && <p dir="auto" className="mt-1 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{shared.text}</p>}
            {host && <p className="mt-1 truncate text-xs text-muted-foreground">{video ? "YouTube" : host}</p>}
          </div>
        </div>
      </article>

      <label className="mt-6 block text-sm font-semibold" htmlFor="share-thought">
        {copy("Your thought", "فكرتك")} <span className="font-normal text-muted-foreground">{copy("(optional)", "(اختياري)")}</span>
      </label>
      <Textarea
        id="share-thought"
        dir="auto"
        value={thought}
        disabled={busy}
        onChange={(event) => setThought(event.target.value)}
        placeholder={copy("Why does this matter? What could it become?", "لماذا يهمك هذا؟ ماذا يمكن أن يصبح؟")}
        className="mt-2 min-h-24 rounded-2xl text-base leading-7"
      />

      <p className="mb-3 mt-6 text-sm font-semibold">{copy("Save to", "احفظ في")}</p>
      {isLoading ? (
        <div className="flex gap-2" aria-hidden="true">{[0, 1, 2].map((key) => <div key={key} className="h-11 w-32 animate-pulse rounded-full bg-muted" />)}</div>
      ) : (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={copy("Subject", "الموضوع")}>
          {[{ id: null as number | null, title: copy("Inbox · decide later", "الصندوق · اختر لاحقًا") }, ...choices].map((subject) => {
            const current = subject.id === selected;
            return (
              <button
                key={subject.id ?? "inbox"}
                type="button"
                role="radio"
                aria-checked={current}
                disabled={busy}
                onClick={() => setSubjectId(subject.id)}
                className={`inline-flex h-11 max-w-full items-center gap-2 rounded-full border px-4 text-sm font-medium transition active:scale-[0.97] disabled:opacity-60 ${
                  current ? "border-primary bg-primary text-primary-foreground shadow-md shadow-primary/20" : "bg-background hover:border-primary/50 hover:bg-primary/5"
                }`}
              >
                {current ? <Check size={15} /> : subject.id === null ? <Inbox size={15} /> : null}
                <span className="truncate">{subject.title}</span>
              </button>
            );
          })}
        </div>
      )}

      {video && (
        <label className="mt-6 flex cursor-pointer items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={captions} disabled={busy} onChange={(event) => setCaptions(event.target.checked)} />
          <Captions size={17} className="text-primary" />
          <span>
            <span className="block font-medium">{copy("Add the video's captions", "أضف ترجمة الفيديو")}</span>
            <span className="block text-xs text-muted-foreground">{copy("Saved as a transcript you can search and use in drafts.", "تُحفظ كنص يمكنك البحث فيه واستخدامه في المسودات.")}</span>
          </span>
        </label>
      )}

      {error && (
        <p className="mt-5 flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" role="alert">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" />{error}
        </p>
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 p-4 backdrop-blur sm:static sm:mt-8 sm:border-0 sm:bg-transparent sm:p-0" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
        <div className="mx-auto flex max-w-xl gap-3">
          <Button variant="outline" className="h-12 rounded-full px-5" disabled={busy} onClick={() => navigate("/app")}>
            {copy("Cancel", "إلغاء")}
          </Button>
          <Button className="h-12 min-w-0 flex-1 rounded-full text-base" disabled={busy || isLoading} onClick={() => void save()}>
            {phase === "saving" ? <><Loader2 size={18} className="me-2 animate-spin" />{copy("Saving…", "جارٍ الحفظ…")}</>
              : phase === "captions" ? <><Loader2 size={18} className="me-2 animate-spin" />{copy("Fetching captions…", "جارٍ جلب الترجمة…")}</>
              : <><CheckCircle2 size={18} className="me-2" /><span className="truncate">{copy(`Save to ${selectedTitle}`, `احفظ في ${selectedTitle}`)}</span></>}
          </Button>
        </div>
      </div>
    </main>
  );
}
