import { boolean, index, integer, jsonb, pgTable, primaryKey, serial, text, timestamp } from "drizzle-orm/pg-core";

export type LiveSynthesis = {
  summary: string;
  themes: Array<{ title: string; summary: string; cardIds: number[] }>;
  standouts: Array<{ cardId: number; why: string }>;
  gaps: string[];
};

/**
 * Live workshops. The owner runs a session; participants join with its code and a name (no
 * account). Cards are ideas in one of three spaces: "me" (only its author), "team", or "all".
 * Participants never see anything outside their session.
 */
export const liveSessionsTable = pgTable("live_sessions", {
  id: serial("id").primaryKey(),
  /** What people type or scan to join, e.g. "MYC482". */
  code: text("code").notNull().unique(),
  title: text("title").notNull(),
  /** The common problem everyone works on. */
  challenge: text("challenge").notNull().default(""),
  /** open: people can join; closed: no new people; ended: read only. */
  status: text("status", { enum: ["open", "closed", "ended"] }).notNull().default("open"),
  teamCount: integer("team_count").notNull().default(0),
  /** The step everyone is on (think alone, share in teams, vote, build, present), and when its timer ends. */
  phase: text("phase", { enum: ["free", "think", "share", "vote", "build", "present"] }).notNull().default("free"),
  phaseEndsAt: timestamp("phase_ends_at", { withTimezone: true }),
  votesPerPerson: integer("votes_per_person").notNull().default(3),
  /** The AI's reading of the room: summary, themes, standout ideas. */
  synthesis: jsonb("synthesis").$type<LiveSynthesis>(),
  synthesisAt: timestamp("synthesis_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const liveParticipantsTable = pgTable("live_participants", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => liveSessionsTable.id, { onDelete: "cascade" }),
  /** The device's secret (kept in a cookie), stored hashed. */
  tokenHash: text("token_hash").notNull().unique(),
  name: text("name").notNull(),
  emoji: text("emoji").notNull().default("🙂"),
  team: integer("team"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("live_participants_session_idx").on(table.sessionId)]);

export const liveCardsTable = pgTable("live_cards", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => liveSessionsTable.id, { onDelete: "cascade" }),
  /** Null for the instructor's own cards (prompts and announcements). */
  participantId: integer("participant_id").references(() => liveParticipantsTable.id, { onDelete: "cascade" }),
  space: text("space", { enum: ["me", "team", "all"] }).notNull().default("me"),
  team: integer("team"),
  text: text("text").notNull().default(""),
  mediaUrl: text("media_url"),
  mediaType: text("media_type"),
  /** "Build on this": the card it builds on. */
  parentId: integer("parent_id"),
  hidden: boolean("hidden").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [index("live_cards_session_idx").on(table.sessionId)]);

export const liveReactionsTable = pgTable("live_reactions", {
  cardId: integer("card_id").notNull().references(() => liveCardsTable.id, { onDelete: "cascade" }),
  /** 0 for the instructor. */
  participantId: integer("participant_id").notNull().default(0),
  emoji: text("emoji").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.cardId, table.participantId, table.emoji] })]);

export const liveCommentsTable = pgTable("live_comments", {
  id: serial("id").primaryKey(),
  cardId: integer("card_id").notNull().references(() => liveCardsTable.id, { onDelete: "cascade" }),
  participantId: integer("participant_id"),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("live_comments_card_idx").on(table.cardId)]);

/** Dot voting: one dot per person per card, up to the session's votes per person. */
export const liveVotesTable = pgTable("live_votes", {
  cardId: integer("card_id").notNull().references(() => liveCardsTable.id, { onDelete: "cascade" }),
  participantId: integer("participant_id").notNull().references(() => liveParticipantsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.cardId, table.participantId] })]);

export type LiveSession = typeof liveSessionsTable.$inferSelect;
export type LiveParticipant = typeof liveParticipantsTable.$inferSelect;
export type LiveCard = typeof liveCardsTable.$inferSelect;
