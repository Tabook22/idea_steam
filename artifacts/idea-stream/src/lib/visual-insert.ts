/**
 * Putting visuals into a draft (rich text HTML): each goes after the paragraph it belongs to (found
 * by a few of its words), centred, with its caption under it. Taken out again by its picture URL.
 */

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const loose = (value: string) => value
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&[a-z#0-9]+;/gi, " ")
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function figureHtml(visual: { url: string; title: string; caption: string }) {
  return `<p style="text-align: center"><img src="${escape(visual.url)}" alt="${escape(visual.title)}" style="max-width: 100%; height: auto"></p>`
    + (visual.caption ? `<p style="text-align: center"><em>${escape(visual.caption)}</em></p>` : "");
}

/** The draft's top-level blocks (paragraphs, headings, lists, quotes). */
function blocks(html: string) {
  const out: string[] = [];
  const pattern = /<(p|h[1-6]|ul|ol|blockquote|div)\b[^>]*>[\s\S]*?<\/\1>/gi;
  let last = 0;
  for (const match of html.matchAll(pattern)) {
    if (match.index! > last) out.push(html.slice(last, match.index));
    out.push(match[0]);
    last = match.index! + match[0].length;
  }
  if (last < html.length) out.push(html.slice(last));
  return out;
}

/** Which block a visual follows: the one with its anchor words, or the closest match; -1 for the end. */
export function anchorBlock(parts: string[], anchor: string) {
  const wanted = loose(anchor);
  if (!wanted) return -1;
  const exact = parts.findIndex((part) => loose(part).includes(wanted));
  if (exact >= 0) return exact;
  const words = wanted.split(" ");
  let best = -1, score = 0;
  parts.forEach((part, index) => {
    const have = new Set(loose(part).split(" "));
    const share = words.filter((word) => have.has(word)).length / words.length;
    if (share > score) { score = share; best = index; }
  });
  return score >= 0.6 ? best : -1;
}

export const hasVisual = (html: string, url: string) => html.includes(`src="${escape(url)}"`);

export function insertVisual(html: string, visual: { url: string; title: string; caption: string; anchor: string }) {
  if (hasVisual(html, visual.url)) return html;
  const parts = blocks(html);
  let at = anchorBlock(parts, visual.anchor);
  if (at < 0) return html + figureHtml(visual);
  // After any visuals already placed after that paragraph, so they keep their order.
  while (parts[at + 1] && /^<p[^>]*>\s*<img\b/i.test(parts[at + 1])) at += /^<p[^>]*>\s*<em>/i.test(parts[at + 2] ?? "") ? 2 : 1;
  parts.splice(at + 1, 0, figureHtml(visual));
  return parts.join("");
}

/** Takes a visual (and its caption) out of the draft. */
export function removeVisual(html: string, url: string) {
  const src = escape(url).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.replace(new RegExp(`<p[^>]*>\\s*<img\\b[^>]*src="${src}"[^>]*>\\s*</p>(\\s*<p[^>]*>\\s*<em>[\\s\\S]*?</em>\\s*</p>)?`, "i"), "");
}
