import { useEffect, useState } from "react";
import { Bell, CalendarClock, CalendarDays, Loader2, Mic, Trash2 } from "lucide-react";
import { useListSubjects } from "@workspace/api-client-react";
import { PlacePicker } from "@/components/place-picker";
import { openMeetingStart } from "@/components/meeting-start";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { isInbox } from "@/lib/inbox";
import { useLanguage } from "@/lib/i18n";
import { LiveError } from "@/lib/live-api";
import { REMINDER_CHOICES, dayKey, isRecordable, deleteEvent, saveEvent, type CalendarEvent, type Place } from "@/lib/calendar-api";

const OPEN = "idea-stream:event-editor";
export const CALENDAR_CHANGED = "idea-stream:calendar-changed";
/** Opens the editor for a new event (on a day) or an existing one. */
export const openEventEditor = (detail: { event?: CalendarEvent; date?: Date; kind?: "meeting" | "event" } = {}) => window.dispatchEvent(new CustomEvent(OPEN, { detail }));

const timeOf = (date: Date) => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
const at = (day: string, time: string) => new Date(`${day}T${time || "00:00"}:00`);

/** Schedule a meeting or any event: when, where (with a map), who, the agenda, notes, and reminders. */
export function EventEditor() {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [kind, setKind] = useState<"meeting" | "event">("meeting");
  const [title, setTitle] = useState("");
  const [day, setDay] = useState(dayKey(new Date()));
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [allDay, setAllDay] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [people, setPeople] = useState("");
  const [agenda, setAgenda] = useState("");
  const [notes, setNotes] = useState("");
  const [reminders, setReminders] = useState<number[]>([30]);
  const [busy, setBusy] = useState(false);
  const { data: subjects = [] } = useListSubjects({ query: { enabled: open } as never });

  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent<{ event?: CalendarEvent; date?: Date; kind?: "meeting" | "event" }>).detail ?? {};
      const existing = detail.event ?? null;
      setEditing(existing);
      if (existing) {
        const s = new Date(existing.startsAt);
        setKind(existing.kind); setTitle(existing.title); setDay(dayKey(s)); setStart(timeOf(s));
        setEnd(existing.endsAt ? timeOf(new Date(existing.endsAt)) : timeOf(new Date(s.getTime() + 3600_000)));
        setAllDay(existing.allDay); setPlace(existing.location); setSubjectId(existing.subjectId); setPeople(existing.participants.join(", "));
        setAgenda(existing.agenda); setNotes(existing.notes); setReminders(existing.reminders);
      } else {
        // A new one: the chosen day, at the next full hour.
        const base = detail.date ?? new Date();
        const next = new Date(); next.setMinutes(0, 0, 0); next.setHours(next.getHours() + 1);
        setKind(detail.kind ?? "meeting"); setTitle(""); setDay(dayKey(base));
        setStart(dayKey(base) === dayKey(new Date()) ? timeOf(next) : "09:00");
        setEnd(dayKey(base) === dayKey(new Date()) ? timeOf(new Date(next.getTime() + 3600_000)) : "10:00");
        setAllDay(false); setPlace(null); setSubjectId(null); setPeople(""); setAgenda(""); setNotes(""); setReminders([30]);
      }
      setOpen(true);
    };
    window.addEventListener(OPEN, show);
    return () => window.removeEventListener(OPEN, show);
  }, []);

  const input = () => ({
    kind, title: title.trim(), startsAt: (allDay ? at(day, "00:00") : at(day, start)).toISOString(),
    endsAt: allDay ? null : at(day, end) > at(day, start) ? at(day, end).toISOString() : null,
    allDay, location: place, subjectId: kind === "meeting" ? subjectId : subjectId, participants: people.split(/[,،\n]/).map((p) => p.trim()).filter(Boolean),
    agenda: agenda.trim(), notes: notes.trim(), reminders,
  });
  async function save() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await saveEvent(input(), editing?.id);
      window.dispatchEvent(new Event(CALENDAR_CHANGED));
      setOpen(false);
      toast({ title: editing ? copy("Saved.", "حُفظ.") : copy("Added to your calendar.", "أُضيف إلى تقويمك.") });
    } catch (error) { toast({ variant: "destructive", title: error instanceof LiveError ? error.message : copy("It couldn't be saved.", "تعذر الحفظ.") }); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!editing || !window.confirm(copy("Delete this from your calendar?", "حذفه من التقويم؟"))) return;
    await deleteEvent(editing.id);
    window.dispatchEvent(new Event(CALENDAR_CHANGED));
    setOpen(false);
  }
  const startsAt = allDay ? at(day, "00:00") : at(day, start);
  const canRecordNow = kind === "meeting" && editing && !editing.meetingId && isRecordable(startsAt);
  const field = "mt-1 h-11 w-full rounded-xl border bg-background px-3 text-sm outline-none focus:border-primary";
  const label = "block text-xs font-semibold text-muted-foreground";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-2xl">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-sky-500/15 text-sky-700 dark:text-sky-300">{kind === "meeting" ? <CalendarClock size={19} /> : <CalendarDays size={19} />}</span>
            {editing ? copy("Edit", "تعديل") : kind === "meeting" ? copy("Schedule a meeting", "جدولة اجتماع") : copy("New event", "حدث جديد")}
          </DialogTitle>
          <DialogDescription>{copy("You'll be reminded on Telegram and with a notification.", "ستصلك تذكيرات على تيليجرام وكإشعار.")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-secondary p-1">
            {([["meeting", copy("Meeting", "اجتماع")], ["event", copy("Event or reminder", "حدث أو تذكير")]] as const).map(([value, text]) => (
              <button key={value} type="button" onClick={() => setKind(value)} aria-pressed={kind === value} className={`rounded-lg py-2 text-sm font-semibold ${kind === value ? "bg-background shadow-sm" : "text-muted-foreground"}`}>{text}</button>
            ))}
          </div>
          <label className={label}>{copy("Title", "العنوان")}
            <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} dir="auto" className={field} placeholder={kind === "meeting" ? copy("e.g. Budget review with the team", "مثلًا: مراجعة الميزانية مع الفريق") : copy("e.g. Submit the report", "مثلًا: تسليم التقرير")} />
          </label>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1.3fr_1fr_1fr]">
            <label className={`${label} col-span-2 sm:col-span-1`}>{copy("Date", "التاريخ")}<input type="date" value={day} onChange={(event) => setDay(event.target.value)} className={field} /></label>
            {!allDay && <label className={label}>{copy("Starts", "يبدأ")}<input type="time" value={start} onChange={(event) => setStart(event.target.value)} className={field} /></label>}
            {!allDay && <label className={label}>{copy("Ends", "ينتهي")}<input type="time" value={end} onChange={(event) => setEnd(event.target.value)} className={field} /></label>}
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} className="h-4 w-4" />{copy("All day", "طوال اليوم")}</label>
          <div><span className={label}>{copy("Where", "المكان")}</span><div className="mt-1"><PlacePicker value={place} onChange={setPlace} /></div></div>
          {kind === "meeting" && (
            <>
              <label className={label}>{copy("Notebook (the minutes go there)", "الدفتر (يُحفظ فيه المحضر)")}
                <select value={subjectId ?? ""} onChange={(event) => setSubjectId(event.target.value ? Number(event.target.value) : null)} className={field}>
                  <option value="">{copy("None", "بلا")}</option>
                  {subjects.filter((s) => !isInbox(s)).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                </select>
              </label>
              <label className={label}>{copy("Who's coming (comma between names)", "الحاضرون (بينهم فاصلة)")}<input value={people} onChange={(event) => setPeople(event.target.value)} dir="auto" className={field} /></label>
              <label className={label}>{copy("Agenda", "جدول الأعمال")}<textarea value={agenda} onChange={(event) => setAgenda(event.target.value)} rows={3} dir="auto" maxLength={4000} className={`${field} h-auto py-2`} /></label>
            </>
          )}
          <label className={label}>{copy("Notes and comments", "ملاحظات وتعليقات")}<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} dir="auto" maxLength={8000} className={`${field} h-auto py-2`} placeholder={copy("Anything to remember: what to bring, links, phone numbers…", "أي شيء تتذكره: ما تحضره، روابط، أرقام…")} /></label>
          <div>
            <p className={`${label} mb-1.5 flex items-center gap-1.5`}><Bell size={13} />{copy("Remind me", "ذكّرني")}</p>
            <div className="flex flex-wrap gap-1.5">
              {REMINDER_CHOICES.map(([minutes, en, ar]) => (
                <button key={minutes} type="button" aria-pressed={reminders.includes(minutes)} onClick={() => setReminders((all) => all.includes(minutes) ? all.filter((m) => m !== minutes) : [...all, minutes].sort((a, b) => a - b))}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium ${reminders.includes(minutes) ? "border-primary bg-primary text-primary-foreground" : "bg-background"}`}>{copy(en, ar)}</button>
              ))}
            </div>
          </div>
          <DialogFooter className="flex-wrap gap-2 sm:justify-between">
            {editing ? <Button type="button" variant="ghost" className="text-destructive" onClick={() => void remove()}><Trash2 size={15} className="me-1.5" />{copy("Delete", "حذف")}</Button> : <span />}
            <div className="flex flex-wrap gap-2">
              {canRecordNow && (
                <Button type="button" variant="outline" className="border-red-300 text-red-700" onClick={() => { setOpen(false); openMeetingStart({ event: { ...editing!, ...input(), id: editing!.id } as CalendarEvent }); }}>
                  <Mic size={15} className="me-1.5" />{copy("Record it now", "سجّله الآن")}
                </Button>
              )}
              <Button type="submit" disabled={busy || !title.trim()}>{busy && <Loader2 size={15} className="me-1.5 animate-spin" />}{copy("Save", "حفظ")}</Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
