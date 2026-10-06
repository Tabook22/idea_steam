/** An AI answer as paragraphs and bullet points, with citations such as [2] split out. */
export type AnswerPart = { text: string } | { cite: number };
export type AnswerBlock = { kind: "p" | "li"; parts: AnswerPart[] };

const CITE = /\[(\d+(?:\s*[,،]\s*\d+)*)\]/g;

export function answerParts(line: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let last = 0;
  for (const match of line.matchAll(CITE)) {
    if (match.index! > last) parts.push({ text: line.slice(last, match.index) });
    for (const n of match[1].split(/[,،]/)) parts.push({ cite: Number(n.trim()) });
    last = match.index! + match[0].length;
  }
  if (last < line.length) parts.push({ text: line.slice(last) });
  // Markdown emphasis is shown as plain text; a space before a citation is dropped.
  return parts
    .map((part) => ("text" in part ? { text: part.text.replace(/\*\*|__|`/g, "") } : part))
    .map((part, index, all) => ("text" in part && "cite" in (all[index + 1] ?? {}) ? { text: part.text.replace(/\s+$/, "") } : part))
    .filter((part) => !("text" in part) || part.text.length > 0);
}

export function answerBlocks(answer: string): AnswerBlock[] {
  return answer
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !/^#+\s*$/.test(line))
    .map((line) => {
      const bullet = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
      const text = (bullet ? bullet[1] : line).replace(/^#+\s+/, "");
      return { kind: bullet ? "li" : "p", parts: answerParts(text) } as AnswerBlock;
    });
}

export const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`;
};
