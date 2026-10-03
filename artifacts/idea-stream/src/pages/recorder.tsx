import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CloudUpload,
  Copy,
  Download,
  FileText,
  FolderCheck,
  Globe,
  Headphones,
  Inbox,
  Lightbulb,
  Loader2,
  Mic,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Timer,
  Trash2,
  WifiOff,
} from "lucide-react";
import {
  createSubject,
  getListSubjectsQueryKey,
  updateIdea,
  addAudioLibraryItemToSubject,
  useListSubjects,
  type Subject,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { recordingStore, useRecorder, withRecordingLock } from "@/components/recorder-provider";
import { OptionPill } from "@/components/option-pill";
import type { LocalRecording } from "@/lib/recording-store";
import { spokenSubject, recordingTitle } from "@/lib/recording-utils";
import { useLanguage } from "@/lib/i18n";
import { RECORDING_LIMITS, useRecorderPrefs as usePrefs, type SpokenLanguage } from "@/lib/recorder-prefs";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ToastAction } from "@/components/ui/toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const LIMITS = RECORDING_LIMITS;
const INBOX_TITLES = ["Idea inbox", "صندوق الأفكار"];

const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

function limitLabel(value: number, copy: (en: string, ar: string) => string) {
  return value < 60 ? copy("30 sec", "٣٠ ثانية") : `${value / 60} ${copy("min", "دقيقة")}`;
}

function Step({ number, done, active, children }: { number: number; done: boolean; active?: boolean; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${done ? "text-primary" : active ? "text-foreground" : "text-muted-foreground"}`}>
      <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${done ? "bg-primary text-primary-foreground" : active ? "border-2 border-primary text-primary" : "border"}`}>
        {done ? <Check size={11} strokeWidth={3} /> : number}
      </span>
      {children}
    </span>
  );
}

function RecordingCard({ record, subjects, inboxIds }: {
  record: LocalRecording; subjects: Subject[]; inboxIds: Set<number>;
}) {
  const { isArabic, language } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const { refresh, sync, syncingId, transcribingId, requestTranscript, online, stage } = useRecorder();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [audioUrl, setAudioUrl] = useState<string>();
  const [listening, setListening] = useState(false);
  const [showAllText, setShowAllText] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [savingText, setSavingText] = useState(false);
  const [transcriptionLanguage, setTranscriptionLanguage] = useState<SpokenLanguage>(record.transcriptionLanguage || "auto");
  const [copied, setCopied] = useState(false);
  const [moving, setMoving] = useState<number | "new" | null>(null);
  const [changing, setChanging] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [error, setError] = useState("");
  const [remove, setRemove] = useState(false);

  const transcribing = transcribingId === record.id;
  const syncing = syncingId === record.id;
  const busy = moving !== null || transcribing || syncing || stage !== "idle";
  const hasText = !!record.transcript;
  const filedSubject = record.subjectId !== null && !inboxIds.has(record.subjectId)
    ? subjects.find((subject) => subject.id === record.subjectId)
    : undefined;
  const inLibrary = record.destination === "library";
  const filed = !!filedSubject || inLibrary;
  const choices = subjects.filter((subject) => !inboxIds.has(subject.id));
  const suggested = record.transcript ? spokenSubject(record.transcript, choices) : null;
  const suggestedSubject = suggested !== null && suggested !== record.subjectId
    ? choices.find((subject) => subject.id === suggested)
    : undefined;
  const quick = choices.filter((subject) => subject.id !== suggestedSubject?.id).slice(0, 6);
  const more = choices.filter((subject) => subject.id !== suggestedSubject?.id).slice(6);
  const waitingForText = !hasText && record.autoTranscribe !== false && !record.transcriptionStatus;

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    let url: string | undefined;
    let canceled = false;
    if (listening)
      void recordingStore
        .audio(record.id)
        .then((blob) => {
          if (!canceled) {
            url = URL.createObjectURL(blob);
            setAudioUrl(url);
          }
        })
        .catch(() => setError(copy("Couldn't read this device copy.", "تعذر قراءة نسخة الجهاز.")));
    return () => {
      canceled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [listening, record.id]);

  async function moveTo(subjectId: number | null, { announce = true } = {}) {
    const previous = record.subjectId;
    setMoving(subjectId ?? -1);
    setError("");
    try {
      await withRecordingLock(async () => {
        if (record.ideaId) {
          if (subjectId === null) return;
          await updateIdea(record.ideaId, { subjectId });
          await queryClient.invalidateQueries();
        } else if (record.libraryItemId && subjectId !== null) {
          // Already in the audio library: add that copy to the subject.
          const item = await addAudioLibraryItemToSubject(record.libraryItemId, { subjectId });
          const ideaId = item.subjects.find((link) => link.subjectId === subjectId)?.ideaId;
          await recordingStore.patch(record.id, { subjectId, ideaId, destination: undefined, error: undefined });
          await queryClient.invalidateQueries();
          return;
        }
        await recordingStore.patch(record.id, { subjectId, ...(subjectId !== null ? { destination: undefined } : {}), error: undefined, attempts: 0, nextRetryAt: 0 });
      });
      await refresh();
      setChanging(false);
      void sync(true);
      const title = subjects.find((subject) => subject.id === subjectId)?.title;
      if (announce && title)
        toast({
          title: copy(`Filed in “${title}”`, `حُفظت في «${title}»`),
          description: copy("You'll find it in that notebook.", "ستجدها في هذا الدفتر."),
          action: previous !== null && previous !== subjectId ? (
            <ToastAction altText={copy("Undo", "تراجع")} onClick={() => void moveTo(previous, { announce: false })}>
              {copy("Undo", "تراجع")}
            </ToastAction>
          ) : undefined,
        });
    } catch {
      setError(copy("Couldn't move it. Your original is still saved.", "تعذر النقل. التسجيل الأصلي محفوظ."));
    } finally {
      setMoving(null);
    }
  }

  async function createAndFile() {
    const title = newTitle.trim();
    if (!title) return;
    setMoving("new");
    setError("");
    try {
      const subject = await createSubject({ title, intro: "" });
      await queryClient.invalidateQueries({ queryKey: getListSubjectsQueryKey() });
      setCreating(false);
      setNewTitle("");
      setMoving(null);
      await moveTo(subject.id, { announce: false });
      toast({ title: copy(`New subject “${title}” created`, `أُنشئ موضوع «${title}»`), description: copy("Your idea is filed there.", "حُفظت فكرتك فيه.") });
    } catch {
      setError(copy("Couldn't create that subject. Please try again.", "تعذر إنشاء الموضوع. حاول مجددًا."));
      setMoving(null);
    }
  }

  async function saveText() {
    const text = draft.trim();
    if (!text) return;
    setSavingText(true);
    setError("");
    try {
      await withRecordingLock(async () => {
        if (record.ideaId) {
          await updateIdea(record.ideaId, { content: text });
          await queryClient.invalidateQueries();
        }
        // A typed text counts as the transcript, so automatic conversion won't replace it.
        await recordingStore.patch(record.id, {
          transcript: text, transcriptionStatus: "done", transcriptionError: undefined,
        });
      });
      await refresh();
      setEditing(false);
    } catch {
      setError(copy("Couldn't save the text. Please try again.", "تعذر حفظ النص. حاول مجددًا."));
    } finally {
      setSavingText(false);
    }
  }

  const chip = (subject: Subject, highlight = false) => {
    const current = subject.id === record.subjectId;
    return (
      <button
        key={subject.id}
        type="button"
        disabled={busy}
        aria-pressed={current}
        onClick={() => void moveTo(subject.id)}
        className={`inline-flex h-11 max-w-full items-center gap-2 rounded-full border px-4 text-sm font-medium transition active:scale-[0.97] disabled:opacity-60 ${
          highlight
            ? "border-primary bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:bg-primary/90"
            : current
              ? "border-primary bg-primary/10 text-primary"
              : "bg-background hover:border-primary/50 hover:bg-primary/5"
        }`}
      >
        {moving === subject.id ? <Loader2 size={15} className="animate-spin" /> : highlight ? <Sparkles size={15} /> : current ? <Check size={15} /> : null}
        <span className="truncate">{subject.title}</span>
      </button>
    );
  };

  return (
    <article className={`overflow-hidden rounded-3xl border bg-card shadow-sm transition-shadow hover:shadow-md ${filed && !changing ? "" : "ring-1 ring-primary/5"}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b bg-muted/30 px-5 py-3">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Mic size={14} className="text-primary" />
          {new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(record.capturedAt))}
          <span aria-hidden="true">·</span>
          {clock(record.durationSeconds)}
        </p>
        <div className="flex flex-wrap items-center gap-3" aria-label={copy("Progress", "التقدم")}>
          <Step number={1} done={record.status === "synced"} active={record.status !== "synced"}>
            {syncing ? copy("Uploading…", "يرفع…") : copy("Saved", "حُفظ")}
          </Step>
          <Step number={2} done={hasText} active={record.status === "synced" && !hasText}>
            {transcribing ? copy("Writing…", "يكتب…") : copy("Text", "النص")}
          </Step>
          <Step number={3} done={filed} active={hasText && !filed}>
            {inLibrary ? copy("Library", "المكتبة") : copy("Filed", "مُصنّف")}
          </Step>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        {editing ? (
          <div className="space-y-3">
            <Textarea
              dir="auto"
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="min-h-36 text-base leading-7"
              aria-label={copy("Idea text", "نص الفكرة")}
            />
            <div className="flex flex-wrap gap-2">
              <Button disabled={savingText || !draft.trim()} onClick={() => void saveText()}>
                {savingText && <Loader2 size={15} className="me-2 animate-spin" />}
                {copy("Save text", "حفظ النص")}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>{copy("Cancel", "إلغاء")}</Button>
            </div>
          </div>
        ) : hasText ? (
          <div>
            <p dir="auto" className={`whitespace-pre-wrap font-serif text-lg leading-8 text-foreground ${showAllText ? "" : "line-clamp-5"}`}>
              {record.transcript}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {record.transcript!.length > 280 && (
                <Button size="sm" variant="ghost" className="h-9 px-2 text-primary" onClick={() => setShowAllText((value) => !value)}>
                  {showAllText ? copy("Show less", "عرض أقل") : copy("Read all", "اقرأ الكل")}
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-9 px-2" onClick={() => { setDraft(record.transcript || ""); setEditing(true); }}>
                <Pencil size={14} className="me-1.5" />{copy("Fix text", "تصحيح النص")}
              </Button>
              <Button
                size="sm" variant="ghost" className="h-9 px-2"
                onClick={() => void navigator.clipboard.writeText(record.transcript!).then(() => setCopied(true)).catch(() => setError(copy("Select the text to copy it.", "حدد النص لنسخه.")))}
              >
                {copied ? <Check size={14} className="me-1.5" /> : <Copy size={14} className="me-1.5" />}
                {copied ? copy("Copied", "نُسخ") : copy("Copy", "نسخ")}
              </Button>
            </div>
          </div>
        ) : transcribing || (waitingForText && online) ? (
          <div className="space-y-3" role="status">
            <p className="flex items-center gap-2 text-sm font-medium text-primary">
              <Loader2 size={16} className="animate-spin" />
              {transcribing ? copy("Turning your words into text…", "نحوّل كلماتك إلى نص…") : copy("Text is on its way…", "النص في الطريق…")}
            </p>
            <div className="space-y-2" aria-hidden="true">
              <div className="h-3.5 w-full animate-pulse rounded-full bg-muted" />
              <div className="h-3.5 w-11/12 animate-pulse rounded-full bg-muted" />
              <div className="h-3.5 w-2/3 animate-pulse rounded-full bg-muted" />
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed p-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <FileText size={16} className="text-primary" />
              {record.transcriptionStatus ? copy("Couldn't turn this into text yet", "لم يتحول التسجيل إلى نص بعد") : copy("Turn this recording into text", "حوّل هذا التسجيل إلى نص")}
            </p>
            {record.transcriptionError && <p className="mt-1.5 text-xs text-amber-800 dark:text-amber-300">{record.transcriptionError}</p>}
            {!online && <p className="mt-1.5 text-xs text-muted-foreground">{copy("You're offline. Your audio is safe; text will follow once you're connected.", "أنت غير متصل. صوتك محفوظ وسيُضاف النص عند الاتصال.")}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <OptionPill
                icon={<Globe size={15} />}
                label={copy("Spoken language", "اللغة المنطوقة")}
                value={transcriptionLanguage}
                disabled={busy}
                onChange={(event) => setTranscriptionLanguage(event.target.value as SpokenLanguage)}
              >
                <option value="auto">{copy("Detect language", "اكتشاف اللغة")}</option>
                <option value="ar">العربية</option>
                <option value="en">English</option>
              </OptionPill>
              <Button
                className="h-11 rounded-full px-5"
                disabled={busy || !online}
                onClick={() => void requestTranscript(record.id, transcriptionLanguage).catch(() => setError(copy("Couldn't start. Please retry.", "تعذر البدء. حاول مجددًا.")))}
              >
                {record.transcriptionStatus ? <RefreshCw size={15} className="me-2" /> : <Sparkles size={15} className="me-2" />}
                {record.transcriptionStatus ? copy("Try again", "حاول مجددًا") : copy("Convert to text", "حوّل إلى نص")}
              </Button>
              <Button variant="ghost" className="h-11 rounded-full" onClick={() => { setDraft(""); setEditing(true); }}>
                <Pencil size={15} className="me-2" />{copy("Type it instead", "اكتبها بنفسك")}
              </Button>
            </div>
          </div>
        )}

        {inLibrary && !changing ? (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-primary/10 px-4 py-3">
            <p className="flex items-center gap-2 text-sm">
              <Headphones size={18} className="shrink-0 text-primary" />
              {record.status === "synced"
                ? copy("Saved in your audio library", "محفوظ في مكتبة الصوت")
                : copy("Will be saved to your audio library", "سيُحفظ في مكتبة الصوت")}
            </p>
            <span className="flex flex-wrap gap-1">
              <Button size="sm" variant="outline" className="h-9 rounded-full" onClick={() => setChanging(true)}>{copy("Add to a subject", "أضف إلى موضوع")}</Button>
              <Button size="sm" variant="ghost" className="h-9 text-primary" asChild>
                <Link href="/library">{copy("Open library", "افتح المكتبة")}<ArrowUpRight size={14} className="ms-1" /></Link>
              </Button>
            </span>
          </div>
        ) : (
        <div className="mt-6">
          {filed && !changing ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-primary/10 px-4 py-3">
              <p className="flex min-w-0 items-center gap-2 text-sm">
                <CheckCircle2 size={18} className="shrink-0 text-primary" />
                <span className="text-muted-foreground">{copy("Filed in", "محفوظة في")}</span>
                <strong className="truncate font-semibold">{filedSubject!.title}</strong>
              </p>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-9" disabled={busy} onClick={() => setChanging(true)}>
                  {copy("Move", "نقل")}
                </Button>
                {record.ideaId && (
                  <Button size="sm" variant="ghost" className="h-9 text-primary" asChild>
                    <Link href={`/subjects/${record.subjectId}#idea-${record.ideaId}`}>
                      {copy("Open", "فتح")}<ArrowUpRight size={14} className="ms-1" />
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div>
              <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <FolderCheck size={17} className="text-primary" />
                {changing ? copy("Move to another subject", "انقلها إلى موضوع آخر") : copy("Which subject does this belong to?", "إلى أي موضوع تنتمي هذه الفكرة؟")}
              </p>
              {suggestedSubject && (
                <p className="mb-2 text-xs text-muted-foreground">{copy("You mentioned this subject in your recording:", "ذكرت هذا الموضوع في تسجيلك:")}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {suggestedSubject && chip(suggestedSubject, true)}
                {quick.map((subject) => chip(subject))}
                {more.length > 0 && (
                  <OptionPill
                    icon={<FolderCheck size={15} />}
                    label={copy("More subjects", "مواضيع أخرى")}
                    value=""
                    disabled={busy}
                    onChange={(event) => event.target.value && void moveTo(Number(event.target.value))}
                  >
                    <option value="">{copy(`${more.length} more…`, `${more.length} أخرى…`)}</option>
                    {more.map((subject) => <option key={subject.id} value={subject.id}>{subject.title}</option>)}
                  </OptionPill>
                )}
                {!creating && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setCreating(true)}
                    className="inline-flex h-11 items-center gap-1.5 rounded-full border border-dashed px-4 text-sm font-medium text-muted-foreground transition hover:border-primary hover:text-primary disabled:opacity-60"
                  >
                    <Plus size={15} />{copy("New subject", "موضوع جديد")}
                  </button>
                )}
                {changing && (
                  <Button variant="ghost" className="h-11 rounded-full" onClick={() => setChanging(false)}>{copy("Cancel", "إلغاء")}</Button>
                )}
              </div>
              {creating && (
                <form
                  className="mt-3 flex flex-wrap gap-2"
                  onSubmit={(event) => { event.preventDefault(); void createAndFile(); }}
                >
                  <input
                    autoFocus
                    dir="auto"
                    value={newTitle}
                    maxLength={200}
                    onChange={(event) => setNewTitle(event.target.value)}
                    placeholder={copy("Name the new subject", "اسم الموضوع الجديد")}
                    aria-label={copy("New subject name", "اسم الموضوع الجديد")}
                    className="h-11 min-w-0 flex-1 rounded-full border bg-background px-4 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                  <Button type="submit" className="h-11 rounded-full px-5" disabled={!newTitle.trim() || busy}>
                    {moving === "new" ? <Loader2 size={15} className="me-2 animate-spin" /> : <Plus size={15} className="me-2" />}
                    {copy("Create & file", "أنشئ واحفظ")}
                  </Button>
                  <Button type="button" variant="ghost" className="h-11 rounded-full" onClick={() => { setCreating(false); setNewTitle(""); }}>
                    {copy("Cancel", "إلغاء")}
                  </Button>
                </form>
              )}
              {!choices.length && !creating && (
                <p className="mt-2 text-xs text-muted-foreground">{copy("No subjects yet. Create one and your idea goes straight into it.", "لا توجد مواضيع بعد. أنشئ موضوعًا وستُحفظ فكرتك فيه مباشرة.")}</p>
              )}
            </div>
          )}
        </div>
        )}

        {(error || (record.status !== "synced" && record.error)) && (
          <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" role="status">
            {error || record.error}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-1 border-t pt-4">
          <Button size="sm" variant="ghost" className="h-9" onClick={() => setListening((value) => !value)} aria-expanded={listening}>
            <Headphones size={15} className="me-1.5" />{listening ? copy("Hide audio", "إخفاء الصوت") : copy("Listen", "استمع")}
          </Button>
          {record.status !== "synced" && (
            <Button size="sm" variant="ghost" className="h-9" disabled={busy || !online} onClick={() => void sync(true)}>
              {syncing ? <Loader2 size={15} className="me-1.5 animate-spin" /> : <CloudUpload size={15} className="me-1.5" />}
              {copy("Upload now", "ارفع الآن")}
            </Button>
          )}
          {record.interrupted && (
            <span className="ms-1 rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              {copy("Recovered after an interruption", "استُرد بعد انقطاع")}
            </span>
          )}
        </div>
        {listening && (
          <div className="mt-3 space-y-3 rounded-2xl bg-muted/40 p-4">
            {audioUrl && (
              <audio controls autoPlay src={audioUrl} className="w-full" aria-label={copy("Original recording", "التسجيل الأصلي")} />
            )}
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {audioUrl && (
                <a
                  className="inline-flex items-center gap-1.5 text-primary hover:underline"
                  download={`${record.title.replace(/[<>:"/\\|?*]/g, "-")}.${record.mimeType.includes("mp4") ? "m4a" : "webm"}`}
                  href={audioUrl}
                >
                  <Download size={14} />{copy("Download audio", "تنزيل الصوت")}
                </a>
              )}
              {record.transcript && (
                <a
                  className="inline-flex items-center gap-1.5 text-primary hover:underline"
                  download="transcript.txt"
                  href={`data:text/plain;charset=utf-8,${encodeURIComponent(record.transcript)}`}
                >
                  <FileText size={14} />{copy("Download text", "تنزيل النص")}
                </a>
              )}
              {record.status === "synced" && (
                <button type="button" className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-destructive" disabled={busy} onClick={() => setRemove(true)}>
                  <Trash2 size={14} />{copy("Remove from this device", "إزالة من هذا الجهاز")}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={remove} onOpenChange={setRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy("Remove this device copy?", "إزالة نسخة الجهاز؟")}</AlertDialogTitle>
            <AlertDialogDescription>
              {copy(
                "The idea stays in its notebook with its audio. This only removes the backup kept in this browser.",
                "تبقى الفكرة في دفترها مع صوتها. يُزال فقط النسخ الاحتياطي المحفوظ في هذا المتصفح.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{copy("Keep it", "احتفظ بها")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void recordingStore
                  .remove(record.id)
                  .then(refresh)
                  .catch(() => setError(copy("Couldn't remove the local copy.", "تعذر حذف النسخة المحلية.")));
              }}
            >
              {copy("Remove device copy", "إزالة نسخة الجهاز")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}

export default function RecorderPage() {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const { records, stage, ready, error, start, online, rescue, retryRescue } = useRecorder();
  const { data: subjects = [] } = useListSubjects();
  const [prefs, setPrefs] = usePrefs();
  const [filter, setFilter] = useState<"sort" | "filed" | "all">("sort");
  const autostart = useRef(false);

  const inboxIds = useMemo(
    () => new Set(subjects.filter((subject) => INBOX_TITLES.includes(subject.title)).map((subject) => subject.id)),
    [subjects],
  );
  const choices = useMemo(
    () => [...subjects]
      .filter((subject) => !inboxIds.has(subject.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [subjects, inboxIds],
  );
  // A remembered subject that was deleted falls back to the inbox.
  const destinationId = prefs.subjectId !== null && choices.some((subject) => subject.id === prefs.subjectId) ? prefs.subjectId : null;

  const finished = records.filter((record) => record.status !== "recording");
  const isFiled = (record: LocalRecording) => record.destination === "library" || record.subjectId !== null && !inboxIds.has(record.subjectId) && subjects.some((subject) => subject.id === record.subjectId);
  const toSort = finished.filter((record) => !isFiled(record));
  const filed = finished.filter(isFiled);
  const shown = filter === "sort" ? toSort : filter === "filed" ? filed : finished;
  const pending = finished.filter((record) => record.status === "saved").length;

  const begin = () => void start(destinationId, prefs.limit, { language: prefs.language, autoTranscribe: prefs.autoTranscribe });

  useEffect(() => {
    if (!ready || autostart.current || new URLSearchParams(location.search).get("start") !== "1") return;
    autostart.current = true;
    // Remove the trigger so refresh never silently starts another recording.
    const url = new URL(location.href);
    url.searchParams.delete("start");
    history.replaceState(history.state, "", url);
    begin();
  }, [ready]);

  return (
    <main className="mx-auto max-w-4xl px-4 pb-28 pt-2 sm:px-8">

      <div className="flex items-center justify-between gap-3">
        <Link href="/library" className="inline-flex items-center gap-2 py-3 text-sm font-medium text-primary hover:underline">
          <Headphones size={16} />
          {copy("Open the audio library", "افتح مكتبة الصوت")}
        </Link>
        {!online && (
          <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <WifiOff size={14} />
            {copy("Offline · recording still works", "غير متصل · التسجيل يعمل")}
          </span>
        )}
      </div>

      <section className="relative mt-3 overflow-hidden rounded-[2rem] border bg-gradient-to-b from-primary/[0.07] via-card to-card px-5 pb-8 pt-10 text-center shadow-sm sm:px-10 sm:pt-12">
        <div className="pointer-events-none absolute -top-32 left-1/2 h-64 w-[36rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" aria-hidden="true" />
        <p className="relative text-xs font-semibold uppercase tracking-[0.2em] text-primary/80">
          {copy("Voice capture", "التقاط صوتي")}
        </p>
        <h1 className="relative mt-3 text-4xl font-medium sm:text-5xl">
          {copy("What's on your mind?", "ما الذي يدور في ذهنك؟")}
        </h1>
        <p className="relative mx-auto mt-3 max-w-md text-[15px] leading-7 text-muted-foreground">
          {copy("Tap once and speak. Your words become text, ready to file under any subject.", "اضغط مرة وتحدّث. تتحول كلماتك إلى نص جاهز للحفظ في أي موضوع.")}
        </p>

        <div className="relative mx-auto mt-9 grid h-44 w-44 place-items-center">
          {ready && !rescue && <span className="absolute inset-0 animate-[ping_2.6s_cubic-bezier(0,0,0.2,1)_infinite] rounded-full bg-primary/15 motion-reduce:animate-none" aria-hidden="true" />}
          <span className="absolute inset-3 rounded-full bg-primary/10" aria-hidden="true" />
          <button
            type="button"
            aria-label={copy("Start recording", "بدء التسجيل")}
            disabled={!ready || stage !== "idle" || !!rescue}
            onClick={begin}
            className="relative grid h-32 w-32 place-items-center rounded-full bg-primary text-primary-foreground shadow-xl shadow-primary/30 transition hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30"
          >
            {stage === "starting" ? <Loader2 size={44} className="animate-spin" /> : <Mic size={52} strokeWidth={1.5} />}
          </button>
        </div>
        <p className="relative mt-5 text-lg font-semibold" role="status">
          {stage === "starting" ? copy("Opening the microphone…", "جارٍ فتح الميكروفون…") : copy("Tap to record", "اضغط للتسجيل")}
        </p>
        <p className="relative mt-1 text-xs text-muted-foreground">
          {copy("or press Alt + R", "أو اضغط Alt + R")}
        </p>

        <div className="relative mx-auto mt-8 flex max-w-2xl flex-wrap items-center justify-center gap-2">
          <OptionPill
            icon={destinationId !== null ? <FolderCheck size={16} /> : <Inbox size={16} />}
            label={copy("Save to", "احفظ في")}
            value={destinationId ?? "inbox"}
            disabled={stage !== "idle"}
            onChange={(event) => setPrefs({ subjectId: event.target.value === "inbox" ? null : Number(event.target.value) })}
          >
            <option value="inbox">{copy("Audio library · add to a subject later", "مكتبة الصوت · أضفها لموضوع لاحقًا")}</option>
            {choices.map((subject) => <option key={subject.id} value={subject.id}>{subject.title}</option>)}
          </OptionPill>
          <OptionPill
            icon={<Globe size={16} />}
            label={copy("Spoken language", "اللغة المنطوقة")}
            value={prefs.language}
            disabled={stage !== "idle"}
            onChange={(event) => setPrefs({ language: event.target.value as SpokenLanguage })}
          >
            <option value="auto">{copy("Arabic or English", "العربية أو الإنجليزية")}</option>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </OptionPill>
          <OptionPill
            icon={<Timer size={16} />}
            label={copy("Stop automatically after", "توقف تلقائيًا بعد")}
            value={prefs.limit}
            disabled={stage !== "idle"}
            onChange={(event) => setPrefs({ limit: Number(event.target.value) })}
          >
            {LIMITS.map((value) => (
              <option key={value} value={value}>{copy("Up to", "حتى")} {limitLabel(value, copy)}</option>
            ))}
          </OptionPill>
          <label className="inline-flex h-11 cursor-pointer items-center gap-2.5 rounded-full border bg-card px-4 text-sm font-medium shadow-sm">
            <input
              type="checkbox"
              role="switch"
              className="peer sr-only"
              checked={prefs.autoTranscribe}
              disabled={stage !== "idle"}
              onChange={(event) => setPrefs({ autoTranscribe: event.target.checked })}
            />
            <span className="relative h-5 w-9 rounded-full bg-muted-foreground/30 transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40 after:absolute after:start-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-4 rtl:peer-checked:after:-translate-x-4" aria-hidden="true" />
            {copy("Auto text", "نص تلقائي")}
          </label>
        </div>

        <ol className="relative mx-auto mt-9 grid max-w-2xl grid-cols-3 gap-2 border-t pt-6 text-start">
          {[
            [<Mic size={16} key="i" />, copy("Speak", "تحدّث"), copy("Hands stay on the wheel", "يداك على المقود")],
            [<Sparkles size={16} key="i" />, copy("Get text", "احصل على النص"), copy("Arabic or English", "بالعربية أو الإنجليزية")],
            [<FolderCheck size={16} key="i" />, copy("File it", "صنّفها"), copy("One tap, when parked", "بلمسة عند التوقف")],
          ].map(([icon, title, detail], index) => (
            <li key={index} className="flex flex-col items-center gap-1.5 text-center sm:flex-row sm:items-start sm:gap-3 sm:text-start">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">{icon}</span>
              <span>
                <span className="block text-sm font-semibold">{title}</span>
                <span className="block text-xs leading-5 text-muted-foreground">{detail}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      {error && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" role="alert">
          <span className="flex-1">{error}</span>
          {!ready && (
            <Button variant="outline" onClick={() => location.reload()}>{copy("Retry storage", "إعادة محاولة التخزين")}</Button>
          )}
        </div>
      )}
      {rescue && (
        <div className="mt-4 rounded-2xl border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
          <p className="mb-3 font-medium">{copy("Keep this page open until you rescue the audio.", "أبقِ الصفحة مفتوحة حتى تحفظ نسخة الصوت.")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild>
              <a href={rescue.url} download={`rescue.${rescue.blob.type.includes("mp4") ? "m4a" : "webm"}`}>
                <Download size={15} className="me-2" />{copy("Download rescue recording", "تنزيل التسجيل الاحتياطي")}
              </a>
            </Button>
            <Button variant="outline" onClick={() => void retryRescue()}>{copy("Retry device save", "إعادة الحفظ على الجهاز")}</Button>
          </div>
        </div>
      )}

      <section className="mt-12">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl">{copy("Your voice notes", "ملاحظاتك الصوتية")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {toSort.length
                ? copy(`${toSort.length} waiting for a subject. Tap one to file it.`, `${toSort.length} بانتظار موضوع. اضغط على موضوع لحفظها.`)
                : finished.length
                  ? copy("Everything is filed. Nice and tidy.", "كل شيء مصنّف ومرتب.")
                  : copy("Your recordings will appear here, ready to sort.", "ستظهر تسجيلاتك هنا جاهزة للتصنيف.")}
              {pending > 0 && ` · ${copy(`${pending} uploading`, `${pending} قيد الرفع`)}`}
            </p>
          </div>
          <div className="flex rounded-full border bg-card p-1 shadow-sm" role="tablist" aria-label={copy("Filter voice notes", "تصفية الملاحظات")}>
            {([
              ["sort", copy("To sort", "للتصنيف"), toSort.length],
              ["filed", copy("Filed", "مصنّفة"), filed.length],
              ["all", copy("All", "الكل"), finished.length],
            ] as const).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={filter === value}
                onClick={() => setFilter(value)}
                className={`h-9 rounded-full px-4 text-sm font-medium transition-colors ${filter === value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                {label} <span className="ms-0.5 opacity-70">{count}</span>
              </button>
            ))}
          </div>
        </div>
        {shown.length ? (
          <div className="space-y-5">
            {shown.map((record) => (
              <RecordingCard key={record.id} record={record} subjects={subjects} inboxIds={inboxIds} />
            ))}
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed px-6 py-12 text-center">
            <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary">
              {filter === "sort" && finished.length ? <CheckCircle2 size={26} /> : <Mic size={26} />}
            </span>
            <p className="font-serif text-xl">
              {filter === "sort" && finished.length
                ? copy("All sorted", "كل شيء مصنّف")
                : filter === "filed"
                  ? copy("Nothing filed yet", "لا شيء مصنّف بعد")
                  : copy("Your next idea belongs here", "هنا مكان فكرتك القادمة")}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {filter === "sort" && finished.length
                ? copy("Every voice note has a subject.", "كل ملاحظة صوتية لها موضوع.")
                : copy("Tap the microphone above and say what you're thinking.", "اضغط على الميكروفون وقل ما تفكر فيه.")}
            </p>
          </div>
        )}
      </section>

      <details className="group mt-12 rounded-3xl border bg-card px-5 py-4 shadow-sm open:pb-5 sm:px-6">
        <summary className="flex cursor-pointer list-none items-center gap-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
          <Lightbulb size={18} className="text-accent" />
          {copy("Tips for capturing on the go", "نصائح للتسجيل أثناء التنقل")}
          <ChevronDown size={16} className="ms-auto text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <ul className="mt-4 space-y-4 text-sm leading-6 text-muted-foreground">
          <li>
            <strong className="text-foreground">{copy("Say the subject first. ", "قل اسم الموضوع أولًا. ")}</strong>
            {copy("Start with “Save this under Education. My idea is…” and that subject is suggested at the top of the card.", "ابدأ بـ «احفظ في التعليم. فكرتي هي…» وسيظهر الموضوع مقترحًا أعلى البطاقة.")}
          </li>
          <li>
            <strong className="text-foreground">{copy("One-tap start. ", "بدء بلمسة واحدة. ")}</strong>
            {copy("Add this link to your home screen or a phone shortcut to open the app already recording: ", "أضف هذا الرابط إلى الشاشة الرئيسية أو اختصار في الهاتف ليفتح التطبيق ويبدأ التسجيل مباشرة: ")}
            <a className="text-primary underline" href={`${import.meta.env.BASE_URL}record?start=1`}>{copy("quick-start link", "رابط البدء السريع")}</a>.
          </li>
          <li>
            <strong className="text-foreground">{copy("Drive safely. ", "قُد بأمان. ")}</strong>
            {copy("Keep the phone mounted and the page open. The screen stays awake while recording. File your notes when parked.", "ثبّت الهاتف وأبقِ الصفحة مفتوحة. تبقى الشاشة مضاءة أثناء التسجيل. صنّف ملاحظاتك عند التوقف.")}
          </li>
          <li>
            <strong className="text-foreground">{copy("Nothing is lost. ", "لا شيء يضيع. ")}</strong>
            {copy("Audio is saved on this device first, then uploaded when you're online. Phone calls or locking the screen can stop a recording early.", "يُحفظ الصوت على الجهاز أولًا ثم يُرفع عند الاتصال. قد تؤدي المكالمات أو قفل الشاشة إلى إيقاف التسجيل مبكرًا.")}
          </li>
        </ul>
      </details>
    </main>
  );
}
