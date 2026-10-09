import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanPlan, cleanSpec, picturePrompt, plainDraft, planPrompt } from "../artifacts/api-server/src/lib/visuals.ts";
import { anchorBlock, hasVisual, insertVisual, removeVisual } from "../artifacts/idea-stream/src/lib/visual-insert.ts";

test("the AI's plan is checked: allowed kinds only, usable data, limits kept", () => {
  const plan = cleanPlan({ visuals: [
    { kind: "picture", title: "Roots as a network", caption: "Like mycelium.", anchor: "mushroom mycelium networks", spec: { prompt: "A forest floor cut away to show glowing fungal threads linking tree roots" } },
    { kind: "chart", title: "Made up", spec: { type: "bar", data: [{ label: "A", value: "lots" }] } },
    { kind: "concept", title: "Map", spec: { center: "LLMs", branches: [{ label: "Training", items: ["a", "b", "c", "d", "e"] }, { label: "Use", items: [] }] } },
    { kind: "video", title: "Not a kind", spec: {} },
    { kind: "steps", title: "Not allowed here", spec: { steps: [{ title: "One" }, { title: "Two" }] } },
  ] }, ["picture", "chart", "concept"], 5);
  assert.deepEqual(plan.map((item) => item.kind), ["picture", "concept"], "a chart without real numbers and unknown or unchosen kinds are dropped");
  assert.equal(plan[1].spec.branches[0].items.length, 4, "at most 4 items per branch");
  assert.equal(cleanPlan({ visuals: [plan[0], plan[0], plan[0]] }, ["picture"], 2).length, 2, "no more than asked");
  assert.deepEqual(cleanPlan(null, ["picture"], 3), []);
});

test("charts keep only real numbers; comparisons get a cell per column", () => {
  assert.deepEqual(cleanSpec("chart", { type: "pie", unit: "%", data: [{ label: "Yes", value: 60 }, { label: "No", value: "40" }, { label: "?", value: -3 }] }),
    { type: "pie", unit: "%", data: [{ label: "Yes", value: 60 }, { label: "No", value: 40 }] });
  const table = cleanSpec("compare", { columns: ["Library", "Network"], rows: [{ label: "Memory", values: ["Stored books"] }] });
  assert.deepEqual(table.rows[0].values, ["Stored books", ""]);
  assert.equal(cleanSpec("compare", { columns: ["Only one"], rows: [] }), null);
});

test("pictures are asked for without any lettering, in the chosen style and for the audience", () => {
  const prompt = picturePrompt("Two children planting a tree", "cartoon", "kids");
  assert.match(prompt, /cartoon/);
  assert.match(prompt, /children/);
  assert.match(prompt, /no words, letters, numbers/);
});

test("the planner is told to stay faithful to the draft", () => {
  const prompt = planPrompt({ kinds: ["chart", "picture"], count: 3, audience: "students", language: "ar" });
  assert.match(prompt, /Never invent data/);
  assert.match(prompt, /in Arabic/);
  assert.match(prompt, /ONLY when the draft itself gives these numbers/);
  assert.match(prompt, /pictures for at most half/);
  assert.doesNotMatch(prompt, /"timeline"/, "only the chosen kinds are offered");
});

test("rich drafts are read as plain text", () => {
  assert.equal(plainDraft("<!--idea-stream-rich-text--><h2>Title</h2><p>One &amp; two</p><p>Three<br>four</p>"), "Title\nOne & two\nThree\nfour");
});

test("a visual goes after the paragraph it explains, and comes out again", () => {
  const html = "<h2>Intro</h2><p>Welcome to today’s episode about language models.</p><p>Imagine a forest with mushroom mycelium networks under it.</p><p>The end.</p>";
  const picture = { url: "/ideas/api/storage/objects/0f8fad5b-d9cb-469f-a165-70867728950e", title: "Roots", caption: "A network, not a library.", anchor: "a forest with mushroom mycelium" };
  const added = insertVisual(html, picture);
  assert.match(added, /mycelium networks under it\.<\/p><p style="text-align: center"><img src="\/ideas\/api\/storage\/objects\/0f8fad5b[^"]*" alt="Roots"[^>]*><\/p><p style="text-align: center"><em>A network, not a library\.<\/em><\/p><p>The end/);
  assert.equal(insertVisual(added, picture), added, "never twice");
  assert.ok(hasVisual(added, picture.url));
  // A second visual for the same paragraph goes after the first.
  const second = insertVisual(added, { ...picture, url: "/ideas/api/storage/objects/1f8fad5b-d9cb-469f-a165-70867728950e", title: "Map", caption: "" });
  assert.ok(second.indexOf("1f8fad5b") > second.indexOf("A network, not a library"));
  assert.equal(removeVisual(added, picture.url), html);
  assert.ok(insertVisual(html, { ...picture, anchor: "words that are nowhere" }).endsWith("<em>A network, not a library.</em></p>"), "no match: at the end");
});

test("anchors match loosely (punctuation, case, a few changed words)", () => {
  const parts = ["<p>First part.</p>", "<p>Large Language Models—like ChatGPT—actually work!</p>"];
  assert.equal(anchorBlock(parts, "large language models like chatgpt actually work"), 1);
  assert.equal(anchorBlock(parts, "how large language models like ChatGPT really work"), 1);
  assert.equal(anchorBlock(parts, "nothing alike here at all"), -1);
});
