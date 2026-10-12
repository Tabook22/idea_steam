/**
 * Formatted text (from the app's editor) on the server: made safe before it's stored, and turned
 * into plain text for everything that reads words (search, Ask, AI, exports).
 */
import sanitizeHtml from "sanitize-html";

const length = /^[\d.]+(px|em|rem|%)$/;
const lengthOrAuto = /^(auto|0|[\d.]+(px|em|rem|%))$/;

/** Only the editor's own formatting: no scripts, no foreign styles, links open safely. */
export function cleanRichHtml(html: string) {
  return sanitizeHtml(html, {
    allowedTags: [
      "p", "br", "hr", "h1", "h2", "h3", "strong", "b", "em", "i", "u", "s",
      "strike", "ul", "ol", "li", "blockquote", "a", "img", "span", "div", "font", "mark",
    ],
    allowedAttributes: {
      "*": ["dir", "style"],
      a: ["href", "target", "rel"],
      img: ["src", "alt"],
      font: ["face", "size", "color"],
    },
    allowedStyles: {
      "*": {
        "text-align": [/^(left|right|center|justify)$/],
        color: [/^#[0-9a-f]{3,8}$/i, /^rgb\([\d\s,.%]+\)$/i],
        "background-color": [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s,.%]+\)$/i],
        "font-family": [/^[\w\s,'"-]+$/],
        "font-size": [length, /^[\d.]+pt$/],
        width: [length],
        "max-width": [length],
        height: [/^(auto|[\d.]+(px|em|rem|%))$/],
        display: [/^(block|inline|inline-block)$/],
        float: [/^(left|right|none)$/],
        margin: [/^[\d.]+(px|em|rem|%)(\s+(auto|[\d.]+(px|em|rem|%))){0,3}$/],
        "margin-top": [lengthOrAuto],
        "margin-right": [lengthOrAuto],
        "margin-bottom": [lengthOrAuto],
        "margin-left": [lengthOrAuto],
      },
    },
    allowedSchemes: ["http", "https"],
    allowedSchemesByTag: { img: ["http", "https"] },
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attribs) => ({ tagName: "a", attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" } }),
    },
  });
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", "#39": "'", nbsp: " " };

/** The words of formatted text, keeping its paragraphs and list items as lines. */
export function richToPlain(html: string) {
  return html
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|h[1-6]|li|blockquote|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name: string) => ENTITIES[name] ?? "")
    .replace(/[ \t ]+/g, " ")
    .split("\n").map((line) => line.trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Is this formatted text still the same words as the plain text? (Something may have changed the plain text since.) */
export const sameWords = (html: string, plain: string) =>
  richToPlain(html).replace(/\s+/g, " ").trim() === plain.replace(/\s+/g, " ").trim();
