import { test } from "node:test";
import assert from "node:assert/strict";
import { NOTE, arrangeByTeam, boardSize, columnsFor, fit, focusZone, layout, noteColor, tilt, zones } from "../artifacts/idea-stream/src/lib/live-board.ts";
import { cleanColor, cleanSpot } from "../artifacts/api-server/src/lib/live.ts";

const apart = (a, b) => Math.abs(a.x - b.x) >= NOTE.w || Math.abs(a.y - b.y) >= NOTE.h;

test("each team has its own area, the host's last", () => {
  const areas = zones([2, 0, 1, 2, 3]);
  assert.deepEqual(areas.map((z) => z.team), [1, 2, 3, 0]);
  assert.ok(areas[1].x >= areas[0].x + areas[0].w, "areas side by side, not overlapping");
  assert.deepEqual([1, 2, 3, 8].map(columnsFor), [3, 2, 1, 1], "fewer teams, wider areas");
});

test("new notes go to the first free spot in their team's area, never on another note", () => {
  const notes = [
    { id: 1, team: 1, board: null }, { id: 2, team: 1, board: null }, { id: 3, team: 1, board: null },
    { id: 4, team: 2, board: null }, { id: 5, team: 1, board: { x: 40, y: 80 } }, // moved by hand onto team 1's first cell
  ];
  const { spots, zones: areas } = layout(notes, 2);
  assert.deepEqual(spots.get(5), { x: 40, y: 80 }, "a moved note stays where it was put");
  const all = [...spots.values()];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(apart(all[i], all[j]), `notes ${i} and ${j} overlap`);
  const team2 = areas.find((z) => z.team === 2);
  assert.ok(spots.get(4).x >= team2.x && spots.get(4).x < team2.x + team2.w, "team 2's note is in team 2's area");
  for (const id of [1, 2, 3]) assert.ok(spots.get(id).x < team2.x, "team 1's notes stay in team 1's area");
});

test("arrange by team tidies everything into columns, oldest first", () => {
  const notes = [{ id: 9, team: 1, board: { x: 3000, y: 3000 } }, { id: 3, team: 1, board: { x: 10, y: 10 } }, { id: 5, team: 2, board: null }];
  const spots = arrangeByTeam(notes, 2);
  assert.ok(spots.get(3).y <= spots.get(9).y && spots.get(3).x <= spots.get(9).x, "older first");
  assert.ok(spots.get(9).x < 1000, "the far-away note comes back");
  assert.ok(spots.get(5).x > spots.get(9).x);
});

test("the board grows with its notes, and fits a screen", () => {
  const size = boardSize([{ x: 2000, y: 1500 }], 2);
  assert.ok(size.w >= 2000 + NOTE.w && size.h >= 1500 + NOTE.h);
  const view = fit({ w: 2000, h: 1000 }, { w: 1000, h: 800 });
  assert.ok(view.scale <= 0.5 && view.scale > 0.4);
  assert.equal(fit({ w: 100, h: 100 }, { w: 2000, h: 2000 }).scale, 1.2, "never zoomed in too far");
});

test("a phone opens on one team's area at a readable size", () => {
  const [, team2] = zones([1, 2, 3]);
  const view = focusZone(team2, { w: 360 });
  assert.ok(view.scale >= 0.9, String(view.scale));
  const left = team2.x * view.scale + view.x;
  assert.ok(left > 0 && left < 60, "team 2's area starts at the left of the screen");
});

test("tilts are small and the same every time; colours fall back to yellow", () => {
  for (let id = 1; id < 200; id++) assert.ok(Math.abs(tilt(id)) <= 2.5);
  assert.equal(tilt(42), tilt(42));
  assert.equal(noteColor("pink").band, "#db2777");
  assert.equal(noteColor("nonsense").band, noteColor("yellow").band);
});

test("the server keeps colours and spots sensible", () => {
  assert.equal(cleanColor("blue"), "blue");
  assert.equal(cleanColor("<script>"), null);
  assert.deepEqual(cleanSpot(12.6, "40"), { x: 13, y: 40 });
  assert.deepEqual(cleanSpot(-5, 99999), { x: 0, y: 20000 });
  assert.equal(cleanSpot(null, 4), null);
  assert.equal(cleanSpot("x", 4), null);
});
