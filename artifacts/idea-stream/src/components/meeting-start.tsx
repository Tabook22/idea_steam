import { useEffect, useState } from "react";
import { CalendarClock, ChevronDown, Mic, ShieldCheck, Users } from "lucide-react";
import { useListSubjects } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useRecorder } from "@/components/recorder-provider";
import { isInbox } from "@/lib/inbox";
import { useLanguage } from "@/lib/i18n";
import { defaultMeetingTitle } from "@/lib/meeting-view";
import { useRecorderPrefs } from "@/lib/recorder-prefs";

const OPEN_EVENT = "idea-stream:meeting";
const LAST_KEY = "idea-stream-last-meeting";

/** Opens "Start a meeting" (optionally for a notebook). */
export const openMeetingStart = (subjectId?: number) => window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: subjectId }));

/** Title, notebook, people and agenda (all optional except the title), then record. */
export function MeetingStart() {
  const { isArabic, language } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const { start, stage, ready, rescue } = useRecorder();
  const [prefs] = useRecorderPrefs();
  const [open, setOpen] = useState(false);
  const { data: subjects = [] } = useListSubjects({ query: { enabled: open } as never });
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [people, setPeople] = useState("");
  const [agenda, setAgenda] = useState("");
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    const show = (event: Event) => {
      const chosen = (event as CustomEvent<number | undefined>).detail;
      let last: { subjectId?: number | null; people?: string } = {};
      try { last = JSON.parse(localStorage.getItem(LAST_KEY) ?? "{}"); } catch { /* optional */ }
      setTitle(defaultMeetingTitle(language));
      setSubjectId(chosen ?? last.subjectId ?? null);
      setPeople(last.people ?? "");
      setAgenda("");
      setShowMore(false);
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, [language]);

  const notebooks = subjects.filter((subject) => !isInbox(subject));
  const participants = people.split(/[,،\n]/).map((name) => name.trim()).filter(Boolean).slice(0, 30);

  function begin() {
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ subjectId, people })); } catch { /* optional */ }
    setOpen(false);
    void start(null, 0, {
      language: prefs.language,
      autoTranscribe: false,
      meeting: { title: title.trim() || defaultMeetingTitle(language), subjectId, participants, agenda: agenda.trim() },
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
        <div className="bg-gradient-to-br from-sky-500/15 via-card to-card px-5 pb-4 pt-5">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-sky-500/15 text-sky-700 dark:text-sky-300"><CalendarClock size={22} /></span>
          <DialogTitle className="mt-3 font-serif text-2xl">{copy("Record a meeting", "سجّل اجتماعًا")}</DialogTitle>
          <DialogDescription className="mt-1 text-sm">
            {copy("Up to 3 hours. Afterwards you get the minutes, who said what, action items in Tasks, and you can ask the meeting questions.",
              "حتى 3 ساعات. بعدها تحصل على المحضر ومن قال ماذا والمهام في قائمة المهام، ويمكنك سؤال الاجتماع.")}
          </DialogDescription>
        </div>
        <form className="space-y-3.5 px-5 pb-5 pt-3" onSubmit={(event) => { event.preventDefault(); begin(); }}>
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">{copy("Title", "العنوان")}</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} dir="auto"
              className="mt-1 h-11 w-full rounded-xl border bg-background px-3 text-[15px] outline-none focus:border-primary" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">{copy("Notebook (the minutes go there)", "الدفتر (يُحفظ فيه المحضر)")}</span>
            <select value={subjectId ?? ""} onChange={(event) => setSubjectId(event.target.value ? Number(event.target.value) : null)}
              className="mt-1 h-11 w-full rounded-xl border bg-background px-3 text-sm">
              <option value="">{copy("No notebook, just the library", "بلا دفتر، المكتبة فقط")}</option>
              {notebooks.map((subject) => <option key={subject.id} value={subject.id}>{subject.icon ? `${subject.icon} ` : ""}{subject.title}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => setShowMore((value) => !value)} aria-expanded={showMore}
            className="flex items-center gap-1.5 text-xs font-medium text-primary">
            <ChevronDown size={14} className={`transition-transform ${showMore ? "" : "-rotate-90 rtl:rotate-90"}`} />
            {copy("Who's there and the agenda (optional, makes the minutes better)", "الحاضرون وجدول الأعمال (اختياري، يحسّن المحضر)")}
          </button>
          {showMore && (
            <div className="space-y-3">
              <label className="block">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Users size={13} />{copy("Participants, separated by commas", "الحاضرون، مفصولين بفواصل")}</span>
                <input value={people} onChange={(event) => setPeople(event.target.value)} dir="auto" placeholder={copy("Sara, Ali, Mona", "سارة، علي، منى")}
                  className="mt-1 h-10 w-full rounded-xl border bg-background px-3 text-sm outline-none focus:border-primary" />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground">{copy("Agenda", "جدول الأعمال")}</span>
                <textarea value={agenda} onChange={(event) => setAgenda(event.target.value)} rows={3} dir="auto" maxLength={4000}
                  placeholder={copy("1. Budget\n2. Dates\n3. Who does what", "1. الميزانية\n2. المواعيد\n3. توزيع المهام")}
                  className="mt-1 w-full rounded-xl border bg-background p-3 text-sm outline-none focus:border-primary" />
              </label>
            </div>
          )}
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
            <ShieldCheck size={15} className="mt-px shrink-0" />
            {copy("Tell everyone you're recording before you start. In some places recording without consent is not allowed.",
              "أخبر الحاضرين بأنك تسجّل قبل البدء. في بعض الأماكن لا يُسمح بالتسجيل دون موافقة.")}
          </p>
          <Button type="submit" className="h-12 w-full rounded-2xl bg-gradient-to-br from-rose-500 to-red-700 text-base font-semibold text-white hover:opacity-95"
            disabled={!ready || stage !== "idle" || !!rescue}>
            <Mic size={18} className="me-2" />{copy("Start recording the meeting", "ابدأ تسجيل الاجتماع")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
