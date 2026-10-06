import { test } from "node:test";
import assert from "node:assert/strict";
import {
  citedNumbers,
  excerpt,
  ideaPassages,
  keywordScore,
  rank,
  recordingPassages,
  terms,
  textPassages,
  wordPassages,
} from "../artifacts/api-server/src/lib/ask.ts";

const timed = (text, gapAfter = {}) => {
  let t = 0;
  return text.split(" ").map((word, index) => {
    const entry = { word, start: t, end: t + 0.3 };
    t += 0.4 + (gapAfter[index] ?? 0);
    return entry;
  });
};

test("recordings are cut into passages that start at a sentence or a pause", () => {
  const sentence = Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ") + ".";
  const words = timed(`${sentence} ${sentence} ${sentence}`);
  const passages = wordPassages(words);
  assert.equal(passages.length, 3);
  assert.equal(passages[1].start, words[40].start);
  assert.ok(passages.every((p) => p.text.split(" ").length <= 90));
});

test("very long speech without punctuation is still cut at about 90 words", () => {
  const words = timed(Array.from({ length: 200 }, (_, i) => `w${i}`).join(" "));
  const passages = wordPassages(words);
  assert.equal(passages.length, 3);
  assert.equal(passages[0].text.split(" ").length, 90);
});

test("background music before the voice shifts the play-from time", () => {
  const words = timed("hello there this is a short note");
  const [passage] = recordingPassages({ id: 1, title: "Note", transcript: null, words, capturedAt: new Date("2026-10-01"), durationSeconds: 5, pre: 3 });
  assert.equal(passage.start, 3);
  assert.match(passage.header, /Recording: Note/);
  assert.match(passage.header, /2026-10-01/);
});

test("a recording with only text (no timings) is still searchable, without a time", () => {
  const passages = recordingPassages({ id: 2, title: null, transcript: "Budget for the spring workshop. Ask about the projector.", words: null, capturedAt: new Date(), durationSeconds: 9 });
  assert.equal(passages.length, 1);
  assert.equal(passages[0].start, null);
});

test("long text is split at sentence ends, about 700 characters each", () => {
  const sentence = "This is a sentence that has some words in it. ";
  const pieces = textPassages(sentence.repeat(40));
  assert.ok(pieces.length >= 2);
  assert.ok(pieces.every((piece) => piece.length <= 700 && piece.endsWith(".")));
});

test("ideas include notes and attachment text, but not the text of library recordings (indexed on their own)", () => {
  const [passage] = ideaPassages({
    id: 5, content: "<p>Workshop <b>plan</b></p>", subjectTitle: "التعليم", createdAt: new Date(),
    attachments: [
      { type: "audio", transcript: "from the library", libraryItemId: 9 },
      { type: "pdf", extractedText: "Room booking form" },
      { type: "image", note: "whiteboard photo" },
    ],
  });
  assert.match(passage.text, /Workshop plan/);
  assert.match(passage.text, /Room booking form/);
  assert.match(passage.text, /whiteboard photo/);
  assert.doesNotMatch(passage.text, /from the library/);
});

test("word matching treats Arabic spelling variants and the article ال as the same", () => {
  assert.deepEqual(terms("ماذا قلت عن الأسئلة المفتوحة؟"), ["اسئله", "مفتوحه"]);
  assert.equal(keywordScore(terms("الأسئلة المفتوحة"), "جرّب سؤالًا واحدًا من الاسئلة المفتوحه في كل اختبار"), 1);
  assert.equal(keywordScore(terms("What did I say about projectors?"), "Ask about the projector."), 1);
  assert.equal(keywordScore(terms("budget"), "nothing related here"), 0);
});

test("ranking prefers meaning, adds a boost for exact words, and limits passages per source", () => {
  const make = (sourceId, part, text, embedding) => ({ source: "recording", sourceId, part, start: part * 10, text, header: "", hash: "", embedding });
  const candidates = [
    make(1, 0, "the weather was nice", [0, 1]),
    make(2, 0, "assessment should reward curiosity", [1, 0]),
    make(2, 1, "one open question per test", [0.9, 0.1]),
    make(2, 2, "curiosity again", [0.95, 0.05]),
    make(2, 3, "and again curiosity", [0.97, 0.03]),
    make(3, 0, "assessment budget", [0.6, 0.8]),
  ];
  const best = rank("assessment ideas", candidates, [1, 0]);
  assert.equal(best[0].sourceId, 2);
  assert.equal(best.filter((p) => p.sourceId === 2).length, 3);
  assert.ok(!best.some((p) => p.sourceId === 1));
});

test("without embeddings, ranking falls back to words only", () => {
  const candidates = [
    { source: "idea", sourceId: 1, part: 0, start: null, text: "projector for the workshop", header: "", hash: "", embedding: null },
    { source: "idea", sourceId: 2, part: 0, start: null, text: "something else", header: "", hash: "", embedding: null },
  ];
  const best = rank("projector", candidates, null);
  assert.deepEqual(best.map((p) => p.sourceId), [1]);
});

test("citations are read from the answer, in order, ignoring numbers that don't exist", () => {
  assert.deepEqual(citedNumbers("You said X [2]. Also Y [1][2] and Z [3, 1] and [9].", 3), [2, 1, 3]);
  assert.deepEqual(citedNumbers("قلتَ كذا [2]، وأيضًا [1،2].", 2), [2, 1]);
});

test("excerpts are taken around the question's words", () => {
  const text = `${"intro words ".repeat(40)}the projector must be booked ${"more words ".repeat(40)}`;
  const piece = excerpt(text, "projector");
  assert.ok(piece.includes("projector"));
  assert.ok(piece.startsWith("…") && piece.endsWith("…"));
});
