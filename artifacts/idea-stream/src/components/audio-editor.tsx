import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bookmark,
  Crop,
  FastForward,
  Hand,
  Loader2,
  Maximize2,
  MousePointer2,
  Pause,
  Play,
  Redo2,
  Repeat,
  Rewind,
  RotateCcw,
  ScanSearch,
  Scissors,
  SkipBack,
  Sparkles,
  Type,
  Undo2,
  Wand2,
  X,
  ZoomIn,
  ZoomOut,
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
import { buildPeaks, peakBetween, type PeakCache } from "@/lib/audio-peaks";
import { clampView, panBy, rulerTicks, viewAround, zoomAt, type View } from "@/lib/audio-view";
import { useLanguage } from "@/lib/i18n";

type Segment = { at: number; start: number; end: number };
type Tool = "select" | "cut" | "zoom" | "hand" | "loop";
type Drag =
  | { kind: "select" | "cut" | "zoom" | "loop"; anchor: number; moved: boolean }
  | { kind: "edge"; which: "selection-start" | "selection-end" | "loop-start" | "loop-end"; anchor: number }
  | { kind: "pan"; startX: number; view: View }
  | { kind: "overview" };

const WAVE_HEIGHT = 200;
const ASK_KEY = "idea-stream-editor-confirm-cuts";
const clock = (seconds: number) => {
  const value = Math.max(0, seconds);
  const minutes = Math.floor(value / 60);
  return `${String(minutes).padStart(2, "0")}:${(value - minutes * 60).toFixed(1).padStart(4, "0")}`;
};

const ToolButton = ({ active, onClick, label, shortcut, children, disabled }: { active?: boolean; onClick: () => void; label: string; shortcut?: string; children: ReactNode; disabled?: boolean }) => (
  <button type="button" onClick={onClick} disabled={disabled} aria-pressed={active} title={shortcut ? `${label} (${shortcut})` : label} aria-label={label}
    className={`relative grid h-9 min-w-9 place-items-center rounded-lg px-2 transition-colors disabled:opacity-35 ${active ? "bg-emerald-500 text-[#06150e] shadow-inner" : "text-white/80 hover:bg-white/10 hover:text-white"}`}>
    {children}
    {shortcut && <span className="pointer-events-none absolute bottom-0.5 end-0.5 hidden text-[8px] font-bold opacity-50 sm:block">{shortcut}</span>}
  </button>
);
const Divider = () => <span className="mx-1 h-6 w-px shrink-0 bg-white/15" aria-hidden="true" />;

/**
 * Audio editor with professional tools: Select, Cut, Zoom, Pan, and an A–B loop. Cuts take
 * effect at once (the rest joins up). Everything is tracked against the original recording,
 * which the server keeps for "Restore original".
 */
export function AudioEditor({ item, title, onClose }: { item: AudioLibraryItem; title: string; onClose: () => void }) {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [peaks, setPeaks] = useState<PeakCache | null>(null);
  const [loadError, setLoadError] = useState("");
  /** Removed parts, in ORIGINAL time. Undo/redo stacks hold earlier/later versions. */
  const [removed, setRemoved] = useState<Range[]>([]);
  const [undoStack, setUndoStack] = useState<Range[][]>([]);
  const [redoStack, setRedoStack] = useState<Range[][]>([]);
  /** Selection, playhead, and view are in EDITED time (the joined result). */
  const [selection, setSelection] = useState<Range | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<View>({ start: 0, end: 0 });
  /** The A–B loop section, in ORIGINAL time so cuts elsewhere don't move it. */
  const [loopRange, setLoopRange] = useState<Range | null>(null);
  const [loopOn, setLoopOn] = useState(false);
  const [tool, setTool] = useState<Tool>("select");
  const [preview, setPreview] = useState<Range | null>(null); // live box while dragging cut/zoom/loop
  const [width, setWidth] = useState(600);
  const [tab, setTab] = useState<"cuts" | "cleanup" | "text">("cuts");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [words, setWords] = useState<TimedWord[] | null>(null);
  const [wordsState, setWordsState] = useState<"idle" | "loading" | "error">("idle");
  const [wordsError, setWordsError] = useState("");
  /** A cut (or crop) waiting for the user's OK; shown in red on the waveform. */
  const [pendingCut, setPendingCut] = useState<{ range: Range; kind: "cut" | "crop" } | null>(null);
  const [askBeforeCut, setAskBeforeCut] = useState(() => {
    try { return localStorage.getItem(ASK_KEY) !== "no"; } catch { return true; }
  });
  const rememberAsk = (ask: boolean) => {
    setAskBeforeCut(ask);
    try { localStorage.setItem(ASK_KEY, ask ? "yes" : "no"); } catch { /* optional */ }
  };

  const context = useRef<AudioContext | null>(null);
  const sources = useRef<AudioBufferSourceNode[]>([]);
  const schedule = useRef<Segment[]>([]);
  const frame = useRef(0);
  const wave = useRef<HTMLDivElement>(null);
  const waveCanvas = useRef<HTMLCanvasElement>(null);
  const overviewCanvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, number>());
  const pinch = useRef<{ distance: number; view: View; anchor: number } | null>(null);
  const loopRef = useRef<() => void>(() => {});

  const duration = buffer?.duration ?? 0;
  const timeline = useMemo(() => new EditedTimeline(removed, duration), [removed, duration]);
  const length = timeline.length;
  const span = Math.max(0.001, view.end - view.start);
  const cuts = mergeRanges(removed, duration);
  const loop = loopRange ? { start: timeline.toEdited(loopRange.start), end: timeline.toEdited(loopRange.end) } : null;
  const loopValid = !!loop && loop.end - loop.start >= 0.1;

  // ----- Loading -----------------------------------------------------------------------
  const stop = useCallback(() => {
    cancelAnimationFrame(frame.current);
    for (const source of sources.current) { try { source.stop(); } catch { /* already stopped */ } }
    sources.current = [];
    schedule.current = [];
    setPlaying(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(appPath(item.url, import.meta.env.BASE_URL), { credentials: "include" });
        if (!response.ok) throw new Error("download");
        const ctx = new AudioContext();
        context.current = ctx;
        const decoded = await ctx.decodeAudioData(await response.arrayBuffer());
        if (cancelled) return;
        setBuffer(decoded);
        setPeaks(buildPeaks(decoded.getChannelData(0), decoded.sampleRate));
        setView({ start: 0, end: decoded.duration });
      } catch {
        if (!cancelled) setLoadError(copy("This recording couldn't be opened for editing on this device.", "تعذر فتح هذا التسجيل للتحرير على هذا الجهاز."));
      }
    })();
    return () => { cancelled = true; stop(); void context.current?.close().catch(() => {}); };
  }, [item.url, stop]);

  useEffect(() => {
    const element = wave.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.floor(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, [buffer]);

  // After cuts the recording is shorter: keep the view inside it (and full if it was full).
  useEffect(() => {
    setView((current) => (current.end - current.start >= length - 0.01 || current.end > length ? clampView({ start: 0, end: length }, length) : clampView(current, length)));
  }, [length]);

  // ----- Drawing -----------------------------------------------------------------------
  /** Min/max of the EDITED audio between two edited-time moments (can span joins). */
  const editedPeak = useCallback((from: number, to: number): [number, number] => {
    if (!peaks) return [0, 0];
    let lo = 0;
    let hi = 0;
    for (const piece of timeline.originalPieces(from, to)) {
      const [a, b] = peakBetween(peaks, piece.start, piece.end);
      if (a < lo) lo = a;
      if (b > hi) hi = b;
    }
    return [lo, hi];
  }, [peaks, timeline]);

  const loudest = useMemo(() => {
    if (!peaks) return 1;
    let top = 0.01;
    for (let i = 0; i < peaks.max.length; i++) top = Math.max(top, peaks.max[i], -peaks.min[i]);
    return top;
  }, [peaks]);

  useEffect(() => {
    const canvas = waveCanvas.current;
    if (!canvas || !peaks || length <= 0) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = WAVE_HEIGHT * ratio;
    const draw = canvas.getContext("2d")!;
    draw.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw.clearRect(0, 0, width, WAVE_HEIGHT);
    const middle = WAVE_HEIGHT / 2;
    draw.fillStyle = "rgba(255,255,255,0.07)";
    draw.fillRect(0, middle - 0.5, width, 1);
    draw.fillStyle = "#5fd39a";
    const columnSeconds = span / width;
    for (let x = 0; x < width; x++) {
      const from = view.start + x * columnSeconds;
      const [lo, hi] = editedPeak(from, from + columnSeconds);
      const top = middle - (hi / loudest) * (middle - 6);
      const bottom = middle - (lo / loudest) * (middle - 6);
      draw.fillRect(x, top, 1, Math.max(1, bottom - top));
    }
  }, [peaks, view, width, editedPeak, loudest, span, length]);

  useEffect(() => {
    const canvas = overviewCanvas.current;
    if (!canvas || !peaks || length <= 0) return;
    const ratio = window.devicePixelRatio || 1;
    const height = 36;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const draw = canvas.getContext("2d")!;
    draw.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw.clearRect(0, 0, width, height);
    draw.fillStyle = "rgba(95,211,154,0.6)";
    const step = length / width;
    for (let x = 0; x < width; x++) {
      const [lo, hi] = editedPeak(x * step, (x + 1) * step);
      const top = height / 2 - (hi / loudest) * (height / 2 - 2);
      const bottom = height / 2 - (lo / loudest) * (height / 2 - 2);
      draw.fillRect(x, top, 1, Math.max(1, bottom - top));
    }
  }, [peaks, width, editedPeak, loudest, length]);

  // ----- Playback ----------------------------------------------------------------------
  /** Plays original-time segments back to back; the playhead follows in edited time. */
  const playSegments = useCallback((segments: Range[], repeat = false) => {
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
      if (!current) {
        if (repeat) { loopRef.current(); return; }
        setPlayhead(timeline.toEdited(schedule.current.at(-1)?.end ?? 0));
        stop();
        return;
      }
      const position = timeline.toEdited(now < current.at ? current.start : current.start + (now - current.at));
      setPlayhead(position);
      // Keep the playhead on screen while zoomed in.
      setView((v) => (position > v.end || position < v.start ? clampView({ start: position - (v.end - v.start) * 0.1, end: position + (v.end - v.start) * 0.9 }, timeline.length) : v));
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [buffer, stop, timeline]);

  const playEdited = useCallback((from: number, to: number, repeat = false) => {
    const pieces = timeline.originalPieces(from, to);
    loopRef.current = () => playSegments(pieces, true);
    playSegments(pieces, repeat);
  }, [timeline, playSegments]);

  const togglePlay = () => {
    if (playing) { stop(); return; }
    if (loopOn && loopValid && loop) { playEdited(loop.start, loop.end, true); return; }
    playEdited(playhead >= length - 0.05 ? 0 : playhead, length);
  };
  const seekTo = (time: number) => {
    const target = Math.min(length, Math.max(0, time));
    setPlayhead(target);
    if (playing) playEdited(target, length);
  };

  // ----- Editing -----------------------------------------------------------------------
  const commit = (next: Range[], playheadAfter?: number) => {
    stop();
    setUndoStack((list) => [...list.slice(-50), removed]);
    setRedoStack([]);
    setRemoved(mergeRanges(next, duration));
    setSelection(null);
    if (playheadAfter !== undefined) setPlayhead(playheadAfter);
  };
  const cutRange = (range: Range) => {
    if (range.end - range.start < 0.02) return;
    commit([...removed, ...timeline.originalPieces(range.start, range.end)], range.start);
  };
  const cropTo = (range: Range) => {
    const keep = timeline.originalPieces(range.start, range.end);
    const outside: Range[] = [];
    let cursor = 0;
    for (const piece of keep) { outside.push({ start: cursor, end: piece.start }); cursor = piece.end; }
    outside.push({ start: cursor, end: duration });
    commit(outside, 0);
  };
  /** Every cut and crop asks first (unless turned off); the part shows in red meanwhile. */
  const requestCut = (range: Range, kind: "cut" | "crop" = "cut") => {
    if (range.end - range.start < 0.02) return;
    if (!askBeforeCut) { if (kind === "cut") cutRange(range); else cropTo(range); return; }
    stop();
    setSelection(range);
    setPendingCut({ range, kind });
  };
  const confirmCut = () => {
    if (!pendingCut) return;
    const { range, kind } = pendingCut;
    setPendingCut(null);
    if (kind === "cut") cutRange(range); else cropTo(range);
  };
  const cancelCut = () => {
    // Keep the part selected so it can be adjusted.
    if (pendingCut) setSelection(pendingCut.range);
    setPendingCut(null);
    stop();
  };

  /** Picking the Cut tool with a part already selected cuts that part (after asking). */
  const chooseTool = (id: Tool) => {
    setTool(id);
    if (id === "cut" && selection && !pendingCut) requestCut(selection);
  };

  const undo = () => {
    if (!undoStack.length) return;
    stop();
    setRedoStack((list) => [...list, removed]);
    setRemoved(undoStack[undoStack.length - 1]);
    setUndoStack((list) => list.slice(0, -1));
    setSelection(null);
  };
  const redo = () => {
    if (!redoStack.length) return;
    stop();
    setUndoStack((list) => [...list, removed]);
    setRemoved(redoStack[redoStack.length - 1]);
    setRedoStack((list) => list.slice(0, -1));
    setSelection(null);
  };

  // ----- Zoom ---------------------------------------------------------------------------
  const zoomBy = (factor: number, anchor = (view.start + view.end) / 2) => setView((v) => zoomAt(v, factor, anchor, length));
  const fitAll = () => setView({ start: 0, end: length });
  const zoomTo = (range: Range) => setView(viewAround(range, length, 0.08));

  // ----- Pointer: tools on the waveform -------------------------------------------------
  const timeAtX = (clientX: number) => {
    const box = wave.current!.getBoundingClientRect();
    return Math.min(length, Math.max(0, view.start + ((clientX - box.left) / box.width) * span));
  };
  const edgeNear = (clientX: number): Extract<Drag, { kind: "edge" }>["which"] | null => {
    const box = wave.current!.getBoundingClientRect();
    const px = (time: number) => box.left + ((time - view.start) / span) * box.width;
    const near = (time: number) => Math.abs(clientX - px(time)) < 10;
    if (selection && tool === "select") {
      if (near(selection.start)) return "selection-start";
      if (near(selection.end)) return "selection-end";
    }
    if (loop && loopValid) {
      if (near(loop.start)) return "loop-start";
      if (near(loop.end)) return "loop-end";
    }
    return null;
  };

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!buffer || length <= 0 || pendingCut) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, event.clientX);
    if (pointers.current.size === 2) {
      // Two fingers: pinch to zoom, whatever the tool.
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: Math.max(20, Math.abs(a - b)), view, anchor: timeAtX((a + b) / 2) };
      drag.current = null;
      setPreview(null);
      return;
    }
    const time = timeAtX(event.clientX);
    const edge = edgeNear(event.clientX);
    if (edge) {
      const anchor = edge === "selection-start" ? selection!.end : edge === "selection-end" ? selection!.start : edge === "loop-start" ? loop!.end : loop!.start;
      drag.current = { kind: "edge", which: edge, anchor };
      return;
    }
    if (tool === "hand" || event.button === 1) { drag.current = { kind: "pan", startX: event.clientX, view }; return; }
    drag.current = { kind: tool === "select" ? "select" : tool, anchor: time, moved: false };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, event.clientX);
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      setView(zoomAt(pinch.current.view, Math.max(20, Math.abs(a - b)) / pinch.current.distance, pinch.current.anchor, length));
      return;
    }
    const current = drag.current;
    if (!current || current.kind === "overview") return;
    if (current.kind === "pan") {
      const box = wave.current!.getBoundingClientRect();
      setView(panBy(current.view, -((event.clientX - current.startX) / box.width) * (current.view.end - current.view.start), length));
      return;
    }
    const time = timeAtX(event.clientX);
    const range = { start: Math.min(current.anchor, time), end: Math.max(current.anchor, time) };
    if (current.kind === "edge") {
      if (current.which.startsWith("selection")) setSelection(range);
      else setLoopRange({ start: timeline.toOriginal(range.start), end: timeline.toOriginal(range.end) });
      return;
    }
    if (Math.abs(time - current.anchor) > span / 300) current.moved = true;
    if (!current.moved) return;
    if (current.kind === "select") setSelection(range);
    else setPreview(range);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pinch.current) { if (pointers.current.size < 2) pinch.current = null; drag.current = null; return; }
    const current = drag.current;
    drag.current = null;
    setPreview(null);
    if (!current || current.kind === "pan" || current.kind === "edge" || current.kind === "overview") return;
    const time = timeAtX(event.clientX);
    const range = { start: Math.min(current.anchor, time), end: Math.max(current.anchor, time) };
    const dragged = current.moved && range.end - range.start >= 0.03;
    switch (current.kind) {
      case "select":
        if (!dragged) { setSelection(null); seekTo(time); }
        break;
      case "cut":
        if (dragged) requestCut(range); else seekTo(time);
        break;
      case "zoom":
        if (dragged) zoomTo(range);
        else zoomBy(event.altKey || event.shiftKey ? 0.5 : 2, time);
        break;
      case "loop":
        if (dragged) { setLoopRange({ start: timeline.toOriginal(range.start), end: timeline.toOriginal(range.end) }); setLoopOn(true); }
        else seekTo(time);
        break;
    }
  }

  // Mouse wheel: zoom at the cursor; Shift (or a sideways trackpad swipe) scrolls.
  useEffect(() => {
    const element = wave.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      const anchor = view.start + ((event.clientX - box.left) / box.width) * span;
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        const delta = (event.shiftKey ? event.deltaY : event.deltaX) / box.width;
        setView((v) => panBy(v, delta * (v.end - v.start), length));
      } else {
        setView((v) => zoomAt(v, Math.exp(-event.deltaY * 0.0025), anchor, length));
      }
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [view, span, length, buffer]);

  // Overview strip: tap or drag to move the view there.
  function onOverview(event: ReactPointerEvent<HTMLDivElement>, start = false) {
    if (start) { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { kind: "overview" }; }
    else if (drag.current?.kind !== "overview") return;
    const box = event.currentTarget.getBoundingClientRect();
    const center = ((event.clientX - box.left) / box.width) * length;
    setView((v) => clampView({ start: center - (v.end - v.start) / 2, end: center + (v.end - v.start) / 2 }, length));
  }

  // ----- Keyboard ----------------------------------------------------------------------
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || !buffer) return;
      const ctrl = event.ctrlKey || event.metaKey;
      const handled = () => event.preventDefault();
      // While a cut waits for an answer: Enter confirms, Escape cancels, nothing else edits.
      if (pendingCut) {
        if (event.key === "Enter") { handled(); confirmCut(); }
        else if (event.key === "Escape") { handled(); cancelCut(); }
        else if (event.key === " ") { handled(); playEdited(pendingCut.range.start, pendingCut.range.end); }
        return;
      }
      if (ctrl && event.key.toLowerCase() === "z") { handled(); if (event.shiftKey) redo(); else undo(); return; }
      if (ctrl && event.key.toLowerCase() === "y") { handled(); redo(); return; }
      if (ctrl) return;
      switch (event.key) {
        case " ": handled(); togglePlay(); break;
        case "Delete": case "Backspace": if (selection && !pendingCut) { handled(); requestCut(selection); } break;
        case "v": case "V": setTool("select"); break;
        case "c": case "C": chooseTool("cut"); break;
        case "z": case "Z": setTool("zoom"); break;
        case "h": case "H": setTool("hand"); break;
        case "r": case "R": setTool("loop"); break;
        case "l": case "L": setLoopOn((on) => !on); break;
        case "+": case "=": handled(); zoomBy(2, playhead); break;
        case "-": case "_": handled(); zoomBy(0.5, playhead); break;
        case "0": fitAll(); break;
        case "Home": handled(); seekTo(0); break;
        case "ArrowLeft": handled(); seekTo(playhead - (event.shiftKey ? 5 : 1)); break;
        case "ArrowRight": handled(); seekTo(playhead + (event.shiftKey ? 5 : 1)); break;
        case "[": setLoopRange((r) => ({ start: timeline.toOriginal(playhead), end: r ? Math.max(r.end, timeline.toOriginal(playhead) + 0.5) : timeline.toOriginal(Math.min(length, playhead + 5)) })); break;
        case "]": setLoopRange((r) => ({ start: r ? Math.min(r.start, timeline.toOriginal(playhead) - 0.5) : timeline.toOriginal(Math.max(0, playhead - 5)), end: timeline.toOriginal(playhead) })); break;
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  // ----- Clean up and text -----------------------------------------------------------
  const applyCleanup = (ranges: Range[], done: (count: number) => string, nothing: string) => {
    if (!ranges.length) { setNote(nothing); return; }
    const after = new EditedTimeline(mergeRanges([...removed, ...ranges], duration), duration).length;
    commit([...removed, ...ranges], 0);
    setNote(`${done(ranges.length)} · ${copy(`${(length - after).toFixed(1)} s shorter`, `أقصر بـ ${(length - after).toFixed(1)} ث`)}`);
  };
  const trimEdges = () => {
    if (buffer) applyCleanup(silentEdges(buffer.getChannelData(0), buffer.sampleRate), () => copy("Trimmed the silent start and end", "قُصّ الصمت في البداية والنهاية"), copy("No silent start or end found.", "لا يوجد صمت في البداية أو النهاية."));
  };
  const shortenPauses = () => {
    if (buffer) applyCleanup(longPauses(buffer.getChannelData(0), buffer.sampleRate), (n) => copy(`Shortened ${n} long pause${n > 1 ? "s" : ""}`, `قُصّرت ${n} وقفة طويلة`), copy("No long pauses found.", "لا توجد وقفات طويلة."));
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
  const withCutNeighbours = (list: TimedWord[], indexes: number[]) => {
    const set = new Set(indexes);
    for (const index of indexes)
      for (const neighbour of [index - 1, index + 1])
        if (list[neighbour] && isWordRemoved(list[neighbour], removed)) set.add(neighbour);
    return [...set];
  };
  const removeFillers = async () => {
    const list = words ?? await loadWords();
    if (!list) return;
    const fillers = fillerIndexes(list).filter((index) => !isWordRemoved(list[index], removed));
    const n = fillers.length;
    applyCleanup(n ? rangesForWords(list, withCutNeighbours(list, fillers)) : [], () => copy(`Removed ${n} filler word${n > 1 ? "s" : ""}`, `حُذفت ${n} كلمة حشو`), copy("No filler words found.", "لم تُعثر على كلمات حشو."));
  };
  const toggleWord = (index: number) => {
    if (!words) return;
    const word = words[index];
    setNote("");
    if (isWordRemoved(word, removed)) {
      commit(subtractRange(cuts, { start: words[index - 1]?.end ?? 0, end: words[index + 1]?.start ?? duration }));
      return;
    }
    commit([...removed, ...rangesForWords(words, withCutNeighbours(words, [index]))]);
  };
  const fillerSet = useMemo(() => new Set(words ? fillerIndexes(words) : []), [words]);

  async function save() {
    if (!cuts.length || saving) return;
    setSaving(true);
    stop();
    try {
      await editAudioLibraryItem(item.id, { keep: timeline.kept });
      await queryClient.invalidateQueries({ queryKey: getListAudioLibraryQueryKey() });
      toast({ title: copy("Recording edited", "تم تحرير التسجيل"), description: copy("The original is kept. Its text is being updated.", "الأصل محفوظ. يجري تحديث النص.") });
      onClose();
    } catch (error) {
      toast({ variant: "destructive", title: copy("The edit couldn't be saved", "تعذر حفظ التعديل"), description: (error as { data?: { error?: string } })?.data?.error });
      setSaving(false);
    }
  }

  // ----- Layout helpers ---------------------------------------------------------------
  const x = (time: number) => `${((time - view.start) / span) * 100}%`;
  const w = (range: Range) => `${((range.end - range.start) / span) * 100}%`;
  const inView = (time: number) => time >= view.start - span * 0.01 && time <= view.end + span * 0.01;
  const ticks = rulerTicks(view, width);
  const zoomLevel = length > 0 ? length / span : 1;
  const cursor = { select: "cursor-text", cut: "cursor-crosshair", zoom: "cursor-zoom-in", hand: drag.current?.kind === "pan" ? "cursor-grabbing" : "cursor-grab", loop: "cursor-col-resize" }[tool];
  const tools: Array<[Tool, ReactNode, string, string, string]> = [
    ["select", <MousePointer2 size={17} />, copy("Select", "تحديد"), "V", copy("Drag to select a part. Tap to move the playhead.", "اسحب لتحديد جزء. انقر لتحريك مؤشر التشغيل.")],
    ["cut", <Scissors size={17} />, copy("Cut", "قص"), "C", copy("Drag over a part to cut it out, or pick Cut after selecting a part. The rest joins up.", "اسحب على جزء لقصه، أو اختر القص بعد تحديد جزء. ويتصل الباقي.")],
    ["zoom", <ZoomIn size={17} />, copy("Zoom", "تكبير"), "Z", copy("Click to zoom in. Drag a box to zoom into exactly that part. Alt/Shift-click to zoom out.", "انقر للتكبير. اسحب مربعًا للتكبير على ذلك الجزء تمامًا. Alt/Shift مع النقر للتصغير.")],
    ["hand", <Hand size={17} />, copy("Pan", "تحريك"), "H", copy("Drag to move along the recording when zoomed in.", "اسحب للتنقل في التسجيل عند التكبير.")],
    ["loop", <Repeat size={17} />, copy("A–B loop", "تكرار A–B"), "R", copy("Drag over the section you want to listen to on repeat.", "اسحب على المقطع الذي تريد سماعه مكررًا.")],
  ];
  const activeTool = tools.find(([id]) => id === tool)!;


  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent onEscapeKeyDown={(event) => { if (pendingCut) { event.preventDefault(); cancelCut(); } }} className="flex h-[100dvh] w-full max-w-6xl flex-col gap-0 overflow-hidden rounded-none border-0 bg-[#0b1712] p-0 text-white sm:h-[94vh] sm:rounded-2xl [&>button:last-child]:hidden" dir="ltr">
        {/* Title bar */}
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-2.5" style={{ paddingTop: "max(0.6rem, env(safe-area-inset-top))" }}>
          <Scissors size={17} className="shrink-0 text-emerald-400" />
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-sm font-semibold text-white">{copy("Audio editor", "محرر الصوت")}</DialogTitle>
            <DialogDescription className="truncate text-xs text-white/50" dir="auto">{title}</DialogDescription>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label={copy("Close", "إغلاق")} className="grid h-9 w-9 place-items-center rounded-full text-white/70 hover:bg-white/10"><X size={18} /></button>
        </div>

        {loadError ? (
          <p className="m-4 rounded-xl bg-amber-500/15 px-4 py-3 text-sm text-amber-200" role="alert">{loadError}</p>
        ) : !buffer ? (
          <div className="grid flex-1 place-items-center"><Loader2 className="animate-spin text-emerald-400" /></div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
            {/* Toolbar */}
            <div className="sticky top-0 z-20 flex items-center gap-1 overflow-x-auto border-b border-white/10 bg-[#102219] px-2 py-1.5 [scrollbar-width:none]" role="toolbar" aria-label={copy("Editing tools", "أدوات التحرير")}>
              {tools.map(([id, icon, label, shortcut]) => (
                <ToolButton key={id} active={tool === id} onClick={() => chooseTool(id)} label={label} shortcut={shortcut}>{icon}</ToolButton>
              ))}
              <Divider />
              <ToolButton onClick={() => seekTo(0)} label={copy("To start", "إلى البداية")} shortcut="Home"><SkipBack size={16} /></ToolButton>
              <ToolButton onClick={() => seekTo(playhead - 5)} label={copy("Back 5 s", "رجوع 5 ث")}><Rewind size={16} /></ToolButton>
              <button type="button" onClick={togglePlay} title={copy("Play / pause (Space)", "تشغيل / إيقاف (مسافة)")} aria-label={playing ? copy("Pause", "إيقاف مؤقت") : copy("Play", "تشغيل")}
                className="mx-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-500 text-[#06150e] shadow transition active:scale-95">
                {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ms-0.5" />}
              </button>
              <ToolButton onClick={() => seekTo(playhead + 5)} label={copy("Forward 5 s", "تقدم 5 ث")}><FastForward size={16} /></ToolButton>
              <ToolButton active={loopOn} onClick={() => setLoopOn((on) => !on)} label={copy("Loop the A–B section", "كرّر المقطع A–B")} shortcut="L" disabled={!loopValid}><Repeat size={16} /></ToolButton>
              <ToolButton onClick={() => selection && playEdited(selection.start, selection.end)} label={copy("Play selection", "شغّل المحدد")} disabled={!selection}><span className="text-[10px] font-bold">▶ SEL</span></ToolButton>
              <Divider />
              <ToolButton onClick={() => zoomBy(0.5, playhead)} label={copy("Zoom out", "تصغير")} shortcut="−"><ZoomOut size={16} /></ToolButton>
              <ToolButton onClick={() => zoomBy(2, playhead)} label={copy("Zoom in", "تكبير")} shortcut="+"><ZoomIn size={16} /></ToolButton>
              <ToolButton onClick={() => { const target = selection ?? (loopValid ? loop : null); if (target) zoomTo(target); }} label={copy("Zoom to selection", "كبّر على المحدد")} disabled={!selection && !loopValid}><ScanSearch size={16} /></ToolButton>
              <ToolButton onClick={fitAll} label={copy("Show all", "عرض الكل")} shortcut="0"><Maximize2 size={16} /></ToolButton>
              <Divider />
              <ToolButton onClick={undo} label={copy("Undo", "تراجع")} shortcut="⌃Z" disabled={!undoStack.length}><Undo2 size={16} /></ToolButton>
              <ToolButton onClick={redo} label={copy("Redo", "إعادة")} shortcut="⌃Y" disabled={!redoStack.length}><Redo2 size={16} /></ToolButton>
              <ToolButton onClick={() => selection && requestCut(selection)} label={copy("Cut selection", "قص المحدد")} shortcut="Del" disabled={!selection || !!pendingCut}><Scissors size={16} /></ToolButton>
              <ToolButton onClick={() => selection && requestCut(selection, "crop")} label={copy("Keep only selection", "احتفظ بالمحدد فقط")} disabled={!selection || !!pendingCut}><Crop size={16} /></ToolButton>
            </div>

            {/* Time display */}
            <div className="flex flex-wrap items-end gap-x-6 gap-y-1 px-4 pt-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/40">{copy("Position", "الموضع")}</p>
                <p className="font-mono text-3xl tabular-nums text-emerald-300">{clock(playhead)}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/40">{copy("Length", "الطول")}</p>
                <p className="font-mono text-lg tabular-nums text-white/80">{clock(length)}{cuts.length > 0 && <span className="ms-2 text-sm text-white/35 line-through">{clock(duration)}</span>}</p>
              </div>
              {selection && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/40">{copy("Selection", "التحديد")}</p>
                  <p className="font-mono text-sm tabular-nums text-sky-300">{clock(selection.start)} → {clock(selection.end)} <span className="text-white/50">({(selection.end - selection.start).toFixed(1)} s)</span></p>
                </div>
              )}
              {loopValid && loop && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/40">{copy("A–B section", "المقطع A–B")}</p>
                  <p className="flex items-center gap-2 font-mono text-sm tabular-nums text-amber-300">
                    {clock(loop.start)} → {clock(loop.end)}
                    <button type="button" onClick={() => playEdited(loop.start, loop.end, loopOn)} className="rounded bg-amber-400/15 px-1.5 py-0.5 font-sans text-[11px] font-semibold hover:bg-amber-400/25">▶ {copy("Play", "تشغيل")}</button>
                    <button type="button" onClick={() => zoomTo(loop)} className="rounded bg-amber-400/15 px-1.5 py-0.5 font-sans text-[11px] font-semibold hover:bg-amber-400/25">{copy("Zoom", "تكبير")}</button>
                    <button type="button" onClick={() => { setLoopRange(null); setLoopOn(false); }} aria-label={copy("Clear A–B", "امسح A–B")} className="rounded px-1 text-white/50 hover:text-white"><X size={13} /></button>
                  </p>
                </div>
              )}
            </div>

            <div className="px-4 pt-3">
              {/* Overview: the whole recording, with the visible window */}
              <div className="relative h-9 cursor-pointer touch-none overflow-hidden rounded-md bg-black/30"
                onPointerDown={(event) => onOverview(event, true)} onPointerMove={(event) => onOverview(event)} onPointerUp={() => { drag.current = null; }}
                aria-label={copy("Overview: tap to move the view", "نظرة عامة: انقر لنقل العرض")} role="scrollbar" aria-valuemin={0} aria-valuemax={Math.round(length)} aria-valuenow={Math.round(view.start)}>
                <canvas ref={overviewCanvas} className="absolute inset-0 h-full w-full" />
                <div className="pointer-events-none absolute inset-y-0 rounded-sm border border-white/70 bg-white/10" style={{ left: `${(view.start / Math.max(length, 0.001)) * 100}%`, width: `${Math.max(0.6, (span / Math.max(length, 0.001)) * 100)}%` }} />
                <div className="pointer-events-none absolute inset-y-0 w-px bg-red-400" style={{ left: `${(playhead / Math.max(length, 0.001)) * 100}%` }} />
              </div>

              {/* Ruler, with the A–B section */}
              <div className="relative mt-2 h-6 select-none overflow-hidden border-b border-white/15 text-[10px] text-white/45">
                {ticks.map((tick) => (
                  <span key={tick} className="absolute bottom-0 h-2 border-s border-white/30" style={{ left: x(tick) }}>
                    <span className="absolute -top-3.5 start-1 whitespace-nowrap font-mono tabular-nums">{formatTime(tick, span < 20)}</span>
                  </span>
                ))}
                {loopValid && loop && (
                  <div className="absolute bottom-0 h-2 rounded-sm bg-amber-400/70" style={{ left: x(loop.start), width: w(loop) }}>
                    <span className="absolute -top-0.5 -start-1 text-[9px] font-bold text-amber-300">A</span>
                    <span className="absolute -top-0.5 -end-1 text-[9px] font-bold text-amber-300">B</span>
                  </div>
                )}
              </div>

              {/* Waveform */}
              <div
                ref={wave}
                className={`relative touch-none select-none overflow-hidden rounded-b-md bg-[#07110d] ${cursor}`}
                style={{ height: WAVE_HEIGHT }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onContextMenu={(event) => { if (tool === "zoom") { event.preventDefault(); zoomBy(0.5, timeAtX(event.clientX)); } }}
                role="application"
                aria-label={copy("Waveform", "شكل الموجة")}
              >
                <canvas ref={waveCanvas} className="absolute inset-0 h-full w-full" />
                {loopValid && loop && (
                  <div className="pointer-events-none absolute inset-y-0 border-x border-amber-400/80 bg-amber-400/10" style={{ left: x(loop.start), width: w(loop) }} />
                )}
                {timeline.joins().filter(inView).map((point) => (
                  <div key={`join-${point}`} className="pointer-events-none absolute inset-y-0 w-0 border-s border-dashed border-red-400/80" style={{ left: x(point) }}>
                    <Scissors size={11} className="absolute -start-[6px] top-1 rounded-full bg-[#07110d] text-red-400" />
                  </div>
                ))}
                {(item.marks ?? []).filter((mark) => !cuts.some((cut) => mark >= cut.start && mark < cut.end)).map((mark) => timeline.toEdited(mark)).filter(inView).map((mark) => (
                  <div key={`mark-${mark}`} className="pointer-events-none absolute inset-y-0 w-0 border-s border-amber-300/80" style={{ left: x(mark) }}>
                    <Bookmark size={12} className="absolute -start-[6px] bottom-1 fill-amber-300 text-amber-400" />
                  </div>
                ))}
                {selection && (
                  <div className="pointer-events-none absolute inset-y-0 border-x-2 border-sky-300 bg-sky-400/20" style={{ left: x(selection.start), width: w(selection) }} />
                )}
                {preview && (
                  <div className={`pointer-events-none absolute inset-y-0 border-x-2 ${tool === "cut" ? "border-red-400 bg-red-500/30" : tool === "zoom" ? "border-white/70 bg-white/10" : "border-amber-300 bg-amber-400/20"}`}
                    style={{ left: x(preview.start), width: w(preview) }}>
                    <span className="absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px]">
                      {tool === "cut" ? "✂ " : tool === "zoom" ? "🔍 " : "A–B "}{(preview.end - preview.start).toFixed(2)} s
                    </span>
                  </div>
                )}
                {inView(playhead) && <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]" style={{ left: x(playhead) }} />}
                {pendingCut && (
                  pendingCut.kind === "cut" ? (
                    <div className="pointer-events-none absolute inset-y-0 border-x-2 border-red-400 bg-red-500/35 [background-image:repeating-linear-gradient(135deg,transparent_0_7px,rgba(248,113,113,0.25)_7px_10px)]"
                      style={{ left: x(pendingCut.range.start), width: w(pendingCut.range) }} />
                  ) : (
                    <>
                      <div className="pointer-events-none absolute inset-y-0 bg-red-500/35" style={{ left: 0, width: x(pendingCut.range.start) }} />
                      <div className="pointer-events-none absolute inset-y-0 bg-red-500/35" style={{ left: x(pendingCut.range.end), right: 0 }} />
                    </>
                  )
                )}
              </div>
              {pendingCut && (
                <div className="relative z-10 -mt-[150px] mb-[38px] flex justify-center px-2" dir={isArabic ? "rtl" : "ltr"}
                  onPointerDown={(event) => event.stopPropagation()}>
                  <div role="alertdialog" aria-modal="false" aria-labelledby="cut-question"
                    className="w-full max-w-md rounded-2xl border border-red-400/40 bg-[#1a0f0f]/95 p-4 shadow-2xl backdrop-blur">
                    <p id="cut-question" className="flex items-center gap-2 text-sm font-semibold text-white">
                      <Scissors size={16} className="text-red-400" />
                      {pendingCut.kind === "cut" ? copy("Cut this part?", "قص هذا الجزء؟") : copy("Keep only this part and cut the rest?", "الاحتفاظ بهذا الجزء فقط وقص الباقي؟")}
                    </p>
                    <p className="mt-1 font-mono text-xs tabular-nums text-red-200" dir="ltr">
                      {clock(pendingCut.range.start)} → {clock(pendingCut.range.end)} · {(pendingCut.range.end - pendingCut.range.start).toFixed(1)} s
                      {pendingCut.kind === "crop" && ` · ${copy("removes", "يحذف")} ${(length - (pendingCut.range.end - pendingCut.range.start)).toFixed(1)} s`}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="ghost" className="h-9 rounded-full text-white/80 hover:bg-white/10 hover:text-white"
                        onClick={() => playEdited(pendingCut.range.start, pendingCut.range.end)}>
                        <Play size={14} className="me-1.5" fill="currentColor" />{copy("Listen", "استمع")}
                      </Button>
                      <span className="flex-1" />
                      <Button size="sm" variant="ghost" className="h-9 rounded-full text-white/80 hover:bg-white/10 hover:text-white" onClick={cancelCut}>
                        {copy("Cancel", "إلغاء")} <kbd className="ms-1.5 text-[10px] opacity-60">Esc</kbd>
                      </Button>
                      <Button size="sm" autoFocus className="h-9 rounded-full bg-red-500 px-4 text-white hover:bg-red-400" onClick={confirmCut}>
                        <Scissors size={14} className="me-1.5" />{pendingCut.kind === "cut" ? copy("Cut", "قص") : copy("Keep only this", "احتفظ بهذا فقط")} <kbd className="ms-1.5 text-[10px] opacity-70">↵</kbd>
                      </Button>
                    </div>
                    <label className="mt-3 flex cursor-pointer items-center gap-2 text-[11px] text-white/50">
                      <input type="checkbox" className="h-3.5 w-3.5 accent-red-500" onChange={(event) => rememberAsk(!event.target.checked)} />
                      {copy("Don't ask again on this device", "لا تسأل مجددًا على هذا الجهاز")}
                    </label>
                  </div>
                </div>
              )}

              {/* Status bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 py-2 text-[11px] text-white/50">
                <span><span className="font-semibold text-emerald-300">{activeTool[2]}</span> · {activeTool[4]}</span>
                <span className="font-mono tabular-nums">
                  {copy("Zoom", "التكبير")} {zoomLevel < 10 ? zoomLevel.toFixed(1) : Math.round(zoomLevel)}× · {formatTime(view.start, true)}–{formatTime(view.end, true)}
                  <span className="ms-2 hidden sm:inline">{copy("Wheel: zoom · Shift+wheel: scroll · Pinch on touch", "العجلة: تكبير · Shift+العجلة: تمرير · القرص باللمس")}</span>
                </span>
              </div>
            </div>

            {/* Panels */}
            <div className="mx-4 mb-4 rounded-xl border border-white/10 bg-white/[0.03]" dir={isArabic ? "rtl" : "ltr"}>
              <div className="flex border-b border-white/10 text-sm" role="tablist">
                {([["cuts", copy(`Cuts (${cuts.length})`, `المقطوع (${cuts.length})`)], ["cleanup", copy("Clean up", "تنظيف")], ["text", copy("Edit by text", "التحرير بالنص")]] as const).map(([id, label]) => (
                  <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                    className={`px-4 py-2.5 font-medium transition-colors ${tab === id ? "border-b-2 border-emerald-400 text-white" : "text-white/50 hover:text-white/80"}`}>{label}</button>
                ))}
              </div>
              <div className="p-3">
                {tab === "cuts" && (cuts.length ? (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {cuts.map((range) => (
                        <span key={`${range.start}-${range.end}`} className="inline-flex items-center gap-1 rounded-full bg-red-500/15 py-1 ps-3 pe-1 font-mono text-xs tabular-nums text-red-200" title={copy("Times in the original recording", "الأوقات في التسجيل الأصلي")}>
                          <Scissors size={11} />{formatTime(range.start, true)}–{formatTime(range.end, true)}
                          <button type="button" aria-label={copy("Put this part back", "أعد هذا الجزء")} onClick={() => commit(cuts.filter((r) => r.start !== range.start || r.end !== range.end), 0)} className="grid h-6 w-6 place-items-center rounded-full hover:bg-red-500/25"><X size={12} /></button>
                        </span>
                      ))}
                    </div>
                    <Button size="sm" variant="ghost" className="mt-2 h-8 text-white/70 hover:bg-white/10 hover:text-white" onClick={() => commit([], 0)}><RotateCcw size={14} className="me-1" />{copy("Put everything back", "أعد كل شيء")}</Button>
                  </>
                ) : (
                  <p className="text-xs text-white/50">{copy("Nothing cut yet. Use the ✂ Cut tool and drag over a part, or select a part and press Delete.", "لم يُقص شيء بعد. استخدم أداة ✂ القص واسحب على جزء، أو حدّد جزءًا واضغط Delete.")}</p>
                ))}
                {tab === "cuts" && (
                  <label className="mt-3 flex cursor-pointer items-center gap-2 border-t border-white/10 pt-3 text-xs text-white/60">
                    <input type="checkbox" className="h-4 w-4 accent-emerald-500" checked={askBeforeCut} onChange={(event) => rememberAsk(event.target.checked)} />
                    {copy("Ask before cutting", "اسأل قبل القص")}
                  </label>
                )}
                {tab === "cleanup" && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" className="h-9 rounded-full border-white/20 bg-transparent text-white hover:bg-white/10" onClick={trimEdges}><Wand2 size={14} className="me-1.5" />{copy("Trim silent start & end", "قص الصمت في الطرفين")}</Button>
                      <Button size="sm" variant="outline" className="h-9 rounded-full border-white/20 bg-transparent text-white hover:bg-white/10" onClick={shortenPauses}>{copy("Shorten long pauses", "قصّر الوقفات الطويلة")}</Button>
                      <Button size="sm" variant="outline" className="h-9 rounded-full border-white/20 bg-transparent text-white hover:bg-white/10" disabled={wordsState === "loading"} onClick={() => void removeFillers()}>
                        {wordsState === "loading" ? <Loader2 size={14} className="me-1.5 animate-spin" /> : <Sparkles size={14} className="me-1.5" />}
                        {copy("Remove filler words", "احذف كلمات الحشو")}{words ? ` (${[...fillerSet].filter((i) => !isWordRemoved(words[i], removed)).length})` : ""}
                      </Button>
                    </div>
                    {note && <p className="mt-2 text-xs font-medium text-emerald-300" role="status">{note}</p>}
                  </>
                )}
                {tab === "text" && (words ? (
                  <>
                    <p className="text-xs text-white/50">{copy("Tap words to cut them. Tap again to bring them back.", "انقر على الكلمات لقصّها. انقر مجددًا لإعادتها.")}</p>
                    <p dir="auto" className="mt-2 max-h-56 overflow-y-auto text-[15px] leading-9">
                      {words.map((entry, index) => {
                        const cut = isWordRemoved(entry, removed);
                        return (
                          <button key={index} type="button" onClick={() => toggleWord(index)} aria-pressed={cut} title={formatTime(entry.start, true)}
                            className={`me-1 rounded px-0.5 transition-colors ${cut ? "bg-red-500/15 text-red-300/70 line-through decoration-2" : "hover:bg-white/10"} ${fillerSet.has(index) && !cut ? "underline decoration-amber-400 decoration-wavy underline-offset-4" : ""}`}>
                            {entry.word.trim()}
                          </button>
                        );
                      })}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-white/50">{copy("See every word and cut parts by tapping words. Reading the words takes a few seconds the first time.", "اعرض كل كلمة واقطع الأجزاء بالنقر على الكلمات. تستغرق قراءة الكلمات بضع ثوانٍ في المرة الأولى.")}</p>
                    {wordsState === "error" && <p className="mt-2 text-xs text-amber-300" role="alert">{wordsError}</p>}
                    <Button size="sm" className="mt-2 h-9 rounded-full bg-emerald-500 text-[#06150e] hover:bg-emerald-400" disabled={wordsState === "loading"} onClick={() => void loadWords()}>
                      {wordsState === "loading" ? <Loader2 size={14} className="me-1.5 animate-spin" /> : <Type size={14} className="me-1.5" />}
                      {wordsState === "loading" ? copy("Reading the words…", "جارٍ قراءة الكلمات…") : copy("Show the words", "اعرض الكلمات")}
                    </Button>
                  </>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-3 border-t border-white/10 bg-[#102219] px-4 py-2.5" style={{ paddingBottom: "max(0.6rem, env(safe-area-inset-bottom))" }}>
          <p className="min-w-0 flex-1 text-xs leading-5 text-white/55">
            {buffer && cuts.length > 0 && <><span className="font-medium text-white">{copy("New length", "الطول الجديد")} {formatTime(length)}</span> · {copy("was", "كان")} {formatTime(duration)} · </>}
            {copy("Your original is kept and can be restored.", "يُحفظ الأصل ويمكن استعادته.")}
          </p>
          <Button className="h-10 shrink-0 rounded-full bg-emerald-500 px-5 text-[#06150e] hover:bg-emerald-400" disabled={!cuts.length || saving || length < 0.3} onClick={() => void save()}>
            {saving ? <Loader2 size={16} className="me-2 animate-spin" /> : <Scissors size={16} className="me-2" />}
            {saving ? copy("Saving…", "جارٍ الحفظ…") : copy("Save edit", "احفظ التعديل")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
