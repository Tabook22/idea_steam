import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { subjectsTable } from "./subjects";

export const subjectCompilationsTable = pgTable("idea_subject_compilations", {
  id: serial("id").primaryKey(),
  subjectId: integer("subject_id")
    .notNull()
    .references(() => subjectsTable.id, { onDelete: "cascade" }),
  tone: text("tone").notNull().default("clear"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertSubjectCompilationSchema = createInsertSchema(subjectCompilationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSubjectCompilation = z.infer<typeof insertSubjectCompilationSchema>;
export type SubjectCompilationRecord = typeof subjectCompilationsTable.$inferSelect;