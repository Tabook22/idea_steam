/**
 * Draws a draft's diagrams (concept map, steps, timeline, comparison, chart, key facts) from the
 * data the AI planned. Drawn by the app, so every label is exact and Arabic reads right to left.
 */

export type DiagramKind = "concept" | "steps" | "timeline" | "compare" | "chart" | "facts";
export type Palette = "bright" | "calm" | "print";
type Spec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const PALETTES: Record<Palette, { en: string; ar: string; bg: string; ink: string; soft: string; muted: string; colors: string[] }> = {
  bright: { en: "Bright", ar: "زاهية", bg: "#ffffff", ink: "#0f172a", soft: "#f1f5f9", muted: "#475569", colors: ["#2563eb", "#16a34a", "#f59e0b", "#db2777", "#7c3aed", "#0891b2", "#ea580c", "#4d7c0f"] },
  calm: { en: "Calm", ar: "هادئة", bg: "#fbfaf6", ink: "#1f2a2e", soft: "#efece4", muted: "#56636a", colors: ["#0f766e", "#1d4e89", "#b45309", "#9f1239", "#4338ca", "#3f6212", "#0e7490", "#7c2d12"] },
  print: { en: "Print", ar: "للطباعة", bg: "#ffffff", ink: "#111111", soft: "#f2f2f2", muted: "#444444", colors: ["#1f2937", "#4b5563", "#374151", "#6b7280", "#111827", "#52525b", "#3f3f46", "#27272a"] },
};

const W = 1600;
const SANS = `"DM Sans Variable", "IBM Plex Sans Arabic", system-ui, sans-serif`;
const SERIF = `"Playfair Display Variable", "Noto Naskh Arabic", Georgia, serif`;
const arabic = (text: string) => /[؀-ۿ]/.test(text);

type Ctx = CanvasRenderingContext2D;
const font = (ctx: Ctx, size: number, weight = 400, serif = false) => { ctx.font = `${weight} ${size}px ${serif ? SERIF : SANS}`; };

/** Lines of text that fit `width` (long words are broken). */
export function wrap(ctx: Ctx, text: string, width: number, maxLines = 99): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width) { line = next; continue; }
    if (line) lines.push(line);
    line = word;
    while (ctx.measureText(line).width > width && line.length > 1) {
      let cut = line.length - 1;
      while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > width) cut--;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].replace(/\s*\S*$/, "")}…`;
    return kept;
  }
  return lines;
}

/** Writes wrapped text in a box; `align` is the reading start, centre or end. Returns the height used. */
function write(ctx: Ctx, text: string, x: number, y: number, width: number, size: number, options: { weight?: number; color: string; align?: "start" | "center"; serif?: boolean; lineHeight?: number; maxLines?: number; draw?: boolean }) {
  font(ctx, size, options.weight ?? 400, options.serif);
  const lines = wrap(ctx, text, width, options.maxLines);
  const lineHeight = size * (options.lineHeight ?? 1.3);
  if (options.draw !== false) {
    const rtl = arabic(text);
    ctx.direction = rtl ? "rtl" : "ltr";
    ctx.fillStyle = options.color;
    ctx.textBaseline = "top";
    ctx.textAlign = options.align === "center" ? "center" : rtl ? "right" : "left";
    const at = options.align === "center" ? x + width / 2 : rtl ? x + width : x;
    lines.forEach((line, index) => ctx.fillText(line, at, y + index * lineHeight));
  }
  return lines.length * lineHeight;
}

function box(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
function tint(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}
function shadow(ctx: Ctx, on: boolean) {
  ctx.shadowColor = on ? "rgba(15, 23, 42, 0.12)" : "transparent";
  ctx.shadowBlur = on ? 24 : 0;
  ctx.shadowOffsetY = on ? 8 : 0;
}

type Pal = (typeof PALETTES)[Palette];
type Drawer = (ctx: Ctx, spec: Spec, pal: Pal, top: number, rtl: boolean) => number;

const concept: Drawer = (ctx, spec, pal, top) => {
  const branches: Array<{ label: string; items: string[] }> = spec.branches ?? [];
  const n = branches.length;
  const boxW = n > 4 ? 430 : 480;
  // Measure each branch box.
  const heights = branches.map((branch) => {
    let h = 28 + write(ctx, branch.label, 0, 0, boxW - 48, 36, { weight: 700, color: "", draw: false }) + 14;
    for (const item of branch.items) h += write(ctx, item, 0, 0, boxW - 76, 29, { color: "", draw: false }) + 10;
    return h + 18;
  });
  const tallest = Math.max(...heights, 120);
  const ry = 150 + tallest * 0.95, rx = 540;
  const cy = top + 40 + ry + tallest / 2 - 30;
  const cx = W / 2;
  const spots = branches.map((_, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const x = Math.min(W - 40 - boxW / 2, Math.max(40 + boxW / 2, cx + rx * Math.cos(angle)));
    return { x, y: cy + ry * Math.sin(angle), angle };
  });
  // Connections first, under the boxes.
  spots.forEach((spot, i) => {
    ctx.strokeStyle = tint(pal.colors[i % pal.colors.length], 0.35);
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(cx + (spot.x - cx) * 0.5, cy + (spot.y - cy) * 0.15, spot.x, spot.y);
    ctx.stroke();
  });
  branches.forEach((branch, i) => {
    const color = pal.colors[i % pal.colors.length];
    const h = heights[i];
    const x = spots[i].x - boxW / 2, y = spots[i].y - h / 2;
    shadow(ctx, true);
    ctx.fillStyle = "#ffffff";
    box(ctx, x, y, boxW, h, 26);
    ctx.fill();
    shadow(ctx, false);
    ctx.fillStyle = tint(color, 0.88);
    box(ctx, x, y, boxW, h, 26);
    ctx.fill();
    // A coloured top edge, inside the rounded corners.
    ctx.save();
    box(ctx, x, y, boxW, h, 26);
    ctx.clip();
    ctx.fillStyle = color;
    ctx.fillRect(x, y, boxW, 10);
    ctx.restore();
    let at = y + 26;
    at += write(ctx, branch.label, x + 24, at, boxW - 48, 36, { weight: 700, color, align: "center" }) + 14;
    for (const item of branch.items) {
      const rtl = arabic(item);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(rtl ? x + boxW - 34 : x + 34, at + 18, 7, 0, Math.PI * 2);
      ctx.fill();
      at += write(ctx, item, rtl ? x + 24 : x + 52, at, boxW - 76, 29, { color: pal.ink }) + 10;
    }
  });
  // The main idea in the middle.
  font(ctx, 38, 700, true);
  const lines = wrap(ctx, spec.center, 330, 3);
  const ch = lines.length * 48 + 56, cw = 420;
  shadow(ctx, true);
  const gradient = ctx.createLinearGradient(cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2);
  gradient.addColorStop(0, pal.ink);
  gradient.addColorStop(1, tint(pal.ink, 0.25));
  ctx.fillStyle = gradient;
  box(ctx, cx - cw / 2, cy - ch / 2, cw, ch, ch / 2 > 70 ? 48 : ch / 2);
  ctx.fill();
  shadow(ctx, false);
  write(ctx, spec.center, cx - 175, cy - ch / 2 + 28, 350, 38, { weight: 700, color: "#ffffff", align: "center", serif: true, maxLines: 3, lineHeight: 1.26 });
  return cy + ry + tallest / 2 + 40;
};

/** Steps and timeline: numbered stations on a line, with cards. */
const stations = (timeline: boolean): Drawer => (ctx, spec, pal, top, rtl) => {
  const entries: Array<{ title: string; detail?: string; when?: string }> = timeline ? spec.events ?? [] : spec.steps ?? [];
  const n = entries.length;
  const margin = 70, col = (W - margin * 2) / n;
  const cardW = Math.min(col - 22, 420);
  const lineY = top + 90;
  const order = (i: number) => (rtl ? n - 1 - i : i);
  const cardHeights = entries.map((entry) => 36
    + (timeline && entry.when ? write(ctx, entry.when, 0, 0, cardW - 36, 26, { weight: 700, color: "", draw: false }) + 8 : 0)
    + write(ctx, entry.title, 0, 0, cardW - 36, 28, { weight: 700, color: "", draw: false })
    + (entry.detail ? 10 + write(ctx, entry.detail, 0, 0, cardW - 36, 23, { color: "", draw: false }) : 0) + 24);
  const tallest = Math.max(...cardHeights);
  // The line with an arrow at the end.
  ctx.strokeStyle = tint(pal.ink, 0.75);
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(margin, lineY);
  ctx.lineTo(W - margin, lineY);
  ctx.stroke();
  ctx.fillStyle = tint(pal.ink, 0.75);
  ctx.beginPath();
  if (rtl) { ctx.moveTo(margin - 18, lineY); ctx.lineTo(margin + 6, lineY - 16); ctx.lineTo(margin + 6, lineY + 16); }
  else { ctx.moveTo(W - margin + 18, lineY); ctx.lineTo(W - margin - 6, lineY - 16); ctx.lineTo(W - margin - 6, lineY + 16); }
  ctx.fill();
  entries.forEach((entry, i) => {
    const color = pal.colors[i % pal.colors.length];
    const cx = margin + col * order(i) + col / 2;
    // Station.
    shadow(ctx, true);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, lineY, 38, 0, Math.PI * 2);
    ctx.fill();
    shadow(ctx, false);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 5;
    ctx.stroke();
    font(ctx, 34, 700);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.direction = "ltr";
    ctx.fillText(String(i + 1), cx, lineY + 2);
    // Card with a little pointer up to the station.
    const x = cx - cardW / 2, y = lineY + 74, h = cardHeights[i];
    ctx.fillStyle = tint(color, 0.86);
    ctx.beginPath();
    ctx.moveTo(cx - 16, y + 1);
    ctx.lineTo(cx, y - 16);
    ctx.lineTo(cx + 16, y + 1);
    ctx.fill();
    box(ctx, x, y, cardW, h, 22);
    ctx.fill();
    let at = y + 20;
    if (timeline && entry.when) at += write(ctx, entry.when, x + 18, at, cardW - 36, 26, { weight: 700, color, align: "center" }) + 8;
    at += write(ctx, entry.title, x + 18, at, cardW - 36, 28, { weight: 700, color: pal.ink, align: "center" });
    if (entry.detail) write(ctx, entry.detail, x + 18, at + 10, cardW - 36, 23, { color: pal.muted, align: "center" });
  });
  return lineY + 74 + tallest + 60;
};

const compare: Drawer = (ctx, spec, pal, top, rtl) => {
  const columns: string[] = spec.columns ?? [];
  const rows: Array<{ label: string; values: string[] }> = spec.rows ?? [];
  const margin = 80, labelW = 330, gap = 14;
  const valueW = (W - margin * 2 - labelW - gap * columns.length) / columns.length;
  // Cells from the reading start: label first, then each column.
  const cellX = (index: number) => {
    const x = index === 0 ? 0 : labelW + gap + (index - 1) * (valueW + gap);
    const w = index === 0 ? labelW : valueW;
    return rtl ? W - margin - x - w : margin + x;
  };
  let y = top + 10;
  const headH = 24 + Math.max(...columns.map((column) => write(ctx, column, 0, 0, valueW - 40, 30, { weight: 700, color: "", draw: false }))) + 24;
  columns.forEach((column, i) => {
    const color = pal.colors[i % pal.colors.length];
    const x = cellX(i + 1);
    shadow(ctx, true);
    ctx.fillStyle = color;
    box(ctx, x, y, valueW, headH, 20);
    ctx.fill();
    shadow(ctx, false);
    write(ctx, column, x + 20, y + 24, valueW - 40, 30, { weight: 700, color: "#ffffff", align: "center" });
  });
  y += headH + 12;
  rows.forEach((row, r) => {
    const h = 26 + Math.max(
      write(ctx, row.label, 0, 0, labelW - 40, 27, { weight: 700, color: "", draw: false }),
      ...row.values.map((value) => write(ctx, value, 0, 0, valueW - 40, 25, { color: "", draw: false })),
    ) + 26;
    ctx.fillStyle = r % 2 ? pal.bg : pal.soft;
    box(ctx, margin, y, W - margin * 2, h, 18);
    ctx.fill();
    write(ctx, row.label, cellX(0) + 20, y + 26, labelW - 40, 27, { weight: 700, color: pal.ink });
    row.values.forEach((value, i) => {
      const x = cellX(i + 1);
      ctx.fillStyle = tint(pal.colors[i % pal.colors.length], 0.9);
      box(ctx, x + 6, y + 8, valueW - 12, h - 16, 14);
      ctx.fill();
      write(ctx, value || "—", x + 20, y + 26, valueW - 40, 25, { color: pal.ink, align: "center" });
    });
    y += h + 10;
  });
  return y + 40;
};

const number = (value: number) => (Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 }));

const chart: Drawer = (ctx, spec, pal, top, rtl) => {
  const data: Array<{ label: string; value: number }> = spec.data ?? [];
  const unit: string = spec.unit ?? "";
  const show = (value: number) => (unit === "%" ? `${number(value)}%` : unit ? `${number(value)} ${unit}` : number(value));
  if (spec.type === "pie") {
    const total = data.reduce((sum, point) => sum + point.value, 0) || 1;
    const cx = rtl ? W - 420 : 420, cy = top + 330, r = 270;
    let angle = -Math.PI / 2;
    data.forEach((point, i) => {
      const slice = (point.value / total) * Math.PI * 2;
      ctx.fillStyle = pal.colors[i % pal.colors.length];
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, angle, angle + slice);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = pal.bg;
      ctx.lineWidth = 6;
      ctx.stroke();
      angle += slice;
    });
    ctx.fillStyle = pal.bg;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.52, 0, Math.PI * 2);
    ctx.fill();
    write(ctx, show(total), cx - 120, cy - 26, 240, 44, { weight: 700, color: pal.ink, align: "center" });
    const legendX = rtl ? 90 : 820, legendW = W - 820 - 90;
    let y = top + 330 - (data.length * 86) / 2;
    data.forEach((point, i) => {
      const color = pal.colors[i % pal.colors.length];
      const rowRtl = arabic(point.label);
      ctx.fillStyle = color;
      box(ctx, rowRtl ? legendX + legendW - 34 : legendX, y + 6, 34, 34, 9);
      ctx.fill();
      write(ctx, point.label, rowRtl ? legendX : legendX + 52, y, legendW - 52, 30, { weight: 600, color: pal.ink, maxLines: 1 });
      write(ctx, `${show(point.value)} · ${Math.round((point.value / total) * 100)}%`, rowRtl ? legendX : legendX + 52, y + 40, legendW - 52, 24, { color: pal.muted, maxLines: 1 });
      y += 86;
    });
    return Math.max(top + 330 + r + 60, y + 30);
  }
  const max = Math.max(...data.map((point) => point.value), 1);
  const labelW = 400, margin = 80, barArea = W - margin * 2 - labelW - 40 - 200;
  let y = top + 20;
  data.forEach((point, i) => {
    const color = pal.colors[i % pal.colors.length];
    const h = 64;
    const length = Math.max(8, (point.value / max) * barArea);
    const labelX = rtl ? W - margin - labelW : margin;
    write(ctx, point.label, labelX, y + 14, labelW, 28, { weight: 600, color: pal.ink, maxLines: 1 });
    const barX = rtl ? W - margin - labelW - 40 - length : margin + labelW + 40;
    ctx.fillStyle = tint(color, 0.85);
    box(ctx, rtl ? W - margin - labelW - 40 - barArea : margin + labelW + 40, y + 6, barArea, h - 12, 14);
    ctx.fill();
    const gradient = ctx.createLinearGradient(barX, 0, barX + length, 0);
    gradient.addColorStop(rtl ? 1 : 0, color);
    gradient.addColorStop(rtl ? 0 : 1, tint(color, 0.25));
    ctx.fillStyle = gradient;
    box(ctx, barX, y + 6, length, h - 12, 14);
    ctx.fill();
    font(ctx, 28, 700);
    ctx.fillStyle = pal.ink;
    ctx.textBaseline = "middle";
    ctx.direction = "ltr";
    ctx.textAlign = rtl ? "right" : "left";
    ctx.fillText(show(point.value), rtl ? barX - 16 : barX + length + 16, y + h / 2);
    y += h + 22;
  });
  return y + 40;
};

const facts: Drawer = (ctx, spec, pal, top) => {
  const list: Array<{ icon: string; value: string; label: string }> = spec.facts ?? [];
  const n = list.length;
  const cols = n <= 3 ? n : n === 4 ? 2 : 3;
  const margin = 80, gap = 30;
  const cardW = (W - margin * 2 - gap * (cols - 1)) / cols;
  const heights = list.map((fact) => 40 + 80 + 14 + write(ctx, fact.value, 0, 0, cardW - 60, 54, { weight: 800, color: "", draw: false }) + 10 + write(ctx, fact.label, 0, 0, cardW - 60, 26, { color: "", draw: false }) + 36);
  let y = top + 10;
  for (let row = 0; row * cols < n; row++) {
    const indexes = list.map((_, i) => i).slice(row * cols, row * cols + cols);
    const h = Math.max(...indexes.map((i) => heights[i]));
    const rowW = indexes.length * cardW + (indexes.length - 1) * gap;
    indexes.forEach((i, k) => {
      const fact = list[i];
      const color = pal.colors[i % pal.colors.length];
      const x = (W - rowW) / 2 + k * (cardW + gap);
      shadow(ctx, true);
      ctx.fillStyle = "#ffffff";
      box(ctx, x, y, cardW, h, 30);
      ctx.fill();
      shadow(ctx, false);
      ctx.fillStyle = tint(color, 0.88);
      box(ctx, x, y, cardW, h, 30);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(x + cardW / 2, y + 80, 52, 0, Math.PI * 2);
      ctx.fill();
      font(ctx, 56);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = pal.ink;
      ctx.fillText(fact.icon || "•", x + cardW / 2, y + 84);
      let at = y + 40 + 80 + 14;
      at += write(ctx, fact.value, x + 30, at, cardW - 60, 54, { weight: 800, color, align: "center" }) + 10;
      write(ctx, fact.label, x + 30, at, cardW - 60, 26, { color: pal.ink, align: "center" });
    });
    y += h + gap;
  }
  return y + 30;
};

const DRAWERS: Record<DiagramKind, Drawer> = { concept, steps: stations(false), timeline: stations(true), compare, chart, facts };

/** Fonts the diagrams use, ready before drawing (canvas doesn't wait for them). */
async function fontsReady() {
  try {
    await Promise.all(["400 24px", "700 30px", "800 54px"].map((weight) => document.fonts.load(`${weight} "DM Sans Variable"`)).concat(
      ["400 24px", "700 30px"].map((weight) => document.fonts.load(`${weight} "IBM Plex Sans Arabic"`)),
      [document.fonts.load(`700 54px "Playfair Display Variable"`), document.fonts.load(`700 54px "Noto Naskh Arabic"`)],
    ));
  } catch { /* falls back to system fonts */ }
}

/** The diagram as a canvas: title on top, the drawing below, cropped to its height. */
export async function renderDiagram(kind: DiagramKind, spec: Spec, title: string, palette: Palette = "bright") {
  await fontsReady();
  const pal = PALETTES[palette];
  const words = JSON.stringify(spec) + title;
  const rtl = (words.match(/[؀-ۿ]/g)?.length ?? 0) > (words.match(/[A-Za-z]/g)?.length ?? 0) / 2;
  const tall = document.createElement("canvas");
  tall.width = W;
  tall.height = 2600;
  const ctx = tall.getContext("2d")!;
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, tall.height);
  // Title and a short accent rule.
  const titleH = write(ctx, title, 140, 64, W - 280, 54, { weight: 700, color: pal.ink, align: "center", serif: true, maxLines: 2, lineHeight: 1.2 });
  ctx.fillStyle = pal.colors[0];
  box(ctx, W / 2 - 50, 64 + titleH + 18, 100, 8, 4);
  ctx.fill();
  const bottom = Math.min(tall.height, Math.ceil(DRAWERS[kind](ctx, spec, pal, 64 + titleH + 70, rtl)));
  const out = document.createElement("canvas");
  out.width = W;
  out.height = Math.max(600, bottom);
  const final = out.getContext("2d")!;
  final.fillStyle = pal.bg;
  final.fillRect(0, 0, W, out.height);
  final.drawImage(tall, 0, 0);
  return out;
}

export const canvasPng = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("png"))), "image/png"));
