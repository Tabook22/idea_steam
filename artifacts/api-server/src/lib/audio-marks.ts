export type Range = { start: number; end: number };
export type Chapter = { start: number; title: string };
export type TimedWord = { word: string; start: number; end: number };

/** Bookmarks the user tapped while recording: rounded to 0.1 s, sorted, de-duplicated, at most 100. */
export function cleanMarks(marks: unknown, duration = Infinity): number[] {
  if (!Array.isArray(marks)) return [];
  const values = marks
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Math.min(duration, 86_400))
    .map((value) => Math.round(value * 10) / 10)
    .sort((a, b) => a - b);
  return values.filter((value, index) => index === 0 || value - values[index - 1] >= 0.5).slice(0, 100);
}

/** After cutting: a mark inside a kept part moves with it; a mark inside a removed part is dropped. */
export function remapMarks(marks: number[], keep: Range[]): number[] {
  const result: number[] = [];
  let offset = 0;
  for (const { start, end } of keep) {
    for (const mark of marks) if (mark >= start && mark <= end) result.push(Math.round((offset + mark - start) * 10) / 10);
    offset += end - start;
  }
  return cleanMarks(result);
}

/** After joining: each recording's marks are shifted by the length of the recordings before it. */
export function joinMarks(parts: Array<{ marks: number[]; duration: number }>): number[] {
  let offset = 0;
  const result: number[] = [];
  for (const { marks, duration } of parts) {
    for (const mark of marks) result.push(offset + mark);
    offset += duration;
  }
  return cleanMarks(result);
}

/** Groups words into sentence-like segments with their start time, for chaptering. */
export function transcriptSegments(words: TimedWord[], maxWords = 30): Array<{ start: number; text: string }> {
  const segments: Array<{ start: number; text: string }> = [];
  let current: TimedWord[] = [];
  const flush = () => {
    if (current.length) segments.push({ start: current[0].start, text: current.map((w) => w.word.trim()).join(" ") });
    current = [];
  };
  words.forEach((word, index) => {
    const previous = words[index - 1];
    if (current.length && (current.length >= maxWords || (previous && word.start - previous.end > 0.8))) flush();
    current.push(word);
    if (/[.!?؟]$/.test(word.word.trim())) flush();
  });
  flush();
  return segments;
}

/** Validates the AI's answer: at most 12 chapters, in order, inside the recording, first at 0:00. */
export function parseChapters(raw: unknown, duration: number): { summary: string; chapters: Chapter[] } | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as { summary?: unknown; chapters?: unknown };
  const summary = typeof data.summary === "string" ? data.summary.trim().slice(0, 600) : "";
  const list = Array.isArray(data.chapters) ? data.chapters : [];
  const chapters: Chapter[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const { start, title } = entry as { start?: unknown; title?: unknown };
    const at = typeof start === "number" ? start : Number(start);
    const name = typeof title === "string" ? title.trim().replace(/\s+/g, " ").slice(0, 80) : "";
    if (!name || !Number.isFinite(at) || at < 0 || at >= Math.max(duration, 1)) continue;
    chapters.push({ start: Math.round(at * 10) / 10, title: name });
  }
  chapters.sort((a, b) => a.start - b.start);
  // Chapters closer than 5 s apart are noise; keep the first of each cluster.
  const spaced = chapters.filter((chapter, index) => index === 0 || chapter.start - chapters[index - 1].start >= 5);
  if (spaced.length) spaced[0].start = 0;
  if (!summary && !spaced.length) return null;
  return { summary, chapters: spaced.slice(0, 12) };
}
