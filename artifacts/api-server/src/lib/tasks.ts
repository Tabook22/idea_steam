/**
 * Voice to Action: finding tasks in what was said. The AI returns each task with the words it
 * came from (a short quote); the quote is found in the recording to play the moment it was said.
 */
import { createHash } from "node:crypto";
import { normalizeForSearch } from "./search-text";

export type TimedWord = { word: string; start: number; end: number };
export type FoundTask = { text: string; due: string | null; time: string | null; person: string | null; quote: string | null };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function taskPrompt(captured: Date) {
  const day = captured.toISOString().slice(0, 10);
  return [
    "You find ACTION ITEMS in a person's own voice note: things they need to do, decided to do, must remember, or asked someone to do.",
    "Ignore ideas, opinions, descriptions and plans that are not concrete actions. A short note may have none: then return an empty list.",
    `The note was recorded on ${WEEKDAYS[captured.getUTCDay()]} ${day}. Turn relative dates ("tomorrow", "Thursday", "next week", "بكرة", "يوم الخميس") into a date (YYYY-MM-DD) on or after that day; "next week" means that week's Sunday.`,
    "Write each task as a short imperative in the SAME language it was spoken (Arabic stays Arabic), at most 12 words, e.g. \"Ask the school to cover the projector\".",
    "Return JSON: {\"tasks\": [{\"text\": string, \"due\": \"YYYY-MM-DD\" or null, \"time\": \"HH:MM\" (24h) or null, \"person\": name of someone involved or null, \"quote\": the 3-8 consecutive words of the note the task comes from, copied exactly}]}.",
    "At most 10 tasks, in the order they were said. Do not invent tasks.",
  ].join(" ");
}

const isDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const isTime = (value: unknown): value is string => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const clean = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** The AI's answer, checked: real text, valid dates and times, nothing else. */
export function parseTasks(raw: unknown): FoundTask[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { tasks?: unknown }).tasks) ? (raw as { tasks: unknown[] }).tasks : [];
  const out: FoundTask[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const text = clean(item.text, 200);
    if (text.length < 3) continue;
    out.push({
      text,
      due: isDate(item.due) ? item.due : null,
      time: isDate(item.due) && isTime(item.time) ? item.time : null,
      person: clean(item.person, 60) || null,
      quote: clean(item.quote, 120) || null,
    });
    if (out.length >= 10) break;
  }
  return out;
}

const fold = (text: string) => normalizeForSearch(text).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

/**
 * Where the quote was said, in seconds: exactly when word timings exist, otherwise estimated from
 * where it sits in the text. A couple of seconds early, so playback starts just before.
 */
export function locateQuote(quote: string | null, transcript: string | null, words: TimedWord[] | null, duration: number | null): number | null {
  if (!quote) return null;
  const wanted = fold(quote).split(" ").filter(Boolean);
  if (!wanted.length) return null;
  if (words?.length) {
    const spoken = words.map((word) => fold(word.word));
    const probe = wanted.slice(0, Math.min(4, wanted.length));
    for (let i = 0; i + probe.length <= spoken.length; i++)
      if (probe.every((want, k) => spoken[i + k] === want)) return Math.max(0, Math.round((words[i].start - 1.5) * 10) / 10);
  }
  if (transcript && duration) {
    const text = fold(transcript);
    const at = text.indexOf(wanted.slice(0, Math.min(4, wanted.length)).join(" "));
    if (at >= 0) return Math.max(0, Math.round(((at / Math.max(1, text.length)) * duration - 2) * 10) / 10);
  }
  return null;
}

/** Same task said again (or found again after an edit): compared without case or punctuation. */
export const sameTask = (a: string, b: string) => fold(a) === fold(b);

export const textHash = (text: string) => createHash("sha1").update(text).digest("hex").slice(0, 16);
