import { boolean, index, integer, pgTable, real, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Tasks: found in recordings ("Voice to Action") or added by hand. A task found in a recording
 * remembers the moment it was said (`at`, seconds) so it can be played back.
 */
export const tasksTable = pgTable(
  "tasks",
  {
    id: serial("id").primaryKey(),
    text: text("text").notNull(),
    /** Calendar date (YYYY-MM-DD) and optional time (HH:MM). */
    due: text("due"),
    time: text("time"),
    person: text("person"),
    done: boolean("done").notNull().default(false),
    doneAt: timestamp("done_at", { withTimezone: true }),
    source: text("source", { enum: ["recording", "manual"] }).notNull().default("manual"),
    /** The audio library recording it came from (a plain reference: deleting either keeps the other). */
    sourceId: integer("source_id"),
    at: real("at"),
    quote: text("quote"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("tasks_source_idx").on(table.source, table.sourceId)],
);
export type TaskRecord = typeof tasksTable.$inferSelect;
