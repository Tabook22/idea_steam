import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanTakeaways, sourceHash, takeawaysPrompt } from "../artifacts/api-server/src/lib/takeaways.ts";

const source = "IDEA TEXT:\nLarge language models do not search a library. They learn connections, like mycelium threads that thicken when signals travel along them. ميزانيةُ الورشةِ مئتا دولار فقط.";

test("takeaways are checked: real points only, kinds, at most eight", () => {
  const result = cleanTakeaways({ gist: " Models learn links, not books. ", points: [
    { title: "No library inside", summary: "Nothing is looked up.", details: "It learns connections.", why: "Changes how we trust answers.", quote: "Large language models do not search a library", kind: "fact" },
    { title: "", summary: "dropped: no title" },
    { title: "Threads thicken", summary: "Used paths get stronger.", quote: "a sentence that is nowhere in the text", kind: "nonsense" },
    ...Array.from({ length: 10 }, (_, i) => ({ title: `Extra ${i}`, summary: "s" })),
  ] }, source);
  assert.equal(result.gist, "Models learn links, not books.");
  assert.equal(result.points.length, 8);
  assert.equal(result.points[0].quote, "Large language models do not search a library", "a real quote is kept");
  assert.equal(result.points[1].quote, "", "an invented quote is removed");
  assert.equal(result.points[1].kind, "insight", "unknown kinds become insight");
  assert.equal(result.words, 28);
  assert.equal(cleanTakeaways({ points: [] }, source), null);
  assert.equal(cleanTakeaways(null, source), null);
});

test("quotes match despite punctuation, case and Arabic diacritics", () => {
  const result = cleanTakeaways({ points: [
    { title: "a", summary: "b", quote: "“like mycelium threads, that THICKEN when signals travel”" },
    { title: "c", summary: "d", quote: "ميزانية الورشة مئتا دولار فقط" },
  ] }, source);
  assert.ok(result.points[0].quote.startsWith("like mycelium"));
  assert.equal(result.points[1].quote, "ميزانية الورشة مئتا دولار فقط");
});

test("longer ideas get more takeaways; the source fingerprint is stable", () => {
  assert.match(takeawaysPrompt(100), /2 to 4/);
  assert.match(takeawaysPrompt(500), /3 to 6/);
  assert.match(takeawaysPrompt(3000), /5 to 8/);
  assert.match(takeawaysPrompt(3000), /never add facts/);
  assert.equal(sourceHash("x"), sourceHash("x"));
  assert.notEqual(sourceHash("x"), sourceHash("y"));
});
