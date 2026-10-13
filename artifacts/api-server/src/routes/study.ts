import { Router, type IRouter, type Response } from "express";
import { asc, desc, eq } from "drizzle-orm";
import { audioLibraryTable, db, ideasTable, studyPacksTable, subjectCompilationsTable, subjectsTable, type StudyPackRecord } from "@workspace/db";
import { aiConfigured, openai } from "@workspace/integrations-openai-ai-server";
import { htmlToPdf } from "../lib/pdf";
import { cleanOptions, cleanStudy, dueCards, handoutHtml, reviewCard, studyPrompt, wordCount } from "../lib/study";
import { plainDraft } from "../lib/visuals";

/** Study packs: made in the background from a recording, a notebook or a draft. */
const router: IRouter = Router();
const model = () => process.env.OPENAI_ANALYSIS_MODEL || (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ? (process.env.OPENAI_TEXT_MODEL || "gpt-5.6-luna") : "gpt-4.1");
type Kind = StudyPackRecord["sourceKind"];

/** The material to study, and a title for the pack. Null when there's nothing (yet) to study. */
async function material(kind: Kind, id: number): Promise<{ title: string; text: string } | null> {
  if (kind === "recording") {
    const [item] = await db.select().from(audioLibraryTable).where(eq(audioLibraryTable.id, id));
    if (!item?.transcript?.trim()) return null;
    return { title: item.title?.trim() || item.transcript.trim().slice(0, 60), text: [item.title, item.summary, item.transcript].filter(Boolean).join("\n\n") };
  }
  if (kind === "subject") {
    const [subject] = await db.select().from(subjectsTable).where(eq(subjectsTable.id, id));
    if (!subject) return null;
    const ideas = await db.select().from(ideasTable).where(eq(ideasTable.subjectId, id)).orderBy(asc(ideasTable.createdAt));
    const text = ideas.map((idea) => [idea.content, ...idea.attachments.map((a) => [a.note, a.transcript, a.extractedText].filter(Boolean).join("\n"))].filter((part) => part?.trim()).join("\n")).join("\n\n---\n\n");
    return text.trim() ? { title: subject.title, text: `${subject.title}\n${subject.intro ?? ""}\n\n${text}` } : null;
  }
  const [draft] = await db.select({ draft: subjectCompilationsTable, title: subjectsTable.title }).from(subjectCompilationsTable)
    .innerJoin(subjectsTable, eq(subjectCompilationsTable.subjectId, subjectsTable.id)).where(eq(subjectCompilationsTable.id, id));
  if (!draft) return null;
  const text = plainDraft(draft.draft.content);
  return text ? { title: draft.title, text } : null;
}

const making = new Set<number>();
function makeLater(id: number) {
  if (making.has(id)) return;
  making.add(id);
  void make(id).finally(() => making.delete(id));
}
async function make(id: number) {
  const [pack] = await db.select().from(studyPacksTable).where(eq(studyPacksTable.id, id));
  if (!pack) return;
  const fail = (error: string) => db.update(studyPacksTable).set({ status: "failed", error }).where(eq(studyPacksTable.id, id));
  try {
    const source = await material(pack.sourceKind, pack.sourceId);
    if (!source) { await fail("There's nothing to study here yet (a recording needs its text first)."); return; }
    const text = source.text.slice(0, 120_000);
    const response = await openai.chat.completions.create({
      model: model(),
      temperature: 0.3,
      max_completion_tokens: 12_000,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: studyPrompt(pack.options, wordCount(text)) }, { role: "user", content: `The material:\n\n${text}` }],
    }, { timeout: 240_000, maxRetries: 1 });
    let raw: unknown = null;
    try { raw = JSON.parse(response.choices[0]?.message?.content ?? "null"); } catch { /* handled below */ }
    const data = cleanStudy(raw, text, pack.options);
    if (!data) { await fail("The study pack came back empty. Please try again."); return; }
    await db.update(studyPacksTable).set({ status: "ready", data, error: null, reviews: {} }).where(eq(studyPacksTable.id, id));
  } catch (error) {
    console.warn("Study pack failed:", (error as Error).message);
    await fail("The study pack couldn't be made right now. Please try again.");
  }
}
// Packs being made when the server stopped are made again.
setTimeout(() => {
  void db.select({ id: studyPacksTable.id }).from(studyPacksTable).where(eq(studyPacksTable.status, "making"))
    .then((rows) => rows.forEach((row) => makeLater(row.id))).catch(() => {});
}, 10_000).unref?.();

const summary = (pack: StudyPackRecord) => ({
  id: pack.id, sourceKind: pack.sourceKind, sourceId: pack.sourceId, title: pack.title, options: pack.options, status: pack.status, error: pack.error,
  questionCount: pack.data?.quiz.length ?? 0, cardCount: pack.data?.cards.length ?? 0,
  dueCount: pack.data ? dueCards(pack.data.cards.length, pack.reviews).length : 0,
  createdAt: pack.createdAt.toISOString(),
});
const full = (pack: StudyPackRecord) => ({ ...summary(pack), data: pack.data, reviews: pack.reviews });
async function find(id: unknown, res: Response) {
  const [pack] = await db.select().from(studyPacksTable).where(eq(studyPacksTable.id, Number(id)));
  if (!pack) res.status(404).json({ error: "Study pack not found" });
  return pack ?? null;
}

router.get("/study/packs", async (req, res): Promise<void> => {
  const kind = req.query.sourceKind;
  const packs = await db.select().from(studyPacksTable).orderBy(desc(studyPacksTable.createdAt));
  res.json(packs.filter((pack) => !kind || (pack.sourceKind === kind && pack.sourceId === Number(req.query.sourceId))).map(summary));
});

router.post("/study/packs", async (req, res): Promise<void> => {
  const kind = req.body?.sourceKind as Kind;
  const sourceId = Number(req.body?.sourceId);
  if (!["recording", "subject", "draft"].includes(kind) || !Number.isInteger(sourceId)) { res.status(400).json({ error: "Choose what to study." }); return; }
  if (!aiConfigured) { res.status(503).json({ error: "AI is not configured yet." }); return; }
  const source = await material(kind, sourceId);
  if (!source) { res.status(409).json({ error: kind === "recording" ? "Convert this recording to text first." : "There's nothing to study here yet." }); return; }
  if (wordCount(source.text) < 60) { res.status(422).json({ error: "There isn't enough material for a study pack yet." }); return; }
  const [pack] = await db.insert(studyPacksTable).values({ sourceKind: kind, sourceId, title: source.title.slice(0, 160), options: cleanOptions(req.body?.options) }).returning();
  makeLater(pack!.id);
  res.status(201).json(full(pack!));
});

router.get("/study/packs/:id", async (req, res): Promise<void> => {
  const pack = await find(req.params.id, res);
  if (pack) res.json(full(pack));
});

/** Make it again (new questions), with the same or new options. */
router.post("/study/packs/:id/remake", async (req, res): Promise<void> => {
  const pack = await find(req.params.id, res);
  if (!pack) return;
  const options = req.body?.options ? cleanOptions(req.body.options) : pack.options;
  await db.update(studyPacksTable).set({ status: "making", error: null, options }).where(eq(studyPacksTable.id, pack.id));
  makeLater(pack.id);
  const [updated] = await db.select().from(studyPacksTable).where(eq(studyPacksTable.id, pack.id));
  res.json(full(updated!));
});

router.post("/study/packs/:id/review", async (req, res): Promise<void> => {
  const pack = await find(req.params.id, res);
  if (!pack?.data) return;
  const card = Number(req.body?.card);
  const grade = req.body?.grade;
  if (!Number.isInteger(card) || card < 0 || card >= pack.data.cards.length || !["again", "good", "easy"].includes(grade)) { res.status(400).json({ error: "Unknown card" }); return; }
  const reviews = reviewCard(pack.reviews, card, grade);
  await db.update(studyPacksTable).set({ reviews }).where(eq(studyPacksTable.id, pack.id));
  res.json({ reviews, dueCount: dueCards(pack.data.cards.length, reviews).length });
});

router.post("/study/packs/:id/reviews/reset", async (req, res): Promise<void> => {
  const pack = await find(req.params.id, res);
  if (!pack) return;
  await db.update(studyPacksTable).set({ reviews: {} }).where(eq(studyPacksTable.id, pack.id));
  res.json({ reviews: {} });
});

/** A PDF: the study notes handout (with the concept map the app drew), the quiz, or its answers. */
router.post("/study/packs/:id/pdf", async (req, res): Promise<void> => {
  const pack = await find(req.params.id, res);
  if (!pack) return;
  if (!pack.data) { res.status(409).json({ error: "The study pack isn't ready yet." }); return; }
  const kind = req.body?.kind === "quiz" || req.body?.kind === "key" ? req.body.kind : "notes";
  const concept = typeof req.body?.conceptPng === "string" && req.body.conceptPng.length < 6_000_000 ? req.body.conceptPng : undefined;
  try {
    const pdf = await htmlToPdf(handoutHtml(pack.title, pack.data, kind, concept));
    const name = `${pack.title.replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().slice(0, 60) || "study"} - ${kind === "notes" ? "notes" : kind === "quiz" ? "quiz" : "answers"}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.send(pdf);
  } catch (error) {
    console.warn("Study PDF failed:", (error as Error).message);
    res.status(500).json({ error: "The PDF couldn't be made on the server." });
  }
});

router.delete("/study/packs/:id", async (req, res): Promise<void> => {
  await db.delete(studyPacksTable).where(eq(studyPacksTable.id, Number(req.params.id)));
  res.sendStatus(204);
});

export default router;
