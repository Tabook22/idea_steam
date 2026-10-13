import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanOptions, cleanStudy, dueCards, handoutHtml, reviewCard, shuffleChoice } from "../artifacts/api-server/src/lib/study.ts";

const source = "Large language models do not search a library. During training the model reads a huge amount of text, and connections between ideas get stronger. When you ask a question it follows the strongest paths to predict the next word.";
const options = cleanOptions({ questions: 5 });
const raw = {
  intro: "How language models produce answers.",
  sections: [{ heading: "No library inside", points: ["Nothing is looked up.", ""] }, { heading: "", points: ["dropped"] }],
  terms: [{ term: "Training", meaning: "Reading lots of text." }, { term: "x" }],
  concept: { center: "Language model", branches: [{ label: "Training", items: ["reads text"] }, { label: "Answering", items: ["next word"] }] },
  quiz: [
    { type: "choice", question: "Where do answers come from?", options: ["A library", "Strong paths", "The internet", "A person"], answer: 1, answerText: "Strong paths", explanation: "It predicts.", quote: "it follows the strongest paths to predict the next word" },
    { type: "choice", question: "Broken: answer out of range", options: ["a", "b", "c"], answer: 7 },
    { type: "truefalse", question: "Models search a library.", answer: 1, quote: "an invented quote that is not in the text" },
    { type: "short", question: "What happens in training?", answerText: "Connections get stronger.", explanation: "" },
    { type: "short", question: "No model answer" },
  ],
  cards: [{ front: "What is predicted?", back: "The next word." }, { front: "", back: "x" }],
};

test("a study pack is checked: broken questions, empty notes and bad quotes are dropped", () => {
  const pack = cleanStudy(raw, source, options, () => 0.5);
  assert.equal(pack.sections.length, 1);
  assert.deepEqual(pack.sections[0].points, ["Nothing is looked up."]);
  assert.equal(pack.terms.length, 1);
  assert.equal(pack.quiz.length, 3, "the out-of-range and answerless ones go");
  const choice = pack.quiz[0];
  assert.equal(choice.options[choice.answer], "Strong paths", "after shuffling, the answer still points at the right option");
  assert.equal(choice.quote, "it follows the strongest paths to predict the next word");
  assert.deepEqual(pack.quiz[1].options, ["True", "False"]);
  assert.equal(pack.quiz[1].answerText, "False");
  assert.equal(pack.quiz[1].quote, "", "an invented quote is removed");
  assert.equal(pack.quiz[2].answer, -1);
  assert.equal(pack.cards.length, 1);
  assert.equal(pack.concept.branches.length, 2);
  assert.equal(pack.language, "en");
  assert.equal(cleanStudy({}, source, options), null);
});

test("right answers end up spread over the positions", () => {
  const base = { type: "choice", question: "q", options: ["right", "b", "c", "d"], answer: 0, answerText: "right", explanation: "", quote: "" };
  const positions = new Set(Array.from({ length: 40 }, (_, i) => shuffleChoice(base, ((seed) => () => ((seed = (seed * 9301 + 49297) % 233280) / 233280))(i + 1)).answer));
  assert.ok(positions.size >= 3, [...positions].join());
  for (let i = 0; i < 20; i++) { const q = shuffleChoice(base); assert.equal(q.options[q.answer], "right"); }
});

test("Arabic packs get Arabic true/false", () => {
  const pack = cleanStudy({ intro: "النماذج اللغوية لا تبحث في مكتبة", sections: [{ heading: "التدريب", points: ["تقرأ نصوصًا كثيرة"] }], quiz: [{ type: "truefalse", question: "هل تبحث في مكتبة؟", answer: 1 }] }, "نص عربي", cleanOptions({}));
  assert.deepEqual(pack.quiz[0].options, ["صح", "خطأ"]);
  assert.equal(pack.language, "ar");
});

test("flashcards: again soon, good later, easy much later; due cards", () => {
  const now = new Date("2026-10-13T10:00:00Z");
  let reviews = reviewCard({}, 0, "good", now);
  assert.equal(reviews[0].box, 2);
  assert.equal(reviews[0].due, "2026-10-14T10:00:00.000Z", "a card you knew comes back tomorrow");
  reviews = reviewCard(reviews, 0, "easy", now);
  assert.equal(reviews[0].box, 4);
  assert.equal(reviews[0].due, "2026-10-20T10:00:00.000Z");
  reviews = reviewCard(reviews, 0, "again", now);
  assert.equal(reviews[0].box, 1);
  reviews = reviewCard(reviews, 1, "easy", now);
  assert.deepEqual(dueCards(3, reviews, new Date("2026-10-13T10:05:00Z")), [0, 2], "card 0 comes back soon, card 2 was never seen");
});

test("handouts: the learners' quiz has no answers; the key does; Arabic is right to left", () => {
  const pack = cleanStudy(raw, source, options, () => 0.5);
  const quiz = handoutHtml("Lesson 1", pack, "quiz");
  const key = handoutHtml("Lesson 1", pack, "key");
  assert.doesNotMatch(quiz, /class="right"|✔/);
  assert.match(quiz, /Name/);
  assert.match(key, /class="right"/);
  assert.match(key, /✔ Connections get stronger\./);
  assert.match(handoutHtml("Lesson 1", pack, "notes", "data:image/png;base64,AAAA"), /<img src="data:image\/png;base64,AAAA"/);
  assert.doesNotMatch(handoutHtml("<b>x</b>", pack, "notes", "javascript:x"), /<b>x|javascript/);
  const arabic = cleanStudy({ sections: [{ heading: "التدريب", points: ["نص"] }] }, "نص", cleanOptions({ language: "ar" }));
  assert.match(handoutHtml("درس", arabic, "notes"), /dir="rtl"/);
});

test("options are checked", () => {
  assert.deepEqual(cleanOptions({ questions: 999, difficulty: "x", audience: "kids", language: "ar" }), { questions: 10, difficulty: "mixed", audience: "kids", language: "ar" });
});
