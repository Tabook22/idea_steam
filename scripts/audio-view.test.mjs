import { test } from "node:test";
import assert from "node:assert/strict";
import { clampView, panBy, rulerTicks, viewAround, zoomAt } from "../artifacts/idea-stream/src/lib/audio-view.ts";

const near = (a, b) => Math.abs(a - b) < 1e-6;

test("zooming keeps the moment under the cursor in the same place", () => {
  const view = zoomAt({ start: 0, end: 60 }, 4, 45, 60); // cursor at 75% of the window
  assert.ok(near(view.end - view.start, 15));
  assert.ok(near((45 - view.start) / (view.end - view.start), 0.75), JSON.stringify(view));
});

test("zoom never goes past the recording or below a quarter second", () => {
  assert.deepEqual(zoomAt({ start: 0, end: 10 }, 0.1, 5, 10), { start: 0, end: 10 }, "zoom out stops at the whole recording");
  const deep = zoomAt({ start: 4, end: 5 }, 100, 4.5, 10);
  assert.ok(near(deep.end - deep.start, 0.25));
});

test("panning stays inside the recording", () => {
  assert.deepEqual(panBy({ start: 50, end: 60 }, 30, 60), { start: 50, end: 60 });
  assert.deepEqual(panBy({ start: 10, end: 20 }, -15, 60), { start: 0, end: 10 });
  assert.deepEqual(clampView({ start: -5, end: 100 }, 60), { start: 0, end: 60 });
});

test("zoom to a section adds a small margin", () => {
  const view = viewAround({ start: 10, end: 20 }, 60);
  assert.ok(near(view.start, 8.5) && near(view.end, 21.5));
});

test("ruler ticks use nice steps for the zoom level", () => {
  assert.deepEqual(rulerTicks({ start: 0, end: 60 }, 600), [0, 10, 20, 30, 40, 50, 60]);
  assert.deepEqual(rulerTicks({ start: 12.3, end: 13.3 }, 600), [12.4, 12.6, 12.8, 13, 13.2]);
});
