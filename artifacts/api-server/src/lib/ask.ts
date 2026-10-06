/**
 * "Ask your library": the pieces that need no database or AI, so they can be tested alone.
 * Recordings, ideas and drafts are cut into short passages; a question is matched against them
 * by meaning (embeddings, when AI is set up) and by words (always), and the best passages are
 * given to the AI, which answers with numbered citations.
 */
import { createHash } from "node:crypto";
import { normalizeForSearch, stripMarkup } from "./search-text";

export type TimedWord = { word: string; start: number; end: number };
export type SourceKind = "recording" | "idea" | "draft";

/** A passage of a recording, idea or draft, as stored in the index. */
export type Passage = {
  source: SourceKind;
  sourceId: number;
  part: number;
  /** Seconds into the recording where the passage starts (recordings with word timings only). */
  start: number | null;
  text: string;
  /** Name, subject and date: embedded with the text so "the call with Sara" finds it. */
  header: string;
  hash: string;
};

const MAX_WORDS = 90;
const MIN_WORDS = 35;
const MAX_CHARS = 700;

export const passageHash = (header: string, text: string, start: number | null) =>
  createHash("sha1").update(`${header}\n${start ?? ""}\n${text}`).digest("hex").slice(0, 20);

const make = (source: SourceKind, sourceId: number, header: string, pieces: Array<{ start: number | null; text: string }>): Passage[] =>
  pieces
    .map((piece) => ({ ...piece, text: piece.text.replace(/\s+/g, " ").trim() }))
    .filter((piece) => piece.text.length > 0)
    .map((piece, part) => ({ source, sourceId, part, start: piece.start, text: piece.text, header, hash: passageHash(header, piece.text, piece.start) }));

/**
 * A timed recording in passages of up to ~90 words, ending at a sentence or a pause when one
 * comes after ~35 words, so each passage starts at a natural place to play from.
 */
export function wordPassages(words: TimedWord[]): Array<{ start: number; text: string }> {
  const out: Array<{ start: number; text: string }> = [];
  let current: TimedWord[] = [];
  const flush = () => {
    if (current.length) out.push({ start: Math.max(0, current[0].start), text: current.map((w) => w.word.trim()).filter(Boolean).join(" ") });
    current = [];
  };
  words.forEach((word, index) => {
    const next = words[index + 1];
    current.push(word);
    const sentence = /[.!?؟…]$/.test(word.word.trim());
    const pause = next ? next.start - word.end > 0.7 : false;
    if (current.length >= MAX_WORDS || (current.length >= MIN_WORDS && (sentence || pause))) flush();
  });
  flush();
  return out;
}

/** Plain text in passages of up to ~700 characters, split at sentence ends when possible. */
export function textPassages(text: string): string[] {
  const plain = stripMarkup(text);
  if (!plain) return [];
  const sentences = plain.match(/[^.!?؟\n]+[.!?؟]*\s*/g) ?? [plain];
  const out: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > MAX_CHARS) { out.push(current); current = ""; }
    if (sentence.length > MAX_CHARS) {
      for (let i = 0; i < sentence.length; i += MAX_CHARS) out.push(sentence.slice(i, i + MAX_CHARS));
      continue;
    }
    current += sentence;
  }
  if (current.trim()) out.push(current);
  return out.map((piece) => piece.trim()).filter(Boolean);
}

export function recordingPassages(item: {
  id: number; title: string | null; transcript: string | null; words: TimedWord[] | null;
  capturedAt: Date; durationSeconds: number | null; pre?: number; subjects?: string[];
}): Passage[] {
  const header = [
    `Recording: ${item.title || "untitled voice note"}`,
    item.subjects?.length ? `Subjects: ${item.subjects.join(", ")}` : "",
    `Date: ${item.capturedAt.toISOString().slice(0, 10)}`,
  ].filter(Boolean).join(" · ");
  // Word timings belong to the voice; with background music before it, playback starts later.
  const pre = item.pre ?? 0;
  if (item.words?.length) return make("recording", item.id, header, wordPassages(item.words).map((p) => ({ start: p.start + pre, text: p.text })));
  if (!item.transcript?.trim()) return [];
  return make("recording", item.id, header, textPassages(item.transcript).map((text) => ({ start: null, text })));
}

export function ideaPassages(idea: {
  id: number; content: string; subjectTitle: string; createdAt: Date;
  attachments: Array<{ type: string; name?: string; transcript?: string; note?: string; extractedText?: string; libraryItemId?: number }>;
}): Passage[] {
  const header = `Idea in “${idea.subjectTitle}” · Date: ${idea.createdAt.toISOString().slice(0, 10)}`;
  const extra = idea.attachments.flatMap((attachment) => [
    attachment.note ?? "",
    // A library recording is indexed on its own (with timings), so its text isn't repeated here.
    attachment.libraryItemId ? "" : attachment.transcript ?? "",
    attachment.extractedText ?? "",
  ]).filter((value) => value.trim());
  const content = stripMarkup(idea.content);
  const body = [content, ...extra].filter(Boolean).join("\n");
  return make("idea", idea.id, header, textPassages(body).map((text) => ({ start: null, text })));
}

export function draftPassages(draft: { id: number; subjectTitle: string; content: string; updatedAt: Date }): Passage[] {
  const header = `Draft of “${draft.subjectTitle}” · Date: ${draft.updatedAt.toISOString().slice(0, 10)}`;
  return make("draft", draft.id, header, textPassages(draft.content).map((text) => ({ start: null, text })));
}

// ---- Matching by words ----

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "about", "is", "are", "was", "were", "be", "it", "this", "that",
  "what", "which", "who", "when", "where", "how", "why", "did", "do", "does", "i", "me", "my", "we", "our", "you", "your", "say", "said",
  "tell", "any", "all", "some", "there", "have", "has", "had", "from", "at", "by", "as", "can", "could", "would", "should", "ideas", "idea",
  "في", "من", "على", "الى", "إلى", "عن", "ما", "ماذا", "متى", "اين", "أين", "كيف", "لماذا", "هل", "هو", "هي", "انا", "أنا", "نحن", "قلت",
  "قال", "التي", "الذي", "هذا", "هذه", "ذلك", "كان", "كانت", "مع", "او", "أو", "ثم", "كل", "بعض", "عندي", "لي", "فكرة", "افكار", "أفكار",
].map((word) => normalizeForSearch(word)));

/** Words of a question or passage, folded (Arabic spelling variants, case) and without common prefixes. */
export function terms(text: string): string[] {
  return normalizeForSearch(text)
    .split(/[^\p{L}\p{N}]+/u)
    .map((word) => (word.length > 4 ? word.replace(/^(وال|بال|فال|كال|لل|ال)/, "") : word))
    .map((word) => (/^[a-z]+$/.test(word) && word.length > 4 ? word.replace(/(ing|ed|es|s)$/, "") : word))
    .filter((word) => word.length >= 2 && !STOP.has(word));
}

/** 0–1: how many of the question's words appear in the passage. */
export function keywordScore(questionTerms: string[], passageText: string): number {
  if (!questionTerms.length) return 0;
  const haystack = ` ${terms(passageText).join(" ")} `;
  const unique = [...new Set(questionTerms)];
  const hits = unique.filter((term) => haystack.includes(` ${term}`)).length;
  return hits / unique.length;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export type Candidate = Passage & { embedding: number[] | null };
export type Ranked = Candidate & { score: number };

/**
 * The best passages for a question: meaning and words together, at most `perSource` from one
 * recording or idea, and within a text budget for the AI.
 */
export function rank(question: string, candidates: Candidate[], questionEmbedding: number[] | null, { limit = 8, perSource = 3, budget = 9000 } = {}): Ranked[] {
  const questionTerms = terms(question);
  const scored = candidates.map((candidate) => {
    const words = keywordScore(questionTerms, `${candidate.header} ${candidate.text}`);
    const meaning = questionEmbedding && candidate.embedding ? cosine(questionEmbedding, candidate.embedding) : null;
    // Embeddings of related text sit around 0.2–0.6; words add a boost for exact names and terms.
    const score = meaning === null ? words : meaning + 0.35 * words;
    return { ...candidate, score, words, meaning };
  });
  const usable = scored.filter((item) => (item.meaning === null ? item.words > 0 : item.meaning > 0.2 || item.words > 0));
  usable.sort((a, b) => b.score - a.score);
  const picked: Ranked[] = [];
  const perKey = new Map<string, number>();
  let used = 0;
  for (const item of usable) {
    if (picked.length >= limit) break;
    const key = `${item.source}:${item.sourceId}`;
    if ((perKey.get(key) ?? 0) >= perSource) continue;
    if (used + item.text.length > budget && picked.length) continue;
    perKey.set(key, (perKey.get(key) ?? 0) + 1);
    used += item.text.length;
    const { words: _w, meaning: _m, ...rest } = item;
    picked.push(rest);
  }
  return picked;
}

export const isArabicText = (text: string) => /[؀-ۿ]/.test(text);

export const formatClock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** The numbered sources the AI reads. */
export function sourcesForPrompt(passages: Ranked[]): string {
  return passages.map((passage, index) => {
    const at = passage.start !== null ? ` · at ${formatClock(passage.start)}` : "";
    return `[${index + 1}] ${passage.header}${at}\n${passage.text}`;
  }).join("\n\n");
}

export const ASK_SYSTEM = [
  "You answer questions about a person's own voice notes, ideas and drafts, using ONLY the numbered sources given.",
  "Answer in the SAME language as the question (Arabic question → Arabic answer, English → English).",
  "Be direct and practical: a short answer first, then bullet points if there are several things. Keep it under 180 words.",
  "Cite sources with their numbers in square brackets, e.g. [1] or [2][3], right after the sentence they support.",
  "Speak to the person as \"you\" (\"You said…\", \"قلتَ…\").",
  "If the sources don't contain the answer, say so plainly in one sentence and do not guess.",
].join(" ");

/** Which source numbers the answer cites, in order of first use (unknown numbers ignored). */
export function citedNumbers(answer: string, count: number): number[] {
  const seen: number[] = [];
  for (const match of answer.matchAll(/\[(\d+(?:\s*[,،]\s*\d+)*)\]/g))
    for (const part of match[1].split(/[,،]/)) {
      const n = Number(part.trim());
      if (n >= 1 && n <= count && !seen.includes(n)) seen.push(n);
    }
  return seen;
}

/** A short excerpt of a passage around the question's words. */
export function excerpt(text: string, question: string, radius = 140): string {
  const questionTerms = terms(question);
  const folded = normalizeForSearch(text);
  let at = -1;
  for (const term of questionTerms) { at = folded.indexOf(term); if (at >= 0) break; }
  if (at < 0 || text.length <= radius * 2) return text.length > radius * 2 ? `${text.slice(0, radius * 2).trim()}…` : text;
  const from = Math.max(0, at - radius);
  const to = Math.min(text.length, at + radius);
  return `${from > 0 ? "…" : ""}${text.slice(from, to).trim()}${to < text.length ? "…" : ""}`;
}
