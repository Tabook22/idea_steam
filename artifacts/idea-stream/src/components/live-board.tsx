import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CornerDownRight, EyeOff, Maximize2, MessageCircle, Minus, Plus } from "lucide-react";
import { appPath } from "@/lib/app-path";
import { teamColor, type LiveCard } from "@/lib/live-api";
import { NOTE, boardSize, fit, focusZone, layout, noteColor, tilt } from "@/lib/live-board";

type Copy = (en: string, ar: string) => string;
type View = { scale: number; x: number; y: number };

/**
 * The shared board: every note shared with everyone, as sticky notes pinned on a dotted wall, in
 * team areas. Drag the wall to look around, pinch or scroll to zoom, drag a note to move it (when
 * allowed), tap a note to open it.
 */
export function LiveBoard({ cards, teamCount, copy, canMove, onMove, onOpen, highlight = null, focusTeam = null, className = "", toolbar }: {
  cards: LiveCard[]; teamCount: number; copy: Copy; canMove: (card: LiveCard) => boolean;
  onMove: (card: LiveCard, spot: { x: number; y: number }) => void; onOpen: (card: LiveCard) => void;
  highlight?: number | null; className?: string; toolbar?: React.ReactNode;
  /** Open on this team's area (on a phone: your own team), rather than the whole board. */
  focusTeam?: number | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ scale: 0.6, x: 16, y: 16 });
  const fitted = useRef(false);
  // A note being dragged (or just dropped, until the server agrees) sits where the finger put it.
  const [moving, setMoving] = useState<Record<number, { x: number; y: number }>>({});
  const notes = useMemo(() => cards.map((card) => ({ id: card.id, team: card.author?.team ?? card.team ?? 0, board: moving[card.id] ?? card.board })), [cards, moving]);
  const { spots, zones } = useMemo(() => layout(notes, teamCount), [notes, teamCount]);
  const size = useMemo(() => boardSize(spots.values(), zones.length), [spots, zones.length]);
  useEffect(() => {
    // Drop the local spot once the server has it.
    setMoving((all) => {
      const next = { ...all };
      for (const card of cards) if (next[card.id] && card.board && Math.abs(card.board.x - next[card.id]!.x) < 2 && Math.abs(card.board.y - next[card.id]!.y) < 2) delete next[card.id];
      return Object.keys(next).length === Object.keys(all).length ? all : next;
    });
  }, [cards]);

  const fitAll = useCallback(() => {
    const rect = box.current?.getBoundingClientRect();
    if (rect) setView(fit(size, { w: rect.width, h: rect.height }));
  }, [size]);
  useLayoutEffect(() => {
    if (fitted.current || !box.current) return;
    fitted.current = true;
    const rect = box.current.getBoundingClientRect();
    const zone = focusTeam !== null ? zones.find((one) => one.team === focusTeam) : undefined;
    // Small screens open on one team's area; big ones show everything.
    if (zone && rect.width < 700) setView(focusZone(zone, { w: rect.width }));
    else fitAll();
  }, [fitAll, focusTeam, zones]);

  const zoomAt = (factor: number, cx?: number, cy?: number) => setView((v) => {
    const rect = box.current!.getBoundingClientRect();
    const px = cx ?? rect.width / 2, py = cy ?? rect.height / 2;
    const scale = Math.max(0.15, Math.min(2.5, v.scale * factor));
    return { scale, x: px - ((px - v.x) * scale) / v.scale, y: py - ((py - v.y) * scale) / v.scale };
  });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey || Math.abs(event.deltaY) > Math.abs(event.deltaX) * 2) zoomAt(Math.exp(-event.deltaY / 400), event.clientX - rect.left, event.clientY - rect.top);
      else setView((v) => ({ ...v, x: v.x - event.deltaX, y: v.y - event.deltaY }));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

  // Pointers: one on the wall pans, two pinch-zoom, one on a movable note drags it.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: "pan" | "pinch" | "note"; startX: number; startY: number; view: View; dist?: number; card?: LiveCard; from?: { x: number; y: number }; moved: boolean } | null>(null);
  const down = (event: React.PointerEvent, card?: LiveCard) => {
    (event.target as Element).setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: "pinch", startX: (a!.x + b!.x) / 2, startY: (a!.y + b!.y) / 2, view, dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), moved: true };
      return;
    }
    const spot = card ? spots.get(card.id) : undefined;
    gesture.current = card && spot
      ? { kind: "note", startX: event.clientX, startY: event.clientY, view, card, from: spot, moved: false }
      : { kind: "pan", startX: event.clientX, startY: event.clientY, view, moved: false };
    event.stopPropagation();
  };
  const move = (event: React.PointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const g = gesture.current;
    if (!g) return;
    const dx = event.clientX - g.startX, dy = event.clientY - g.startY;
    if (Math.hypot(dx, dy) > 5) g.moved = true;
    if (g.kind === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const rect = box.current!.getBoundingClientRect();
      const scale = Math.max(0.15, Math.min(2.5, g.view.scale * (Math.hypot(a!.x - b!.x, a!.y - b!.y) / g.dist!)));
      const cx = g.startX - rect.left, cy = g.startY - rect.top;
      setView({ scale, x: cx - ((cx - g.view.x) * scale) / g.view.scale, y: cy - ((cy - g.view.y) * scale) / g.view.scale });
    } else if (g.kind === "pan" || (g.kind === "note" && !canMove(g.card!))) {
      if (g.moved) setView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy });
    } else if (g.kind === "note" && g.moved) {
      setMoving((all) => ({ ...all, [g.card!.id]: { x: Math.max(0, g.from!.x + dx / view.scale), y: Math.max(0, g.from!.y + dy / view.scale) } }));
    }
  };
  const up = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    const g = gesture.current;
    if (pointers.current.size > 0) return;
    gesture.current = null;
    if (!g) return;
    if (g.kind === "note" && !g.moved) onOpen(g.card!);
    else if (g.kind === "note" && canMove(g.card!) && moving[g.card!.id]) onMove(g.card!, { x: Math.round(moving[g.card!.id]!.x), y: Math.round(moving[g.card!.id]!.y) });
  };

  const byId = new Map(cards.map((card) => [card.id, card]));
  return (
    <div className={`relative overflow-hidden rounded-3xl border bg-[#f4f6f9] dark:bg-slate-900 ${className}`} data-testid="board">
      <div ref={box} className="absolute inset-0 cursor-grab touch-none select-none active:cursor-grabbing"
        style={{ backgroundImage: "radial-gradient(circle, rgba(100,116,139,0.35) 1.2px, transparent 1.3px)", backgroundSize: `${22 * view.scale}px ${22 * view.scale}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
        onPointerDown={(event) => down(event)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <div className="absolute left-0 top-0 origin-top-left" style={{ width: size.w, height: size.h, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} dir="ltr">
          {zones.map((zone) => (
            <p key={zone.team} className="absolute flex items-center gap-2 text-[26px] font-black" style={{ left: zone.x, top: zone.y - 56, color: zone.team ? teamColor(zone.team) : "#64748b", opacity: highlight && highlight !== zone.team ? 0.3 : 1 }}>
              <span className="h-4 w-4 rounded-full" style={{ background: zone.team ? teamColor(zone.team) : "#94a3b8" }} />
              {zone.team ? copy(`Team ${zone.team}`, `الفريق ${zone.team}`) : copy("Host & others", "المضيف وآخرون")}
            </p>
          ))}
          {cards.map((card) => {
            const spot = spots.get(card.id)!;
            const team = card.author?.team ?? card.team ?? 0;
            return (
              <Note key={card.id} card={card} parent={card.parentId ? byId.get(card.parentId) : undefined} copy={copy} movable={canMove(card)}
                dim={!!highlight && highlight !== team} dragging={!!moving[card.id]}
                style={{ left: spot.x, top: spot.y }} onPointerDown={(event) => down(event, card)} />
            );
          })}
        </div>
      </div>
      {cards.length === 0 && <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 px-6 text-center text-muted-foreground">{copy("No notes on the board yet. Add the first one!", "لا ملاحظات على اللوحة بعد. أضف أول واحدة!")}</p>}
      <div className="absolute bottom-3 end-3 flex items-center gap-1 rounded-full border bg-card/95 p-1 shadow-md backdrop-blur">
        {toolbar}
        <button type="button" onClick={() => zoomAt(1 / 1.25)} className="grid h-9 w-9 place-items-center rounded-full hover:bg-secondary" aria-label={copy("Zoom out", "تصغير")}><Minus size={16} /></button>
        <span className="w-11 text-center text-xs tabular-nums text-muted-foreground">{Math.round(view.scale * 100)}%</span>
        <button type="button" onClick={() => zoomAt(1.25)} className="grid h-9 w-9 place-items-center rounded-full hover:bg-secondary" aria-label={copy("Zoom in", "تكبير")}><Plus size={16} /></button>
        <button type="button" onClick={fitAll} className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-sm font-medium hover:bg-secondary" aria-label={copy("Show the whole board", "اعرض اللوحة كاملة")}><Maximize2 size={15} />{copy("All", "الكل")}</button>
      </div>
    </div>
  );
}

/** One sticky note: a pin, the paper in its colour, who posted it (and their team), the words. */
function Note({ card, parent, copy, movable, dim, dragging, style, onPointerDown }: {
  card: LiveCard; parent?: LiveCard; copy: Copy; movable: boolean; dim: boolean; dragging: boolean; style: React.CSSProperties; onPointerDown: (event: React.PointerEvent) => void;
}) {
  const color = noteColor(card.color);
  const team = card.author?.team ?? null;
  const reactions = card.reactions.filter((reaction) => reaction.count > 0);
  return (
    <article data-note={card.id} onPointerDown={onPointerDown} role="button" tabIndex={0} aria-label={card.text || copy("A photo", "صورة")}
      className={`absolute flex flex-col rounded-[6px] px-4 pb-3 pt-5 text-slate-900 transition-[box-shadow,opacity] ${movable ? "cursor-move" : "cursor-pointer"} ${dragging ? "z-20 shadow-2xl" : "shadow-[0_6px_14px_-6px_rgba(15,23,42,0.35)]"} ${card.hidden ? "opacity-50" : dim ? "opacity-30" : ""}`}
      style={{ ...style, width: NOTE.w, height: NOTE.h, background: color.paper, borderTop: `6px solid ${color.band}`, transform: `rotate(${dragging ? 0 : tilt(card.id)}deg)` }}>
      {/* The pin. */}
      <span className="absolute -top-[15px] left-1/2 grid h-6 w-6 -translate-x-1/2 place-items-center rounded-full bg-slate-700 shadow-md ring-[3px] ring-white" aria-hidden="true"><span className="h-2 w-2 rounded-full bg-white/80" /></span>
      <div className="flex items-center gap-1.5 text-[13px]">
        <span className="text-lg leading-none">{card.author?.emoji ?? "📣"}</span>
        <span dir="auto" className="min-w-0 flex-1 truncate font-bold">{card.author?.name ?? copy("Host", "المضيف")}</span>
        {team && <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold text-white" style={{ background: teamColor(team) }}>{copy(`Team ${team}`, `الفريق ${team}`)}</span>}
      </div>
      {parent && <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-slate-500"><CornerDownRight size={11} className="shrink-0" /><span dir="auto" className="truncate">{parent.text}</span></p>}
      {card.media?.type.startsWith("image/") ? (
        <img src={appPath(card.media.url, import.meta.env.BASE_URL)} alt="" draggable={false} className="mt-1.5 min-h-0 flex-1 rounded object-cover" />
      ) : null}
      {card.text && <p dir="auto" className={`mt-1.5 min-h-0 whitespace-pre-wrap text-[15px] leading-snug ${card.media ? "line-clamp-2" : "line-clamp-5"}`}>{card.text}</p>}
      <div className="mt-auto flex items-center gap-2 pt-1.5 text-[12px] font-semibold text-slate-600">
        {reactions.map((reaction) => <span key={reaction.emoji}>{reaction.emoji} {reaction.count}</span>)}
        {card.comments.length > 0 && <span className="inline-flex items-center gap-0.5"><MessageCircle size={12} />{card.comments.length}</span>}
        {(card.votes ?? 0) > 0 && <span className="text-pink-700">● {card.votes}</span>}
        {card.myVote && card.votes === null && <span className="text-pink-700">● {copy("your dot", "نقطتك")}</span>}
        {card.hidden && <span className="ms-auto inline-flex items-center gap-0.5 text-slate-500"><EyeOff size={12} />{copy("hidden", "مخفية")}</span>}
      </div>
    </article>
  );
}
