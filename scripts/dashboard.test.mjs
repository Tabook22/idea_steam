import { test } from "node:test";
import assert from "node:assert/strict";
import { lastDays, localDay, pickForDay, plainSnippet, streak } from "../artifacts/api-server/src/lib/dashboard.ts";

test("days follow the person's time zone, not the server's", () => {
  const lateEvening = new Date("2026-10-06T22:30:00Z");
  assert.equal(localDay(lateEvening, 0), "2026-10-06");
  assert.equal(localDay(lateEvening, 240), "2026-10-07", "already the 7th in UTC+4");
  assert.equal(localDay(lateEvening, -300), "2026-10-06");
});

test("the last 35 days end today, oldest first", () => {
  const days = lastDays(new Date("2026-10-07T08:00:00Z"), 240, 35);
  assert.equal(days.length, 35);
  assert.equal(days.at(-1), "2026-10-07");
  assert.equal(days[0], "2026-09-03");
});

test("a streak counts days in a row, and isn't broken until a whole day is missed", () => {
  const days = ["d1", "d2", "d3", "d4", "d5"];
  assert.equal(streak(new Set(["d3", "d4", "d5"]), days), 3);
  assert.equal(streak(new Set(["d2", "d3", "d4"]), days), 3, "nothing yet today: still counts to yesterday");
  assert.equal(streak(new Set(["d1", "d2", "d3"]), days), 0);
  assert.equal(streak(new Set(), days), 0);
});

test("the idea brought back stays the same all day, and 'Another' moves on", () => {
  const items = ["a", "b", "c", "d"];
  assert.equal(pickForDay(items, "2026-10-07"), pickForDay(items, "2026-10-07"));
  assert.notEqual(pickForDay(items, "2026-10-07", 0), pickForDay(items, "2026-10-07", 1));
  assert.equal(pickForDay([], "2026-10-07"), null);
});

test("snippets are plain text without markup", () => {
  assert.equal(plainSnippet("<!--idea-stream-rich-text--><p>Assessment should <b>reward</b> curiosity , not memory.</p>"), "Assessment should reward curiosity, not memory.");
  assert.equal(plainSnippet("x".repeat(200), 10), "xxxxxxxxxx…");
  assert.equal(plainSnippet("   "), null);
});
