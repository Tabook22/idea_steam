/**
 * Listening to a recording the way a sound engineer looks at it: a spectrogram (every frequency
 * over time), and an estimate of what each moment is (voice, music, noise, silence) plus common
 * problems (mains hum, rumble, hiss). Pure functions, so they run in tests too.
 */
import { BANDS, type BandId, type SoundLabSettings } from "./sound-lab.ts";

export type SoundKind = "voice" | "music" | "noise" | "silence";
export type Segment = { start: number; end: number; kind: SoundKind };

export type Spectrogram = {
  /** dB values, frame after frame, `bins` per frame. */
  data: Float32Array;
  frames: number;
  bins: number;
  /** Seconds between frames. */
  step: number;
  binHz: number;
  rate: number;
  duration: number;
  maxDb: number;
};

export type Analysis = {
  segments: Segment[];
  /** Fraction of the recording that is each kind. */
  share: Record<SoundKind, number>;
  noiseFloorDb: number;
  voiceLevelDb: number | null;
  hum: 50 | 60 | null;
  rumble: boolean;
  hiss: boolean;
  quiet: boolean;
  bandShare: Record<BandId, number>;
  suggestion: Partial<SoundLabSettings>;
};

const FFT_SIZE = 2048;
const MAX_FRAMES = 3000;
const SEGMENT = 1;

/* ---------- FFT ---------- */

const plans = new Map<number, { cos: Float64Array; sin: Float64Array; rev: Uint32Array; window: Float64Array }>();
function plan(size: number) {
  let found = plans.get(size);
  if (found) return found;
  const bits = Math.log2(size);
  const rev = new Uint32Array(size);
  for (let i = 0; i < size; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(size / 2);
  const sin = new Float64Array(size / 2);
  for (let i = 0; i < size / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / size); sin[i] = -Math.sin((2 * Math.PI * i) / size); }
  const window = new Float64Array(size);
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  found = { cos, sin, rev, window };
  plans.set(size, found);
  return found;
}

/** Power spectrum (|X|² scaled so a full-scale sine reads about 0 dB) of `size` samples from `offset`. */
export function powerSpectrum(samples: Float32Array, offset: number, size: number, out = new Float64Array(size / 2 + 1)) {
  const { cos, sin, rev, window } = plan(size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    const index = offset + i;
    re[rev[i]] = index < samples.length && index >= 0 ? samples[index] * window[i] : 0;
  }
  for (let length = 2; length <= size; length <<= 1) {
    const half = length >> 1;
    const stride = size / length;
    for (let start = 0; start < size; start += length) {
      for (let k = 0; k < half; k++) {
        const c = cos[k * stride];
        const s = sin[k * stride];
        const a = start + k;
        const b = a + half;
        const tr = re[b] * c - im[b] * s;
        const ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
  const scale = (size / 4) ** 2;
  for (let k = 0; k <= size / 2; k++) out[k] = (re[k] * re[k] + im[k] * im[k]) / scale;
  return out;
}

const toDb = (power: number) => 10 * Math.log10(power + 1e-12);

/* ---------- Spectrogram ---------- */

export function spectrogram(samples: Float32Array, rate: number): Spectrogram {
  const bins = FFT_SIZE / 2 + 1;
  const hop = Math.max(512, Math.ceil(Math.max(0, samples.length - FFT_SIZE) / MAX_FRAMES));
  const frames = Math.max(1, Math.floor(Math.max(0, samples.length - FFT_SIZE) / hop) + 1);
  const data = new Float32Array(frames * bins);
  const power = new Float64Array(bins);
  let maxDb = -120;
  for (let frame = 0; frame < frames; frame++) {
    powerSpectrum(samples, frame * hop, FFT_SIZE, power);
    for (let k = 0; k < bins; k++) {
      const db = toDb(power[k]);
      data[frame * bins + k] = db;
      if (db > maxDb) maxDb = db;
    }
  }
  return { data, frames, bins, step: hop / rate, binHz: rate / FFT_SIZE, rate, duration: samples.length / rate, maxDb };
}

/* ---------- Analysis ---------- */

/** Loudness (dB) of short blocks across the whole recording. */
function envelope(samples: Float32Array, rate: number, blockSeconds = 0.02) {
  const block = Math.max(1, Math.round(rate * blockSeconds));
  const count = Math.ceil(samples.length / block);
  const out = new Float32Array(count);
  for (let b = 0; b < count; b++) {
    let sum = 0;
    const end = Math.min(samples.length, (b + 1) * block);
    for (let i = b * block; i < end; i++) sum += samples[i] * samples[i];
    // RMS of a full-scale sine is 1/√2, so +3 dB lines this up with the spectrum's 0 dB.
    out[b] = toDb((2 * sum) / Math.max(1, end - b * block));
  }
  return { values: out, seconds: blockSeconds };
}

const percentile = (values: ArrayLike<number>, p: number) => {
  const sorted = Array.from(values).sort((a, b) => a - b);
  if (!sorted.length) return -120;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
};
const round1 = (value: number) => Math.round(value * 10) / 10;
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const std = (values: number[]) => { const m = mean(values); return Math.sqrt(mean(values.map((v) => (v - m) ** 2))); };

/** Peaks that stand clear of their surroundings: the "lines" that sung or played notes draw. */
function tonalPeaks(power: Float64Array, binHz: number) {
  const peaks: number[] = [];
  const from = Math.floor(100 / binHz);
  const to = Math.min(power.length - 4, Math.floor(5000 / binHz));
  for (let k = Math.max(4, from); k < to; k++) {
    const p = power[k];
    if (p < power[k - 1] || p < power[k + 1]) continue;
    // Compare with bins outside the window's main lobe (±2 bins), or every pure tone looks flat.
    const around = (power[k - 3] + power[k + 3] + power[k - 4] + power[k + 4]) / 4;
    if (toDb(p) - toDb(around) > 10) peaks.push(k);
  }
  return peaks;
}

function bandEnergy(power: ArrayLike<number>, binHz: number, low: number, high: number) {
  let sum = 0;
  const to = Math.min(power.length - 1, Math.floor(high / binHz));
  for (let k = Math.max(1, Math.ceil(low / binHz)); k <= to; k++) sum += power[k];
  return sum;
}

function flatness(power: Float64Array, binHz: number, low: number, high: number) {
  let logSum = 0;
  let sum = 0;
  let n = 0;
  const to = Math.min(power.length - 1, Math.floor(high / binHz));
  for (let k = Math.max(1, Math.ceil(low / binHz)); k <= to; k++) { logSum += Math.log(power[k] + 1e-12); sum += power[k]; n++; }
  if (!n || sum <= 0) return 0;
  return Math.exp(logSum / n) / (sum / n);
}

/** Mains hum: a steady line at 50 or 60 Hz (and its multiples) that speech never holds. */
export function detectHum(samples: Float32Array, rate: number): 50 | 60 | null {
  const size = 16384;
  if (samples.length < size) return null;
  const positions = Math.min(24, Math.floor(samples.length / size));
  const average = new Float64Array(size / 2 + 1);
  const power = new Float64Array(size / 2 + 1);
  for (let p = 0; p < positions; p++) {
    const offset = Math.floor((p * (samples.length - size)) / Math.max(1, positions - 1));
    powerSpectrum(samples, offset, size, power);
    for (let k = 0; k < power.length; k++) average[k] += power[k] / positions;
  }
  const binHz = rate / size;
  const prominence = (frequency: number) => {
    const centre = Math.round(frequency / binHz);
    let peak = 0;
    for (let k = centre - 2; k <= centre + 2; k++) peak = Math.max(peak, average[k] ?? 0);
    const around: number[] = [];
    for (let k = Math.round((frequency - 14) / binHz); k <= Math.round((frequency + 14) / binHz); k++) {
      if (Math.abs(k - centre) * binHz >= 6) around.push(toDb(average[k] ?? 0));
    }
    around.sort((a, b) => a - b);
    return toDb(peak) - around[Math.floor(around.length / 2)];
  };
  const score = (base: number) => {
    const first = prominence(base);
    const more = [2, 3].filter((k) => prominence(base * k) > 6).length;
    // A strong steady line alone is enough (harmonics often hide under the voice).
    return first > 18 || (first > 10 && more >= 1) ? first : 0;
  };
  const fifty = score(50);
  const sixty = score(60);
  if (!fifty && !sixty) return null;
  return fifty >= sixty ? 50 : 60;
}

export function analyse(samples: Float32Array, rate: number, spec: Spectrogram, trace?: (info: Record<string, number | string>) => void): Analysis {
  const duration = samples.length / rate;
  const env = envelope(samples, rate);
  const live = Array.from(env.values).filter((v) => v > -90);
  const noiseFloorDb = percentile(live, 0.1);

  // The steady background (noise, hum): what each frequency sounds like in the quietest moments.
  const bins = spec.bins;
  const floor = new Float64Array(bins);
  {
    const step = Math.max(1, Math.floor(spec.frames / 600));
    const column: number[] = [];
    for (let k = 0; k < bins; k++) {
      column.length = 0;
      for (let f = 0; f < spec.frames; f += step) column.push(spec.data[f * bins + k]);
      // For random noise the quietest tenth sits ~10 dB under its average; scale back up to the average.
      floor[k] = 9.5 * 10 ** (percentile(column, 0.1) / 10);
    }
  }
  const backgroundDb = toDb(bandEnergy(floor, spec.binHz, 60, 8000));
  /** What stands out above the background (3× its average power: random noise rarely gets there). */
  const aboveFloor = (power: Float64Array) => {
    for (let k = 0; k < bins; k++) power[k] = power[k] > 3 * floor[k] ? power[k] - floor[k] : 0;
    return power;
  };

  // Per spectrogram frame, judged on the foreground only.
  const frameFlat: number[] = [];
  const frameSpeech: number[] = [];
  const frameSteady: number[] = [];
  const frameLow: number[] = [];
  const frameDb: number[] = [];
  const frameFg: number[] = [];
  const bandTotals: Record<BandId, number> = { rumble: 0, warmth: 0, voice: 0, presence: 0, air: 0 };
  const power = new Float64Array(bins);
  const later = new Float64Array(bins);
  const hopSamples = Math.round(spec.step * rate);
  for (let f = 0; f < spec.frames; f++) {
    for (let k = 0; k < bins; k++) power[k] = 10 ** (spec.data[f * bins + k] / 10);
    const total = bandEnergy(power, spec.binHz, 60, 8000);
    frameDb.push(toDb(total));
    frameLow.push(total > 0 ? bandEnergy(power, spec.binHz, 20, 70) / (total + bandEnergy(power, spec.binHz, 20, 60)) : 0);
    if (toDb(total) > -55) for (const band of BANDS) bandTotals[band.id] += bandEnergy(power, spec.binHz, band.low, band.high);
    aboveFloor(power);
    const fg = bandEnergy(power, spec.binHz, 60, 8000);
    frameFg.push(toDb(fg));
    frameFlat.push(flatness(power, spec.binHz, 300, 6000));
    frameSpeech.push(fg > 0 ? bandEnergy(power, spec.binHz, 250, 4000) / fg : 0);
    powerSpectrum(samples, f * hopSamples + 2048, FFT_SIZE, later);
    aboveFloor(later);
    const now = tonalPeaks(power, spec.binHz);
    const next = new Set(tonalPeaks(later, spec.binHz));
    frameSteady.push(now.length >= 2 ? now.filter((k) => next.has(k) || next.has(k - 1) || next.has(k + 1)).length / now.length : 0);
  }

  // Label each second.
  const raw: Segment[] = [];
  for (let start = 0; start < duration; start += SEGMENT) {
    const end = Math.min(duration, start + SEGMENT);
    const frames: number[] = [];
    for (let f = Math.floor(start / spec.step); f < Math.min(spec.frames, Math.ceil(end / spec.step)); f++) frames.push(f);
    if (!frames.length) frames.push(Math.min(spec.frames - 1, Math.floor(start / spec.step)));
    const foreground = percentile(frames.map((f) => frameFg[f]), 0.9);
    let kind: SoundKind;
    const info: Record<string, number | string> = { start, foreground: round1(foreground), background: round1(backgroundDb) };
    if (foreground < -60 || foreground < backgroundDb - 6) {
      // Nothing rises above the background: it is either quiet or just noise.
      kind = backgroundDb > -50 ? "noise" : "silence";
    } else {
      const levels = frames.map((f) => Math.max(-80, frameFg[f]));
      // Rhythm of the level, measured in each half: a sound that just starts or stops is not speech.
      const half = Math.max(1, Math.floor(levels.length / 2));
      const modulation = levels.length >= 6 ? Math.min(std(levels.slice(0, half)), std(levels.slice(half))) : std(levels);
      // Louder moments count more, so pauses between words don't dilute what is being said.
      const weights = frames.map((f) => 10 ** (frameFg[f] / 10));
      const weightSum = weights.reduce((a, b) => a + b, 0) || 1;
      const weighted = (values: number[]) => frames.reduce((sum, f, i) => sum + values[f] * weights[i], 0) / weightSum;
      const flat = weighted(frameFlat);
      const speech = weighted(frameSpeech);
      const steady = weighted(frameSteady);
      Object.assign(info, { modulation: round1(modulation), flat: round1(flat * 100) / 100, speech: round1(speech * 100) / 100, steady: round1(steady * 100) / 100 });
      if (modulation < 3) {
        // Held sound with no syllable rhythm: a note or chord, or a louder stretch of noise.
        kind = flat > 0.4 ? "noise" : "music";
      } else if (steady > 0.7) kind = "music";
      else if (flat > 0.5) kind = "noise";
      else if (speech > 0.35) kind = "voice";
      else if (steady > 0.45) kind = "music";
      else kind = "voice";
    }
    trace?.({ ...info, kind });
    raw.push({ start, end, kind });
  }
  // A lone second between two of the same kind is usually a pause or a breath.
  for (let i = 1; i < raw.length - 1; i++) {
    if (raw[i - 1].kind === raw[i + 1].kind && raw[i].kind !== raw[i - 1].kind && raw[i].kind !== "silence") raw[i] = { ...raw[i], kind: raw[i - 1].kind };
  }
  const segments: Segment[] = [];
  for (const segment of raw) {
    const last = segments.at(-1);
    if (last && last.kind === segment.kind) last.end = segment.end;
    else segments.push({ ...segment });
  }
  const share: Record<SoundKind, number> = { voice: 0, music: 0, noise: 0, silence: 0 };
  for (const segment of segments) share[segment.kind] += (segment.end - segment.start) / Math.max(duration, 1e-9);

  const voiceBlocks = segments.filter((s) => s.kind === "voice")
    .flatMap((s) => Array.from(env.values.slice(Math.floor(s.start / env.seconds), Math.ceil(s.end / env.seconds))));
  const voiceLevelDb = voiceBlocks.length ? percentile(voiceBlocks, 0.75) : null;

  const loudFrames = frameDb.map((db, f) => [db, f] as const).filter(([db]) => db > -55).map(([, f]) => f);
  const rumble = loudFrames.length > 0 && mean(loudFrames.map((f) => frameLow[f])) > 0.15;

  // Hiss: the quiet moments still carry a lot of high, even ("shhh") sound.
  const quietFrames = frameDb.map((db, f) => [db, f] as const).filter(([db]) => db <= percentile(frameDb, 0.3)).map(([, f]) => f);
  let hiss = false;
  if (quietFrames.length) {
    const hfDb: number[] = [];
    const midDb: number[] = [];
    for (const f of quietFrames) {
      for (let k = 0; k < bins; k++) power[k] = 10 ** (spec.data[f * bins + k] / 10);
      hfDb.push(toDb(bandEnergy(power, spec.binHz, 5000, 10000)));
      midDb.push(toDb(bandEnergy(power, spec.binHz, 500, 2000)));
    }
    hiss = mean(hfDb) > -62 && mean(hfDb) - mean(midDb) > -8;
  }

  const hum = detectHum(samples, rate);
  const quiet = voiceLevelDb !== null && voiceLevelDb < -26;
  const bandSum = Object.values(bandTotals).reduce((a, b) => a + b, 0) || 1;
  const bandShare = Object.fromEntries(BANDS.map((band) => [band.id, bandTotals[band.id] / bandSum])) as Record<BandId, number>;

  // What a careful engineer would try first.
  const suggestion: Partial<SoundLabSettings> = {};
  const gap = voiceLevelDb === null ? 0 : voiceLevelDb - noiseFloorDb;
  if (noiseFloorDb > -68 && voiceLevelDb !== null) {
    suggestion.noise = gap > 40 ? 0 : gap > 30 ? 1 : gap > 20 ? 2 : gap > 12 ? 3 : 4;
    if (suggestion.noise === 0) delete suggestion.noise;
  }
  if (hum) suggestion.hum = hum;
  if (rumble || hiss) {
    suggestion.bands = { rumble: rumble ? -18 : 0, warmth: 0, voice: 0, presence: 0, air: hiss ? -6 : 0 };
    if (hiss && !suggestion.noise) suggestion.noise = 1;
  }
  if (quiet) suggestion.level = true;

  return { segments, share, noiseFloorDb, voiceLevelDb, hum, rumble, hiss, quiet, bandShare, suggestion };
}

/* ---------- Drawing ---------- */

export const FREQ_MIN = 40;
export const freqMax = (spec: Pick<Spectrogram, "rate">) => Math.min(16000, spec.rate / 2);

/** Frequency at a height (0 = top), on a log scale like the ear hears. */
export const freqAtY = (y: number, height: number, max: number) => FREQ_MIN * (max / FREQ_MIN) ** (1 - y / height);
export const yAtFreq = (frequency: number, height: number, max: number) => height * (1 - Math.log(frequency / FREQ_MIN) / Math.log(max / FREQ_MIN));

const COLOURS: [number, number, number, number][] = [
  [0, 4, 6, 18], [0.2, 40, 11, 84], [0.4, 120, 28, 109], [0.6, 199, 62, 76], [0.8, 245, 135, 30], [1, 252, 245, 160],
];
function colour(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < COLOURS.length; i++) {
    if (x <= COLOURS[i][0]) {
      const [p0, r0, g0, b0] = COLOURS[i - 1];
      const [p1, r1, g1, b1] = COLOURS[i];
      const u = (x - p0) / (p1 - p0);
      return [r0 + (r1 - r0) * u, g0 + (g1 - g0) * u, b0 + (b1 - b0) * u];
    }
  }
  return [252, 245, 160];
}

/** RGBA pixels of the spectrogram for the time view [from, to]. */
export function paintSpectrogram(spec: Spectrogram, width: number, height: number, from = 0, to = spec.duration, range = 75) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const max = freqMax(spec);
  const rowBins = Array.from({ length: height }, (_, y) => {
    const frequency = freqAtY(y + 0.5, height, max);
    return Math.min(spec.bins - 1, Math.max(0, Math.round(frequency / spec.binHz)));
  });
  const top = spec.maxDb;
  for (let x = 0; x < width; x++) {
    const time = from + ((x + 0.5) / width) * (to - from);
    const frame = Math.min(spec.frames - 1, Math.max(0, Math.floor(time / spec.step)));
    for (let y = 0; y < height; y++) {
      const db = spec.data[frame * spec.bins + rowBins[y]];
      const [r, g, b] = colour((db - (top - range)) / range);
      const i = (y * width + x) * 4;
      pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = 255;
    }
  }
  return pixels;
}
