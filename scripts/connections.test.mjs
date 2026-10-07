import { test } from "node:test";
import assert from "node:assert/strict";
import { bestFit, centroid, groupBySimilarity, isoWeek, parseDigest, relatedTo, sourceVectors } from "../artifacts/api-server/src/lib/connections.ts";

const rows = [
  { source: "recording", sourceId: 1, embedding: [1, 0, 0] },
  { source: "recording", sourceId: 1, embedding: [0.8, 0.2, 0] },
  { source: "recording", sourceId: 2, embedding: [0.9, 0.1, 0] },
  { source: "idea", sourceId: 7, embedding: [0, 1, 0] },
  { source: "idea", sourceId: 8, embedding: [0.1, 0.95, 0] },
  { source: "recording", sourceId: 3, embedding: [0, 0, 1] },
  { source: "recording", sourceId: 4, embedding: null },
];

test("each item gets one vector: the average of its passages", () => {
  const vectors = sourceVectors(rows);
  assert.equal(vectors.size, 5, "items without embeddings are left out");
  const one = vectors.get("recording:1");
  assert.ok(Math.abs(Math.hypot(...one) - 1) < 1e-9);
});

test("related items are the closest ones, skipping the item itself and excluded ones", () => {
  const vectors = sourceVectors(rows);
  assert.deepEqual(relatedTo("recording:1", vectors).map((r) => r.key), ["recording:2"]);
  assert.deepEqual(relatedTo("idea:7", vectors).map((r) => r.key), ["idea:8"]);
  assert.deepEqual(relatedTo("idea:7", vectors, { exclude: new Set(["idea:8"]) }), []);
  assert.deepEqual(relatedTo("recording:99", vectors), []);
});

test("recordings about the same thing are grouped; loners are not", () => {
  const vectors = sourceVectors(rows);
  const groups = groupBySimilarity(["recording:1", "recording:2", "recording:3", "recording:4"], vectors);
  assert.deepEqual(groups.map((g) => [...g].sort()), [["recording:1", "recording:2"]]);
});

test("a recording is matched to the notebook it fits best, if it fits well enough", () => {
  const notebooks = [{ id: 1, vector: centroid([[0, 1, 0], [0.1, 0.9, 0]]) }, { id: 2, vector: [1, 0, 0] }];
  assert.equal(bestFit([0.05, 1, 0], notebooks).id, 1);
  assert.equal(bestFit([0, 0, 1], notebooks), null);
});

test("weeks are ISO weeks (one digest per week)", () => {
  assert.equal(isoWeek("2026-10-07"), "2026-W41");
  assert.equal(isoWeek("2026-10-11"), "2026-W41", "Sunday is still the same week");
  assert.equal(isoWeek("2026-10-12"), "2026-W42");
  assert.equal(isoWeek("2027-01-01"), "2026-W53");
});

test("the digest is checked: notebooks it names must exist", () => {
  const digest = parseDigest({
    headline: "A week of noticing small things.",
    themes: [{ title: "Noticing", summary: "Journals and commutes." }, { title: "", summary: "x" }],
    questions: ["How do we assess curiosity?", 5],
    ready: [{ subjectId: 1, reason: "Six ideas on lessons." }, { subjectId: 99, reason: "Not real." }],
    nudge: "Outline the first lesson.",
  }, new Set([1, 2]));
  assert.equal(digest.themes.length, 1);
  assert.deepEqual(digest.questions, ["How do we assess curiosity?"]);
  assert.deepEqual(digest.ready, [{ subjectId: 1, reason: "Six ideas on lessons." }]);
  assert.equal(parseDigest({ themes: [] }, new Set()), null, "no headline, no digest");
});
