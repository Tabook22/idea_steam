import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import {
  audioLibraryTable,
  db,
  ideasTable,
  subjectsTable,
  type AudioLibraryRecord,
} from "@workspace/db";
import {
  AddToAudioLibraryBody,
  CreateLibraryRecordingBody,
  EditAudioLibraryItemBody,
  JoinAudioLibraryItemsBody,
  TranscribeLibraryItemBody,
  UpdateAudioLibraryItemBody,
  UpdateAudioLibraryItemParams,
} from "@workspace/api-zod";
import {
  canonicalStorageUrl,
  isStoredAudioUrl,
  transcribeStoredAudio,
  transcriptionFailure,
} from "../lib/stored-transcription";
import { AudioEditError, joinRecordings, keepRanges, storedDuration } from "../lib/audio-edit";

const router: IRouter = Router();

type Executor = Pick<typeof db, "insert">;

/**
 * Adds a voice idea's recordings to the library. Called only when the idea is first
 * created, so a recording removed from the library is never silently re-added by a retry.
 */
export async function addRecordingsToLibrary(
  executor: Executor,
  idea: typeof ideasTable.$inferSelect,
  subjectTitle: string | null,
) {
  const recordings = idea.attachments.filter((item) => item.type === "audio" && item.url);
  if (idea.source !== "voice" || !recordings.length) return;
  await executor
    .insert(audioLibraryTable)
    .values(recordings.map((item) => ({
      url: item.url,
      mimeType: item.mimeType ?? null,
      durationSeconds: item.durationSeconds ?? null,
      transcript: item.transcript ?? null,
      sourceIdeaId: idea.id,
      sourceSubjectTitle: subjectTitle,
      capturedAt: idea.createdAt,
    })))
    .onConflictDoNothing({ target: audioLibraryTable.url });
}

const select = () =>
  db
    .select({ item: audioLibraryTable, ideaId: ideasTable.id, subjectId: ideasTable.subjectId })
    .from(audioLibraryTable)
    .leftJoin(ideasTable, eq(ideasTable.id, audioLibraryTable.sourceIdeaId));

function serialize({ item, ideaId, subjectId }: { item: AudioLibraryRecord; ideaId: number | null; subjectId: number | null }) {
  return {
    id: item.id,
    url: item.url,
    title: item.title,
    mimeType: item.mimeType,
    durationSeconds: item.durationSeconds,
    transcript: item.transcript,
    sourceIdeaId: ideaId,
    sourceSubjectId: subjectId,
    sourceSubjectTitle: item.sourceSubjectTitle,
    edited: item.originalUrl !== null,
    capturedAt: item.capturedAt.toISOString(),
    createdAt: item.createdAt.toISOString(),
  };
}

router.get("/audio-library", async (_req, res): Promise<void> => {
  const rows = await select().orderBy(desc(audioLibraryTable.capturedAt), desc(audioLibraryTable.id));
  res.json(rows.map(serialize));
});

router.post("/audio-library", async (req, res): Promise<void> => {
  const body = AddToAudioLibraryBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db
    .select({ idea: ideasTable, subjectTitle: subjectsTable.title })
    .from(ideasTable)
    .innerJoin(subjectsTable, eq(subjectsTable.id, ideasTable.subjectId))
    .where(eq(ideasTable.id, body.data.ideaId));
  const attachment = row?.idea.attachments[body.data.attachmentIndex ?? 0];
  if (!row || attachment?.type !== "audio" || !attachment.url) {
    res.status(404).json({ error: "That recording was not found." });
    return;
  }
  const [inserted] = await db
    .insert(audioLibraryTable)
    .values({
      url: attachment.url,
      mimeType: attachment.mimeType ?? null,
      durationSeconds: attachment.durationSeconds ?? null,
      transcript: attachment.transcript ?? null,
      sourceIdeaId: row.idea.id,
      sourceSubjectTitle: row.subjectTitle,
      capturedAt: row.idea.createdAt,
    })
    .onConflictDoNothing({ target: audioLibraryTable.url })
    .returning({ id: audioLibraryTable.id });
  const [saved] = await select().where(eq(audioLibraryTable.url, attachment.url));
  res.status(inserted ? 201 : 200).json(serialize(saved));
});

// A recording made straight into the library: no idea, no subject.
router.post("/audio-library/recordings", async (req, res): Promise<void> => {
  const body = CreateLibraryRecordingBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid recording" }); return; }
  if (!isStoredAudioUrl(body.data.url)) {
    res.status(400).json({ error: "Only recordings saved in this app can be added" });
    return;
  }
  const [inserted] = await db
    .insert(audioLibraryTable)
    .values({
      url: body.data.url,
      mimeType: body.data.mimeType ?? null,
      durationSeconds: body.data.durationSeconds ?? null,
      clientCaptureId: body.data.clientCaptureId,
      ...(body.data.capturedAt ? { capturedAt: new Date(body.data.capturedAt) } : {}),
    })
    // A retried upload (same capture ID or file) returns the existing entry.
    .onConflictDoNothing()
    .returning({ id: audioLibraryTable.id });
  const [saved] = await select().where(or(
    eq(audioLibraryTable.clientCaptureId, body.data.clientCaptureId),
    eq(audioLibraryTable.url, body.data.url),
  ));
  if (!saved) { res.status(409).json({ error: "The recording could not be saved" }); return; }
  res.status(inserted ? 201 : 200).json(serialize(saved));
});

router.post("/audio-library/:itemId/transcription", async (req, res): Promise<void> => {
  const params = UpdateAudioLibraryItemParams.safeParse(req.params);
  const body = TranscribeLibraryItemBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid recording or language" }); return; }
  const [current] = await select().where(eq(audioLibraryTable.id, params.data.itemId));
  if (!current) { res.status(404).json({ error: "Not in the library" }); return; }
  if (current.item.transcript) { res.json(serialize(current)); return; }
  if (!isStoredAudioUrl(current.item.url)) {
    res.status(400).json({ error: "Only recordings saved in this app can be transcribed" });
    return;
  }
  try {
    const text = await transcribeStoredAudio(canonicalStorageUrl(current.item.url), body.data.language ?? "auto");
    if (!text) { res.status(422).json({ error: "No speech was detected. Your audio is still saved." }); return; }
    await db.update(audioLibraryTable).set({ transcript: text }).where(eq(audioLibraryTable.id, current.item.id));
    const [saved] = await select().where(eq(audioLibraryTable.id, current.item.id));
    res.json(serialize(saved ?? current));
  } catch (error) {
    const [code, message] = transcriptionFailure(error);
    res.status(code).json({ error: message });
  }
});

/** After an edit or join the old text no longer matches; redo it in the background. */
function retranscribe(id: number, url: string) {
  void (async () => {
    const text = await transcribeStoredAudio(canonicalStorageUrl(url), "auto");
    if (!text) return;
    await db.update(audioLibraryTable).set({ transcript: text })
      // Only if the item still plays this audio (a newer edit wins).
      .where(and(eq(audioLibraryTable.id, id), eq(audioLibraryTable.url, url)));
  })().catch(() => { /* The audio is saved; the text can be added later. */ });
}

function editFailure(res: import("express").Response, error: unknown) {
  if (error instanceof AudioEditError) { res.status(error.status).json({ error: error.message }); return; }
  console.warn("Audio edit failed", { reason: error instanceof Error ? error.name : "unknown" });
  res.status(500).json({ error: "The edit couldn't be saved. Your recording is unchanged." });
}

router.post("/audio-library/join", async (req, res): Promise<void> => {
  const body = JoinAudioLibraryItemsBody.safeParse(req.body);
  if (!body.success || new Set(body.data.itemIds).size !== body.data.itemIds.length) {
    res.status(400).json({ error: "Choose 2 to 20 different recordings to join." });
    return;
  }
  const rows = await db.select().from(audioLibraryTable).where(inArray(audioLibraryTable.id, body.data.itemIds));
  if (rows.length !== body.data.itemIds.length) { res.status(404).json({ error: "Some recordings are no longer in the library." }); return; }
  const ordered = body.data.itemIds.map((id) => rows.find((row) => row.id === id)!);
  try {
    const joined = await joinRecordings(ordered.map((row) => row.url));
    const [created] = await db.insert(audioLibraryTable).values({
      url: joined.url,
      mimeType: joined.mimeType,
      durationSeconds: joined.durationSeconds,
      title: body.data.title?.trim() || null,
      // Until the new text arrives, show the pieces' text in order.
      transcript: ordered.every((row) => row.transcript) ? ordered.map((row) => row.transcript).join("\n\n") : null,
    }).returning({ id: audioLibraryTable.id });
    retranscribe(created.id, joined.url);
    const [saved] = await select().where(eq(audioLibraryTable.id, created.id));
    res.status(201).json(serialize(saved));
  } catch (error) {
    editFailure(res, error);
  }
});

router.post("/audio-library/:itemId/edit", async (req, res): Promise<void> => {
  const params = UpdateAudioLibraryItemParams.safeParse(req.params);
  const body = EditAudioLibraryItemBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "The selection is not valid." }); return; }
  const [current] = await db.select().from(audioLibraryTable).where(eq(audioLibraryTable.id, params.data.itemId));
  if (!current) { res.status(404).json({ error: "Not in the library" }); return; }
  try {
    const edited = await keepRanges(current.url, body.data.keep);
    const [updated] = await db.update(audioLibraryTable).set({
      url: edited.url,
      mimeType: edited.mimeType,
      durationSeconds: edited.durationSeconds,
      transcript: null,
      originalUrl: current.originalUrl ?? current.url,
    }).where(and(eq(audioLibraryTable.id, current.id), eq(audioLibraryTable.url, current.url)))
      .returning({ id: audioLibraryTable.id });
    if (!updated) { res.status(409).json({ error: "This recording changed meanwhile. Please reopen it." }); return; }
    retranscribe(current.id, edited.url);
    const [saved] = await select().where(eq(audioLibraryTable.id, current.id));
    res.json(serialize(saved));
  } catch (error) {
    editFailure(res, error);
  }
});

router.post("/audio-library/:itemId/restore", async (req, res): Promise<void> => {
  const params = UpdateAudioLibraryItemParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid item" }); return; }
  const [current] = await db.select().from(audioLibraryTable).where(eq(audioLibraryTable.id, params.data.itemId));
  if (!current) { res.status(404).json({ error: "Not in the library" }); return; }
  if (!current.originalUrl) { res.status(409).json({ error: "This recording hasn't been edited." }); return; }
  try {
    const durationSeconds = await storedDuration(current.originalUrl).catch(() => null);
    await db.update(audioLibraryTable)
      .set({ url: current.originalUrl, originalUrl: null, durationSeconds, transcript: null })
      .where(eq(audioLibraryTable.id, current.id));
    retranscribe(current.id, current.originalUrl);
    const [saved] = await select().where(eq(audioLibraryTable.id, current.id));
    res.json(serialize(saved));
  } catch (error) {
    // The original is also in the library as its own item (added back from its idea).
    if ((error as { code?: string })?.code === "23505" || /unique/i.test(String((error as Error)?.message)))
      res.status(409).json({ error: "The original recording is already in your library as a separate item." });
    else editFailure(res, error);
  }
});

router.patch("/audio-library/:itemId", async (req, res): Promise<void> => {
  const params = UpdateAudioLibraryItemParams.safeParse(req.params);
  const body = UpdateAudioLibraryItemBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid change" }); return; }
  const changes: Partial<AudioLibraryRecord> = {};
  if (body.data.title !== undefined) changes.title = body.data.title?.trim() || null;
  if (body.data.durationSeconds !== undefined) changes.durationSeconds = body.data.durationSeconds;
  if (Object.keys(changes).length) {
    const [updated] = await db
      .update(audioLibraryTable)
      .set(changes)
      .where(eq(audioLibraryTable.id, params.data.itemId))
      .returning({ id: audioLibraryTable.id });
    if (!updated) { res.status(404).json({ error: "Not in the library" }); return; }
  }
  const [saved] = await select().where(eq(audioLibraryTable.id, params.data.itemId));
  if (!saved) { res.status(404).json({ error: "Not in the library" }); return; }
  res.json(serialize(saved));
});

router.delete("/audio-library/:itemId", async (req, res): Promise<void> => {
  const params = UpdateAudioLibraryItemParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid item" }); return; }
  // Removes the library entry only. The idea, and the stored audio it plays, stay as they are.
  const [deleted] = await db
    .delete(audioLibraryTable)
    .where(eq(audioLibraryTable.id, params.data.itemId))
    .returning({ id: audioLibraryTable.id });
  if (!deleted) { res.status(404).json({ error: "Not in the library" }); return; }
  res.sendStatus(204);
});

export default router;
