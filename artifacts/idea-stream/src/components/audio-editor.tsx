import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Crop,
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
  getListAudioLibraryQueryKey,
  type AudioLibraryItem,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { appPath } from "@/lib/app-path";
import { formatTime, keptRanges, mergeRanges, nextAudible, totalLength, type Range } from "@/lib/audio-ranges";
import { useLanguage } from "@/lib/i18n";

type Segment = { at: number; start: number; end: number };

/** Cut parts out of a library recording: select on the waveform, remove or keep, preview, save. */
export function AudioEditor({ item, title, onClose }: { item: AudioLibraryItem; title: string; onClose: () => void }) {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [loadError, setLoadError] = useState("");
  const [removed, setRemoved] = useState<Range[]>([]);
  const [history, setHistory] = useState<Range[][]>([]);
  const [selection, setSelection] = useState<Range | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState(false);
  const [width, setWidth] = useState(320);
  const context = useRef<AudioContext | null>(null);
  const sources = useRef<AudioBufferSourceNode[]>([]);
  const schedule = useRef<Segment[]>([]);
  const frame = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ mode: "new" | "start" | "end"; anchor: number; moved: boolean } | null>(null);
  const duration = buffer?.duration ?? 0;

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
  }, [item.url]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, Math.floor(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, [buffer]);

  const contentWidth = Math.round(width * zoom);
  const peaks = useMemo(() => {
    if (!buffer) return [];
    const data = buffer.getChannelData(0);
    const bars = Math.max(60, Math.floor(contentWidth / 3));
    const step = Math.max(1, Math.floor(data.length / bars));
    const result: number[] = [];
    for (let bar = 0; bar < bars; bar++) {
      let peak = 0;
      for (let i = bar * step, end = Math.min(data.length, i + step); i < end; i += 4) peak = Math.max(peak, Math.abs(data[i]));
      result.push(peak);
    }
    const loudest = Math.max(0.01, ...result);
    return result.map((value) => value / loudest);
  }, [buffer, contentWidth]);

  // Draw the waveform; removed parts are drawn faint.
  useEffect(() => {
    const element = canvas.current;
    if (!element || !peaks.length) return;
    const ratio = window.devicePixelRatio || 1;
    const height = 120;
    element.width = contentWidth * ratio;
    element.height = height * ratio;
    const draw = element.getContext("2d")!;
    draw.scale(ratio, ratio);
    const styles = getComputedStyle(element);
    const keep = styles.getPropertyValue("--wave-keep").trim() || "#29563f";
    const gone = styles.getPropertyValue("--wave-gone").trim() || "#d4a5a5";
    const barWidth = contentWidth / peaks.length;
    const merged = mergeRanges(removed, duration);
    peaks.forEach((peak, index) => {
      const time = ((index + 0.5) / peaks.length) * duration;
      const isRemoved = merged.some(({ start, end }) => time >= start && time < end);
      const barHeight = Math.max(2, peak * (height - 10));
      draw.fillStyle = isRemoved ? gone : keep;
      draw.fillRect(index * barWidth + 0.5, (height - barHeight) / 2, Math.max(1, barWidth - 1), barHeight);
    });
  }, [peaks, removed, duration, contentWidth]);

  const stop = useCallback(() => {
    cancelAnimationFrame(frame.current);
    for (const source of sources.current) { try { source.stop(); } catch { /* already stopped */ } }
    sources.current = [];
    schedule.current = [];
    setPlaying(false);
  }, []);

  /** Plays the given parts back to back, moving the playhead along the original timeline. */
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
      if (!current) { setPlayhead(schedule.current.at(-1)?.end ?? 0); stop(); return; }
      setPlayhead(now < current.at ? current.start : current.start + (now - current.at));
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [buffer, stop]);

  const playFromHead = () => {
    const from = nextAudible(playhead >= duration - 0.05 ? 0 : playhead, removed, duration);
    if (from === null) return;
    playSegments(keptRanges(removed, duration)
      .filter(({ end }) => end > from)
      .map(({ start, end }) => ({ start: Math.max(start, from), end })));
  };

  const timeAt = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    let ratio = (event.clientX - box.left) / box.width;
    if (isArabic) ratio = 1 - ratio;
    return Math.min(duration, Math.max(0, ratio * duration));
  };
  const handleHit = (event: ReactPointerEvent<HTMLDivElement>, time: number) => {
    if (!selection) return null;
    const box = event.currentTarget.getBoundingClientRect();
    const tolerance = (16 / box.width) * duration;
    if (Math.abs(time - selection.start) < tolerance) return "start" as const;
    if (Math.abs(time - selection.end) < tolerance) return "end" as const;
    return null;
  };

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!buffer) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const time = timeAt(event);
    const handle = handleHit(event, time);
    drag.current = handle
      ? { mode: handle, anchor: handle === "start" ? selection!.end : selection!.start, moved: true }
      : { mode: "new", anchor: time, moved: false };
    if (!handle) setSelection({ start: time, end: time });
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current) return;
    const time = timeAt(event);
    current.moved = current.moved || Math.abs(time - current.anchor) > duration / 400;
    setSelection({ start: Math.min(current.anchor, time), end: Math.max(current.anchor, time) });
  }
  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    if (!current.moved || (selection && selection.end - selection.start < 0.12)) {
      // A tap moves the playhead instead of selecting.
      setSelection(null);
      const time = timeAt(event);
      setPlayhead(time);
      if (playing) {
        const from = nextAudible(time, removed, duration);
        if (from !== null) playSegments(keptRanges(removed, duration).filter(({ end }) => end > from).map(({ start, end }) => ({ start: Math.max(start, from), end })));
      }
    }
  }

  const change = (next: Range[]) => {
    setHistory((list) => [...list.slice(-30), removed]);
    setRemoved(mergeRanges(next, duration));
    setSelection(null);
    stop();
  };
  const nudge = (edge: "start" | "end", delta: number) => setSelection((current) => {
    if (!current) return current;
    const next = { ...current, [edge]: Math.min(duration, Math.max(0, current[edge] + delta)) };
    return next.end - next.start >= 0.05 ? next : current;
  });

  const kept = keptRanges(removed, duration);
  const newLength = totalLength(kept);

  async function save() {
    if (!removed.length || saving) return;
    setSaving(true);
    stop();
    try {
      await editAudioLibraryItem(item.id, { keep: kept });
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

  const left = (time: number) => `${(time / Math.max(duration, 0.001)) * 100}%`;
  const side = isArabic ? "right" : "left";

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
                {copy("Drag across the part you want to change. Tap to move the playhead.", "اسحب على الجزء الذي تريد تغييره. انقر لتحريك مؤشر التشغيل.")}
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
                    className="absolute inset-0 h-full w-full [--wave-gone:#e2b4b4] [--wave-keep:#29563f] dark:[--wave-gone:#6b3a3a] dark:[--wave-keep:#6fbf98]"
                    style={{ transform: isArabic ? "scaleX(-1)" : undefined }}
                  />
                  {mergeRanges(removed, duration).map((range) => (
                    <div key={`${range.start}`} className="pointer-events-none absolute inset-y-0 bg-red-500/10 [background-image:repeating-linear-gradient(135deg,transparent_0_6px,rgba(220,38,38,0.12)_6px_8px)]"
                      style={{ [side]: left(range.start), width: left(range.end - range.start) }} />
                  ))}
                  {selection && selection.end > selection.start && (
                    <div className="pointer-events-none absolute inset-y-0 border-x-2 border-primary bg-primary/15"
                      style={{ [side]: left(selection.start), width: left(selection.end - selection.start) }}>
                      <span className="absolute -start-[7px] top-1/2 h-8 w-3 -translate-y-1/2 rounded-full bg-primary shadow" />
                      <span className="absolute -end-[7px] top-1/2 h-8 w-3 -translate-y-1/2 rounded-full bg-primary shadow" />
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-red-600" style={{ [side]: left(playhead) }} />
                </div>
              </div>
              <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted-foreground">
                <span>0:00</span>
                <span className="font-medium text-foreground">{formatTime(playhead, true)}</span>
                <span>{formatTime(duration)}</span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button className="h-11 rounded-full px-5" onClick={() => (playing ? stop() : playFromHead())}>
                  {playing ? <Pause size={17} className="me-2" fill="currentColor" /> : <Play size={17} className="me-2 rtl:-scale-x-100" fill="currentColor" />}
                  {playing ? copy("Pause", "إيقاف مؤقت") : removed.length ? copy("Preview result", "معاينة النتيجة") : copy("Play", "تشغيل")}
                </Button>
                <label className="ms-auto flex items-center gap-2 text-xs text-muted-foreground">
                  <ZoomIn size={15} />
                  <span className="sr-only">{copy("Zoom", "تكبير")}</span>
                  <input type="range" min={1} max={Math.max(1, Math.min(40, Math.ceil(duration / 10)))} step={1} value={zoom}
                    onChange={(event) => setZoom(Number(event.target.value))} className="w-28 accent-[hsl(var(--primary))]" disabled={duration < 20} />
                </label>
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
                    <button type="button" onClick={() => playSegments([selection])} className="inline-flex items-center gap-1 font-medium text-primary">
                      <Play size={13} fill="currentColor" className="rtl:-scale-x-100" />{copy("Play selection", "تشغيل المحدد")}
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="destructive" className="h-11 rounded-full" onClick={() => change([...removed, selection])}>
                      <Scissors size={16} className="me-2" />{copy("Remove selection", "احذف المحدد")}
                    </Button>
                    <Button variant="outline" className="h-11 rounded-full" onClick={() => change([...removed, { start: 0, end: selection.start }, { start: selection.end, end: duration }])}>
                      <Crop size={16} className="me-2" />{copy("Keep only selection", "احتفظ بالمحدد فقط")}
                    </Button>
                  </div>
                </div>
              )}

              {removed.length > 0 && (
                <div className="mt-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{copy("Removed parts", "الأجزاء المحذوفة")}</p>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-8" disabled={!history.length} onClick={() => { setRemoved(history.at(-1) ?? []); setHistory((list) => list.slice(0, -1)); stop(); }}>
                        <Undo2 size={14} className="me-1" />{copy("Undo", "تراجع")}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8" onClick={() => change([])}>
                        <RotateCcw size={14} className="me-1" />{copy("Reset", "إعادة")}
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {mergeRanges(removed, duration).map((range) => (
                      <span key={`${range.start}`} className="inline-flex items-center gap-1 rounded-full bg-red-50 py-1 ps-3 pe-1 text-xs tabular-nums text-red-800 dark:bg-red-950/40 dark:text-red-200">
                        {formatTime(range.start, true)}–{formatTime(range.end, true)}
                        <button type="button" aria-label={copy("Put this part back", "أعد هذا الجزء")} onClick={() => change(mergeRanges(removed, duration).filter((r) => r.start !== range.start || r.end !== range.end))} className="grid h-6 w-6 place-items-center rounded-full hover:bg-red-100 dark:hover:bg-red-900/40">
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
            {buffer && removed.length > 0
              ? <><span className="font-medium text-foreground">{copy("New length", "الطول الجديد")} {formatTime(newLength)}</span> · {copy("was", "كان")} {formatTime(duration)}<br /></>
              : null}
            {copy("Your original is kept and can be restored.", "يُحفظ الأصل ويمكن استعادته.")}
          </p>
          <Button className="h-11 shrink-0 rounded-full px-5" disabled={!removed.length || saving || newLength < 0.3} onClick={() => void save()}>
            {saving ? <Loader2 size={16} className="me-2 animate-spin" /> : <Scissors size={16} className="me-2" />}
            {saving ? copy("Saving…", "جارٍ الحفظ…") : copy("Save edit", "احفظ التعديل")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
