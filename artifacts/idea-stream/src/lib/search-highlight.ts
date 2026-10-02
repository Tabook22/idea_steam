// Mirrors the server's matching (artifacts/api-server/src/lib/search-text.ts) so the
// highlighted words are exactly the ones that matched, including Arabic variants.
const marks = /[ً-ٰٟـ]/u;
const fold = new Map([..."أإآٱةى"].map((char, index) => [char, "ااااهي"[index]]));

function normalize(value: string) {
  let normalized = "";
  const origin: number[] = [];
  let offset = 0;
  for (const char of value) {
    const lower = char.toLocaleLowerCase();
    if (!marks.test(lower)) {
      const folded = /\s/.test(lower) ? " " : fold.get(lower) ?? lower;
      for (const part of folded) {
        // Collapse runs of whitespace like the server does.
        if (part === " " && normalized.endsWith(" ")) continue;
        normalized += part;
        origin.push(offset);
      }
    }
    offset += char.length;
  }
  return { normalized, origin };
}

export type Segment = { text: string; match: boolean };

/** Splits text into plain and matching segments for every occurrence of the query. */
export function highlight(text: string, query: string): Segment[] {
  const needle = normalize(query.trim()).normalized.trim();
  if (needle.length < 2) return [{ text, match: false }];
  const { normalized, origin } = normalize(text);
  const segments: Segment[] = [];
  let cursor = 0;
  let from = normalized.indexOf(needle);
  while (from >= 0) {
    const start = origin[from];
    const lastIndex = from + needle.length - 1;
    const endChar = origin[lastIndex];
    // Include the full last character (and any marks attached to it).
    let end = endChar + (text.codePointAt(endChar)! > 0xffff ? 2 : 1);
    while (end < text.length && marks.test(text[end])) end++;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), match: false });
    segments.push({ text: text.slice(start, end), match: true });
    cursor = end;
    from = normalized.indexOf(needle, from + needle.length);
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments.length ? segments : [{ text, match: false }];
}
