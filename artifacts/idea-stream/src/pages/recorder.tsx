import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  CloudUpload,
  Download,
  FolderInput,
  Mic,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Square,
  WifiOff,
} from "lucide-react";
import { useListSubjects, updateIdea } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { recordingStore, useRecorder } from "@/components/recorder-provider";
import type { LocalRecording } from "@/lib/recording-store";
import { spokenSubject } from "@/lib/recording-utils";
import { useLanguage } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
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

function RecordingCard({ record }: { record: LocalRecording }) {
  const { isArabic, language } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const { refresh, sync, syncingId, stage } = useRecorder();
  const { data: subjects = [] } = useListSubjects();
  const queryClient = useQueryClient();
  const [audioUrl, setAudioUrl] = useState<string>();
  const [expanded, setExpanded] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState("");
  const [remove, setRemove] = useState(false);
  const busy = moving || syncingId === record.id || stage !== "idle";
  const suggested = record.transcript
    ? spokenSubject(record.transcript, subjects)
    : null;
  useEffect(() => {
    let url: string | undefined;
    let canceled = false;
    if (expanded)
      void recordingStore
        .audio(record.id)
        .then((blob) => {
          if (!canceled) {
            url = URL.createObjectURL(blob);
            setAudioUrl(url);
          }
        })
        .catch(() =>
          setError(
            copy("Couldn't read this device copy.", "تعذر قراءة نسخة الجهاز."),
          ),
        );
    return () => {
      canceled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [expanded, record.id]);

  async function move(value: string) {
    setMoving(true);
    setError("");
    try {
      const subjectId = value === "inbox" ? null : Number(value);
      if (record.ideaId) {
        if (subjectId === null) return;
        await updateIdea(record.ideaId, { subjectId });
        await queryClient.invalidateQueries();
      }
      await recordingStore.patch(record.id, {
        subjectId,
        error: undefined,
        attempts: 0,
        nextRetryAt: 0,
      });
      await refresh();
    } catch {
      setError(
        copy(
          "Couldn't change the notebook. Your original is still saved.",
          "تعذر تغيير الدفتر. التسجيل الأصلي محفوظ.",
        ),
      );
    } finally {
      setMoving(false);
    }
  }

  return (
    <article className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex gap-3 items-start">
        <div className="rounded-xl bg-primary/10 p-3 text-primary">
          <Mic size={19} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-sans text-base font-medium break-words">
            {record.title}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {new Intl.DateTimeFormat(language, {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(record.capturedAt))}{" "}
            · {Math.floor(record.durationSeconds / 60)}:
            {String(record.durationSeconds % 60).padStart(2, "0")} ·{" "}
            {(record.bytes / 1024 / 1024).toFixed(1)} MB
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-4 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5">
          <Smartphone size={13} />
          {copy("Saved on this device", "محفوظ على هذا الجهاز")}
        </span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 ${record.status === "synced" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}
        >
          {record.status === "synced" ? (
            <CheckCircle2 size={13} />
          ) : (
            <CloudUpload size={13} />
          )}
          {syncingId === record.id
            ? copy("Syncing…", "جارٍ المزامنة…")
            : record.status === "synced"
              ? copy("Synced to notebook", "تمت المزامنة مع الدفتر")
              : copy("Waiting to sync", "بانتظار المزامنة")}
        </span>
        {record.interrupted && (
          <span className="rounded-full bg-amber-50 px-3 py-1.5 text-amber-900">
            {copy("Recovered · check the audio", "تم الاسترداد · راجع الصوت")}
          </span>
        )}
      </div>
      <label className="mt-4 block text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5 mb-2">
          <FolderInput size={14} />
          {copy("Save under", "احفظ في")}
        </span>
        <select
          aria-label={copy(
            `Notebook for ${record.title}`,
            `دفتر ${record.title}`,
          )}
          value={record.subjectId ?? "inbox"}
          disabled={busy}
          onChange={(event) => void move(event.target.value)}
          className="w-full rounded-xl border bg-background px-3 py-3 text-sm text-foreground"
        >
          <option value="inbox" disabled={!!record.ideaId}>
            {copy("Decide later · Idea inbox", "اختر لاحقًا · صندوق الأفكار")}
          </option>
          {record.subjectId &&
            !subjects.some((s) => s.id === record.subjectId) && (
              <option value={record.subjectId}>
                {copy(
                  "Notebook unavailable — choose another",
                  "الدفتر غير متاح — اختر غيره",
                )}
              </option>
            )}
          {subjects.map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.title}
            </option>
          ))}
        </select>
      </label>
      {suggested && !record.subjectId && (
        <Button
          className="mt-2"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void move(String(suggested))}
        >
          {copy("Use spoken subject", "استخدم الموضوع المنطوق")}:{" "}
          {subjects.find((s) => s.id === suggested)?.title}
        </Button>
      )}
      {(error || record.error) && (
        <p className="mt-3 text-xs text-amber-800" role="status">
          {error ||
            copy(
              "Sync couldn't finish. Your audio is kept here; it will retry when this app is open and connected.",
              "لم تكتمل المزامنة. الصوت محفوظ هنا وستُعاد المحاولة عند فتح التطبيق واتصاله.",
            )}
        </p>
      )}
      {record.transcriptionStatus && record.transcriptionStatus !== "done" && (
        <p className="mt-3 text-xs text-muted-foreground">
          {copy(
            "Audio preserved. An automatic transcript wasn't available; you can add or edit the text in the notebook.",
            "الصوت محفوظ. لم يتوفر نص تلقائي؛ يمكنك إضافة النص أو تعديله في الدفتر.",
          )}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? copy("Hide details", "إخفاء التفاصيل")
            : copy("Listen & review", "استمع وراجع")}
        </Button>
        {record.status !== "synced" && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void sync(true)}
          >
            <RefreshCw size={14} className="me-2" />
            {copy("Retry sync", "إعادة المزامنة")}
          </Button>
        )}
        {record.ideaId && record.subjectId && (
          <Button size="sm" variant="ghost" asChild>
            <Link href={`/subjects/${record.subjectId}#idea-${record.ideaId}`}>
              {copy("Open idea", "فتح الفكرة")}
              <ArrowUpRight size={14} className="ms-2" />
            </Link>
          </Button>
        )}
      </div>
      {expanded && (
        <div className="mt-4 border-t pt-4 space-y-3">
          {audioUrl && (
            <>
              <audio
                controls
                src={audioUrl}
                className="w-full"
                aria-label={copy("Original recording", "التسجيل الأصلي")}
              />
              <a
                className="inline-flex items-center gap-2 text-xs text-primary underline"
                download={`${record.title.replace(/[<>:"/\\|?*]/g, "-")}.${record.mimeType.includes("mp4") ? "m4a" : "webm"}`}
                href={audioUrl}
              >
                <Download size={14} />
                {copy("Download original", "تنزيل الأصل")}
              </a>
            </>
          )}
          {record.transcript && (
            <p
              dir="auto"
              className="whitespace-pre-wrap text-sm leading-7 max-h-64 overflow-y-auto"
            >
              {record.transcript}
            </p>
          )}
          {record.status === "synced" && (
            <Button
              className="block"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setRemove(true)}
            >
              {copy("Remove device copy…", "إزالة نسخة الجهاز…")}
            </Button>
          )}
        </div>
      )}
      <AlertDialog open={remove} onOpenChange={setRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {copy("Remove this device copy?", "إزالة نسخة الجهاز؟")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {copy(
                "The synced idea stays in its notebook. This removes only the audio backup from this browser. Download it first if you want another copy.",
                "تبقى الفكرة المتزامنة في دفترها. ستُزال النسخة الصوتية الاحتياطية من هذا المتصفح فقط.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {copy("Keep it", "احتفظ بها")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void recordingStore
                  .remove(record.id)
                  .then(refresh)
                  .catch(() =>
                    setError(
                      copy(
                        "Couldn't remove the local copy.",
                        "تعذر حذف النسخة المحلية.",
                      ),
                    ),
                  );
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
  const {
    records,
    stage,
    seconds,
    ready,
    error,
    start,
    stop,
    online,
    rescue,
    retryRescue,
  } = useRecorder();
  const [filter, setFilter] = useState<"all" | "pending">("all");
  const [limit, setLimit] = useState(() => {
    const value = Number(new URLSearchParams(location.search).get("limit"));
    return [30, 60, 120, 300, 900].includes(value) ? value : 900;
  });
  const autostart = useRef(false);
  const pending = records.filter((record) => record.status === "saved").length;
  const completed = records.filter(
    (record) =>
      record.status !== "recording" &&
      (filter === "all" || record.status === "saved"),
  );
  useEffect(() => {
    if (
      !ready ||
      autostart.current ||
      new URLSearchParams(location.search).get("start") !== "1"
    )
      return;
    autostart.current = true;
    // Remove the trigger so refresh never silently starts another recording.
    const url = new URL(location.href);
    url.searchParams.delete("start");
    history.replaceState(history.state, "", url);
    void start(null, limit);
  }, [ready, start, limit]);
  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-8 py-6 pb-28">
      <Link
        href="/app"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground py-3"
      >
        <ArrowLeft size={16} className={isArabic ? "rotate-180" : ""} />
        {copy("My notebooks", "دفاتري")}
      </Link>
      <div className="mt-6 mb-8 flex flex-wrap justify-between items-end gap-4">
        <div>
          <p className="eyebrow">
            {copy(
              "CATCH THE THOUGHT. KEEP THE MOMENT.",
              "التقط الفكرة. واحفظ اللحظة.",
            )}
          </p>
          <h1 className="text-4xl sm:text-5xl font-medium">
            {copy("Record now.", "سجّل الآن.")}{" "}
            <em className="text-primary">
              {copy("Organize later.", "ونظّم لاحقًا.")}
            </em>
          </h1>
          <p className="mt-4 text-sm text-muted-foreground">
            {copy(
              "No title needed. No subject to choose. Just your idea.",
              "لا عنوان مطلوب ولا موضوع تختاره الآن. فقط فكرتك.",
            )}
          </p>
        </div>
        {!online && (
          <span className="flex items-center gap-2 text-sm rounded-full bg-amber-50 text-amber-900 px-4 py-2">
            <WifiOff size={16} />
            {copy("Offline · recording still works", "غير متصل · التسجيل يعمل")}
          </span>
        )}
      </div>
      <section className="grid md:grid-cols-[1.2fr_1fr] overflow-hidden rounded-3xl border bg-card shadow-sm">
        <div className="flex flex-col items-center justify-center p-8 sm:p-12 bg-primary/5">
          <p role="status" className="text-sm text-primary mb-5">
            {stage === "recording"
              ? copy(
                  "Listening. Your idea has a home.",
                  "أستمع. فكرتك في مكانها.",
                )
              : stage === "saving"
                ? copy("Saving to this device…", "جارٍ الحفظ على الجهاز…")
                : stage === "starting"
                  ? copy("Preparing microphone…", "جارٍ تجهيز الميكروفون…")
                  : copy(
                      "One tap. A little possibility.",
                      "لمسة واحدة. احتمال جديد.",
                    )}
          </p>
          <button
            aria-label={
              stage === "recording"
                ? copy("Stop and save recording", "إيقاف التسجيل وحفظه")
                : copy("Start recording", "بدء التسجيل")
            }
            disabled={
              !ready || stage === "starting" || stage === "saving" || !!rescue
            }
            onClick={() =>
              stage === "recording" ? stop() : void start(null, limit)
            }
            className={`h-36 w-36 rounded-full flex items-center justify-center shadow-xl transition-transform active:scale-95 disabled:opacity-50 ${stage === "recording" ? "bg-red-600 text-white ring-8 ring-red-100" : "bg-primary text-primary-foreground hover:scale-105"}`}
          >
            {stage === "recording" ? (
              <Square size={42} fill="currentColor" />
            ) : (
              <Mic size={50} strokeWidth={1.4} />
            )}
          </button>
          <p
            className="mt-6 font-mono text-4xl tabular-nums tracking-widest"
            role="timer"
          >
            {String(Math.floor(seconds / 60)).padStart(2, "0")}:
            {String(seconds % 60).padStart(2, "0")}
          </p>
          <p className="mt-3 text-sm font-medium">
            {stage === "recording"
              ? copy("Stop & save", "إيقاف وحفظ")
              : copy("Start recording", "بدء التسجيل")}
          </p>
          <label className="mt-6 text-xs text-muted-foreground flex items-center gap-2">
            {copy("Stop automatically after", "توقف تلقائيًا بعد")}
            <select
              aria-label={copy(
                "Automatic stop duration",
                "مدة التوقف التلقائي",
              )}
              value={limit}
              disabled={stage !== "idle"}
              onChange={(event) => setLimit(Number(event.target.value))}
              className="rounded-lg border bg-card p-2 text-foreground"
            >
              {[30, 60, 120, 300, 900].map((value) => (
                <option key={value} value={value}>
                  {value < 60
                    ? copy("30 seconds", "٣٠ ثانية")
                    : `${value / 60} ${copy("min", "دقيقة")}`}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="p-7 sm:p-9 flex flex-col justify-center gap-6">
          <div>
            <ShieldCheck className="text-primary mb-3" />
            <h2 className="text-xl">
              {copy("Saved before it's sorted.", "محفوظة قبل ترتيبها.")}
            </h2>
            <p className="text-sm text-muted-foreground leading-7 mt-2">
              {copy(
                "Audio is saved on this device first. When connected, the app uploads it to your Idea inbox and adds a transcript when available. Your local original stays here.",
                "يُحفظ الصوت على الجهاز أولًا. عند الاتصال يُرفع لصندوق الأفكار ويُضاف النص عند توفره. تبقى النسخة الأصلية هنا.",
              )}
            </p>
          </div>
          <div className="rounded-xl border bg-background p-4">
            <p className="text-sm font-medium">
              {copy(
                "Know the subject already? Say it.",
                "تعرف الموضوع؟ قل اسمه.",
              )}
            </p>
            <p className="text-sm text-primary mt-2">
              {copy(
                "“Save this under Education. My idea is…”",
                "«احفظ في التعليم. فكرتي هي…»",
              )}
            </p>
            <p className="text-xs leading-6 text-muted-foreground mt-2">
              {copy(
                "Use the exact notebook name at the beginning. A clear match is filed there after transcription; otherwise it stays in the inbox.",
                "قل اسم الدفتر بالضبط في البداية. تُنقل الفكرة عند وجود تطابق واضح بعد التفريغ، وإلا تبقى في الصندوق.",
              )}
            </p>
          </div>
          <p className="text-xs text-muted-foreground leading-6">
            {copy(
              "Keep this page open while recording. The app requests that the screen stay awake, but phone locks and background recording depend on your browser. Use screen controls only when parked.",
              "أبقِ الصفحة مفتوحة أثناء التسجيل. يحاول التطبيق إبقاء الشاشة مضاءة، لكن قفل الهاتف والتسجيل بالخلفية يعتمدان على المتصفح. استخدم الشاشة فقط أثناء التوقف.",
            )}
          </p>
        </div>
      </section>
      {error && (
        <div
          className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
          role="alert"
        >
          {error}
          {!ready && (
            <Button
              className="ms-3"
              variant="outline"
              onClick={() => location.reload()}
            >
              {copy("Retry storage", "إعادة محاولة التخزين")}
            </Button>
          )}
        </div>
      )}
      {rescue && (
        <div className="mt-4 rounded-xl border border-red-300 p-4">
          <p className="font-medium mb-3">
            {copy(
              "Keep this page open until you rescue the audio.",
              "أبقِ الصفحة مفتوحة حتى تحفظ نسخة الصوت.",
            )}
          </p>
          <a
            className="underline me-5"
            href={rescue.url}
            download={`rescue.${rescue.blob.type.includes("mp4") ? "m4a" : "webm"}`}
          >
            {copy("Download rescue recording", "تنزيل التسجيل الاحتياطي")}
          </a>
          <Button variant="outline" onClick={() => void retryRescue()}>
            {copy("Retry device save", "إعادة الحفظ على الجهاز")}
          </Button>
        </div>
      )}
      <div className="my-8 rounded-xl border bg-card px-5 py-4 text-sm">
        <strong>{copy("Faster next time", "أسرع في المرة القادمة")}</strong>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">
          {copy(
            "Alt + R starts or stops recording while this app is open. You can bookmark the quick-start link or use it in your phone's Open URL shortcut. Microphone permission is still required; automatic launch depends on the browser.",
            "يبدأ Alt + R التسجيل أو يوقفه أثناء فتح التطبيق. يمكنك حفظ رابط البدء السريع أو إضافته لاختصار فتح رابط في هاتفك. يلزم إذن الميكروفون، والبدء التلقائي يعتمد على المتصفح.",
          )}
        </p>
        <a
          className="inline-block mt-2 text-primary underline text-xs"
          href={`${import.meta.env.BASE_URL}record?start=1&limit=60`}
        >
          {copy(
            "Quick-start link · stop after 1 minute",
            "رابط البدء السريع · توقف بعد دقيقة",
          )}
        </a>
      </div>
      <section>
        <div className="flex justify-between flex-wrap gap-4 items-center mb-5">
          <div>
            <h2 className="text-2xl">{copy("Your recordings", "تسجيلاتك")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {copy(
                "Listen, choose a subject, and develop the idea when you're ready.",
                "استمع واختر الموضوع وطوّر الفكرة عندما تكون مستعدًا.",
              )}
            </p>
          </div>
          <div className="flex rounded-lg border p-1 bg-card">
            <Button
              size="sm"
              variant={filter === "all" ? "secondary" : "ghost"}
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              {copy("All", "الكل")}
            </Button>
            <Button
              size="sm"
              variant={filter === "pending" ? "secondary" : "ghost"}
              aria-pressed={filter === "pending"}
              onClick={() => setFilter("pending")}
            >
              {copy("Waiting to sync", "بانتظار المزامنة")} ({pending})
            </Button>
          </div>
        </div>
        {completed.length ? (
          <div className="grid sm:grid-cols-2 gap-4">
            {completed.map((record) => (
              <RecordingCard key={record.id} record={record} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed p-9 text-center text-muted-foreground">
            <Mic className="mx-auto mb-3" />
            <p>
              {filter === "pending"
                ? copy(
                    "Nothing waiting to sync.",
                    "لا تسجيلات بانتظار المزامنة.",
                  )
                : copy(
                    "Your next idea belongs here.",
                    "هنا مكان فكرتك القادمة.",
                  )}
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
