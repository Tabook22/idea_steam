import { useEffect, useRef, useState } from "react";
import { Check, Eraser, Highlighter, PenLine, Trash2, Undo2, X } from "lucide-react";

type Tool = "pen" | "marker" | "eraser";
type Paper = "plain" | "grid" | "lined";
type Stroke = { tool: Tool; color: string; width: number; points: Array<[number, number, number]> };

const COLORS = ["#111827", "#2563eb", "#dc2626", "#16a34a", "#ea580c", "#7c3aed"];
const SIZES = [2, 4, 8];

/**
 * A sheet to draw on with a finger or pen: pens, a highlighter, an eraser, undo, and plain, grid
 * or lined paper. Saves a PNG.
 */
export function SketchPad({ onSave, onClose, copy }: {
  onSave: (png: Blob) => void;
  onClose: () => void;
  copy: (en: string, ar: string) => string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const current = useRef<Stroke | null>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(SIZES[1]);
  const [paper, setPaper] = useState<Paper>("grid");
  const [count, setCount] = useState(0);

  const paint = (target = canvas.current, withPaper = true) => {
    if (!target) return;
    const ctx = target.getContext("2d")!;
    const ratio = target.width / target.clientWidth;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, target.width, target.height);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (withPaper && paper !== "plain") {
      ctx.strokeStyle = paper === "grid" ? "#e5e7eb" : "#dbeafe";
      ctx.lineWidth = 1;
      const step = paper === "grid" ? 24 : 32;
      ctx.beginPath();
      for (let y = step; y < target.clientHeight; y += step) { ctx.moveTo(0, y); ctx.lineTo(target.clientWidth, y); }
      if (paper === "grid") for (let x = step; x < target.clientWidth; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, target.clientHeight); }
      ctx.stroke();
    }
    for (const stroke of [...strokes.current, ...(current.current ? [current.current] : [])]) {
      if (!stroke.points.length) continue;
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = stroke.tool === "eraser" ? "#ffffff" : stroke.color;
      ctx.globalAlpha = stroke.tool === "marker" ? 0.35 : 1;
      if (stroke.tool === "eraser") ctx.globalCompositeOperation = "source-over";
      const points = stroke.points;
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) {
        const [x, y, pressure] = points[i];
        const [px, py] = points[i - 1];
        ctx.lineWidth = stroke.width * (stroke.tool === "pen" ? 0.6 + pressure * 0.8 : 1);
        ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo((px + x) / 2, (py + y) / 2);
      }
      if (points.length === 1) { ctx.fillStyle = ctx.strokeStyle as string; ctx.beginPath(); ctx.arc(points[0][0], points[0][1], stroke.width / 2, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
  };

  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const fit = () => {
      const ratio = window.devicePixelRatio || 1;
      target.width = Math.round(target.clientWidth * ratio);
      target.height = Math.round(target.clientHeight * ratio);
      paint();
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(target);
    return () => observer.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { paint(); }, [paper]); // eslint-disable-line react-hooks/exhaustive-deps

  const point = (event: React.PointerEvent<HTMLCanvasElement>): [number, number, number] => {
    const box = event.currentTarget.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top, event.pressure > 0 && event.pointerType === "pen" ? event.pressure : 0.5];
  };
  const down = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    current.current = { tool, color, width: tool === "marker" ? size * 4 : tool === "eraser" ? size * 5 : size, points: [point(event)] };
    paint();
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!current.current) return;
    current.current.points.push(point(event));
    paint();
  };
  const up = () => {
    if (!current.current) return;
    strokes.current.push(current.current);
    current.current = null;
    setCount(strokes.current.length);
    paint();
  };
  const undo = () => { strokes.current.pop(); setCount(strokes.current.length); paint(); };
  const clear = () => { strokes.current = []; setCount(0); paint(); };
  const save = () => {
    const target = canvas.current;
    if (!target || !strokes.current.length) { onClose(); return; }
    target.toBlob((blob) => { if (blob) onSave(blob); }, "image/png");
  };

  const button = (active: boolean) => `grid h-10 w-10 shrink-0 place-items-center rounded-xl ${active ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground hover:bg-secondary/80"}`;
  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-background text-foreground" role="dialog" aria-modal="true" aria-label={copy("Drawing", "رسم")}
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <button type="button" onClick={onClose} aria-label={copy("Close without saving", "أغلق دون حفظ")} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-secondary"><X size={19} /></button>
        <p className="flex-1 font-serif text-lg">{copy("Drawing", "رسم")}</p>
        <button type="button" onClick={undo} disabled={!count} aria-label={copy("Undo", "تراجع")} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-secondary disabled:opacity-30"><Undo2 size={18} /></button>
        <button type="button" onClick={clear} disabled={!count} aria-label={copy("Clear", "امسح الكل")} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-secondary disabled:opacity-30"><Trash2 size={18} /></button>
        <button type="button" onClick={save} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"><Check size={16} />{copy("Add", "أضف")}</button>
      </div>
      <div className="relative min-h-0 flex-1 bg-white">
        <canvas ref={canvas} className="absolute inset-0 h-full w-full touch-none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} />
      </div>
      <div className="flex items-center gap-2 overflow-x-auto border-t px-3 py-2.5">
        <button type="button" onClick={() => setTool("pen")} aria-pressed={tool === "pen"} aria-label={copy("Pen", "قلم")} className={button(tool === "pen")}><PenLine size={18} /></button>
        <button type="button" onClick={() => setTool("marker")} aria-pressed={tool === "marker"} aria-label={copy("Highlighter", "قلم تمييز")} className={button(tool === "marker")}><Highlighter size={18} /></button>
        <button type="button" onClick={() => setTool("eraser")} aria-pressed={tool === "eraser"} aria-label={copy("Eraser", "ممحاة")} className={button(tool === "eraser")}><Eraser size={18} /></button>
        <span className="mx-1 h-7 w-px shrink-0 bg-border" />
        {COLORS.map((value) => (
          <button key={value} type="button" onClick={() => { setColor(value); if (tool === "eraser") setTool("pen"); }} aria-label={value} aria-pressed={color === value}
            className={`h-8 w-8 shrink-0 rounded-full ring-offset-2 ring-offset-background ${color === value && tool !== "eraser" ? "ring-2 ring-foreground" : ""}`} style={{ background: value }} />
        ))}
        <span className="mx-1 h-7 w-px shrink-0 bg-border" />
        {SIZES.map((value) => (
          <button key={value} type="button" onClick={() => setSize(value)} aria-pressed={size === value} aria-label={copy(`Size ${value}`, `الحجم ${value}`)} className={button(size === value)}>
            <span className="rounded-full bg-current" style={{ width: value + 3, height: value + 3 }} />
          </button>
        ))}
        <span className="mx-1 h-7 w-px shrink-0 bg-border" />
        <select value={paper} onChange={(event) => setPaper(event.target.value as Paper)} aria-label={copy("Paper", "الورق")} className="h-10 shrink-0 rounded-xl border bg-background px-2 text-sm">
          <option value="grid">{copy("Grid", "مربعات")}</option>
          <option value="lined">{copy("Lined", "مسطّر")}</option>
          <option value="plain">{copy("Plain", "فارغ")}</option>
        </select>
      </div>
    </div>
  );
}
