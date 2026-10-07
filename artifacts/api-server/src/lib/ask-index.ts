/**
 * The meaning index shared by "Ask your library" and Idea Connections: recordings, ideas and
 * drafts as passages with embeddings, kept in step with their text.
 */
import { eq, inArray } from "drizzle-orm";
import {
  askPassagesTable,
  audioLibraryTable,
  db,
  ideasTable,
  subjectCompilationsTable,
  subjectsTable,
} from "@workspace/db";
import { aiConfigured, openai } from "@workspace/integrations-openai-ai-server";
import { draftPassages, ideaPassages, recordingPassages, type Passage } from "./ask";
import { subjectLinks } from "../routes/audio-library";

export const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
const DIMENSIONS = 512;
/** Passages embedded while a question waits; the rest are embedded in the background. */
export const EMBED_NOW = 400;
const BATCH = 96;
export const textModel = () => process.env.OPENAI_TEXT_MODEL || (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ? "gpt-5.6-luna" : "gpt-4.1-mini");

/** After an embedding failure (e.g. a provider without embeddings), match by words for a while. */
let embeddingsOffUntil = 0;
export const embeddingsOff = () => Date.now() < embeddingsOffUntil;

const key = (p: { source: string; sourceId: number; part: number }) => `${p.source}:${p.sourceId}:${p.part}`;

/** Everything that can be asked about, as passages, plus what each source is (for showing results). */
export async function gather() {
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
export async function syncIndex(passages: Passage[]) {
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

export async function embed(inputs: string[]): Promise<number[][]> {
  const response = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: inputs, dimensions: DIMENSIONS }, { timeout: 60_000, maxRetries: 1 });
  return response.data.sort((a, b) => a.index - b.index).map((entry) => entry.embedding);
}

/** Embeds passages that have none yet (up to `limit`); returns how many were done. */
export async function embedMissing(limit: number): Promise<number> {
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
export const indexInBackground = () => {
  if (backgroundIndexing) return;
  backgroundIndexing = (async () => {
    try { while ((await embedMissing(EMBED_NOW)) > 0) { /* keep going until everything is embedded */ } }
    catch { /* the next question tries again */ }
    finally { backgroundIndexing = null; }
  })();
};

