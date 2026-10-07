/**
 * Idea Connections: how close recordings, ideas and notebooks are in meaning, from the passage
 * embeddings of the Ask index. Pure functions (no database, no AI).
 */
import { cosine } from "./ask";

export type SourceKey = `${"recording" | "idea" | "draft"}:${number}`;
export const sourceKey = (source: string, id: number) => `${source}:${id}` as SourceKey;

/** One vector per recording/idea/draft: the average of its passages, scaled to length 1. */
export function sourceVectors(rows: Array<{ source: string; sourceId: number; embedding: number[] | null }>) {
  const sums = new Map<SourceKey, { sum: number[]; count: number }>();
  for (const row of rows) {
    if (!row.embedding?.length) continue;
    const key = sourceKey(row.source, row.sourceId);
    const entry = sums.get(key) ?? { sum: new Array(row.embedding.length).fill(0), count: 0 };
    row.embedding.forEach((value, index) => { entry.sum[index] += value; });
    entry.count++;
    sums.set(key, entry);
  }
  const vectors = new Map<SourceKey, number[]>();
  for (const [key, { sum }] of sums) vectors.set(key, unit(sum));
  return vectors;
}

export function unit(vector: number[]) {
  const length = Math.sqrt(vector.reduce((total, value) => total + value * value, 0)) || 1;
  return vector.map((value) => value / length);
}

/** The average direction of several vectors (e.g. a notebook from its ideas). */
export function centroid(vectors: number[][]) {
  if (!vectors.length) return null;
  const sum = new Array(vectors[0].length).fill(0);
  for (const vector of vectors) vector.forEach((value, index) => { sum[index] += value; });
  return unit(sum);
}

/** The closest other sources to one, best first, above `min`, skipping any in `exclude`. */
export function relatedTo(target: SourceKey, vectors: Map<SourceKey, number[]>, { limit = 5, min = 0.3, exclude = new Set<SourceKey>() } = {}) {
  const own = vectors.get(target);
  if (!own) return [];
  const scored: Array<{ key: SourceKey; score: number }> = [];
  for (const [key, vector] of vectors) {
    if (key === target || exclude.has(key)) continue;
    const score = cosine(own, vector);
    if (score >= min) scored.push({ key, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Groups of items about the same thing: items closer than `threshold` are linked, and linked
 * items form a group (at least `smallest`). Biggest groups first; each group is capped.
 */
export function groupBySimilarity(keys: SourceKey[], vectors: Map<SourceKey, number[]>, { threshold = 0.5, smallest = 2, largest = 12, most = 5 } = {}) {
  const present = keys.filter((key) => vectors.has(key));
  const parent = new Map(present.map((key) => [key, key]));
  const find = (key: SourceKey): SourceKey => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(key, root);
    return root;
  };
  for (let i = 0; i < present.length; i++)
    for (let j = i + 1; j < present.length; j++)
      if (cosine(vectors.get(present[i])!, vectors.get(present[j])!) >= threshold) parent.set(find(present[i]), find(present[j]));
  const groups = new Map<SourceKey, SourceKey[]>();
  for (const key of present) groups.set(find(key), [...(groups.get(find(key)) ?? []), key]);
  return [...groups.values()]
    .filter((group) => group.length >= smallest)
    .sort((a, b) => b.length - a.length)
    .slice(0, most)
    .map((group) => group.slice(0, largest));
}

/** The notebook an item fits best, if it fits well enough. */
export function bestFit(vector: number[], notebooks: Array<{ id: number; vector: number[] }>, min = 0.45) {
  let best: { id: number; score: number } | null = null;
  for (const notebook of notebooks) {
    const score = cosine(vector, notebook.vector);
    if (score >= min && (!best || score > best.score)) best = { id: notebook.id, score };
  }
  return best;
}

/** "2026-W41": the ISO week of a day, so one digest is kept per week. */
export function isoWeek(day: string) {
  const date = new Date(`${day}T00:00:00Z`);
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export type Digest = {
  headline: string;
  themes: Array<{ title: string; summary: string }>;
  questions: string[];
  ready: Array<{ subjectId: number; reason: string }>;
  nudge: string | null;
};

const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** The AI's weekly digest, checked; notebooks it names must be real ones. */
export function parseDigest(raw: unknown, subjectIds: Set<number>): Digest | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const headline = text(data.headline, 160);
  if (!headline) return null;
  const themes = (Array.isArray(data.themes) ? data.themes : [])
    .map((theme) => (theme && typeof theme === "object" ? { title: text((theme as Record<string, unknown>).title, 60), summary: text((theme as Record<string, unknown>).summary, 300) } : null))
    .filter((theme): theme is { title: string; summary: string } => !!theme?.title && !!theme.summary)
    .slice(0, 4);
  const questions = (Array.isArray(data.questions) ? data.questions : []).map((question) => text(question, 200)).filter(Boolean).slice(0, 4);
  const ready = (Array.isArray(data.ready) ? data.ready : [])
    .map((entry) => (entry && typeof entry === "object" ? { subjectId: Number((entry as Record<string, unknown>).subjectId), reason: text((entry as Record<string, unknown>).reason, 200) } : null))
    .filter((entry): entry is { subjectId: number; reason: string } => !!entry && subjectIds.has(entry.subjectId) && !!entry.reason)
    .slice(0, 3);
  return { headline, themes, questions, ready, nudge: text(data.nudge, 200) || null };
}
