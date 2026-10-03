import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

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
    /** Word timings of the current audio (cleared when the audio changes). */
    words: jsonb("words").$type<Array<{ word: string; start: number; end: number }>>(),
    /** Seconds where the user tapped "Mark" while recording (kept in step with cuts and joins). */
    marks: jsonb("marks").$type<number[]>().notNull().default([]),
    originalMarks: jsonb("original_marks").$type<number[]>(),
    /** AI chapters and summary of the current audio (cleared when its timing changes). */
    chapters: jsonb("chapters").$type<Array<{ start: number; title: string }>>(),
    summary: text("summary"),
    /** "music" for songs uploaded to use as background music; everything else is a recording. */
    kind: text("kind", { enum: ["recording", "music"] }).notNull().default("recording"),
    /**
     * Background music added as a layer: the voice-only audio underneath (to remove or change
     * the music later), and how the music was placed. Cleared when the audio is edited further.
     */
    mix: jsonb("mix").$type<{
      voiceUrl: string;
      voiceMarks: number[];
      voiceDuration: number | null;
      musicItemId: number | null;
      musicUrl: string;
      musicTitle: string | null;
      pre: number;
      settings: {
        musicStart: number; regionStart: number; regionEnd: number; fit: "loop" | "stretch" | "once";
        musicVolume: number; voiceVolume: number; fadeIn: number; fadeOut: number; duck: number; makeRoom: boolean;
      };
    }>(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audio_library_captured_at_idx").on(table.capturedAt)],
);

export type AudioLibraryRecord = typeof audioLibraryTable.$inferSelect;
