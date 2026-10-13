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

/* ------------------------- Phases, voting, the AI's themes ------------------------- */

export const PHASES = ["free", "think", "share", "vote", "build", "present"] as const;
export type Phase = (typeof PHASES)[number];

/** When a phase's timer ends: minutes from now (0-120), or none. */
export function phaseEnd(minutes: unknown, now = Date.now()) {
  const value = Number(minutes);
  return Number.isFinite(value) && value > 0 ? new Date(now + Math.min(120, value) * 60_000) : null;
}

/**
 * Can this person put a dot on this card? Only while voting, on cards they can see but didn't
 * write, and only up to their dots (taking one back is always fine).
 */
export function canVote(input: { phase: Phase; own: boolean; already: boolean; used: number; allowed: number }) {
  if (input.phase !== "vote") return "Voting isn't open right now.";
  if (input.already) return null;
  if (input.own) return "You can't vote for your own idea.";
  if (input.used >= input.allowed) return "You've used all your dots. Take one back to move it.";
  return null;
}

export type SynthesisCard = { id: number; text: string; team: number | null; space: "team" | "all"; votes: number };

export function synthesisPrompt(challenge: string, language: string) {
  return [
    "You are facilitating a workshop. Participants shared ideas about the challenge below.",
    `Challenge: ${challenge || "(not given)"}`,
    "Read all the ideas and return JSON:",
    "- summary: 3-5 sentences on what the room came up with: the main directions and where people agree.",
    "- themes: 3-7 themes, each {\"title\": \"2-6 words\", \"summary\": \"one sentence\", \"cardIds\": [ids of the ideas in it]}. Every idea belongs to at most one theme.",
    "- standouts: up to 5 ideas worth discussing (original, practical, or popular), each {\"cardId\": id, \"why\": \"one sentence\"}.",
    "- gaps: up to 3 angles of the challenge nobody has covered yet (short sentences).",
    `Write in ${language === "ar" ? "Arabic" : language === "en" ? "English" : "the language most ideas are in"}. Use only the ideas given; never invent ideas. Answer with JSON only.`,
  ].join("\n");
}

const str = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** The AI's reading, checked: only real idea ids, each idea in one theme at most. */
export function cleanSynthesis(raw: unknown, ids: Set<number>) {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const used = new Set<number>();
  const themes = (Array.isArray(data.themes) ? data.themes : []).slice(0, 8).map((value) => {
    const theme = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const cardIds = (Array.isArray(theme.cardIds) ? theme.cardIds : []).map(Number).filter((id) => ids.has(id) && !used.has(id));
    cardIds.forEach((id) => used.add(id));
    return { title: str(theme.title, 80), summary: str(theme.summary, 300), cardIds };
  }).filter((theme) => theme.title && theme.cardIds.length);
  const standouts = (Array.isArray(data.standouts) ? data.standouts : []).slice(0, 5).map((value) => {
    const standout = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    return { cardId: Number(standout.cardId), why: str(standout.why, 300) };
  }).filter((standout) => ids.has(standout.cardId) && standout.why);
  const gaps = (Array.isArray(data.gaps) ? data.gaps : []).map((gap) => str(gap, 200)).filter(Boolean).slice(0, 3);
  const summary = str(data.summary, 1200);
  return summary || themes.length ? { summary, themes, standouts, gaps } : null;
}

const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The workshop report: challenge, numbers, the AI's summary and themes, top-voted ideas, every team's ideas. */
export function liveReportHtml(input: {
  title: string; challenge: string; date: Date; people: number; teamCount: number;
  cards: Array<{ id: number; text: string; author: string; team: number | null; space: "team" | "all"; votes: number }>;
  synthesis: { summary: string; themes: Array<{ title: string; summary: string; cardIds: number[] }>; standouts: Array<{ cardId: number; why: string }>; gaps: string[] } | null;
}) {
  const all = [...input.cards.map((c) => c.text), input.title, input.challenge].join(" ");
  const ar = (all.match(/[؀-ۿ]/g)?.length ?? 0) > (all.match(/[A-Za-z]/g)?.length ?? 0) / 2;
  const t = (en: string, arabic: string) => (ar ? arabic : en);
  const byId = new Map(input.cards.map((card) => [card.id, card]));
  const idea = (card: { text: string; author: string; votes: number }) => `${esc(card.text)} <small>— ${esc(card.author)}${card.votes ? ` · ${"●".repeat(Math.min(card.votes, 12))} ${card.votes}` : ""}</small>`;
  const top = input.cards.filter((card) => card.votes > 0).sort((a, b) => b.votes - a.votes).slice(0, 10);
  const parts = [
    `<p class="meta">${input.date.toLocaleDateString(ar ? "ar" : "en", { dateStyle: "long" })} · ${t(`${input.people} participants`, `${input.people} مشارك`)} · ${t(`${input.teamCount} teams`, `${input.teamCount} فرق`)} · ${t(`${input.cards.length} shared ideas`, `${input.cards.length} فكرة مشتركة`)}</p>`,
    input.challenge ? `<div class="challenge"><b>${t("The challenge", "التحدي")}</b><p>${esc(input.challenge)}</p></div>` : "",
  ];
  if (input.synthesis) {
    const s = input.synthesis;
    if (s.summary) parts.push(`<h2>${t("What the room came up with", "ما توصّلت إليه القاعة")}</h2><p>${esc(s.summary)}</p>`);
    if (s.themes.length) parts.push(`<h2>${t("Themes", "المحاور")}</h2>${s.themes.map((theme) => `<h3>${esc(theme.title)} <small>(${theme.cardIds.length})</small></h3><p class="muted">${esc(theme.summary)}</p><ul>${theme.cardIds.map((id) => byId.get(id)).filter(Boolean).map((card) => `<li>${idea(card!)}</li>`).join("")}</ul>`).join("")}`);
    if (s.standouts.length) parts.push(`<h2>${t("Ideas worth discussing", "أفكار تستحق النقاش")}</h2><ul>${s.standouts.map((x) => byId.get(x.cardId) ? `<li>${idea(byId.get(x.cardId)!)}<br><span class="muted">${esc(x.why)}</span></li>` : "").join("")}</ul>`);
    if (s.gaps.length) parts.push(`<h2>${t("Not covered yet", "لم تُغطَّ بعد")}</h2><ul>${s.gaps.map((gap) => `<li>${esc(gap)}</li>`).join("")}</ul>`);
  }
  if (top.length) parts.push(`<h2>${t("Most votes", "الأكثر أصواتًا")}</h2><ol>${top.map((card) => `<li>${idea(card)}</li>`).join("")}</ol>`);
  const teams = Array.from({ length: input.teamCount }, (_, i) => i + 1);
  for (const team of teams) {
    const ideas = input.cards.filter((card) => card.team === team && card.space === "team");
    if (ideas.length) parts.push(`<h2 class="team">${t(`Team ${team}`, `الفريق ${team}`)}</h2><ul>${ideas.map((card) => `<li>${idea(card)}</li>`).join("")}</ul>`);
  }
  const wall = input.cards.filter((card) => card.space === "all");
  if (wall.length) parts.push(`<h2>${t("Shared with everyone", "مشاركة مع الجميع")}</h2><ul>${wall.map((card) => `<li>${idea(card)}</li>`).join("")}</ul>`);
  return `<!doctype html><html lang="${ar ? "ar" : "en"}" dir="${ar ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>${esc(input.title)}</title>
<style>
  @page { size: A4; margin: 18mm; } body { color: #10231d; font: 14px/1.6 Arial, Tahoma, sans-serif; }
  header { border-bottom: 3px solid #1f5c4a; margin-bottom: 14px; padding-bottom: 8px; } header small { color: #1f5c4a; font-weight: bold; letter-spacing: .08em; text-transform: uppercase; }
  h1 { margin: 2px 0 0; font-size: 26px; } h2 { color: #1f5c4a; font-size: 18px; margin: 22px 0 6px; page-break-after: avoid; } h2.team { border-top: 1px solid #dde7e2; padding-top: 10px; }
  h3 { font-size: 15px; margin: 12px 0 2px; } .meta, .muted, small { color: #56706a; } .challenge { background: #fff7e6; border-radius: 10px; padding: 10px 14px; }
  .challenge p { margin: 4px 0 0; font-size: 15px; } li { margin: 4px 0; page-break-inside: avoid; }
</style></head><body><header><small>${t("Workshop report", "تقرير الورشة")}</small><h1>${esc(input.title)}</h1></header>${parts.join("\n")}</body></html>`;
}
