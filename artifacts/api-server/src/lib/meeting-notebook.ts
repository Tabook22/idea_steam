/**
 * The meeting notebook on the server: checking what the app sends (sizes, numbers, this app's
 * own files), its words for the minutes, and reading handwriting from page pictures.
 */
import { aiConfigured, openai } from "@workspace/integrations-openai-ai-server";
import { readStoredFile } from "./audio-edit";
import { cleanNoteHtml, plain } from "./meeting-notes";
import { canonicalStorageUrl } from "./stored-transcription";

export const PAGE_W = 800;
export const PAGE_H = 1131;
const PAPERS = new Set(["lined", "blank", "dots", "grid"]);
const COLORS = new Set(["white", "cream", "gray", "mint", "sky", "rose", "night"]);
const STORED = /\/api\/storage\/objects\/[a-f0-9-]{36}$/;
const HEX = /^#[0-9a-f]{3,8}$/i;

export type NotebookStroke = { id: string; tool: "pen" | "marker"; color: string; width: number; points: Array<[number, number, number]> };
export type NotebookItem = { id: string; kind: "text" | "image" | "video" | "audio"; x: number; y: number; w: number; h: number; html?: string; size?: number; color?: string; url?: string; name?: string; mimeType?: string };
export type NotebookPage = {
  id: string; paper: string; color: string; rev: number; strokes: NotebookStroke[]; items: NotebookItem[];
  snapshot?: { url: string; rev: number }; handwriting?: string; handwritingRev?: number;
};
export type Notebook = { version: 1; pages: NotebookPage[] };

const num = (value: unknown, min: number, max: number, fallback = min) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const id = (value: unknown) => (typeof value === "string" && value.length > 0 ? value.slice(0, 64) : null);
const stored = (value: unknown) => (typeof value === "string" ? canonicalStorageUrl(value).match(STORED)?.[0] ?? null : null);
const object = (value: unknown) => (value && typeof value === "object" ? (value as Record<string, unknown>) : null);

/** The notebook as sent, checked. Media still only on a phone (no stored URL) is left out. */
export function cleanNotebook(raw: unknown): Notebook | null {
  const doc = object(raw);
  if (!doc || !Array.isArray(doc.pages)) return null;
  const pages: NotebookPage[] = [];
  for (const entry of doc.pages.slice(0, 200)) {
    const page = object(entry);
    const pageId = id(page?.id);
    if (!page || !pageId) continue;
    const strokes: NotebookStroke[] = [];
    for (const value of (Array.isArray(page.strokes) ? page.strokes : []).slice(0, 5000)) {
      const stroke = object(value);
      if (!stroke || !Array.isArray(stroke.points)) continue;
      const points = stroke.points.slice(0, 5000)
        .filter((point): point is number[] => Array.isArray(point) && point.length >= 2)
        .map((point) => [num(point[0], -50, PAGE_W + 50), num(point[1], -50, PAGE_H + 50), num(point[2], 0, 1, 0.5)] as [number, number, number]);
      if (!points.length) continue;
      strokes.push({
        id: id(stroke.id) ?? `s${strokes.length}`,
        tool: stroke.tool === "marker" ? "marker" : "pen",
        color: typeof stroke.color === "string" && HEX.test(stroke.color) ? stroke.color : "#111827",
        width: num(stroke.width, 0.5, 60, 3),
        points,
      });
    }
    const items: NotebookItem[] = [];
    for (const value of (Array.isArray(page.items) ? page.items : []).slice(0, 200)) {
      const item = object(value);
      const itemId = id(item?.id);
      const kind = item?.kind;
      if (!item || !itemId || (kind !== "text" && kind !== "image" && kind !== "video" && kind !== "audio")) continue;
      const box = { x: num(item.x, -PAGE_W, PAGE_W), y: num(item.y, -PAGE_H, PAGE_H), w: num(item.w, 20, PAGE_W * 2, 200), h: num(item.h, 20, PAGE_H * 2, 100) };
      if (kind === "text") {
        const html = cleanNoteHtml(typeof item.html === "string" ? item.html : "");
        if (!plain(html)) continue;
        items.push({ id: itemId, kind, ...box, html, size: num(item.size, 8, 120, 22), ...(typeof item.color === "string" && HEX.test(item.color) ? { color: item.color } : {}) });
      } else {
        const url = stored(item.url);
        if (!url) continue;
        items.push({ id: itemId, kind, ...box, url, name: typeof item.name === "string" ? item.name.slice(0, 200) : undefined, mimeType: typeof item.mimeType === "string" ? item.mimeType.slice(0, 120) : undefined });
      }
    }
    const snapshot = object(page.snapshot);
    const snapshotUrl = stored(snapshot?.url);
    pages.push({
      id: pageId,
      paper: typeof page.paper === "string" && PAPERS.has(page.paper) ? page.paper : "lined",
      color: typeof page.color === "string" && COLORS.has(page.color) ? page.color : "white",
      rev: Math.round(num(page.rev, 0, 1e9, 0)),
      strokes,
      items,
      ...(snapshotUrl ? { snapshot: { url: snapshotUrl, rev: Math.round(num(snapshot?.rev, 0, 1e9, 0)) } } : {}),
      ...(typeof page.handwriting === "string" && page.handwriting.trim() ? { handwriting: page.handwriting.slice(0, 20_000) } : {}),
      ...(typeof page.handwritingRev === "number" ? { handwritingRev: page.handwritingRev } : {}),
    });
  }
  return pages.length ? { version: 1, pages } : null;
}

/** Typed words and read handwriting, page by page. */
export function notebookText(notebook: Notebook | null | undefined) {
  if (!notebook) return "";
  return notebook.pages.map((page, index) => {
    const parts = [...page.items.filter((item) => item.kind === "text").map((item) => plain(item.html ?? "").replace(/\n/g, " / ")), page.handwriting?.trim()].filter(Boolean);
    return parts.length ? `Notebook page ${index + 1}: ${parts.join(" / ")}` : "";
  }).filter(Boolean).join("\n").slice(0, 30_000);
}

/** Pages with ink whose handwriting hasn't been read for their latest picture. */
export const pagesToRead = (notebook: Notebook | null | undefined) =>
  (notebook?.pages ?? []).filter((page) => page.strokes.length > 0 && page.snapshot && page.handwritingRev !== page.snapshot.rev);

const textModel = () => process.env.OPENAI_TEXT_MODEL || (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ? "gpt-5.6-luna" : "gpt-4.1-mini");

/**
 * Reads the handwriting on notebook pages from their pictures (AI vision), in place. Returns how
 * many pages were read. A page that can't be read is left for next time.
 */
export async function readHandwriting(notebook: Notebook) {
  if (!aiConfigured) return 0;
  let read = 0;
  for (const page of pagesToRead(notebook).slice(0, 40)) {
    try {
      const image = await readStoredFile(page.snapshot!.url);
      const response = await openai.chat.completions.create({
        model: textModel(),
        messages: [
          { role: "system", content: "You transcribe handwritten notes from a picture of a notebook page. Write exactly what is handwritten, in its own language (Arabic stays Arabic), keeping line breaks, lists and numbers. Ignore the page ruling. Describe any drawing or diagram in one short line in [brackets]. If nothing is handwritten, answer with nothing." },
          { role: "user", content: [
            { type: "text", text: "Transcribe this page." },
            { type: "image_url", image_url: { url: `data:image/png;base64,${image.toString("base64")}`, detail: "high" } },
          ] },
        ],
      }, { timeout: 90_000, maxRetries: 1 });
      page.handwriting = (response.choices[0]?.message?.content ?? "").trim().slice(0, 20_000) || undefined;
      page.handwritingRev = page.snapshot!.rev;
      read++;
    } catch (error) {
      console.warn("Notebook: couldn't read a page:", (error as Error).message);
    }
  }
  return read;
}
