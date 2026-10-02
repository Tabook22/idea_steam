import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpDown,
  ArrowUpRight,
  Check,
  ChevronDown,
  Download,
  Headphones,
  ArrowDown,
  ArrowUp,
  ListChecks,
  ListMusic,
  Merge,
  RotateCcw,
  Scissors,
  Loader2,
  Mic,
  Pause,
  Pencil,
  Play,
  Search,
  SkipForward,
  Trash2,
  X,
} from "lucide-react";
import {
  deleteAudioLibraryItem,
  joinAudioLibraryItems,
  restoreAudioLibraryItem,
  getListAudioLibraryQueryKey,
  updateAudioLibraryItem,
  useListAudioLibrary,
  type AudioLibraryItem,
} from "@workspace/api-client-react";
import { appPath } from "@/lib/app-path";
import { useRecorder } from "@/components/recorder-provider";
import { AudioEditor } from "@/components/audio-editor";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { usePressToTalk } from "@/components/press-to-talk";
import { useRecorderPrefs } from "@/lib/recorder-prefs";
import { useLanguage } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
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

type Sort = "newest" | "oldest" | "longest" | "shortest" | "title";
const SORT_KEY = "idea-stream-library-sort";
const SPEEDS = [1, 1.25, 1.5, 2];

const clock = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value)) return "–:––";
  const total = Math.max(0, Math.round(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
};

export function displayTitle(item: Pick<AudioLibraryItem, "title" | "transcript">, fallback: string) {
  if (item.title) return item.title;
  const words = item.transcript?.replace(/\s+/g, " ").trim();
  return words ? (words.length > 70 ? `${words.slice(0, 70).trim()}…` : words) : fallback;
}

export default function LibraryPage() {
  const { isArabic, language } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: items = [], isLoading, isError, refetch } = useListAudioLibrary();
  const [sort, setSort] = useState<Sort>(() => {
    try { return (localStorage.getItem(SORT_KEY) as Sort) || "newest"; } catch { return "newest"; }
  });
  const [filter, setFilter] = useState("");
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [activeId, setActiveId] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [length, setLength] = useState<number | null>(null);
  const [speed, setSpeed] = useState(1);
  const [playAll, setPlayAll] = useState(false);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<AudioLibraryItem | null>(null);
  const [editing, setEditing] = useState<AudioLibraryItem | null>(null);
  const [restoring, setRestoring] = useState<AudioLibraryItem | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinTitle, setJoinTitle] = useState("");
  const [joining, setJoining] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const pendingDeletes = useRef(new Map<number, number>());
  const fallbackTitle = copy("Voice note", "ملاحظة صوتية");
  // Recording here saves only to the library, never to a subject.
  const { start, stage, ready, rescue, records, online } = useRecorder();
  const [prefs] = useRecorderPrefs();
  const libraryOptions = { language: prefs.language, autoTranscribe: prefs.autoTranscribe, libraryOnly: true };
  const talk = usePressToTalk({
    disabled: !ready || !!rescue || stage !== "idle",
    onTap: () => void start(null, prefs.limit, libraryOptions),
    onHoldStart: () => void start(null, prefs.limit, { ...libraryOptions, hold: true }),
  });
  const pendingHere = records.filter((record) => record.destination === "library" && record.status === "saved").length;

  useEffect(() => { try { localStorage.setItem(SORT_KEY, sort); } catch { /* optional */ } }, [sort]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase();
    const list = items.filter((item) => !hidden.has(item.id) && (!needle ||
      [item.title, item.transcript, item.sourceSubjectTitle].some((text) => text?.toLocaleLowerCase().includes(needle))));
    const time = (item: AudioLibraryItem) => Date.parse(item.capturedAt);
    const len = (item: AudioLibraryItem) => item.durationSeconds ?? -1;
    return [...list].sort((a, b) =>
      sort === "oldest" ? time(a) - time(b)
      : sort === "longest" ? len(b) - len(a) || time(b) - time(a)
      : sort === "shortest" ? (len(a) < 0 ? 1 : len(b) < 0 ? -1 : len(a) - len(b))
      : sort === "title" ? displayTitle(a, fallbackTitle).localeCompare(displayTitle(b, fallbackTitle), language)
      : time(b) - time(a));
  }, [items, hidden, filter, sort, language, fallbackTitle]);

  const active = items.find((item) => item.id === activeId) ?? null;
  const totalSeconds = visible.reduce((sum, item) => sum + (item.durationSeconds ?? 0), 0);
  const dayFormat = useMemo(() => new Intl.DateTimeFormat(language, { weekday: "long", day: "numeric", month: "long", year: "numeric" }), [language]);
  const timeFormat = useMemo(() => new Intl.DateTimeFormat(language, { hour: "numeric", minute: "2-digit" }), [language]);

  function play(item: AudioLibraryItem) {
    const element = audio.current;
    if (!element) return;
    if (activeId === item.id) {
      if (element.paused) void element.play().catch(() => {});
      else element.pause();
      return;
    }
    setActiveId(item.id);
    setPosition(0);
    setLength(item.durationSeconds);
    element.src = appPath(item.url, import.meta.env.BASE_URL);
    element.playbackRate = speed;
    void element.play().catch(() => toast({ variant: "destructive", title: copy("This recording couldn't be played.", "تعذر تشغيل هذا التسجيل.") }));
  }

  const next = () => {
    const index = visible.findIndex((item) => item.id === activeId);
    const following = visible[index + 1];
    if (following) play(following);
    else { setPlayAll(false); setPlaying(false); }
  };

  // Lock-screen and car controls while listening.
  useEffect(() => {
    if (!("mediaSession" in navigator) || !active) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: displayTitle(active, fallbackTitle),
      artist: active.sourceSubjectTitle ?? "Idea Stream",
      album: copy("Audio library", "مكتبة الصوت"),
      artwork: [{ src: `${import.meta.env.BASE_URL}icon-512.png`, sizes: "512x512", type: "image/png" }],
    });
    navigator.mediaSession.setActionHandler("play", () => void audio.current?.play());
    navigator.mediaSession.setActionHandler("pause", () => audio.current?.pause());
    navigator.mediaSession.setActionHandler("nexttrack", next);
    navigator.mediaSession.setActionHandler("seekbackward", () => { if (audio.current) audio.current.currentTime -= 10; });
    navigator.mediaSession.setActionHandler("seekforward", () => { if (audio.current) audio.current.currentTime += 10; });
    return () => {
      for (const action of ["play", "pause", "nexttrack", "seekbackward", "seekforward"] as const)
        navigator.mediaSession.setActionHandler(action, null);
    };
  }, [active?.id, visible, playAll]);

  // Learn the real length of older recordings the first time they are played.
  function rememberLength(seconds: number) {
    setLength(seconds);
    if (active && active.durationSeconds == null && Number.isFinite(seconds) && seconds > 0) {
      void updateAudioLibraryItem(active.id, { durationSeconds: Math.round(seconds) })
        .then(() => queryClient.invalidateQueries({ queryKey: getListAudioLibraryQueryKey() }))
        .catch(() => {});
    }
  }

  function seek(event: ReactPointerEvent<HTMLDivElement>) {
    const element = audio.current;
    if (!element || !length || !Number.isFinite(length)) return;
    const box = event.currentTarget.getBoundingClientRect();
    let ratio = (event.clientX - box.left) / box.width;
    if (isArabic) ratio = 1 - ratio;
    element.currentTime = Math.min(length, Math.max(0, ratio * length));
  }

  async function saveTitle(item: AudioLibraryItem) {
    const title = draftTitle.trim();
    setRenaming(null);
    if ((item.title ?? "") === title) return;
    try {
      await updateAudioLibraryItem(item.id, { title: title || null });
      await queryClient.invalidateQueries({ queryKey: getListAudioLibraryQueryKey() });
    } catch {
      toast({ variant: "destructive", title: copy("Couldn't rename it. Please try again.", "تعذرت إعادة التسمية. حاول مجددًا.") });
    }
  }

  // Removal waits a few seconds so "Undo" can bring it back without losing its name.
  function remove(item: AudioLibraryItem) {
    if (activeId === item.id) { audio.current?.pause(); setActiveId(null); }
    setHidden((current) => new Set(current).add(item.id));
    const restore = () => {
      window.clearTimeout(pendingDeletes.current.get(item.id));
      pendingDeletes.current.delete(item.id);
      setHidden((current) => { const copySet = new Set(current); copySet.delete(item.id); return copySet; });
    };
    const timer = window.setTimeout(async () => {
      pendingDeletes.current.delete(item.id);
      try {
        await deleteAudioLibraryItem(item.id);
        await queryClient.invalidateQueries({ queryKey: getListAudioLibraryQueryKey() });
      } catch {
        restore();
        toast({ variant: "destructive", title: copy("Couldn't remove it. It's still in your library.", "تعذرت الإزالة. لا يزال في مكتبتك.") });
      }
    }, 6000);
    pendingDeletes.current.set(item.id, timer);
    toast({
      title: copy("Removed from the audio library", "أُزيل من مكتبة الصوت"),
      description: item.sourceSubjectId
        ? copy("The idea in your notebook still has its recording.", "الفكرة في دفترك ما زالت تحتفظ بتسجيلها.")
        : undefined,
      action: <ToastAction altText={copy("Undo", "تراجع")} onClick={restore}>{copy("Undo", "تراجع")}</ToastAction>,
    });
  }

  // Finish pending removals if the page is left before the undo window ends.
  useEffect(() => () => {
    for (const [id, timer] of pendingDeletes.current) {
      window.clearTimeout(timer);
      void deleteAudioLibraryItem(id).catch(() => {});
    }
  }, []);

  const togglePick = (id: number) => setPicked((list) => (list.includes(id) ? list.filter((value) => value !== id) : [...list, id]));
  const movePick = (index: number, delta: number) => setPicked((list) => {
    const next = [...list];
    const target = index + delta;
    if (target < 0 || target >= next.length) return list;
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const endSelecting = () => { setSelecting(false); setPicked([]); setJoinOpen(false); setJoinTitle(""); };

  async function join() {
    setJoining(true);
    try {
      await joinAudioLibraryItems({ itemIds: picked, ...(joinTitle.trim() ? { title: joinTitle.trim() } : {}) });
      await queryClient.invalidateQueries({ queryKey: getListAudioLibraryQueryKey() });
      toast({ title: copy("Recordings joined", "تم دمج التسجيلات"), description: copy("The new recording is at the top. The originals are unchanged.", "التسجيل الجديد في الأعلى. الأصول لم تتغير.") });
      setSort("newest");
      endSelecting();
    } catch (error) {
      toast({ variant: "destructive", title: copy("Couldn't join them", "تعذر الدمج"), description: (error as { data?: { error?: string } })?.data?.error });
    } finally {
      setJoining(false);
    }
  }

  async function restore(item: AudioLibraryItem) {
    try {
      if (activeId === item.id) { audio.current?.pause(); setActiveId(null); }
      await restoreAudioLibraryItem(item.id);
      await queryClient.invalidateQueries({ queryKey: getListAudioLibraryQueryKey() });
      toast({ title: copy("Original restored", "تمت استعادة الأصل") });
    } catch (error) {
      toast({ variant: "destructive", title: copy("Couldn't restore it", "تعذرت الاستعادة"), description: (error as { data?: { error?: string } })?.data?.error });
    }
  }

  let lastDay = "";
  const grouped = sort === "newest" || sort === "oldest";

  return (
    <main className="mx-auto max-w-3xl px-4 pb-40 pt-2 sm:px-8">
      <audio
        ref={audio}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setPosition(0); if (playAll) next(); }}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => {
          const element = event.currentTarget;
          element.playbackRate = speed;
          if (Number.isFinite(element.duration)) rememberLength(element.duration);
        }}
        onDurationChange={(event) => { if (Number.isFinite(event.currentTarget.duration)) rememberLength(event.currentTarget.duration); }}
        className="hidden"
      />

      <div className="mt-1 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-medium">
            <Headphones size={22} className="shrink-0 text-primary" />{copy("Audio library", "مكتبة الصوت")}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {copy(`${visible.length} recordings`, `${visible.length} تسجيل`)}
            {totalSeconds > 0 && ` · ${clock(totalSeconds)}`}
            <span className="hidden sm:inline"> · {copy("separate from your notebooks", "مستقلة عن دفاترك")}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            {...talk}
            disabled={!ready || !!rescue || stage !== "idle"}
            aria-label={copy("Record into the library: tap, or hold to talk", "سجّل في المكتبة: انقر أو اضغط مطولًا وتحدث")}
            title={copy("Tap to record, or hold to talk", "انقر للتسجيل أو اضغط مطولًا وتحدث")}
            className="inline-flex h-9 touch-none select-none items-center gap-1.5 rounded-full bg-gradient-to-br from-rose-500 to-red-600 ps-2.5 pe-3.5 text-sm font-semibold text-white shadow-md shadow-red-500/25 transition active:scale-95 disabled:opacity-50 [-webkit-touch-callout:none]"
          >
            <Mic size={16} />{copy("Record", "سجّل")}
          </button>
          <Button size="sm" variant="outline" className="h-9 rounded-full px-3" disabled={!visible.length} onClick={() => { setPlayAll(true); play(visible[0]); }} aria-label={copy("Play all", "تشغيل الكل")}>
            <ListMusic size={16} /><span className="ms-1.5 hidden min-[420px]:inline">{copy("Play all", "تشغيل الكل")}</span>
          </Button>
        </div>
      </div>
      {pendingHere > 0 && (
        <p className="mt-2 flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-2 text-xs font-medium text-primary" role="status">
          <Loader2 size={14} className="animate-spin" />
          {copy(
            `${pendingHere} new recording${pendingHere > 1 ? "s" : ""} saving to the library… ${online ? "" : "It uploads when you're online."}`,
            `${pendingHere} تسجيل جديد يُحفظ في المكتبة… ${online ? "" : "سيُرفع عند الاتصال."}`,
          )}
        </p>
      )}

      <div className="sticky top-0 z-20 -mx-4 mt-3 flex items-center gap-2 bg-background/90 px-4 py-2 backdrop-blur sm:-mx-8 sm:px-8">
        <label className="relative flex h-10 min-w-0 flex-1 items-center rounded-full border bg-card ps-9 pe-3 focus-within:border-primary">
          <Search size={15} className="absolute start-3.5 text-muted-foreground" />
          <span className="sr-only">{copy("Filter recordings", "تصفية التسجيلات")}</span>
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            data-bare-field
            dir="auto"
            placeholder={copy("Filter", "تصفية")}
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          {filter && <button type="button" aria-label={copy("Clear", "مسح")} onClick={() => setFilter("")} className="text-muted-foreground"><X size={15} /></button>}
        </label>
        <label className="relative inline-flex h-10 shrink-0 items-center rounded-full border bg-card ps-3 pe-8 text-sm">
          <ArrowUpDown size={14} className="me-1.5 text-muted-foreground" />
          <span className="sr-only">{copy("Sort", "ترتيب")}</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as Sort)} className="cursor-pointer appearance-none bg-transparent font-medium outline-none">
            <option value="newest">{copy("Newest", "الأحدث")}</option>
            <option value="oldest">{copy("Oldest", "الأقدم")}</option>
            <option value="longest">{copy("Longest", "الأطول")}</option>
            <option value="shortest">{copy("Shortest", "الأقصر")}</option>
            <option value="title">{copy("A–Z", "أبجديًا")}</option>
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute end-2.5 text-muted-foreground" />
        </label>
        <button
          type="button"
          onClick={() => (selecting ? endSelecting() : setSelecting(true))}
          aria-pressed={selecting}
          aria-label={selecting ? copy("Cancel selecting", "إلغاء التحديد") : copy("Select recordings to join", "حدد تسجيلات للدمج")}
          title={copy("Select to join", "حدد للدمج")}
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border transition-colors ${selecting ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}
        >
          {selecting ? <X size={16} /> : <ListChecks size={17} />}
        </button>
      </div>
      {selecting && (
        <p className="mb-1 text-xs text-muted-foreground">{copy("Tap recordings in the order you want them joined.", "انقر على التسجيلات بالترتيب الذي تريد دمجها به.")}</p>
      )}

      {isLoading ? (
        <div className="mt-2 divide-y overflow-hidden rounded-2xl border bg-card" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="flex items-center gap-3 px-3 py-3">
              <div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
              <div className="flex-1 space-y-1.5"><div className="h-3 w-2/3 animate-pulse rounded bg-muted" /><div className="h-2.5 w-1/3 animate-pulse rounded bg-muted" /></div>
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="mt-10 text-center" role="alert">
          <p className="text-muted-foreground">{copy("Your library couldn't be loaded.", "تعذر تحميل مكتبتك.")}</p>
          <Button variant="outline" className="mt-3 rounded-full" onClick={() => void refetch()}>{copy("Try again", "حاول مجددًا")}</Button>
        </div>
      ) : !visible.length ? (
        <div className="mt-4 rounded-2xl border border-dashed px-6 py-10 text-center">
          <Headphones size={24} className="mx-auto text-primary" />
          <p className="mt-3 font-medium">{filter ? copy("No recordings match", "لا توجد تسجيلات مطابقة") : copy("Your library is empty", "مكتبتك فارغة")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {filter ? copy("Try other words.", "جرّب كلمات أخرى.") : copy("Every voice note you record is added here automatically.", "كل ملاحظة صوتية تسجلها تُضاف هنا تلقائيًا.")}
          </p>
        </div>
      ) : (
        <ul className="mt-2 divide-y overflow-hidden rounded-2xl border bg-card">
          {visible.map((item) => {
            const captured = new Date(item.capturedAt);
            const day = dayFormat.format(captured);
            const header = grouped && day !== lastDay ? day : null;
            lastDay = day;
            const current = item.id === activeId;
            const total = current ? length ?? item.durationSeconds : item.durationSeconds;
            const progress = current && total ? Math.min(100, (position / total) * 100) : 0;
            const title = displayTitle(item, fallbackTitle);
            const open = expanded === item.id;
            return (
              <li key={item.id}>
                {header && (
                  <p className="bg-muted/50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{header}</p>
                )}
                <div className={`relative flex items-center gap-2.5 py-2 ps-2.5 pe-1.5 transition-colors ${current ? "bg-primary/[0.06]" : "hover:bg-muted/40"}`}>
                  {selecting ? (
                    <button
                      type="button"
                      onClick={() => togglePick(item.id)}
                      aria-pressed={picked.includes(item.id)}
                      aria-label={copy(`Select ${title}`, `تحديد ${title}`)}
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 text-sm font-bold transition ${picked.includes(item.id) ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30 text-transparent"}`}
                    >
                      {picked.includes(item.id) ? picked.indexOf(item.id) + 1 : "·"}
                    </button>
                  ) : (
                  <button
                    type="button"
                    onClick={() => { setPlayAll(false); play(item); }}
                    aria-label={current && playing ? copy(`Pause ${title}`, `إيقاف ${title} مؤقتًا`) : copy(`Play ${title}`, `تشغيل ${title}`)}
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition active:scale-95 ${current ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary hover:bg-primary/15"}`}
                  >
                    {current && playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ms-0.5 rtl:-scale-x-100" />}
                  </button>
                  )}
                  {renaming === item.id ? (
                    <form className="flex min-w-0 flex-1 gap-1.5" onSubmit={(event) => { event.preventDefault(); void saveTitle(item); }}>
                      <input
                        autoFocus
                        dir="auto"
                        value={draftTitle}
                        maxLength={200}
                        onChange={(event) => setDraftTitle(event.target.value)}
                        onKeyDown={(event) => { if (event.key === "Escape") setRenaming(null); }}
                        placeholder={displayTitle({ title: null, transcript: item.transcript }, fallbackTitle)}
                        aria-label={copy("Recording name", "اسم التسجيل")}
                        className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-2.5 text-sm outline-none focus:border-primary"
                      />
                      <Button type="submit" size="icon" className="h-9 w-9 shrink-0 rounded-lg" aria-label={copy("Save name", "حفظ الاسم")}><Check size={15} /></Button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => (selecting ? togglePick(item.id) : setExpanded(open ? null : item.id))}
                      aria-expanded={open}
                      className="min-w-0 flex-1 py-0.5 text-start"
                    >
                      <span dir="auto" className="block truncate text-sm font-medium leading-5">{title}</span>
                      <span className="block truncate text-xs leading-5 text-muted-foreground">
                        {grouped ? timeFormat.format(captured) : dayFormat.format(captured)}
                        {" · "}
                        <span className="tabular-nums">{current ? `${clock(position)} / ${clock(total)}` : clock(total)}</span>
                        {item.sourceSubjectTitle && ` · ${item.sourceSubjectTitle}`}
                        {item.edited && <> · <span className="font-medium text-primary">{copy("edited", "معدّل")}</span></>}
                      </span>
                    </button>
                  )}
                  <a
                    href={appPath(item.url, import.meta.env.BASE_URL)}
                    download={`${title.replace(/[<>:"/\\|?*]/g, "-").slice(0, 60)}.${item.mimeType?.includes("mp4") ? "m4a" : "webm"}`}
                    aria-label={copy(`Download ${title}`, `تنزيل ${title}`)}
                    title={copy("Download", "تنزيل")}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <Download size={16} />
                  </a>
                  <button
                    type="button"
                    onClick={() => setConfirm(item)}
                    aria-label={copy(`Remove ${title} from the library`, `إزالة ${title} من المكتبة`)}
                    title={copy("Remove from library", "إزالة من المكتبة")}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 size={16} />
                  </button>
                  {current && (
                    <div
                      role="slider"
                      tabIndex={0}
                      aria-label={copy("Position", "الموضع")}
                      aria-valuemin={0}
                      aria-valuemax={Math.round(total ?? 0)}
                      aria-valuenow={Math.round(position)}
                      onPointerDown={seek}
                      onKeyDown={(event) => {
                        if (!audio.current) return;
                        if (event.key === "ArrowRight") audio.current.currentTime += isArabic ? -5 : 5;
                        if (event.key === "ArrowLeft") audio.current.currentTime += isArabic ? 5 : -5;
                      }}
                      className="absolute inset-x-0 bottom-0 h-2.5 cursor-pointer touch-none"
                    >
                      <div className="absolute inset-x-0 bottom-0 h-[3px] bg-primary/15">
                        <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${progress}%` }} />
                      </div>
                    </div>
                  )}
                </div>
                {open && (
                  <div className="space-y-2 bg-muted/20 px-3 pb-3 pt-1 ps-[3.6rem]">
                    {item.transcript && (
                      <p dir="auto" className="whitespace-pre-wrap text-sm leading-6 text-foreground/80">{item.transcript}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                      <button type="button" className="inline-flex items-center gap-1 font-medium text-primary hover:underline" onClick={() => { setDraftTitle(item.title ?? ""); setRenaming(item.id); }}>
                        <Pencil size={12} />{copy("Rename", "إعادة تسمية")}
                      </button>
                      <button type="button" className="inline-flex items-center gap-1 font-medium text-primary hover:underline" onClick={() => { if (activeId === item.id) audio.current?.pause(); setEditing(item); }}>
                        <Scissors size={12} />{copy("Edit audio (cut)", "تحرير الصوت (قص)")}
                      </button>
                      {item.edited && (
                        <button type="button" className="inline-flex items-center gap-1 font-medium text-primary hover:underline" onClick={() => setRestoring(item)}>
                          <RotateCcw size={12} />{copy("Restore original", "استعادة الأصل")}
                        </button>
                      )}
                      {item.sourceSubjectId && item.sourceIdeaId ? (
                        <Link href={`/subjects/${item.sourceSubjectId}#idea-${item.sourceIdeaId}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                          {copy("Open in", "افتح في")} {item.sourceSubjectTitle}<ArrowUpRight size={12} />
                        </Link>
                      ) : item.sourceSubjectTitle ? (
                        <span className="text-muted-foreground">{copy("Original idea deleted; this copy is kept.", "حُذفت الفكرة الأصلية؛ هذه النسخة محفوظة.")}</span>
                      ) : null}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {active && (
        <div className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-xl items-center gap-3 rounded-2xl bg-[hsl(158_38%_14%)] p-2.5 pe-4 text-white shadow-2xl md:bottom-6">
          <button
            type="button"
            onClick={() => play(active)}
            aria-label={playing ? copy("Pause", "إيقاف مؤقت") : copy("Play", "تشغيل")}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-[hsl(158_38%_14%)]"
          >
            {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ms-0.5 rtl:-scale-x-100" />}
          </button>
          <div className="min-w-0 flex-1">
            <p dir="auto" className="truncate text-sm font-semibold">{displayTitle(active, fallbackTitle)}</p>
            <p className="text-xs tabular-nums text-white/60">{clock(position)} / {clock(length ?? active.durationSeconds)}{playAll && ` · ${copy("playing all", "تشغيل الكل")}`}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              const following = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
              setSpeed(following);
              if (audio.current) audio.current.playbackRate = following;
            }}
            aria-label={copy("Playback speed", "سرعة التشغيل")}
            className="h-8 min-w-11 rounded-full border border-white/25 px-2 text-xs font-semibold tabular-nums hover:bg-white/10"
          >
            {speed}×
          </button>
          {playAll && (
            <button type="button" onClick={next} aria-label={copy("Next recording", "التسجيل التالي")} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10">
              <SkipForward size={15} className="rtl:-scale-x-100" />
            </button>
          )}
          <button type="button" aria-label={copy("Close player", "إغلاق المشغل")} onClick={() => { audio.current?.pause(); setActiveId(null); setPlayAll(false); }} className="grid h-8 w-8 place-items-center rounded-full text-white/70 hover:bg-white/10">
            <X size={16} />
          </button>
        </div>
      )}

      {selecting && (
        <div className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-xl items-center gap-3 rounded-2xl bg-[hsl(158_38%_14%)] p-2.5 ps-4 text-white shadow-2xl md:bottom-6">
          <p className="min-w-0 flex-1 text-sm">
            {picked.length < 2 ? copy("Select 2 or more recordings", "حدد تسجيلين أو أكثر") : copy(`${picked.length} selected`, `${picked.length} محددة`)}
          </p>
          <Button variant="ghost" className="h-10 rounded-full text-white hover:bg-white/10 hover:text-white" onClick={endSelecting}>{copy("Cancel", "إلغاء")}</Button>
          <Button className="h-10 rounded-full bg-white px-4 text-[hsl(158_38%_14%)] hover:bg-white/90" disabled={picked.length < 2} onClick={() => setJoinOpen(true)}>
            <Merge size={16} className="me-1.5" />{copy("Join", "دمج")}
          </Button>
        </div>
      )}

      {editing && <AudioEditor item={editing} title={displayTitle(editing, fallbackTitle)} onClose={() => setEditing(null)} />}

      <AlertDialog open={!!restoring} onOpenChange={(open) => { if (!open) setRestoring(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy("Restore the original recording?", "استعادة التسجيل الأصلي؟")}</AlertDialogTitle>
            <AlertDialogDescription>{copy("Your cuts will be undone and the full recording comes back.", "ستُلغى التعديلات ويعود التسجيل كاملًا.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{copy("Keep the edit", "احتفظ بالتعديل")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (restoring) void restore(restoring); setRestoring(null); }}>{copy("Restore original", "استعادة الأصل")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={joinOpen} onOpenChange={(open) => { if (!joining) setJoinOpen(open); }}>
        <DialogContent className="max-w-md">
          <DialogTitle>{copy("Join recordings", "دمج التسجيلات")}</DialogTitle>
          <DialogDescription>{copy("They play one after another in this order. The originals stay as they are.", "تُشغَّل بالتتابع بهذا الترتيب. تبقى الأصول كما هي.")}</DialogDescription>
          <ol className="max-h-72 divide-y overflow-y-auto rounded-xl border">
            {picked.map((id, index) => {
              const entry = items.find((item) => item.id === id);
              if (!entry) return null;
              return (
                <li key={id} className="flex items-center gap-2 px-3 py-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{index + 1}</span>
                  <span dir="auto" className="min-w-0 flex-1 truncate text-sm">{displayTitle(entry, fallbackTitle)}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">{clock(entry.durationSeconds)}</span>
                  <button type="button" disabled={index === 0} onClick={() => movePick(index, -1)} aria-label={copy("Move up", "تحريك للأعلى")} className="grid h-8 w-8 place-items-center rounded-full hover:bg-secondary disabled:opacity-30"><ArrowUp size={14} /></button>
                  <button type="button" disabled={index === picked.length - 1} onClick={() => movePick(index, 1)} aria-label={copy("Move down", "تحريك للأسفل")} className="grid h-8 w-8 place-items-center rounded-full hover:bg-secondary disabled:opacity-30"><ArrowDown size={14} /></button>
                </li>
              );
            })}
          </ol>
          <label className="block text-sm font-medium">
            {copy("Name", "الاسم")} <span className="font-normal text-muted-foreground">{copy("(optional)", "(اختياري)")}</span>
            <input value={joinTitle} onChange={(event) => setJoinTitle(event.target.value)} maxLength={200} dir="auto"
              placeholder={copy("Joined recording", "تسجيل مدمج")}
              className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:border-primary" />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={joining} onClick={() => setJoinOpen(false)}>{copy("Back", "رجوع")}</Button>
            <Button disabled={joining || picked.length < 2} onClick={() => void join()}>
              {joining ? <Loader2 size={16} className="me-2 animate-spin" /> : <Merge size={16} className="me-2" />}
              {joining ? copy("Joining…", "جارٍ الدمج…") : copy(`Join ${picked.length}`, `دمج ${picked.length}`)}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirm} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy("Remove from the audio library?", "إزالة من مكتبة الصوت؟")}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.sourceSubjectId
                ? copy(`Only this library copy is removed. The idea in “${confirm.sourceSubjectTitle}” keeps its recording.`, `تُزال نسخة المكتبة فقط. الفكرة في «${confirm.sourceSubjectTitle}» تحتفظ بتسجيلها.`)
                : copy("Only this library copy is removed.", "تُزال نسخة المكتبة فقط.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{copy("Keep it", "احتفظ به")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (confirm) remove(confirm); setConfirm(null); }}>
              {copy("Remove from library", "إزالة من المكتبة")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
