import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Headphones, Loader2, Music2, Pause, Play, Repeat, Square, Trash2, Upload, X, MoveHorizontal } from "lucide-react";
import { createLibraryRecording, getListAudioLibraryQueryKey, mixAudioLibraryItem, removeAudioLibraryMix, type AudioLibraryItem } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { appPath } from "@/lib/app-path";
import { useLanguage } from "@/lib/i18n";
import { rulerTicks } from "@/lib/audio-view";
import { DEFAULT_MIX, DUCK_DB, REGION_LIMITS, mixPlan, presetSettings, songTimeAt, type MixFit, type MixPreset, type MixSettings } from "@/lib/mix";

const SETTINGS_KEY = "idea-stream-mix-settings";
const MAX_UPLOAD = 50 * 1024 * 1024;
const PREVIEW_SECONDS = 15;
const VOICE_LANE = 56;
const MUSIC_LANE = 72;

const clock = (seconds: number) => {
  const sign = seconds < 0 ? "−" : "";
  const s = Math.abs(seconds);
  return `${sign}${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};
const round = (value: number, places = 2) => Math.round(value * 10 ** places) / 10 ** places;

async function decode(ctx: AudioContext, data: ArrayBuffer) {
  return ctx.decodeAudioData(data);
}

/** Loudness of the voice in 50 ms steps, to dip the music while you speak (live preview). */
function voiceActivity(buffer: AudioBuffer) {
  const data = buffer.getChannelData(0);
  const step = Math.round(buffer.sampleRate * 0.05);
  const levels: number[] = [];
  for (let i = 0; i < data.length; i += step) {
    let sum = 0;
    const end = Math.min(data.length, i + step);
    for (let j = i; j < end; j++) sum += data[j] * data[j];
    levels.push(10 * Math.log10(sum / Math.max(1, end - i) + 1e-12));
  }
  const sorted = [...levels].sort((a, b) => a - b);
  const loud = sorted[Math.floor(sorted.length * 0.9)] ?? -20;
  const threshold = Math.max(-50, loud - 22);
  return levels.map((level) => level > threshold);
}

/** Peak drawing of `get(time)` samples across `width` pixels. */
function drawWave(canvas: HTMLCanvasElement | null, width: number, height: number, colour: string, peakAt: (x: number) => number | null) {
  if (!canvas) return;
  const scale = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(scale, scale);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = colour;
  for (let x = 0; x < width; x++) {
    const peak = peakAt(x);
    if (peak === null) continue;
    const h = Math.max(1, Math.min(1, peak) * (height - 6));
    ctx.fillRect(x, (height - h) / 2, 1, h);
  }
}

function peakBetween(buffer: AudioBuffer, from: number, to: number) {
  const data = buffer.getChannelData(0);
  const a = Math.max(0, Math.floor(from * buffer.sampleRate));
  const b = Math.min(data.length, Math.max(a + 1, Math.ceil(to * buffer.sampleRate)));
  let peak = 0;
  const stride = Math.max(1, Math.floor((b - a) / 400));
  for (let i = a; i < b; i += stride) peak = Math.max(peak, Math.abs(data[i]));
  return peak;
}

const Section = ({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) => (
  <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
    <h3 className="text-sm font-semibold text-white">{title}</h3>
    {note && <p className="mt-1 text-xs leading-5 text-white/50">{note}</p>}
    <div className="mt-3">{children}</div>
  </section>
);

const Choice = <T extends string | number>({ value, options, onChange, label }: { value: T; options: [T, ReactNode][]; onChange: (value: T) => void; label: string }) => (
  <div role="radiogroup" aria-label={label} className="flex rounded-xl bg-black/30 p-1">
    {options.map(([id, text]) => (
      <button key={String(id)} type="button" role="radio" aria-checked={value === id} onClick={() => onChange(id)}
        className={`flex h-8 flex-1 items-center justify-center gap-1 rounded-lg px-1.5 text-xs font-medium transition-colors ${value === id ? "bg-violet-400 text-[#140a24]" : "text-white/70 hover:text-white"}`}>{text}</button>
    ))}
  </div>
);

const Slider = ({ label, value, min, max, step, onChange, format, left, right }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void; format: (value: number) => string; left?: string; right?: string }) => (
  <label className="block">
    <span className="flex items-center justify-between text-xs text-white/70"><span>{label}</span><span className="font-mono tabular-nums text-white" dir="ltr">{format(value)}</span></span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} aria-label={label} dir="ltr"
      className="mt-1 h-1.5 w-full cursor-pointer accent-violet-400" />
    {(left || right) && <span className="mt-0.5 flex justify-between text-[10px] text-white/40"><span>{left}</span><span>{right}</span></span>}
  </label>
);

/**
 * Background music: choose or upload a song, place it on a timeline under the voice (drag to
 * move, drag the edges to make it longer or shorter), choose how it fills the time, and
 * balance it. Saved as a new recording; the voice-only one stays as it is.
 */
export function MusicMixer({ item, title, items, onClose }: { item: AudioLibraryItem; title: string; items: AudioLibraryItem[]; onClose: () => void }) {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const context = useRef<AudioContext | null>(null);
  const [voice, setVoice] = useState<AudioBuffer | null>(null);
  const [music, setMusic] = useState<{ item: AudioLibraryItem; buffer: AudioBuffer } | null>(null);
  const [loadingMusic, setLoadingMusic] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [settings, setSettings] = useState<MixSettings>(() => {
    if (item.mix) return { ...item.mix.settings };
    try { return { ...DEFAULT_MIX, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}"), musicStart: 0 }; } catch { return DEFAULT_MIX; }
  });
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState<"live" | "exact" | null>(null);
  const [rendering, setRendering] = useState(false);
  const [saving, setSaving] = useState<"same" | "copy" | "remove" | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const layer = item.mix;
  const [name, setName] = useState(`${title} · ${copy("with music", "مع موسيقى")}`);
  const [width, setWidth] = useState(800);
  const [listening, setListening] = useState<number | null>(null);

  const nodes = useRef<AudioScheduledSourceNode[]>([]);
  const started = useRef({ at: 0, from: 0 });
  const frame = useRef(0);
  const exact = useRef<HTMLAudioElement | null>(null);
  const exactUrl = useRef<string | null>(null);
  const exactStart = useRef(0);
  const sample = useRef<HTMLAudioElement | null>(null);
  const lanes = useRef<HTMLDivElement>(null);
  const voiceCanvas = useRef<HTMLCanvasElement>(null);
  const musicCanvas = useRef<HTMLCanvasElement>(null);
  const songCanvas = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const voiceLength = voice?.duration ?? item.durationSeconds ?? 0;
  const plan = useMemo(() => (music && voice ? mixPlan(voice.duration, music.buffer.duration, settings) : null), [music, voice, settings]);
  const activity = useMemo(() => (voice ? voiceActivity(voice) : []), [voice]);
  const choices = useMemo(() => items.filter((other) => other.id !== item.id).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "music" ? -1 : 1)), [items, item.id]);

  useEffect(() => { try { const { musicStart: _unused, ...rest } = settings; localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...rest, regionStart: undefined, regionEnd: undefined })); } catch { /* optional */ } }, [settings]);

  /* ---------- Loading ---------- */

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ctx = new AudioContext();
        context.current = ctx;
        // With music already on, edit the voice underneath it (not the mix).
        const response = await fetch(appPath(item.mix?.voiceUrl ?? item.url, import.meta.env.BASE_URL), { credentials: "include" });
        if (!response.ok) throw new Error("download");
        const buffer = await decode(ctx, await response.arrayBuffer());
        if (cancelled) return;
        setVoice(buffer);
        if (item.mix) {
          const used = items.find((other) => other.id === item.mix?.musicItemId)
            ?? ({ id: item.mix.musicItemId ?? -1, url: item.mix.musicUrl, title: item.mix.musicTitle, kind: "music", durationSeconds: null } as unknown as AudioLibraryItem);
          await chooseMusic(used, undefined, true);
        } else {
          setSettings((current) => ({ ...current, regionStart: 0, regionEnd: round(buffer.duration) }));
        }
      } catch {
        if (!cancelled) setLoadError(copy("This recording couldn't be opened on this device.", "تعذر فتح هذا التسجيل على هذا الجهاز."));
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame.current);
      nodes.current.forEach((node) => { try { node.stop(); } catch { /* ended */ } });
      exact.current?.pause();
      sample.current?.pause();
      if (exactUrl.current) URL.revokeObjectURL(exactUrl.current);
      void context.current?.close().catch(() => {});
    };
  }, [item.url]);

  async function chooseMusic(choice: AudioLibraryItem, data?: ArrayBuffer, keepSettings = false) {
    const ctx = context.current;
    if (!ctx) return;
    setLoadingMusic(choice.id);
    sample.current?.pause();
    setListening(null);
    try {
      const bytes = data ?? await (await fetch(appPath(choice.url, import.meta.env.BASE_URL), { credentials: "include" })).arrayBuffer();
      const buffer = await decode(ctx, bytes);
      setMusic({ item: choice, buffer });
      if (!keepSettings) setSettings((current) => ({ ...current, musicStart: 0 }));
    } catch {
      toast({ variant: "destructive", title: copy("This music couldn't be opened", "تعذر فتح هذه الموسيقى"), description: copy("Try another file (MP3, M4A or WAV work best).", "جرّب ملفًا آخر (MP3 أو M4A أو WAV الأفضل).") });
    } finally {
      setLoadingMusic(null);
    }
  }

  async function upload(file: File) {
    if (file.size > MAX_UPLOAD) { toast({ variant: "destructive", title: copy("That file is over 50 MB", "الملف أكبر من 50 ميجابايت") }); return; }
    const ctx = context.current;
    if (!ctx) return;
    setUploading(true);
    try {
      const bytes = await file.arrayBuffer();
      // Check it plays before uploading it.
      const buffer = await decode(ctx, bytes.slice(0));
      const contentType = file.type || "audio/mpeg";
      const request = await fetch(appPath("/api/storage/uploads/request-url", import.meta.env.BASE_URL), {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType }),
      });
      if (!request.ok) throw new Error("request");
      const { uploadURL, objectPath } = (await request.json()) as { uploadURL: string; objectPath: string };
      const put = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": contentType }, body: file });
      if (!put.ok) throw new Error("upload");
      const saved = await createLibraryRecording({
        url: appPath(`/api/storage${objectPath}`, import.meta.env.BASE_URL),
        clientCaptureId: crypto.randomUUID(),
        mimeType: contentType,
        durationSeconds: Math.round(buffer.duration),
        title: file.name.replace(/\.[a-z0-9]{2,5}$/i, "").slice(0, 200),
        kind: "music",
      });
      await queryClient.invalidateQueries({ queryKey: getListAudioLibraryQueryKey() });
      setMusic({ item: saved, buffer });
      setSettings((current) => ({ ...current, musicStart: 0 }));
    } catch {
      toast({ variant: "destructive", title: copy("Couldn't add that file", "تعذرت إضافة الملف"), description: copy("Use an audio file such as MP3, M4A or WAV.", "استخدم ملفًا صوتيًا مثل MP3 أو M4A أو WAV.") });
    } finally {
      setUploading(false);
    }
  }

  function preview(choice: AudioLibraryItem) {
    if (listening === choice.id) { sample.current?.pause(); setListening(null); return; }
    const audio = sample.current ?? new Audio();
    sample.current = audio;
    audio.src = appPath(choice.url, import.meta.env.BASE_URL);
    audio.onended = () => setListening(null);
    void audio.play().catch(() => {});
    setListening(choice.id);
  }

  /* ---------- Live playback ---------- */

  const stop = useCallback(() => {
    cancelAnimationFrame(frame.current);
    nodes.current.forEach((node) => { try { node.stop(); } catch { /* ended */ } });
    nodes.current = [];
    exact.current?.pause();
    setPlaying(null);
  }, []);

  const tick = useCallback(() => {
    const ctx = context.current;
    if (!ctx || !plan) return;
    const now = exact.current && !exact.current.paused ? exactStart.current + exact.current.currentTime : started.current.from + (ctx.currentTime - started.current.at);
    setPlayhead(Math.min(plan.total, now));
    if (now >= plan.total) { stop(); return; }
    frame.current = requestAnimationFrame(tick);
  }, [plan, stop]);

  function playLive(from: number) {
    const ctx = context.current;
    if (!ctx || !voice || !music || !plan) return;
    stop();
    void ctx.resume();
    const at = ctx.currentTime + 0.05;
    const when = (time: number) => at + (time - from);
    // Voice.
    if (from < plan.pre + voice.duration) {
      const source = ctx.createBufferSource();
      source.buffer = voice;
      const gain = ctx.createGain();
      gain.gain.value = 10 ** (settings.voiceVolume / 20);
      source.connect(gain).connect(ctx.destination);
      source.start(Math.max(at, when(plan.pre)), Math.max(0, from - plan.pre));
      nodes.current.push(source);
    }
    // Music.
    const into = from - plan.offset;
    if (into < plan.played) {
      const source = ctx.createBufferSource();
      source.buffer = music.buffer;
      source.playbackRate.value = plan.tempo;
      if (plan.loops) { source.loop = true; source.loopStart = settings.musicStart; source.loopEnd = Math.min(music.buffer.duration, settings.musicStart + plan.source); }
      let chain: AudioNode = source;
      if (settings.makeRoom) {
        const dip = ctx.createBiquadFilter();
        dip.type = "peaking"; dip.frequency.value = 1500; dip.Q.value = 0.6; dip.gain.value = -5;
        chain.connect(dip); chain = dip;
      }
      // Fades, on the music block's own clock.
      const fade = ctx.createGain();
      const blockTime = (elapsed: number) => when(plan.offset + elapsed);
      const fadeIn = Math.min(settings.fadeIn, plan.played / 2);
      const fadeOut = Math.min(settings.fadeOut, plan.played / 2);
      const level = (elapsed: number) => Math.min(1, fadeIn ? elapsed / fadeIn : 1, fadeOut ? (plan.played - elapsed) / fadeOut : 1);
      const startAt = Math.max(0, into);
      fade.gain.setValueAtTime(Math.max(0, level(startAt)), Math.max(at, blockTime(startAt)));
      if (fadeIn && startAt < fadeIn) fade.gain.linearRampToValueAtTime(1, blockTime(fadeIn));
      if (fadeOut) { fade.gain.setValueAtTime(Math.max(0, level(Math.max(startAt, plan.played - fadeOut))), Math.max(at, blockTime(Math.max(startAt, plan.played - fadeOut)))); fade.gain.linearRampToValueAtTime(0, blockTime(plan.played)); }
      chain.connect(fade); chain = fade;
      // Dip while the voice speaks.
      const duck = ctx.createGain();
      const dip = 10 ** (-DUCK_DB[settings.duck] / 20);
      if (settings.duck) {
        let speaking: boolean | null = null;
        activity.forEach((active, index) => {
          const time = when(plan.pre + index * 0.05);
          if (time < at - 0.05 || active === speaking) return;
          speaking = active;
          duck.gain.setTargetAtTime(active ? dip : 1, Math.max(at, time), active ? 0.015 : 0.12);
        });
      }
      chain.connect(duck); chain = duck;
      const volume = ctx.createGain();
      volume.gain.value = 10 ** (settings.musicVolume / 20);
      chain.connect(volume).connect(ctx.destination);
      const song = songTimeAt(plan, settings, startAt) ?? settings.musicStart;
      const begin = Math.max(at, blockTime(startAt));
      source.start(begin, song);
      source.stop(begin + (plan.played - startAt));
      nodes.current.push(source);
    }
    started.current = { at, from };
    setPlaying("live");
    frame.current = requestAnimationFrame(tick);
  }

  // Changing anything while playing restarts from the same moment, so you hear it at once.
  useEffect(() => {
    if (playing !== "live") return;
    const ctx = context.current;
    if (!ctx) return;
    const timer = window.setTimeout(() => playLive(started.current.from + (ctx.currentTime - started.current.at)), 120);
    return () => window.clearTimeout(timer);
  }, [settings]);

  async function hearExact() {
    if (!music || !plan) return;
    stop();
    setRendering(true);
    const start = Math.max(0, Math.min(playhead, Math.max(0, plan.total - 3)));
    try {
      const response = await fetch(appPath(`/api/audio-library/${item.id}/mix/preview`, import.meta.env.BASE_URL), {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ musicItemId: music.item.id, settings, start: round(start), seconds: Math.min(PREVIEW_SECONDS, Math.max(3, plan.total - start)) }),
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

  async function save(target: "same" | "copy") {
    if (!music) return;
    stop();
    setSaving(target);
    try {
      await mixAudioLibraryItem(item.id, { musicItemId: music.item.id, settings, target, title: target === "copy" ? name.trim() || undefined : undefined });
      await queryClient.invalidateQueries({ queryKey: getListAudioLibraryQueryKey() });
      toast(target === "same"
        ? { title: layer ? copy("Music updated", "حُدّثت الموسيقى") : copy("Music added", "أُضيفت الموسيقى"), description: copy("You can edit or remove it any time from the recording's menu.", "يمكنك تعديلها أو إزالتها في أي وقت من قائمة التسجيل.") }
        : { title: copy("Saved as a copy", "حُفظت كنسخة"), description: copy("The copy is at the top of your library; this recording is unchanged.", "النسخة في أعلى مكتبتك، وهذا التسجيل لم يتغير.") });
      onClose();
    } catch (error) {
      toast({ variant: "destructive", title: copy("Couldn't save", "تعذر الحفظ"), description: (error as { data?: { error?: string } })?.data?.error ?? (error as Error).message });
    } finally {
      setSaving(null);
    }
  }

  async function removeMusic() {
    stop();
    setSaving("remove");
    try {
      await removeAudioLibraryMix(item.id);
      await queryClient.invalidateQueries({ queryKey: getListAudioLibraryQueryKey() });
      toast({ title: copy("Music removed", "أُزيلت الموسيقى"), description: copy("The recording is back to your voice as it was.", "عاد التسجيل إلى صوتك كما كان.") });
      onClose();
    } catch (error) {
      toast({ variant: "destructive", title: copy("Couldn't remove the music", "تعذرت إزالة الموسيقى"), description: (error as { data?: { error?: string } })?.data?.error ?? (error as Error).message });
    } finally {
      setSaving(null);
    }
  }

  /* ---------- Timeline (on the recording's own clock: the voice sits at 0) ---------- */

  const [frozenView, setFrozenView] = useState<{ start: number; end: number } | null>(null);
  const liveView = useMemo(() => {
    const start = Math.min(0, settings.regionStart);
    const end = Math.max(voiceLength, settings.regionEnd);
    const margin = Math.max(1, (end - start) * 0.06);
    return { start: start - margin, end: end + margin };
  }, [settings.regionStart, settings.regionEnd, voiceLength]);
  const view = frozenView ?? liveView;
  const span = view.end - view.start;
  const xOf = (time: number) => ((time - view.start) / span) * width;
  const pct = (time: number) => `${((time - view.start) / span) * 100}%`;

  useEffect(() => {
    const element = lanes.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.floor(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, [music]);

  useEffect(() => {
    if (!voice) return;
    drawWave(voiceCanvas.current, width, VOICE_LANE, "#34d399", (x) => {
      const time = view.start + (x / width) * span;
      if (time < 0 || time > voice.duration) return null;
      return peakBetween(voice, time, time + span / width) * 1.6;
    });
  }, [voice, view, width, span]);

  useEffect(() => {
    if (!music || !plan) return;
    drawWave(musicCanvas.current, width, MUSIC_LANE, "#c4b5fd", (x) => {
      const time = view.start + (x / width) * span;
      const song = songTimeAt(plan, settings, time - settings.regionStart);
      if (song === null) return null;
      return peakBetween(music.buffer, song, song + (span / width) * plan.tempo) * 1.4;
    });
  }, [music, plan, view, width, span, settings]);

  useEffect(() => {
    if (!music) return;
    const element = songCanvas.current;
    const songWidth = element?.parentElement?.clientWidth ?? width;
    drawWave(element, songWidth, 36, "#a78bfa", (x) => {
      const time = (x / songWidth) * music.buffer.duration;
      return peakBetween(music.buffer, time, time + music.buffer.duration / songWidth) * 1.4;
    });
  }, [music, width]);

  const drag = useRef<{ mode: "move" | "start" | "end"; x: number; region: [number, number] } | null>(null);
  const beginDrag = (mode: "move" | "start" | "end") => (event: ReactPointerEvent<HTMLElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { mode, x: event.clientX, region: [settings.regionStart, settings.regionEnd] };
    setFrozenView(liveView);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current) return;
    const seconds = ((event.clientX - current.x) / width) * span;
    const [a, b] = current.region;
    const snap = (time: number) => {
      // The voice's start and end pull the edges in, so lining up is easy.
      for (const target of [0, voiceLength]) if (Math.abs(time - target) < span * 0.012) return target;
      return round(time, 2);
    };
    const minStart = -REGION_LIMITS.before;
    const maxEnd = voiceLength + REGION_LIMITS.after;
    let next: [number, number];
    if (current.mode === "move") {
      const shift = Math.min(maxEnd - b, Math.max(minStart - a, seconds));
      const start = snap(a + shift);
      next = [start, round(start + (b - a), 2)];
    } else if (current.mode === "start") next = [Math.min(b - REGION_LIMITS.min, Math.max(minStart, snap(a + seconds))), b];
    else next = [a, Math.max(a + REGION_LIMITS.min, Math.min(maxEnd, snap(b + seconds)))];
    setSettings((s) => ({ ...s, regionStart: next[0], regionEnd: next[1] }));
  };
  const endDrag = () => { drag.current = null; setFrozenView(null); };

  const seekTo = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!plan) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const time = view.start + ((event.clientX - rect.left) / rect.width) * span;
    const result = Math.min(plan.total, Math.max(0, time + plan.pre));
    setPlayhead(result);
    if (playing === "live") playLive(result);
  };

  const update = (patch: Partial<MixSettings>) => setSettings((current) => ({ ...current, ...patch }));
  const applyPreset = (preset: MixPreset) => setSettings((current) => presetSettings(preset, voiceLength, current));
  const playheadOnClock = plan ? playhead - plan.pre : 0;

  const fitText = !plan ? "" : settings.fit === "loop"
    ? (plan.loops ? copy(`Repeats ×${round(plan.region / plan.source, 1)}`, `يتكرر ×${round(plan.region / plan.source, 1)}`) : copy("Plays once, cut to fit", "يُشغَّل مرة ويُقص ليناسب"))
    : settings.fit === "stretch"
      ? `${plan.tempo < 1 ? copy("Slowed", "أبطأ") : plan.tempo > 1 ? copy("Sped up", "أسرع") : copy("Exact fit", "مطابق")} ${round(1 / plan.tempo, 2)}×${plan.loops ? copy(" + repeats", " + تكرار") : ""}`
      : plan.played < plan.region ? copy(`Ends after ${clock(plan.played)}`, `ينتهي بعد ${clock(plan.played)}`) : copy("Plays once", "مرة واحدة");

  /* ---------- Layout ---------- */

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="flex h-[100dvh] w-full max-w-6xl flex-col gap-0 overflow-hidden rounded-none border-0 bg-[#0c0a14] p-0 text-white sm:h-[94dvh] sm:rounded-2xl [&>button]:hidden" dir={isArabic ? "rtl" : "ltr"}>
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-500/20 text-violet-300"><Music2 size={18} /></span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base font-semibold text-white">{layer ? copy("Edit background music", "تعديل الموسيقى الخلفية") : copy("Background music", "موسيقى خلفية")}</DialogTitle>
            <DialogDescription className="truncate text-xs text-white/50" dir="auto">{title}</DialogDescription>
          </div>
          {layer && (
            confirmRemove ? (
              <span className="flex items-center gap-1.5 rounded-full bg-red-500/15 py-1 pe-1 ps-3 text-xs text-red-100">
                {copy("Remove the music?", "إزالة الموسيقى؟")}
                <Button size="sm" className="h-7 rounded-full bg-red-500 px-3 text-white hover:bg-red-400" disabled={!!saving} onClick={() => void removeMusic()}>
                  {saving === "remove" ? <Loader2 size={13} className="animate-spin" /> : copy("Remove", "إزالة")}
                </Button>
                <button type="button" className="px-1.5 text-white/70 hover:text-white" onClick={() => setConfirmRemove(false)}>{copy("Keep", "إبقاء")}</button>
              </span>
            ) : (
              <Button size="sm" variant="ghost" className="h-9 rounded-full text-red-200 hover:bg-red-500/15 hover:text-red-100" disabled={!!saving} onClick={() => setConfirmRemove(true)}>
                <Trash2 size={15} className="me-1.5" />{copy("Remove music", "أزل الموسيقى")}
              </Button>
            )
          )}
          <button type="button" onClick={onClose} disabled={!!saving} aria-label={copy("Close", "إغلاق")} className="grid h-9 w-9 place-items-center rounded-full text-white/70 hover:bg-white/10"><X size={18} /></button>
        </div>

        <input ref={fileInput} type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac,.webm" className="hidden"
          onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />

        {loadError ? (
          <p className="m-4 rounded-xl bg-amber-500/15 px-4 py-3 text-sm text-amber-200" role="alert">{loadError}</p>
        ) : !voice ? (
          <div className="grid flex-1 place-items-center"><Loader2 className="animate-spin text-violet-300" /></div>
        ) : !music ? (
          /* ---------- Step 1: choose the music ---------- */
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <p className="text-lg font-semibold">{copy("Choose the music", "اختر الموسيقى")}</p>
            <p className="mt-1 text-sm text-white/60">{copy("Upload a song from your phone or computer, or use anything already in your library.", "ارفع أغنية من هاتفك أو حاسوبك، أو استخدم أي شيء في مكتبتك.")}</p>
            <button type="button" disabled={uploading} onClick={() => fileInput.current?.click()}
              className="mt-4 flex w-full items-center gap-4 rounded-2xl border-2 border-dashed border-violet-400/50 bg-violet-500/10 p-5 text-start transition hover:bg-violet-500/15 disabled:opacity-60">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-violet-400 text-[#140a24]">{uploading ? <Loader2 size={22} className="animate-spin" /> : <Upload size={22} />}</span>
              <span>
                <span className="block font-semibold">{uploading ? copy("Adding your music…", "جارٍ إضافة الموسيقى…") : copy("Upload a music file", "ارفع ملف موسيقى")}</span>
                <span className="block text-sm text-white/60">{copy("MP3, M4A, WAV, OGG or FLAC, up to 50 MB. It's kept in your library for next time.", "MP3 أو M4A أو WAV أو OGG أو FLAC حتى 50 ميجابايت. يُحفظ في مكتبتك للمرة القادمة.")}</span>
              </span>
            </button>
            <p className="mt-2 text-[11px] text-white/40">{copy("Use music you have the right to use, especially if you'll publish the result.", "استخدم موسيقى يحق لك استخدامها، خاصة إن كنت ستنشر النتيجة.")}</p>

            {choices.length > 0 && (
              <>
                <p className="mb-2 mt-6 text-sm font-semibold">{copy("From your library", "من مكتبتك")}</p>
                <ul className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10">
                  {choices.map((choice) => (
                    <li key={choice.id} className="flex items-center gap-3 px-3 py-2.5">
                      <button type="button" onClick={() => preview(choice)} aria-label={listening === choice.id ? copy("Stop", "إيقاف") : copy("Listen", "استمع")}
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20">
                        {listening === choice.id ? <Square size={13} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ms-0.5" />}
                      </button>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 truncate text-sm font-medium" dir="auto">
                          {choice.kind === "music" && <Music2 size={13} className="shrink-0 text-violet-300" />}
                          {choice.title || choice.transcript?.slice(0, 60) || copy("Voice note", "ملاحظة صوتية")}
                        </span>
                        <span className="block text-xs tabular-nums text-white/45">{choice.kind === "music" ? copy("Music", "موسيقى") : copy("Recording", "تسجيل")}{choice.durationSeconds != null && ` · ${clock(choice.durationSeconds)}`}</span>
                      </span>
                      <Button size="sm" className="h-8 rounded-full bg-violet-400 px-4 text-[#140a24] hover:bg-violet-300" disabled={loadingMusic !== null} onClick={() => void chooseMusic(choice)}>
                        {loadingMusic === choice.id ? <Loader2 size={14} className="animate-spin" /> : copy("Use", "استخدم")}
                      </Button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : (
          /* ---------- Step 2: place and balance ---------- */
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-white/10 bg-[#0c0a14]/95 px-3 py-2 backdrop-blur">
              <button type="button" onClick={() => (playing ? stop() : playLive(plan && playhead >= plan.total - 0.05 ? 0 : playhead))} aria-label={playing ? copy("Pause", "إيقاف") : copy("Play", "تشغيل")}
                className="grid h-10 w-10 place-items-center rounded-full bg-violet-400 text-[#140a24] shadow transition active:scale-95">
                {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ms-0.5" />}
              </button>
              <span className="font-mono text-xs tabular-nums text-white/60" dir="ltr">{clock(playhead)} / {clock(plan?.total ?? 0)}</span>
              <span className="flex-1" />
              <Button size="sm" variant="ghost" className="h-9 rounded-full text-white/80 hover:bg-white/10 hover:text-white" disabled={rendering} onClick={() => void hearExact()}
                title={copy("Mixes 15 seconds from the playhead exactly as it will be saved", "يمزج 15 ثانية من موضع التشغيل كما ستُحفظ تمامًا")}>
                {rendering ? <Loader2 size={15} className="me-1.5 animate-spin" /> : <Headphones size={15} className="me-1.5" />}
                {copy("Hear exact result", "استمع للنتيجة الدقيقة")}
              </Button>
              <Button size="sm" variant="ghost" className="h-9 rounded-full text-white/80 hover:bg-white/10 hover:text-white" onClick={() => { stop(); setMusic(null); }}>
                <Music2 size={15} className="me-1.5" />{copy("Change music", "غيّر الموسيقى")}
              </Button>
            </div>

            <div className="px-3 pt-3">
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={copy("Quick start", "بداية سريعة")}>
                {([
                  ["under", copy("Under my whole voice", "تحت صوتي كله")],
                  ["introOutro", copy("Intro and outro", "مقدمة وخاتمة")],
                  ["intro", copy("Intro only", "مقدمة فقط")],
                  ["stretch", copy("Stretch to fit exactly", "مدّها لتطابق تمامًا")],
                ] as const).map(([preset, label]) => (
                  <button key={preset} type="button" onClick={() => applyPreset(preset)} className="h-8 rounded-full bg-white/10 px-3 text-xs font-medium text-white/85 hover:bg-white/20">{label}</button>
                ))}
              </div>

              {/* Timeline */}
              <div className="mt-3" dir="ltr">
                <div ref={lanes} className="relative select-none rounded-xl bg-black/40 p-0" onPointerDown={seekTo}>
                  <div className="relative" style={{ height: VOICE_LANE }}>
                    <canvas ref={voiceCanvas} className="absolute inset-0 h-full w-full" aria-hidden="true" />
                    <span className="pointer-events-none absolute start-2 top-1 rounded bg-emerald-500/20 px-1.5 text-[10px] font-semibold text-emerald-200">{copy("Your voice", "صوتك")}</span>
                  </div>
                  <div className="relative border-t border-white/10" style={{ height: MUSIC_LANE }}>
                    {plan && (
                      <div role="group" aria-label={copy("Music block: drag to move, drag the edges to make it longer or shorter", "كتلة الموسيقى: اسحبها لتحريكها، واسحب الأطراف لتطويلها أو تقصيرها")}
                        className="absolute inset-y-1 cursor-grab touch-none rounded-lg border border-violet-300/70 bg-violet-500/20 active:cursor-grabbing"
                        style={{ left: pct(settings.regionStart), width: `${(plan.region / span) * 100}%` }}
                        onPointerDown={beginDrag("move")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
                        <span className="pointer-events-none absolute start-2 top-1 z-10 flex items-center gap-1 rounded bg-black/50 px-1.5 text-[10px] font-semibold text-violet-100">
                          <Music2 size={10} />{fitText}
                        </span>
                        {[["start", "start-0 rounded-s-lg"], ["end", "end-0 rounded-e-lg"]].map(([edge, place]) => (
                          <span key={edge} role="slider" aria-label={edge === "start" ? copy("Music start", "بداية الموسيقى") : copy("Music end", "نهاية الموسيقى")}
                            aria-valuenow={edge === "start" ? settings.regionStart : settings.regionEnd} aria-valuemin={-REGION_LIMITS.before} aria-valuemax={voiceLength + REGION_LIMITS.after} tabIndex={0}
                            onPointerDown={beginDrag(edge as "start" | "end")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
                            onKeyDown={(event) => {
                              const step = event.shiftKey ? 1 : 0.1;
                              const delta = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
                              if (!delta) return;
                              event.preventDefault();
                              if (edge === "start") update({ regionStart: round(Math.min(settings.regionEnd - REGION_LIMITS.min, Math.max(-REGION_LIMITS.before, settings.regionStart + delta))) });
                              else update({ regionEnd: round(Math.max(settings.regionStart + REGION_LIMITS.min, Math.min(voiceLength + REGION_LIMITS.after, settings.regionEnd + delta))) });
                            }}
                            className={`absolute inset-y-0 z-10 grid w-4 cursor-ew-resize place-items-center bg-violet-300/80 text-[#140a24] ${place}`}>
                            <MoveHorizontal size={10} />
                          </span>
                        ))}
                      </div>
                    )}
                    <canvas ref={musicCanvas} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" />
                    {plan?.loops && Array.from({ length: Math.min(60, Math.floor(plan.played / (plan.source / plan.tempo))) }, (_, k) => settings.regionStart + (k + 1) * (plan.source / plan.tempo))
                      .filter((seam) => seam < settings.regionStart + plan.played).map((seam) => (
                        <span key={seam} className="pointer-events-none absolute inset-y-2 border-s border-dashed border-violet-200/50" style={{ left: pct(seam) }} />
                      ))}
                  </div>
                  {/* The voice's own start and end, and the playhead. */}
                  {[0, voiceLength].map((edge) => <span key={edge} className="pointer-events-none absolute inset-y-0 border-s border-emerald-300/30" style={{ left: xOf(edge) }} />)}
                  {plan && <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_6px_white]" style={{ left: xOf(playheadOnClock) }} />}
                </div>
                <div className="relative mt-1 h-4 text-[10px] tabular-nums text-white/40">
                  {rulerTicks(view, width, 64).map((t) => <span key={t} className="absolute -translate-x-1/2" style={{ left: xOf(t) }}>{clock(t)}</span>)}
                </div>
                <p className="mt-1 text-xs text-white/45" dir={isArabic ? "rtl" : "ltr"}>
                  {copy("Drag the purple block to move the music; drag its edges to make it longer or shorter. Before 0:00 is an intro, after your voice ends is an outro. Tap to move the playhead.",
                    "اسحب الكتلة البنفسجية لتحريك الموسيقى، واسحب أطرافها لتطويلها أو تقصيرها. ما قبل 0:00 مقدمة، وما بعد نهاية صوتك خاتمة. انقر لتحريك موضع التشغيل.")}
                </p>
              </div>
            </div>

            <div className="grid gap-3 p-3 lg:grid-cols-2">
              <Section title={copy("How the music fills its block", "كيف تملأ الموسيقى كتلتها")}
                note={copy("When the song is shorter or longer than the block.", "عندما تكون الأغنية أقصر أو أطول من الكتلة.")}>
                <Choice label={copy("Fill", "الملء")} value={settings.fit} onChange={(fit: MixFit) => update({ fit })}
                  options={[["loop", <><Repeat size={13} />{copy("Loop", "تكرار")}</>], ["stretch", <><MoveHorizontal size={13} />{copy("Stretch", "مدّ")}</>], ["once", <><Play size={12} />{copy("Once", "مرة")}</>]]} />
                <p className="mt-2 text-xs leading-5 text-white/55">
                  {settings.fit === "loop" ? copy("Repeats the song to fill the block, and cuts it at the end.", "يكرر الأغنية لملء الكتلة ويقصها عند النهاية.")
                    : settings.fit === "stretch" ? copy("Plays the song slower or faster (same pitch) so it ends exactly with the block. Natural between 0.5× and 2×; beyond that it also repeats.", "يشغّل الأغنية أبطأ أو أسرع (بنفس النغمة) لتنتهي مع الكتلة تمامًا. طبيعي بين 0.5× و2×، وبعدها يكرر أيضًا.")
                      : copy("Plays the song once from the chosen start; it stops early if the block is longer.", "يشغّل الأغنية مرة من البداية المختارة، وتتوقف مبكرًا إن كانت الكتلة أطول.")}
                </p>
                <div className="mt-4">
                  <p className="text-xs text-white/70">{copy("Start the song from", "ابدأ الأغنية من")} <span className="font-mono tabular-nums text-white" dir="ltr">{clock(settings.musicStart)}</span></p>
                  <div className="relative mt-1.5 h-9 overflow-hidden rounded-lg bg-black/40" dir="ltr">
                    <canvas ref={songCanvas} className="absolute inset-0 h-full w-full" aria-hidden="true" />
                    <span className="pointer-events-none absolute inset-y-0 start-0 bg-black/60" style={{ width: `${(settings.musicStart / music.buffer.duration) * 100}%` }} />
                    <input type="range" min={0} max={Math.max(0, Math.floor(music.buffer.duration - 1))} step={0.5} value={settings.musicStart}
                      onChange={(event) => update({ musicStart: Number(event.target.value) })} aria-label={copy("Start the song from", "ابدأ الأغنية من")}
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                    <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-violet-200" style={{ left: `${(settings.musicStart / music.buffer.duration) * 100}%` }} />
                  </div>
                  <p className="mt-1 truncate text-[11px] text-white/40" dir="auto"><Music2 size={10} className="me-1 inline" />{music.item.title || copy("Music", "موسيقى")} · {clock(music.buffer.duration)}</p>
                </div>
              </Section>

              <Section title={copy("Balance", "التوازن")}>
                <div className="space-y-4">
                  <Slider label={copy("Music volume", "صوت الموسيقى")} value={settings.musicVolume} min={-40} max={6} step={1} onChange={(musicVolume) => update({ musicVolume })} format={(v) => `${v > 0 ? "+" : ""}${v} dB`} left={copy("Softer", "أخفت")} right={copy("Louder", "أعلى")} />
                  <Slider label={copy("Voice volume", "صوتك")} value={settings.voiceVolume} min={-12} max={12} step={0.5} onChange={(voiceVolume) => update({ voiceVolume })} format={(v) => `${v > 0 ? "+" : ""}${v} dB`} />
                  <div>
                    <p className="mb-1.5 text-xs text-white/70">{copy("Lower the music while I speak", "اخفض الموسيقى أثناء كلامي")}</p>
                    <Choice label={copy("Lower the music while I speak", "اخفض الموسيقى أثناء كلامي")} value={settings.duck} onChange={(duck: number) => update({ duck })}
                      options={[[0, copy("Off", "إيقاف")], [1, copy("Light", "خفيف")], [2, copy("Medium", "متوسط")], [3, copy("Strong", "قوي")]]} />
                    <p className="mt-1 text-[11px] text-white/45">{copy("Like radio and podcasts: the music steps back when you talk and returns in the pauses.", "كالإذاعة والبودكاست: تنخفض الموسيقى عندما تتكلم وتعود في الوقفات.")}</p>
                  </div>
                  <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
                    <span>{copy("Make room for my voice", "أفسح المجال لصوتي")}<span className="block text-[11px] text-white/45">{copy("Softens the part of the music where words live.", "يخفف الجزء من الموسيقى الذي تقع فيه الكلمات.")}</span></span>
                    <input type="checkbox" className="h-4 w-4 accent-violet-400" checked={settings.makeRoom} onChange={(event) => update({ makeRoom: event.target.checked })} />
                  </label>
                </div>
              </Section>

              <Section title={copy("Fades", "التلاشي")}>
                <div className="grid grid-cols-2 gap-4">
                  <Slider label={copy("Fade in", "ظهور تدريجي")} value={settings.fadeIn} min={0} max={10} step={0.5} onChange={(fadeIn) => update({ fadeIn })} format={(v) => `${v} s`} />
                  <Slider label={copy("Fade out", "اختفاء تدريجي")} value={settings.fadeOut} min={0} max={10} step={0.5} onChange={(fadeOut) => update({ fadeOut })} format={(v) => `${v} s`} />
                </div>
              </Section>

              <Section title={copy("Exact timing", "التوقيت بدقة")} note={copy("The block's position on your recording's clock (negative = before you start speaking).", "موضع الكتلة على توقيت تسجيلك (السالب = قبل أن تبدأ الكلام).")}>
                <div className="grid grid-cols-2 gap-3">
                  {([["regionStart", copy("Music starts at", "تبدأ الموسيقى عند")], ["regionEnd", copy("Music ends at", "تنتهي الموسيقى عند")]] as const).map(([key, label]) => (
                    <label key={key} className="block text-xs text-white/70">{label}
                      <input type="number" step={0.5} value={settings[key]} dir="ltr"
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (!Number.isFinite(value)) return;
                          if (key === "regionStart") update({ regionStart: Math.min(settings.regionEnd - REGION_LIMITS.min, Math.max(-REGION_LIMITS.before, value)) });
                          else update({ regionEnd: Math.max(settings.regionStart + REGION_LIMITS.min, Math.min(voiceLength + REGION_LIMITS.after, value)) });
                        }}
                        className="mt-1 h-9 w-full rounded-lg border border-white/15 bg-black/30 px-2 font-mono text-sm text-white outline-none focus:border-violet-300" />
                    </label>
                  ))}
                </div>
                {plan && <p className="mt-2 text-[11px] text-white/45">{copy(`Result: ${clock(plan.total)} long${plan.pre ? `, your voice starts at ${clock(plan.pre)}` : ""}.`, `النتيجة: ${clock(plan.total)}${plan.pre ? `، ويبدأ صوتك عند ${clock(plan.pre)}` : ""}.`)}</p>}
              </Section>
            </div>
          </div>
        )}

        {music && (
          <div className="flex flex-col gap-2 border-t border-white/10 px-4 py-3 sm:flex-row sm:items-center">
            <p className="min-w-0 flex-1 text-xs text-white/50">
              {copy("The music stays a separate layer: you can edit, change or remove it later, and your voice underneath is kept.", "تبقى الموسيقى طبقة منفصلة: يمكنك تعديلها أو تغييرها أو إزالتها لاحقًا، ويُحفظ صوتك تحتها.")}
            </p>
            <details className="group relative">
              <summary className="flex h-10 cursor-pointer list-none items-center justify-center gap-1.5 rounded-full px-4 text-sm text-white/75 hover:bg-white/10 hover:text-white">
                <Copy size={15} />{copy("Save as a copy…", "احفظ كنسخة…")}
              </summary>
              <div className="absolute bottom-12 end-0 z-30 w-72 rounded-2xl border border-white/15 bg-[#17132a] p-3 shadow-2xl">
                <label className="block text-xs text-white/60">{copy("Name of the copy", "اسم النسخة")}
                  <input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} dir="auto"
                    className="mt-1 h-9 w-full rounded-lg border border-white/15 bg-black/30 px-2.5 text-sm text-white outline-none focus:border-violet-300" />
                </label>
                <Button className="mt-2 h-9 w-full rounded-full bg-white/15 text-white hover:bg-white/25" disabled={!!saving} onClick={() => void save("copy")}>
                  {saving === "copy" ? <Loader2 size={15} className="me-2 animate-spin" /> : <Copy size={15} className="me-2" />}{copy("Save the copy", "احفظ النسخة")}
                </Button>
              </div>
            </details>
            <Button className="h-10 w-full rounded-full bg-violet-400 px-5 text-[#140a24] hover:bg-violet-300 sm:w-auto" disabled={!!saving} onClick={() => void save("same")}>
              {saving === "same" ? <Loader2 size={16} className="me-2 animate-spin" /> : <Check size={16} className="me-2" />}
              {saving === "same" ? copy("Mixing…", "جارٍ المزج…") : layer ? copy("Update the music", "حدّث الموسيقى") : copy("Add music to this recording", "أضف الموسيقى لهذا التسجيل")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
