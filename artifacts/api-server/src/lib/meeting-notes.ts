/**
 * The meeting notepad: written notes (formatted text), photos, documents and drawings.
 * Notes are cleaned to safe formatting; files must be ones stored by this app.
 */
import sanitizeHtml from "sanitize-html";
import type { MeetingNote } from "@workspace/db";
import { canonicalStorageUrl } from "./stored-transcription";

const KINDS = new Set(["text", "photo", "file", "drawing"]);
const STORED = /\/api\/storage\/objects\/[a-f0-9-]{36}$/;

/** Formatting a note may keep: headings, emphasis, highlight, lists, quotes, links. */
export function cleanNoteHtml(html: string) {
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "div", "h1", "h2", "h3", "strong", "b", "em", "i", "u", "s", "mark", "ul", "ol", "li", "blockquote", "a", "span"],
    allowedAttributes: { a: ["href", "target", "rel"], "*": ["dir"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: { a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }) },
  }).slice(0, 100_000);
}

/** Notes as sent by the app, checked: known kinds, safe text, this app's own files only. */
export function cleanNotes(notes: Array<Partial<MeetingNote>>): MeetingNote[] {
  const seen = new Set<string>();
  const out: MeetingNote[] = [];
  for (const note of notes) {
    if (!note.id || seen.has(note.id) || !note.kind || !KINDS.has(note.kind)) continue;
    const base = {
      id: String(note.id).slice(0, 64),
      kind: note.kind,
      at: typeof note.at === "number" && Number.isFinite(note.at) && note.at >= 0 ? Math.round(note.at * 10) / 10 : null,
      createdAt: typeof note.createdAt === "string" && !Number.isNaN(Date.parse(note.createdAt)) ? note.createdAt : new Date().toISOString(),
    };
    if (note.kind === "text") {
      const html = cleanNoteHtml(note.html ?? "");
      if (!plain(html)) continue;
      out.push({ ...base, html });
    } else {
      // The app's own stored file, whatever base path (e.g. /ideas) is in front of it.
      const url = note.url ? canonicalStorageUrl(note.url).match(STORED)?.[0] ?? "" : "";
      if (!url) continue;
      out.push({ ...base, url, name: (note.name ?? "").slice(0, 200) || undefined, mimeType: (note.mimeType ?? "").slice(0, 120) || undefined,
        size: typeof note.size === "number" && note.size > 0 ? Math.round(note.size) : undefined });
    }
    seen.add(base.id);
  }
  return out.sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity) || a.createdAt.localeCompare(b.createdAt));
}

/** A note's words without formatting. */
export const plain = (html: string) => html.replace(/<\/(p|div|h[1-3]|li|blockquote)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .split("\n").map((line) => line.replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n");

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** What the note-taker wrote, for the minutes ("[12:04] …"), and what else they added. */
export function notesForMinutes(notes: MeetingNote[]) {
  const lines = notes.map((note) => {
    const at = note.at === null ? "" : `[${clock(note.at)}] `;
    if (note.kind === "text") return `${at}${plain(note.html ?? "").replace(/\n/g, " / ")}`;
    return `${at}(${note.kind === "photo" ? "photo" : note.kind === "drawing" ? "drawing" : "document"}${note.name ? `: ${note.name}` : ""})`;
  }).filter(Boolean);
  return lines.join("\n").slice(0, 20_000);
}

/** Notes as a section of the notebook entry. */
export function notesSection(notes: MeetingNote[], arabic: boolean) {
  const written = notes.filter((note) => note.kind === "text").map((note) => plain(note.html ?? "")).filter(Boolean);
  if (!written.length) return "";
  return [`📝 ${arabic ? "ملاحظاتي" : "My notes"}`, ...written.map((text) => text.split("\n").map((line) => `• ${line}`).join("\n"))].join("\n");
}

/** Photos, drawings and documents as attachments of the notebook entry. */
export function noteAttachments(notes: MeetingNote[]) {
  return notes.filter((note) => note.kind !== "text" && note.url).map((note) => ({
    type: (note.kind === "file" ? (note.mimeType === "application/pdf" ? "pdf" : "document") : "image") as "image" | "pdf" | "document",
    url: note.url!,
    name: note.name || (note.kind === "drawing" ? "Drawing" : note.kind === "photo" ? "Photo" : "Document"),
    ...(note.mimeType ? { mimeType: note.mimeType } : {}),
  }));
}
