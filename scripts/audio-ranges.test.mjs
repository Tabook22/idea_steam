import { test } from "node:test";
import assert from "node:assert/strict";
import { keptRanges, mergeRanges, nextAudible, totalLength } from "../artifacts/idea-stream/src/lib/audio-ranges.ts";

test("overlapping or touching cuts merge, and are clipped to the recording", () => {
  assert.deepEqual(mergeRanges([{ start: 5, end: 8 }, { start: 2, end: 4 }, { start: 3.5, end: 6 }, { start: 9, end: 30 }], 10),
    [{ start: 2, end: 8 }, { start: 9, end: 10 }]);
  assert.deepEqual(mergeRanges([{ start: 4, end: 2 }], 10), [{ start: 2, end: 4 }], "backwards selection is normalised");
});

test("kept parts are the complement of the cuts", () => {
  assert.deepEqual(keptRanges([{ start: 4, end: 6 }], 10), [{ start: 0, end: 4 }, { start: 6, end: 10 }]);
  assert.deepEqual(keptRanges([{ start: 0, end: 3 }, { start: 7, end: 10 }], 10), [{ start: 3, end: 7 }], "keep only a selection");
  assert.deepEqual(keptRanges([{ start: 0, end: 10 }], 10), [], "everything removed");
  assert.equal(totalLength(keptRanges([{ start: 1, end: 2 }, { start: 5, end: 5.5 }], 10)), 8.5);
});

test("preview skips removed parts", () => {
  const removed = [{ start: 2, end: 4 }, { start: 4, end: 5 }];
  assert.equal(nextAudible(1, removed, 10), 1);
  assert.equal(nextAudible(2.5, removed, 10), 5);
  assert.equal(nextAudible(9.99, removed, 10), null);
});
