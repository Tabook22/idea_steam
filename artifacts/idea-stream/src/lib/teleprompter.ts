/**
 * Script to Episode: a script in readable sections, and following along as it is read aloud
 * (the teleprompter moves to where you are).
 */

export type Section = { title: string; text: string };

const RICH = "<!--idea-stream-rich-text-->";

/** Plain text with line breaks from a draft (rich text, Markdown or plain). */
export function scriptText(content: string) {
  let text = content.startsWith(RICH) ? content.slice(RICH.length) : content;
  text = text
    .replace(/<\s*h[1-3][^>]*>/gi, "\n# ").replace(/<\s*\/\s*h[1-3]\s*>/gi, "\n")
    .replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\s*\/\s*(p|div|li)\s*>/gi, "\n").replace(/<\s*li[^>]*>/gi, "\n• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\*\*|__|`/g, "");
  return text.split("\n").map((line) => line.trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;
const shortTitle = (text: string) => {
  const words = text.replace(/\[[^\]]*\]/g, " ").split(/\s+/).filter(Boolean);
  return words.slice(0, 6).join(" ") + (words.length > 6 ? "…" : "");
};

/**
 * Sections to record one at a time: a heading starts a new one; long stretches are split at
 * paragraphs, about `most` words each, so a retake is never long.
 */
export function scriptSections(content: string, most = 140): Section[] {
  const sections: Section[] = [];
  let title: string | null = null;
  let paragraphs: string[] = [];
  const flush = () => {
    let chunk: string[] = [];
    let part = 0;
    const push = () => {
      if (!chunk.length) return;
      const text = chunk.join("\n\n");
      sections.push({ title: title ? (part ? `${title} (${part + 1})` : title) : shortTitle(text), text });
      chunk = [];
      part++;
    };
    for (const paragraph of paragraphs) {
      if (chunk.length && wordCount([...chunk, paragraph].join(" ")) > most) push();
      chunk.push(paragraph);
    }
    push();
    paragraphs = [];
  };
  for (const block of scriptText(content).split(/\n\s*\n|\n(?=#)/)) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (/^#{1,3}\s/.test(lines[0])) {
      flush();
      title = lines[0].replace(/^#{1,3}\s+/, "").replace(/[:：]$/, "").slice(0, 80);
      lines.shift();
    }
    if (lines.length) paragraphs.push(lines.join("\n"));
  }
  flush();
  return sections.filter((section) => wordCount(spoken(section.text)) > 0);
}

/** What is read aloud: stage directions in [brackets] are shown, not spoken. */
export const spoken = (text: string) => text.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();

const MARKS = /[ً-ٰٟـ]/g;
export const foldWord = (word: string) =>
  word.toLocaleLowerCase().replace(MARKS, "").replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[^\p{L}\p{N}]/gu, "");

/** The words of a section as they will be compared with what was heard. */
export const scriptWords = (text: string) => spoken(text).split(/\s+/).map(foldWord).filter(Boolean);

const near = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4))));

/**
 * Where the reader is: the end of the latest run of heard words found in the script, looking
 * a little ahead of the current place (never jumping back). Returns the index of the next word.
 */
export function followPosition(words: string[], heard: string, current: number, lookAhead = 40): number {
  const said = heard.split(/\s+/).map(foldWord).filter(Boolean).slice(-6);
  if (!said.length) return current;
  for (let run = Math.min(3, said.length); run >= 1; run--) {
    const tail = said.slice(-run);
    let best = -1;
    for (let i = Math.max(0, current - 2); i + run <= Math.min(words.length, current + lookAhead); i++) {
      if (tail.every((word, k) => near(words[i + k], word))) best = i + run;
    }
    // One word alone only moves forward a little (common words repeat).
    if (best >= 0 && (run > 1 || best - current <= 4)) return Math.max(current, best);
  }
  return current;
}

/** Roughly how long reading takes, at a comfortable pace. */
export const readingSeconds = (text: string, wordsPerMinute = 140) => Math.round((wordCount(spoken(text)) / wordsPerMinute) * 60);

export const isArabicScript = (text: string) => /[؀-ۿ]/.test(text.slice(0, 400));
