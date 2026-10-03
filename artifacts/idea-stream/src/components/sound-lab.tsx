import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AudioLines,
  BookOpen,
  Check,
  CircleHelp,
  Headphones,
  Loader2,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Trash2,
  Wand2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { getListAudioLibraryQueryKey, soundLabAudioLibraryItem, type AudioLibraryItem } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SoundLabHelp, type HelpTopic } from "@/components/sound-lab-help";
import { useToast } from "@/hooks/use-toast";
import { appPath } from "@/lib/app-path";
import { useLanguage } from "@/lib/i18n";
import { rulerTicks, zoomAt, type View } from "@/lib/audio-view";
import { analyse, freqAtY, freqMax, paintSpectrogram, spectrogram, yAtFreq, type Analysis, type SoundKind, type Spectrogram } from "@/lib/sound-analysis";
import {
  BAND_LIMITS,
  BANDS,
  DEFAULT_SETTINGS,
  EDIT_LIMITS,
  FULL_BAND,
  HUM_Q,
  MAX_EDITS,
  VOLUME_LIMITS,
  editFilters,
  humFrequencies,
  isFullBand,
  isNeutral,
  rmsDb,
  round,
  type BandId,
  type RegionEdit,
  type SoundLabSettings,
} from "@/lib/sound-lab";

const KIND_COLOUR: Record<SoundKind, string> = { voice: "#34d399", music: "#a78bfa", noise: "#fbbf24", silence: "#475569" };
const FREQ_LABELS = [100, 300, 1000, 3000, 8000];
const PREVIEW_SECONDS = 15;

const clock = (seconds: number) => {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};
const hz = (value: number) => (value >= 1000 ? `${round(value / 1000, value >= 10000 ? 0 : 1)} kHz` : `${Math.round(value)} Hz`);
const signed = (value: number) => `${value > 0 ? "+" : ""}${round(value, 1)} dB`;

type Box = { start: number; end: number; low: number; high: number };
type Live = { ctx: AudioContext; source: AudioBufferSourceNode; startedAt: number; offset: number; bands: Partial<Record<BandId, BiquadFilterNode>>; master: GainNode; key: string };

const GUIDE_KEY = "idea-stream-lab-guide-seen";

const HelpDot = ({ onClick, label }: { onClick: () => void; label: string }) => (
  <button type="button" onClick={onClick} aria-label={label} title={label}
    className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-emerald-300">
    <CircleHelp size={15} />
  </button>
);

const Panel = ({ title, icon, children, note, help }: { title: string; icon: ReactNode; children: ReactNode; note?: ReactNode; help?: { onClick: () => void; label: string } }) => (
  <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
    <h3 className="flex items-center gap-2 text-sm font-semibold text-white">{icon}<span className="flex-1">{title}</span>{help && <HelpDot {...help} />}</h3>
    {note && <p className="mt-1 text-xs leading-5 text-white/50">{note}</p>}
    <div className="mt-3">{children}</div>
  </section>
);

const Segmented = <T extends string | number | null>({ value, options, onChange, label }: { value: T; options: [T, string, string?][]; onChange: (value: T) => void; label: string }) => (
  <div role="radiogroup" aria-label={label} className="flex rounded-xl bg-black/30 p-1">
    {options.map(([id, text, badge]) => (
      <button key={String(id)} type="button" role="radio" aria-checked={value === id} onClick={() => onChange(id)}
        className={`relative flex h-8 flex-1 items-center justify-center rounded-lg px-1.5 text-xs font-medium transition-colors ${value === id ? "bg-emerald-500 text-[#04140c]" : "text-white/70 hover:text-white"}`}>
        {text}
        {badge && <span className="absolute -top-1.5 end-0.5 rounded-full bg-amber-400 px-1 text-[9px] font-bold leading-3 text-black">{badge}</span>}
      </button>
    ))}
  </div>
);

/**
 * Sound lab: see the recording as frequencies over time, find out what is in it, and improve it:
 * remove noise and hum, shape the frequency bands, or draw a box around any sound to remove,
 * soften or boost it. Most changes are heard live; "Hear exact result" renders the real thing.
 */
export function SoundLab({ item, title, onClose }: { item: AudioLibraryItem; title: string; onClose: () => void }) {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [spec, setSpec] = useState<Spectrogram | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loadError, setLoadError] = useState("");
  const [settings, setSettings] = useState<SoundLabSettings>(DEFAULT_SETTINGS);
  const [view, setView] = useState<View>({ start: 0, end: 1 });
  const [box, setBox] = useState<Box | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; x2: number; y2: number } | null>(null);
  const [playing, setPlaying] = useState<"live" | "exact" | "region" | null>(null);
  const [bypass, setBypass] = useState(false);
  const [solo, setSolo] = useState<BandId | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [size, setSize] = useState({ width: 800, height: 240 });
  const [help, setHelp] = useState<HelpTopic | null>(null);
  const [guideSeen, setGuideSeen] = useState(() => { try { return localStorage.getItem(GUIDE_KEY) === "yes"; } catch { return true; } });
  const markGuideSeen = () => { setGuideSeen(true); try { localStorage.setItem(GUIDE_KEY, "yes"); } catch { /* optional */ } };
  const openHelp = (topic: HelpTopic) => { setHelp(topic); markGuideSeen(); };
  const helpFor = (topic: HelpTopic, en: string, ar: string) => ({ onClick: () => openHelp(topic), label: copy(en, ar) });

  const context = useRef<AudioContext | null>(null);
  const live = useRef<Live | null>(null);
  const exact = useRef<HTMLAudioElement | null>(null);
  const exactStart = useRef(0);
  const exactUrl = useRef<string | null>(null);
  const frame = useRef(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const area = useRef<HTMLDivElement>(null);

  const length = buffer?.duration ?? 0;
  const samples = useMemo(() => buffer?.getChannelData(0) ?? null, [buffer]);
  const fmax = spec ? freqMax(spec) : 8000;
  const span = Math.max(1e-6, view.end - view.start);

  /* ---------- Loading and analysis ---------- */

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
        setView({ start: 0, end: decoded.duration });
        // Let the screen draw first, then do the heavy listening.
        await new Promise((resolve) => setTimeout(resolve, 30));
        const data = decoded.getChannelData(0);
        const picture = spectrogram(data, decoded.sampleRate);
        if (cancelled) return;
        setSpec(picture);
        await new Promise((resolve) => setTimeout(resolve, 10));
        const result = analyse(data, decoded.sampleRate, picture);
        if (cancelled) return;
        setAnalysis(result);
        // The noise level the denoiser needs (blocks read +3 dB above plain RMS).
        setSettings((current) => ({ ...current, noiseFloor: current.noiseSample ? current.noiseFloor : round(result.noiseFloorDb - 3, 1) }));
      } catch {
        if (!cancelled) setLoadError(copy("This recording couldn't be opened on this device.", "تعذر فتح هذا التسجيل على هذا الجهاز."));
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame.current);
      try { live.current?.source.stop(); } catch { /* already stopped */ }
      exact.current?.pause();
      if (exactUrl.current) URL.revokeObjectURL(exactUrl.current);
      void context.current?.close().catch(() => {});
    };
  }, [item.url]);

  // Fit the picture to its box.
  useEffect(() => {
    const element = area.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(240, Math.floor(entry.contentRect.width));
      setSize({ width, height: width < 640 ? 200 : 260 });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [buffer]);

  // Paint the spectrogram for the current view.
  useEffect(() => {
    const element = canvas.current;
    if (!element || !spec) return;
    const scale = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(size.width * scale);
    const height = Math.round(size.height * scale);
    element.width = width;
    element.height = height;
    const pixels = paintSpectrogram(spec, width, height, view.start, view.end);
    element.getContext("2d")?.putImageData(new ImageData(pixels, width, height), 0, 0);
  }, [spec, size, view]);

  /* ---------- Live playback (Web Audio, same filters as the server) ---------- */

  const structureKey = (opts: { bypass: boolean; solo: BandId | null }) =>
    JSON.stringify([opts.bypass, opts.solo, settings.hum, settings.edits]);

  const stopAll = useCallback(() => {
    cancelAnimationFrame(frame.current);
    if (live.current) { try { live.current.source.stop(); } catch { /* ended */ } live.current = null; }
    exact.current?.pause();
    setPlaying(null);
  }, []);

  const tick = useCallback(() => {
    const current = live.current;
    if (current) setPlayhead(Math.min(length, current.offset + (current.ctx.currentTime - current.startedAt)));
    else if (exact.current) setPlayhead(exactStart.current + exact.current.currentTime);
    frame.current = requestAnimationFrame(tick);
  }, [length]);

  function startLive(offset: number, opts = { bypass, solo }) {
    const ctx = context.current;
    if (!ctx || !buffer) return;
    stopAll();
    void ctx.resume();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const at = ctx.currentTime + 0.03;
    let node: AudioNode = source;
    const connect = (next: AudioNode) => { node.connect(next); node = next; };
    const bands: Live["bands"] = {};
    const master = ctx.createGain();
    if (!opts.bypass) {
      for (const frequency of humFrequencies(settings.hum)) {
        const notch = ctx.createBiquadFilter();
        notch.type = "notch"; notch.frequency.value = frequency; notch.Q.value = HUM_Q;
        connect(notch);
      }
      for (const band of BANDS) {
        const filter = ctx.createBiquadFilter();
        filter.type = band.type;
        filter.frequency.value = band.frequency;
        if (band.type === "peaking") filter.Q.value = band.q;
        filter.gain.value = settings.bands[band.id];
        bands[band.id] = filter;
        connect(filter);
      }
      for (const edit of settings.edits) {
        const when = (time: number) => at + (time - offset);
        const shape = (param: AudioParam, on: number, off: number) => {
          const inside = edit.start <= offset && offset < edit.end;
          param.setValueAtTime(inside ? on : off, at);
          if (edit.start > offset) { param.setValueAtTime(off, Math.max(at, when(edit.start) - 0.01)); param.linearRampToValueAtTime(on, when(edit.start) + 0.01); }
          if (edit.end > offset) { param.setValueAtTime(on, Math.max(at, when(edit.end) - 0.01)); param.linearRampToValueAtTime(off, when(edit.end) + 0.01); }
        };
        if (isFullBand(edit)) {
          const gain = ctx.createGain();
          shape(gain.gain, 10 ** (edit.gain / 20), 1);
          connect(gain);
        } else {
          for (const peak of editFilters(edit)) {
            const filter = ctx.createBiquadFilter();
            filter.type = "peaking"; filter.frequency.value = peak.frequency; filter.Q.value = peak.q;
            shape(filter.gain, peak.gain, 0);
            connect(filter);
          }
        }
      }
      master.gain.value = 10 ** (settings.volume / 20);
    }
    connect(master);
    if (opts.solo) {
      // Hear only one band, to find out what lives there.
      const band = BANDS.find((candidate) => candidate.id === opts.solo)!;
      const pass = ctx.createBiquadFilter();
      if (band.type === "lowshelf") { pass.type = "lowpass"; pass.frequency.value = band.high; }
      else if (band.type === "highshelf") { pass.type = "highpass"; pass.frequency.value = band.low; }
      else { pass.type = "bandpass"; pass.frequency.value = Math.sqrt(band.low * band.high); pass.Q.value = pass.frequency.value / (band.high - band.low); }
      connect(pass);
    }
    node.connect(ctx.destination);
    source.start(at, Math.min(offset, Math.max(0, buffer.duration - 0.05)));
    source.onended = () => { if (live.current?.source === source) { live.current = null; setPlaying(null); cancelAnimationFrame(frame.current); } };
    live.current = { ctx, source, startedAt: at, offset, bands, master, key: structureKey(opts) };
    setPlaying("live");
    frame.current = requestAnimationFrame(tick);
  }

  // Slider moves change running filters at once; bigger changes restart from the same spot.
  useEffect(() => {
    const current = live.current;
    if (!current || playing !== "live") return;
    if (current.key !== structureKey({ bypass, solo })) { startLive(current.offset + (current.ctx.currentTime - current.startedAt)); return; }
    if (bypass) return;
    for (const band of BANDS) current.bands[band.id]?.gain.setTargetAtTime(settings.bands[band.id], current.ctx.currentTime, 0.02);
    current.master.gain.setTargetAtTime(10 ** (settings.volume / 20), current.ctx.currentTime, 0.02);
  }, [settings, bypass, solo]);

  function playRegion(region: Box) {
    const ctx = context.current;
    if (!ctx || !buffer) return;
    stopAll();
    void ctx.resume();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    let node: AudioNode = source;
    if (!isFullBand(region)) {
      const pass = ctx.createBiquadFilter();
      pass.type = "bandpass";
      pass.frequency.value = Math.sqrt(region.low * region.high);
      pass.Q.value = Math.max(0.3, pass.frequency.value / Math.max(1, region.high - region.low));
      node.connect(pass);
      node = pass;
    }
    node.connect(ctx.destination);
    const at = ctx.currentTime + 0.03;
    source.start(at, region.start, Math.max(0.05, region.end - region.start));
    source.onended = () => { if (live.current?.source === source) { live.current = null; setPlaying(null); cancelAnimationFrame(frame.current); } };
    live.current = { ctx, source, startedAt: at, offset: region.start, bands: {}, master: ctx.createGain(), key: "region" };
    setPlaying("region");
    frame.current = requestAnimationFrame(tick);
  }

  async function hearExact() {
    if (!buffer) return;
    stopAll();
    setRendering(true);
    const start = Math.max(0, Math.min(playhead, Math.max(0, length - 3)));
    try {
      const response = await fetch(appPath(`/api/audio-library/${item.id}/sound-lab/preview`, import.meta.env.BASE_URL), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings, start: round(start, 2), seconds: Math.min(PREVIEW_SECONDS, Math.max(3, length - start)) }),
      });
      if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? "preview");
      if (exactUrl.current) URL.revokeObjectURL(exactUrl.current);
      exactUrl.current = URL.createObjectURL(await response.blob());
      const audio = exact.current ?? new Audio();
      exact.current = audio;
      audio.src = exactUrl.current;
      exactStart.current = start;
      audio.onended = () => { setPlaying(null); cancelAnimationFrame(frame.current); };
      await audio.play();
      setPlaying("exact");
      frame.current = requestAnimationFrame(tick);
    } catch (error) {
      toast({ variant: "destructive", title: copy("Couldn't render the preview", "تعذر تجهيز المعاينة"), description: (error as Error).message });
    } finally {
      setRendering(false);
    }
  }

  const togglePlay = () => {
    if (playing) { setPlayhead(playhead); stopAll(); return; }
    startLive(playhead >= length - 0.05 ? 0 : playhead);
  };

  /* ---------- Drawing boxes on the picture ---------- */

  const timeAt = (x: number) => view.start + (x / size.width) * span;
  const xAt = (time: number) => ((time - view.start) / span) * size.width;
  const pointer = (event: ReactPointerEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.min(size.width, Math.max(0, event.clientX - rect.left)), y: Math.min(size.height, Math.max(0, event.clientY - rect.top)) };
  };
  const onDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!spec) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const { x, y } = pointer(event);
    setDrag({ x, y, x2: x, y2: y });
  };
  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const { x, y } = pointer(event);
    setDrag({ ...drag, x2: x, y2: y });
  };
  const onUp = () => {
    if (!drag) return;
    const { x, y, x2, y2 } = drag;
    setDrag(null);
    if (Math.abs(x2 - x) < 6 && Math.abs(y2 - y) < 6) {
      // A tap: move the playhead there.
      const time = clampTime(timeAt(x));
      setBox(null);
      setPlayhead(time);
      if (playing === "live") startLive(time);
      return;
    }
    const start = clampTime(timeAt(Math.min(x, x2)));
    const end = clampTime(timeAt(Math.max(x, x2)));
    const flat = Math.abs(y2 - y) < 14;
    const high = flat ? 20000 : round(freqAtY(Math.min(y, y2), size.height, fmax), 0);
    const low = flat ? 20 : round(freqAtY(Math.max(y, y2), size.height, fmax), 0);
    if (end - start < 0.05) return;
    setBox({ start, end, low: flat || low <= FULL_BAND.low ? 20 : low, high: flat || high >= FULL_BAND.high * 0.98 ? 20000 : high });
  };
  const clampTime = (time: number) => Math.min(length, Math.max(0, time));

  // Mouse wheel zooms in time around the cursor.
  useEffect(() => {
    const element = area.current;
    if (!element || !length) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const anchor = view.start + ((event.clientX - rect.left) / rect.width) * span;
      setView((current) => zoomAt(current, Math.exp(-event.deltaY * 0.0025), anchor, length));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [view, span, length]);

  const update = (patch: Partial<SoundLabSettings>) => setSettings((current) => ({ ...current, ...patch }));
  const setBand = (id: BandId, gain: number) => setSettings((current) => ({ ...current, bands: { ...current.bands, [id]: gain } }));

  function applyToBox(gain: number) {
    if (!box) return;
    if (settings.edits.length >= MAX_EDITS) { toast({ title: copy(`Up to ${MAX_EDITS} boxes`, `حتى ${MAX_EDITS} مربعًا`) }); return; }
    const edit: RegionEdit = { start: round(box.start, 3), end: round(box.end, 3), low: Math.round(box.low), high: Math.round(box.high), gain };
    update({ edits: [...settings.edits, edit] });
    setBox(null);
  }
  function learnNoise() {
    if (!box || !samples || !buffer) return;
    update({ noiseSample: { start: round(box.start, 2), end: round(box.end, 2) }, noiseFloor: rmsDb(samples, buffer.sampleRate, box.start, box.end), noise: Math.max(settings.noise, 3) });
    setBox(null);
  }

  function applySuggestions() {
    if (!analysis) return;
    const { suggestion } = analysis;
    setSettings((current) => ({
      ...current,
      ...(suggestion.noise !== undefined ? { noise: suggestion.noise } : {}),
      ...(suggestion.hum ? { hum: suggestion.hum } : {}),
      ...(suggestion.level ? { level: true } : {}),
      bands: suggestion.bands ? { ...current.bands, ...Object.fromEntries(Object.entries(suggestion.bands).filter(([, gain]) => gain !== 0)) } : current.bands,
    }));
  }

  async function save() {
    setSaving(true);
    stopAll();
    try {
      await soundLabAudioLibraryItem(item.id, settings);
      await queryClient.invalidateQueries({ queryKey: getListAudioLibraryQueryKey() });
      toast({ title: copy("Sound improved", "تم تحسين الصوت"), description: copy("Your original is kept: use Restore original to go back.", "الأصل محفوظ: استخدم «استعادة الأصل» للرجوع.") });
      onClose();
    } catch (error) {
      toast({ variant: "destructive", title: copy("Couldn't save", "تعذر الحفظ"), description: (error as { data?: { error?: string } })?.data?.error ?? (error as Error).message });
    } finally {
      setSaving(false);
    }
  }

  // Space plays; Escape drops a box before it closes the lab.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
      if (event.key === " " && !help) { event.preventDefault(); togglePlay(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  /* ---------- Layout ---------- */

  const kinds: [SoundKind, string][] = [["voice", copy("Voice", "صوت بشري")], ["music", copy("Music", "موسيقى")], ["noise", copy("Noise", "ضوضاء")], ["silence", copy("Silence", "صمت")]];
  const bandText: Record<BandId, [string, string, string]> = {
    rumble: [copy("Rumble", "الهدير"), "20–80 Hz", copy("Traffic, wind, engine, AC thumps", "الطريق والرياح والمحرك وخبطات المكيف")],
    warmth: [copy("Warmth", "الدفء"), "80–300 Hz", copy("Body of the voice; too much sounds boomy", "عمق الصوت؛ الزيادة تجعله مكتومًا")],
    voice: [copy("Voice", "الصوت"), "300 Hz–3.4 kHz", copy("Where words live: clarity of speech", "منطقة الكلام: وضوح الكلمات")],
    presence: [copy("Presence", "الحضور"), "3.4–8 kHz", copy("Crispness; too much is harsh", "الحدة والوضوح؛ الزيادة تجعله خشنًا")],
    air: [copy("Air & hiss", "الهواء والهسهسة"), "8–20 kHz", copy("Sparkle, but also hiss and fan noise", "لمعان الصوت، وأيضًا الهسهسة وصوت المراوح")],
  };
  const findings = analysis ? [
    analysis.hum && { id: "hum", text: copy(`Mains hum at ${analysis.hum} Hz`, `طنين كهربائي عند ${analysis.hum} هرتز`), fix: () => update({ hum: analysis.hum }), done: settings.hum === analysis.hum },
    analysis.suggestion.noise && { id: "noise", text: copy(`Background noise at ${round(analysis.noiseFloorDb - 3, 0)} dB`, `ضوضاء خلفية عند ${round(analysis.noiseFloorDb - 3, 0)} ديسيبل`), fix: () => update({ noise: analysis.suggestion.noise ?? 2 }), done: settings.noise >= (analysis.suggestion.noise ?? 1) },
    analysis.rumble && { id: "rumble", text: copy("Low rumble (wind, traffic, handling)", "هدير منخفض (رياح، طريق، لمس الجهاز)"), fix: () => setBand("rumble", -18), done: settings.bands.rumble <= -12 },
    analysis.hiss && { id: "hiss", text: copy("Hiss in the quiet parts", "هسهسة في الأجزاء الهادئة"), fix: () => { setBand("air", -6); if (!settings.noise) update({ noise: 1 }); }, done: settings.bands.air < 0 },
    analysis.quiet && { id: "quiet", text: copy("The voice is quiet", "الصوت منخفض"), fix: () => update({ level: true }), done: settings.level },
  ].filter(Boolean) as { id: string; text: string; fix: () => void; done: boolean }[] : [];
  const snr = analysis?.voiceLevelDb != null ? round(analysis.voiceLevelDb - analysis.noiseFloorDb, 0) : null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent
        onEscapeKeyDown={(event) => { if (help) { event.preventDefault(); setHelp(null); } else if (box) { event.preventDefault(); setBox(null); } }}
        className="flex h-[100dvh] w-full max-w-6xl flex-col gap-0 overflow-hidden rounded-none border-0 bg-[#0a0d12] p-0 text-white sm:h-[94dvh] sm:rounded-2xl [&>button]:hidden"
        dir={isArabic ? "rtl" : "ltr"}
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-500/15 text-emerald-300"><AudioLines size={18} /></span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base font-semibold text-white">{copy("Sound lab", "مختبر الصوت")}</DialogTitle>
            <DialogDescription className="truncate text-xs text-white/50" dir="auto">{title}</DialogDescription>
          </div>
          <Button size="sm" variant="ghost" onClick={() => openHelp("start")} aria-pressed={!!help}
            className={`h-9 rounded-full px-3 text-white/85 hover:bg-white/10 hover:text-white ${!guideSeen ? "ring-2 ring-emerald-400/70" : ""}`}>
            <CircleHelp size={16} className="me-1.5" />{copy("Guide", "الدليل")}
          </Button>
          <button type="button" onClick={onClose} disabled={saving} aria-label={copy("Close", "إغلاق")} className="grid h-9 w-9 place-items-center rounded-full text-white/70 hover:bg-white/10"><X size={18} /></button>
        </div>

        {loadError ? (
          <p className="m-4 rounded-xl bg-amber-500/15 px-4 py-3 text-sm text-amber-200" role="alert">{loadError}</p>
        ) : !buffer ? (
          <div className="grid flex-1 place-items-center"><Loader2 className="animate-spin text-emerald-400" /></div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            {/* Transport */}
            <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-white/10 bg-[#0a0d12]/95 px-3 py-2 backdrop-blur">
              <button type="button" onClick={togglePlay} aria-label={playing ? copy("Pause", "إيقاف") : copy("Play", "تشغيل")}
                className="grid h-10 w-10 place-items-center rounded-full bg-emerald-500 text-[#04140c] shadow transition active:scale-95">
                {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ms-0.5" />}
              </button>
              <div role="radiogroup" aria-label={copy("Compare", "قارن")} className="flex rounded-full bg-white/10 p-0.5 text-xs font-medium">
                {([[true, copy("Original", "الأصل")], [false, copy("Improved", "المحسّن")]] as const).map(([value, label]) => (
                  <button key={label} type="button" role="radio" aria-checked={bypass === value} onClick={() => setBypass(value)}
                    className={`h-8 rounded-full px-3 transition-colors ${bypass === value ? "bg-white text-black" : "text-white/70 hover:text-white"}`}>{label}</button>
                ))}
              </div>
              <span className="font-mono text-xs tabular-nums text-white/60" dir="ltr">{clock(playhead)} / {clock(length)}</span>
              <span className="flex-1" />
              <Button size="sm" variant="ghost" className="h-9 rounded-full text-white/80 hover:bg-white/10 hover:text-white" disabled={rendering || isNeutral(settings)} onClick={() => void hearExact()}
                title={copy("Renders 15 seconds from the playhead with every setting, including noise reduction", "يجهز 15 ثانية من موضع التشغيل بكل الإعدادات بما فيها تقليل الضوضاء")}>
                {rendering ? <Loader2 size={15} className="me-1.5 animate-spin" /> : <Headphones size={15} className="me-1.5" />}
                {copy("Hear exact result", "استمع للنتيجة الدقيقة")}
              </Button>
              <div className="flex items-center">
                <button type="button" aria-label={copy("Zoom in", "تكبير")} onClick={() => setView((v) => zoomAt(v, 2, playhead, length))} className="grid h-9 w-9 place-items-center rounded-full text-white/70 hover:bg-white/10"><ZoomIn size={16} /></button>
                <button type="button" aria-label={copy("Zoom out", "تصغير")} onClick={() => setView((v) => zoomAt(v, 0.5, playhead, length))} className="grid h-9 w-9 place-items-center rounded-full text-white/70 hover:bg-white/10"><ZoomOut size={16} /></button>
                <button type="button" aria-label={copy("Show all", "عرض الكل")} onClick={() => setView({ start: 0, end: length })} className="grid h-9 w-9 place-items-center rounded-full text-white/70 hover:bg-white/10"><Maximize2 size={15} /></button>
              </div>
            </div>

            {!guideSeen && (
              <div className="mx-3 mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2.5 text-sm" dir={isArabic ? "rtl" : "ltr"}>
                <BookOpen size={16} className="shrink-0 text-emerald-300" />
                <span className="min-w-0 flex-1">{copy("New to the Sound lab? A 2-minute guide explains the picture, the numbers and every tool, with examples.", "جديد على مختبر الصوت؟ دليل في دقيقتين يشرح الصورة والأرقام وكل أداة مع أمثلة.")}</span>
                <Button size="sm" className="h-8 rounded-full bg-emerald-500 px-3 text-[#04140c] hover:bg-emerald-400" onClick={() => openHelp("start")}>{copy("Open the guide", "افتح الدليل")}</Button>
                <button type="button" className="text-xs text-white/60 underline hover:text-white" onClick={markGuideSeen}>{copy("Not now", "ليس الآن")}</button>
              </div>
            )}
            <div className="px-3 pt-3" dir="ltr">
              {/* Spectrogram */}
              <div className="flex gap-1.5">
                <div className="relative w-9 shrink-0 text-[10px] text-white/45" style={{ height: size.height }} aria-hidden="true">
                  {FREQ_LABELS.filter((f) => f < fmax).map((f) => (
                    <span key={f} className="absolute end-0 -translate-y-1/2 tabular-nums" style={{ top: yAtFreq(f, size.height, fmax) }}>{hz(f).replace(" ", "")}</span>
                  ))}
                </div>
                <div ref={area} className="relative min-w-0 flex-1 overflow-hidden rounded-lg bg-black" style={{ height: size.height }}>
                  <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden="true" />
                  {!spec && <div className="absolute inset-0 grid place-items-center text-sm text-white/60"><span className="flex items-center gap-2"><Loader2 size={16} className="animate-spin" />{copy("Listening to your recording…", "جارٍ تحليل التسجيل…")}</span></div>}
                  {/* Band guides */}
                  {spec && [80, 300, 3400, 8000].filter((f) => f < fmax).map((f) => (
                    <div key={f} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-white/15" style={{ top: yAtFreq(f, size.height, fmax) }} />
                  ))}
                  {/* Learned noise */}
                  {settings.noiseSample && (
                    <div className="pointer-events-none absolute inset-y-0 border-x border-sky-300/70 bg-sky-400/15" style={{ left: xAt(settings.noiseSample.start), width: xAt(settings.noiseSample.end) - xAt(settings.noiseSample.start) }}>
                      <span className="absolute start-1 top-1 rounded bg-sky-500/80 px-1 text-[10px] font-semibold">{copy("noise", "ضوضاء")}</span>
                    </div>
                  )}
                  {/* Boxes */}
                  {settings.edits.map((edit, index) => {
                    const top = isFullBand(edit) ? 0 : yAtFreq(Math.min(edit.high, fmax), size.height, fmax);
                    const bottom = isFullBand(edit) ? size.height : yAtFreq(Math.max(edit.low, 40), size.height, fmax);
                    return (
                      <div key={index} className={`pointer-events-none absolute border-2 ${edit.gain < 0 ? "border-red-400 bg-red-500/20" : "border-emerald-300 bg-emerald-400/20"}`}
                        style={{ left: xAt(edit.start), width: Math.max(2, xAt(edit.end) - xAt(edit.start)), top, height: Math.max(2, bottom - top) }}>
                        <span className={`absolute start-0.5 top-0.5 rounded px-1 text-[10px] font-bold ${edit.gain < 0 ? "bg-red-500" : "bg-emerald-500 text-black"}`}>{edit.gain <= EDIT_LIMITS.min ? "✕" : signed(edit.gain)}</span>
                      </div>
                    );
                  })}
                  {/* The box being chosen */}
                  {box && (() => {
                    const top = isFullBand(box) ? 0 : yAtFreq(Math.min(box.high, fmax), size.height, fmax);
                    const bottom = isFullBand(box) ? size.height : yAtFreq(Math.max(box.low, 40), size.height, fmax);
                    return <div className="pointer-events-none absolute border-2 border-dashed border-white bg-white/15 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" style={{ left: xAt(box.start), width: xAt(box.end) - xAt(box.start), top, height: bottom - top }} />;
                  })()}
                  {drag && <div className="pointer-events-none absolute border border-white/90 bg-white/10" style={{ left: Math.min(drag.x, drag.x2), top: Math.abs(drag.y2 - drag.y) < 14 ? 0 : Math.min(drag.y, drag.y2), width: Math.abs(drag.x2 - drag.x), height: Math.abs(drag.y2 - drag.y) < 14 ? size.height : Math.abs(drag.y2 - drag.y) }} />}
                  {playhead >= view.start && playhead <= view.end && <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_6px_white]" style={{ left: xAt(playhead) }} />}
                  <div role="application" aria-label={copy("Spectrogram: drag a box around a sound, or tap to move the playhead", "الطيف: اسحب مربعًا حول صوت، أو انقر لتحريك موضع التشغيل")}
                    className="absolute inset-0 cursor-crosshair touch-none" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)} />
                </div>
              </div>
              {/* What is where */}
              <div className="ms-[2.625rem] mt-1.5">
                <div className="relative h-3 overflow-hidden rounded-full bg-white/5" aria-label={copy("What is heard when", "ماذا يُسمع ومتى")}>
                  {analysis?.segments.filter((s) => s.end > view.start && s.start < view.end).map((s, index) => (
                    <div key={index} title={`${kinds.find(([k]) => k === s.kind)?.[1]} · ${clock(s.start)}–${clock(s.end)}`} className="absolute inset-y-0"
                      style={{ left: xAt(Math.max(s.start, view.start)), width: Math.max(1, xAt(Math.min(s.end, view.end)) - xAt(Math.max(s.start, view.start))), background: KIND_COLOUR[s.kind] }} />
                  ))}
                </div>
                <div className="relative mt-1 h-4 text-[10px] tabular-nums text-white/40">
                  {rulerTicks(view, size.width, 64).map((t) => <span key={t} className="absolute -translate-x-1/2" style={{ left: xAt(t) }}>{clock(t).replace(/\.0$/, "")}</span>)}
                </div>
              </div>
            </div>

            {/* Chosen box: what to do with it */}
            <div className="px-3" dir={isArabic ? "rtl" : "ltr"}>
              {box ? (
                <div className="mt-2 rounded-2xl border border-white/20 bg-white/[0.06] p-3" role="group" aria-label={copy("Selected sound", "الصوت المحدد")}>
                  <p className="flex items-center gap-1 text-sm font-semibold">
                    <span className="min-w-0 flex-1">{copy("Selected", "المحدد")}: <span className="font-mono text-xs font-normal text-white/70" dir="ltr">{clock(box.start)}–{clock(box.end)} · {isFullBand(box) ? copy("all frequencies", "كل الترددات") : `${hz(box.low)}–${hz(box.high)}`}</span></span>
                    <HelpDot {...helpFor("boxes", "How do boxes work?", "كيف تعمل المربعات؟")} />
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" className="h-9 rounded-full bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => playRegion(box)}><Play size={13} className="me-1.5" fill="currentColor" />{copy("Listen to it", "استمع إليه")}</Button>
                    <Button size="sm" className="h-9 rounded-full bg-red-500 text-white hover:bg-red-400" onClick={() => applyToBox(EDIT_LIMITS.min)}><Trash2 size={13} className="me-1.5" />{copy("Remove this sound", "احذف هذا الصوت")}</Button>
                    <Button size="sm" variant="ghost" className="h-9 rounded-full bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => applyToBox(-12)}>{copy("Quieter", "أخفض")} −12 dB</Button>
                    <Button size="sm" variant="ghost" className="h-9 rounded-full bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => applyToBox(6)}>{copy("Louder", "أعلى")} +6 dB</Button>
                    {isFullBand(box) && <Button size="sm" variant="ghost" className="h-9 rounded-full bg-sky-500/20 text-sky-100 hover:bg-sky-500/30 hover:text-white" onClick={learnNoise}><Sparkles size={13} className="me-1.5" />{copy("This is only noise: learn it", "هذا ضوضاء فقط: تعلّمها")}</Button>}
                    <Button size="sm" variant="ghost" className="h-9 rounded-full text-white/60 hover:bg-white/10 hover:text-white" onClick={() => setBox(null)}>{copy("Cancel", "إلغاء")}</Button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/45">
                  <span className="min-w-0 flex-1">
                    {copy("Drag a box around any sound to remove, soften or boost just that. Drag sideways for all frequencies. Tap to move the playhead. Wheel to zoom.",
                      "اسحب مربعًا حول أي صوت لحذفه أو خفضه أو رفعه وحده. اسحب أفقيًا لكل الترددات. انقر لتحريك موضع التشغيل. العجلة للتكبير.")}
                  </span>
                  <button type="button" onClick={() => openHelp("picture")} className="inline-flex items-center gap-1 font-medium text-emerald-300 hover:underline"><CircleHelp size={13} />{copy("How to read this picture?", "كيف أقرأ هذه الصورة؟")}</button>
                  <button type="button" onClick={() => openHelp("sounds")} className="inline-flex items-center gap-1 font-medium text-emerald-300 hover:underline"><CircleHelp size={13} />{copy("What do sounds look like?", "كيف تبدو الأصوات؟")}</button>
                  <button type="button" onClick={() => openHelp("lane")} className="inline-flex items-center gap-1 font-medium text-emerald-300 hover:underline"><CircleHelp size={13} />{copy("The coloured bar", "الشريط الملوّن")}</button>
                </div>
              )}
            </div>

            <div className="grid gap-3 p-3 lg:grid-cols-2" dir={isArabic ? "rtl" : "ltr"}>
              <Panel title={copy("What's in this recording", "ماذا يوجد في هذا التسجيل")} icon={<Sparkles size={15} className="text-amber-300" />} help={helpFor("numbers", "What do these numbers mean?", "ماذا تعني هذه الأرقام؟")}
                note={copy("An automatic estimate from the sound itself.", "تقدير تلقائي من الصوت نفسه.")}>
                {!analysis ? (
                  <p className="flex items-center gap-2 text-sm text-white/60"><Loader2 size={14} className="animate-spin" />{copy("Listening…", "جارٍ التحليل…")}</p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {kinds.map(([kind, label]) => (
                        <span key={kind} className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-xs">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: KIND_COLOUR[kind] }} />{label}
                          <b className="tabular-nums">{Math.round(analysis.share[kind] * 100)}%</b>
                        </span>
                      ))}
                    </div>
                    <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                      {([
                        [copy("Voice level", "مستوى الصوت"), analysis.voiceLevelDb != null ? `${round(analysis.voiceLevelDb - 3, 0)} dB` : "—"],
                        [copy("Background", "الخلفية"), `${round(analysis.noiseFloorDb - 3, 0)} dB`],
                        [copy("Clarity", "الوضوح"), snr == null ? "—" : snr >= 30 ? copy("Good", "جيد") : snr >= 18 ? copy("Fair", "متوسط") : copy("Poor", "ضعيف")],
                      ] as const).map(([label, value]) => (
                        <div key={label} className="rounded-xl bg-black/30 px-2 py-2"><dt className="text-[10px] text-white/50">{label}</dt><dd className="text-sm font-semibold tabular-nums" dir="ltr">{value}</dd></div>
                      ))}
                    </dl>
                    {findings.length ? (
                      <ul className="mt-3 space-y-1.5">
                        {findings.map((finding) => (
                          <li key={finding.id} className="flex items-center gap-2 rounded-xl bg-amber-400/10 px-3 py-2 text-sm">
                            <span className="min-w-0 flex-1">{finding.text}</span>
                            {finding.done ? <span className="inline-flex items-center gap-1 text-xs text-emerald-300"><Check size={13} />{copy("Will be fixed", "سيُصلَح")}</span>
                              : <Button size="sm" className="h-7 rounded-full bg-amber-400 px-3 text-xs text-black hover:bg-amber-300" onClick={finding.fix}>{copy("Fix", "أصلح")}</Button>}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-3 rounded-xl bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100">{copy("No common problems found. Fine-tune below if you like.", "لم تُكتشف مشكلات شائعة. يمكنك الضبط أدناه.")}</p>
                    )}
                    {findings.some((finding) => !finding.done) && (
                      <Button className="mt-3 h-10 w-full rounded-full bg-emerald-500 text-[#04140c] hover:bg-emerald-400" onClick={applySuggestions}><Wand2 size={16} className="me-2" />{copy("Fix everything suggested", "أصلح كل المقترحات")}</Button>
                    )}
                  </>
                )}
              </Panel>

              <Panel title={copy("Clean up", "التنظيف")} icon={<Wand2 size={15} className="text-emerald-300" />} help={helpFor("noise", "About noise reduction and hum", "عن تقليل الضوضاء والطنين")}
                note={copy("Noise reduction and softer S sounds are heard with Hear exact result.", "تقليل الضوضاء وتنعيم حرف السين يُسمعان عبر «استمع للنتيجة الدقيقة».")}>
                <p className="mb-1.5 text-xs font-medium text-white/70">{copy("Background noise reduction", "تقليل الضوضاء الخلفية")}</p>
                <Segmented label={copy("Noise reduction", "تقليل الضوضاء")} value={settings.noise} onChange={(noise) => update({ noise })}
                  options={[[0, copy("Off", "إيقاف")], [1, copy("Light", "خفيف")], [2, copy("Medium", "متوسط")], [3, copy("Strong", "قوي")], [4, copy("Max", "أقصى")]]} />
                <p className="mt-1.5 text-[11px] text-white/50">
                  {settings.noiseSample
                    ? <>{copy("Learned from", "مُتعلَّمة من")} <span dir="ltr">{clock(settings.noiseSample.start)}–{clock(settings.noiseSample.end)}</span> ({settings.noiseFloor} dB) · <button type="button" className="underline" onClick={() => update({ noiseSample: null, noiseFloor: analysis ? round(analysis.noiseFloorDb - 3, 1) : null })}>{copy("forget", "انسَ")}</button></>
                    : copy("Measured automatically. For best results, drag sideways over a moment with only noise and choose “learn it”.", "تُقاس تلقائيًا. لأفضل نتيجة اسحب أفقيًا على لحظة فيها ضوضاء فقط واختر «تعلّمها».")}
                </p>
                <p className="mb-1.5 mt-4 text-xs font-medium text-white/70">{copy("Electrical hum", "الطنين الكهربائي")}</p>
                <Segmented label={copy("Hum removal", "إزالة الطنين")} value={settings.hum} onChange={(hum) => update({ hum })}
                  options={[[null, copy("Off", "إيقاف")], [50, "50 Hz", analysis?.hum === 50 ? copy("found", "موجود") : undefined], [60, "60 Hz", analysis?.hum === 60 ? copy("found", "موجود") : undefined]]} />
                <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 text-sm">
                  <span>{copy("Soften harsh “s” sounds", "نعّم حرف السين الحاد")}</span>
                  <input type="checkbox" className="h-4 w-4 accent-emerald-500" checked={settings.deess} onChange={(event) => update({ deess: event.target.checked })} />
                </label>
              </Panel>

              <Panel title={copy("Frequency bands", "نطاقات التردد")} icon={<AudioLines size={15} className="text-sky-300" />} help={helpFor("bands", "What does each band do?", "ماذا يفعل كل نطاق؟")}
                note={copy("Each band is a part of the sound. Press the headphones to hear only that band, then remove or enlarge it.", "كل نطاق جزء من الصوت. اضغط السماعة لتسمع هذا النطاق فقط، ثم احذفه أو كبّره.")}>
                <div className="space-y-3">
                  {BANDS.map((band) => {
                    const [name, range, about] = bandText[band.id];
                    const gain = settings.bands[band.id];
                    return (
                      <div key={band.id}>
                        <div className="flex items-center gap-2">
                          <button type="button" aria-pressed={solo === band.id} aria-label={copy(`Hear only ${name}`, `استمع إلى ${name} فقط`)} title={copy("Hear only this band", "استمع لهذا النطاق فقط")}
                            onClick={() => { const next = solo === band.id ? null : band.id; setSolo(next); if (!playing) startLive(playhead, { bypass, solo: next }); }}
                            className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors ${solo === band.id ? "bg-sky-400 text-black" : "bg-white/10 text-white/70 hover:text-white"}`}>
                            <Headphones size={14} />
                          </button>
                          <div className="min-w-0 flex-1">
                            <p className="flex items-baseline gap-2 text-sm font-medium">{name}<span className="text-[10px] font-normal text-white/40" dir="ltr">{range}</span></p>
                            <p className="truncate text-[11px] text-white/45">{about}</p>
                          </div>
                          <span className={`w-16 shrink-0 text-end font-mono text-xs tabular-nums ${gain < 0 ? "text-red-300" : gain > 0 ? "text-emerald-300" : "text-white/50"}`} dir="ltr">{gain <= BAND_LIMITS.min ? copy("removed", "محذوف") : signed(gain)}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 ps-10">
                          <input type="range" min={BAND_LIMITS.min} max={BAND_LIMITS.max} step={1} value={gain} onChange={(event) => setBand(band.id, Number(event.target.value))}
                            aria-label={name} className="h-1.5 min-w-0 flex-1 cursor-pointer accent-emerald-400" dir="ltr" />
                          {analysis && <span className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-white/10" title={copy("How much of the sound is in this band", "نسبة الصوت في هذا النطاق")}><span className="block h-full bg-sky-400/70" style={{ width: `${Math.min(100, Math.round(Math.sqrt(analysis.bandShare[band.id]) * 100))}%` }} /></span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {solo && <p className="mt-3 rounded-xl bg-sky-400/10 px-3 py-2 text-xs text-sky-100">{copy("Listening to one band only. Press the headphones again to hear everything.", "تستمع لنطاق واحد فقط. اضغط السماعة مجددًا لتسمع كل شيء.")}</p>}
              </Panel>

              <Panel title={copy("Volume", "مستوى الصوت")} icon={<Maximize2 size={15} className="text-violet-300" />} help={helpFor("volume", "About volume", "عن مستوى الصوت")}>
                <div className="flex items-center justify-between text-xs text-white/60"><span>{copy("Smaller", "أصغر")}</span><span className="font-mono tabular-nums text-white" dir="ltr">{signed(settings.volume)}</span><span>{copy("Bigger", "أكبر")}</span></div>
                <input type="range" min={VOLUME_LIMITS.min} max={VOLUME_LIMITS.max} step={0.5} value={settings.volume} onChange={(event) => update({ volume: Number(event.target.value) })}
                  aria-label={copy("Overall volume", "مستوى الصوت العام")} className="mt-1 h-1.5 w-full cursor-pointer accent-violet-400" dir="ltr" />
                <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 text-sm">
                  <span>{copy("Even out loudness (podcast level)", "وحّد مستوى الصوت (مستوى البودكاست)")}</span>
                  <input type="checkbox" className="h-4 w-4 accent-violet-500" checked={settings.level} onChange={(event) => update({ level: event.target.checked })} />
                </label>
                <p className="mt-2 text-[11px] text-white/45">{copy("A limiter always stops the result from distorting, however loud you make it.", "يمنع المحدِّد دائمًا تشوه الصوت مهما رفعته.")}</p>

                {settings.edits.length > 0 && (
                  <div className="mt-4 border-t border-white/10 pt-3">
                    <p className="mb-2 flex items-center justify-between text-xs font-medium text-white/70">
                      {copy(`Boxes on the picture (${settings.edits.length})`, `مربعات على الطيف (${settings.edits.length})`)}
                      <button type="button" className="text-white/50 underline hover:text-white" onClick={() => update({ edits: [] })}>{copy("Clear all", "امسح الكل")}</button>
                    </p>
                    <ul className="space-y-1.5">
                      {settings.edits.map((edit, index) => (
                        <li key={index} className="flex items-center gap-2 rounded-xl bg-black/30 px-2.5 py-1.5 text-xs">
                          <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${edit.gain < 0 ? "bg-red-400" : "bg-emerald-300"}`} />
                          <span className="min-w-0 flex-1 truncate font-mono text-white/70" dir="ltr">{clock(edit.start)}–{clock(edit.end)} · {isFullBand(edit) ? copy("all", "الكل") : `${hz(edit.low)}–${hz(edit.high)}`}</span>
                          <input type="range" min={EDIT_LIMITS.min} max={EDIT_LIMITS.max} step={1} value={edit.gain} aria-label={copy("Change", "التغيير")} dir="ltr"
                            onChange={(event) => update({ edits: settings.edits.map((other, i) => (i === index ? { ...other, gain: Number(event.target.value) } : other)) })}
                            className="h-1.5 w-20 cursor-pointer accent-emerald-400" />
                          <span className="w-12 text-end font-mono tabular-nums" dir="ltr">{edit.gain <= EDIT_LIMITS.min ? "✕" : signed(edit.gain)}</span>
                          <button type="button" aria-label={copy("Delete box", "احذف المربع")} onClick={() => update({ edits: settings.edits.filter((_, i) => i !== index) })} className="grid h-7 w-7 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"><Trash2 size={13} /></button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Panel>
            </div>
          </div>
        )}

        {help && <SoundLabHelp topic={help} isArabic={isArabic} onClose={() => setHelp(null)} />}
        <div className="flex flex-wrap items-center gap-2 border-t border-white/10 px-4 py-3" dir={isArabic ? "rtl" : "ltr"}>
          <Button variant="ghost" className="h-10 rounded-full text-white/70 hover:bg-white/10 hover:text-white" disabled={isNeutral(settings) || saving}
            onClick={() => setSettings((current) => ({ ...DEFAULT_SETTINGS, noiseFloor: analysis ? round(analysis.noiseFloorDb - 3, 1) : current.noiseFloor }))}>
            <RotateCcw size={15} className="me-1.5" />{copy("Reset", "إعادة ضبط")}
          </Button>
          <p className="hidden min-w-0 flex-1 text-xs text-white/45 sm:block">{copy("Your original is kept and can be restored.", "الأصل محفوظ ويمكن استعادته.")}</p>
          <span className="flex-1 sm:hidden" />
          <Button className="h-10 rounded-full bg-emerald-500 px-5 text-[#04140c] hover:bg-emerald-400" disabled={isNeutral(settings) || saving || !buffer} onClick={() => void save()}>
            {saving ? <Loader2 size={16} className="me-2 animate-spin" /> : <Check size={16} className="me-2" />}
            {saving ? copy("Improving…", "جارٍ التحسين…") : copy("Save improved sound", "احفظ الصوت المحسّن")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
