import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ideasTable } from "./ideas";

export const ideaChatMessagesTable = pgTable("idea_chat_messages", {
  id: serial("id").primaryKey(),
  ideaId: integer("idea_id")
    .notNull()
    .references(() => ideasTable.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertIdeaChatMessageSchema = createInsertSchema(
  ideaChatMessagesTable,
).omit({
  id: true,
  createdAt: true,
});

export type InsertIdeaChatMessage = z.infer<
  typeof insertIdeaChatMessageSchema
>;
export type IdeaChatMessageRecord =
  typeof ideaChatMessagesTable.$inferSelect;