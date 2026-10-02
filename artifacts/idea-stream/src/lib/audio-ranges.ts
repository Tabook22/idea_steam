export type Range = { start: number; end: number };

/** Sorted, merged ranges clipped to [0, duration]; anything shorter than 20 ms is dropped. */
export function mergeRanges(ranges: Range[], duration: number): Range[] {
  const sorted = ranges
    .map(({ start, end }) => ({ start: Math.max(0, Math.min(start, end)), end: Math.min(duration, Math.max(start, end)) }))
    .filter(({ start, end }) => end - start >= 0.02)
    .sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.start <= last.end + 0.001) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

/** The parts to keep: everything outside the removed ranges. */
export function keptRanges(removed: Range[], duration: number): Range[] {
  const kept: Range[] = [];
  let cursor = 0;
  for (const { start, end } of mergeRanges(removed, duration)) {
    if (start - cursor >= 0.05) kept.push({ start: cursor, end: start });
    cursor = Math.max(cursor, end);
  }
  if (duration - cursor >= 0.05) kept.push({ start: cursor, end: duration });
  return kept;
}

export const totalLength = (ranges: Range[]) => ranges.reduce((sum, { start, end }) => sum + (end - start), 0);

/** Where playback should continue from `position`, skipping removed parts (null at the end). */
export function nextAudible(position: number, removed: Range[], duration: number): number | null {
  for (const { start, end } of mergeRanges(removed, duration)) if (position >= start && position < end) position = end;
  return position < duration - 0.02 ? position : null;
}

export function formatTime(seconds: number, precise = false) {
  // Round first (5.96 s reads as 0:06, matching the library list), then split.
  const value = precise ? Math.round(Math.max(0, seconds) * 10) / 10 : Math.round(Math.max(0, seconds));
  const minutes = Math.floor(value / 60);
  const rest = value - minutes * 60;
  return precise ? `${minutes}:${rest.toFixed(1).padStart(4, "0")}` : `${minutes}:${String(rest).padStart(2, "0")}`;
}
