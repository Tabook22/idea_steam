import { appPath } from "./app-path.ts";

/** Peak level of every 10 ms of a recording, loaded once per file and shared by every view. */
export type Peaks = { peaks: Float32Array; duration: number; step: number };

const STEP = 0.01;
const cache = new Map<string, Promise<Peaks>>();

async function load(url: string): Promise<Peaks> {
  const response = await fetch(appPath(url, import.meta.env.BASE_URL), { credentials: "include" });
  if (!response.ok) throw new Error("download");
  const ctx = new AudioContext();
  try {
    const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    const data = buffer.getChannelData(0);
    const size = Math.max(1, Math.round(buffer.sampleRate * STEP));
    const peaks = new Float32Array(Math.ceil(data.length / size));
    for (let block = 0; block < peaks.length; block++) {
      let peak = 0;
      const end = Math.min(data.length, (block + 1) * size);
      for (let i = block * size; i < end; i += 4) peak = Math.max(peak, Math.abs(data[i]));
      peaks[block] = peak;
    }
    return { peaks, duration: buffer.duration, step: STEP };
  } finally {
    void ctx.close().catch(() => {});
  }
}

export function getPeaks(url: string) {
  let found = cache.get(url);
  if (!found) {
    found = load(url);
    cache.set(url, found);
    found.catch(() => cache.delete(url));
  }
  return found;
}

/** Loudest point between two moments. */
export function peakAt(source: Peaks, from: number, to: number) {
  const a = Math.max(0, Math.floor(from / source.step));
  const b = Math.min(source.peaks.length, Math.max(a + 1, Math.ceil(to / source.step)));
  let peak = 0;
  for (let i = a; i < b; i++) if (source.peaks[i] > peak) peak = source.peaks[i];
  return peak;
}

/** Height (0–1) for a level relative to the loudest, on a decibel scale (−42 dB … 0 dB), so quiet tracks stay visible. */
export function dbHeight(level: number, loudest: number) {
  const db = 20 * Math.log10(Math.max(level / Math.max(loudest, 1e-6), 1e-4));
  return Math.min(1, Math.max(0, (db + 42) / 42));
}
