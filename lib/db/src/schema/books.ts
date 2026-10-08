import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * A handwriting book (pages of ink, typed text and media, like the meeting notebook). It belongs
 * to a subject, to an audio recording, or to nothing. Meeting notebooks stay on the meeting.
 */
export const booksTable = pgTable(
  "books",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    subjectId: integer("subject_id"),
    libraryItemId: integer("library_item_id"),
    cover: text("cover").notNull().default("ocean"),
    /** The pages; checked in lib/meeting-notebook. */
    doc: jsonb("doc").$type<Record<string, unknown>>(),
    /** The book's entry in its subject's stream (its words and page pictures). */
    ideaId: integer("idea_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [index("books_subject_idx").on(table.subjectId), index("books_item_idx").on(table.libraryItemId)],
);
export type BookRecord = typeof booksTable.$inferSelect;
