import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanMarks, joinMarks, parseChapters, remapMarks, transcriptSegments } from "../artifacts/api-server/src/lib/audio-marks.ts";

test("bookmarks are cleaned: valid, sorted, no double taps, inside the recording", () => {
  assert.deepEqual(cleanMarks([12.34, 3, 3.2, "x", -1, 99], 60), [3, 12.3]);
  assert.deepEqual(cleanMarks("nope"), []);
});

test("after a cut, marks move with the kept audio and marks in the cut are dropped", () => {
  // 0–4 and 6–10 kept (4–6 cut): a mark at 5 is gone, 7 becomes 5.
  assert.deepEqual(remapMarks([1, 5, 7], [{ start: 0, end: 4 }, { start: 6, end: 10 }]), [1, 5]);
});

test("after a join, marks shift by the length of earlier recordings", () => {
  assert.deepEqual(joinMarks([{ marks: [2], duration: 10 }, { marks: [1, 4], duration: 6 }]), [2, 11, 14]);
});

test("words are grouped into sentences with start times", () => {
  const words = [
    { word: "First", start: 0, end: 0.4 }, { word: "idea.", start: 0.5, end: 0.9 },
    { word: "Then", start: 3, end: 3.3 }, { word: "this", start: 3.4, end: 3.6 },
    { word: "بعد", start: 6, end: 6.3 }, { word: "ذلك؟", start: 6.4, end: 6.8 },
  ];
  assert.deepEqual(transcriptSegments(words), [
    { start: 0, text: "First idea." }, { start: 3, text: "Then this" }, { start: 6, text: "بعد ذلك؟" },
  ]);
});

test("AI chapters are validated: ordered, inside the recording, first at 0:00, short titles", () => {
  const parsed = parseChapters({
    summary: "  Three ideas about learning. ",
    chapters: [{ start: 40, title: "Journals" }, { start: 3, title: "Intro" }, { start: 42, title: "too close" },
      { start: 500, title: "past the end" }, { start: "90", title: "  Assessment   design " }, { start: 60, title: "" }],
  }, 120);
  assert.deepEqual(parsed, { summary: "Three ideas about learning.", chapters: [
    { start: 0, title: "Intro" }, { start: 40, title: "Journals" }, { start: 90, title: "Assessment design" }] });
  assert.equal(parseChapters("garbage", 60), null);
});
