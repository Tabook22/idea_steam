/** Notebook pages as pictures: for the notebook entry, reading handwriting, and the PDF. */
import { PAGE_COLORS, PAGE_H, PAGE_W, drawPage, pdfFromJpegs, type MeetingNotebookDoc, type NotebookPage, type PageItem } from "./notebook";

const loadImage = (src: string) => new Promise<HTMLImageElement | null>((resolve) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => resolve(null);
  image.src = src;
});

/** Lines of text that fit a width (for typed text boxes). */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > width && line) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

const plainText = (html: string) => html.replace(/<\/(p|div|li|h[1-3])>|<br\s*\/?>/gi, "\n").replace(/<li[^>]*>/gi, "• ").replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\n{3,}/g, "\n\n").trim();

async function drawItems(ctx: CanvasRenderingContext2D, page: NotebookPage, src: (item: PageItem) => string | undefined) {
  const ink = PAGE_COLORS[page.color].ink;
  for (const item of page.items) {
    if (item.kind === "image") {
      const url = src(item);
      const image = url ? await loadImage(url) : null;
      if (image) {
        const ratio = Math.min(item.w / image.width, item.h / image.height);
        const w = image.width * ratio, h = image.height * ratio;
        ctx.drawImage(image, item.x + (item.w - w) / 2, item.y + (item.h - h) / 2, w, h);
      }
    } else if (item.kind === "text") {
      const size = item.size ?? 22;
      ctx.fillStyle = item.color ?? ink;
      ctx.font = `${size}px "DM Sans Variable", "IBM Plex Sans Arabic", sans-serif`;
      ctx.textBaseline = "top";
      const text = plainText(item.html ?? "");
      ctx.direction = /[֐-ࣿ]/.test(text.slice(0, 30)) ? "rtl" : "ltr";
      const x = ctx.direction === "rtl" ? item.x + item.w : item.x;
      ctx.textAlign = ctx.direction === "rtl" ? "right" : "left";
      wrap(ctx, text, item.w).forEach((line, index) => ctx.fillText(line, x, item.y + index * size * 1.4));
      ctx.direction = "ltr";
      ctx.textAlign = "left";
    } else {
      // Video and audio: a labelled card (the picture can't play).
      ctx.fillStyle = "rgba(15, 23, 42, 0.08)";
      ctx.strokeStyle = "rgba(15, 23, 42, 0.25)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(item.x, item.y, item.w, Math.min(item.h, 120), 16);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = ink;
      ctx.font = `600 22px "DM Sans Variable", sans-serif`;
      ctx.textBaseline = "middle";
      ctx.fillText(`${item.kind === "video" ? "🎬" : "🎵"} ${item.name ?? item.kind}`.slice(0, 48), item.x + 20, item.y + Math.min(item.h, 120) / 2);
    }
  }
}

/** One page as a picture (PNG by default). */
export async function renderPageImage(page: NotebookPage, src: (item: PageItem) => string | undefined, { scale = 1.25, type = "image/png", quality = 0.9 } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(PAGE_W * scale);
  canvas.height = Math.round(PAGE_H * scale);
  const ctx = canvas.getContext("2d")!;
  drawPage(ctx, page, scale);
  await drawItems(ctx, page, src);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("render"))), type, quality));
}

/** The whole notebook as a PDF, one A4 page per notebook page. */
export async function notebookPdf(doc: MeetingNotebookDoc, src: (item: PageItem) => string | undefined) {
  const pages = [];
  for (const page of doc.pages) {
    const blob = await renderPageImage(page, src, { scale: 1.5, type: "image/jpeg", quality: 0.88 });
    pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: Math.round(PAGE_W * 1.5), height: Math.round(PAGE_H * 1.5) });
  }
  return pdfFromJpegs(pages);
}
