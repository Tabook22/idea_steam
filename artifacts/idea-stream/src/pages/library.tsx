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
  BookOpen,
  MoreVertical,
  ListMusic,
  Merge,
  RotateCcw,
  Bookmark,
  Sparkles,
  Scissors,
  Wand2,
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
  makeAudioLibraryChapters,
  getListAudioLibraryQueryKey,
  updateAudioLibraryItem,
  useListAudioLibrary,
  type AudioLibraryItem,
} from "@workspace/api-client-react";
import { appPath } from "@/lib/app-path";
import { useRecorder } from "@/components/recorder-provider";
import { AudioEditor } from "@/components/audio-editor";
import { ExportDialog } from "@/components/export-dialog";
import { SoundLab } from "@/components/sound-lab";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { usePressToTalk } from "@/components/press-to-talk";
import { useRecorderPrefs } from "@/lib/recorder-prefs";
import { useLanguage } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
type Quick = "all" | "marked" | "edited" | "notebooks" | "library";
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

/** Totals in words: "45 s", "39 min", "1 h 12 min" (Arabic: "45 ث", "39 د", "1 س 12 د"). */
const longClock = (seconds: number, arabic = false) => {
  const [s, m, h] = arabic ? ["ث", "د", "س"] : ["s", "min", "h"];
  if (seconds < 60) return `${Math.round(seconds)} ${s}`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} ${m}` : `${Math.floor(minutes / 60)} ${h}${minutes % 60 ? ` ${minutes % 60} ${m}` : ""}`;
};

const quickMatch = (item: AudioLibraryItem, quick: Quick) =>
  quick === "marked" ? item.marks.length > 0
  : quick === "edited" ? item.edited
  : quick === "notebooks" ? !!item.sourceSubjectTitle
  : quick === "library" ? !item.sourceSubjectTitle
  : true;

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
  const [quick, setQuick] = useState<Quick>("all");
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
  const [exporting, setExporting] = useState<AudioLibraryItem | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinTitle, setJoinTitle] = useState("");
  const [joining, setJoining] = useState(false);
  const [improving, setImproving] = useState<AudioLibraryItem | null>(null);
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
    const list = items.filter((item) => !hidden.has(item.id) && quickMatch(item, quick) && (!needle ||
      [item.title, item.transcript, item.sourceSubjectTitle].some((text) => text?.toLocaleLowerCase().includes(needle))));
    const time = (item: AudioLibraryItem) => Date.parse(item.capturedAt);
    const len = (item: AudioLibraryItem) => item.durationSeconds ?? -1;
    return [...list].sort((a, b) =>
      sort === "oldest" ? time(a) - time(b)
      : sort === "longest" ? len(b) - len(a) || time(b) - time(a)
      : sort === "shortest" ? (len(a) < 0 ? 1 : len(b) < 0 ? -1 : len(a) - len(b))
      : sort === "title" ? displayTitle(a, fallbackTitle).localeCompare(displayTitle(b, fallbackTitle), language)
      : time(b) - time(a));
  }, [items, hidden, filter, quick, sort, language, fallbackTitle]);

  const active = items.find((item) => item.id === activeId) ?? null;
  const kept = items.filter((item) => !hidden.has(item.id));
  const libraryTotal = kept.reduce((sum, item) => sum + (item.durationSeconds ?? 0), 0);
  const thisWeek = kept.filter((item) => Date.now() - Date.parse(item.capturedAt) < 7 * 86_400_000).length;
  const quickFilters: [Quick, string, number][] = ([
    ["all", copy("All", "الكل")],
    ["marked", copy("Bookmarked", "بعلامات")],
    ["edited", copy("Edited", "معدّلة")],
    ["notebooks", copy("From notebooks", "من الدفاتر")],
    ["library", copy("Library only", "المكتبة فقط")],
  ] as const).map(([id, label]) => [id, label, kept.filter((item) => quickMatch(item, id)).length] as [Quick, string, number])
    .filter(([id, , count]) => id === "all" || id === quick || count > 0);
  const timeFormat = useMemo(() => new Intl.DateTimeFormat(language, { hour: "numeric", minute: "2-digit" }), [language]);
  const shortDayFormat = useMemo(() => new Intl.DateTimeFormat(language, { day: "numeric", month: "short" }), [language]);

  /** "Today", "Yesterday", a weekday this week, then the date. */
  const dayLabel = (date: Date) => {
    const startOf = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
    const days = Math.round((startOf(new Date()) - startOf(date)) / 86_400_000);
    if (days < 2) {
      const word = new Intl.RelativeTimeFormat(language, { numeric: "auto" }).format(-days, "day");
      return word.charAt(0).toLocaleUpperCase(language) + word.slice(1);
    }
    if (days < 7) return new Intl.DateTimeFormat(language, { weekday: "long" }).format(date);
    return new Intl.DateTimeFormat(language, { day: "numeric", month: "long", ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) }).format(date);
  };

  const pendingSeek = useRef<number | null>(null);
  const [chaptering, setChaptering] = useState<number | null>(null);
  /** Plays a recording from a given second (used by bookmarks and chapters). */
  function playAt(item: AudioLibraryItem, seconds: number) {
    const element = audio.current;
    if (!element) return;
    setPlayAll(false);
    if (activeId === item.id) {
      element.currentTime = seconds;
      void element.play().catch(() => {});
      return;
    }
    pendingSeek.current = seconds;
    play(item);
  }
  async function makeChapters(item: AudioLibraryItem) {
    setChaptering(item.id);
    try {
      await makeAudioLibraryChapters(item.id);
      await queryClient.invalidateQueries({ queryKey: getListAudioLibraryQueryKey() });
    } catch (error) {
      toast({ variant: "destructive", title: copy("Couldn't make chapters", "تعذر إنشاء الفصول"), description: (error as { data?: { error?: string } })?.data?.error });
    } finally {
      setChaptering(null);
    }
  }

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
    // The bar always runs left to right, like the times beside it.
    const ratio = (event.clientX - box.left) / box.width;
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

  const grouped = sort === "newest" || sort === "oldest";
  const groups: { key: string; label: string | null; items: AudioLibraryItem[]; seconds: number }[] = [];
  for (const item of visible) {
    const date = new Date(item.capturedAt);
    const key = grouped ? date.toDateString() : "all";
    let group = groups.at(-1);
    if (!group || group.key !== key) groups.push(group = { key, label: grouped ? dayLabel(date) : null, items: [], seconds: 0 });
    group.items.push(item);
    group.seconds += item.durationSeconds ?? 0;
  }

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
          if (pendingSeek.current !== null) { element.currentTime = pendingSeek.current; pendingSeek.current = null; }
          if (Number.isFinite(element.duration)) rememberLength(element.duration);
        }}
        onDurationChange={(event) => { if (Number.isFinite(event.currentTarget.duration)) rememberLength(event.currentTarget.duration); }}
        className="hidden"
      />

      <header className="mt-1 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-medium">
            <Headphones size={22} className="shrink-0 text-primary" />{copy("Audio library", "مكتبة الصوت")}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {copy("Your recordings, separate from your notebooks", "تسجيلاتك، مستقلة عن دفاترك")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          {...talk}
          disabled={!ready || !!rescue || stage !== "idle"}
          aria-label={copy("Record into the library: tap, or hold to talk", "سجّل في المكتبة: انقر أو اضغط مطولًا وتحدث")}
          title={copy("Tap to record, or hold to talk", "انقر للتسجيل أو اضغط مطولًا وتحدث")}
          className="inline-flex h-10 shrink-0 touch-none select-none items-center gap-1.5 rounded-full bg-gradient-to-br from-rose-500 to-red-600 ps-3 pe-4 text-sm font-semibold text-ink-foreground shadow-md shadow-red-500/25 transition active:scale-95 disabled:opacity-50 [-webkit-touch-callout:none]"
        >
          <Mic size={16} />{copy("Record", "سجّل")}
        </button>
        <Button size="sm" variant="outline" className="h-10 shrink-0 rounded-full px-3" disabled={!visible.length} onClick={() => { setPlayAll(true); play(visible[0]); }} aria-label={copy("Play all", "تشغيل الكل")} title={copy("Play all", "تشغيل الكل")}>
          <ListMusic size={16} /><span className="ms-1.5 hidden sm:inline">{copy("Play all", "تشغيل الكل")}</span>
        </Button>
        </div>
      </header>

      {items.length > 0 && (
        <dl className="mt-4 grid grid-cols-3 gap-2" aria-label={copy("Library at a glance", "المكتبة باختصار")}>
          {([
            [copy("Recordings", "التسجيلات"), String(items.length - hidden.size)],
            [copy("Total time", "المدة الكلية"), longClock(libraryTotal, isArabic)],
            [copy("This week", "هذا الأسبوع"), String(thisWeek)],
          ] as const).map(([label, value]) => (
            <div key={label} className="rounded-2xl border bg-card px-3 py-2">
              <dt className="truncate text-[11px] font-medium text-muted-foreground">{label}</dt>
              <dd className="text-base font-semibold tabular-nums leading-6">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {pendingHere > 0 && (
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-2 text-xs font-medium text-primary" role="status">
          <Loader2 size={14} className="animate-spin" />
          {copy(
            `${pendingHere} new recording${pendingHere > 1 ? "s" : ""} saving to the library… ${online ? "" : "It uploads when you're online."}`,
            `${pendingHere} تسجيل جديد يُحفظ في المكتبة… ${online ? "" : "سيُرفع عند الاتصال."}`,
          )}
        </p>
      )}

      <div className="sticky top-0 z-20 -mx-4 mt-3 bg-background/90 px-4 pb-2 pt-2 backdrop-blur sm:-mx-8 sm:px-8">
        <div className="flex items-center gap-2">
          <label className="relative flex h-10 min-w-0 flex-1 items-center rounded-full border bg-card ps-9 pe-3 focus-within:border-primary">
            <Search size={15} className="absolute start-3.5 text-muted-foreground" />
            <span className="sr-only">{copy("Search recordings", "ابحث في التسجيلات")}</span>
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              data-bare-field
              dir="auto"
              placeholder={copy("Search names and words", "ابحث في الأسماء والكلمات")}
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
            {selecting ? <X size={16} /> : <Merge size={16} />}
          </button>
        </div>
        <div className="-mx-4 mt-2 flex items-center gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0" role="group" aria-label={copy("Show", "عرض")}>
          {quickFilters.map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              aria-pressed={quick === id}
              onClick={() => setQuick(id)}
              className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${quick === id ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}
            >
              {label}
              <span className={`tabular-nums ${quick === id ? "opacity-80" : "opacity-60"}`}>{count}</span>
            </button>
          ))}
        </div>
      </div>
      {selecting && (
        <p className="mb-1 mt-1 rounded-xl bg-primary/10 px-3 py-2 text-xs font-medium text-primary">{copy("Tap recordings in the order you want them joined.", "انقر على التسجيلات بالترتيب الذي تريد دمجها به.")}</p>
      )}

      {isLoading ? (
        <div className="mt-2 divide-y overflow-hidden rounded-2xl border bg-card" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="flex items-center gap-3 px-3 py-3.5">
              <div className="h-11 w-11 animate-pulse rounded-full bg-muted" />
              <div className="flex-1 space-y-2"><div className="h-3 w-2/3 animate-pulse rounded bg-muted" /><div className="h-2.5 w-1/3 animate-pulse rounded bg-muted" /></div>
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="mt-10 text-center" role="alert">
          <p className="text-muted-foreground">{copy("Your library couldn't be loaded.", "تعذر تحميل مكتبتك.")}</p>
          <Button variant="outline" className="mt-3 rounded-full" onClick={() => void refetch()}>{copy("Try again", "حاول مجددًا")}</Button>
        </div>
      ) : !visible.length ? (
        <div className="mt-4 rounded-3xl border border-dashed bg-card/50 px-6 py-12 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary"><Headphones size={26} /></span>
          <p className="mt-4 font-medium">
            {filter || quick !== "all" ? copy("Nothing matches", "لا توجد نتائج") : copy("Your library is empty", "مكتبتك فارغة")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {filter || quick !== "all"
              ? copy("Try other words or another filter.", "جرّب كلمات أو تصفية أخرى.")
              : copy("Tap Record, or record a voice note anywhere: it's added here automatically.", "انقر «سجّل» أو سجّل ملاحظة صوتية من أي مكان: تُضاف هنا تلقائيًا.")}
          </p>
          {(filter || quick !== "all") && (
            <Button variant="outline" className="mt-4 rounded-full" onClick={() => { setFilter(""); setQuick("all"); }}>{copy("Show everything", "اعرض الكل")}</Button>
          )}
        </div>
      ) : (
        <div className="mt-1 space-y-5">
          {groups.map((group) => (
            <section key={group.key} aria-label={group.label ?? copy("Recordings", "التسجيلات")}>
              {group.label && (
                <div className="mb-1.5 flex items-baseline justify-between px-1">
                  <h2 className="text-sm font-semibold">{group.label}</h2>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {group.items.length} · {longClock(group.seconds, isArabic)}
                  </span>
                </div>
              )}
              <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
                {group.items.map((item) => {
                  const captured = new Date(item.capturedAt);
                  const current = item.id === activeId;
                  const total = current ? length ?? item.durationSeconds : item.durationSeconds;
                  const progress = current && total ? Math.min(100, (position / total) * 100) : 0;
                  const title = displayTitle(item, fallbackTitle);
                  const open = expanded === item.id;
                  const snippet = item.title && item.transcript ? item.transcript.replace(/\s+/g, " ").trim() : null;
                  const picks = picked.indexOf(item.id);
                  return (
                    <li key={item.id} className={`transition-colors ${current ? "bg-primary/[0.05]" : open ? "bg-muted/30" : ""}`}>
                      <div className="flex items-start gap-3 py-3 ps-3 pe-1.5">
                        {selecting ? (
                          <button
                            type="button"
                            onClick={() => togglePick(item.id)}
                            aria-pressed={picks >= 0}
                            aria-label={copy(`Select ${title}`, `تحديد ${title}`)}
                            className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 text-sm font-bold transition ${picks >= 0 ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30 text-transparent"}`}
                          >
                            {picks >= 0 ? picks + 1 : "·"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => { setPlayAll(false); play(item); }}
                            aria-label={current && playing ? copy(`Pause ${title}`, `إيقاف ${title} مؤقتًا`) : copy(`Play ${title}`, `تشغيل ${title}`)}
                            className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full p-[3px] transition active:scale-95"
                            style={{ background: current ? `conic-gradient(hsl(var(--primary)) ${progress * 3.6}deg, hsl(var(--primary) / 0.15) 0)` : undefined }}
                          >
                            <span className={`grid h-full w-full place-items-center rounded-full ${current ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary hover:bg-primary/15"}`}>
                              {current && playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ms-0.5 rtl:-scale-x-100" />}
                            </span>
                          </button>
                        )}

                        {renaming === item.id ? (
                          <form className="flex min-w-0 flex-1 gap-1.5 pt-1" onSubmit={(event) => { event.preventDefault(); void saveTitle(item); }}>
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
                            className="min-w-0 flex-1 text-start"
                          >
                            <span className="flex items-start gap-2">
                              <span dir="auto" className={`min-w-0 flex-1 text-[15px] font-medium leading-5 ${open ? "" : "line-clamp-2"} ${item.title || item.transcript ? "" : "text-muted-foreground"}`}>{title}</span>
                              <span className="mt-px shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground" dir="ltr">
                                {current ? `${clock(position)} / ${clock(total)}` : clock(total)}
                              </span>
                            </span>
                            {snippet && !open && <span dir="auto" className="mt-0.5 block truncate text-xs leading-5 text-muted-foreground">{snippet}</span>}
                            <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] leading-4">
                              <span className="text-muted-foreground">{grouped ? timeFormat.format(captured) : shortDayFormat.format(captured)}</span>
                              {item.sourceSubjectTitle && (
                                <span className="inline-flex max-w-[11rem] items-center gap-1 rounded-full bg-secondary px-2 py-0.5 font-medium text-secondary-foreground">
                                  <BookOpen size={11} className="shrink-0" /><span dir="auto" className="truncate">{item.sourceSubjectTitle}</span>
                                </span>
                              )}
                              {item.edited && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary"><Scissors size={11} />{copy("Edited", "معدّل")}</span>
                              )}
                              {item.marks.length > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"><Bookmark size={11} />{item.marks.length}</span>
                              )}
                              {item.chapters && item.chapters.length > 1 && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 font-medium text-violet-900 dark:bg-violet-900/40 dark:text-violet-100"><Sparkles size={11} />{copy(`${item.chapters.length} chapters`, `${item.chapters.length} فصول`)}</span>
                              )}
                            </span>
                          </button>
                        )}

                        {!selecting && (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              aria-label={copy(`More for ${title}`, `المزيد لـ ${title}`)}
                              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground data-[state=open]:bg-secondary"
                            >
                              <MoreVertical size={17} />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              <DropdownMenuItem onSelect={() => setExporting(item)}><Download size={15} />{copy("Download as MP3, WAV…", "تنزيل MP3، WAV…")}</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => { if (activeId === item.id) audio.current?.pause(); setEditing(item); }}><Scissors size={15} />{copy("Edit audio (cut)", "تحرير الصوت (قص)")}</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setImproving(item)}><Wand2 size={15} />{copy("Sound lab: improve sound", "مختبر الصوت: تحسين")}</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => { setDraftTitle(item.title ?? ""); setRenaming(item.id); }}><Pencil size={15} />{copy("Rename", "إعادة تسمية")}</DropdownMenuItem>
                              {item.edited && <DropdownMenuItem onSelect={() => setRestoring(item)}><RotateCcw size={15} />{copy("Restore original", "استعادة الأصل")}</DropdownMenuItem>}
                              {item.sourceSubjectId && item.sourceIdeaId && (
                                <DropdownMenuItem asChild>
                                  <Link href={`/subjects/${item.sourceSubjectId}#idea-${item.sourceIdeaId}`}><ArrowUpRight size={15} /><span dir="auto" className="truncate">{copy("Open in", "افتح في")} {item.sourceSubjectTitle}</span></Link>
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onSelect={() => setConfirm(item)} className="text-destructive focus:bg-destructive/10 focus:text-destructive"><Trash2 size={15} />{copy("Remove from library", "إزالة من المكتبة")}</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>

                      {current && (
                        <div className="flex items-center gap-2 pb-3 pe-4 ps-[4.25rem] text-[11px] tabular-nums text-muted-foreground" dir="ltr">
                          <span>{clock(position)}</span>
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
                              if (event.key === "ArrowRight") audio.current.currentTime += 5;
                              if (event.key === "ArrowLeft") audio.current.currentTime -= 5;
                            }}
                            className="relative h-5 flex-1 cursor-pointer touch-none"
                          >
                            <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary/15">
                              <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${progress}%` }} />
                            </div>
                            {total ? item.marks.map((mark) => (
                              <span key={mark} className="pointer-events-none absolute top-1/2 h-3 w-1 -translate-y-1/2 rounded-full bg-amber-500" style={{ left: `${Math.min(100, (mark / total) * 100)}%` }} />
                            )) : null}
                            <span className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-primary shadow" style={{ left: `${progress}%` }} />
                          </div>
                          <span>{clock(total)}</span>
                        </div>
                      )}

                      {open && (
                        <div className="space-y-3 px-3 pb-4 sm:ps-[4.25rem]">
                          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                            {([
                              [Scissors, copy("Edit audio", "تحرير الصوت"), () => { if (activeId === item.id) audio.current?.pause(); setEditing(item); }],
                              [Wand2, copy("Sound lab", "مختبر الصوت"), () => setImproving(item)],
                              [Download, copy("Download as…", "تنزيل بصيغة…"), () => setExporting(item)],
                              [Pencil, copy("Rename", "إعادة تسمية"), () => { setDraftTitle(item.title ?? ""); setRenaming(item.id); }],
                            ] as const).map(([Icon, label, action]) => (
                              <Button key={label} size="sm" variant="outline" className="h-9 justify-start rounded-full bg-card" onClick={action}>
                                <Icon size={14} className="me-1.5 text-primary" />{label}
                              </Button>
                            ))}
                            {item.edited && (
                              <Button size="sm" variant="ghost" className="h-9 justify-start rounded-full" onClick={() => setRestoring(item)}>
                                <RotateCcw size={14} className="me-1.5" />{copy("Restore original", "استعادة الأصل")}
                              </Button>
                            )}
                          </div>

                          {item.marks.length > 0 && (
                            <div>
                              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{copy("Bookmarks", "العلامات")}</p>
                              <div className="flex flex-wrap gap-1.5">
                                {item.marks.map((mark) => (
                                  <button key={mark} type="button" onClick={() => playAt(item, mark)}
                                    className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium tabular-nums text-amber-900 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-100">
                                    <Bookmark size={11} />{clock(mark)}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {item.chapters ? (
                            <div className="rounded-2xl border bg-card p-3">
                              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><Sparkles size={12} className="text-violet-500" />{copy("Summary & chapters", "الملخص والفصول")}</p>
                              {item.summary && <p dir="auto" className="text-sm leading-6">{item.summary}</p>}
                              {item.chapters.length > 0 && (
                                <ol className="mt-2 space-y-0.5">
                                  {item.chapters.map((chapter) => (
                                    <li key={chapter.start}>
                                      <button type="button" onClick={() => playAt(item, chapter.start)} className="flex w-full items-baseline gap-2.5 rounded-lg px-2 py-1.5 text-start text-sm hover:bg-primary/5">
                                        <span className="shrink-0 rounded bg-primary/10 px-1.5 text-xs font-semibold tabular-nums text-primary">{clock(chapter.start)}</span>
                                        <span dir="auto" className="min-w-0">{chapter.title}</span>
                                      </button>
                                    </li>
                                  ))}
                                </ol>
                              )}
                            </div>
                          ) : (
                            <Button size="sm" variant="outline" className="h-9 rounded-full bg-card" disabled={chaptering === item.id} onClick={() => void makeChapters(item)}>
                              {chaptering === item.id ? <Loader2 size={14} className="me-1.5 animate-spin" /> : <Sparkles size={14} className="me-1.5 text-violet-500" />}
                              {chaptering === item.id ? copy("Reading and organising…", "جارٍ القراءة والتنظيم…") : copy("Make chapters & summary", "أنشئ فصولًا وملخصًا")}
                            </Button>
                          )}

                          {item.transcript && (
                            <div>
                              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{copy("Transcript", "النص")}</p>
                              <p dir="auto" className="whitespace-pre-wrap rounded-2xl bg-muted/40 px-3 py-2.5 text-sm leading-6 text-foreground/85">{item.transcript}</p>
                            </div>
                          )}

                          {item.sourceSubjectId && item.sourceIdeaId ? (
                            <Link href={`/subjects/${item.sourceSubjectId}#idea-${item.sourceIdeaId}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
                              <BookOpen size={13} />{copy("Open in", "افتح في")} <span dir="auto">{item.sourceSubjectTitle}</span><ArrowUpRight size={12} className="rtl:-scale-x-100" />
                            </Link>
                          ) : item.sourceSubjectTitle ? (
                            <p className="text-xs text-muted-foreground">{copy("Original idea deleted; this copy is kept.", "حُذفت الفكرة الأصلية؛ هذه النسخة محفوظة.")}</p>
                          ) : null}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {active && (
        <div className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-xl items-center gap-3 rounded-2xl bg-ink p-2.5 pe-4 text-ink-foreground shadow-2xl md:bottom-6">
          <button
            type="button"
            onClick={() => play(active)}
            aria-label={playing ? copy("Pause", "إيقاف مؤقت") : copy("Play", "تشغيل")}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-ink"
          >
            {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ms-0.5 rtl:-scale-x-100" />}
          </button>
          <div className="min-w-0 flex-1">
            <p dir="auto" className="truncate text-sm font-semibold">{displayTitle(active, fallbackTitle)}</p>
            <p className="text-xs tabular-nums text-ink-foreground/60">{clock(position)} / {clock(length ?? active.durationSeconds)}{playAll && ` · ${copy("playing all", "تشغيل الكل")}`}</p>
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
          <button type="button" aria-label={copy("Close player", "إغلاق المشغل")} onClick={() => { audio.current?.pause(); setActiveId(null); setPlayAll(false); }} className="grid h-8 w-8 place-items-center rounded-full text-ink-foreground/70 hover:bg-white/10">
            <X size={16} />
          </button>
        </div>
      )}

      {selecting && (
        <div className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-xl items-center gap-3 rounded-2xl bg-ink p-2.5 ps-4 text-ink-foreground shadow-2xl md:bottom-6">
          <p className="min-w-0 flex-1 text-sm">
            {picked.length < 2 ? copy("Select 2 or more recordings", "حدد تسجيلين أو أكثر") : copy(`${picked.length} selected`, `${picked.length} محددة`)}
          </p>
          <Button variant="ghost" className="h-10 rounded-full text-ink-foreground hover:bg-white/10 hover:text-ink-foreground" onClick={endSelecting}>{copy("Cancel", "إلغاء")}</Button>
          <Button className="h-10 rounded-full bg-white px-4 text-ink hover:bg-white/90" disabled={picked.length < 2} onClick={() => setJoinOpen(true)}>
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

      <ExportDialog item={exporting} title={exporting ? displayTitle(exporting, fallbackTitle) : ""} onClose={() => setExporting(null)} />

      {improving && <SoundLab item={improving} title={displayTitle(improving, fallbackTitle)} onClose={() => setImproving(null)} />}

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
