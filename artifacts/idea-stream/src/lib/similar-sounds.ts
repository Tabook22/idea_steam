/**
 * "Find similar sounds": the user selects one example (an "um", a lip smack, a beep) and we
 * find the other places that sound like it. Each 10 ms of audio gets a sound fingerprint
 * (MFCC: the shape of the spectrum, independent of loudness), and a time-warping match
 * (subsequence DTW) lets a repeat be a little longer, shorter or differently pitched.
 */
import { powerSpectrum } from "./sound-analysis.ts";

export type SoundPrint = {
  /** COEFFS values per frame. */
  coeffs: Float32Array;
  /** Loudness per frame in dB. */
  energy: Float32Array;
  frames: number;
  /** Seconds per frame. */
  hop: number;
};
export type Match = { start: number; end: number; /** 0–1, 1 = identical */ similarity: number };
export type Sensitivity = "strict" | "normal" | "loose";

const COEFFS = 12;
const BANDS = 26;
const HOP_SECONDS = 0.01;

function melFilters(size: number, rate: number) {
  const mel = (f: number) => 2595 * Math.log10(1 + f / 700);
  const hz = (m: number) => 700 * (10 ** (m / 2595) - 1);
  const low = mel(100);
  const high = mel(Math.min(8000, rate / 2));
  const points = Array.from({ length: BANDS + 2 }, (_, i) => hz(low + ((high - low) * i) / (BANDS + 1)));
  const bin = (f: number) => (f * size) / rate;
  return Array.from({ length: BANDS }, (_, b) => {
    const [a, c, d] = [bin(points[b]), bin(points[b + 1]), bin(points[b + 2])];
    const weights: [number, number][] = [];
    for (let k = Math.floor(a); k <= Math.ceil(d); k++) {
      const w = k < c ? (k - a) / (c - a) : (d - k) / (d - c);
      if (w > 0) weights.push([k, w]);
    }
    return weights;
  });
}

/** Fingerprint of every 10 ms of a recording. */
export function soundPrint(samples: Float32Array, rate: number): SoundPrint {
  const size = rate > 24000 ? 1024 : 512;
  const hop = Math.max(1, Math.round(rate * HOP_SECONDS));
  const frames = Math.max(1, Math.floor(Math.max(0, samples.length - size) / hop) + 1);
  const filters = melFilters(size, rate);
  const coeffs = new Float32Array(frames * COEFFS);
  const energy = new Float32Array(frames);
  const power = new Float64Array(size / 2 + 1);
  const logMel = new Float64Array(BANDS);
  for (let f = 0; f < frames; f++) {
    powerSpectrum(samples, f * hop, size, power);
    let total = 0;
    for (let b = 0; b < BANDS; b++) {
      let sum = 0;
      for (const [k, w] of filters[b]) sum += (power[k] ?? 0) * w;
      total += sum;
      logMel[b] = Math.log(sum + 1e-10);
    }
    energy[f] = 10 * Math.log10(total + 1e-12);
    // DCT of the log spectrum; c0 (loudness) is left out so quiet and loud repeats still match.
    for (let c = 1; c <= COEFFS; c++) {
      let value = 0;
      for (let b = 0; b < BANDS; b++) value += logMel[b] * Math.cos((Math.PI * c * (b + 0.5)) / BANDS);
      coeffs[f * COEFFS + c - 1] = value;
    }
  }
  // Remove the recording's average colour (microphone, room) so only the sound itself counts.
  for (let c = 0; c < COEFFS; c++) {
    let mean = 0;
    for (let f = 0; f < frames; f++) mean += coeffs[f * COEFFS + c];
    mean /= frames;
    for (let f = 0; f < frames; f++) coeffs[f * COEFFS + c] -= mean;
  }
  return { coeffs, energy, frames, hop: hop / rate };
}

const LIMITS: Record<Sensitivity, number> = { strict: 0.32, normal: 0.42, loose: 0.55 };
/** Distance shown as 0% similar (the same scale in every mode). */
const SCALE = 0.85;

/**
 * Places that sound like `example` (seconds, in the same recording), best first then by time.
 * The example itself is included. `skip` ranges (already cut) are ignored.
 */
export function findSimilar(print: SoundPrint, example: { start: number; end: number }, sensitivity: Sensitivity = "normal", skip: { start: number; end: number }[] = []): Match[] {
  const { coeffs, energy, frames, hop } = print;
  let first = Math.max(0, Math.floor(example.start / hop));
  let last = Math.min(frames - 1, Math.ceil(example.end / hop));
  // Trim quiet edges of the example: only the sound itself should be matched.
  const peak = Math.max(...Array.from(energy.subarray(first, last + 1)));
  while (first < last && energy[first] < peak - 30) first++;
  while (last > first && energy[last] < peak - 30) last--;
  const m = last - first + 1;
  if (m < 5) return [];
  const templateLevel = Array.from(energy.subarray(first, last + 1)).reduce((a, b) => a + b, 0) / m;

  // Typical spread of the fingerprints, to put distances on a common scale.
  let spread = 0;
  const step = Math.max(1, Math.floor(frames / 2000));
  let count = 0;
  for (let f = 0; f < frames; f += step) for (let c = 0; c < COEFFS; c++) { spread += coeffs[f * COEFFS + c] ** 2; count++; }
  spread = Math.sqrt(spread / Math.max(1, count)) || 1;

  const distance = (i: number, j: number) => {
    let sum = 0;
    const a = (first + i) * COEFFS;
    const b = j * COEFFS;
    for (let c = 0; c < COEFFS; c++) { const d = coeffs[a + c] - coeffs[b + c]; sum += d * d; }
    const shape = Math.sqrt(sum / COEFFS) / spread;
    // Much quieter than the example (silence, background) can't be the same sound.
    const quieter = Math.max(0, energy[first + i] - energy[j] - 12) / 20;
    return shape + quieter;
  };

  // Subsequence DTW: the example may start anywhere; repeats may be 0.6×–1.7× as long.
  const cost = new Float64Array(frames);
  const begin = new Int32Array(frames);
  let prevD = new Float64Array(frames);
  let prevL = new Int32Array(frames);
  let prevS = new Int32Array(frames);
  let curD = new Float64Array(frames);
  let curL = new Int32Array(frames);
  let curS = new Int32Array(frames);
  for (let j = 0; j < frames; j++) { prevD[j] = distance(0, j); prevL[j] = 1; prevS[j] = j; }
  for (let i = 1; i < m; i++) {
    for (let j = 0; j < frames; j++) {
      const d = distance(i, j);
      let bestD = prevD[j]; let bestL = prevL[j]; let bestS = prevS[j]; // stretch the example
      if (j > 0) {
        if (prevD[j - 1] / prevL[j - 1] <= bestD / bestL) { bestD = prevD[j - 1]; bestL = prevL[j - 1]; bestS = prevS[j - 1]; }
        if (curD[j - 1] / curL[j - 1] < bestD / bestL) { bestD = curD[j - 1]; bestL = curL[j - 1]; bestS = curS[j - 1]; }
      } else if (i > 0) { bestD = prevD[j]; bestL = prevL[j]; bestS = prevS[j]; }
      curD[j] = bestD + d; curL[j] = bestL + 1; curS[j] = bestS;
    }
    [prevD, curD] = [curD, prevD];
    [prevL, curL] = [curL, prevL];
    [prevS, curS] = [curS, prevS];
  }
  for (let j = 0; j < frames; j++) {
    const length = j - prevS[j] + 1;
    const fits = length >= m * 0.6 && length <= m * 1.7;
    cost[j] = fits ? prevD[j] / prevL[j] : Infinity;
    begin[j] = prevS[j];
  }

  // Best matches first; each claims its time so overlapping weaker ones are dropped.
  const limit = LIMITS[sensitivity];
  const order = Array.from({ length: frames }, (_, j) => j).filter((j) => cost[j] < limit).sort((a, b) => cost[a] - cost[b]);
  const taken: Match[] = [];
  for (const j of order) {
    const start = begin[j] * hop;
    const end = (j + 1) * hop + 0.01;
    if (taken.some((match) => start < match.end && end > match.start)) continue;
    if (skip.some((range) => start < range.end - 0.02 && end > range.start + 0.02)) continue;
    // Its loudness should be in the example's league (not a whisper of it in the background).
    let level = 0;
    for (let f = begin[j]; f <= j; f++) level += energy[f];
    level /= j - begin[j] + 1;
    if (level < templateLevel - 15) continue;
    taken.push({ start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000, similarity: Math.max(0, Math.min(1, 1 - cost[j] / SCALE)) });
  }
  return taken.sort((a, b) => a.start - b.start);
}
