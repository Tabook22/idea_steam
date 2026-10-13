import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export type QuizQuestion = {
  type: "choice" | "truefalse" | "short";
  question: string;
  /** Choices (type "choice"); "True"/"False" in the pack's language for true/false. */
  options: string[];
  /** Index of the right option, or -1 for a short answer. */
  answer: number;
  /** The model answer (short answers), or the right option's words. */
  answerText: string;
  explanation: string;
  /** Words from the source that back the answer (checked to be really there), or "". */
  quote: string;
};
export type StudyPackData = {
  intro: string;
  sections: Array<{ heading: string; points: string[] }>;
  terms: Array<{ term: string; meaning: string }>;
  concept: { center: string; branches: Array<{ label: string; items: string[] }> } | null;
  quiz: QuizQuestion[];
  cards: Array<{ front: string; back: string }>;
  words: number;
  language: "ar" | "en";
};
export type StudyPackOptions = { questions: number; difficulty: "easy" | "mixed" | "hard"; audience: "kids" | "students" | "adults"; language: "auto" | "ar" | "en" };
/** Flashcard reviews: card index → its box (1-5, higher = known better) and when it's due next. */
export type StudyReviews = Record<string, { box: number; due: string }>;

/** A study pack made by AI from a recording, a notebook (subject) or a draft. */
export const studyPacksTable = pgTable("study_packs", {
  id: serial("id").primaryKey(),
  sourceKind: text("source_kind", { enum: ["recording", "subject", "draft"] }).notNull(),
  sourceId: integer("source_id").notNull(),
  title: text("title").notNull(),
  options: jsonb("options").$type<StudyPackOptions>().notNull(),
  status: text("status", { enum: ["making", "ready", "failed"] }).notNull().default("making"),
  error: text("error"),
  data: jsonb("data").$type<StudyPackData>(),
  reviews: jsonb("reviews").$type<StudyReviews>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [index("study_packs_source_idx").on(table.sourceKind, table.sourceId)]);
export type StudyPackRecord = typeof studyPacksTable.$inferSelect;
