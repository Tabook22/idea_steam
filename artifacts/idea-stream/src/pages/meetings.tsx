import { useMemo } from "react";
import { Link } from "wouter";
import { ArrowLeft, CalendarClock, CloudUpload, ListChecks, Loader2, Mic, TriangleAlert, Users } from "lucide-react";
import { getListMeetingsQueryKey, useListMeetings, type MeetingSummary } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { openMeetingStart } from "@/components/meeting-start";
import { useRecorder } from "@/components/recorder-provider";
import { useLanguage } from "@/lib/i18n";
import { clock } from "@/lib/meeting-view";

export function stageLabel(meeting: Pick<MeetingSummary, "status" | "stage">, copy: (en: string, ar: string) => string) {
  if (meeting.status === "failed") return copy("Couldn't finish", "لم يكتمل");
  if (meeting.status === "ready") return copy("Minutes ready", "المحضر جاهز");
  const part = meeting.stage?.match(/^transcribing (\d+)\/(\d+)$/);
  if (part) return copy(`Writing down who said what… part ${part[1]} of ${part[2]}`, `جارٍ تدوين من قال ماذا… الجزء ${part[1]} من ${part[2]}`);
  if (meeting.stage === "transcribing") return copy("Writing down who said what…", "جارٍ تدوين من قال ماذا…");
  if (meeting.stage === "writing") return copy("Writing the minutes…", "جارٍ كتابة المحضر…");
  return copy("Getting ready…", "جارٍ التجهيز…");
}

export default function MeetingsPage() {
  const { isArabic, language } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const { data: meetings = [], isLoading } = useListMeetings({
    query: { queryKey: getListMeetingsQueryKey(), refetchInterval: (query) => ((query.state.data ?? []).some((meeting) => meeting.status === "processing") ? 5000 : false) },
  });
  const { records } = useRecorder();
  // Meetings still on this phone (not uploaded yet).
  const waiting = records.filter((record) => record.meeting && record.status !== "synced" && record.status !== "recording");
  const date = useMemo(() => new Intl.DateTimeFormat(language, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }), [language]);

  return (
    <main id="main-content" className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2 sm:px-6">
      <Link href="/app" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft size={15} className="rtl:rotate-180" />{copy("Home", "الرئيسية")}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 font-serif text-3xl"><CalendarClock className="text-sky-600" size={28} />{copy("Meetings", "الاجتماعات")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{copy("Record a meeting; get the minutes, who said what, and the action items.", "سجّل اجتماعًا؛ واحصل على المحضر ومن قال ماذا والمهام.")}</p>
        </div>
        <Button className="h-11 rounded-full bg-gradient-to-br from-rose-500 to-red-700 px-5 text-white" onClick={() => openMeetingStart()}>
          <Mic size={17} className="me-2" />{copy("Start a meeting", "ابدأ اجتماعًا")}
        </Button>
      </div>

      <ul className="mt-6 space-y-3">
        {waiting.map((record) => (
          <li key={record.id} className="flex items-center gap-3 rounded-2xl border border-dashed bg-card/60 p-4">
            <CloudUpload size={20} className="shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p dir="auto" className="truncate font-medium">{record.meeting!.title}</p>
              <p className="text-xs text-muted-foreground">{copy("Saved on this phone · uploading…", "محفوظ على الهاتف · جارٍ الرفع…")} · {clock(record.durationSeconds)}</p>
            </div>
          </li>
        ))}
        {meetings.map((meeting) => (
          <li key={meeting.id}>
            <Link href={`/meetings/${meeting.id}`} className="block rounded-2xl border bg-card p-4 shadow-sm transition hover:border-primary/40 hover:shadow-md">
              <div className="flex items-start gap-3">
                <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${meeting.status === "ready" ? "bg-sky-500/10 text-sky-700 dark:text-sky-300" : meeting.status === "failed" ? "bg-red-500/10 text-red-600" : "bg-primary/10 text-primary"}`}>
                  {meeting.status === "processing" ? <Loader2 size={20} className="animate-spin" /> : meeting.status === "failed" ? <TriangleAlert size={20} /> : <CalendarClock size={20} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p dir="auto" className="font-medium leading-6">{meeting.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {date.format(new Date(meeting.createdAt))}{meeting.durationSeconds ? ` · ${clock(meeting.durationSeconds)}` : ""}
                    {meeting.subjectTitle && <> · <span dir="auto">{meeting.subjectTitle}</span></>}
                  </p>
                  {meeting.summary ? (
                    <p dir="auto" className="mt-2 line-clamp-2 text-sm leading-6 text-foreground/80">{meeting.summary}</p>
                  ) : (
                    <p className={`mt-2 text-sm ${meeting.status === "failed" ? "text-red-600" : "text-primary"}`}>{stageLabel(meeting, copy)}</p>
                  )}
                  {meeting.status === "ready" && (
                    <p className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                      <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 font-medium"><Users size={11} />{copy(`${meeting.speakerCount} speakers`, `${meeting.speakerCount} متحدثين`)}</span>
                      {meeting.actionCount > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary"><ListChecks size={11} />{copy(`${meeting.actionCount} action items`, `${meeting.actionCount} مهام`)}</span>}
                    </p>
                  )}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {!isLoading && !meetings.length && !waiting.length && (
        <div className="mt-10 flex flex-col items-center rounded-3xl border border-dashed px-6 py-12 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-2xl bg-sky-500/10 text-3xl">🗓️</span>
          <p className="mt-4 font-serif text-xl">{copy("Your first meeting", "اجتماعك الأول")}</p>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            {copy("Put your phone in the middle of the table and tap Start. Mark decisions and actions as they happen; the minutes are written for you.",
              "ضع هاتفك في منتصف الطاولة واضغط ابدأ. علّم القرارات والمهام لحظة حدوثها؛ ويُكتب المحضر عنك.")}
          </p>
        </div>
      )}
    </main>
  );
}
