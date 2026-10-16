import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Bell, CalendarClock, CalendarDays, CalendarPlus, CloudUpload, ListChecks, Loader2, MapPin, Mic, Search, TriangleAlert, Users, X } from "lucide-react";
import { CALENDAR_CHANGED, openEventEditor } from "@/components/event-editor";
import { addDays, getCalendar, isRecordable, placeLinks, startOfDay, type CalendarEvent } from "@/lib/calendar-api";
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

  // Scheduled meetings still to come (and any from earlier today not yet recorded).
  const [scheduled, setScheduled] = useState<CalendarEvent[]>([]);
  const loadScheduled = useCallback(() => {
    void getCalendar(startOfDay(new Date()), addDays(new Date(), 60))
      .then((data) => setScheduled(data.events.filter((event) => event.kind === "meeting" && !event.meetingId)))
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadScheduled();
    window.addEventListener(CALENDAR_CHANGED, loadScheduled);
    return () => window.removeEventListener(CALENDAR_CHANGED, loadScheduled);
  }, [loadScheduled]);

  // Find and sort: by words, notebook, when and where.
  const [query, setQuery] = useState("");
  const [notebook, setNotebook] = useState<string>("all");
  const [period, setPeriod] = useState<"all" | "week" | "month" | "year">("all");
  const [place, setPlace] = useState<string>("all");
  const [groupBy, setGroupBy] = useState<"date" | "notebook" | "place">("date");
  const notebooks = useMemo(() => [...new Map(meetings.filter((m) => m.subjectId).map((m) => [String(m.subjectId), m.subjectTitle ?? ""])).entries()], [meetings]);
  const places = useMemo(() => [...new Set(meetings.map((m) => m.location?.name).filter((name): name is string => !!name))].sort(), [meetings]);
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    const since = period === "all" ? 0 : Date.now() - { week: 7, month: 31, year: 366 }[period] * 86_400_000;
    return meetings.filter((m) =>
      (!words || [m.title, m.summary, m.subjectTitle, m.location?.name, m.location?.address].some((text) => text?.toLowerCase().includes(words)))
      && (notebook === "all" || (notebook === "none" ? !m.subjectId : String(m.subjectId) === notebook))
      && (place === "all" || (place === "none" ? !m.location : m.location?.name === place))
      && new Date(m.createdAt).getTime() >= since);
  }, [meetings, query, notebook, period, place]);
  const groups = useMemo(() => {
    const month = new Intl.DateTimeFormat(language, { month: "long", year: "numeric" });
    const map = new Map<string, MeetingSummary[]>();
    for (const m of shown) {
      const key = groupBy === "date" ? month.format(new Date(m.createdAt))
        : groupBy === "notebook" ? (m.subjectTitle || copy("No notebook", "بلا دفتر"))
        : (m.location?.name || copy("No place", "بلا مكان"));
      map.set(key, [...(map.get(key) ?? []), m]);
    }
    return [...map.entries()];
  }, [shown, groupBy, language, isArabic]);
  const filtering = !!query.trim() || notebook !== "all" || period !== "all" || place !== "all";
  const select = "h-10 rounded-full border bg-background px-3 text-sm outline-none focus:border-primary";

  return (
    <main id="main-content" className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 font-serif text-3xl"><CalendarClock className="text-sky-600" size={28} />{copy("Meetings", "الاجتماعات")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{copy("Record a meeting; get the minutes, who said what, and the action items.", "سجّل اجتماعًا؛ واحصل على المحضر ومن قال ماذا والمهام.")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-11 rounded-full px-4" onClick={() => openEventEditor({ kind: "meeting" })}>
            <CalendarPlus size={17} className="me-2" />{copy("Schedule", "جدولة")}
          </Button>
          <Button className="h-11 rounded-full bg-gradient-to-br from-rose-500 to-red-700 px-5 text-white" onClick={() => openMeetingStart()}>
            <Mic size={17} className="me-2" />{copy("Start a meeting", "ابدأ اجتماعًا")}
          </Button>
        </div>
      </div>

      {scheduled.length > 0 && (
        <section className="mt-6" aria-label={copy("Coming up", "القادمة")}>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{copy("Coming up", "القادمة")}</h2>
            <Link href="/calendar" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><CalendarDays size={13} />{copy("Calendar", "التقويم")}</Link>
          </div>
          <ul className="space-y-2">
            {scheduled.slice(0, 6).map((event) => {
              const when = new Date(event.startsAt);
              const soon = isRecordable(when);
              const links = placeLinks(event.location);
              return (
                <li key={event.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-sky-200 bg-sky-50/70 p-3 dark:border-sky-900/50 dark:bg-sky-950/20">
                  <span className="grid w-12 shrink-0 place-items-center rounded-xl bg-background py-1 text-center leading-tight shadow-sm">
                    <span className="text-[10px] font-semibold uppercase text-sky-700">{new Intl.DateTimeFormat(language, { month: "short" }).format(when)}</span>
                    <span className="font-serif text-xl">{when.getDate()}</span>
                  </span>
                  <button type="button" onClick={() => openEventEditor({ event })} className="min-w-0 flex-1 text-start">
                    <span dir="auto" className="block truncate font-semibold">{event.title}</span>
                    <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      {event.allDay ? copy("All day", "طوال اليوم") : new Intl.DateTimeFormat(language, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(when)}
                      {event.reminders.length > 0 && <Bell size={11} />}
                      {event.location && <span className="inline-flex min-w-0 items-center gap-0.5"><MapPin size={11} className="shrink-0 text-rose-500" /><span dir="auto" className="truncate">{event.location.name}</span></span>}
                    </span>
                  </button>
                  {links && <a href={links.maps} target="_blank" rel="noreferrer" className="grid h-9 w-9 place-items-center rounded-full bg-background shadow-sm" aria-label={copy("Open the map", "افتح الخريطة")}><MapPin size={16} className="text-rose-500" /></a>}
                  {soon && <Button size="sm" className="rounded-full bg-red-600 text-white hover:bg-red-700" onClick={() => openMeetingStart({ event })}><Mic size={14} className="me-1" />{copy("Record now", "سجّل الآن")}</Button>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {meetings.length > 2 && (
        <section className="mt-6 space-y-2" aria-label={copy("Find a meeting", "ابحث عن اجتماع")}>
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} dir="auto" placeholder={copy("Search titles, summaries, places…", "ابحث في العناوين والملخصات والأماكن…")} aria-label={copy("Search meetings", "ابحث في الاجتماعات")}
              className="h-11 w-full rounded-full border bg-card ps-10 pe-4 text-sm outline-none focus:border-primary" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={notebook} onChange={(event) => setNotebook(event.target.value)} className={select} aria-label={copy("Notebook", "الدفتر")}>
              <option value="all">{copy("All notebooks", "كل الدفاتر")}</option>
              {notebooks.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
              <option value="none">{copy("No notebook", "بلا دفتر")}</option>
            </select>
            <select value={period} onChange={(event) => setPeriod(event.target.value as typeof period)} className={select} aria-label={copy("When", "متى")}>
              <option value="all">{copy("Any time", "أي وقت")}</option>
              <option value="week">{copy("Past week", "الأسبوع الماضي")}</option>
              <option value="month">{copy("Past month", "الشهر الماضي")}</option>
              <option value="year">{copy("Past year", "السنة الماضية")}</option>
            </select>
            {places.length > 0 && (
              <select value={place} onChange={(event) => setPlace(event.target.value)} className={select} aria-label={copy("Place", "المكان")}>
                <option value="all">{copy("Any place", "أي مكان")}</option>
                {places.map((name) => <option key={name} value={name}>{name}</option>)}
                <option value="none">{copy("No place", "بلا مكان")}</option>
              </select>
            )}
            <span className="ms-auto inline-flex items-center gap-1 rounded-full bg-secondary p-1 text-xs">
              <span className="px-1.5 text-muted-foreground">{copy("Group", "تجميع")}</span>
              {([["date", copy("Date", "التاريخ")], ["notebook", copy("Notebook", "الدفتر")], ["place", copy("Place", "المكان")]] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setGroupBy(value)} aria-pressed={groupBy === value} className={`rounded-full px-2.5 py-1 font-medium ${groupBy === value ? "bg-background shadow-sm" : "text-muted-foreground"}`}>{label}</button>
              ))}
            </span>
          </div>
          {filtering && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              {copy(`${shown.length} of ${meetings.length} meetings`, `${shown.length} من ${meetings.length} اجتماعات`)}
              <button type="button" onClick={() => { setQuery(""); setNotebook("all"); setPeriod("all"); setPlace("all"); }} className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"><X size={12} />{copy("Clear", "مسح")}</button>
            </p>
          )}
        </section>
      )}

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
      </ul>
      {groups.map(([heading, list]) => (
        <section key={heading} className="mt-6">
          {(groups.length > 1 || groupBy !== "date") && <h2 dir="auto" className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{groupBy === "place" && <MapPin size={12} />}{heading} <span className="font-normal">· {list.length}</span></h2>}
          <ul className="space-y-3">
        {list.map((meeting) => (
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
                  {meeting.location && <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"><MapPin size={11} className="shrink-0 text-rose-500" /><span dir="auto" className="truncate">{meeting.location.name}</span></p>}
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
        </section>
      ))}
      {filtering && !shown.length && <p className="mt-8 text-center text-sm text-muted-foreground">{copy("No meeting matches.", "لا يوجد اجتماع مطابق.")}</p>}

      {!isLoading && !meetings.length && !waiting.length && !scheduled.length && (
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
