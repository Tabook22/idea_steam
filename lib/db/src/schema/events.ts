import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/** A place: its name (and address), and where it is on the map when known. */
export type Place = { name: string; address?: string; lat?: number; lng?: number };

/**
 * Something on the calendar: a meeting to hold (and later record) or any other event. Reminders are
 * minutes before the start; "reminded" holds the ones already sent for the current start time.
 */
export const eventsTable = pgTable("events", {
  id: serial("id").primaryKey(),
  kind: text("kind", { enum: ["meeting", "event"] }).notNull().default("meeting"),
  title: text("title").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  allDay: boolean("all_day").notNull().default(false),
  location: jsonb("location").$type<Place>(),
  subjectId: integer("subject_id"),
  participants: jsonb("participants").$type<string[]>().notNull().default([]),
  agenda: text("agenda").notNull().default(""),
  notes: text("notes").notNull().default(""),
  reminders: jsonb("reminders").$type<number[]>().notNull().default([30]),
  reminded: jsonb("reminded").$type<number[]>().notNull().default([]),
  /** The recorded meeting, once it took place. */
  meetingId: integer("meeting_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [index("events_starts_idx").on(table.startsAt)]);
export type EventRecord = typeof eventsTable.$inferSelect;

/** A phone or browser that gets reminder notifications (Web Push). */
export const pushSubscriptionsTable = pgTable("push_subscriptions", {
  endpoint: text("endpoint").primaryKey(),
  keys: jsonb("keys").$type<{ p256dh: string; auth: string }>().notNull(),
  device: text("device").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
