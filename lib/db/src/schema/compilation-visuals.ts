import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { subjectCompilationsTable } from "./subject-compilations";

/**
 * A visual made from a Creation studio draft: an AI-drawn picture (spec.prompt) or a diagram the
 * app draws itself from spec (concept map, steps, timeline, comparison, chart, key facts).
 */
export const compilationVisualsTable = pgTable(
  "compilation_visuals",
  {
    id: serial("id").primaryKey(),
    compilationId: integer("compilation_id").notNull().references(() => subjectCompilationsTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull().default(""),
    caption: text("caption").notNull().default(""),
    /** Why this visual helps (shown when choosing). */
    why: text("why").notNull().default(""),
    /** A few words of the draft it belongs after. */
    anchor: text("anchor").notNull().default(""),
    style: text("style").notNull().default(""),
    spec: jsonb("spec").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status", { enum: ["ready", "drawing", "failed"] }).notNull().default("ready"),
    /** The picture (drawn by AI, or the diagram as a PNG once added to the draft or downloaded). */
    imageUrl: text("image_url"),
    error: text("error"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("compilation_visuals_compilation_idx").on(table.compilationId)],
);
export type CompilationVisualRecord = typeof compilationVisualsTable.$inferSelect;
