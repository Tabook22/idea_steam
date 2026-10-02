import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bookmark,
  Crop,
  Sparkles,
  Type,
  Wand2,
  Loader2,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Scissors,
  Undo2,
  X,
  ZoomIn,
} from "lucide-react";
import {
  editAudioLibraryItem,
  getAudioLibraryWords,
  getListAudioLibraryQueryKey,
  type AudioLibraryItem,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { appPath } from "@/lib/app-path";
import { EditedTimeline, formatTime, mergeRanges, type Range } from "@/lib/audio-ranges";
import { fillerIndexes, isWordRemoved, longPauses, rangesForWords, silentEdges, subtractRange, type TimedWord } from "@/lib/audio-cleanup";
import { useLanguage } from "@/lib/i18n";

type Segment = { at: number; start: number; end: number };

/**
 * Cut parts out of a library recording. A removed part disappears at once and the rest is
 * joined, so the waveform, timer, and playback always show the result. Cuts are tracked
 * against the original, which the server keeps for "Restore original".
 */
export function AudioEditor({ item, title, onClose }: { item: AudioLibraryItem; title: string; onClose: () => void }) {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [loadError, setLoadError] = useState("");
  /** Removed parts, in the ORIGINAL recording's time. */
  const [removed, setRemoved] = useState<Range[]>([]);
  const [history, setHistory] = useState<Range[][]>([]);
  /** Selection and playhead, in EDITED time (the joined result). */
  const [selection, setSelection] = useState<Range | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState(false);
  const [width, setWidth] = useState(320);
  const [flash, setFlash] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [words, setWords] = useState<TimedWord[] | null>(null);
  const [wordsState, setWordsState] = useState<"idle" | "loading" | "error">("idle");
  const [wordsError, setWordsError] = useState("");
  const [note, setNote] = useState("");
  const context = useRef<AudioContext | null>(null);
  const sources = useRef<AudioBufferSourceNode[]>([]);
  const schedule = useRef<Segment[]>([]);
  const frame = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ mode: "new" | "start" | "end"; anchor: number; moved: boolean } | null>(null);
  const duration = buffer?.duration ?? 0;
  const timeline = useMemo(() => new EditedTimeline(removed, duration), [removed, duration]);
  const length = timeline.length;

  const stop = useCallback(() => {
    cancelAnimationFrame(frame.current);
    for (const source of sources.current) { try { source.stop(); } catch { /* already stopped */ } }
    sources.current = [];
    schedule.current = [];
    setPlaying(false);
  }, []);

  // Load and decode the recording once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(appPath(item.url, import.meta.env.BASE_URL), { credentials: "include" });
        if (!response.ok) throw new Error("download");
        const data = await response.arrayBuffer();
        const ctx = new AudioContext();
        context.current = ctx;
        const decoded = await ctx.decodeAudioData(data);
        if (!cancelled) setBuffer(decoded);
      } catch {
        if (!cancelled) setLoadError(copy("This recording couldn't be opened for editing on this device.", "تعذر فتح هذا التسجيل للتحرير على هذا الجهاز."));
      }
    })();
    return () => {
      cancelled = true;
      stop();
      void context.current?.close().catch(() => {});
    };
  }, [item.url, stop]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, Math.floor(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, [buffer]);

  const contentWidth = Math.round(width * zoom);

  // Waveform of the edited result: only kept audio, joined end to end.
  const peaks = useMemo(() => {
    if (!buffer || length <= 0) return [];
    const data = buffer.getChannelData(0);
    const rate = buffer.sampleRate;
    const bars = Math.max(60, Math.floor(contentWidth / 3));
    const result: number[] = [];
    for (let bar = 0; bar < bars; bar++) {
      let peak = 0;
      for (const piece of timeline.originalPieces((bar / bars) * length, ((bar + 1) / bars) * length)) {
        const from = Math.floor(piece.start * rate);
        const to = Math.min(data.length, Math.ceil(piece.end * rate));
        for (let i = from; i < to; i += 4) peak = Math.max(peak, Math.abs(data[i]));
      }
      result.push(peak);
    }
    const loudest = Math.max(0.01, ...result);
    return result.map((value) => value / loudest);
  }, [buffer, timeline, length, contentWidth]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    if (!peaks.length) { element.getContext("2d")?.clearRect(0, 0, element.width, element.height); return; }
    const ratio = window.devicePixelRatio || 1;
    const height = 120;
    element.width = contentWidth * ratio;
    element.height = height * ratio;
    const draw = element.getContext("2d")!;
    draw.scale(ratio, ratio);
    draw.fillStyle = getComputedStyle(element).getPropertyValue("--wave-keep").trim() || "#29563f";
    const barWidth = contentWidth / peaks.length;
    peaks.forEach((peak, index) => {
      const barHeight = Math.max(2, peak * (height - 10));
      draw.fillRect(index * barWidth + 0.5, (height - barHeight) / 2, Math.max(1, barWidth - 1), barHeight);
    });
  }, [peaks, contentWidth]);

  /** Plays original-time segments back to back; the playhead follows in edited time. */
  const playSegments = useCallback((segments: Range[]) => {
    const ctx = context.current;
    if (!ctx || !buffer || !segments.length) return;
    stop();
    void ctx.resume();
    let at = ctx.currentTime + 0.05;
    for (const { start, end } of segments) {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(at, start, end - start);
      sources.current.push(source);
      schedule.current.push({ at, start, end });
      at += end - start;
    }
    setPlaying(true);
    const tick = () => {
      const now = ctx.currentTime;
      const current = schedule.current.find((segment) => now < segment.at + (segment.end - segment.start));
      if (!current) { setPlayhead(timeline.toEdited(schedule.current.at(-1)?.end ?? 0)); stop(); return; }
      setPlayhead(timeline.toEdited(now < current.at ? current.start : current.start + (now - current.at)));
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [buffer, stop, timeline]);

  const playEdited = (from: number, to = length) => playSegments(timeline.originalPieces(from, to));
  const playFromHead = () => playEdited(playhead >= length - 0.05 ? 0 : playhead);

  const timeAt = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    let ratio = (event.clientX - box.left) / box.width;
    if (isArabic) ratio = 1 - ratio;
    return Math.min(length, Math.max(0, ratio * length));
  };
  const handleHit = (event: ReactPointerEvent<HTMLDivElement>, time: number) => {
    if (!selection) return null;
    const box = event.currentTarget.getBoundingClientRect();
    const tolerance = (16 / box.width) * length;
    if (Math.abs(time - selection.start) < tolerance) return "start" as const;
    if (Math.abs(time - selection.end) < tolerance) return "end" as const;
    return null;
  };

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!buffer || length <= 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const time = timeAt(event);
    const handle = handleHit(event, time);
    drag.current = handle
      ? { mode: handle, anchor: handle === "start" ? selection!.end : selection!.start, moved: true }
      : { mode: "new", anchor: time, moved: false };
    if (!handle) setSelection({ start: time, end: time });
    setDragging(true);
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current) return;
    const time = timeAt(event);
    current.moved = current.moved || Math.abs(time - current.anchor) > length / 400;
    setSelection({ start: Math.min(current.anchor, time), end: Math.max(current.anchor, time) });
  }
  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    drag.current = null;
    setDragging(false);
    if (!current) return;
    if (!current.moved || (selection && selection.end - selection.start < 0.12)) {
      // A tap moves the playhead instead of selecting.
      setSelection(null);
      const time = timeAt(event);
      setPlayhead(time);
      if (playing) playEdited(time);
    }
  }

  /** Applies new cuts (original time); the waveform closes the gap immediately. */
  const change = (next: Range[], playheadAfter?: number) => {
    stop();
    setHistory((list) => [...list.slice(-30), removed]);
    setRemoved(mergeRanges(next, duration));
    setSelection(null);
    if (playheadAfter !== undefined) setPlayhead(playheadAfter);
  };
  const removeSelection = () => {
    if (!selection) return;
    change([...removed, ...timeline.originalPieces(selection.start, selection.end)], selection.start);
    // Briefly mark the join so it's clear where the two sides now meet.
    setFlash(selection.start);
    window.setTimeout(() => setFlash(null), 1400);
  };
  const keepOnlySelection = () => {
    if (!selection) return;
    const keep = timeline.originalPieces(selection.start, selection.end);
    const everythingElse: Range[] = [];
    let cursor = 0;
    for (const piece of keep) {
      everythingElse.push({ start: cursor, end: piece.start });
      cursor = piece.end;
    }
    everythingElse.push({ start: cursor, end: duration });
    change(everythingElse, 0);
  };
  /** Applies a clean-up and says what it did ("Shortened 3 pauses · 4.2 s shorter"). */
  const applyCleanup = (ranges: Range[], done: (count: number) => string, nothing: string) => {
    if (!ranges.length) { setNote(nothing); return; }
    const after = new EditedTimeline(mergeRanges([...removed, ...ranges], duration), duration).length;
    change([...removed, ...ranges], 0);
    setNote(`${done(ranges.length)} · ${copy(`${(length - after).toFixed(1)} s shorter`, `أقصر بـ ${(length - after).toFixed(1)} ث`)}`);
  };
  const samples = () => (buffer ? { data: buffer.getChannelData(0), rate: buffer.sampleRate } : null);
  const trimEdges = () => {
    const audio = samples();
    if (audio) applyCleanup(silentEdges(audio.data, audio.rate), () => copy("Trimmed the silent start and end", "قُصّ الصمت في البداية والنهاية"), copy("No silent start or end found.", "لا يوجد صمت في البداية أو النهاية."));
  };
  const shortenPauses = () => {
    const audio = samples();
    if (audio) applyCleanup(longPauses(audio.data, audio.rate), (n) => copy(`Shortened ${n} long pause${n > 1 ? "s" : ""}`, `قُصّرت ${n} وقفة طويلة`), copy("No long pauses found.", "لا توجد وقفات طويلة."));
  };

  async function loadWords() {
    if (words || wordsState === "loading") return words;
    setWordsState("loading");
    setWordsError("");
    try {
      const result = await getAudioLibraryWords(item.id, { language: "auto" });
      setWords(result.words);
      setWordsState("idle");
      void queryClient.invalidateQueries({ queryKey: getListAudioLibraryQueryKey() });
      return result.words;
    } catch (error) {
      setWordsError((error as { data?: { error?: string } })?.data?.error ?? copy("The words couldn't be read. Please try again.", "تعذرت قراءة الكلمات. حاول مجددًا."));
      setWordsState("error");
      return null;
    }
  }
  const removeFillers = async () => {
    const list = words ?? await loadWords();
    if (!list) return;
    const fillers = fillerIndexes(list).filter((index) => !isWordRemoved(list[index], removed));
    const n = fillers.length;
    applyCleanup(n ? rangesForWords(list, withCutNeighbours(list, fillers)) : [], () => copy(`Removed ${n} filler word${n > 1 ? "s" : ""}`, `حُذفت ${n} كلمة حشو`), copy("No filler words found.", "لم تُعثر على كلمات حشو."));
  };
  /** Adds already-cut neighbours so the gap between them is cut too (no leftover slivers). */
  const withCutNeighbours = (list: TimedWord[], indexes: number[]) => {
    const set = new Set(indexes);
    for (const index of indexes)
      for (const neighbour of [index - 1, index + 1])
        if (list[neighbour] && isWordRemoved(list[neighbour], removed)) set.add(neighbour);
    return [...set];
  };
  /** Tap a word to cut it; tap a cut word to bring it back. The waveform updates at once. */
  const toggleWord = (index: number) => {
    if (!words) return;
    const word = words[index];
    const previous = words[index - 1];
    const next = words[index + 1];
    setNote("");
    if (isWordRemoved(word, removed)) {
      change(subtractRange(mergeRanges(removed, duration), { start: previous?.end ?? 0, end: next?.start ?? duration }));
      return;
    }
    change([...removed, ...rangesForWords(words, withCutNeighbours(words, [index]))]);
  };
  const fillerSet = useMemo(() => new Set(words ? fillerIndexes(words) : []), [words]);

  const nudge = (edge: "start" | "end", delta: number) => setSelection((current) => {
    if (!current) return current;
    const next = { ...current, [edge]: Math.min(length, Math.max(0, current[edge] + delta)) };
    return next.end - next.start >= 0.05 ? next : current;
  });
  const undo = () => {
    stop();
    setRemoved(history.at(-1) ?? []);
    setHistory((list) => list.slice(0, -1));
    setSelection(null);
    setPlayhead(0);
  };

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.key === "Delete" || event.key === "Backspace") && selection && selection.end - selection.start >= 0.05 &&
          !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        removeSelection();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  async function save() {
    if (!removed.length || saving) return;
    setSaving(true);
    stop();
    try {
      await editAudioLibraryItem(item.id, { keep: timeline.kept });
      await queryClient.invalidateQueries({ queryKey: getListAudioLibraryQueryKey() });
      toast({
        title: copy("Recording edited", "تم تحرير التسجيل"),
        description: copy("The original is kept. Its text is being updated.", "الأصل محفوظ. يجري تحديث النص."),
      });
      onClose();
    } catch (error) {
      const message = (error as { data?: { error?: string } })?.data?.error;
      toast({ variant: "destructive", title: copy("The edit couldn't be saved", "تعذر حفظ التعديل"), description: message });
      setSaving(false);
    }
  }

  const at = (time: number) => `${(time / Math.max(length, 0.001)) * 100}%`;
  const side = isArabic ? "right" : "left";
  const cuts = mergeRanges(removed, duration);

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="flex h-[100dvh] max-w-3xl flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[92vh] sm:rounded-2xl [&>button:last-child]:hidden">
        <div className="flex items-center gap-3 border-b px-4 py-3" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
          <Scissors size={18} className="shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base font-semibold">{copy("Edit recording", "تحرير التسجيل")}</DialogTitle>
            <DialogDescription className="truncate text-xs" dir="auto">{title}</DialogDescription>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label={copy("Close", "إغلاق")} className="grid h-9 w-9 place-items-center rounded-full hover:bg-secondary">
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {loadError ? (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" role="alert">{loadError}</p>
          ) : !buffer ? (
            <div className="grid h-40 place-items-center text-sm text-muted-foreground"><Loader2 className="animate-spin" /></div>
          ) : (
            <>
              <p className="mb-2 text-xs text-muted-foreground">
                {selection && selection.end - selection.start >= 0.05 && !dragging
                  ? copy("Tap ✂ Cut to remove the selected part. The rest joins up.", "اضغط ✂ قص لحذف الجزء المحدد، ويتصل الباقي.")
                  : cuts.length
                  ? copy("This is the edited recording. Red lines show where parts were cut and the rest joined.", "هذا هو التسجيل بعد التحرير. الخطوط الحمراء تبيّن مواضع القص والوصل.")
                  : copy("Drag across the part you want to remove. Tap to move the playhead.", "اسحب على الجزء الذي تريد حذفه. انقر لتحريك مؤشر التشغيل.")}
              </p>
              <div ref={scroller} className="overflow-x-auto rounded-xl border bg-card" dir="ltr">
                <div
                  className="relative h-[120px] cursor-crosshair touch-none select-none"
                  style={{ width: contentWidth, direction: isArabic ? "rtl" : "ltr" }}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  role="application"
                  aria-label={copy("Waveform. Drag to select a part.", "شكل الموجة. اسحب لتحديد جزء.")}
                >
                  <canvas
                    ref={canvas}
                    className="absolute inset-0 h-full w-full [--wave-keep:#29563f] dark:[--wave-keep:#6fbf98]"
                    style={{ transform: isArabic ? "scaleX(-1)" : undefined }}
                  />
                  {(item.marks ?? []).filter((mark) => !cuts.some((cut) => mark >= cut.start && mark < cut.end)).map((mark) => (
                    <div key={`mark-${mark}`} className="pointer-events-none absolute inset-y-0 w-0 border-s-2 border-amber-400" style={{ [side]: at(timeline.toEdited(mark)) }}
                      title={copy("Bookmark", "علامة")}>
                      <Bookmark size={13} className="absolute -start-[7px] bottom-1 fill-amber-400 text-amber-500" />
                    </div>
                  ))}
                  {timeline.joins().map((point) => (
                    <div key={point} className={`pointer-events-none absolute inset-y-0 w-0 border-s-2 border-dashed transition-colors ${flash !== null && Math.abs(flash - point) < 0.01 ? "border-red-600" : "border-red-500/60"}`}
                      style={{ [side]: at(point) }}>
                      <Scissors size={12} className="absolute -start-[7px] top-1 rounded-full bg-card text-red-600" />
                    </div>
                  ))}
                  {selection && selection.end > selection.start && (
                    <div className="pointer-events-none absolute inset-y-0 border-x-2 border-primary bg-primary/15"
                      style={{ [side]: at(selection.start), width: at(selection.end - selection.start) }}>
                      <span className="absolute -start-[7px] top-1/2 h-8 w-3 -translate-y-1/2 rounded-full bg-primary shadow" />
                      <span className="absolute -end-[7px] top-1/2 h-8 w-3 -translate-y-1/2 rounded-full bg-primary shadow" />
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-red-600" style={{ [side]: at(playhead) }} />
                  {selection && selection.end - selection.start >= 0.05 && !dragging && (
                    <div
                      className="absolute top-1.5 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-card p-1 shadow-lg ring-1 ring-black/10 rtl:translate-x-1/2"
                      // Centred on the selection, but never pushed past the waveform's edges.
                      style={{ [side]: `${Math.min(contentWidth - 60, Math.max(60, ((selection.start + selection.end) / 2 / Math.max(length, 0.001)) * contentWidth))}px` }}
                      onPointerDown={(event) => event.stopPropagation()}
                      onPointerUp={(event) => event.stopPropagation()}
                    >
                      <button type="button" onClick={removeSelection}
                        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-red-600 px-3.5 text-sm font-semibold text-white shadow-sm active:scale-95">
                        <Scissors size={15} />{copy("Cut", "قص")}
                      </button>
                      <button type="button" onClick={keepOnlySelection} aria-label={copy("Keep only selection", "احتفظ بالمحدد فقط")} title={copy("Keep only this", "احتفظ بهذا فقط")}
                        className="grid h-9 w-9 place-items-center rounded-full text-foreground hover:bg-secondary active:scale-95">
                        <Crop size={15} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted-foreground">
                <span>0:00</span>
                <span className="font-medium text-foreground">{formatTime(playhead, true)}</span>
                <span>
                  {formatTime(length)}
                  {cuts.length > 0 && <span className="ms-1 line-through opacity-60">{formatTime(duration)}</span>}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button className="h-11 rounded-full px-5" onClick={() => (playing ? stop() : playFromHead())}>
                  {playing ? <Pause size={17} className="me-2" fill="currentColor" /> : <Play size={17} className="me-2 rtl:-scale-x-100" fill="currentColor" />}
                  {playing ? copy("Pause", "إيقاف مؤقت") : copy("Play", "تشغيل")}
                </Button>
                <label className="ms-auto flex items-center gap-2 text-xs text-muted-foreground">
                  <ZoomIn size={15} />
                  <span className="sr-only">{copy("Zoom", "تكبير")}</span>
                  <input type="range" min={1} max={Math.max(1, Math.min(40, Math.ceil(length / 10)))} step={1} value={zoom}
                    onChange={(event) => setZoom(Number(event.target.value))} className="w-28 accent-[hsl(var(--primary))]" disabled={length < 20} />
                </label>
              </div>

              <div className="mt-4">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  <Wand2 size={13} />{copy("Clean up", "تنظيف")}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="h-9 rounded-full" onClick={trimEdges}>{copy("Trim silent start & end", "قص الصمت في الطرفين")}</Button>
                  <Button variant="outline" size="sm" className="h-9 rounded-full" onClick={shortenPauses}>{copy("Shorten long pauses", "قصّر الوقفات الطويلة")}</Button>
                  <Button variant="outline" size="sm" className="h-9 rounded-full" disabled={wordsState === "loading"} onClick={() => void removeFillers()}>
                    {wordsState === "loading" ? <Loader2 size={14} className="me-1.5 animate-spin" /> : <Sparkles size={14} className="me-1.5" />}
                    {copy("Remove filler words", "احذف كلمات الحشو")}{words ? ` (${[...fillerSet].filter((i) => !isWordRemoved(words[i], removed)).length})` : ""}
                  </Button>
                </div>
                {note && <p className="mt-2 text-xs font-medium text-primary" role="status">{note}</p>}
              </div>

              <div className="mt-5 rounded-2xl border bg-card p-3">
                <p className="flex items-center gap-1.5 text-sm font-semibold"><Type size={15} className="text-primary" />{copy("Edit by text", "التحرير بالنص")}</p>
                {words ? (
                  <>
                    <p className="mt-1 text-xs text-muted-foreground">{copy("Tap words to cut them from the audio. Tap again to bring them back.", "انقر على الكلمات لقصّها من الصوت. انقر مجددًا لإعادتها.")}</p>
                    <p dir="auto" className="mt-3 max-h-64 overflow-y-auto text-[15px] leading-9">
                      {words.map((entry, index) => {
                        const cut = isWordRemoved(entry, removed);
                        return (
                          <button
                            key={index}
                            type="button"
                            onClick={() => toggleWord(index)}
                            aria-pressed={cut}
                            title={`${formatTime(entry.start, true)}`}
                            className={`me-1 rounded px-0.5 transition-colors ${cut ? "bg-red-50 text-red-700/70 line-through decoration-2 dark:bg-red-950/40 dark:text-red-300/70" : "hover:bg-primary/10"} ${fillerSet.has(index) && !cut ? "underline decoration-amber-500 decoration-wavy underline-offset-4" : ""}`}
                          >
                            {entry.word.trim()}
                          </button>
                        );
                      })}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {copy("See every word and remove parts by tapping words. Reading the words takes a few seconds the first time.", "اعرض كل كلمة واحذف الأجزاء بالنقر على الكلمات. تستغرق قراءة الكلمات بضع ثوانٍ في المرة الأولى.")}
                    </p>
                    {wordsState === "error" && <p className="mt-2 text-xs text-amber-800 dark:text-amber-300" role="alert">{wordsError}</p>}
                    <Button size="sm" className="mt-3 h-9 rounded-full" disabled={wordsState === "loading"} onClick={() => void loadWords()}>
                      {wordsState === "loading" ? <Loader2 size={14} className="me-1.5 animate-spin" /> : <Type size={14} className="me-1.5" />}
                      {wordsState === "loading" ? copy("Reading the words…", "جارٍ قراءة الكلمات…") : copy("Show the words", "اعرض الكلمات")}
                    </Button>
                  </>
                )}
              </div>

              {selection && selection.end - selection.start >= 0.05 && (
                <div className="mt-4 rounded-2xl border bg-muted/30 p-3">
                  <p className="text-sm font-medium tabular-nums">
                    {copy("Selected", "المحدد")}: {formatTime(selection.start, true)} – {formatTime(selection.end, true)}
                    <span className="text-muted-foreground"> ({(selection.end - selection.start).toFixed(1)} {copy("s", "ث")})</span>
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                    {(["start", "end"] as const).map((edge) => (
                      <span key={edge} className="inline-flex items-center gap-1.5">
                        <span className="text-muted-foreground">{edge === "start" ? copy("Start", "البداية") : copy("End", "النهاية")}</span>
                        <button type="button" aria-label={copy(`${edge} 0.1 s earlier`, "أبكر 0.1 ث")} onClick={() => nudge(edge, -0.1)} className="grid h-7 w-7 place-items-center rounded-full border bg-background"><Minus size={13} /></button>
                        <button type="button" aria-label={copy(`${edge} 0.1 s later`, "أبعد 0.1 ث")} onClick={() => nudge(edge, 0.1)} className="grid h-7 w-7 place-items-center rounded-full border bg-background"><Plus size={13} /></button>
                      </span>
                    ))}
                    <button type="button" onClick={() => playEdited(selection.start, selection.end)} className="inline-flex items-center gap-1 font-medium text-primary">
                      <Play size={13} fill="currentColor" className="rtl:-scale-x-100" />{copy("Play selection", "تشغيل المحدد")}
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="destructive" className="h-11 rounded-full" onClick={removeSelection}>
                      <Scissors size={16} className="me-2" />{copy("Cut out & join", "اقطع وصِل")}
                    </Button>
                    <Button variant="outline" className="h-11 rounded-full" onClick={keepOnlySelection}>
                      <Crop size={16} className="me-2" />{copy("Keep only selection", "احتفظ بالمحدد فقط")}
                    </Button>
                  </div>
                </div>
              )}

              {cuts.length > 0 && (
                <div className="mt-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{copy("Cut out", "المقطوع")}</p>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-8" disabled={!history.length} onClick={undo}>
                        <Undo2 size={14} className="me-1" />{copy("Undo", "تراجع")}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8" onClick={() => change([], 0)}>
                        <RotateCcw size={14} className="me-1" />{copy("Reset", "إعادة")}
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {cuts.map((range) => (
                      <span key={`${range.start}-${range.end}`} className="inline-flex items-center gap-1 rounded-full bg-red-50 py-1 ps-3 pe-1 text-xs tabular-nums text-red-800 dark:bg-red-950/40 dark:text-red-200"
                        title={copy("Times in the original recording", "الأوقات في التسجيل الأصلي")}>
                        <Scissors size={11} className="me-0.5" />
                        {formatTime(range.start, true)}–{formatTime(range.end, true)}
                        <span className="opacity-70">({(range.end - range.start).toFixed(1)} {copy("s", "ث")})</span>
                        <button type="button" aria-label={copy("Put this part back", "أعد هذا الجزء")} onClick={() => change(cuts.filter((r) => r.start !== range.start || r.end !== range.end), 0)} className="grid h-6 w-6 place-items-center rounded-full hover:bg-red-100 dark:hover:bg-red-900/40">
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-3 border-t px-4 py-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          <p className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground">
            {buffer && cuts.length > 0
              ? <><span className="font-medium text-foreground">{copy("New length", "الطول الجديد")} {formatTime(length)}</span> · {copy("was", "كان")} {formatTime(duration)}<br /></>
              : null}
            {copy("Your original is kept and can be restored.", "يُحفظ الأصل ويمكن استعادته.")}
          </p>
          <Button className="h-11 shrink-0 rounded-full px-5" disabled={!cuts.length || saving || length < 0.3} onClick={() => void save()}>
            {saving ? <Loader2 size={16} className="me-2 animate-spin" /> : <Scissors size={16} className="me-2" />}
            {saving ? copy("Saving…", "جارٍ الحفظ…") : copy("Save edit", "احفظ التعديل")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
