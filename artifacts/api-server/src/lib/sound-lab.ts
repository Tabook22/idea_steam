/**
 * Sound lab: turns the settings chosen in the app into one ffmpeg filter chain. The band and
 * box maths mirror artifacts/idea-stream/src/lib/sound-lab.ts (the live preview), and
 * scripts/sound-lab.test.mjs checks they agree.
 */

export type RegionEdit = { start: number; end: number; low: number; high: number; gain: number };
export type SoundLabSettings = {
  noise: number;
  noiseSample?: { start: number; end: number } | null;
  /** Measured loudness of the background noise (RMS dBFS): from a chosen stretch, or the quietest moments. */
  noiseFloor?: number | null;
  hum?: 50 | 60 | null;
  bands: { rumble: number; warmth: number; voice: number; presence: number; air: number };
  edits: RegionEdit[];
  volume: number;
  level: boolean;
  deess: boolean;
};

export const BANDS = [
  { id: "rumble", type: "lowshelf", frequency: 80, q: 0 },
  { id: "warmth", type: "peaking", frequency: 180, q: 0.9 },
  { id: "voice", type: "peaking", frequency: 1000, q: 0.55 },
  { id: "presence", type: "peaking", frequency: 5200, q: 1.1 },
  { id: "air", type: "highshelf", frequency: 8000, q: 0 },
] as const;

export const NOISE_REDUCTION = [0, 8, 14, 20, 28];
export const HUM_Q = 12;
const FULL_BAND = { low: 30, high: 16000 };

const round = (value: number, places = 1) => Math.round(value * 10 ** places) / 10 ** places;
const num = (value: number) => String(round(value, 3));

export function editFilters(edit: RegionEdit) {
  const low = Math.max(20, Math.min(edit.low, edit.high));
  const high = Math.max(low * 1.05, Math.max(edit.low, edit.high));
  const octaves = Math.log2(high / low);
  // Removing needs narrow, overlapping filters so every sound inside the box goes, not just the middle.
  const count = Math.max(1, Math.ceil(octaves / (edit.gain <= -24 ? 0.5 : 2)));
  const span = octaves / count;
  const ratio = 2 ** span;
  const q = Math.sqrt(ratio) / (ratio - 1);
  const gain = count > 1 ? edit.gain * 0.75 : edit.gain;
  return Array.from({ length: count }, (_, index) => ({
    frequency: round(low * 2 ** ((index + 0.5) * span)),
    q: round(q, 3),
    gain: round(gain, 2),
  }));
}

/** Gain over [start, end] with 20 ms ramps, so a louder or quieter stretch never clicks. */
function timedVolume(edit: RegionEdit) {
  const g = 10 ** (edit.gain / 20);
  const ramp = `clip(min((t-${num(edit.start)})/0.02,(${num(edit.end)}-t)/0.02),0,1)`;
  // Before the first frame there is no clock yet (t is NaN): stay at normal volume.
  return `volume=volume='if(isnan(t),1,1+(${num(g)}-1)*${ramp})':eval=frame`;
}

/** The filter chain, in the order a mastering engineer would apply it. */
export function soundLabFilters(settings: SoundLabSettings) {
  const filters: string[] = [];
  for (const k of [1, 2, 3, 4]) if (settings.hum) filters.push(`bandreject=f=${settings.hum * k}:t=q:w=${HUM_Q}`);
  const reduction = NOISE_REDUCTION[Math.max(0, Math.min(4, Math.round(settings.noise)))] ?? 0;
  if (reduction) {
    // Telling the denoiser how loud the noise really is works far better than letting it guess.
    const floor = settings.noiseFloor;
    const level = typeof floor === "number" && Number.isFinite(floor) ? floor : -45;
    filters.push(`afftdn=nr=${reduction}:nf=${num(Math.max(-80, Math.min(-20, level)))}:nt=w:tn=0`);
  }
  for (const band of BANDS) {
    const gain = settings.bands[band.id];
    if (!gain) continue;
    if (band.type === "lowshelf") filters.push(`lowshelf=f=${band.frequency}:t=s:w=1:g=${num(gain)}`);
    else if (band.type === "highshelf") filters.push(`highshelf=f=${band.frequency}:t=s:w=1:g=${num(gain)}`);
    else filters.push(`equalizer=f=${band.frequency}:t=q:w=${band.q}:g=${num(gain)}`);
  }
  for (const edit of settings.edits) {
    if (!edit.gain || edit.end <= edit.start) continue;
    if (edit.low <= FULL_BAND.low && edit.high >= FULL_BAND.high) { filters.push(timedVolume(edit)); continue; }
    for (const peak of editFilters(edit)) {
      filters.push(`equalizer=f=${peak.frequency}:t=q:w=${peak.q}:g=${peak.gain}:enable='between(t,${num(edit.start)},${num(edit.end)})'`);
    }
  }
  if (settings.deess) filters.push("deesser=i=0.5:m=0.5:f=0.5");
  if (settings.volume) filters.push(`volume=${num(settings.volume)}dB`);
  if (settings.level) filters.push("loudnorm=I=-16:TP=-1.5:LRA=11");
  // Boosts must never clip.
  filters.push("alimiter=limit=0.97:level=false:latency=1");
  return filters;
}
