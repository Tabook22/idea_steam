/**
 * The shared board: sticky notes on a dotted wall. Each team has its own area (columns side by
 * side); a new note goes to the first free spot in its team's area; the host can tidy everything
 * into team columns. Positions are board units (a note is NOTE.w × NOTE.h).
 */

export const NOTE = { w: 230, h: 190 };
const GAP = 28;
const ZONE_GAP = 90;
const TOP = 70;
/** Note columns per team area: wide areas for one or two teams, one column each when there are more (bigger notes on screen). */
export const columnsFor = (areas: number) => (areas <= 1 ? 3 : areas === 2 ? 2 : 1);
export const zoneWidth = (cols: number) => cols * NOTE.w + (cols - 1) * GAP;

export type BoardNote = { id: number; team: number; board: { x: number; y: number } | null };
export type Spot = { x: number; y: number };

export const NOTE_COLORS = {
  yellow: { paper: "#fef9c3", band: "#f59e0b", en: "Yellow", ar: "أصفر" },
  pink: { paper: "#fce7f3", band: "#db2777", en: "Pink", ar: "وردي" },
  blue: { paper: "#dbeafe", band: "#2563eb", en: "Blue", ar: "أزرق" },
  green: { paper: "#dcfce7", band: "#16a34a", en: "Green", ar: "أخضر" },
  orange: { paper: "#ffedd5", band: "#ea580c", en: "Orange", ar: "برتقالي" },
  purple: { paper: "#ede9fe", band: "#7c3aed", en: "Purple", ar: "بنفسجي" },
} as const;
export type NoteColor = keyof typeof NOTE_COLORS;
export const noteColor = (color: string | null | undefined) => NOTE_COLORS[(color as NoteColor) in NOTE_COLORS ? (color as NoteColor) : "yellow"];

/** A small fixed tilt per note (degrees), like paper pinned by hand. */
export function tilt(id: number) {
  const h = Math.sin(id * 12.9898) * 43758.5453;
  return Math.round((h - Math.floor(h) - 0.5) * 5 * 10) / 10;
}

/** The teams' areas, left to right (team 0: the host and people without a team, last). */
export function zones(teams: number[]) {
  const order = [...new Set(teams)].sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b));
  const cols = columnsFor(order.length), w = zoneWidth(cols);
  return order.map((team, i) => ({ team, x: GAP + i * (w + ZONE_GAP), y: TOP, w, cols }));
}

const overlaps = (a: Spot, b: Spot) => Math.abs(a.x - b.x) < NOTE.w + 8 && Math.abs(a.y - b.y) < NOTE.h + 8;

/** Where every note sits: its own spot, or (if it has none) the first free spot in its team's area. */
export function layout(notes: BoardNote[], teamCount: number) {
  const teams = [...Array.from({ length: teamCount }, (_, i) => i + 1), ...notes.map((note) => note.team)];
  const areas = zones(teams);
  const placed = new Map<number, Spot>();
  for (const note of notes) if (note.board) placed.set(note.id, note.board);
  const taken = [...placed.values()];
  for (const note of notes) {
    if (placed.has(note.id)) continue;
    const area = areas.find((zone) => zone.team === note.team) ?? areas[0]!;
    for (let cell = 0; cell < 2000; cell++) {
      const spot = { x: area.x + (cell % area.cols) * (NOTE.w + GAP), y: area.y + Math.floor(cell / area.cols) * (NOTE.h + GAP) };
      if (!taken.some((other) => overlaps(spot, other))) { placed.set(note.id, spot); taken.push(spot); break; }
    }
  }
  return { spots: placed, zones: areas };
}

/** Everything tidied into team columns, oldest first (what "Arrange by team" sends). */
export function arrangeByTeam(notes: BoardNote[], teamCount: number) {
  return layout(notes.map((note) => ({ ...note, board: null })).sort((a, b) => a.id - b.id), teamCount).spots;
}

/** The board's size: big enough for every note, and never smaller than the team areas. */
export function boardSize(spots: Iterable<Spot>, zoneCount: number) {
  let w = GAP + Math.max(1, zoneCount) * (zoneWidth(columnsFor(zoneCount)) + ZONE_GAP), h = TOP + 2 * (NOTE.h + GAP);
  for (const spot of spots) { w = Math.max(w, spot.x + NOTE.w + GAP * 2); h = Math.max(h, spot.y + NOTE.h + GAP * 2); }
  return { w, h };
}

/** The zoom and offset that show one team's area across the view (readable on a phone). */
export function focusZone(zone: { x: number; w: number }, view: { w: number }) {
  const scale = Math.max(0.3, Math.min(1, (view.w - 24) / (zone.w + 40)));
  return { scale: Math.round(scale * 1000) / 1000, x: Math.round(12 - (zone.x - 20) * scale), y: 12 };
}

/** The zoom and offset that fit the whole board in a view, with a margin. */
export function fit(board: { w: number; h: number }, view: { w: number; h: number }, max = 1.2) {
  const scale = Math.max(0.15, Math.min(max, (view.w - 32) / board.w, (view.h - 32) / board.h));
  return { scale: Math.round(scale * 1000) / 1000, x: Math.round((view.w - board.w * scale) / 2), y: 16 };
}
