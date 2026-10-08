/**
 * Handwriting books: what a book looks like in lists (its first page, how much is written, what
 * it belongs to), and its entry in its subject's stream so its words can be searched and asked.
 */
import { eq, inArray } from "drizzle-orm";
import { audioLibraryTable, booksTable, db, ideasTable, subjectsTable, type BookRecord, type MeetingRecord } from "@workspace/db";
import { notebookText, type Notebook } from "./meeting-notebook";

export const BOOK_COVERS = new Set(["forest", "ocean", "teal", "violet", "rose", "sunset", "amber", "slate"]);

export type BookKind = "subject" | "audio" | "meeting" | "loose";

/** What lists show about a notebook's pages. */
export function pagesInfo(doc: Notebook | null | undefined) {
  const pages = doc?.pages ?? [];
  const first = pages[0];
  return {
    pageCount: pages.length,
    writtenCount: pages.filter((page) => page.strokes.length || page.items.length).length,
    preview: first?.snapshot?.url ?? null,
    paper: first?.paper ?? "lined",
    paperColor: first?.color ?? "white",
  };
}

/** Titles of the subjects and recordings books point at. */
export async function linkTitles(subjectIds: Array<number | null>, itemIds: Array<number | null>) {
  const sIds = [...new Set(subjectIds.filter((id): id is number => id !== null))];
  const iIds = [...new Set(itemIds.filter((id): id is number => id !== null))];
  const subjects = sIds.length ? await db.select({ id: subjectsTable.id, title: subjectsTable.title }).from(subjectsTable).where(inArray(subjectsTable.id, sIds)) : [];
  const items = iIds.length ? await db.select({ id: audioLibraryTable.id, title: audioLibraryTable.title, transcript: audioLibraryTable.transcript }).from(audioLibraryTable).where(inArray(audioLibraryTable.id, iIds)) : [];
  return {
    subjects: new Map(subjects.map((subject) => [subject.id, subject.title])),
    // Untitled recordings go by the start of what was said.
    items: new Map(items.map((item) => [item.id, item.title?.trim() || item.transcript?.trim().slice(0, 60) || "Recording"])),
  };
}

export function bookSummary(book: BookRecord, titles: Awaited<ReturnType<typeof linkTitles>>) {
  const audioTitle = book.libraryItemId !== null ? titles.items.get(book.libraryItemId) ?? null : null;
  const subjectTitle = book.subjectId !== null ? titles.subjects.get(book.subjectId) ?? null : null;
  const kind: BookKind = audioTitle !== null ? "audio" : subjectTitle !== null ? "subject" : "loose";
  return {
    id: book.id,
    kind,
    title: book.title,
    cover: book.cover,
    subjectId: subjectTitle !== null ? book.subjectId : null,
    subjectTitle,
    libraryItemId: audioTitle !== null ? book.libraryItemId : null,
    audioTitle,
    meetingId: null,
    ideaId: book.ideaId,
    ...pagesInfo(book.doc as Notebook | null),
    updatedAt: book.updatedAt.toISOString(),
  };
}

/** A meeting's notebook, listed with the books. */
export function meetingBook(meeting: MeetingRecord, titles: Awaited<ReturnType<typeof linkTitles>>) {
  return {
    id: meeting.id,
    kind: "meeting" as const,
    title: meeting.title,
    cover: "violet",
    subjectId: meeting.subjectId,
    subjectTitle: meeting.subjectId !== null ? titles.subjects.get(meeting.subjectId) ?? null : null,
    libraryItemId: meeting.libraryItemId,
    audioTitle: null,
    meetingId: meeting.id,
    ideaId: meeting.ideaId,
    ...pagesInfo(meeting.notebook as Notebook | null),
    updatedAt: meeting.updatedAt.toISOString(),
  };
}

/** The book's words, page by page ("Page 1: …"). */
export const bookText = (doc: Notebook | null | undefined) => notebookText(doc).replace(/^Notebook page (\d+):/gm, "Page $1:");

/**
 * A subject's book shows in the subject's stream as one entry: its title, its words, and each
 * written page as a picture. Kept up to date; removed when the book leaves the subject or is empty.
 */
export async function syncBookIdea(book: BookRecord) {
  const doc = book.doc as Notebook | null;
  const words = bookText(doc);
  const pictures = (doc?.pages ?? []).filter((page) => page.snapshot?.url);
  const arabic = /[؀-ۿ]/.test(book.title + words);
  const [subject] = book.subjectId !== null ? await db.select({ id: subjectsTable.id }).from(subjectsTable).where(eq(subjectsTable.id, book.subjectId)) : [];
  if (!subject || (!words && !pictures.length)) {
    if (book.ideaId !== null) await removeBookIdea(book);
    return;
  }
  const content = [`📓 ${book.title}`, words].filter(Boolean).join("\n\n");
  const attachments = pictures.map((page) => ({
    type: "image" as const, url: page.snapshot!.url,
    name: `${book.title} · ${arabic ? "صفحة" : "page"} ${doc!.pages.indexOf(page) + 1}`, mimeType: "image/png",
  }));
  if (book.ideaId !== null) {
    const [updated] = await db.update(ideasTable).set({ content, attachments, subjectId: subject.id }).where(eq(ideasTable.id, book.ideaId)).returning({ id: ideasTable.id });
    if (updated) return;
  }
  const [idea] = await db.insert(ideasTable).values({ subjectId: subject.id, content, source: "image", attachments }).returning({ id: ideasTable.id });
  if (idea) {
    await db.update(booksTable).set({ ideaId: idea.id }).where(eq(booksTable.id, book.id));
  }
}

export async function removeBookIdea(book: BookRecord) {
  if (book.ideaId === null) return;
  await db.delete(ideasTable).where(eq(ideasTable.id, book.ideaId));
  await db.update(booksTable).set({ ideaId: null }).where(eq(booksTable.id, book.id));
}
