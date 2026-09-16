import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { subjectCompilationsTable } from "./subject-compilations";

export const compilationImagesTable = pgTable(
  "idea_compilation_images",
  {
    id: serial("id").primaryKey(),
    compilationId: integer("compilation_id")
      .notNull()
      .references(() => subjectCompilationsTable.id, { onDelete: "cascade" }),
    objectPath: text("object_path").notNull(),
    altText: text("alt_text").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idea_compilation_images_compilation_object_idx").on(
      table.compilationId,
      table.objectPath,
    ),
  ],
);

export const insertCompilationImageSchema = createInsertSchema(compilationImagesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertCompilationImage = z.infer<typeof insertCompilationImageSchema>;
export type CompilationImageRecord = typeof compilationImagesTable.$inferSelect;