import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, BookPlus, Check, HelpCircle, Lightbulb, Loader2, NotebookPen, RefreshCw, Sparkles, Waypoints, X } from "lucide-react";
import {
  addAudioLibraryItemToSubject,
  createSubject,
  getGetConnectionsQueryKey,
  getGetDigestQueryKey,
  getListAudioLibraryQueryKey,
  getListSubjectsQueryKey,
  makeDigest,
  updateSubject,
  useGetConnections,
  useGetDigest,
  type ConnectionFiling,
  type ConnectionGroup,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/i18n";

const HIDDEN_KEY = "idea-stream-hidden-suggestions";
const dirOf = (text: string) => (/[֐-ࣿ]/.test(text.slice(0, 30)) ? "rtl" : "ltr");

function readHidden(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]")); } catch { return new Set(); }
}

/** Suggestions that file recordings for you: new notebooks for groups, or an existing notebook. */
export function ConnectionsCard() {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data } = useGetConnections({ query: { queryKey: getGetConnectionsQueryKey(), staleTime: 5 * 60_000, retry: false } });
  const [hidden, setHidden] = useState(readHidden);
  const [busy, setBusy] = useState<string | null>(null);

  const hide = (key: string) => {
    const next = new Set(hidden).add(key);
    setHidden(next);
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next].slice(-200))); } catch { /* optional */ }
  };
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: getGetConnectionsQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getListSubjectsQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getListAudioLibraryQueryKey() }),
  ]);

  async function makeNotebook(group: ConnectionGroup) {
    setBusy(`group-${group.key}`);
    try {
      const subject = await createSubject({ title: group.title, intro: "" });
      if (group.icon) await updateSubject(subject.id, { icon: group.icon }).catch(() => {});
      for (const item of group.items) await addAudioLibraryItemToSubject(item.id, { subjectId: subject.id });
      hide(`group-${group.key}`);
      await refresh();
      toast({ title: copy(`Notebook “${group.title}” created`, `أُنشئ دفتر «${group.title}»`), description: copy(`${group.items.length} recordings added to it.`, `أُضيف إليه ${group.items.length} تسجيل.`) });
    } catch {
      toast({ variant: "destructive", title: copy("Couldn't create the notebook.", "تعذر إنشاء الدفتر.") });
    } finally { setBusy(null); }
  }

  async function file(filing: ConnectionFiling) {
    setBusy(`file-${filing.itemId}`);
    try {
      await addAudioLibraryItemToSubject(filing.itemId, { subjectId: filing.subjectId });
      hide(`file-${filing.itemId}-${filing.subjectId}`);
      await refresh();
      toast({ title: copy(`Added to “${filing.subjectTitle}”`, `أُضيف إلى «${filing.subjectTitle}»`) });
    } catch {
      toast({ variant: "destructive", title: copy("Couldn't add it.", "تعذرت الإضافة.") });
    } finally { setBusy(null); }
  }

  const groups = (data?.groups ?? []).filter((group) => !hidden.has(`group-${group.key}`));
  const filings = (data?.filings ?? []).filter((filing) => !hidden.has(`file-${filing.itemId}-${filing.subjectId}`));
  if (!groups.length && !filings.length) return null;

  return (
    <section aria-label={copy("Suggested filing", "اقتراحات للترتيب")} className="mb-5 rounded-[1.5rem] border bg-card p-5 shadow-sm">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <Waypoints size={14} />{copy("Your ideas, connected", "أفكارك مترابطة")}
      </p>
      <ul className="mt-3 space-y-2.5">
        {groups.map((group) => (
          <li key={group.key} className="rounded-2xl border bg-gradient-to-br from-primary/[0.06] to-transparent p-3.5">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-xl">{group.icon ?? <NotebookPen size={18} className="text-primary" />}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  {copy(`${group.items.length} recordings seem to be about`, `يبدو أن ${group.items.length} تسجيلات تدور حول`)}{" "}
                  <span dir="auto" className="font-semibold">{group.title}</span>
                </p>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {group.items.map((item) => item.title).join(" · ")}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" className="h-8 rounded-full" disabled={!!busy} onClick={() => void makeNotebook(group)}>
                {busy === `group-${group.key}` ? <Loader2 size={13} className="me-1.5 animate-spin" /> : <BookPlus size={13} className="me-1.5" />}
                {copy("Create notebook & file them", "أنشئ دفترًا ورتّبها فيه")}
              </Button>
              <Button size="sm" variant="ghost" className="h-8 rounded-full text-muted-foreground" onClick={() => hide(`group-${group.key}`)}>{copy("Not now", "ليس الآن")}</Button>
            </div>
          </li>
        ))}
        {filings.map((filing) => (
          <li key={`${filing.itemId}-${filing.subjectId}`} className="flex items-center gap-3 rounded-2xl border px-3.5 py-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-secondary text-lg">{filing.subjectIcon ?? "📓"}</span>
            <p className="min-w-0 flex-1 text-sm leading-5">
              <span dir={dirOf(filing.itemTitle)} className="font-medium">“{filing.itemTitle}”</span>{" "}
              <span className="text-muted-foreground">{copy("fits", "يناسب")}</span>{" "}
              <span dir="auto" className="font-medium">{filing.subjectTitle}</span>
            </p>
            <Button size="sm" variant="outline" className="h-8 shrink-0 rounded-full" disabled={!!busy} onClick={() => void file(filing)}>
              {busy === `file-${filing.itemId}` ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              <span className="ms-1">{copy("Add", "أضف")}</span>
            </Button>
            <button type="button" onClick={() => hide(`file-${filing.itemId}-${filing.subjectId}`)} aria-label={copy("Dismiss", "تجاهل")}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary"><X size={14} /></button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The weekly digest: themes across the week, open questions, notebooks ready for a draft. */
export function WeeklyDigest() {
  const { isArabic, language } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const offset = -new Date().getTimezoneOffset();
  const params = { offset };
  const { data } = useGetDigest(params, { query: { queryKey: getGetDigestQueryKey(params), staleTime: 60_000 } });
  const [making, setMaking] = useState(false);
  const [open, setOpen] = useState(false);
  if (!data || (!data.digest && data.items < 2)) return null;

  async function make() {
    setMaking(true);
    try {
      const result = await makeDigest({ offset, language: language === "ar" ? "ar" : "en" });
      queryClient.setQueryData(getGetDigestQueryKey(params), result);
      setOpen(true);
    } catch (error) {
      toast({ variant: "destructive", title: (error as { data?: { error?: string } })?.data?.error ?? copy("Couldn't write the digest.", "تعذرت كتابة الملخص.") });
    } finally { setMaking(false); }
  }

  const digest = data.digest;
  return (
    <section aria-label={copy("Weekly digest", "ملخص الأسبوع")}
      className="relative mb-8 overflow-hidden rounded-[1.5rem] border bg-gradient-to-br from-violet-50 via-card to-card p-5 shadow-sm dark:from-violet-950/30">
      <div aria-hidden="true" className="pointer-events-none absolute -end-10 -top-10 h-40 w-40 rounded-full bg-violet-400/15 blur-3xl" />
      <div className="relative flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-700 dark:text-violet-300">
          <Sparkles size={14} />{copy("Your week in ideas", "أسبوعك في أفكار")}
        </p>
        {digest && (
          <button type="button" onClick={() => void make()} disabled={making} title={copy("Write it again", "اكتبه من جديد")} aria-label={copy("Write it again", "اكتبه من جديد")}
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary disabled:opacity-50">
            <RefreshCw size={14} className={making ? "animate-spin" : ""} />
          </button>
        )}
      </div>
      {digest ? (
        <div className="relative">
          <p dir={dirOf(digest.headline)} className="mt-2 text-start font-serif text-xl leading-snug">{digest.headline}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {digest.themes.map((theme) => (
              <span key={theme.title} dir="auto" className="rounded-full bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-900 dark:text-violet-100">{theme.title}</span>
            ))}
          </div>
          {open ? (
            <div className="mt-4 space-y-4 text-sm">
              <div className="space-y-2.5">
                {digest.themes.map((theme) => (
                  <div key={theme.title}>
                    <p dir="auto" className="font-semibold">{theme.title}</p>
                    <p dir={dirOf(theme.summary)} className="text-start leading-6 text-muted-foreground">{theme.summary}</p>
                  </div>
                ))}
              </div>
              {digest.questions.length > 0 && (
                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><HelpCircle size={13} />{copy("Questions you raised", "أسئلة طرحتها")}</p>
                  <ul className="space-y-1">{digest.questions.map((question) => <li key={question} dir={dirOf(question)} className="text-start leading-6">• {question}</li>)}</ul>
                </div>
              )}
              {digest.ready.length > 0 && (
                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><NotebookPen size={13} />{copy("Ready to become a draft", "جاهزة لتصبح مسودة")}</p>
                  <ul className="space-y-2">
                    {digest.ready.map((entry) => (
                      <li key={entry.subjectId} className="flex items-center gap-3 rounded-xl border bg-card/70 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p dir="auto" className="font-medium">{entry.subjectTitle}</p>
                          <p dir={dirOf(entry.reason)} className="text-start text-xs text-muted-foreground">{entry.reason}</p>
                        </div>
                        <Link href={`/subjects/${entry.subjectId}#draft-studio`} onClick={() => setTimeout(() => window.dispatchEvent(new HashChangeEvent("hashchange")), 50)}
                          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground">
                          {copy("Make a draft", "اصنع مسودة")}<ArrowUpRight size={12} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {digest.nudge && (
                <p dir={dirOf(digest.nudge)} className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-start text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
                  <Lightbulb size={15} className="mt-0.5 shrink-0" />{digest.nudge}
                </p>
              )}
            </div>
          ) : (
            <button type="button" onClick={() => setOpen(true)} className="mt-3 text-sm font-medium text-primary hover:underline">{copy("Read the digest", "اقرأ الملخص")}</button>
          )}
        </div>
      ) : (
        <div className="relative mt-2">
          <p className="text-sm text-muted-foreground">
            {copy(`You captured ${data.items} ideas this week. Let the app find the themes, the questions you raised, and what's ready to become a draft.`,
              `التقطت ${data.items} فكرة هذا الأسبوع. دع التطبيق يجد المحاور والأسئلة التي طرحتها وما هو جاهز ليصبح مسودة.`)}
          </p>
          <Button className="mt-3 h-9 rounded-full" onClick={() => void make()} disabled={making}>
            {making ? <Loader2 size={14} className="me-1.5 animate-spin" /> : <Sparkles size={14} className="me-1.5" />}
            {making ? copy("Reading your week…", "جارٍ قراءة أسبوعك…") : copy("Make my weekly digest", "اصنع ملخص أسبوعي")}
          </Button>
        </div>
      )}
    </section>
  );
}
