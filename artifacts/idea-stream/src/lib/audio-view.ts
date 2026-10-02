export type View = { start: number; end: number };

/** The smallest window you can zoom to (a quarter second shows single syllables). */
export const MIN_SPAN = 0.25;

/** Keeps the window inside the recording and at least MIN_SPAN wide. */
export function clampView(view: View, length: number): View {
  if (length <= 0) return { start: 0, end: 0 };
  const span = Math.min(length, Math.max(Math.min(MIN_SPAN, length), view.end - view.start));
  const start = Math.min(Math.max(0, view.start), length - span);
  return { start, end: start + span };
}

/** Zooms by `factor` (>1 zooms in) while the moment under the cursor stays where it is. */
export function zoomAt(view: View, factor: number, anchor: number, length: number): View {
  const span = view.end - view.start;
  const nextSpan = Math.min(length, Math.max(Math.min(MIN_SPAN, length), span / factor));
  const ratio = span > 0 ? (anchor - view.start) / span : 0.5;
  return clampView({ start: anchor - ratio * nextSpan, end: anchor - ratio * nextSpan + nextSpan }, length);
}

/** Moves the window by `seconds` (negative = earlier). */
export const panBy = (view: View, seconds: number, length: number): View =>
  clampView({ start: view.start + seconds, end: view.end + seconds }, length);

/** A window around `range` with a little margin on each side. */
export function viewAround(range: View, length: number, margin = 0.15): View {
  const span = Math.max(MIN_SPAN, range.end - range.start);
  return clampView({ start: range.start - span * margin, end: range.end + span * margin }, length);
}

const STEPS = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];

/** Ruler ticks with "nice" spacing so labels are about `minGap` pixels apart. */
export function rulerTicks(view: View, widthPx: number, minGap = 72): number[] {
  const span = view.end - view.start;
  if (span <= 0 || widthPx <= 0) return [];
  const step = STEPS.find((candidate) => (candidate / span) * widthPx >= minGap) ?? STEPS[STEPS.length - 1];
  const ticks: number[] = [];
  for (let t = Math.ceil(view.start / step - 1e-9) * step; t <= view.end + 1e-9; t += step) ticks.push(Math.round(t * 1000) / 1000 + 0); // "+ 0" turns -0 into 0
  return ticks;
}
