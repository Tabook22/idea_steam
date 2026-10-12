/**
 * Live workshops: join codes, names, teams, and who sees which card. Kept free of the database so
 * the rules can be tested on their own.
 */
import { createHash, randomBytes, randomInt } from "node:crypto";

// No I, O, 0 or 1: nothing to confuse when read off a projector.
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";

/** A join code like "MYC482" (shown as "MYC-482"). */
export function makeCode(pick: (max: number) => number = randomInt) {
  let code = "";
  for (let i = 0; i < 3; i++) code += LETTERS[pick(LETTERS.length)];
  for (let i = 0; i < 3; i++) code += DIGITS[pick(DIGITS.length)];
  return code;
}

/** What someone typed or scanned, as a code: case, spaces and dashes don't matter. */
export const normalizeCode = (value: unknown) =>
  typeof value === "string" ? value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) : "";

export const newToken = () => randomBytes(24).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(`idea-live:${token}`).digest("hex");

export const EMOJIS = ["🙂", "😎", "🤓", "🦊", "🐼", "🦁", "🐯", "🐨", "🐙", "🦉", "🐝", "🌟", "🚀", "🌈", "🔥", "🍀"];
export const REACTIONS = ["👍", "💡", "❓"] as const;

/** A participant's name: trimmed, single spaces, 1–40 characters, no control characters. */
export function cleanName(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
}
export const cleanEmoji = (value: unknown) => (typeof value === "string" && EMOJIS.includes(value) ? value : EMOJIS[0]);
export const cleanText = (value: unknown, max = 2000) =>
  typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max) : "";

/**
 * Random, even teams of about `size` people: everyone gets a team number 1..n, and team sizes
 * differ by at most one.
 */
export function makeTeams(ids: number[], size: number, random: () => number = Math.random) {
  const people = [...ids];
  for (let i = people.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [people[i], people[j]] = [people[j], people[i]];
  }
  const count = Math.max(1, Math.ceil(people.length / Math.max(2, size)));
  const teams = new Map<number, number>();
  people.forEach((id, index) => teams.set(id, (index % count) + 1));
  return { count, teams };
}

/** Someone joining after teams were made goes to the smallest team (the lowest number on a tie). */
export function smallestTeam(teams: Array<number | null>, count: number) {
  if (count < 1) return null;
  const sizes = Array.from({ length: count }, (_, index) => teams.filter((team) => team === index + 1).length);
  return sizes.indexOf(Math.min(...sizes)) + 1;
}

export type Viewer = { kind: "instructor" } | { kind: "participant"; id: number; team: number | null };
type CardLike = { participantId: number | null; space: "me" | "team" | "all"; team: number | null; hidden: boolean };

/**
 * Who sees a card: "me" only its author; "team" its team (and the instructor); "all" everyone.
 * A card the instructor hid stays visible to its author and the instructor only.
 */
export function canSee(card: CardLike, viewer: Viewer) {
  const own = viewer.kind === "participant" && card.participantId === viewer.id;
  if (own) return true;
  if (card.space === "me") return false;
  if (viewer.kind === "instructor") return true;
  if (card.hidden) return false;
  if (card.space === "all") return true;
  return card.team !== null && card.team === viewer.team;
}
