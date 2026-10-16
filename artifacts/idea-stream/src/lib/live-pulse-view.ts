/** Workshop Pulse, the drawing rules: where each team sits, and how lively it is. */

export type RoomStatus = "active" | "quiet" | "waiting";

/** Active: something in the last 2 minutes. Quiet: in the last 10. Waiting: nothing since. */
export function roomStatus(lastAt: string | undefined, now: number): RoomStatus {
  if (!lastAt) return "waiting";
  const ago = now - Date.parse(lastAt);
  return ago < 2 * 60_000 ? "active" : ago < 10 * 60_000 ? "quiet" : "waiting";
}

/** Tile size (percent of the area): the biggest that leaves a gap between every pair of teams. */
export function tileSize(count: number) {
  if (count <= 1) return { w: 46, h: 62 };
  for (let w = 27; w > 8; w -= 0.5) {
    const size = { w, h: Math.round(w * 1.2 * 10) / 10 };
    const spots = ring(count, size);
    const clear = spots.every((a, i) => spots.every((b, j) => j <= i || Math.abs(a.x - b.x) >= size.w + 1 || Math.abs(a.y - b.y) >= size.h + 1.5));
    if (clear) return size;
  }
  return { w: 8, h: 10 };
}

function ring(count: number, size: { w: number; h: number }) {
  const rx = 50 - size.w / 2 - 0.5, ry = 50 - size.h / 2 - 0.5;
  const start = count === 2 ? Math.PI : -Math.PI / 2;
  return Array.from({ length: count }, (_, i) => {
    const angle = start + (i * 2 * Math.PI) / count;
    return { x: Math.round((50 + rx * Math.cos(angle)) * 100) / 100, y: Math.round((50 + ry * Math.sin(angle)) * 100) / 100 };
  });
}

/**
 * Teams around an ellipse (percent coordinates of each tile's centre), the first at the top and
 * going clockwise; two teams sit left and right. Lines between any two cross the open middle.
 */
export function ringLayout(count: number) {
  if (count <= 0) return [];
  if (count === 1) return [{ x: 50, y: 50 }];
  return ring(count, tileSize(count));
}

/**
 * Where a line's badge goes: its middle, or the nearest point along it that isn't on a team tile
 * (tiles are w × h around each spot; the badge needs a little room around it).
 */
export function badgeSpot(a: { x: number; y: number }, b: { x: number; y: number }, spots: Array<{ x: number; y: number }>, size: { w: number; h: number }) {
  const onTile = (x: number, y: number) => spots.some((spot) => Math.abs(spot.x - x) < size.w / 2 + 2 && Math.abs(spot.y - y) < size.h / 2 + 2.5);
  for (const shift of [0, 0.05, -0.05, 0.1, -0.1, 0.15, -0.15, 0.2, -0.2, 0.25, -0.25]) {
    const t = 0.5 + shift;
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    if (!onTile(x, y)) return { x, y };
  }
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** "now", "45s", "3m", "1h". */
export function ago(at: string, now: number) {
  const seconds = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  if (seconds < 10) return "now";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

/** The order of the auto tour: the overview, then teams with the freshest activity first. */
export function tourOrder(teams: number[], lastActivity: Record<string, string>) {
  return [0, ...[...teams].sort((a, b) => (lastActivity[b] ?? "").localeCompare(lastActivity[a] ?? "") || a - b)];
}
