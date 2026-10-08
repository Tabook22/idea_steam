import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export type MeetingSegment = { start: number; end: number; speaker: string; text: string };
export type MeetingMarker = { at: number; kind: "important" | "decision" | "action" | "question" };
/** The meeting notepad: written notes, photos, documents and drawings, each at a moment of the meeting. */
export type MeetingNote = {
  id: string;
  kind: "text" | "photo" | "file" | "drawing";
  /** Seconds into the meeting it was added (null when added afterwards). */
  at: number | null;
  html?: string;
  url?: string;
  name?: string;
  mimeType?: string;
  size?: number;
  createdAt: string;
};
export type MeetingMinutes = {
  summary: string;
  decisions: Array<{ text: string; at: number | null }>;
  actions: Array<{ text: string; owner: string | null; due: string | null; at: number | null }>;
  questions: Array<{ text: string; at: number | null }>;
  quotes: Array<{ text: string; speaker: string | null; at: number | null }>;
  topics: Array<{ title: string; start: number }>;
};

/**
 * A recorded meeting: its audio is an audio library recording; this adds who spoke when (segments
 * with speaker ids, and names given to them), the markers tapped while recording, and the minutes.
 */
export const meetingsTable = pgTable("meetings", {
  id: serial("id").primaryKey(),
  libraryItemId: integer("library_item_id").notNull().unique(),
  title: text("title").notNull(),
  subjectId: integer("subject_id"),
  participants: jsonb("participants").$type<string[]>().notNull().default([]),
  agenda: text("agenda").notNull().default(""),
  markers: jsonb("markers").$type<MeetingMarker[]>().notNull().default([]),
  status: text("status", { enum: ["processing", "ready", "failed"] }).notNull().default("processing"),
  stage: text("stage"),
  error: text("error"),
  segments: jsonb("segments").$type<MeetingSegment[]>(),
  speakers: jsonb("speakers").$type<Record<string, string>>().notNull().default({}),
  minutes: jsonb("minutes").$type<MeetingMinutes>(),
  notes: jsonb("notes").$type<MeetingNote[]>().notNull().default([]),
  ideaId: integer("idea_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
export type MeetingRecord = typeof meetingsTable.$inferSelect;
