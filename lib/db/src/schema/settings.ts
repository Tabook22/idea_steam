import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Settings the server keeps (one row per key), e.g. "telegram". Never sent to the app as a whole. */
export const appSettingsTable = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
