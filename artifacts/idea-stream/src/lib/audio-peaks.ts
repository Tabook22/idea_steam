/**
 * Min/max peaks of the original recording in blocks of BLOCK samples, built once, so the
 * waveform can be drawn quickly at any zoom (even for long recordings).
 */
export const BLOCK = 256;

export type PeakCache = { min: Float32Array; max: Float32Array; rate: number; samples: Float32Array };

export function buildPeaks(samples: Float32Array, rate: number): PeakCache {
  const blocks = Math.ceil(samples.length / BLOCK);
  const min = new Float32Array(blocks);
  const max = new Float32Array(blocks);
  for (let block = 0; block < blocks; block++) {
    let lo = 0;
    let hi = 0;
    const end = Math.min(samples.length, (block + 1) * BLOCK);
    for (let i = block * BLOCK; i < end; i++) {
      const value = samples[i];
      if (value < lo) lo = value;
      if (value > hi) hi = value;
    }
    min[block] = lo;
    max[block] = hi;
  }
  return { min, max, rate, samples };
}

/** Lowest and highest sample between two moments of the original recording. */
export function peakBetween(cache: PeakCache, from: number, to: number): [number, number] {
  const first = Math.max(0, Math.floor(from * cache.rate));
  const last = Math.min(cache.samples.length, Math.ceil(to * cache.rate));
  if (last <= first) return [0, 0];
  let lo = 0;
  let hi = 0;
  // Very short spans read samples directly; longer ones use the block cache.
  if (last - first < BLOCK * 2) {
    for (let i = first; i < last; i++) {
      const value = cache.samples[i];
      if (value < lo) lo = value;
      if (value > hi) hi = value;
    }
    return [lo, hi];
  }
  const fromBlock = Math.floor(first / BLOCK);
  const toBlock = Math.min(cache.min.length, Math.ceil(last / BLOCK));
  for (let block = fromBlock; block < toBlock; block++) {
    if (cache.min[block] < lo) lo = cache.min[block];
    if (cache.max[block] > hi) hi = cache.max[block];
  }
  return [lo, hi];
}
