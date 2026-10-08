/**
 * The meeting notebook: pages you write on by hand (pen, highlighter) or type on, with images,
 * video and audio placed on the page. Pages are A4-shaped, 800 × 1131 units; everything is
 * stored in those units so it looks the same on any screen.
 */

export const PAGE_W = 800;
export const PAGE_H = 1131;

export type Paper = "lined" | "blank" | "dots" | "grid";
export type PageColor = "white" | "cream" | "gray" | "mint" | "sky" | "rose" | "night";
export type Point = [number, number, number];
export type Stroke = { id: string; tool: "pen" | "marker"; color: string; width: number; points: Point[] };
export type PageItem = {
  id: string;
  kind: "text" | "image" | "video" | "audio";
  x: number; y: number; w: number; h: number;
  html?: string;
  /** Text size in page units (text boxes). */
  size?: number;
  color?: string;
  url?: string;
  name?: string;
  mimeType?: string;
  /** The file is still only on this device. */
  pending?: boolean;
};
export type NotebookPage = {
  id: string;
  paper: Paper;
  color: PageColor;
  strokes: Stroke[];
  items: PageItem[];
  /** Changes since the picture of the page was last made. */
  rev: number;
  /** A picture of the page (for the notebook entry, PDF and reading handwriting). */
  snapshot?: { url?: string; pending?: boolean; rev: number };
  /** Handwriting read as text. */
  handwriting?: string;
};
export type MeetingNotebookDoc = { version: 1; pages: NotebookPage[] };

export const PAGE_COLORS: Record<PageColor, { paper: string; line: string; ink: string; en: string; ar: string }> = {
  white: { paper: "#ffffff", line: "#dbe3ee", ink: "#111827", en: "White", ar: "أبيض" },
  cream: { paper: "#fbf6e9", line: "#e7dcc0", ink: "#1f2937", en: "Cream", ar: "كريمي" },
  gray: { paper: "#f3f4f6", line: "#d6dae0", ink: "#111827", en: "Gray", ar: "رمادي" },
  mint: { paper: "#eefaf3", line: "#cfe8da", ink: "#14532d", en: "Mint", ar: "نعناعي" },
  sky: { paper: "#eef6fd", line: "#cfe2f3", ink: "#1e3a8a", en: "Sky", ar: "سماوي" },
  rose: { paper: "#fdf0f3", line: "#f1d3dc", ink: "#4c0519", en: "Rose", ar: "وردي" },
  night: { paper: "#1c2430", line: "#2f3b4b", ink: "#f8fafc", en: "Night", ar: "ليلي" },
};

export const INKS = ["#111827", "#1d4ed8", "#dc2626", "#15803d", "#ea580c", "#7c3aed", "#f8fafc"];
export const MARKERS = ["#fde047", "#86efac", "#93c5fd", "#f9a8d4", "#fdba74"];

export const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const newPage = (paper: Paper = "lined", color: PageColor = "white"): NotebookPage =>
  ({ id: uid("p"), paper, color, strokes: [], items: [], rev: 0 });

export const newNotebook = (paper: Paper = "lined", color: PageColor = "white"): MeetingNotebookDoc => ({ version: 1, pages: [newPage(paper, color)] });

/** Paper with its ruling, in page units (the context is already scaled). */
export function drawPaper(ctx: CanvasRenderingContext2D, paper: Paper, color: PageColor) {
  const theme = PAGE_COLORS[color];
  ctx.fillStyle = theme.paper;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.strokeStyle = theme.line;
  ctx.fillStyle = theme.line;
  ctx.lineWidth = 1.2;
  if (paper === "lined") {
    ctx.beginPath();
    for (let y = 120; y < PAGE_H - 40; y += 40) { ctx.moveTo(40, y); ctx.lineTo(PAGE_W - 40, y); }
    ctx.stroke();
    // The margin line of a notebook page.
    ctx.strokeStyle = color === "night" ? "#7f1d1d" : "#fca5a5";
    ctx.beginPath(); ctx.moveTo(110, 40); ctx.lineTo(110, PAGE_H - 40); ctx.stroke();
  } else if (paper === "grid") {
    ctx.beginPath();
    for (let y = 40; y < PAGE_H; y += 32) { ctx.moveTo(0, y); ctx.lineTo(PAGE_W, y); }
    for (let x = 32; x < PAGE_W; x += 32) { ctx.moveTo(x, 0); ctx.lineTo(x, PAGE_H); }
    ctx.stroke();
  } else if (paper === "dots") {
    for (let y = 40; y < PAGE_H; y += 32) for (let x = 32; x < PAGE_W; x += 32) { ctx.beginPath(); ctx.arc(x, y, 1.7, 0, Math.PI * 2); ctx.fill(); }
  }
}

/** One stroke, smoothed, with the pen's width following pressure. */
export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const points = stroke.points;
  if (!points.length) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  if (stroke.tool === "marker") { ctx.globalAlpha = 0.38; ctx.globalCompositeOperation = "multiply"; }
  if (points.length === 1) {
    ctx.beginPath(); ctx.arc(points[0][0], points[0][1], stroke.width / 2, 0, Math.PI * 2); ctx.fill();
  } else if (stroke.tool === "marker") {
    // A highlighter is one even stroke (no overlapping darker joints).
    ctx.lineWidth = stroke.width;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.stroke();
  } else {
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = points[i - 2] ?? points[i - 1];
      const [x1, y1, pressure] = points[i - 1];
      const [x2, y2] = points[i];
      ctx.lineWidth = stroke.width * (0.55 + pressure * 0.9);
      ctx.beginPath();
      ctx.moveTo((x0 + x1) / 2, (y0 + y1) / 2);
      ctx.quadraticCurveTo(x1, y1, (x1 + x2) / 2, (y1 + y2) / 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Paper and ink of a page, at a scale (1 = page units). */
export function drawPage(ctx: CanvasRenderingContext2D, page: NotebookPage, scale: number, extra?: Stroke | null) {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawPaper(ctx, page.paper, page.color);
  for (const stroke of page.strokes) drawStroke(ctx, stroke);
  if (extra) drawStroke(ctx, extra);
}

/** Strokes touched by the eraser at a point (within `radius` page units of any of their points). */
export function strokesAt(strokes: Stroke[], x: number, y: number, radius: number) {
  const hit = new Set<string>();
  for (const stroke of strokes) {
    const reach = radius + stroke.width / 2;
    for (let i = 0; i < stroke.points.length; i++) {
      const [px, py] = stroke.points[i];
      const [qx, qy] = stroke.points[i + 1] ?? stroke.points[i];
      if (distanceToSegment(x, y, px, py, qx, qy) <= reach) { hit.add(stroke.id); break; }
    }
  }
  return hit;
}

function distanceToSegment(x: number, y: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0;
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

/** A stroke's points, rounded to keep the notebook small. */
export const compactPoints = (points: Point[]): Point[] =>
  points.filter((point, index) => index === 0 || index === points.length - 1 || Math.hypot(point[0] - points[index - 1][0], point[1] - points[index - 1][1]) >= 0.6)
    .map(([x, y, p]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(p * 100) / 100]);

export const pageHasContent = (page: NotebookPage) => page.strokes.length > 0 || page.items.length > 0;

/** Typed words on the pages (and handwriting already read), for search and the minutes. */
export function notebookText(doc: MeetingNotebookDoc | null | undefined) {
  if (!doc) return "";
  return doc.pages.map((page, index) => {
    const typed = page.items.filter((item) => item.kind === "text").map((item) => (item.html ?? "").replace(/<\/(p|div|li)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ").trim()).filter(Boolean);
    const parts = [...typed, page.handwriting?.trim()].filter(Boolean);
    return parts.length ? `Page ${index + 1}: ${parts.join(" / ")}` : "";
  }).filter(Boolean).join("\n");
}

/**
 * A PDF made of page pictures (JPEG), one picture per A4 page. Small and dependency-free: each
 * page is an image drawn full-page.
 */
export function pdfFromJpegs(pages: Array<{ jpeg: Uint8Array; width: number; height: number }>): Blob {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: Uint8Array | string) => { const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk; parts.push(bytes); length += bytes.length; };
  const object = (id: number, body: () => void) => { offsets[id] = length; push(`${id} 0 obj\n`); body(); push("\nendobj\n"); };
  const W = 595.28, H = 841.89;
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const pageIds = pages.map((_, index) => 3 + index * 3);
  object(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
  object(2, () => push(`<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`));
  pages.forEach((page, index) => {
    const pageId = pageIds[index], imageId = pageId + 1, contentId = pageId + 2;
    object(pageId, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im${index} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`));
    object(imageId, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`);
      push(page.jpeg);
      push("\nendstream");
    });
    const draw = `q ${W} 0 0 ${H} 0 0 cm /Im${index} Do Q`;
    object(contentId, () => push(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`));
  });
  const xref = length;
  const count = 3 + pages.length * 3;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) push(`${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return new Blob([out], { type: "application/pdf" });
}
