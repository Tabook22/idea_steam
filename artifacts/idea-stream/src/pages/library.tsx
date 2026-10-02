import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Download,
  Headphones,
  ListMusic,
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
  getListAudioLibraryQueryKey,
  updateAudioLibraryItem,
  useListAudioLibrary,
  type AudioLibraryItem,
} from "@workspace/api-client-react";
import { appPath } from "@/lib/app-path";
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
  const audio = useRef<HTMLAudioElement>(null);
  const pendingDeletes = useRef(new Map<number, number>());
  const fallbackTitle = copy("Voice note", "ملاحظة صوتية");

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

      <header className="relative mt-3 overflow-hidden rounded-[2rem] border bg-gradient-to-br from-[hsl(158_38%_14%)] to-[hsl(158_32%_22%)] px-6 py-8 text-[hsl(43_30%_95%)] shadow-sm sm:px-9">
        <div className="pointer-events-none absolute -end-10 -top-16 h-56 w-56 rounded-full bg-emerald-300/10 blur-2xl" aria-hidden="true" />
        <p className="relative flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-200/80">
          <Headphones size={14} />{copy("Audio library", "مكتبة الصوت")}
        </p>
        <h1 className="relative mt-3 text-4xl font-medium text-[hsl(43_30%_96%)]">{copy("Every recording, in one place", "كل تسجيلاتك في مكان واحد")}</h1>
        <p className="relative mt-3 max-w-lg text-sm leading-6 text-white/70">
          {copy(
            "A separate copy of each voice note. Listen any time. Removing one here never changes your notebooks.",
            "نسخة مستقلة من كل ملاحظة صوتية. استمع في أي وقت. الإزالة من هنا لا تغيّر دفاترك أبدًا.",
          )}
        </p>
        <div className="relative mt-6 flex flex-wrap items-center gap-3">
          <Button
            className="h-11 rounded-full bg-[hsl(43_30%_95%)] px-5 text-[hsl(158_38%_14%)] hover:bg-white"
            disabled={!visible.length}
            onClick={() => { setPlayAll(true); play(visible[0]); }}
          >
            <ListMusic size={17} className="me-2" />{copy("Play all", "تشغيل الكل")}
          </Button>
          <span className="text-sm text-white/65">
            {copy(`${visible.length} recordings`, `${visible.length} تسجيل`)}
            {totalSeconds > 0 && ` · ${clock(totalSeconds)}`}
          </span>
        </div>
      </header>

      <div className="sticky top-0 z-20 -mx-4 mt-6 flex flex-wrap items-center gap-2 bg-background/90 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8">
        <label className="relative flex h-11 min-w-0 flex-1 items-center rounded-full border bg-card ps-10 pe-3 shadow-sm focus-within:border-primary">
          <Search size={16} className="absolute start-4 text-muted-foreground" />
          <span className="sr-only">{copy("Filter recordings", "تصفية التسجيلات")}</span>
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            data-bare-field
            dir="auto"
            placeholder={copy("Filter by words or subject", "صفِّ بالكلمات أو الموضوع")}
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          {filter && <button type="button" aria-label={copy("Clear", "مسح")} onClick={() => setFilter("")} className="text-muted-foreground"><X size={15} /></button>}
        </label>
        <label className="relative inline-flex h-11 items-center rounded-full border bg-card ps-4 pe-9 text-sm font-medium shadow-sm">
          <span className="sr-only">{copy("Sort", "ترتيب")}</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as Sort)} className="cursor-pointer appearance-none bg-transparent outline-none">
            <option value="newest">{copy("Newest first", "الأحدث أولًا")}</option>
            <option value="oldest">{copy("Oldest first", "الأقدم أولًا")}</option>
            <option value="longest">{copy("Longest first", "الأطول أولًا")}</option>
            <option value="shortest">{copy("Shortest first", "الأقصر أولًا")}</option>
            <option value="title">{copy("A to Z", "أبجديًا")}</option>
          </select>
          <ChevronDown size={15} className="pointer-events-none absolute end-3 text-muted-foreground" />
        </label>
      </div>

      {isLoading ? (
        <div className="mt-4 space-y-3" aria-hidden="true">
          {[0, 1, 2, 3].map((row) => <div key={row} className="h-24 animate-pulse rounded-2xl bg-muted/60" />)}
        </div>
      ) : isError ? (
        <div className="mt-10 text-center" role="alert">
          <p className="text-muted-foreground">{copy("Your library couldn't be loaded.", "تعذر تحميل مكتبتك.")}</p>
          <Button variant="outline" className="mt-3 rounded-full" onClick={() => void refetch()}>{copy("Try again", "حاول مجددًا")}</Button>
        </div>
      ) : !visible.length ? (
        <div className="mt-8 rounded-3xl border border-dashed px-6 py-14 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary"><Headphones size={26} /></span>
          <p className="mt-4 font-serif text-xl">{filter ? copy("No recordings match", "لا توجد تسجيلات مطابقة") : copy("Your library is empty", "مكتبتك فارغة")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {filter ? copy("Try other words.", "جرّب كلمات أخرى.") : copy("Every voice note you record is added here automatically.", "كل ملاحظة صوتية تسجلها تُضاف هنا تلقائيًا.")}
          </p>
        </div>
      ) : (
        <ol className="mt-2 space-y-3">
          {visible.map((item) => {
            const captured = new Date(item.capturedAt);
            const day = dayFormat.format(captured);
            const header = grouped && day !== lastDay ? day : null;
            lastDay = day;
            const current = item.id === activeId;
            const total = current ? length ?? item.durationSeconds : item.durationSeconds;
            const progress = current && total ? Math.min(100, (position / total) * 100) : 0;
            const title = displayTitle(item, fallbackTitle);
            return (
              <li key={item.id}>
                {header && <p className="mb-2 mt-5 px-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{header}</p>}
                <article className={`rounded-2xl border bg-card p-4 shadow-sm transition-shadow ${current ? "border-primary/40 shadow-md ring-1 ring-primary/15" : "hover:shadow-md"}`}>
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => { setPlayAll(false); play(item); }}
                      aria-label={current && playing ? copy(`Pause ${title}`, `إيقاف ${title} مؤقتًا`) : copy(`Play ${title}`, `تشغيل ${title}`)}
                      className={`grid h-12 w-12 shrink-0 place-items-center rounded-full transition active:scale-95 ${current ? "bg-primary text-primary-foreground shadow-md shadow-primary/25" : "bg-primary/10 text-primary hover:bg-primary/15"}`}
                    >
                      {current && playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ms-0.5 rtl:-scale-x-100" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      {renaming === item.id ? (
                        <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void saveTitle(item); }}>
                          <input
                            autoFocus
                            dir="auto"
                            value={draftTitle}
                            maxLength={200}
                            onChange={(event) => setDraftTitle(event.target.value)}
                            onKeyDown={(event) => { if (event.key === "Escape") setRenaming(null); }}
                            placeholder={displayTitle({ title: null, transcript: item.transcript }, fallbackTitle)}
                            aria-label={copy("Recording name", "اسم التسجيل")}
                            className="h-10 min-w-0 flex-1 rounded-xl border bg-background px-3 text-sm outline-none focus:border-primary"
                          />
                          <Button type="submit" size="icon" className="h-10 w-10 rounded-xl" aria-label={copy("Save name", "حفظ الاسم")}><Check size={16} /></Button>
                        </form>
                      ) : (
                        <h2 dir="auto" className="font-sans text-[15px] font-semibold leading-6">{title}</h2>
                      )}
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span>{grouped ? timeFormat.format(captured) : dayFormat.format(captured)}</span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{current ? `${clock(position)} / ${clock(total)}` : clock(total)}</span>
                        {item.sourceSubjectTitle && (
                          item.sourceSubjectId && item.sourceIdeaId ? (
                            <Link href={`/subjects/${item.sourceSubjectId}#idea-${item.sourceIdeaId}`} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-foreground/80 hover:bg-primary/10 hover:text-primary">
                              {item.sourceSubjectTitle}<ArrowUpRight size={11} />
                            </Link>
                          ) : (
                            <span className="rounded-full bg-secondary px-2 py-0.5" title={copy("The original idea was deleted; this copy is kept.", "حُذفت الفكرة الأصلية؛ هذه النسخة محفوظة.")}>
                              {item.sourceSubjectTitle}
                            </span>
                          )
                        )}
                      </p>
                    </div>
                  </div>

                  {current && (
                    <div className="mt-3 flex items-center gap-3">
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
                        className="group relative h-6 flex-1 cursor-pointer touch-none"
                      >
                        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-primary/15">
                          <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${progress}%` }} />
                        </div>
                        <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow ring-2 ring-card rtl:translate-x-1/2" style={{ insetInlineStart: `${progress}%` }} />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const following = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
                          setSpeed(following);
                          if (audio.current) audio.current.playbackRate = following;
                        }}
                        aria-label={copy("Playback speed", "سرعة التشغيل")}
                        className="h-8 min-w-12 rounded-full border px-2 text-xs font-semibold tabular-nums hover:border-primary/40"
                      >
                        {speed}×
                      </button>
                      {playAll && (
                        <button type="button" onClick={next} aria-label={copy("Next recording", "التسجيل التالي")} className="grid h-8 w-8 place-items-center rounded-full border hover:border-primary/40">
                          <SkipForward size={14} className="rtl:-scale-x-100" />
                        </button>
                      )}
                    </div>
                  )}

                  {item.transcript && (
                    <button
                      type="button"
                      onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                      aria-expanded={expanded === item.id}
                      className="mt-3 block w-full text-start"
                    >
                      <p dir="auto" className={`whitespace-pre-wrap rounded-xl bg-muted/40 px-3 py-2 font-serif text-[15px] leading-7 text-foreground/80 ${expanded === item.id ? "" : "line-clamp-2"}`}>
                        {item.transcript}
                      </p>
                    </button>
                  )}

                  <div className="mt-3 flex items-center gap-1 border-t pt-2">
                    <Button size="sm" variant="ghost" className="h-9 px-2.5 text-muted-foreground" onClick={() => { setDraftTitle(item.title ?? ""); setRenaming(item.id); }}>
                      <Pencil size={14} className="me-1.5" />{copy("Rename", "إعادة تسمية")}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-9 px-2.5 text-muted-foreground" asChild>
                      <a href={appPath(item.url, import.meta.env.BASE_URL)} download={`${title.replace(/[<>:"/\\|?*]/g, "-").slice(0, 60)}.${item.mimeType?.includes("mp4") ? "m4a" : "webm"}`}>
                        <Download size={14} className="me-1.5" />{copy("Download", "تنزيل")}
                      </a>
                    </Button>
                    <Button size="sm" variant="ghost" className="ms-auto h-9 px-2.5 text-muted-foreground hover:text-destructive" onClick={() => setConfirm(item)}>
                      <Trash2 size={14} className="me-1.5" />{copy("Remove", "إزالة")}
                    </Button>
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
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
          <button type="button" aria-label={copy("Close player", "إغلاق المشغل")} onClick={() => { audio.current?.pause(); setActiveId(null); setPlayAll(false); }} className="grid h-8 w-8 place-items-center rounded-full text-white/70 hover:bg-white/10">
            <X size={16} />
          </button>
        </div>
      )}

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
