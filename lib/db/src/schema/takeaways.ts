import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { ideasTable } from "./ideas";

export type TakeawayPoint = {
  title: string;
  summary: string;
  details: string;
  why: string;
  /** Words copied from the idea (checked to be really there), or "". */
  quote: string;
  kind: "insight" | "fact" | "action" | "question" | "argument" | "example";
};
export type Takeaways = { gist: string; points: TakeawayPoint[]; words: number };

/** An idea's key takeaways, kept with a fingerprint of the text they were made from. */
export const ideaTakeawaysTable = pgTable("idea_takeaways", {
  ideaId: integer("idea_id").primaryKey().references(() => ideasTable.id, { onDelete: "cascade" }),
  sourceHash: text("source_hash").notNull(),
  data: jsonb("data").$type<Takeaways>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
