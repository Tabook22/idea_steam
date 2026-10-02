/**
 * Search matching that treats Arabic spelling variants as equal: hamza forms of alef,
 * taa marbuta / haa, alef maqsura / yaa, and ignores diacritics and tatweel.
 * The same rules run in SQL (filtering) and here (snippets), so both agree.
 */
export const ARABIC_MARKS = "[ً-ٰٟـ]";
export const ARABIC_FROM = "أإآٱةى";
export const ARABIC_TO = "ااااهي";

const marks = new RegExp(ARABIC_MARKS, "u");
const fold = new Map([...ARABIC_FROM].map((char, index) => [char, ARABIC_TO[index]]));

export function normalizeForSearch(value: string) {
  let result = "";
  for (const char of value.toLocaleLowerCase()) {
    if (marks.test(char)) continue;
    result += fold.get(char) ?? char;
  }
  return result.replace(/\s+/g, " ").trim();
}

export function stripMarkup(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[#*_`>]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?،؛؟])/g, "$1")
    .trim();
}

/** Escape LIKE wildcards so a query like "50%" is matched literally. */
export function likePattern(normalizedQuery: string) {
  return `%${normalizedQuery.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** Text around the first match, cut from the original (not normalized) text. */
export function snippetAround(text: string, query: string, radius = 80): string | null {
  const plain = stripMarkup(text);
  const needle = normalizeForSearch(query);
  if (!needle) return null;
  // Normalized text with a map from each normalized character back to its original position.
  let normalized = "";
  const origin: number[] = [];
  const chars = [...plain];
  let offset = 0;
  for (const char of chars) {
    const lower = char.toLocaleLowerCase();
    if (!marks.test(lower)) {
      const folded = fold.get(lower) ?? lower;
      for (const part of folded) {
        normalized += part;
        origin.push(offset);
      }
    }
    offset += char.length;
  }
  const at = normalized.indexOf(needle);
  if (at < 0) return null;
  const start = origin[at];
  const end = origin[Math.min(origin.length - 1, at + needle.length - 1)] + 1;
  let from = Math.max(0, start - radius);
  let to = Math.min(plain.length, end + radius);
  // Prefer whole words at the edges.
  if (from > 0) from = plain.indexOf(" ", from) + 1 || from;
  if (to < plain.length) to = plain.lastIndexOf(" ", to) > end ? plain.lastIndexOf(" ", to) : to;
  return `${from > 0 ? "…" : ""}${plain.slice(from, to).trim()}${to < plain.length ? "…" : ""}`;
}

export function leadingSnippet(text: string, length = 160) {
  const plain = stripMarkup(text);
  return plain.length > length ? `${plain.slice(0, length).trim()}…` : plain;
}
