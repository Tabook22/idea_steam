import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Bell, BellRing, CalendarClock, CalendarDays, CalendarPlus, Check, ChevronLeft, ChevronRight, ListChecks, Loader2, MapPin, Mic, Send } from "lucide-react";
import { CALENDAR_CHANGED, openEventEditor } from "@/components/event-editor";
import { openMeetingStart } from "@/components/meeting-start";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/i18n";
import { liveFetch } from "@/lib/live-api";
import {
  addDays, dayKey, enablePush, getCalendar, isRecordable, monthGrid, placeLinks, reminderStatus, shareTimezone, startOfDay, thisDevicePush,
  type CalendarData, type CalendarEvent, type ReminderStatus,
} from "@/lib/calendar-api";

type Item =
  | { type: "event"; id: string; at: Date; allDay: boolean; title: string; event: CalendarEvent }
  | { type: "meeting"; id: string; at: Date; allDay: false; title: string; meetingId: number; place: string | null }
  | { type: "task"; id: string; at: Date; allDay: boolean; title: string; done: boolean; time: string | null };

/** Everything with a date in one place: scheduled meetings and events, recorded meetings, and task deadlines. */
export default function CalendarPage() {
  const { isArabic, language } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const [month, setMonth] = useState(() => startOfDay(new Date()));
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [data, setData] = useState<CalendarData | null>(null);
  const grid = useMemo(() => monthGrid(month, 0), [month]);

  const load = useCallback(async () => {
    try { setData(await getCalendar(grid[0]!, addDays(grid[41]!, 8))); } catch { /* keeps the last */ }
  }, [grid]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const changed = () => void load();
    window.addEventListener(CALENDAR_CHANGED, changed);
    return () => window.removeEventListener(CALENDAR_CHANGED, changed);
  }, [load]);
  useEffect(() => { shareTimezone(); }, []);
  // Opened from a reminder: show that event.
  useEffect(() => {
    const id = Number(new URLSearchParams(location.search).get("event"));
    if (!id || !data) return;
    const event = data.events.find((one) => one.id === id);
    if (event) { setSelected(startOfDay(new Date(event.startsAt))); openEventEditor({ event }); history.replaceState(null, "", location.pathname); }
  }, [data]);

  const items = useMemo(() => {
    if (!data) return [] as Item[];
    const linked = new Set(data.events.map((event) => event.meetingId).filter(Boolean));
    return [
      ...data.events.map((event): Item => ({ type: "event", id: `e${event.id}`, at: new Date(event.startsAt), allDay: event.allDay, title: event.title, event })),
      ...data.meetings.filter((meeting) => !linked.has(meeting.id)).map((meeting): Item => ({ type: "meeting", id: `m${meeting.id}`, at: new Date(meeting.createdAt), allDay: false, title: meeting.title, meetingId: meeting.id, place: meeting.location?.name ?? null })),
      ...data.tasks.map((task): Item => ({ type: "task", id: `t${task.id}`, at: new Date(`${task.due}T${task.time ?? "00:00"}:00`), allDay: !task.time, title: task.text, done: task.done, time: task.time })),
    ].sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.at.getTime() - b.at.getTime());
  }, [data]);
  const byDay = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const item of items) { const key = dayKey(item.at); map.set(key, [...(map.get(key) ?? []), item]); }
    return map;
  }, [items]);
  const today = dayKey(new Date());
  const upcoming = items.filter((item) => item.at >= startOfDay(new Date()) && item.at < addDays(new Date(), 8) && !(item.type === "task" && item.done) && item.type !== "meeting");
  const weekday = (index: number) => new Intl.DateTimeFormat(language, { weekday: "short" }).format(addDays(grid[0]!, index));
  const color = (item: Item) => item.type === "event" ? (item.event.kind === "meeting" ? "bg-sky-600" : "bg-violet-600") : item.type === "meeting" ? "bg-emerald-600" : item.done ? "bg-slate-400" : "bg-amber-500";

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-2 sm:px-6">
      <Link href="/app" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={16} className="rtl:rotate-180" />{copy("Home", "الرئيسية")}</Link>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-4xl tracking-tight">{copy("Calendar", "التقويم")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{copy("Meetings, events and task deadlines in one place, with reminders on your phone.", "الاجتماعات والأحداث ومواعيد المهام في مكان واحد، مع تذكيرات على هاتفك.")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button className="rounded-full" onClick={() => openEventEditor({ date: selected, kind: "meeting" })}><CalendarClock size={16} className="me-1.5" />{copy("Schedule a meeting", "جدولة اجتماع")}</Button>
          <Button variant="outline" className="rounded-full" onClick={() => openEventEditor({ date: selected, kind: "event" })}><CalendarPlus size={16} className="me-1.5" />{copy("New event", "حدث جديد")}</Button>
        </div>
      </div>

      <RemindersCard copy={copy} />

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="rounded-3xl border bg-card p-3 shadow-sm sm:p-4" aria-label={copy("Month", "الشهر")}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="grid h-9 w-9 place-items-center rounded-full hover:bg-secondary" aria-label={copy("Previous month", "الشهر السابق")}><ChevronLeft size={18} className="rtl:rotate-180" /></button>
            <div className="text-center">
              <p className="font-serif text-xl">{new Intl.DateTimeFormat(language, { month: "long", year: "numeric" }).format(month)}</p>
              <button type="button" onClick={() => { const now = startOfDay(new Date()); setMonth(now); setSelected(now); }} className="text-xs font-medium text-primary hover:underline">{copy("Today", "اليوم")}</button>
            </div>
            <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="grid h-9 w-9 place-items-center rounded-full hover:bg-secondary" aria-label={copy("Next month", "الشهر التالي")}><ChevronRight size={18} className="rtl:rotate-180" /></button>
          </div>
          <div className="grid grid-cols-7 text-center text-[11px] font-semibold uppercase text-muted-foreground">{Array.from({ length: 7 }, (_, i) => <div key={i} className="py-1">{weekday(i)}</div>)}</div>
          <div className="grid grid-cols-7 gap-1">
            {grid.map((day) => {
              const key = dayKey(day);
              const list = byDay.get(key) ?? [];
              const inMonth = day.getMonth() === month.getMonth();
              const isSelected = key === dayKey(selected);
              return (
                <button key={key} type="button" onClick={() => setSelected(day)} onDoubleClick={() => openEventEditor({ date: day })} aria-pressed={isSelected}
                  className={`flex min-h-[3.4rem] flex-col items-stretch rounded-xl border p-1 text-start transition sm:min-h-[5.5rem] ${isSelected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-transparent hover:bg-secondary/60"} ${inMonth ? "" : "opacity-40"}`}>
                  <span className={`grid h-6 w-6 place-items-center self-center rounded-full text-xs font-semibold sm:self-start ${key === today ? "bg-primary text-primary-foreground" : ""}`}>{day.getDate()}</span>
                  {/* Dots on phones, titles on bigger screens. */}
                  <span className="mt-0.5 flex flex-wrap justify-center gap-0.5 sm:hidden">{list.slice(0, 4).map((item) => <span key={item.id} className={`h-1.5 w-1.5 rounded-full ${color(item)}`} />)}</span>
                  <span className="hidden space-y-0.5 sm:block">
                    {list.slice(0, 3).map((item) => <span key={item.id} dir="auto" className={`block truncate rounded px-1 text-[10px] font-medium leading-4 text-white ${color(item)}`}>{item.title}</span>)}
                    {list.length > 3 && <span className="block text-[10px] text-muted-foreground">+{list.length - 3}</span>}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-3 px-1 text-[11px] text-muted-foreground">
            {[["bg-sky-600", copy("Meetings", "اجتماعات")], ["bg-violet-600", copy("Events", "أحداث")], ["bg-emerald-600", copy("Recorded", "مسجّلة")], ["bg-amber-500", copy("Task deadlines", "مواعيد المهام")]].map(([c, label]) => <span key={label} className="inline-flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${c}`} />{label}</span>)}
          </div>
        </section>

        <section className="space-y-4" aria-label={copy("Day", "اليوم")}>
          <div className="rounded-3xl border bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-serif text-xl">{new Intl.DateTimeFormat(language, { weekday: "long", day: "numeric", month: "long" }).format(selected)}</h2>
              <Button size="sm" variant="ghost" className="rounded-full" onClick={() => openEventEditor({ date: selected })}><CalendarPlus size={15} className="me-1" />{copy("Add", "أضف")}</Button>
            </div>
            {!data ? <div className="grid h-24 place-items-center text-muted-foreground"><Loader2 className="animate-spin" /></div>
              : (byDay.get(dayKey(selected)) ?? []).length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">{copy("Nothing on this day. Double-tap a day to add something.", "لا شيء في هذا اليوم. اضغط مرتين على يوم لإضافة شيء.")}</p>
              : <ul className="space-y-2">{(byDay.get(dayKey(selected)) ?? []).map((item) => <ItemRow key={item.id} item={item} copy={copy} language={language} />)}</ul>}
          </div>
          <div className="rounded-3xl border bg-card p-4 shadow-sm">
            <h2 className="mb-3 font-serif text-xl">{copy("Next 7 days", "الأيام السبعة القادمة")}</h2>
            {upcoming.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">{copy("Nothing coming up.", "لا شيء قادم.")}</p>
              : <ul className="space-y-2">{upcoming.slice(0, 12).map((item) => <ItemRow key={item.id} item={item} copy={copy} language={language} showDay />)}</ul>}
          </div>
        </section>
      </div>
    </main>
  );
}

function ItemRow({ item, copy, language, showDay }: { item: Item; copy: (en: string, ar: string) => string; language: string; showDay?: boolean }) {
  const time = item.allDay ? copy("All day", "طوال اليوم") : new Intl.DateTimeFormat(language, { hour: "numeric", minute: "2-digit" }).format(item.at);
  const day = showDay ? `${new Intl.DateTimeFormat(language, { weekday: "short", day: "numeric" }).format(item.at)} · ` : "";
  if (item.type === "event") {
    const event = item.event;
    const links = placeLinks(event.location);
    const soon = event.kind === "meeting" && !event.meetingId && isRecordable(item.at);
    return (
      <li className={`rounded-2xl border-s-4 bg-secondary/40 p-3 ${event.kind === "meeting" ? "border-sky-600" : "border-violet-600"}`}>
        <button type="button" onClick={() => openEventEditor({ event })} className="block w-full text-start">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">{event.kind === "meeting" ? <CalendarClock size={13} /> : <CalendarDays size={13} />}{day}{time}{event.reminders.length > 0 && <Bell size={11} className="ms-1" />}</span>
          <span dir="auto" className="mt-0.5 block font-semibold">{event.title}</span>
          {event.notes && <span dir="auto" className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{event.notes}</span>}
        </button>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {event.location && (links
            ? <a href={links.maps} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 rounded-full bg-background px-2.5 py-1 text-xs"><MapPin size={12} className="shrink-0 text-rose-500" /><span dir="auto" className="truncate">{event.location.name}</span></a>
            : <span className="inline-flex items-center gap-1 rounded-full bg-background px-2.5 py-1 text-xs"><MapPin size={12} />{event.location.name}</span>)}
          {event.meetingId && <Link href={`/meetings/${event.meetingId}`} className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200"><Check size={12} />{copy("Recorded: minutes", "مسجّل: المحضر")}</Link>}
          {soon && <button type="button" onClick={() => openMeetingStart({ event })} className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-1 text-xs font-semibold text-white"><Mic size={12} />{copy("Record now", "سجّل الآن")}</button>}
        </div>
      </li>
    );
  }
  if (item.type === "meeting") return (
    <li className="rounded-2xl border-s-4 border-emerald-600 bg-secondary/40 p-3">
      <Link href={`/meetings/${item.meetingId}`} className="block">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Mic size={13} />{day}{time} · {copy("recorded", "مسجّل")}</span>
        <span dir="auto" className="mt-0.5 block font-semibold">{item.title}</span>
        {item.place && <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"><MapPin size={12} />{item.place}</span>}
      </Link>
    </li>
  );
  return (
    <li className={`rounded-2xl border-s-4 bg-secondary/40 p-3 ${item.done ? "border-slate-400 opacity-60" : "border-amber-500"}`}>
      <Link href="/tasks" className="block">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><ListChecks size={13} />{day}{item.time ? time : copy("Due", "مستحقة")}</span>
        <span dir="auto" className={`mt-0.5 block font-semibold ${item.done ? "line-through" : ""}`}>{item.title}</span>
      </Link>
    </li>
  );
}

/** Where reminders go: Telegram (rings like a message) and notifications on this phone. */
function RemindersCard({ copy }: { copy: (en: string, ar: string) => string }) {
  const { toast } = useToast();
  const [status, setStatus] = useState<ReminderStatus | null>(null);
  const [here, setHere] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => { void reminderStatus().then(setStatus).catch(() => {}); void thisDevicePush().then(setHere); };
  useEffect(refresh, []);
  const on = !!here && !!status?.devices.some((device) => device.endpoint === here);
  async function turnOn() {
    if (!status) return;
    setBusy("push");
    try {
      await enablePush(status.pushKey, navigator.userAgent.match(/\(([^)]+)\)/)?.[1]?.slice(0, 80) ?? "This device");
      refresh();
      toast({ title: copy("Notifications are on for this device.", "الإشعارات مفعّلة على هذا الجهاز.") });
    } catch (error) {
      const reason = (error as Error).message;
      toast({ variant: "destructive", title: reason === "denied" ? copy("Notifications were blocked. Allow them in the browser settings.", "حُظرت الإشعارات. اسمح بها من إعدادات المتصفح.")
        : reason === "unsupported" ? copy("This browser can't show notifications. On iPhone, add the app to your Home Screen first.", "هذا المتصفح لا يدعم الإشعارات. على الآيفون أضف التطبيق إلى الشاشة الرئيسية أولًا.")
        : copy("Notifications couldn't be turned on.", "تعذر تفعيل الإشعارات.") });
    } finally { setBusy(null); }
  }
  async function test() {
    setBusy("test");
    try {
      const result = await liveFetch<{ telegram: boolean; push: number }>("/api/reminders/test", { method: "POST", json: {} });
      toast({ title: result.telegram || result.push ? copy(`Test sent${result.telegram ? " to Telegram" : ""}${result.push ? `${result.telegram ? " and" : ""} to ${result.push} device${result.push === 1 ? "" : "s"}` : ""}.`, "أُرسل تذكير تجريبي.") : copy("Nowhere to send yet: connect Telegram or turn on notifications.", "لا وجهة بعد: اربط تيليجرام أو فعّل الإشعارات.") });
    } finally { setBusy(null); }
  }
  return (
    <section className="flex flex-wrap items-center gap-2 rounded-3xl border bg-gradient-to-r from-sky-50 to-card p-3 text-sm dark:from-sky-950/20" aria-label={copy("Reminders", "التذكيرات")}>
      <span className="flex items-center gap-1.5 px-1 font-semibold"><BellRing size={16} className="text-sky-600" />{copy("Reminders go to", "تصل التذكيرات إلى")}</span>
      {status?.telegram
        ? <span className="inline-flex items-center gap-1 rounded-full bg-[#229ED9] px-3 py-1 text-xs font-semibold text-white"><Send size={12} className="rtl:-scale-x-100" />Telegram ✓</span>
        : <Link href="/telegram" className="inline-flex items-center gap-1 rounded-full border border-[#229ED9]/50 px-3 py-1 text-xs font-medium text-[#1a7fb0]"><Send size={12} className="rtl:-scale-x-100" />{copy("Connect Telegram (rings your phone)", "اربط تيليجرام (يرنّ هاتفك)")}</Link>}
      {on
        ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white"><Bell size={12} />{copy("This device ✓", "هذا الجهاز ✓")}</span>
        : <button type="button" onClick={() => void turnOn()} disabled={!status || !!busy} className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium hover:border-primary/50">{busy === "push" ? <Loader2 size={12} className="animate-spin" /> : <Bell size={12} />}{copy("Turn on notifications here", "فعّل الإشعارات هنا")}</button>}
      {status && status.devices.length > (on ? 1 : 0) && <span className="text-xs text-muted-foreground">{copy(`+${status.devices.length - (on ? 1 : 0)} other device(s)`, `+${status.devices.length - (on ? 1 : 0)} جهاز آخر`)}</span>}
      <button type="button" onClick={() => void test()} disabled={!!busy} className="ms-auto inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium text-primary hover:bg-primary/10">{busy === "test" ? <Loader2 size={12} className="animate-spin" /> : null}{copy("Send a test", "أرسل تجربة")}</button>
    </section>
  );
}
