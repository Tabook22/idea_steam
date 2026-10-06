import { test } from "node:test";
import assert from "node:assert/strict";
import { findPhrase, foldWord, paragraphs, shortenGap, spanBetween, wordAt, wordGaps } from "../artifacts/idea-stream/src/lib/text-edit.ts";
import { answerBlocks, answerParts, clock } from "../artifacts/idea-stream/src/lib/ask-text.ts";

const timed = (text, gaps = {}) => {
  let t = 0;
  return text.split(" ").map((word, index) => {
    const entry = { word, start: +t.toFixed(2), end: +(t + 0.3).toFixed(2) };
    t += 0.4 + (gaps[index] ?? 0);
    return entry;
  });
};

test("finding a phrase ignores case, punctuation and Arabic spelling, and finds every place", () => {
  const words = timed("So, you know, the plan. You KNOW what? You knowing nothing.");
  assert.deepEqual(findPhrase(words, "you know"), [{ from: 1, to: 2 }, { from: 5, to: 6 }]);
  assert.deepEqual(findPhrase(words, "plan"), [{ from: 4, to: 4 }]);
  assert.deepEqual(findPhrase(words, "  "), []);
  const arabic = timed("قلت يعني إن المدرسة يعني مهمة، والمدرسه أيضا");
  assert.equal(findPhrase(arabic, "يعني").length, 2);
  assert.equal(findPhrase(arabic, "مدرسة").length, 2, "المدرسة and والمدرسه both match مدرسة");
  assert.equal(foldWord("أَيْضًا،"), "ايضا");
});

test("paragraphs break after a sentence, a long pause, or when too long", () => {
  const sentence = Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ") + ".";
  const words = timed(`${sentence} ${sentence}`);
  assert.deepEqual(paragraphs(words).map((p) => [p.from, p.to]), [[0, 29], [30, 59]]);
  const paused = timed("one two three four five six seven eight", { 6: 2 });
  assert.deepEqual(paragraphs(paused).map((p) => [p.from, p.to]), [[0, 6], [7, 7]]);
  assert.equal(paragraphs(paused)[1].start, paused[7].start);
  const long = timed(Array.from({ length: 150 }, (_, i) => `w${i}`).join(" "));
  assert.equal(paragraphs(long).length, 3);
  assert.deepEqual(paragraphs([]), []);
});

test("the word being spoken is the last one started", () => {
  const words = timed("a b c d");
  assert.equal(wordAt(words, -1), -1);
  assert.equal(wordAt(words, 0), 0);
  assert.equal(wordAt(words, 0.85), 2);
  assert.equal(wordAt(words, 99), 3);
});

test("long pauses are found and shortened to a natural gap", () => {
  const words = timed("a b c", { 0: 1.5 });
  const gaps = wordGaps(words, 1);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].after, 0);
  const cut = shortenGap(gaps[0]);
  assert.ok(Math.abs(cut.end - cut.start - (gaps[0].end - gaps[0].start - 0.3)) < 1e-9);
});

test("selecting from one word to another works in either direction", () => {
  assert.deepEqual(spanBetween(7, 3), { from: 3, to: 7 });
});

test("AI answers become paragraphs and bullets with citations split out", () => {
  const blocks = answerBlocks("You planned **two** things [1].\n\n- Book the room [2][3]\n* Ask about the projector [1, 3]");
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks[0], { kind: "p", parts: [{ text: "You planned two things" }, { cite: 1 }, { text: "." }] });
  assert.equal(blocks[1].kind, "li");
  assert.deepEqual(blocks[1].parts, [{ text: "Book the room" }, { cite: 2 }, { cite: 3 }]);
  assert.deepEqual(blocks[2].parts.filter((p) => "cite" in p), [{ cite: 1 }, { cite: 3 }]);
  assert.deepEqual(answerParts("قلتَ ذلك [1،2]"), [{ text: "قلتَ ذلك" }, { cite: 1 }, { cite: 2 }]);
  assert.equal(clock(3725), "1:02:05");
  assert.equal(clock(65), "1:05");
});
