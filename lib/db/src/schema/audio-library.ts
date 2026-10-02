import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * The audio library: an independent list of recordings. Entries point at the same stored
 * audio file as the idea they came from, but neither side owns the other. Deleting a library
 * entry never touches the idea, and deleting an idea (or its subject) never removes the
 * library entry. This relies on stored audio files never being deleted by the app.
 */
export const audioLibraryTable = pgTable(
  "audio_library",
  {
    id: serial("id").primaryKey(),
    url: text("url").notNull().unique(),
    /** Null until renamed; the app shows the start of the transcript instead. */
    title: text("title"),
    mimeType: text("mime_type"),
    durationSeconds: integer("duration_seconds"),
    transcript: text("transcript"),
    /** Where it was first saved. A plain reference: the idea may later be moved or deleted. */
    sourceIdeaId: integer("source_idea_id"),
    sourceSubjectTitle: text("source_subject_title"),
    /** Set for recordings made straight into the library, so upload retries never duplicate them. */
    clientCaptureId: text("client_capture_id").unique(),
    /** After cutting, the audio before the first edit, so it can be restored. */
    originalUrl: text("original_url"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audio_library_captured_at_idx").on(table.capturedAt)],
);

export type AudioLibraryRecord = typeof audioLibraryTable.$inferSelect;
