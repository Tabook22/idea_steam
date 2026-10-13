import express, { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  liveCardsTable,
  liveCommentsTable,
  liveParticipantsTable,
  liveReactionsTable,
  liveSessionsTable,
  liveVotesTable,
  type LiveCard,
  type LiveParticipant,
  type LiveSession,
} from "@workspace/db";
import { readStoredFile, storeBytes } from "../lib/audio-edit";
import { canSee, canVote, cleanEmoji, cleanName, cleanSynthesis, cleanText, hashToken, liveReportHtml, makeCode, makeTeams, newToken, normalizeCode, phaseEnd, PHASES, REACTIONS, smallestTeam, synthesisPrompt, type Phase, type Viewer } from "../lib/live";
import { aiConfigured, openai } from "@workspace/integrations-openai-ai-server";
import { htmlToPdf } from "../lib/pdf";
import { TranscriptionBusyError, transcribeStoredAudio } from "../lib/stored-transcription";

/**
 * Live workshops. /live-admin/* is the owner's (behind the sign-in); /live/:code/* is for
 * participants, who join with the code and a name and get a pass in a cookie for that session.
 */
const router: IRouter = Router();
const BASE = (process.env.APP_BASE_PATH || "").replace(/\/$/, "") || "/";
const MAX_MEDIA = 15 * 1024 * 1024;

// "Has anything changed?" per session, so the many phones polling get a tiny answer most times.
const BOOT = Date.now();
const versions = new Map<number, number>();
const versionOf = (sessionId: number) => versions.get(sessionId) ?? BOOT;
const bump = (sessionId: number) => versions.set(sessionId, Math.max(versionOf(sessionId) + 1, Date.now()));

const cookieName = (code: string) => `idea_live_${code}`;
const readCookie = (req: Request, name: string) =>
  req.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;

// Small guards against floods (a prank in a room of a hundred people).
const hits = new Map<string, number[]>();
function tooMany(key: string, max: number, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((at) => now - at < windowMs)) hits.delete(k);
  return recent.length > max;
}

async function sessionByCode(code: string) {
  if (!code) return null;
  const [session] = await db.select().from(liveSessionsTable).where(eq(liveSessionsTable.code, code));
  return session ?? null;
}
async function sessionById(id: number) {
  const [session] = await db.select().from(liveSessionsTable).where(eq(liveSessionsTable.id, id));
  return session ?? null;
}

const seen = new Map<number, number>();
/** The participant whose pass this request carries, in this session. */
async function participantOf(req: Request, session: LiveSession) {
  const token = readCookie(req, cookieName(session.code)) ?? (typeof req.headers["x-live-token"] === "string" ? req.headers["x-live-token"] : null);
  if (!token || token.length > 100) return null;
  const [participant] = await db.select().from(liveParticipantsTable)
    .where(and(eq(liveParticipantsTable.tokenHash, hashToken(token)), eq(liveParticipantsTable.sessionId, session.id)));
  if (!participant) return null;
  // "Online" without a write on every poll.
  if (Date.now() - (seen.get(participant.id) ?? 0) > 30_000) {
    seen.set(participant.id, Date.now());
    await db.update(liveParticipantsTable).set({ lastSeen: new Date() }).where(eq(liveParticipantsTable.id, participant.id));
  }
  return participant;
}

const sessionView = (session: LiveSession) => ({
  id: session.id, code: session.code, title: session.title, challenge: session.challenge, status: session.status, teamCount: session.teamCount,
  phase: session.phase, phaseEndsAt: session.phaseEndsAt?.toISOString() ?? null, votesPerPerson: session.votesPerPerson,
  synthesis: session.synthesis ?? null, synthesisAt: session.synthesisAt?.toISOString() ?? null,
  createdAt: session.createdAt.toISOString(),
});
const personView = (participant: LiveParticipant) => ({
  id: participant.id, name: participant.name, emoji: participant.emoji, team: participant.team,
  online: Date.now() - participant.lastSeen.getTime() < 75_000,
});

/** Everything this viewer may see in the session: people, cards, reactions and comments. */
async function buildState(session: LiveSession, viewer: Viewer) {
  const people = await db.select().from(liveParticipantsTable).where(eq(liveParticipantsTable.sessionId, session.id)).orderBy(asc(liveParticipantsTable.id));
  const byId = new Map(people.map((person) => [person.id, person]));
  const all = await db.select().from(liveCardsTable).where(eq(liveCardsTable.sessionId, session.id)).orderBy(asc(liveCardsTable.id));
  const cards = all.filter((card) => canSee(card, viewer));
  const ids = cards.map((card) => card.id);
  const reactions = ids.length ? await db.select().from(liveReactionsTable).where(inArray(liveReactionsTable.cardId, ids)) : [];
  const comments = ids.length ? await db.select().from(liveCommentsTable).where(inArray(liveCommentsTable.cardId, ids)).orderBy(asc(liveCommentsTable.id)) : [];
  const votes = ids.length ? await db.select().from(liveVotesTable).where(inArray(liveVotesTable.cardId, ids)) : [];
  const me = viewer.kind === "participant" ? viewer.id : 0;
  // While voting, people see only their own dots (no following the crowd); afterwards, the totals.
  const showTotals = viewer.kind === "instructor" || session.phase !== "vote";
  const fileUrl = (card: LiveCard) => (viewer.kind === "instructor" ? `/api/live-admin/files/${card.id}` : `/api/live/${session.code}/files/${card.id}`);
  const author = (participantId: number | null) => {
    const person = participantId === null ? null : byId.get(participantId);
    return person ? { id: person.id, name: person.name, emoji: person.emoji, team: person.team } : null;
  };
  return {
    version: versionOf(session.id),
    session: sessionView(session),
    people: people.map(personView),
    cards: cards.map((card) => ({
      id: card.id, author: author(card.participantId), mine: card.participantId !== null && card.participantId === me,
      space: card.space, team: card.team, text: card.text, parentId: card.parentId, hidden: card.hidden,
      media: card.mediaType ? { url: fileUrl(card), type: card.mediaType } : null,
      reactions: REACTIONS.map((emoji) => {
        const these = reactions.filter((reaction) => reaction.cardId === card.id && reaction.emoji === emoji);
        return { emoji, count: these.length, mine: these.some((reaction) => reaction.participantId === me) };
      }),
      comments: comments.filter((comment) => comment.cardId === card.id).map((comment) => ({
        id: comment.id, author: author(comment.participantId), mine: comment.participantId === (viewer.kind === "participant" ? viewer.id : null), text: comment.text,
        createdAt: comment.createdAt.toISOString(),
      })),
      votes: showTotals ? votes.filter((vote) => vote.cardId === card.id).length : null,
      myVote: votes.some((vote) => vote.cardId === card.id && vote.participantId === me),
      createdAt: card.createdAt.toISOString(),
    })),
    now: new Date().toISOString(),
    ...(viewer.kind === "participant" ? { votesUsed: votes.filter((vote) => vote.participantId === me).length } : {}),
    // The instructor sees how much each person is writing privately, never what.
    ...(viewer.kind === "instructor" ? { privateCounts: Object.fromEntries(people.map((person) => [person.id, all.filter((card) => card.participantId === person.id && card.space === "me").length])) } : {}),
  };
}

async function sendFile(res: Response, card: LiveCard | undefined) {
  if (!card?.mediaUrl || !card.mediaType) { res.status(404).end(); return; }
  try {
    const bytes = await readStoredFile(card.mediaUrl);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.type(card.mediaType).send(bytes);
  } catch { res.status(404).end(); }
}

async function transcribe(url: string) {
  for (let attempt = 0; attempt < 30; attempt++) {
    try { return await transcribeStoredAudio(url, "auto"); }
    catch (error) {
      if (!(error instanceof TranscriptionBusyError)) { console.warn("Live: transcription failed:", (error as Error).message); return ""; }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  return "";
}

/* ------------------------------ The instructor ------------------------------ */

router.get("/live-admin/sessions", async (_req, res): Promise<void> => {
  const sessions = await db.select().from(liveSessionsTable).orderBy(desc(liveSessionsTable.createdAt));
  const people = await db.select({ sessionId: liveParticipantsTable.sessionId, count: sql<number>`count(*)::int` }).from(liveParticipantsTable).groupBy(liveParticipantsTable.sessionId);
  const cards = await db.select({ sessionId: liveCardsTable.sessionId, count: sql<number>`count(*)::int` }).from(liveCardsTable).groupBy(liveCardsTable.sessionId);
  res.json(sessions.map((session) => ({
    ...sessionView(session),
    participantCount: people.find((row) => row.sessionId === session.id)?.count ?? 0,
    cardCount: cards.find((row) => row.sessionId === session.id)?.count ?? 0,
  })));
});

router.post("/live-admin/sessions", async (req, res): Promise<void> => {
  const title = cleanText(req.body?.title, 120);
  if (!title) { res.status(400).json({ error: "Give the session a name." }); return; }
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = makeCode();
    if (await sessionByCode(code)) continue;
    const [session] = await db.insert(liveSessionsTable).values({ code, title, challenge: cleanText(req.body?.challenge, 4000) }).returning();
    res.status(201).json(sessionView(session!));
    return;
  }
  res.status(503).json({ error: "Couldn't make a join code. Try again." });
});

const adminSession = async (req: Request, res: Response) => {
  const session = await sessionById(Number(req.params.sessionId));
  if (!session) res.status(404).json({ error: "Session not found" });
  return session;
};

router.get("/live-admin/sessions/:sessionId/state", async (req, res): Promise<void> => {
  const session = await adminSession(req, res);
  if (!session) return;
  if (Number(req.query.since) === versionOf(session.id)) { res.json({ version: versionOf(session.id), unchanged: true }); return; }
  res.json(await buildState(session, { kind: "instructor" }));
});

router.patch("/live-admin/sessions/:sessionId", async (req, res): Promise<void> => {
  const session = await adminSession(req, res);
  if (!session) return;
  const changes: Partial<typeof liveSessionsTable.$inferInsert> = {};
  if (typeof req.body?.title === "string" && cleanText(req.body.title, 120)) changes.title = cleanText(req.body.title, 120);
  if (typeof req.body?.challenge === "string") changes.challenge = cleanText(req.body.challenge, 4000);
  if (["open", "closed", "ended"].includes(req.body?.status)) changes.status = req.body.status;
  // Phases: everyone's screen follows; an optional timer in minutes.
  if ((PHASES as readonly string[]).includes(req.body?.phase)) {
    changes.phase = req.body.phase as Phase;
    changes.phaseEndsAt = phaseEnd(req.body?.minutes);
  }
  if (req.body?.addMinutes !== undefined) {
    const base = session.phaseEndsAt && session.phaseEndsAt.getTime() > Date.now() ? session.phaseEndsAt.getTime() : Date.now();
    changes.phaseEndsAt = phaseEnd(Number(req.body.addMinutes), base);
  }
  if (req.body?.stopTimer) changes.phaseEndsAt = null;
  const perPerson = Number(req.body?.votesPerPerson);
  if (Number.isInteger(perPerson) && perPerson >= 1 && perPerson <= 10) changes.votesPerPerson = perPerson;
  if (Object.keys(changes).length) await db.update(liveSessionsTable).set(changes).where(eq(liveSessionsTable.id, session.id));
  bump(session.id);
  res.json(sessionView((await sessionById(session.id))!));
});

router.post("/live-admin/sessions/:sessionId/votes/clear", async (req, res): Promise<void> => {
  const session = await adminSession(req, res);
  if (!session) return;
  await db.execute(sql`delete from live_votes v using live_cards c where v.card_id = c.id and c.session_id = ${session.id}`);
  bump(session.id);
  res.json({ ok: true });
});

/** The shared ideas (team and everyone, never private), with their votes. */
async function sharedIdeas(session: LiveSession) {
  const cards = await db.select().from(liveCardsTable).where(eq(liveCardsTable.sessionId, session.id)).orderBy(asc(liveCardsTable.id));
  const people = await db.select().from(liveParticipantsTable).where(eq(liveParticipantsTable.sessionId, session.id));
  const names = new Map(people.map((person) => [person.id, person.name]));
  const shared = cards.filter((card) => card.space !== "me" && !card.hidden && card.text.trim());
  const votes = shared.length ? await db.select().from(liveVotesTable).where(inArray(liveVotesTable.cardId, shared.map((card) => card.id))) : [];
  return {
    people: people.length,
    cards: shared.map((card) => ({
      id: card.id, text: card.text, team: card.team, space: card.space as "team" | "all",
      author: card.participantId === null ? "Instructor" : names.get(card.participantId) ?? "?",
      votes: votes.filter((vote) => vote.cardId === card.id).length,
    })),
  };
}

/** The AI reads all shared ideas: a summary of the room, themes, standout ideas, what's missing. */
router.post("/live-admin/sessions/:sessionId/synthesize", async (req, res): Promise<void> => {
  const session = await adminSession(req, res);
  if (!session) return;
  if (!aiConfigured) { res.status(503).json({ error: "AI is not configured yet." }); return; }
  const { cards } = await sharedIdeas(session);
  if (cards.length < 3) { res.status(409).json({ error: "Wait for at least 3 shared ideas." }); return; }
  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_ANALYSIS_MODEL || (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ? (process.env.OPENAI_TEXT_MODEL || "gpt-5.6-luna") : "gpt-4.1"),
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: synthesisPrompt(session.challenge, typeof req.body?.language === "string" ? req.body.language : "auto") },
        { role: "user", content: cards.map((card) => `#${card.id} [${card.space === "team" ? `Team ${card.team}` : "Everyone"}${card.votes ? `, ${card.votes} votes` : ""}] ${card.text.slice(0, 600)}`).join("\n").slice(0, 80_000) },
      ],
    }, { timeout: 120_000, maxRetries: 1 });
    let raw: unknown = null;
    try { raw = JSON.parse(response.choices[0]?.message?.content ?? "null"); } catch { /* below */ }
    const synthesis = cleanSynthesis(raw, new Set(cards.map((card) => card.id)));
    if (!synthesis) { res.status(502).json({ error: "The AI didn't return themes. Try again." }); return; }
    await db.update(liveSessionsTable).set({ synthesis, synthesisAt: new Date() }).where(eq(liveSessionsTable.id, session.id));
    bump(session.id);
    res.json({ synthesis });
  } catch (error) {
    console.warn("Live synthesis failed:", (error as Error).message);
    res.status(502).json({ error: "The ideas couldn't be read right now. Try again." });
  }
});

/** The workshop report as a PDF. */
router.get("/live-admin/sessions/:sessionId/report", async (req, res): Promise<void> => {
  const session = await adminSession(req, res);
  if (!session) return;
  const { people, cards } = await sharedIdeas(session);
  try {
    const pdf = await htmlToPdf(liveReportHtml({ title: session.title, challenge: session.challenge, date: session.createdAt, people, teamCount: session.teamCount, cards, synthesis: session.synthesis ?? null }));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`${session.title.replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().slice(0, 60) || "workshop"} - report.pdf`)}`);
    res.send(pdf);
  } catch (error) {
    console.warn("Live report failed:", (error as Error).message);
    res.status(500).json({ error: "The report couldn't be made on the server." });
  }
});

router.delete("/live-admin/sessions/:sessionId", async (req, res): Promise<void> => {
  const session = await adminSession(req, res);
  if (!session) return;
  await db.delete(liveSessionsTable).where(eq(liveSessionsTable.id, session.id));
  versions.delete(session.id);
  res.sendStatus(204);
});

/** Teams: everyone (or nobody) in random, even teams of about `size`. Team cards follow their authors. */
router.post("/live-admin/sessions/:sessionId/teams", async (req, res): Promise<void> => {
  const session = await adminSession(req, res);
  if (!session) return;
  const people = await db.select({ id: liveParticipantsTable.id }).from(liveParticipantsTable).where(eq(liveParticipantsTable.sessionId, session.id));
  if (req.body?.clear) {
    await db.update(liveParticipantsTable).set({ team: null }).where(eq(liveParticipantsTable.sessionId, session.id));
    await db.update(liveSessionsTable).set({ teamCount: 0 }).where(eq(liveSessionsTable.id, session.id));
  } else {
    const size = Math.min(12, Math.max(2, Number(req.body?.size) || 4));
    const { count, teams } = makeTeams(people.map((person) => person.id), size);
    for (const team of new Set(teams.values()))
      await db.update(liveParticipantsTable).set({ team }).where(inArray(liveParticipantsTable.id, [...teams].filter(([, t]) => t === team).map(([id]) => id)));
    await db.update(liveSessionsTable).set({ teamCount: people.length ? count : 0 }).where(eq(liveSessionsTable.id, session.id));
  }
  await db.execute(sql`update live_cards c set team = p.team from live_participants p where c.participant_id = p.id and c.session_id = ${session.id} and c.space = 'team'`);
  bump(session.id);
  res.json(await buildState((await sessionById(session.id))!, { kind: "instructor" }));
});

router.patch("/live-admin/participants/:participantId", async (req, res): Promise<void> => {
  const [person] = await db.select().from(liveParticipantsTable).where(eq(liveParticipantsTable.id, Number(req.params.participantId)));
  const session = person ? await sessionById(person.sessionId) : null;
  if (!person || !session) { res.status(404).json({ error: "Not found" }); return; }
  const team = req.body?.team === null ? null : Number(req.body?.team);
  if (team !== null && !(Number.isInteger(team) && team >= 1 && team <= Math.max(session.teamCount, 1) + 1)) { res.status(400).json({ error: "Unknown team" }); return; }
  await db.update(liveParticipantsTable).set({ team }).where(eq(liveParticipantsTable.id, person.id));
  // Moving someone into a new team number adds that team.
  if (team !== null && team > session.teamCount) await db.update(liveSessionsTable).set({ teamCount: team }).where(eq(liveSessionsTable.id, session.id));
  await db.update(liveCardsTable).set({ team }).where(and(eq(liveCardsTable.participantId, person.id), eq(liveCardsTable.space, "team")));
  bump(session.id);
  res.json({ ok: true });
});

router.delete("/live-admin/participants/:participantId", async (req, res): Promise<void> => {
  const [person] = await db.delete(liveParticipantsTable).where(eq(liveParticipantsTable.id, Number(req.params.participantId))).returning();
  if (person) bump(person.sessionId);
  res.sendStatus(204);
});

router.post("/live-admin/sessions/:sessionId/cards", async (req, res): Promise<void> => {
  const session = await adminSession(req, res);
  if (!session) return;
  const text = cleanText(req.body?.text);
  if (!text) { res.status(400).json({ error: "Write something first." }); return; }
  await db.insert(liveCardsTable).values({ sessionId: session.id, participantId: null, space: "all", text });
  bump(session.id);
  res.status(201).json({ ok: true });
});

async function adminCard(req: Request, res: Response) {
  const [card] = await db.select().from(liveCardsTable).where(eq(liveCardsTable.id, Number(req.params.cardId)));
  if (!card || card.space === "me") { res.status(404).json({ error: "Not found" }); return null; }
  return card;
}
router.patch("/live-admin/cards/:cardId", async (req, res): Promise<void> => {
  const card = await adminCard(req, res);
  if (!card) return;
  if (typeof req.body?.hidden === "boolean") await db.update(liveCardsTable).set({ hidden: req.body.hidden }).where(eq(liveCardsTable.id, card.id));
  bump(card.sessionId);
  res.json({ ok: true });
});
router.delete("/live-admin/cards/:cardId", async (req, res): Promise<void> => {
  const card = await adminCard(req, res);
  if (!card) return;
  await db.delete(liveCardsTable).where(eq(liveCardsTable.id, card.id));
  bump(card.sessionId);
  res.sendStatus(204);
});
router.post("/live-admin/cards/:cardId/comments", async (req, res): Promise<void> => {
  const card = await adminCard(req, res);
  const text = cleanText(req.body?.text, 1000);
  if (!card) return;
  if (!text) { res.status(400).json({ error: "Write a comment first." }); return; }
  await db.insert(liveCommentsTable).values({ cardId: card.id, participantId: null, text });
  bump(card.sessionId);
  res.status(201).json({ ok: true });
});
router.get("/live-admin/files/:cardId", async (req, res): Promise<void> => {
  const [card] = await db.select().from(liveCardsTable).where(eq(liveCardsTable.id, Number(req.params.cardId)));
  await sendFile(res, card && card.space !== "me" ? card : undefined);
});

/* ------------------------------ Participants ------------------------------ */

async function liveSession(req: Request, res: Response) {
  const session = await sessionByCode(normalizeCode(req.params.code));
  if (!session) { res.status(404).json({ error: "There's no session with this code. Check the code on the screen." }); return null; }
  return session;
}
async function member(req: Request, res: Response) {
  const session = await liveSession(req, res);
  if (!session) return null;
  const person = await participantOf(req, session);
  if (!person) { res.status(401).json({ error: "Join the session first." }); return null; }
  return { session, person };
}
const writable = (session: LiveSession, res: Response) => {
  if (session.status === "ended") { res.status(409).json({ error: "This session has ended. You can still read everything." }); return false; }
  return true;
};

/** What the join screen shows, and who you are if this phone already joined. */
router.get("/live/:code", async (req, res): Promise<void> => {
  const session = await liveSession(req, res);
  if (!session) return;
  const person = await participantOf(req, session);
  res.json({ code: session.code, title: session.title, challenge: session.challenge, status: session.status, me: person ? personView(person) : null });
});

router.post("/live/:code/join", async (req, res): Promise<void> => {
  const session = await liveSession(req, res);
  if (!session) return;
  if (tooMany(`join:${req.ip}`, 30)) { res.status(429).json({ error: "Too many tries. Wait a minute." }); return; }
  const existing = await participantOf(req, session);
  const name = cleanName(req.body?.name);
  if (!name) { res.status(400).json({ error: "Type your name." }); return; }
  const emoji = cleanEmoji(req.body?.emoji);
  if (existing) {
    await db.update(liveParticipantsTable).set({ name, emoji }).where(eq(liveParticipantsTable.id, existing.id));
    bump(session.id);
    res.json({ me: personView({ ...existing, name, emoji }) });
    return;
  }
  if (session.status !== "open") { res.status(409).json({ error: session.status === "ended" ? "This session has ended." : "Joining is closed for this session. Ask the instructor." }); return; }
  const people = await db.select({ team: liveParticipantsTable.team }).from(liveParticipantsTable).where(eq(liveParticipantsTable.sessionId, session.id));
  if (people.length >= 500) { res.status(409).json({ error: "This session is full." }); return; }
  const token = newToken();
  const [person] = await db.insert(liveParticipantsTable).values({
    sessionId: session.id, tokenHash: hashToken(token), name, emoji,
    // Teams already made: join the smallest.
    team: smallestTeam(people.map((p) => p.team), session.teamCount),
  }).returning();
  res.append("Set-Cookie", [
    `${cookieName(session.code)}=${token}`, `Path=${BASE}`, "HttpOnly", "SameSite=Lax", ...(req.secure ? ["Secure"] : []), `Max-Age=${60 * 60 * 24 * 30}`,
  ].join("; "));
  bump(session.id);
  res.status(201).json({ me: personView(person!) });
});

router.get("/live/:code/state", async (req, res): Promise<void> => {
  const found = await member(req, res);
  if (!found) return;
  if (Number(req.query.since) === versionOf(found.session.id)) { res.json({ version: versionOf(found.session.id), unchanged: true }); return; }
  res.json({ ...(await buildState(found.session, { kind: "participant", id: found.person.id, team: found.person.team })), me: personView(found.person) });
});

async function createCard(session: LiveSession, person: LiveParticipant, values: { text: string; space: unknown; parentId: unknown; mediaUrl?: string; mediaType?: string }, res: Response) {
  const space = values.space === "team" || values.space === "all" ? values.space : "me";
  if (space === "team" && person.team === null) { res.status(409).json({ error: "You're not in a team yet. Your instructor will put you in one." }); return; }
  if (tooMany(`card:${person.id}`, 30)) { res.status(429).json({ error: "That's a lot of ideas at once! Wait a moment." }); return; }
  let parentId: number | null = null;
  if (values.parentId != null) {
    const [parent] = await db.select().from(liveCardsTable).where(and(eq(liveCardsTable.id, Number(values.parentId)), eq(liveCardsTable.sessionId, session.id)));
    if (parent && canSee(parent, { kind: "participant", id: person.id, team: person.team })) parentId = parent.id;
  }
  const [card] = await db.insert(liveCardsTable).values({
    sessionId: session.id, participantId: person.id, space, team: space === "team" ? person.team : null, text: values.text, parentId,
    ...(values.mediaUrl ? { mediaUrl: values.mediaUrl, mediaType: values.mediaType } : {}),
  }).returning();
  bump(session.id);
  res.status(201).json({ id: card!.id, text: card!.text });
}

router.post("/live/:code/cards", async (req, res): Promise<void> => {
  const found = await member(req, res);
  if (!found || !writable(found.session, res)) return;
  const text = cleanText(req.body?.text);
  if (!text) { res.status(400).json({ error: "Write your idea first." }); return; }
  await createCard(found.session, found.person, { text, space: req.body?.space, parentId: req.body?.parentId }, res);
});

/** A photo or a voice note (the voice is written out as text). Sent as the raw file. */
router.post("/live/:code/cards/media", express.raw({ type: ["image/*", "audio/*", "video/webm"], limit: MAX_MEDIA }), async (req, res): Promise<void> => {
  const found = await member(req, res);
  if (!found || !writable(found.session, res)) return;
  const type = String(req.headers["content-type"] ?? "").split(";")[0]!.trim();
  const bytes = req.body as Buffer;
  if (!Buffer.isBuffer(bytes) || !bytes.length || !/^(image\/(jpeg|png|webp|gif|heic|heif)|audio\/[\w.+-]+|video\/webm)$/.test(type)) { res.status(400).json({ error: "Send a photo or a voice note." }); return; }
  const voice = !type.startsWith("image/");
  const mediaType = type === "video/webm" ? "audio/webm" : type;
  const url = await storeBytes(bytes, mediaType);
  const caption = cleanText(req.query.text);
  const text = voice ? (await transcribe(url)) || caption : caption;
  await createCard(found.session, found.person, { text, space: req.query.space, parentId: req.query.parentId ?? null, mediaUrl: url, mediaType }, res);
});

async function ownCard(req: Request, res: Response) {
  const found = await member(req, res);
  if (!found) return null;
  const [card] = await db.select().from(liveCardsTable).where(and(eq(liveCardsTable.id, Number(req.params.cardId)), eq(liveCardsTable.sessionId, found.session.id)));
  if (!card || !canSee(card, { kind: "participant", id: found.person.id, team: found.person.team })) { res.status(404).json({ error: "Not found" }); return null; }
  return { ...found, card };
}

/** Share your card with the team or everyone (or take it back), or change its words. */
router.patch("/live/:code/cards/:cardId", async (req, res): Promise<void> => {
  const found = await ownCard(req, res);
  if (!found || !writable(found.session, res)) return;
  if (found.card.participantId !== found.person.id) { res.status(403).json({ error: "Only its author can change it." }); return; }
  const changes: Partial<typeof liveCardsTable.$inferInsert> = {};
  const space = req.body?.space;
  if (space === "me" || space === "team" || space === "all") {
    if (space === "team" && found.person.team === null) { res.status(409).json({ error: "You're not in a team yet." }); return; }
    changes.space = space;
    changes.team = space === "team" ? found.person.team : null;
  }
  if (typeof req.body?.text === "string") changes.text = cleanText(req.body.text);
  if (Object.keys(changes).length) await db.update(liveCardsTable).set(changes).where(eq(liveCardsTable.id, found.card.id));
  bump(found.session.id);
  res.json({ ok: true });
});

router.delete("/live/:code/cards/:cardId", async (req, res): Promise<void> => {
  const found = await ownCard(req, res);
  if (!found || !writable(found.session, res)) return;
  if (found.card.participantId !== found.person.id) { res.status(403).json({ error: "Only its author can delete it." }); return; }
  await db.delete(liveCardsTable).where(eq(liveCardsTable.id, found.card.id));
  bump(found.session.id);
  res.sendStatus(204);
});

router.post("/live/:code/cards/:cardId/react", async (req, res): Promise<void> => {
  const found = await ownCard(req, res);
  if (!found || !writable(found.session, res)) return;
  const emoji = req.body?.emoji;
  if (!(REACTIONS as readonly string[]).includes(emoji)) { res.status(400).json({ error: "Unknown reaction" }); return; }
  const key = and(eq(liveReactionsTable.cardId, found.card.id), eq(liveReactionsTable.participantId, found.person.id), eq(liveReactionsTable.emoji, emoji));
  const [had] = await db.select().from(liveReactionsTable).where(key);
  if (had) await db.delete(liveReactionsTable).where(key);
  else await db.insert(liveReactionsTable).values({ cardId: found.card.id, participantId: found.person.id, emoji });
  bump(found.session.id);
  res.json({ on: !had });
});

/** Dot voting: put a dot on an idea, or take it back. */
router.post("/live/:code/cards/:cardId/vote", async (req, res): Promise<void> => {
  const found = await ownCard(req, res);
  if (!found || !writable(found.session, res)) return;
  const key = and(eq(liveVotesTable.cardId, found.card.id), eq(liveVotesTable.participantId, found.person.id));
  const [had] = await db.select().from(liveVotesTable).where(key);
  const used = await db.execute(sql`select count(*)::int as n from live_votes v join live_cards c on c.id = v.card_id where v.participant_id = ${found.person.id} and c.session_id = ${found.session.id}`);
  const problem = canVote({ phase: found.session.phase, own: found.card.participantId === found.person.id || found.card.space === "me", already: !!had, used: Number((used.rows[0] as { n: number }).n), allowed: found.session.votesPerPerson });
  if (problem) { res.status(409).json({ error: problem }); return; }
  if (had) await db.delete(liveVotesTable).where(key);
  else await db.insert(liveVotesTable).values({ cardId: found.card.id, participantId: found.person.id });
  bump(found.session.id);
  res.json({ on: !had });
});

router.post("/live/:code/cards/:cardId/comments", async (req, res): Promise<void> => {
  const found = await ownCard(req, res);
  if (!found || !writable(found.session, res)) return;
  const text = cleanText(req.body?.text, 1000);
  if (!text) { res.status(400).json({ error: "Write a comment first." }); return; }
  if (tooMany(`comment:${found.person.id}`, 40)) { res.status(429).json({ error: "Wait a moment." }); return; }
  await db.insert(liveCommentsTable).values({ cardId: found.card.id, participantId: found.person.id, text });
  bump(found.session.id);
  res.status(201).json({ ok: true });
});

router.delete("/live/:code/comments/:commentId", async (req, res): Promise<void> => {
  const found = await member(req, res);
  if (!found) return;
  const [comment] = await db.delete(liveCommentsTable)
    .where(and(eq(liveCommentsTable.id, Number(req.params.commentId)), eq(liveCommentsTable.participantId, found.person.id))).returning();
  if (comment) bump(found.session.id);
  res.sendStatus(204);
});

router.get("/live/:code/files/:cardId", async (req, res): Promise<void> => {
  const found = await member(req, res);
  if (!found) return;
  const [card] = await db.select().from(liveCardsTable).where(and(eq(liveCardsTable.id, Number(req.params.cardId)), eq(liveCardsTable.sessionId, found.session.id)));
  await sendFile(res, card && canSee(card, { kind: "participant", id: found.person.id, team: found.person.team }) ? card : undefined);
});

export default router;
