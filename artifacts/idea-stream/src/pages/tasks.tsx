import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CalendarPlus,
  Check,
  ChevronDown,
  ListChecks,
  Loader2,
  MoreVertical,
  Pause,
  Pencil,
  Play,
  Plus,
  ScanSearch,
  Trash2,
  User,
} from "lucide-react";
import {
  createTask,
  deleteTask,
  getListTasksQueryKey,
  scanTasks,
  updateTask,
  useListTasks,
  type Task,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { appPath } from "@/lib/app-path";
import { useLanguage } from "@/lib/i18n";
import { addDays, calendarFile, groupTasks, todayKey, type Group } from "@/lib/task-dates";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/calendar;charset=utf-8" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const dirOf = (text: string) => (/[֐-ࣿ]/.test(text.slice(0, 30)) ? "rtl" : "ltr");

export default function TasksPage() {
  const { isArabic, language } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: tasks = [], isLoading } = useListTasks();
  const [draft, setDraft] = useState("");
  const [draftDue, setDraftDue] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [scan, setScan] = useState<{ scanned: number; found: number } | null>(null);
  const [justDone, setJustDone] = useState<Set<number>>(new Set());
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  useEffect(() => () => audio.current?.pause(), []);

  const today = todayKey();
  const groups = useMemo(() => groupTasks(tasks, today), [tasks, today]);
  const open = tasks.filter((task) => !task.done).length;
  const refresh = () => queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
  const dayFormat = useMemo(() => new Intl.DateTimeFormat(language, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }), [language]);

  const label: Record<Group, string> = {
    overdue: copy("Overdue", "متأخرة"),
    today: copy("Today", "اليوم"),
    week: copy("Next 7 days", "الأيام السبعة القادمة"),
    later: copy("Later", "لاحقًا"),
    someday: copy("No date", "بلا موعد"),
    done: copy("Done", "منجزة"),
  };

  const when = (task: Task) => {
    if (!task.due) return null;
    const day = task.due === today ? copy("Today", "اليوم") : task.due === addDays(today, 1) ? copy("Tomorrow", "غدًا")
      : task.due === addDays(today, -1) ? copy("Yesterday", "أمس") : dayFormat.format(new Date(`${task.due}T00:00:00Z`));
    return task.time ? `${day} · ${task.time}` : day;
  };

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    try {
      await createTask({ text, due: draftDue || null });
      setDraftDue("");
      await refresh();
    } catch {
      setDraft(text);
      toast({ variant: "destructive", title: copy("Couldn't add the task.", "تعذرت إضافة المهمة.") });
    }
  }

  async function change(task: Task, patch: Parameters<typeof updateTask>[1]) {
    // Shown right away; the list catches up from the server.
    queryClient.setQueryData<Task[]>(getListTasksQueryKey(), (list) => list?.map((item) => (item.id === task.id ? { ...item, ...patch } as Task : item)));
    try { await updateTask(task.id, patch); }
    catch { toast({ variant: "destructive", title: copy("Couldn't save that change.", "تعذر حفظ التغيير.") }); }
    finally { void refresh(); }
  }

  const toggle = (task: Task) => {
    if (!task.done) {
      setJustDone((current) => new Set(current).add(task.id));
      navigator.vibrate?.(12);
      setTimeout(() => setJustDone((current) => { const next = new Set(current); next.delete(task.id); return next; }), 900);
    }
    void change(task, { done: !task.done });
  };

  async function remove(task: Task) {
    queryClient.setQueryData<Task[]>(getListTasksQueryKey(), (list) => list?.filter((item) => item.id !== task.id));
    try { await deleteTask(task.id); } catch { toast({ variant: "destructive", title: copy("Couldn't remove it.", "تعذرت الإزالة.") }); }
    void refresh();
  }

  async function findAll() {
    setScan({ scanned: 0, found: 0 });
    let scanned = 0, found = 0;
    try {
      for (let round = 0; round < 30; round++) {
        const result = await scanTasks();
        scanned += result.scanned; found += result.found;
        setScan({ scanned, found });
        await refresh();
        if (!result.remaining || !result.scanned) break;
      }
      toast({ title: found ? copy(`Found ${found} new task${found === 1 ? "" : "s"}`, `وُجدت ${found} مهمة جديدة`) : copy("No new tasks found", "لا توجد مهام جديدة"),
        description: copy(`Searched ${scanned} recording${scanned === 1 ? "" : "s"}.`, `بُحث في ${scanned} تسجيل.`) });
    } catch (error) {
      toast({ variant: "destructive", title: (error as { data?: { error?: string } })?.data?.error ?? copy("Couldn't search right now.", "تعذر البحث الآن.") });
    } finally {
      setScan(null);
    }
  }

  function listen(task: Task) {
    if (!task.sourceUrl) return;
    if (playing === task.id) { audio.current?.pause(); setPlaying(null); return; }
    const element = audio.current ?? (audio.current = new Audio());
    element.src = appPath(task.sourceUrl, import.meta.env.BASE_URL);
    const start = Math.max(0, task.at ?? 0);
    const begin = () => { element.currentTime = start; void element.play().then(() => setPlaying(task.id)).catch(() => setPlaying(null)); };
    if (element.readyState >= 1) begin(); else element.addEventListener("loadedmetadata", begin, { once: true });
    element.onended = () => setPlaying(null);
    // The moment, not the whole recording.
    element.ontimeupdate = () => { if (element.currentTime > start + 25) { element.pause(); setPlaying(null); } };
  }

  const upcoming = tasks.filter((task) => !task.done && task.due);

  const row = (task: Task, group: Group) => {
    const done = task.done || justDone.has(task.id);
    const dateTone = group === "overdue" ? "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200"
      : group === "today" ? "bg-primary/12 text-primary" : "bg-secondary text-secondary-foreground";
    return (
      <li key={task.id} className={`group flex items-start gap-3 px-3 py-3 transition-colors ${justDone.has(task.id) ? "bg-primary/[0.06]" : ""}`}>
        <button type="button" onClick={() => toggle(task)} role="checkbox" aria-checked={done}
          aria-label={done ? copy(`Mark “${task.text}” as not done`, `أعد «${task.text}» غير منجزة`) : copy(`Mark “${task.text}” as done`, `علّم «${task.text}» منجزة`)}
          className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition-all ${done ? "scale-110 border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40 hover:border-primary"}`}>
          {done && <Check size={14} strokeWidth={3} />}
        </button>
        <div className="min-w-0 flex-1">
          {editing === task.id ? (
            <form onSubmit={(event) => { event.preventDefault(); if (editText.trim()) void change(task, { text: editText.trim() }); setEditing(null); }}>
              <input autoFocus value={editText} maxLength={200} dir="auto" onChange={(event) => setEditText(event.target.value)}
                onBlur={() => { if (editText.trim() && editText.trim() !== task.text) void change(task, { text: editText.trim() }); setEditing(null); }}
                onKeyDown={(event) => { if (event.key === "Escape") setEditing(null); }}
                aria-label={copy("Task", "المهمة")} className="h-9 w-full rounded-lg border bg-background px-2.5 text-[15px] outline-none focus:border-primary" />
            </form>
          ) : (
            <p dir={dirOf(task.text)} className={`text-start text-[15px] leading-6 transition-colors ${done ? "text-muted-foreground line-through decoration-primary/50" : ""}`}>{task.text}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
            <label className={`relative inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 font-medium ${task.due ? dateTone : "border border-dashed text-muted-foreground"}`}>
              <CalendarPlus size={11} />{when(task) ?? copy("Add date", "أضف موعدًا")}
              <input type="date" value={task.due ?? ""} onChange={(event) => void change(task, { due: event.target.value || null })}
                aria-label={copy("Due date", "الموعد")} className="absolute inset-0 cursor-pointer opacity-0" />
            </label>
            {task.person && (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 font-medium text-violet-900 dark:bg-violet-900/40 dark:text-violet-100">
                <User size={11} /><span dir="auto">{task.person}</span>
              </span>
            )}
            {task.source === "recording" && task.sourceId && (
              <span className="inline-flex max-w-[16rem] items-center gap-1 rounded-full border bg-card ps-1 pe-2 font-medium text-muted-foreground">
                {task.sourceUrl && (
                  <button type="button" onClick={() => listen(task)} aria-label={playing === task.id ? copy("Stop", "إيقاف") : copy("Hear where you said it", "استمع حيث قلتها")}
                    className={`grid h-5 w-5 place-items-center rounded-full ${playing === task.id ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary hover:bg-primary/20"}`}>
                    {playing === task.id ? <Pause size={10} /> : <Play size={10} className="ms-px" />}
                  </button>
                )}
                <Link href={`/library#item-${task.sourceId}`} className="truncate hover:text-primary" dir="auto">🎙 {task.sourceTitle ?? copy("Recording", "تسجيل")}</Link>
              </span>
            )}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger aria-label={copy(`More for ${task.text}`, `المزيد لـ ${task.text}`)}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground opacity-100 hover:bg-secondary sm:opacity-0 sm:group-hover:opacity-100 data-[state=open]:opacity-100">
            <MoreVertical size={16} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => { setEditText(task.text); setEditing(task.id); }}><Pencil size={15} />{copy("Edit", "تعديل")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void change(task, { due: today })}><CalendarPlus size={15} />{copy("Do it today", "أنجزها اليوم")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void change(task, { due: addDays(today, 1) })}><CalendarPlus size={15} />{copy("Tomorrow", "غدًا")}</DropdownMenuItem>
            {task.due && <DropdownMenuItem onSelect={() => download("task.ics", calendarFile([task]))}><CalendarPlus size={15} />{copy("Add to my calendar", "أضف إلى تقويمي")}</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void remove(task)} className="text-destructive focus:bg-destructive/10 focus:text-destructive"><Trash2 size={15} />{copy("Remove", "إزالة")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
    );
  };

  return (
    <main id="main-content" className="mx-auto w-full max-w-3xl px-4 pb-16 pt-2 sm:px-6">
      <Link href="/app" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft size={15} className="rtl:rotate-180" />{copy("Home", "الرئيسية")}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 font-serif text-3xl"><ListChecks className="text-primary" size={28} />{copy("Tasks", "المهام")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {copy("Things you said you'd do, found in your recordings, plus your own.", "ما قلتَ إنك ستفعله، من تسجيلاتك، وما تضيفه بنفسك.")}
            {open > 0 && <span className="ms-1 font-medium text-foreground">{copy(`${open} open`, `${open} مفتوحة`)}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-9 rounded-full" disabled={!!scan} onClick={() => void findAll()}>
            {scan ? <Loader2 size={15} className="me-1.5 animate-spin" /> : <ScanSearch size={15} className="me-1.5" />}
            {scan ? copy(`Searching… ${scan.scanned}`, `جارٍ البحث… ${scan.scanned}`) : copy("Find tasks in my recordings", "ابحث عن مهام في تسجيلاتي")}
          </Button>
          {upcoming.length > 0 && (
            <Button variant="ghost" className="h-9 rounded-full" onClick={() => download("idea-stream-tasks.ics", calendarFile(upcoming))}>
              <CalendarPlus size={15} className="me-1.5" />{copy("All to calendar", "الكل إلى التقويم")}
            </Button>
          )}
        </div>
      </div>

      <form onSubmit={(event) => void add(event)} className="mt-5 flex items-center gap-2 rounded-2xl border bg-card p-1.5 ps-3 shadow-sm focus-within:border-primary/50">
        <Plus size={18} className="shrink-0 text-muted-foreground" />
        <input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={200} dir="auto"
          placeholder={copy("Add a task…", "أضف مهمة…")} aria-label={copy("New task", "مهمة جديدة")}
          className="h-10 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground" />
        <input type="date" value={draftDue} onChange={(event) => setDraftDue(event.target.value)} aria-label={copy("Due date", "الموعد")}
          className="h-9 w-[8.5rem] shrink-0 rounded-lg border bg-background px-2 text-xs text-muted-foreground" />
        <Button type="submit" size="sm" className="h-9 rounded-xl" disabled={!draft.trim()}>{copy("Add", "أضف")}</Button>
      </form>

      {isLoading ? (
        <p className="mt-10 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" />{copy("Loading…", "جارٍ التحميل…")}</p>
      ) : !tasks.length ? (
        <div className="mt-10 flex flex-col items-center rounded-3xl border border-dashed px-6 py-12 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 text-3xl">🎙️</span>
          <p className="mt-4 font-serif text-xl">{copy("Say it, and it lands here", "قلها، فتظهر هنا")}</p>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            {copy("When a recording is converted to text, things you mention doing (“call Sara on Thursday”) appear here with their date, and play back from the moment you said them.",
              "عندما يتحول تسجيل إلى نص، تظهر هنا الأشياء التي ذكرت أنك ستفعلها («اتصل بسارة يوم الخميس») مع موعدها، وتُشغَّل من اللحظة التي قلتها فيها.")}
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {(["overdue", "today", "week", "later", "someday"] as Group[]).filter((group) => groups[group].length).map((group) => (
            <section key={group} aria-label={label[group]}>
              <h2 className={`mb-1.5 flex items-baseline justify-between px-1 text-sm font-semibold ${group === "overdue" ? "text-red-700 dark:text-red-300" : group === "today" ? "text-primary" : ""}`}>
                {label[group]}<span className="text-xs font-normal tabular-nums text-muted-foreground">{groups[group].length}</span>
              </h2>
              <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">{groups[group].map((task) => row(task, group))}</ul>
            </section>
          ))}
          {groups.done.length > 0 && (
            <section aria-label={label.done}>
              <button type="button" onClick={() => setShowDone((value) => !value)} aria-expanded={showDone}
                className="mb-1.5 flex w-full items-center gap-1.5 px-1 text-sm font-semibold text-muted-foreground hover:text-foreground">
                <ChevronDown size={15} className={`transition-transform ${showDone ? "" : "-rotate-90 rtl:rotate-90"}`} />
                {label.done}<span className="text-xs font-normal tabular-nums">{groups.done.length}</span>
              </button>
              {showDone && <ul className="divide-y overflow-hidden rounded-2xl border bg-card/60">{groups.done.map((task) => row(task, "done"))}</ul>}
            </section>
          )}
        </div>
      )}
    </main>
  );
}
