import { test } from "node:test";
import assert from "node:assert/strict";
import { parseShared } from "../artifacts/idea-stream/src/lib/share-parse.ts";

const parse = (fields) => parseShared(new URLSearchParams(fields));

test("YouTube on Android: the link arrives inside the text", () => {
  const shared = parse({ title: "How to think clearly", text: "https://youtu.be/abc123?si=xyz" });
  assert.equal(shared.url, "https://youtu.be/abc123?si=xyz");
  assert.equal(shared.title, "How to think clearly");
  assert.equal(shared.text, "");
});

test("browser share uses the url field and keeps the page title", () => {
  const shared = parse({ title: "Curiosity in schools", url: "https://example.com/article" });
  assert.deepEqual(shared, { url: "https://example.com/article", title: "Curiosity in schools", text: "" });
});

test("WhatsApp-style message: link inside a sentence, trailing punctuation removed", () => {
  const shared = parse({ text: "شاهد هذا المقال المهم https://example.org/read?id=7." });
  assert.equal(shared.url, "https://example.org/read?id=7");
  assert.equal(shared.text, "شاهد هذا المقال المهم");
});

test("plain text without a link is kept as text; unsafe schemes are not links", () => {
  assert.deepEqual(parse({ text: "An idea about learning outside class" }), { url: null, title: "", text: "An idea about learning outside class" });
  assert.equal(parse({ url: "javascript:alert(1)" }).url, null);
});
