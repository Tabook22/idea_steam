import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:1/none";
const { bookSummary, bookText, meetingBook, pagesInfo } = await import("../artifacts/api-server/src/lib/books.ts");

const page = (id, extra = {}) => ({ id, paper: "lined", color: "white", rev: 1, strokes: [], items: [], ...extra });
const ink = [{ id: "s", tool: "pen", color: "#111827", width: 3, points: [[1, 1, 0.5]] }];
const when = new Date("2026-10-09T10:00:00Z");
const record = (extra) => ({ id: 7, title: "Lecture notes", subjectId: null, libraryItemId: null, cover: "teal", doc: null, ideaId: null, createdAt: when, updatedAt: when, ...extra });
const titles = { subjects: new Map([[3, "Physics"]]), items: new Map([[9, "Interview with Sara"]]) };

test("a book's pages: how many, how many written, its first page as the cover", () => {
  const doc = { version: 1, pages: [page("a", { paper: "dots", color: "cream", strokes: ink, snapshot: { url: "/api/storage/objects/x", rev: 1 } }), page("b")] };
  assert.deepEqual(pagesInfo(doc), { pageCount: 2, writtenCount: 1, preview: "/api/storage/objects/x", paper: "dots", paperColor: "cream" });
  assert.deepEqual(pagesInfo(null), { pageCount: 0, writtenCount: 0, preview: null, paper: "lined", paperColor: "white" });
});

test("what a book belongs to: a subject, a recording, or nothing (also when it was deleted)", () => {
  assert.equal(bookSummary(record({ subjectId: 3 }), titles).kind, "subject");
  assert.equal(bookSummary(record({ subjectId: 3 }), titles).subjectTitle, "Physics");
  assert.equal(bookSummary(record({ libraryItemId: 9 }), titles).audioTitle, "Interview with Sara");
  assert.equal(bookSummary(record({ libraryItemId: 9 }), titles).kind, "audio");
  const orphan = bookSummary(record({ subjectId: 99 }), titles);
  assert.deepEqual([orphan.kind, orphan.subjectId], ["loose", null], "a deleted subject leaves a loose book");
  assert.equal(bookSummary(record({}), titles).updatedAt, "2026-10-09T10:00:00.000Z");
});

test("a meeting's notebook is listed as a meeting book", () => {
  const meeting = { id: 4, title: "Weekly sync", subjectId: 3, libraryItemId: 12, ideaId: 40, notebook: { version: 1, pages: [page("a", { strokes: ink })] }, updatedAt: when };
  const book = meetingBook(meeting, titles);
  assert.deepEqual([book.kind, book.meetingId, book.subjectTitle, book.pageCount, book.ideaId], ["meeting", 4, "Physics", 1, 40]);
});

test("a book's words, page by page", () => {
  const doc = { version: 1, pages: [
    page("a", { items: [{ id: "t", kind: "text", x: 0, y: 0, w: 10, h: 10, html: "<p>Newton's laws</p>" }], handwriting: "F = ma" }),
    page("b"),
    page("c", { handwriting: "ميزانية" }),
  ] };
  assert.equal(bookText(doc), "Page 1: Newton's laws / F = ma\nPage 3: ميزانية");
});
