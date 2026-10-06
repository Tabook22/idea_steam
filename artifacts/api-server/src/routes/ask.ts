import { Router, type IRouter } from "express";
import { eq, inArray } from "drizzle-orm";
import {
  askPassagesTable,
  audioLibraryTable,
  db,
  ideasTable,
  subjectCompilationsTable,
  subjectsTable,
} from "@workspace/db";
import { AskLibraryBody } from "@workspace/api-zod";
import { aiConfigured, openai } from "@workspace/integrations-openai-ai-server";
import {
  ASK_SYSTEM,
  citedNumbers,
  draftPassages,
  excerpt,
  ideaPassages,
  isArabicText,
  rank,
  recordingPassages,
  sourcesForPrompt,
  type Candidate,
  type Passage,
} from "../lib/ask";
import { subjectLinks } from "./audio-library";

const router: IRouter = Router();

const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
const DIMENSIONS = 512;
/** Passages embedded while a question waits; the rest are embedded in the background. */
const EMBED_NOW = 400;
const BATCH = 96;
const textModel = () => process.env.OPENAI_TEXT_MODEL || (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ? "gpt-5.6-luna" : "gpt-4.1-mini");

/** After an embedding failure (e.g. a provider without embeddings), match by words for a while. */
let embeddingsOffUntil = 0;

const key = (p: { source: string; sourceId: number; part: number }) => `${p.source}:${p.sourceId}:${p.part}`;

/** Everything that can be asked about, as passages, plus what each source is (for showing results). */
async function gather() {
  const items = await db.select().from(audioLibraryTable).where(eq(audioLibraryTable.kind, "recording"));
  const links = await subjectLinks(items);
  const ideas = await db
    .select({ idea: ideasTable, subjectTitle: subjectsTable.title })
    .from(ideasTable)
    .innerJoin(subjectsTable, eq(subjectsTable.id, ideasTable.subjectId));
  const drafts = await db
    .select({ draft: subjectCompilationsTable, subjectTitle: subjectsTable.title })
    .from(subjectCompilationsTable)
    .innerJoin(subjectsTable, eq(subjectsTable.id, subjectCompilationsTable.subjectId));

  const passages: Passage[] = [];
  for (const item of items)
    passages.push(...recordingPassages({
      ...item,
      pre: item.mix?.pre ?? 0,
      subjects: (links.get(item.id) ?? []).map((link) => link.subjectTitle),
    }));
  for (const { idea, subjectTitle } of ideas) passages.push(...ideaPassages({ ...idea, subjectTitle }));
  for (const { draft, subjectTitle } of drafts) passages.push(...draftPassages({ ...draft, subjectTitle }));
  return { passages, items, links, ideas, drafts };
}

/** Brings the stored index in line with the passages: changed ones are replaced, gone ones removed. */
async function syncIndex(passages: Passage[]) {
  const stored = await db.select().from(askPassagesTable);
  const wanted = new Map(passages.map((p) => [key(p), p]));
  const keep = new Map<string, (typeof stored)[number]>();
  const remove: number[] = [];
  for (const row of stored) {
    const want = wanted.get(key(row));
    if (want && want.hash === row.hash) keep.set(key(row), row);
    else remove.push(row.id);
  }
  if (remove.length) await db.delete(askPassagesTable).where(inArray(askPassagesTable.id, remove));
  const fresh = passages.filter((p) => !keep.has(key(p)));
  for (let i = 0; i < fresh.length; i += 200) {
    await db.insert(askPassagesTable)
      .values(fresh.slice(i, i + 200).map((p) => ({ source: p.source, sourceId: p.sourceId, part: p.part, hash: p.hash, start: p.start, header: p.header, text: p.text })))
      .onConflictDoNothing();
  }
  return db.select().from(askPassagesTable);
}

async function embed(inputs: string[]): Promise<number[][]> {
  const response = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: inputs, dimensions: DIMENSIONS }, { timeout: 60_000, maxRetries: 1 });
  return response.data.sort((a, b) => a.index - b.index).map((entry) => entry.embedding);
}

/** Embeds passages that have none yet (up to `limit`); returns how many were done. */
async function embedMissing(limit: number): Promise<number> {
  if (!aiConfigured || Date.now() < embeddingsOffUntil) return 0;
  const rows = (await db.select({ id: askPassagesTable.id, header: askPassagesTable.header, text: askPassagesTable.text, model: askPassagesTable.model, has: askPassagesTable.embedding })
    .from(askPassagesTable))
    .filter((row) => !row.has || row.model !== EMBEDDING_MODEL)
    .slice(0, limit);
  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    try {
      const vectors = await embed(batch.map((row) => `${row.header}\n${row.text}`.slice(0, 6000)));
      for (const [index, row] of batch.entries())
        await db.update(askPassagesTable).set({ embedding: vectors[index].map((v) => Math.round(v * 1e5) / 1e5), model: EMBEDDING_MODEL }).where(eq(askPassagesTable.id, row.id));
      done += batch.length;
    } catch (error) {
      console.warn("Ask: embeddings unavailable, matching by words for now:", (error as Error).message);
      embeddingsOffUntil = Date.now() + 10 * 60_000;
      break;
    }
  }
  return done;
}

let backgroundIndexing: Promise<void> | null = null;
const indexInBackground = () => {
  if (backgroundIndexing) return;
  backgroundIndexing = (async () => {
    try { while ((await embedMissing(EMBED_NOW)) > 0) { /* keep going until everything is embedded */ } }
    catch { /* the next question tries again */ }
    finally { backgroundIndexing = null; }
  })();
};

const snippet = (text: string | null | undefined, length = 70) => {
  const words = text?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return words ? (words.length > length ? `${words.slice(0, length).trim()}…` : words) : null;
};

router.post("/ask", async (req, res): Promise<void> => {
  const body = AskLibraryBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Type a question to ask." }); return; }
  const question = body.data.question.trim().slice(0, 500);
  if (question.length < 2) { res.status(400).json({ error: "Type a question to ask." }); return; }
  const history = (body.data.history ?? []).slice(-4);
  const subjectId = body.data.subjectId ?? null;
  const arabic = isArabicText(question);

  try {
    const { passages, items, links, ideas, drafts } = await gather();
    await syncIndex(passages);
    if (aiConfigured) await embedMissing(EMBED_NOW);
    const rows = await db.select().from(askPassagesTable);

    // Only what belongs to the chosen subject, when one is chosen.
    const inScope = (row: { source: string; sourceId: number }) => {
      if (subjectId === null) return true;
      if (row.source === "recording") return (links.get(row.sourceId) ?? []).some((link) => link.subjectId === subjectId);
      if (row.source === "idea") return ideas.some(({ idea }) => idea.id === row.sourceId && idea.subjectId === subjectId);
      return drafts.some(({ draft }) => draft.id === row.sourceId && draft.subjectId === subjectId);
    };
    const candidates: Candidate[] = rows.filter(inScope).map((row) => ({
      source: row.source, sourceId: row.sourceId, part: row.part, start: row.start, text: row.text, header: row.header, hash: row.hash,
      embedding: row.model === EMBEDDING_MODEL ? row.embedding : null,
    }));

    // A follow-up such as "and when?" is searched together with the question before it.
    const searchText = history.length ? `${history.at(-1)!.question} ${question}` : question;
    let questionEmbedding: number[] | null = null;
    const smart = aiConfigured && Date.now() >= embeddingsOffUntil && candidates.some((c) => c.embedding);
    if (smart) {
      try { [questionEmbedding] = await embed([searchText]); }
      catch (error) { console.warn("Ask: question embedding failed:", (error as Error).message); }
    }
    const best = rank(searchText, candidates, questionEmbedding);
    indexInBackground();

    const itemById = new Map(items.map((item) => [item.id, item]));
    const ideaById = new Map(ideas.map((row) => [row.idea.id, row]));
    const draftById = new Map(drafts.map((row) => [row.draft.id, row]));
    const describe = (passage: (typeof best)[number], n: number) => {
      const base = { n, kind: passage.source, id: passage.sourceId, start: passage.start, excerpt: excerpt(passage.text, question) };
      if (passage.source === "recording") {
        const item = itemById.get(passage.sourceId)!;
        const link = (links.get(item.id) ?? [])[0];
        return { ...base, title: item.title || snippet(item.transcript) || "Voice note", url: item.url, durationSeconds: item.durationSeconds,
          subjectId: link?.subjectId ?? null, subjectTitle: link?.subjectTitle ?? null, date: item.capturedAt.toISOString() };
      }
      if (passage.source === "idea") {
        const { idea, subjectTitle } = ideaById.get(passage.sourceId)!;
        return { ...base, title: snippet(idea.content) || subjectTitle, url: null, durationSeconds: null, subjectId: idea.subjectId, subjectTitle, date: idea.createdAt.toISOString() };
      }
      const { draft, subjectTitle } = draftById.get(passage.sourceId)!;
      return { ...base, title: subjectTitle, url: null, durationSeconds: null, subjectId: draft.subjectId, subjectTitle, date: draft.updatedAt.toISOString() };
    };
    const searched = {
      recordings: new Set(candidates.filter((c) => c.source === "recording").map((c) => c.sourceId)).size,
      ideas: new Set(candidates.filter((c) => c.source === "idea").map((c) => c.sourceId)).size,
      drafts: new Set(candidates.filter((c) => c.source === "draft").map((c) => c.sourceId)).size,
    };
    const mode = questionEmbedding ? "smart" : "words";

    if (!best.length) {
      res.json({ answer: arabic ? "لم أجد شيئًا عن هذا في تسجيلاتك وأفكارك." : "I couldn't find anything about this in your recordings and ideas.",
        sources: [], searched, mode, aiAnswer: false });
      return;
    }
    const all = best.map((passage, index) => describe(passage, index + 1));
    if (!aiConfigured) {
      res.json({ answer: null, sources: all, searched, mode, aiAnswer: false,
        notice: arabic ? "الذكاء الاصطناعي غير مفعّل، فهذه أقرب المقاطع لسؤالك." : "AI isn't set up, so here are the passages that best match your question." });
      return;
    }
    try {
      const response = await openai.chat.completions.create({
        model: textModel(),
        messages: [
          { role: "system", content: ASK_SYSTEM },
          ...history.flatMap((turn) => [
            { role: "user" as const, content: turn.question.slice(0, 500) },
            { role: "assistant" as const, content: turn.answer.slice(0, 1500) },
          ]),
          { role: "user", content: `Sources:\n\n${sourcesForPrompt(best)}\n\nQuestion: ${question}` },
        ],
      }, { timeout: 60_000, maxRetries: 1 });
      const answer = response.choices[0]?.message?.content?.trim() || "";
      const cited = citedNumbers(answer, all.length);
      res.json({ answer, sources: all.filter((source) => cited.includes(source.n)), searched, mode, aiAnswer: true });
    } catch (error) {
      console.warn("Ask: answer failed:", (error as Error).message);
      res.json({ answer: null, sources: all, searched, mode, aiAnswer: false,
        notice: arabic ? "تعذر كتابة الإجابة الآن، فهذه أقرب المقاطع لسؤالك." : "The answer couldn't be written right now, so here are the passages that best match your question." });
    }
  } catch (error) {
    req.log?.error({ err: error }, "Ask failed");
    res.status(500).json({ error: arabic ? "تعذر البحث الآن. حاول مجددًا." : "Asking is unavailable right now. Please try again." });
  }
});

export default router;
