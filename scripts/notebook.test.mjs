import { test } from "node:test";
import assert from "node:assert/strict";
import { compactPoints, newNotebook, notebookText, pdfFromJpegs, strokesAt } from "../artifacts/idea-stream/src/lib/notebook.ts";
import { cleanNotebook, notebookText as serverText, pagesToRead } from "../artifacts/api-server/src/lib/meeting-notebook.ts";

const stroke = (id, points, width = 3) => ({ id, tool: "pen", color: "#111827", width, points });

test("the eraser removes the strokes it touches, not the others", () => {
  const strokes = [stroke("a", [[100, 100, 0.5], [200, 100, 0.5]]), stroke("b", [[100, 300, 0.5], [200, 300, 0.5]])];
  assert.deepEqual([...strokesAt(strokes, 150, 105, 10)], ["a"], "near the middle of a line, between its points");
  assert.deepEqual([...strokesAt(strokes, 150, 200, 10)], []);
  assert.deepEqual([...strokesAt([stroke("dot", [[50, 50, 0.5]])], 55, 52, 10)], ["dot"], "a single dot");
});

test("strokes are kept small: tiny moves dropped, numbers rounded, ends kept", () => {
  const points = compactPoints([[10.123, 10.987, 0.5123], [10.2, 11, 0.5], [10.3, 11.1, 0.5], [40.55, 40.44, 0.666]]);
  assert.deepEqual(points, [[10.1, 11, 0.51], [40.6, 40.4, 0.67]]);
});

test("a new notebook has one lined white page", () => {
  const doc = newNotebook();
  assert.equal(doc.pages.length, 1);
  assert.equal(doc.pages[0].paper, "lined");
  assert.equal(doc.pages[0].color, "white");
});

test("typed words and read handwriting are the notebook's text, page by page", () => {
  const doc = { version: 1, pages: [
    { id: "p1", paper: "lined", color: "white", rev: 1, strokes: [], items: [{ id: "t", kind: "text", x: 0, y: 0, w: 100, h: 40, html: "<p>Budget&nbsp;check</p>" }], handwriting: "Call Sara" },
    { id: "p2", paper: "blank", color: "white", rev: 0, strokes: [], items: [] },
  ] };
  assert.equal(notebookText(doc), "Page 1: Budget check / Call Sara");
});

test("the PDF has one page per notebook page and a proper structure", async () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const blob = pdfFromJpegs([{ jpeg, width: 10, height: 14 }, { jpeg, width: 10, height: 14 }]);
  const text = Buffer.from(await blob.arrayBuffer()).toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.match(text, /\/Type \/Pages \/Count 2 \/Kids \[3 0 R 6 0 R\]/);
  assert.match(text, /\/Filter \/DCTDecode \/Length 4/);
  assert.ok(text.trimEnd().endsWith("%%EOF"));
  // Each object's offset in the table points at that object.
  const xref = Number(text.match(/startxref\n(\d+)/)[1]);
  const offsets = text.slice(xref).match(/(\d{10}) 00000 n/g).map((line) => Number(line.slice(0, 10)));
  offsets.forEach((offset, index) => assert.ok(text.slice(offset).startsWith(`${index + 1} 0 obj`), `object ${index + 1}`));
});

test("the server checks the notebook: sizes, kinds, its own files only", () => {
  const file = "/api/storage/objects/0f8fad5b-d9cb-469f-a165-70867728950e";
  const doc = cleanNotebook({ version: 1, pages: [
    {
      id: "p1", paper: "dots", color: "cream", rev: 3,
      strokes: [{ id: "s", tool: "pen", color: "#1d4ed8", width: 999, points: [[10, 10, 0.5], [9999, 20, 7]] }, { id: "bad", points: "nope" }],
      items: [
        { id: "t", kind: "text", x: 10, y: 10, w: 300, h: 40, html: "<p onclick='x'>Hi <script>bad()</script></p>", size: 500 },
        { id: "i", kind: "image", x: 0, y: 0, w: 100, h: 100, url: `/ideas${file}` },
        { id: "v", kind: "video", x: 0, y: 0, w: 100, h: 100, url: "https://elsewhere.example/v.mp4" },
        { id: "a", kind: "audio", x: 0, y: 0, w: 100, h: 100 },
      ],
      snapshot: { url: file, rev: 3 },
    },
    { id: "p2", paper: "weird", color: "purple", rev: 0, strokes: [], items: [] },
    "not a page",
  ] });
  assert.equal(doc.pages.length, 2);
  const [one, two] = doc.pages;
  assert.equal(one.strokes.length, 1);
  assert.equal(one.strokes[0].width, 60);
  assert.deepEqual(one.strokes[0].points[1], [850, 20, 1]);
  assert.deepEqual(one.items.map((item) => item.kind), ["text", "image"], "outside and missing files are dropped");
  assert.equal(one.items[0].html, "<p>Hi </p>");
  assert.equal(one.items[0].size, 120);
  assert.equal(one.items[1].url, file);
  assert.deepEqual([two.paper, two.color], ["lined", "white"]);
  assert.deepEqual(pagesToRead(doc).map((page) => page.id), ["p1"], "pages with ink and a picture get their handwriting read");
  one.handwriting = "Budget 200";
  one.handwritingRev = 3;
  assert.deepEqual(pagesToRead(doc), [], "…once per picture");
  assert.equal(serverText(doc), "Notebook page 1: Hi / Budget 200");
  assert.equal(cleanNotebook({ pages: [] }), null);
  assert.equal(cleanNotebook(null), null);
});
