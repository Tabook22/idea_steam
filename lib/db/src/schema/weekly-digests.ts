import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** One AI digest per week ("2026-W41"): themes, open questions, notebooks ready to draft. */
export const weeklyDigestsTable = pgTable("weekly_digests", {
  week: text("week").primaryKey(),
  language: text("language").notNull().default("en"),
  content: jsonb("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type WeeklyDigestRecord = typeof weeklyDigestsTable.$inferSelect;
