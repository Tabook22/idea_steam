import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUp,
  CalendarClock,
  Check,
  Copy,
  Download,
  ListChecks,
  Loader2,
  MessageCircleQuestion,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Search,
  TriangleAlert,
  Users,
} from "lucide-react";
import {
  askMeeting,
  getGetMeetingQueryKey,
  getListMeetingsQueryKey,
  processMeeting,
  readMeetingHandwriting,
  requestUploadUrl,
  saveMeetingNotebook,
  saveMeetingNotes,
  updateMeeting,
  useGetMeeting,
  type Meeting,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { MeetingNotepad } from "@/components/meeting-notepad";
import { NotebookCard } from "@/components/notebook-card";
import type { MeetingNotebookDoc } from "@/lib/notebook";
import type { MeetingNote } from "@/lib/meeting-notes";
import { useToast } from "@/hooks/use-toast";
import { appPath, uploadCredentials } from "@/lib/app-path";
import { useLanguage } from "@/lib/i18n";
import { answerPieces, clock, segmentAt, speakerColor } from "@/lib/meeting-view";
import { stageLabel } from "@/pages/meetings";

type Tab = "minutes" | "notes" | "transcript" | "ask" | "speakers";
const MARK_ICON: Record<string, string> = { important: "⭐", decision: "✅", action: "📌", question: "❓" };
const dirOf = (text: string) => (/[֐-ࣿ]/.test(text.slice(0, 40)) ? "rtl" : "ltr");

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function MeetingPage() {
  const { id } = useParams<{ id: string }>();
  const meetingId = Number(id);
  const { isArabic, language } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: meeting, isLoading } = useGetMeeting(meetingId, {
    query: { queryKey: getGetMeetingQueryKey(meetingId), refetchInterval: (query) => (query.state.data?.status === "processing" ? 4000 : false) },
  });
  const [tab, setTab] = useState<Tab>("minutes");
  const audio = useRef<HTMLAudioElement>(null);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const date = useMemo(() => new Intl.DateTimeFormat(language, { dateStyle: "full", timeStyle: "short" }), [language]);

  const refresh = (next?: Meeting) => {
    if (next) queryClient.setQueryData(getGetMeetingQueryKey(meetingId), next);
    void queryClient.invalidateQueries({ queryKey: getListMeetingsQueryKey() });
  };
  const seek = (at: number | null) => {
    if (at === null || !audio.current) return;
    audio.current.currentTime = Math.max(0, at - 1);
    void audio.current.play().catch(() => {});
  };
  const names = useMemo(() => new Map((meeting?.speakers ?? []).map((speaker) => [speaker.id, speaker.name])), [meeting?.speakers]);
  const who = (value: string | null) => (value ? names.get(value) ?? value : null);

  async function rename(changes: Record<string, string>) {
    try { refresh(await updateMeeting(meetingId, { speakers: changes })); }
    catch { toast({ variant: "destructive", title: copy("Couldn't save the name.", "تعذر حفظ الاسم.") }); }
  }
  async function saveTitle() {
    setEditingTitle(false);
    if (!meeting || !titleDraft.trim() || titleDraft.trim() === meeting.title) return;
    try { refresh(await updateMeeting(meetingId, { title: titleDraft.trim() })); } catch { /* unchanged */ }
  }
  async function retry(fresh = false) {
    try { refresh(await processMeeting(meetingId, { fresh })); }
    catch (error) { toast({ variant: "destructive", title: (error as { data?: { error?: string } })?.data?.error ?? copy("Couldn't start again.", "تعذرت إعادة المحاولة.") }); }
  }

  if (isLoading) return <main className="grid min-h-[50vh] place-items-center"><Loader2 className="animate-spin text-primary" /></main>;
  if (!meeting) return <main className="mx-auto max-w-3xl px-4 py-10 text-center text-muted-foreground">{copy("Meeting not found.", "الاجتماع غير موجود.")}</main>;

  const minutes = meeting.minutes;
  const tabs: Array<[Tab, string]> = [["minutes", copy("Minutes", "المحضر")], ["notes", `${copy("Notes", "الملاحظات")}${meeting.notes.length ? ` ${meeting.notes.length}` : ""}`], ["transcript", copy("Transcript", "النص")], ["ask", copy("Ask", "اسأل")], ["speakers", copy("Speakers", "المتحدثون")]];

  return (
    <main id="main-content" className="mx-auto w-full max-w-3xl px-4 pb-28 pt-2 sm:px-6">
      <Link href="/meetings" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft size={15} className="rtl:rotate-180" />{copy("Meetings", "الاجتماعات")}
      </Link>
      {editingTitle ? (
        <form onSubmit={(event) => { event.preventDefault(); void saveTitle(); }}>
          <input autoFocus value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} onBlur={() => void saveTitle()} dir="auto" maxLength={200}
            className="w-full rounded-xl border bg-background px-3 py-2 font-serif text-2xl outline-none focus:border-primary" aria-label={copy("Meeting title", "عنوان الاجتماع")} />
        </form>
      ) : (
        <h1 className="group flex items-start gap-2 font-serif text-3xl leading-tight">
          <span dir="auto">{meeting.title}</span>
          <button type="button" onClick={() => { setTitleDraft(meeting.title); setEditingTitle(true); }} aria-label={copy("Rename", "إعادة تسمية")}
            className="mt-2 text-muted-foreground opacity-100 sm:opacity-0 sm:group-hover:opacity-100"><Pencil size={16} /></button>
        </h1>
      )}
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <CalendarClock size={13} />{date.format(new Date(meeting.createdAt))}
        {meeting.durationSeconds ? <span>· {clock(meeting.durationSeconds)}</span> : null}
        {meeting.subjectTitle && <Link href={`/subjects/${meeting.subjectId}`} className="rounded-full bg-secondary px-2 py-0.5 font-medium text-secondary-foreground hover:text-primary">📓 <span dir="auto">{meeting.subjectTitle}</span></Link>}
      </p>

      {/* The recording, always at hand: every ▶ in the page plays from that moment. */}
      {meeting.url && (
        <div className="sticky top-0 z-20 -mx-4 mt-4 border-b bg-background/90 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
          <audio ref={audio} src={appPath(meeting.url, import.meta.env.BASE_URL)} preload="metadata"
            onTimeUpdate={(event) => setNow(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => (playing ? audio.current?.pause() : void audio.current?.play())} aria-label={playing ? copy("Pause", "إيقاف مؤقت") : copy("Play", "تشغيل")}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">{playing ? <Pause size={17} /> : <Play size={17} className="ms-0.5" />}</button>
            <input type="range" min={0} max={meeting.durationSeconds ?? 0} step={1} value={Math.min(now, meeting.durationSeconds ?? 0)} dir="ltr"
              onChange={(event) => { if (audio.current) audio.current.currentTime = Number(event.target.value); }}
              aria-label={copy("Position", "الموضع")} className="h-1.5 flex-1 accent-[hsl(var(--primary))]" />
            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground" dir="ltr">{clock(now)} / {clock(meeting.durationSeconds ?? 0)}</span>
          </div>
        </div>
      )}

      {meeting.status !== "ready" ? (
        <div className={`mt-6 rounded-[1.5rem] border p-6 text-center ${meeting.status === "failed" ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30" : "bg-card"}`}>
          {meeting.status === "failed" ? <TriangleAlert className="mx-auto text-red-600" size={28} /> : <Loader2 className="mx-auto animate-spin text-primary" size={28} />}
          <p className="mt-3 font-medium">{stageLabel(meeting, copy)}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {meeting.status === "failed" ? meeting.error
              : copy("This takes about a minute for every 10 minutes of meeting. You can leave this page; it carries on.", "يستغرق ذلك دقيقة تقريبًا لكل 10 دقائق من الاجتماع. يمكنك مغادرة الصفحة؛ يستمر العمل.")}
          </p>
          {meeting.status === "failed" && <Button className="mt-4 rounded-full" onClick={() => void retry()}><RotateCcw size={15} className="me-1.5" />{copy("Try again", "حاول مجددًا")}</Button>}
        </div>
      ) : null}
      {meeting.status !== "ready" ? (
        <div className="mt-6">
          <h2 className="mb-3 font-serif text-xl">{copy("Notes", "الملاحظات")}</h2>
          <MeetingNotes meeting={meeting} seek={seek} copy={copy} arabic={isArabic} onSaved={refresh} />
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-5 gap-1 rounded-2xl bg-secondary p-1 text-[13px] sm:text-sm" role="tablist">
            {tabs.map(([value, label]) => (
              <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}
                className={`rounded-xl px-1 py-2 font-medium transition ${tab === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
            ))}
          </div>

          {tab === "minutes" && minutes && (
            <div className="mt-5 space-y-6">
              <p dir={dirOf(minutes.summary)} className="text-start text-[15px] leading-7">{minutes.summary}</p>
              <MinutesList title={copy("Decisions", "القرارات")} icon="✅" items={minutes.decisions.map((entry) => ({ text: entry.text, at: entry.at }))} seek={seek} />
              {minutes.actions.length > 0 && (
                <section>
                  <h2 className="mb-2 flex items-center justify-between text-sm font-semibold">
                    <span>📌 {copy("Action items", "المهام")}</span>
                    <Link href="/tasks" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><ListChecks size={13} />{copy("In your Tasks", "في مهامك")}</Link>
                  </h2>
                  <ul className="divide-y rounded-2xl border bg-card">
                    {minutes.actions.map((action, index) => (
                      <li key={index} className="flex items-start gap-3 px-3.5 py-3">
                        <span dir={dirOf(action.text)} className="min-w-0 flex-1 text-start text-sm leading-6">{action.text}
                          <span className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                            {who(action.owner) && <span className="rounded-full bg-violet-100 px-2 py-0.5 font-medium text-violet-900 dark:bg-violet-900/40 dark:text-violet-100" dir="auto">👤 {who(action.owner)}</span>}
                            {action.due && <span className="rounded-full bg-secondary px-2 py-0.5 font-medium">📅 {action.due}</span>}
                          </span>
                        </span>
                        <TimeChip at={action.at} seek={seek} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <MinutesList title={copy("Open questions", "أسئلة مفتوحة")} icon="❓" items={minutes.questions.map((entry) => ({ text: entry.text, at: entry.at }))} seek={seek} />
              {minutes.quotes.length > 0 && (
                <section>
                  <h2 className="mb-2 text-sm font-semibold">💬 {copy("Worth remembering", "يستحق التذكر")}</h2>
                  <div className="space-y-2">
                    {minutes.quotes.map((quote, index) => (
                      <blockquote key={index} className="flex items-start gap-3 rounded-2xl border-s-4 border-primary/40 bg-card px-4 py-3">
                        <span className="min-w-0 flex-1">
                          <span dir={dirOf(quote.text)} className="block text-start font-serif text-[15px] italic leading-7">“{quote.text}”</span>
                          {quote.speaker && <span className="mt-1 block text-xs text-muted-foreground" dir="auto">— {quote.speaker}</span>}
                        </span>
                        <TimeChip at={quote.at} seek={seek} />
                      </blockquote>
                    ))}
                  </div>
                </section>
              )}
              {minutes.topics.length > 0 && (
                <section>
                  <h2 className="mb-2 text-sm font-semibold">🧭 {copy("Topics", "المحاور")}</h2>
                  <ol className="space-y-1">
                    {minutes.topics.map((topic) => (
                      <li key={topic.start}><button type="button" onClick={() => seek(topic.start)} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-start text-sm hover:bg-primary/5">
                        <span className="font-mono text-xs tabular-nums text-primary" dir="ltr">{clock(topic.start)}</span><span dir="auto">{topic.title}</span>
                      </button></li>
                    ))}
                  </ol>
                </section>
              )}
              {meeting.markers.length > 0 && (
                <section>
                  <h2 className="mb-2 text-sm font-semibold">🔖 {copy("Your marks", "علاماتك")}</h2>
                  <div className="flex flex-wrap gap-1.5">
                    {meeting.markers.map((mark, index) => (
                      <button key={index} type="button" onClick={() => seek(mark.at)} className="inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-xs hover:border-primary/40">
                        {MARK_ICON[mark.kind]}<span className="font-mono tabular-nums" dir="ltr">{clock(mark.at)}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}
              <div className="flex flex-wrap gap-2 border-t pt-4">
                <Button variant="outline" className="rounded-full" onClick={() => { void navigator.clipboard?.writeText(meeting.minutesText ?? "").then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
                  {copied ? <Check size={15} className="me-1.5" /> : <Copy size={15} className="me-1.5" />}{copied ? copy("Copied", "نُسخ") : copy("Copy minutes", "انسخ المحضر")}
                </Button>
                <Button variant="outline" className="rounded-full" onClick={() => download(`${meeting.title.replace(/[\\/:*?"<>|]+/g, " ").slice(0, 80) || "Meeting"}.md`, meeting.minutesText ?? "")}>
                  <Download size={15} className="me-1.5" />{copy("Download minutes", "نزّل المحضر")}
                </Button>
                <a href={appPath(`/api/audio-library/${meeting.libraryItemId}/export?format=mp3&quality=standard`, import.meta.env.BASE_URL)}
                  className="inline-flex h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-medium"><Download size={15} />{copy("Audio (MP3)", "الصوت (MP3)")}</a>
                <Button variant="ghost" className="rounded-full text-muted-foreground" onClick={() => void retry()}><RotateCcw size={15} className="me-1.5" />{copy("Rewrite the minutes", "أعد كتابة المحضر")}</Button>
              </div>
            </div>
          )}

          {tab === "notes" && <MeetingNotes meeting={meeting} seek={seek} copy={copy} arabic={isArabic} onSaved={refresh} />}
          {tab === "transcript" && <Transcript meeting={meeting} now={now} seek={seek} copy={copy} onRename={rename} />}
          {tab === "ask" && <AskMeeting meeting={meeting} seek={seek} copy={copy} />}
          {tab === "speakers" && <Speakers meeting={meeting} seek={seek} copy={copy} onRename={rename} />}
        </>
      )}
    </main>
  );
}

/** The meeting's notepad, afterwards: changes are saved to the meeting (and its notebook entry). */
function MeetingNotes({ meeting, seek, copy, arabic, onSaved }: { meeting: Meeting; seek: (at: number | null) => void; copy: (en: string, ar: string) => string; arabic: boolean; onSaved: (next?: Meeting) => void }) {
  const [notes, setNotes] = useState<MeetingNote[]>(meeting.notes as MeetingNote[]);
  const [state, setState] = useState<"saved" | "saving" | "error">("saved");
  const timer = useRef(0);
  const latest = useRef(notes);
  const { toast } = useToast();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const save = (next: MeetingNote[]) => {
    latest.current = next;
    setNotes(next);
    setState("saving");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        const saved = await saveMeetingNotes(meeting.id, { notes: latest.current });
        setState("saved");
        onSaved(saved);
      } catch { setState("error"); }
    }, 900);
  };
  async function upload(note: MeetingNote, file: Blob): Promise<MeetingNote> {
    const type = note.mimeType || file.type || "application/octet-stream";
    const target = await requestUploadUrl({ name: note.name || "file", size: file.size, contentType: type });
    const response = await fetch(appPath(target.uploadURL, import.meta.env.BASE_URL), {
      method: "PUT", body: file, headers: { "Content-Type": type }, credentials: uploadCredentials(target.uploadURL, location.origin),
    });
    if (!response.ok) { toast({ variant: "destructive", title: copy("Upload failed.", "فشل الرفع.") }); throw new Error("upload"); }
    return { ...note, url: `/api/storage${target.objectPath}` };
  }
  return (
    <div className="mt-5">
      <p className="mb-3 text-xs text-muted-foreground" role="status">
        {state === "saving" ? copy("Saving…", "جارٍ الحفظ…") : state === "error" ? copy("Not saved. Check your connection.", "لم يُحفظ. تحقّق من الاتصال.") : copy("Saved. Also in the meeting's notebook.", "محفوظ. وأيضًا في دفتر الاجتماع.")}
      </p>
      <div className="mb-4">
        <NotebookCard
          doc={(meeting.notebook as unknown as MeetingNotebookDoc | null) ?? null}
          title={meeting.title}
          copy={copy}
          storeMedia={async (item, file) => ({ ...item, url: (await upload({ id: item.id, kind: "file", at: null, createdAt: "", name: item.name, mimeType: item.mimeType }, file)).url })}
          storeSnapshot={async (page, png) => ({ url: (await upload({ id: page.id, kind: "photo", at: null, createdAt: "", name: "page.png", mimeType: "image/png" }, png)).url, rev: page.rev })}
          onSave={async (doc) => {
            try { onSaved(await saveMeetingNotebook(meeting.id, { notebook: doc as unknown as Parameters<typeof saveMeetingNotebook>[1]["notebook"] })); }
            catch { toast({ variant: "destructive", title: copy("The notebook couldn't be saved.", "تعذر حفظ الدفتر.") }); }
          }}
          onRead={async () => {
            try { onSaved(await readMeetingHandwriting(meeting.id)); }
            catch (error) { toast({ variant: "destructive", title: (error as { data?: { error?: string } })?.data?.error ?? copy("Couldn't read the handwriting.", "تعذرت قراءة الخط.") }); }
          }}
        />
      </div>
      <MeetingNotepad notes={notes} onChange={save} now={() => null} seek={(at) => seek(at)} storeFile={upload} copy={copy} arabic={arabic} />
    </div>
  );
}

function TimeChip({ at, seek }: { at: number | null; seek: (at: number | null) => void }) {
  if (at === null) return null;
  return (
    <button type="button" onClick={() => seek(at)} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 font-mono text-[11px] tabular-nums text-primary hover:bg-primary/20" dir="ltr">
      <Play size={10} />{clock(at)}
    </button>
  );
}

function MinutesList({ title, icon, items, seek }: { title: string; icon: string; items: Array<{ text: string; at: number | null }>; seek: (at: number | null) => void }) {
  if (!items.length) return null;
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">{icon} {title}</h2>
      <ul className="divide-y rounded-2xl border bg-card">
        {items.map((item, index) => (
          <li key={index} className="flex items-start gap-3 px-3.5 py-3">
            <span dir={dirOf(item.text)} className="min-w-0 flex-1 text-start text-sm leading-6">{item.text}</span>
            <TimeChip at={item.at} seek={seek} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Transcript({ meeting, now, seek, copy, onRename }: { meeting: Meeting; now: number; seek: (at: number | null) => void; copy: (en: string, ar: string) => string; onRename: (changes: Record<string, string>) => Promise<void> }) {
  const [filter, setFilter] = useState("");
  const [follow, setFollow] = useState(true);
  const list = useRef<HTMLDivElement>(null);
  const names = new Map(meeting.speakers.map((speaker) => [speaker.id, speaker.name]));
  const current = segmentAt(meeting.segments, now);
  const needle = filter.trim().toLocaleLowerCase();
  const shown = meeting.segments.map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => !needle || segment.text.toLocaleLowerCase().includes(needle) || (names.get(segment.speaker) ?? "").toLocaleLowerCase().includes(needle));
  useEffect(() => {
    if (!follow || needle || current < 0) return;
    list.current?.querySelector(`[data-segment="${current}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [current, follow, needle]);
  const marks = meeting.markers;

  return (
    <div className="mt-5">
      <div className="flex items-center gap-2">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border bg-card px-3">
          <Search size={15} className="text-muted-foreground" />
          <input value={filter} onChange={(event) => setFilter(event.target.value)} dir="auto" placeholder={copy("Search what was said, or a name", "ابحث فيما قيل أو عن اسم")}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none" aria-label={copy("Search the transcript", "ابحث في النص")} />
          {needle && <span className="text-xs text-muted-foreground">{shown.length}</span>}
        </label>
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} className="h-3.5 w-3.5" />{copy("Follow audio", "تتبّع الصوت")}
        </label>
      </div>
      <div ref={list} className="mt-3 space-y-1">
        {shown.map(({ segment, index }) => {
          const color = speakerColor(segment.speaker);
          const mark = marks.find((entry) => entry.at >= segment.start - 2 && entry.at <= segment.end + 2);
          return (
            <div key={index} data-segment={index} className={`flex gap-3 rounded-xl px-2.5 py-2 transition-colors ${index === current ? color.soft : ""}`}>
              <button type="button" onClick={() => seek(segment.start)} className="mt-0.5 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground hover:text-primary" dir="ltr">{clock(segment.start)}</button>
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => { const name = prompt(copy("Who is this?", "من هذا المتحدث؟"), names.get(segment.speaker) ?? ""); if (name !== null) void onRename({ [segment.speaker]: name }); }}
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold ${color.text} hover:underline`} title={copy("Rename this speaker", "أعد تسمية هذا المتحدث")}>
                  <span className={`h-2 w-2 rounded-full ${color.dot}`} />{names.get(segment.speaker) ?? segment.speaker}
                  {mark && <span title={mark.kind}>{MARK_ICON[mark.kind]}</span>}
                </button>
                <p dir={dirOf(segment.text)} className="text-start text-sm leading-6">{segment.text}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Speakers({ meeting, seek, copy, onRename }: { meeting: Meeting; seek: (at: number | null) => void; copy: (en: string, ar: string) => string; onRename: (changes: Record<string, string>) => Promise<void> }) {
  const total = Math.max(1, meeting.speakers.reduce((sum, speaker) => sum + speaker.seconds, 0));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  return (
    <div className="mt-5 space-y-3">
      <p className="text-sm text-muted-foreground">{copy("Give each voice a name: it's used in the transcript, the minutes and your tasks. Tap ▶ to hear them.", "سمِّ كل صوت: يُستخدم الاسم في النص والمحضر ومهامك. اضغط ▶ لتسمعه.")}</p>
      <p className="rounded-xl bg-sky-500/10 px-3 py-2 text-xs text-sky-900 dark:text-sky-100">
        {copy("Same person shown twice? Give both the same name and they're merged into one.", "الشخص نفسه ظهر مرتين؟ أعطِهما الاسم نفسه فيُدمجان في متحدث واحد.")}
      </p>
      {meeting.speakers.map((speaker) => {
        const color = speakerColor(speaker.id);
        const sample = meeting.segments.find((segment) => segment.speaker === speaker.id && segment.end - segment.start >= 3) ?? meeting.segments.find((segment) => segment.speaker === speaker.id);
        const share = Math.round((speaker.seconds / total) * 100);
        const draft = drafts[speaker.id] ?? (speaker.named ? speaker.name : "");
        return (
          <div key={speaker.id} className="rounded-2xl border bg-card p-4">
            <div className="flex items-center gap-3">
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold text-white ${color.dot}`}>{(speaker.named ? speaker.name : speaker.id.replace(/^S/, "")).slice(0, 2).toUpperCase()}</span>
              <input value={draft} placeholder={speaker.name} dir="auto" maxLength={60}
                onChange={(event) => setDrafts((all) => ({ ...all, [speaker.id]: event.target.value }))}
                onBlur={() => { if (draft !== (speaker.named ? speaker.name : "")) void onRename({ [speaker.id]: draft }); }}
                onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
                aria-label={copy(`Name for ${speaker.name}`, `اسم ${speaker.name}`)}
                className="h-10 min-w-0 flex-1 rounded-xl border bg-background px-3 text-sm outline-none focus:border-primary" />
              {sample && (
                <button type="button" onClick={() => seek(sample.start + 1)} aria-label={copy(`Hear ${speaker.name}`, `استمع إلى ${speaker.name}`)}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary hover:bg-primary/20"><Play size={15} className="ms-0.5" /></button>
              )}
            </div>
            <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary"><div className={`h-full rounded-full ${color.dot}`} style={{ width: `${share}%` }} /></div>
              <span className="shrink-0 tabular-nums">{clock(speaker.seconds)} · {share}%</span>
            </div>
          </div>
        );
      })}
      {!meeting.speakers.length && <p className="text-sm text-muted-foreground"><Users size={14} className="me-1 inline" />{copy("No speakers yet.", "لا متحدثين بعد.")}</p>}
    </div>
  );
}

function AskMeeting({ meeting, seek, copy }: { meeting: Meeting; seek: (at: number | null) => void; copy: (en: string, ar: string) => string }) {
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Array<{ question: string; answer: string | null; error?: string }>>([]);
  const [busy, setBusy] = useState(false);
  const first = meeting.speakers[0]?.name ?? copy("the first speaker", "المتحدث الأول");
  const examples = [
    copy("What did we decide, and who does what?", "ماذا قررنا، ومن يفعل ماذا؟"),
    copy(`What did ${first} think about the main topic?`, `ما رأي ${first} في الموضوع الرئيسي؟`),
    copy("Were there any disagreements?", "هل كانت هناك نقاط خلاف؟"),
    copy("What should I follow up on before the next meeting?", "ما الذي يجب أن أتابعه قبل الاجتماع القادم؟"),
  ];
  async function ask(question: string) {
    const text = question.trim();
    if (text.length < 2 || busy) return;
    setDraft("");
    setBusy(true);
    const history = turns.filter((turn) => turn.answer).slice(-3).map((turn) => ({ question: turn.question, answer: turn.answer! }));
    setTurns((all) => [...all, { question: text, answer: null }]);
    try {
      const result = await askMeeting(meeting.id, { question: text, history });
      setTurns((all) => all.map((turn, index) => (index === all.length - 1 ? { ...turn, answer: result.answer } : turn)));
    } catch (error) {
      const message = (error as { data?: { error?: string } })?.data?.error ?? copy("Couldn't answer right now.", "تعذرت الإجابة الآن.");
      setTurns((all) => all.map((turn, index) => (index === all.length - 1 ? { ...turn, error: message } : turn)));
    } finally { setBusy(false); }
  }
  return (
    <div className="mt-5">
      {!turns.length && (
        <div className="grid gap-2 sm:grid-cols-2">
          {examples.map((example) => (
            <button key={example} type="button" dir="auto" onClick={() => void ask(example)}
              className="rounded-2xl border bg-card px-4 py-3 text-start text-sm transition hover:border-primary/40 hover:bg-primary/5">
              <MessageCircleQuestion size={15} className="mb-1 text-primary" />{example}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-4">
        {turns.map((turn, index) => (
          <div key={index} className="space-y-2">
            <p dir="auto" className="ms-auto max-w-[85%] rounded-2xl rounded-ee-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">{turn.question}</p>
            {turn.error ? <p className="text-sm text-destructive" role="alert">{turn.error}</p>
              : turn.answer === null ? <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 size={14} className="animate-spin" />{copy("Listening back through the meeting…", "جارٍ مراجعة الاجتماع…")}</p>
              : (
                <div dir={dirOf(turn.answer)} className="whitespace-pre-wrap rounded-2xl rounded-ss-md border bg-card px-4 py-3 text-start text-[15px] leading-7">
                  {answerPieces(turn.answer).map((piece, i) => ("at" in piece ? (
                    <button key={i} type="button" onClick={() => seek(piece.at)} className="mx-0.5 inline-flex items-center gap-0.5 rounded-full bg-primary/12 px-1.5 align-middle font-mono text-[11px] text-primary hover:bg-primary hover:text-primary-foreground" dir="ltr">
                      <Play size={9} />{piece.label}
                    </button>
                  ) : <span key={i}>{piece.text}</span>))}
                </div>
              )}
          </div>
        ))}
      </div>
      <form onSubmit={(event) => { event.preventDefault(); void ask(draft); }} className="sticky bottom-24 mt-4 flex items-end gap-2 rounded-2xl border bg-background p-1.5 ps-3 shadow-sm focus-within:border-primary/50 md:bottom-4">
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={1} dir="auto" maxLength={500}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(draft); } }}
          placeholder={copy("Ask about this meeting…", "اسأل عن هذا الاجتماع…")} aria-label={copy("Your question", "سؤالك")}
          className="max-h-32 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[15px] outline-none placeholder:text-muted-foreground" />
        <button type="submit" disabled={busy || draft.trim().length < 2} aria-label={copy("Ask", "اسأل")}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={17} />}
        </button>
      </form>
    </div>
  );
}
