/**
 * Editing a recording through its words: paragraphs to read, finding a phrase, the word being
 * spoken, and long pauses. Times are in the ORIGINAL recording (as the words were read).
 */
import type { TimedWord } from "./audio-cleanup.ts";

/** A span of words, by index (both ends included). */
export type Span = { from: number; to: number };

const MARKS = /[ً-ٰٟـ]/g;
const FOLD: Record<string, string> = { "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ة": "ه", "ى": "ي" };

/** A word for comparing: lower case, no punctuation or diacritics, Arabic letter variants folded. */
export function foldWord(word: string) {
  return word
    .toLocaleLowerCase()
    .replace(MARKS, "")
    .replace(/[أإآٱةى]/g, (char) => FOLD[char])
    .replace(/[^\p{L}\p{N}']/gu, "");
}

/** Also matches with a leading Arabic "و" / "ال" / "بال"… ("والمدرسة" finds "مدرسة"). */
const bare = (word: string) => (word.length > 3 ? word.replace(/^(وال|بال|فال|كال|لل|ال|و)/, "") : word);
const same = (spoken: string, wanted: string) => spoken === wanted || (wanted.length > 1 && bare(spoken) === bare(wanted));

/** Every place the phrase is said, as word spans (case, punctuation and Arabic spelling ignored). */
export function findPhrase(words: TimedWord[], phrase: string): Span[] {
  const wanted = phrase.split(/\s+/).map(foldWord).filter(Boolean);
  if (!wanted.length) return [];
  const spoken = words.map((word) => foldWord(word.word));
  const found: Span[] = [];
  for (let i = 0; i + wanted.length <= spoken.length; i++) {
    if (wanted.every((want, k) => same(spoken[i + k], want))) {
      found.push({ from: i, to: i + wanted.length - 1 });
      i += wanted.length - 1;
    }
  }
  return found;
}

/**
 * Paragraphs for reading: a new one after a sentence ends (once it has some length), after a
 * long pause, or when it grows too long. Returns spans with where each starts.
 */
export function paragraphs(words: TimedWord[], { pause = 1.2, sentence = 25, most = 70 } = {}): Array<Span & { start: number }> {
  const out: Array<Span & { start: number }> = [];
  let from = 0;
  words.forEach((word, index) => {
    const next = words[index + 1];
    if (!next) return;
    const count = index - from + 1;
    const ends = /[.!?؟…]$/.test(word.word.trim());
    if ((ends && count >= sentence) || (next.start - word.end > pause && count >= 6) || count >= most) {
      out.push({ from, to: index, start: words[from].start });
      from = index + 1;
    }
  });
  if (words.length) out.push({ from, to: words.length - 1, start: words[from].start });
  return out;
}

/** The word being spoken at a moment (the last one started), or -1 before the first. */
export function wordAt(words: TimedWord[], time: number): number {
  let lo = 0, hi = words.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].start <= time) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

/** Silences between words longer than `longer` seconds: after which word, and when. */
export function wordGaps(words: TimedWord[], longer = 1): Array<{ after: number; start: number; end: number }> {
  const gaps: Array<{ after: number; start: number; end: number }> = [];
  for (let i = 0; i < words.length - 1; i++) {
    const gap = words[i + 1].start - words[i].end;
    if (gap > longer) gaps.push({ after: i, start: words[i].end, end: words[i + 1].start });
  }
  return gaps;
}

/** What to cut to shorten a pause, leaving a natural gap. */
export const shortenGap = (gap: { start: number; end: number }, keep = 0.3) =>
  ({ start: gap.start + keep / 2, end: gap.end - keep / 2 });

export const spanIndexes = (span: Span) => Array.from({ length: span.to - span.from + 1 }, (_, k) => span.from + k);

/** The span from one tapped word to another (in either order). */
export const spanBetween = (a: number, b: number): Span => ({ from: Math.min(a, b), to: Math.max(a, b) });
