import type { Range } from "./audio-ranges.ts";

export type TimedWord = { word: string; start: number; end: number };

const FRAME = 0.02; // seconds per loudness frame

/** Loudness (RMS) per 20 ms frame, and a silence threshold adapted to the background noise. */
function loudness(samples: Float32Array, rate: number) {
  const size = Math.max(1, Math.round(rate * FRAME));
  const frames: number[] = [];
  for (let i = 0; i < samples.length; i += size) {
    let sum = 0;
    const end = Math.min(samples.length, i + size);
    for (let j = i; j < end; j++) sum += samples[j] * samples[j];
    frames.push(Math.sqrt(sum / Math.max(1, end - i)));
  }
  const sorted = [...frames].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.15)] ?? 0;
  const loud = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  // Between the noise floor and speech: car hum stays "silence", quiet speech does not.
  const threshold = Math.max(0.004, floor * 2.5, loud * 0.06);
  return { frames, threshold };
}

function silentRuns(samples: Float32Array, rate: number) {
  const { frames, threshold } = loudness(samples, rate);
  const runs: Range[] = [];
  let start = -1;
  frames.forEach((value, index) => {
    if (value < threshold) { if (start < 0) start = index; }
    else if (start >= 0) { runs.push({ start: start * FRAME, end: index * FRAME }); start = -1; }
  });
  if (start >= 0) runs.push({ start: start * FRAME, end: frames.length * FRAME });
  return runs;
}

/** Long pauses shortened: each silence over `longer` seconds keeps `keep` seconds (half each side). */
export function longPauses(samples: Float32Array, rate: number, longer = 1.0, keep = 0.4): Range[] {
  const duration = samples.length / rate;
  return silentRuns(samples, rate)
    .filter(({ start, end }) => start > 0.05 && end < duration - 0.05 && end - start > longer)
    .map(({ start, end }) => ({ start: start + keep / 2, end: end - keep / 2 }));
}

/** Silence before you start speaking and after you stop (leaving a short natural margin). */
export function silentEdges(samples: Float32Array, rate: number, margin = 0.15): Range[] {
  const duration = samples.length / rate;
  const runs = silentRuns(samples, rate);
  const edges: Range[] = [];
  const first = runs[0];
  if (first && first.start <= 0.05 && first.end - margin > 0.1) edges.push({ start: 0, end: first.end - margin });
  const last = runs.at(-1);
  if (last && last !== first && last.end >= duration - 0.05 && duration - (last.start + margin) > 0.1)
    edges.push({ start: last.start + margin, end: duration });
  return edges;
}

const FILLERS = new Set([
  "um", "umm", "ummm", "uh", "uhh", "uhm", "er", "erm", "ah", "ahh", "hmm", "hm", "mm", "mmm", "eh",
  "ام", "امم", "اممم", "ممم", "مم", "اه", "آه", "اا", "ااا", "إمم", "أمم", "ئ",
]);
const clean = (word: string) =>
  word.toLocaleLowerCase().replace(/[ً-ٟـ]/g, "").replace(/[^\p{L}]/gu, "");

/** Indexes of hesitation sounds ("um", "uh", "اممم", "آه"…). Meaningful words such as "يعني" are kept. */
export function fillerIndexes(words: TimedWord[]) {
  return words.flatMap((item, index) => (FILLERS.has(clean(item.word)) ? [index] : []));
}

/**
 * What to cut so that the given words disappear. If a neighbouring word is also removed, the
 * gap between them goes too, so the result flows; otherwise a tiny margin protects neighbours.
 */
export function rangesForWords(words: TimedWord[], indexes: Iterable<number>): Range[] {
  const struck = new Set(indexes);
  const ranges: Range[] = [];
  for (const index of struck) {
    const word = words[index];
    if (!word) continue;
    const previous = words[index - 1];
    const next = words[index + 1];
    const start = previous && struck.has(index - 1) ? previous.end : Math.max(previous?.end ?? 0, word.start - 0.03);
    const end = next && struck.has(index + 1) ? next.start : Math.min(next?.start ?? word.end + 0.06, word.end + 0.06);
    if (end > start) ranges.push({ start, end });
  }
  return ranges;
}

/** Removes `cut` from every range (for putting a word back). */
export function subtractRange(ranges: Range[], cut: Range): Range[] {
  return ranges.flatMap(({ start, end }) => {
    if (cut.end <= start || cut.start >= end) return [{ start, end }];
    const parts: Range[] = [];
    if (cut.start > start) parts.push({ start, end: cut.start });
    if (cut.end < end) parts.push({ start: cut.end, end });
    return parts;
  });
}

/** True when most of the word lies inside removed audio. */
export const isWordRemoved = (word: TimedWord, removed: Range[]) => {
  const length = Math.max(0.001, word.end - word.start);
  const covered = removed.reduce((sum, r) => sum + Math.max(0, Math.min(r.end, word.end) - Math.max(r.start, word.start)), 0);
  return covered / length > 0.5;
};
