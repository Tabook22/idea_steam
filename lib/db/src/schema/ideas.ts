import {
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { subjectsTable } from "./subjects";

export const ideasTable = pgTable("ideas", {
  id: serial("id").primaryKey(),
  subjectId: integer("subject_id")
    .notNull()
    .references(() => subjectsTable.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  source: text("source", { enum: ["text", "voice", "image", "video", "audio", "pdf", "document", "link"] }).notNull().default("text"),
  attachments: jsonb("attachments")
    .$type<Array<{
      type: "image" | "video" | "audio" | "pdf" | "document" | "link";
      url: string;
      name: string;
      mimeType?: string;
      note?: string;
    }>>()
    .notNull()
    .default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertIdeaSchema = createInsertSchema(ideasTable).omit({
  id: true,
  createdAt: true,
});

export type InsertIdea = z.infer<typeof insertIdeaSchema>;
export type IdeaRecord = typeof ideasTable.$inferSelect;