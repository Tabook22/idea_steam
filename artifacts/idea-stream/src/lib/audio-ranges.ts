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

/**
 * The edited recording as you hear it: kept parts joined end to end. "Edited time" runs
 * from 0 to the new length; these convert between it and the original recording's time.
 */
export class EditedTimeline {
  readonly kept: Range[];
  readonly length: number;
  constructor(removed: Range[], duration: number) {
    this.kept = keptRanges(removed, duration);
    this.length = totalLength(this.kept);
  }
  /** Original time for a moment in the edited recording. */
  toOriginal(time: number) {
    let offset = 0;
    for (const { start, end } of this.kept) {
      const length = end - start;
      if (time <= offset + length) return start + Math.max(0, time - offset);
      offset += length;
    }
    return this.kept.at(-1)?.end ?? 0;
  }
  /** Edited time for a moment in the original (a removed moment maps to its join point). */
  toEdited(time: number) {
    let offset = 0;
    for (const { start, end } of this.kept) {
      if (time < start) return offset;
      if (time <= end) return offset + (time - start);
      offset += end - start;
    }
    return this.length;
  }
  /** The original pieces behind an edited-time range (it can span several joins). */
  originalPieces(from: number, to: number): Range[] {
    const pieces: Range[] = [];
    let offset = 0;
    for (const { start, end } of this.kept) {
      const length = end - start;
      const a = Math.max(from, offset);
      const b = Math.min(to, offset + length);
      if (b - a > 0.001) pieces.push({ start: start + (a - offset), end: start + (b - offset) });
      offset += length;
    }
    return pieces;
  }
  /** Edited-time positions where two kept parts meet (where something was cut out). */
  joins() {
    const points: number[] = [];
    let offset = 0;
    this.kept.forEach(({ start, end }, index) => {
      if (index > 0) points.push(offset);
      offset += end - start;
    });
    return points;
  }
}

export function formatTime(seconds: number, precise = false) {
  // Round first (5.96 s reads as 0:06, matching the library list), then split.
  const value = precise ? Math.round(Math.max(0, seconds) * 10) / 10 : Math.round(Math.max(0, seconds));
  const minutes = Math.floor(value / 60);
  const rest = value - minutes * 60;
  return precise ? `${minutes}:${rest.toFixed(1).padStart(4, "0")}` : `${minutes}:${String(rest).padStart(2, "0")}`;
}
