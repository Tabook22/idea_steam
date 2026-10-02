import { test } from "node:test";
import assert from "node:assert/strict";
import {
  likePattern,
  normalizeForSearch,
  snippetAround,
  stripMarkup,
} from "../artifacts/api-server/src/lib/search-text.ts";

test("Arabic spelling variants and diacritics match the same search", () => {
  assert.equal(normalizeForSearch("فكرةٌ"), normalizeForSearch("فكره"));
  assert.equal(normalizeForSearch("نُعلِّم"), "نعلم");
  assert.equal(normalizeForSearch("أحمد إلى آخر"), "احمد الي اخر");
  assert.equal(normalizeForSearch("مـــدرسة"), "مدرسه");
  assert.equal(normalizeForSearch("  Curiosity\n\tMATTERS "), "curiosity matters");
});

test("snippets quote the original text around the match", () => {
  const text = "فكرةٌ عن المدرسة: كيف نُعلِّم الطلاب الملاحظة؟";
  assert.equal(snippetAround(text, "نعلم الطلاب"), text);
  const long = `${"word ".repeat(60)}the hidden needle is here ${"tail ".repeat(60)}`;
  const snippet = snippetAround(long, "HIDDEN needle");
  assert.match(snippet, /^….*the hidden needle is here.*…$/);
  assert.ok(snippet.length < 220);
  assert.equal(snippetAround("nothing to see", "absent"), null);
});

test("markup is removed and LIKE wildcards are literal", () => {
  assert.equal(stripMarkup("<p>Reward <strong>curiosity</strong>, not memory.</p>"), "Reward curiosity, not memory.");
  assert.equal(stripMarkup("# Script\n\nOpen on the **commute**"), "Script Open on the commute");
  // Each of %, _ and \ gets a backslash in front of it.
  assert.equal(likePattern(String.raw`50%_x\ `.trim()), String.raw`%50\%\_x\\%`);
});
