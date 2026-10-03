/**
 * Sound lab settings and the filters they turn into. The server builds the same filters with
 * ffmpeg (artifacts/api-server/src/lib/sound-lab.ts), so the live preview here and the saved
 * result match. scripts/sound-lab.test.mjs checks the two stay in step.
 */

export type BandId = "rumble" | "warmth" | "voice" | "presence" | "air";
export type RegionEdit = { start: number; end: number; low: number; high: number; gain: number };
export type SoundLabSettings = {
  /** 0 off … 4 maximum. */
  noise: number;
  /** A stretch with only background noise, used to learn what to remove. */
  noiseSample: { start: number; end: number } | null;
  /** Measured loudness of the background noise (RMS dBFS): from the chosen stretch, or the quietest moments. */
  noiseFloor: number | null;
  hum: 50 | 60 | null;
  bands: Record<BandId, number>;
  edits: RegionEdit[];
  /** Overall volume in dB. */
  volume: number;
  /** Even out loudness (podcast level). */
  level: boolean;
  /** Soften harsh "s" sounds. */
  deess: boolean;
};

export const DEFAULT_SETTINGS: SoundLabSettings = {
  noise: 0,
  noiseSample: null,
  noiseFloor: null,
  hum: null,
  bands: { rumble: 0, warmth: 0, voice: 0, presence: 0, air: 0 },
  edits: [],
  volume: 0,
  level: false,
  deess: false,
};

export type Band = { id: BandId; type: "lowshelf" | "peaking" | "highshelf"; frequency: number; q: number; low: number; high: number };

/** The five bands, from lowest to highest. Shelves use slope 1 (Web Audio's fixed shape). */
export const BANDS: Band[] = [
  { id: "rumble", type: "lowshelf", frequency: 80, q: 0, low: 20, high: 80 },
  { id: "warmth", type: "peaking", frequency: 180, q: 0.9, low: 80, high: 300 },
  { id: "voice", type: "peaking", frequency: 1000, q: 0.55, low: 300, high: 3400 },
  { id: "presence", type: "peaking", frequency: 5200, q: 1.1, low: 3400, high: 8000 },
  { id: "air", type: "highshelf", frequency: 8000, q: 0, low: 8000, high: 20000 },
];

export const BAND_LIMITS = { min: -30, max: 12 };
export const EDIT_LIMITS = { min: -40, max: 12 };
export const VOLUME_LIMITS = { min: -12, max: 12 };
export const MAX_EDITS = 40;

/** A box covering (nearly) all frequencies is a plain volume change for that time. */
export const FULL_BAND = { low: 30, high: 16000 };
export const isFullBand = (edit: Pick<RegionEdit, "low" | "high">) => edit.low <= FULL_BAND.low && edit.high >= FULL_BAND.high;

export type PeakFilter = { frequency: number; q: number; gain: number };

/**
 * A box (time × frequency) becomes peaking filters, active only during its time: one per two
 * octaves, so wide boxes stay even. Overlapping peaks add up, so several are gentler each.
 */
export function editFilters(edit: RegionEdit): PeakFilter[] {
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

/** Narrow notches on the mains frequency and its first harmonics. */
export const HUM_Q = 12;
export const humFrequencies = (hum: 50 | 60 | null) => (hum ? [1, 2, 3, 4].map((k) => hum * k) : []);

/** Noise reduction strength per level, in dB (ffmpeg afftdn). */
export const NOISE_REDUCTION = [0, 8, 14, 20, 28];

export function round(value: number, places = 1) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** True when nothing would change the sound. */
export function isNeutral(settings: SoundLabSettings) {
  return settings.noise === 0 && !settings.hum && Object.values(settings.bands).every((gain) => gain === 0)
    && settings.edits.length === 0 && settings.volume === 0 && !settings.level && !settings.deess;
}

/** Loudness (RMS dBFS) of a stretch of the recording: how loud the background noise is there. */
export function rmsDb(samples: Float32Array, rate: number, start: number, end: number) {
  const from = Math.max(0, Math.floor(start * rate));
  const to = Math.min(samples.length, Math.ceil(end * rate));
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return round(10 * Math.log10(sum / Math.max(1, to - from) + 1e-12), 1);
}
