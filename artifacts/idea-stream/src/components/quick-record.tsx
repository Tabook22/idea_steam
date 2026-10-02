import { Link } from "wouter";
import {
  ArrowUpRight,
  CheckCircle2,
  CloudUpload,
  FolderCheck,
  Globe,
  Inbox,
  Loader2,
  Mic,
  TriangleAlert,
} from "lucide-react";
import { useListSubjects } from "@workspace/api-client-react";
import { useRecorder } from "@/components/recorder-provider";
import { OptionPill } from "@/components/option-pill";
import { useLanguage } from "@/lib/i18n";
import { useRecorderPrefs, type SpokenLanguage } from "@/lib/recorder-prefs";

const INBOX_TITLES = ["Idea inbox", "صندوق الأفكار"];

/** Starts a capture with the remembered language and limit; the subject can be overridden. */
export function useStartRecording() {
  const { start } = useRecorder();
  const [prefs] = useRecorderPrefs();
  const { data: subjects = [] } = useListSubjects();
  // A remembered subject that was deleted falls back to the inbox.
  const remembered = prefs.subjectId !== null && subjects.some((subject) => subject.id === prefs.subjectId)
    ? prefs.subjectId
    : null;
  return (subjectId: number | null = remembered) =>
    start(subjectId, prefs.limit, { language: prefs.language, autoTranscribe: prefs.autoTranscribe });
}

/** The REC mark: a glowing red button with a microphone and a "REC" tag. */
function RecButton({ size = "lg", disabled, onClick, label }: {
  size?: "lg" | "fab"; disabled?: boolean; onClick: () => void; label: string;
}) {
  const large = size === "lg";
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`group relative grid shrink-0 place-items-center rounded-full text-white transition active:scale-95 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-500/30 ${
        large ? "h-32 w-32" : "h-[4.5rem] w-[4.5rem]"
      }`}
    >
      {!disabled && (
        <span className="absolute inset-0 animate-[ping_2.4s_cubic-bezier(0,0,0.2,1)_infinite] rounded-full bg-red-500/25 motion-reduce:animate-none" aria-hidden="true" />
      )}
      <span className="absolute inset-0 rounded-full bg-gradient-to-br from-rose-400 via-red-500 to-red-700 shadow-[0_12px_32px_-8px_rgba(220,38,38,0.65)] transition-transform group-hover:scale-105" aria-hidden="true" />
      <span className={`absolute rounded-full border-2 border-white/30 ${large ? "inset-2.5" : "inset-1.5"}`} aria-hidden="true" />
      <span className="relative flex flex-col items-center">
        <Mic size={large ? 42 : 26} strokeWidth={1.8} />
        <span className={`mt-1 inline-flex items-center gap-1 rounded-full bg-white/95 font-bold tracking-[0.14em] text-red-600 ${large ? "px-2 py-0.5 text-[11px]" : "px-1.5 text-[9px]"}`}>
          <span className={`rounded-full bg-red-600 ${large ? "h-1.5 w-1.5" : "h-1 w-1"}`} />REC
        </span>
      </span>
    </button>
  );
}

/** Live progress of the newest voice note: upload, text, and where it was filed. */
function LatestNote() {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const { records, syncingId, transcribingId, online } = useRecorder();
  const { data: subjects = [] } = useListSubjects();
  const record = records.find((item) => item.status !== "recording");
  if (!record) return null;
  const subject = subjects.find((item) => item.id === record.subjectId);
  const subjectName = subject?.title ?? copy("Idea inbox", "صندوق الأفكار");
  const inInbox = !subject || INBOX_TITLES.includes(subject.title);
  const waitingForText = !record.transcript && record.autoTranscribe !== false && !record.transcriptionStatus;

  let icon = <Loader2 size={18} className="animate-spin text-primary" />;
  let title: string;
  if (record.destination === "library") {
    const done = record.status === "synced";
    return (
      <div className="border-t bg-background/60 px-5 py-4 sm:px-7" role="status" aria-live="polite">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{copy("Latest voice note", "آخر ملاحظة صوتية")}</p>
        <p className="mt-2 flex items-center gap-2 text-sm font-medium">
          {done ? <CheckCircle2 size={18} className="text-primary" /> : <Loader2 size={18} className="animate-spin text-primary" />}
          {done ? copy("Saved to your audio library", "حُفظت في مكتبة الصوت") : copy("Saving to your audio library…", "جارٍ الحفظ في مكتبة الصوت…")}
        </p>
        <Link href="/library" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          {copy("Open the audio library", "افتح مكتبة الصوت")}<ArrowUpRight size={14} />
        </Link>
      </div>
    );
  }
  if (record.status !== "synced") {
    icon = <CloudUpload size={18} className="text-amber-600" />;
    title = syncingId === record.id
      ? copy("Uploading your voice note…", "جارٍ رفع ملاحظتك الصوتية…")
      : online
        ? copy("Saved on this phone. Uploading shortly…", "محفوظة على الهاتف. ستُرفع قريبًا…")
        : copy("Saved on this phone. It uploads when you're online.", "محفوظة على الهاتف. ستُرفع عند الاتصال.");
    if (syncingId === record.id) icon = <Loader2 size={18} className="animate-spin text-primary" />;
  } else if (transcribingId === record.id || (waitingForText && online)) {
    title = copy(`Converting to text for “${subjectName}”…`, `جارٍ التحويل إلى نص في «${subjectName}»…`);
  } else if (record.transcript) {
    icon = <CheckCircle2 size={18} className="text-primary" />;
    title = inInbox
      ? copy("Saved as text in your Idea inbox", "حُفظت نصًا في صندوق الأفكار")
      : copy(`Saved as text in “${subjectName}”`, `حُفظت نصًا في «${subjectName}»`);
  } else {
    icon = <TriangleAlert size={18} className="text-amber-600" />;
    title = record.transcriptionStatus
      ? copy("Audio saved, but it couldn't be turned into text yet.", "الصوت محفوظ لكن لم يتحول إلى نص بعد.")
      : copy(`Audio saved in “${subjectName}”`, `الصوت محفوظ في «${subjectName}»`);
  }

  return (
    <div className="border-t bg-background/60 px-5 py-4 sm:px-7" role="status" aria-live="polite">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {copy("Latest voice note", "آخر ملاحظة صوتية")}
      </p>
      <div className="mt-2 flex items-start gap-3">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{title}</p>
          {record.transcript && (
            <p dir="auto" className="mt-1 line-clamp-2 font-serif text-[15px] leading-6 text-muted-foreground">
              “{record.transcript}”
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {record.ideaId && record.subjectId && !inInbox && (
              <Link href={`/subjects/${record.subjectId}#idea-${record.ideaId}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                {copy("Open in subject", "افتحها في الموضوع")}<ArrowUpRight size={14} />
              </Link>
            )}
            <Link href="/record" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              {inInbox && record.transcript
                ? copy("Choose a subject", "اختر موضوعًا")
                : !record.transcript && record.transcriptionStatus
                  ? copy("Fix it in Voice notes", "عالجها في الملاحظات الصوتية")
                  : copy("All voice notes", "كل الملاحظات الصوتية")}
              <ArrowUpRight size={14} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Front-page capture: choose a subject, tap REC, and the words are saved there as text. */
export function QuickRecord() {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const { stage, ready, rescue, error } = useRecorder();
  const { data: subjects = [] } = useListSubjects();
  const [prefs, setPrefs] = useRecorderPrefs();
  const record = useStartRecording();
  const choices = [...subjects]
    .filter((subject) => !INBOX_TITLES.includes(subject.title))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const selected = prefs.subjectId !== null && choices.some((subject) => subject.id === prefs.subjectId) ? prefs.subjectId : null;

  return (
    <section
      id="quick-record"
      aria-label={copy("Record a voice note", "سجّل ملاحظة صوتية")}
      className="mb-8 overflow-hidden rounded-[1.75rem] border bg-card shadow-sm"
    >
      <div className="relative flex flex-col items-center gap-6 bg-gradient-to-br from-primary/[0.08] via-card to-rose-50/60 px-5 py-7 text-center sm:flex-row sm:items-center sm:gap-8 sm:px-7 sm:text-start dark:to-red-950/10">
        <div className="order-2 min-w-0 flex-1 sm:order-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-red-600">
            {copy("Voice note", "ملاحظة صوتية")}
          </p>
          <h2 className="mt-2 text-2xl font-medium leading-tight sm:text-3xl">
            {copy("Speak it. We'll write it down.", "تحدّث، ونحن نكتب.")}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {copy("Tap REC and talk. Your words are turned into text and saved in the subject you choose.", "اضغط REC وتحدّث. تتحول كلماتك إلى نص وتُحفظ في الموضوع الذي تختاره.")}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
            <OptionPill
              icon={selected !== null ? <FolderCheck size={16} /> : <Inbox size={16} />}
              label={copy("Save to subject", "احفظ في موضوع")}
              value={selected ?? "inbox"}
              disabled={stage !== "idle"}
              onChange={(event) => setPrefs({ subjectId: event.target.value === "inbox" ? null : Number(event.target.value) })}
            >
              <option value="inbox">{copy("Inbox · choose later", "الصندوق · اختر لاحقًا")}</option>
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
          </div>
          {!prefs.autoTranscribe && (
            <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
              {copy("Automatic text is off. ", "التحويل التلقائي إلى نص متوقف. ")}
              <button type="button" className="font-medium underline" onClick={() => setPrefs({ autoTranscribe: true })}>
                {copy("Turn it on", "شغّله")}
              </button>
            </p>
          )}
          {error && stage === "idle" && <p className="mt-3 text-xs text-destructive" role="alert">{error}</p>}
        </div>
        <div className="order-1 flex flex-col items-center gap-2 sm:order-2">
          <RecButton
            label={copy("Start recording", "بدء التسجيل")}
            disabled={!ready || stage !== "idle" || !!rescue}
            onClick={() => void record()}
          />
          <span className="text-sm font-semibold">{copy("Tap to record", "اضغط للتسجيل")}</span>
        </div>
      </div>
      <LatestNote />
    </section>
  );
}
