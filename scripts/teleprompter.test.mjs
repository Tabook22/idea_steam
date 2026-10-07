import { test } from "node:test";
import assert from "node:assert/strict";
import { followPosition, readingSeconds, scriptSections, scriptText, scriptWords, spoken } from "../artifacts/idea-stream/src/lib/teleprompter.ts";

test("rich-text drafts become plain text with headings kept", () => {
  const text = scriptText("<!--idea-stream-rich-text--><h2>Opening</h2><p>Hello <strong>everyone</strong>.</p><p>Today&nbsp;we talk.</p>");
  assert.equal(text, "# Opening\nHello everyone.\nToday we talk.");
});

test("a script is split into sections at headings, and long parts are split at paragraphs", () => {
  const long = Array.from({ length: 5 }, (_, i) => `${"word ".repeat(50)}end${i}.`).join("\n\n");
  const sections = scriptSections(`# Hook\nWhat if lessons began outside?\n\n## Main part\n${long}\n\n# Close\nThanks for listening. [Show the logo]`);
  assert.deepEqual(sections.map((s) => s.title), ["Hook", "Main part", "Main part (2)", "Main part (3)", "Close"]);
  assert.ok(sections.every((s) => s.text.split(/\s+/).length <= 141));
  assert.equal(spoken(sections.at(-1).text), "Thanks for listening.", "stage directions are not read aloud");
});

test("a script without headings gets short titles from its first words", () => {
  const [section] = scriptSections("فكرة جديدة للفيديو: نصور الطريق إلى العمل كقصة عن الانتباه.");
  assert.equal(section.title, "فكرة جديدة للفيديو: نصور الطريق إلى…");
});

test("the teleprompter follows what is heard, without jumping back", () => {
  const words = scriptWords("Welcome back to Idea Stream, the show where small thoughts become big projects. Today: noticing.");
  assert.equal(followPosition(words, "welcome back to", 0), 3);
  assert.equal(followPosition(words, "welcome back to idea stream the show", 3), 7);
  assert.equal(followPosition(words, "small thoughts become", 7), 11);
  assert.equal(followPosition(words, "welcome back", 11), 11, "heard again: stays");
  assert.equal(followPosition(words, "", 5), 5);
  assert.equal(followPosition(words, "something entirely different", 5), 5);
});

test("following works in Arabic, ignoring diacritics and letter variants", () => {
  const words = scriptWords("مرحبًا بكم في حلقة جديدة عن التعلّم خارج الفصل");
  assert.equal(followPosition(words, "مرحبا بكم في حلقه", 0), 4);
});

test("reading time is estimated from the spoken words", () => {
  assert.equal(readingSeconds("word ".repeat(140)), 60);
  assert.equal(readingSeconds("[only a stage direction]"), 0);
});
