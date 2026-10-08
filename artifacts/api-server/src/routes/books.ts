import { Router, type IRouter } from "express";
import { desc, eq, isNotNull } from "drizzle-orm";
import { audioLibraryTable, booksTable, db, meetingsTable, subjectsTable, type BookRecord } from "@workspace/db";
import { CreateBookBody, GetBookParams, ListBooksQueryParams, SaveBookPagesBody, UpdateBookBody } from "@workspace/api-zod";
import { aiConfigured } from "@workspace/integrations-openai-ai-server";
import { cleanNotebook, pagesToRead, readHandwriting, type Notebook } from "../lib/meeting-notebook";
import { BOOK_COVERS, bookSummary, linkTitles, meetingBook, removeBookIdea, syncBookIdea } from "../lib/books";

const router: IRouter = Router();

async function full(book: BookRecord) {
  const titles = await linkTitles([book.subjectId], [book.libraryItemId]);
  return { ...bookSummary(book, titles), doc: book.doc ?? null };
}
async function find(id: number) {
  const [book] = await db.select().from(booksTable).where(eq(booksTable.id, id));
  return book ?? null;
}

/** What a book belongs to: a subject or a recording (one of them), if they exist. */
async function links(body: { subjectId?: number | null; libraryItemId?: number | null }) {
  const out: { subjectId?: number | null; libraryItemId?: number | null } = {};
  if (body.libraryItemId != null) {
    const [item] = await db.select({ id: audioLibraryTable.id }).from(audioLibraryTable).where(eq(audioLibraryTable.id, body.libraryItemId));
    if (!item) return null;
    return { libraryItemId: item.id, subjectId: null };
  }
  if (body.subjectId != null) {
    const [subject] = await db.select({ id: subjectsTable.id }).from(subjectsTable).where(eq(subjectsTable.id, body.subjectId));
    if (!subject) return null;
    return { subjectId: subject.id, libraryItemId: null };
  }
  if (body.subjectId === null) out.subjectId = null;
  if (body.libraryItemId === null) out.libraryItemId = null;
  return out;
}

const reading = new Set<number>();
/**
 * Reads new handwriting after a save, in the background, then updates the subject entry. Only
 * pages whose picture is still the same get the text (the book may have changed meanwhile).
 */
function readLater(id: number) {
  if (!aiConfigured || reading.has(id)) return;
  reading.add(id);
  void (async () => {
    try {
      const book = await find(id);
      const doc = cleanNotebook(book?.doc);
      if (!book || !doc || !pagesToRead(doc).length || !(await readHandwriting(doc))) return;
      const now = await find(id);
      const current = cleanNotebook(now?.doc);
      if (!now || !current) return;
      const read = new Map(doc.pages.map((page) => [page.id, page]));
      for (const page of current.pages) {
        const done = read.get(page.id);
        if (done?.handwritingRev !== undefined && page.snapshot && done.handwritingRev === page.snapshot.rev) {
          page.handwriting = done.handwriting;
          page.handwritingRev = done.handwritingRev;
        }
      }
      const [saved] = await db.update(booksTable).set({ doc: current as unknown as Record<string, unknown> }).where(eq(booksTable.id, id)).returning();
      if (saved) await syncBookIdea(saved);
    } catch (error) {
      console.warn("Book: reading handwriting failed:", (error as Error).message);
    } finally { reading.delete(id); }
  })();
}

router.get("/books", async (req, res): Promise<void> => {
  const query = ListBooksQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Invalid filter" }); return; }
  const { subjectId, libraryItemId } = query.data;
  const books = await db.select().from(booksTable).orderBy(desc(booksTable.updatedAt));
  const meetings = await db.select().from(meetingsTable).where(isNotNull(meetingsTable.notebook)).orderBy(desc(meetingsTable.updatedAt));
  const titles = await linkTitles([...books.map((b) => b.subjectId), ...meetings.map((m) => m.subjectId)], books.map((b) => b.libraryItemId));
  const list = [
    ...books.map((book) => bookSummary(book, titles)),
    ...meetings.map((meeting) => meetingBook(meeting, titles)).filter((book) => book.pageCount > 0),
  ]
    .filter((book) => (subjectId === undefined || book.subjectId === subjectId) && (libraryItemId === undefined || book.libraryItemId === libraryItemId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  res.json(list);
});

router.post("/books", async (req, res): Promise<void> => {
  const body = CreateBookBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Give the book a name." }); return; }
  const link = await links(body.data);
  if (!link) { res.status(404).json({ error: "That subject or recording no longer exists." }); return; }
  const [book] = await db.insert(booksTable).values({
    title: body.data.title.trim(),
    cover: body.data.cover && BOOK_COVERS.has(body.data.cover) ? body.data.cover : "ocean",
    subjectId: link.subjectId ?? null,
    libraryItemId: link.libraryItemId ?? null,
  }).returning();
  res.status(201).json(await full(book!));
});

router.get("/books/:bookId", async (req, res): Promise<void> => {
  const params = GetBookParams.safeParse(req.params);
  const book = params.success ? await find(params.data.bookId) : null;
  if (!book) { res.status(404).json({ error: "Book not found" }); return; }
  res.json(await full(book));
});

router.patch("/books/:bookId", async (req, res): Promise<void> => {
  const params = GetBookParams.safeParse(req.params);
  const body = UpdateBookBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid change" }); return; }
  const book = await find(params.data.bookId);
  if (!book) { res.status(404).json({ error: "Book not found" }); return; }
  const link = await links(body.data);
  if (!link) { res.status(404).json({ error: "That subject or recording no longer exists." }); return; }
  const changes: Partial<typeof booksTable.$inferInsert> = { ...link };
  if (body.data.title?.trim()) changes.title = body.data.title.trim();
  if (body.data.cover && BOOK_COVERS.has(body.data.cover)) changes.cover = body.data.cover;
  const [saved] = await db.update(booksTable).set(changes).where(eq(booksTable.id, book.id)).returning();
  // Its entry follows it to another subject, or goes when it leaves subjects.
  await syncBookIdea(saved!).catch(() => {});
  res.json(await full((await find(book.id))!));
});

router.delete("/books/:bookId", async (req, res): Promise<void> => {
  const params = GetBookParams.safeParse(req.params);
  const book = params.success ? await find(params.data.bookId) : null;
  if (!book) { res.status(404).json({ error: "Book not found" }); return; }
  await removeBookIdea(book).catch(() => {});
  await db.delete(booksTable).where(eq(booksTable.id, book.id));
  res.sendStatus(204);
});

router.put("/books/:bookId/pages", async (req, res): Promise<void> => {
  const params = GetBookParams.safeParse(req.params);
  const body = SaveBookPagesBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "The book couldn't be saved." }); return; }
  const book = await find(params.data.bookId);
  if (!book) { res.status(404).json({ error: "Book not found" }); return; }
  const doc = cleanNotebook(body.data.notebook);
  // Handwriting already read stays, as long as the page picture hasn't changed since.
  const before = new Map(((book.doc as Notebook | null)?.pages ?? []).map((page) => [page.id, page]));
  for (const page of doc?.pages ?? []) {
    const old = before.get(page.id);
    if (old?.handwriting && page.snapshot && old.handwritingRev === page.snapshot.rev) { page.handwriting = old.handwriting; page.handwritingRev = old.handwritingRev; }
  }
  const [saved] = await db.update(booksTable).set({ doc: doc as unknown as Record<string, unknown> | null }).where(eq(booksTable.id, book.id)).returning();
  await syncBookIdea(saved!).catch((error) => console.warn("Book: subject entry failed:", (error as Error).message));
  readLater(book.id);
  res.json(await full((await find(book.id))!));
});

router.post("/books/:bookId/read", async (req, res): Promise<void> => {
  const params = GetBookParams.safeParse(req.params);
  const book = params.success ? await find(params.data.bookId) : null;
  if (!book?.doc) { res.status(404).json({ error: "This book has no pages yet." }); return; }
  if (!aiConfigured) { res.status(503).json({ error: "AI is not configured yet, so handwriting can't be read." }); return; }
  const doc = cleanNotebook(book.doc);
  if (doc && await readHandwriting(doc)) {
    const [saved] = await db.update(booksTable).set({ doc: doc as unknown as Record<string, unknown> }).where(eq(booksTable.id, book.id)).returning();
    await syncBookIdea(saved!).catch(() => {});
  }
  res.json(await full((await find(book.id))!));
});

export default router;
