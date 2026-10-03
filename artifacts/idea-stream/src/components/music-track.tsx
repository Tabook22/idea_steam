import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Mic, Minus, Music2, Pencil, Plus, Trash2 } from "lucide-react";
import { getListAudioLibraryQueryKey, mixAudioLibraryItem, removeAudioLibraryMix, type AudioLibraryItem } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/i18n";
import { mixPlan, songTimeAt, type MixSettings } from "@/lib/mix";
import { dbHeight, getPeaks, peakAt, type Peaks } from "@/lib/waveform-cache";

const clock = (seconds: number | null | undefined) => {
  if (seconds == null) return "";
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const MIN = -40;
const MAX = 6;

type Layer = NonNullable<AudioLibraryItem["mix"]>;

/**
 * The whole result as two lanes on one clock: your voice (green) and the song (purple, drawn at
 * its real loudness, so volume changes show), with the intro, outro and loop points.
 */
export function TrackLanes({ layer, volume, dark }: { layer: Layer; volume: number; dark: boolean }) {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(600);
  const [sources, setSources] = useState<{ voice: Peaks; music: Peaks } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    Promise.all([getPeaks(layer.voiceUrl), getPeaks(layer.musicUrl)])
      .then(([voice, music]) => { if (!cancelled) setSources({ voice, music }); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [layer.voiceUrl, layer.musicUrl]);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, Math.floor(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const settings: MixSettings = { ...(layer.settings as MixSettings), musicVolume: volume };
  const plan = sources ? mixPlan(sources.voice.duration, sources.music.duration, settings) : null;

  useEffect(() => {
    const element = canvas.current;
    if (!element || !sources || !plan) return;
    const height = 92;
    const scale = Math.min(2, window.devicePixelRatio || 1);
    element.width = Math.round(width * scale);
    element.height = Math.round(height * scale);
    const ctx = element.getContext("2d");
    if (!ctx) return;
    ctx.scale(scale, scale);
    ctx.clearRect(0, 0, width, height);
    const total = plan.total;
    const xOf = (time: number) => (time / total) * width;
    const voiceLane = { top: 4, height: 38 };
    const musicLane = { top: 48, height: 40 };
    // One loudness scale for both lanes: the music is drawn as loud as it really is.
    const loudest = Math.max(0.05, ...Array.from(sources.voice.peaks));
    const gain = 10 ** (volume / 20);
    const lane = (top: number, h: number) => { ctx.fillStyle = dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)"; ctx.fillRect(0, top, width, h); };
    lane(voiceLane.top, voiceLane.height);
    lane(musicLane.top, musicLane.height);
    // Music block.
    ctx.fillStyle = "rgba(139,92,246,0.16)";
    ctx.fillRect(xOf(plan.offset), musicLane.top, xOf(plan.played), musicLane.height);
    const perPixel = total / width;
    for (let x = 0; x < width; x++) {
      const time = x * perPixel;
      // Voice.
      const v = time - plan.pre;
      if (v >= 0 && v <= sources.voice.duration) {
        const h = Math.max(1, dbHeight(peakAt(sources.voice, v, v + perPixel), loudest) * (voiceLane.height - 4));
        ctx.fillStyle = "#10b981";
        ctx.fillRect(x, voiceLane.top + (voiceLane.height - h) / 2, 1, h);
      }
      // Music, with fades.
      const elapsed = time - plan.offset;
      const song = songTimeAt(plan, settings, elapsed);
      if (song !== null) {
        const fadeIn = Math.min(settings.fadeIn, plan.played / 2);
        const fadeOut = Math.min(settings.fadeOut, plan.played / 2);
        const fade = Math.min(1, fadeIn ? elapsed / fadeIn : 1, fadeOut ? (plan.played - elapsed) / fadeOut : 1);
        const level = peakAt(sources.music, song, song + perPixel * plan.tempo) * gain * Math.max(0, fade);
        const h = Math.max(1, dbHeight(level, loudest) * (musicLane.height - 4));
        ctx.fillStyle = "#8b5cf6";
        ctx.fillRect(x, musicLane.top + (musicLane.height - h) / 2, 1, h);
      }
    }
    // Where the song repeats.
    if (plan.loops) {
      ctx.strokeStyle = "rgba(139,92,246,0.7)";
      ctx.setLineDash([3, 3]);
      for (let seam = plan.source / plan.tempo; seam < plan.played; seam += plan.source / plan.tempo) {
        const x = Math.round(xOf(plan.offset + seam)) + 0.5;
        ctx.beginPath(); ctx.moveTo(x, musicLane.top + 2); ctx.lineTo(x, musicLane.top + musicLane.height - 2); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }, [sources, plan?.total, plan?.played, plan?.offset, width, volume, dark, settings.fadeIn, settings.fadeOut]);

  const fmt = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
  return (
    <div ref={box} className="relative" dir="ltr" aria-label={copy("Your voice and the background music on one timeline", "صوتك والموسيقى الخلفية على خط زمني واحد")} role="img">
      {failed ? (
        <p className="py-3 text-center text-xs opacity-60">{copy("The waveforms couldn't be loaded.", "تعذر تحميل الموجات.")}</p>
      ) : !plan ? (
        <div className="grid h-[92px] place-items-center"><Loader2 size={16} className="animate-spin opacity-60" /></div>
      ) : (
        <>
          <canvas ref={canvas} className="block h-[92px] w-full" />
          <span className="pointer-events-none absolute start-1.5 top-1 rounded bg-emerald-500/20 px-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-300">{copy("Voice", "الصوت")}</span>
          <span className="pointer-events-none absolute top-[49px] rounded bg-violet-500/20 px-1 text-[10px] font-semibold text-violet-600 dark:text-violet-300" style={{ left: `calc(${(plan.offset / plan.total) * 100}% + 6px)` }}>
            ♪ {layer.musicTitle || copy("Music", "موسيقى")}
          </span>
          <div className="mt-0.5 flex justify-between text-[10px] tabular-nums opacity-55"><span>0:00</span>{plan.pre > 0 && <span>{copy(`voice starts ${fmt(plan.pre)}`, `يبدأ الصوت ${fmt(plan.pre)}`)}</span>}<span>{fmt(plan.total)}</span></div>
        </>
      )}
    </div>
  );
}

/**
 * The two files behind a recording with background music: your voice, and the song as its own
 * track with a volume control, Edit (opens the mixer) and Remove.
 */
export function MusicTracks({ item, onEdit, dark = false, locked }: { item: AudioLibraryItem; onEdit: () => void; dark?: boolean; locked?: string }) {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const layer = item.mix;
  const saved = layer?.settings.musicVolume ?? -18;
  const [volume, setVolume] = useState(saved);
  const [busy, setBusy] = useState<"volume" | "remove" | null>(null);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => { setVolume(saved); }, [saved, item.url]);
  if (!layer) return null;

  const tone = dark
    ? { box: "border-white/10 bg-white/[0.04] text-white", sub: "text-white/50", chip: "bg-white/10 hover:bg-white/20", track: "bg-black/30" }
    : { box: "border bg-card text-foreground", sub: "text-muted-foreground", chip: "bg-secondary hover:bg-secondary/80", track: "bg-muted/60" };
  const changed = volume !== saved;
  const disabled = !!busy || !!locked || layer.musicItemId == null;

  async function applyVolume() {
    if (!layer || layer.musicItemId == null) return;
    setBusy("volume");
    try {
      await mixAudioLibraryItem(item.id, { musicItemId: layer.musicItemId, settings: { ...layer.settings, musicVolume: volume }, target: "same" });
      await queryClient.invalidateQueries({ queryKey: getListAudioLibraryQueryKey() });
      toast({ title: copy(`Music volume set to ${volume} dB`, `صوت الموسيقى الآن ${volume} ديسيبل`) });
    } catch (error) {
      toast({ variant: "destructive", title: copy("Couldn't change the volume", "تعذر تغيير الصوت"), description: (error as { data?: { error?: string } })?.data?.error });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("remove");
    try {
      await removeAudioLibraryMix(item.id);
      await queryClient.invalidateQueries({ queryKey: getListAudioLibraryQueryKey() });
      toast({ title: copy("Music removed", "أُزيلت الموسيقى"), description: copy("The recording is back to your voice as it was.", "عاد التسجيل إلى صوتك كما كان.") });
    } catch (error) {
      toast({ variant: "destructive", title: copy("Couldn't remove the music", "تعذرت إزالة الموسيقى"), description: (error as { data?: { error?: string } })?.data?.error });
    } finally {
      setBusy(null);
      setConfirm(false);
    }
  }

  const step = (delta: number) => setVolume((current) => Math.max(MIN, Math.min(MAX, current + delta)));

  return (
    <div className={`rounded-2xl border p-3 ${tone.box}`} role="group" aria-label={copy("Tracks", "المسارات")}>
      <p className={`mb-2 text-[11px] font-semibold uppercase tracking-wide ${tone.sub}`}>{copy("Tracks", "المسارات")}</p>
      <div className={`mb-2 rounded-xl px-2 pb-1.5 pt-2 ${tone.track}`}>
        <TrackLanes layer={layer} volume={volume} dark={dark} />
      </div>
      <div className="space-y-2">
        <div className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 ${tone.track}`}>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-500/20 text-emerald-500"><Mic size={15} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{copy("Your voice", "صوتك")}</span>
            <span className={`block text-[11px] ${tone.sub}`}>{clock(layer.voiceDuration)}{layer.pre > 0 && ` · ${copy(`starts at ${clock(layer.pre)}`, `يبدأ عند ${clock(layer.pre)}`)}`}</span>
          </span>
        </div>

        <div className={`rounded-xl px-2.5 py-2 ${tone.track}`}>
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-violet-500/20 text-violet-400"><Music2 size={15} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium" dir="auto">{layer.musicTitle || copy("Background music", "موسيقى خلفية")}</span>
              <span className={`block text-[11px] ${tone.sub}`}>{copy("Background music", "موسيقى خلفية")}</span>
            </span>
            <button type="button" onClick={onEdit} disabled={!!busy || !!locked} className={`inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-medium disabled:opacity-50 ${tone.chip}`}>
              <Pencil size={12} />{copy("Edit", "تعديل")}
            </button>
            {confirm ? (
              <span className="flex items-center gap-1">
                <button type="button" onClick={() => void remove()} disabled={!!busy} className="inline-flex h-8 items-center gap-1 rounded-full bg-red-500 px-3 text-xs font-medium text-white hover:bg-red-400">
                  {busy === "remove" ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}{copy("Remove", "إزالة")}
                </button>
                <button type="button" onClick={() => setConfirm(false)} className={`h-8 rounded-full px-2 text-xs ${tone.sub}`}>{copy("Keep", "إبقاء")}</button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirm(true)} disabled={!!busy || !!locked} aria-label={copy("Remove the music", "أزل الموسيقى")} title={copy("Remove the music", "أزل الموسيقى")}
                className="grid h-8 w-8 place-items-center rounded-full text-red-500 hover:bg-red-500/10 disabled:opacity-50"><Trash2 size={14} /></button>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2" dir="ltr">
            <button type="button" onClick={() => step(-3)} disabled={disabled || volume <= MIN} aria-label={copy("Music quieter", "موسيقى أخفض")} className={`grid h-8 w-8 shrink-0 place-items-center rounded-full disabled:opacity-40 ${tone.chip}`}><Minus size={14} /></button>
            <input type="range" min={MIN} max={MAX} step={1} value={volume} disabled={disabled} onChange={(event) => setVolume(Number(event.target.value))}
              aria-label={copy("Music volume", "صوت الموسيقى")} className="h-1.5 min-w-0 flex-1 cursor-pointer accent-violet-500" />
            <button type="button" onClick={() => step(3)} disabled={disabled || volume >= MAX} aria-label={copy("Music louder", "موسيقى أعلى")} className={`grid h-8 w-8 shrink-0 place-items-center rounded-full disabled:opacity-40 ${tone.chip}`}><Plus size={14} /></button>
            <span className="w-14 shrink-0 text-end font-mono text-xs tabular-nums">{volume > 0 ? "+" : ""}{volume} dB</span>
          </div>
          {changed && (
            <div className="mt-2 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setVolume(saved)} disabled={!!busy} className={`h-8 rounded-full px-3 text-xs ${tone.sub}`}>{copy("Undo", "تراجع")}</button>
              <button type="button" onClick={() => void applyVolume()} disabled={disabled} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-violet-500 px-3 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-60">
                {busy === "volume" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}{copy(`Apply ${volume > saved ? "louder" : "quieter"} music`, volume > saved ? "طبّق رفع الموسيقى" : "طبّق خفض الموسيقى")}
              </button>
            </div>
          )}
        </div>
      </div>
      {locked && <p className={`mt-2 text-[11px] ${tone.sub}`}>{locked}</p>}
    </div>
  );
}
