import { integer, pgTable, real, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * "Ask your library" index: recordings, ideas and drafts cut into short passages, each with an
 * embedding (its meaning as numbers). Rebuilt piece by piece when the source text changes; it
 * holds no data of its own, so it can be emptied at any time.
 */
export const askPassagesTable = pgTable(
  "ask_passages",
  {
    id: serial("id").primaryKey(),
    source: text("source", { enum: ["recording", "idea", "draft"] }).notNull(),
    sourceId: integer("source_id").notNull(),
    part: integer("part").notNull(),
    hash: text("hash").notNull(),
    start: real("start"),
    header: text("header").notNull(),
    text: text("text").notNull(),
    embedding: real("embedding").array(),
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("ask_passages_source_part_idx").on(table.source, table.sourceId, table.part)],
);
export type AskPassageRecord = typeof askPassagesTable.$inferSelect;
