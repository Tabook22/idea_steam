/**
 * Key takeaways of one idea: the AI reads the idea (and its transcripts, notes and documents) and
 * returns a one-sentence gist and the most important points, each with details, why it matters,
 * and words quoted from the source. Quotes are kept only if they are really in the source.
 */
import { createHash } from "node:crypto";
import type { TakeawayPoint, Takeaways } from "@workspace/db";

const KINDS = new Set<TakeawayPoint["kind"]>(["insight", "fact", "action", "question", "argument", "example"]);

export const sourceHash = (source: string) => createHash("sha256").update(source).digest("hex").slice(0, 32);
export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

export function takeawaysPrompt(words: number) {
  const count = words < 150 ? "2 to 4" : words < 800 ? "3 to 6" : "5 to 8";
  return [
    "You are a careful analyst. Read the whole idea below, including any transcripts, notes and documents, and find what matters most in it.",
    `Return the ${count} most important takeaways, most important first. Each must be distinct and grounded in the text; never add facts that aren't there.`,
    "For each takeaway:",
    "- title: the takeaway itself, up to 10 words, specific (not a topic label like \"Introduction\").",
    "- summary: one clear sentence.",
    "- details: 2-5 sentences that explain it fully as the source does: the reasoning, the example or numbers it gives.",
    "- why: one sentence on why it matters or what to do with it.",
    "- quote: copy 6-40 consecutive words exactly from the source that best support it, or \"\" if none fits.",
    "- kind: one of insight, fact, action, question, argument, example.",
    "Also give gist: the whole idea in one sentence.",
    "Write everything (except quotes, which stay exact) in the language the idea is mostly written in; Arabic stays Arabic.",
    'Answer with JSON only: {"gist": "...", "points": [{"title": "...", "summary": "...", "details": "...", "why": "...", "quote": "...", "kind": "..."}]}',
  ].join("\n");
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/[ \t]+/g, " ").trim().slice(0, max) : "");
const loose = (value: string) => value.toLowerCase().normalize("NFKC").replace(/[ً-ْـ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** The AI's answer, checked: usable points only, at most 8, quotes that are really in the source. */
export function cleanTakeaways(raw: unknown, source: string): Takeaways | null {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const haystack = loose(source);
  const points: TakeawayPoint[] = [];
  for (const value of Array.isArray(data.points) ? data.points.slice(0, 10) : []) {
    const point = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const title = text(point.title, 140);
    const summary = text(point.summary, 400);
    if (!title || !summary) continue;
    const quote = text(point.quote, 400).replace(/^["“'«]+|["”'»]+$/g, "");
    const quoted = loose(quote);
    points.push({
      title, summary,
      details: text(point.details, 2000),
      why: text(point.why, 400),
      // An invented quote is worse than none.
      quote: quoted.split(" ").length >= 4 && haystack.includes(quoted) ? quote : "",
      kind: KINDS.has(point.kind as TakeawayPoint["kind"]) ? (point.kind as TakeawayPoint["kind"]) : "insight",
    });
    if (points.length >= 8) break;
  }
  if (!points.length) return null;
  return { gist: text(data.gist, 400), points, words: wordCount(source) };
}

