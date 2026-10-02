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
  ExportAudioLibraryItemQueryParams,
  EnhanceAudioLibraryItemBody,
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
  wordsForStoredAudio,
} from "../lib/stored-transcription";
import { AudioEditError, convertRecording, enhanceRecording, joinRecordings, keepRanges, storedDuration } from "../lib/audio-edit";
import { aiConfigured, openai } from "@workspace/integrations-openai-ai-server";
import { cleanMarks, joinMarks, parseChapters, remapMarks, transcriptSegments } from "../lib/audio-marks";

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
      marks: cleanMarks(item.marks),
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
    hasWords: item.words !== null,
    marks: item.marks ?? [],
    chapters: item.chapters,
    summary: item.summary,
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
      marks: cleanMarks(attachment.marks),
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
      marks: cleanMarks(body.data.marks, body.data.durationSeconds ?? Infinity),
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
    const parts = await Promise.all(ordered.map(async (row) => ({
      marks: row.marks ?? [],
      duration: row.durationSeconds ?? await storedDuration(row.url).catch(() => 0),
    })));
    const [created] = await db.insert(audioLibraryTable).values({
      url: joined.url,
      mimeType: joined.mimeType,
      durationSeconds: joined.durationSeconds,
      title: body.data.title?.trim() || null,
      marks: joinMarks(parts),
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
      words: null,
      chapters: null,
      summary: null,
      marks: remapMarks(current.marks ?? [], body.data.keep),
      originalMarks: current.originalMarks ?? current.marks ?? [],
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

router.post("/audio-library/:itemId/words", async (req, res): Promise<void> => {
  const params = UpdateAudioLibraryItemParams.safeParse(req.params);
  const body = TranscribeLibraryItemBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid recording or language" }); return; }
  const [current] = await db.select().from(audioLibraryTable).where(eq(audioLibraryTable.id, params.data.itemId));
  if (!current) { res.status(404).json({ error: "Not in the library" }); return; }
  if (current.words) { res.json({ text: current.transcript ?? current.words.map((w) => w.word).join(" "), words: current.words }); return; }
  if (!isStoredAudioUrl(current.url)) { res.status(400).json({ error: "Only recordings saved in this app can be edited." }); return; }
  // Stored words need no AI; fetching new ones does.
  if (!aiConfigured) { res.status(503).json({ error: "AI is not configured yet, so the words can't be read. Your recording is unchanged." }); return; }
  try {
    const result = await wordsForStoredAudio(canonicalStorageUrl(current.url), body.data.language ?? "auto");
    if (!result.words.length) { res.status(422).json({ error: "No speech was detected in this recording." }); return; }
    // Keep the timings only if the audio hasn't changed meanwhile.
    await db.update(audioLibraryTable)
      .set({ words: result.words, ...(current.transcript ? {} : { transcript: result.text }) })
      .where(and(eq(audioLibraryTable.id, current.id), eq(audioLibraryTable.url, current.url)));
    res.json({ text: current.transcript ?? result.text, words: result.words });
  } catch (error) {
    const [code, message] = transcriptionFailure(error);
    res.status(code).json({ error: message });
  }
});

router.post("/audio-library/:itemId/enhance", async (req, res): Promise<void> => {
  const params = UpdateAudioLibraryItemParams.safeParse(req.params);
  const body = EnhanceAudioLibraryItemBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid request" }); return; }
  const [current] = await db.select().from(audioLibraryTable).where(eq(audioLibraryTable.id, params.data.itemId));
  if (!current) { res.status(404).json({ error: "Not in the library" }); return; }
  try {
    const improved = await enhanceRecording(current.url, { denoise: body.data.denoise ?? true, level: body.data.level ?? true });
    // Timing is unchanged, so the transcript and word timings stay valid.
    const [updated] = await db.update(audioLibraryTable).set({
      url: improved.url,
      mimeType: improved.mimeType,
      originalMarks: current.originalMarks ?? current.marks ?? [],
      originalUrl: current.originalUrl ?? current.url,
    }).where(and(eq(audioLibraryTable.id, current.id), eq(audioLibraryTable.url, current.url)))
      .returning({ id: audioLibraryTable.id });
    if (!updated) { res.status(409).json({ error: "This recording changed meanwhile. Please try again." }); return; }
    const [saved] = await select().where(eq(audioLibraryTable.id, current.id));
    res.json(serialize(saved));
  } catch (error) {
    editFailure(res, error);
  }
});

router.post("/audio-library/:itemId/chapters", async (req, res): Promise<void> => {
  const params = UpdateAudioLibraryItemParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid item" }); return; }
  const [current] = await db.select().from(audioLibraryTable).where(eq(audioLibraryTable.id, params.data.itemId));
  if (!current) { res.status(404).json({ error: "Not in the library" }); return; }
  if (current.chapters) { const [saved] = await select().where(eq(audioLibraryTable.id, current.id)); res.json(serialize(saved)); return; }
  if (!aiConfigured) { res.status(503).json({ error: "AI is not configured yet, so chapters can't be made. Your recording is unchanged." }); return; }
  try {
    let words = current.words;
    if (!words) {
      if (!isStoredAudioUrl(current.url)) { res.status(400).json({ error: "Only recordings saved in this app can be used." }); return; }
      const result = await wordsForStoredAudio(canonicalStorageUrl(current.url), "auto");
      words = result.words;
      await db.update(audioLibraryTable).set({ words, ...(current.transcript ? {} : { transcript: result.text }) })
        .where(and(eq(audioLibraryTable.id, current.id), eq(audioLibraryTable.url, current.url)));
    }
    if (!words.length) { res.status(422).json({ error: "No speech was detected in this recording." }); return; }
    const duration = current.durationSeconds ?? words[words.length - 1].end;
    const lines = transcriptSegments(words).map(({ start, text }) => `[${start.toFixed(1)}] ${text}`).join("\n");
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_TEXT_MODEL || (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ? "gpt-5.6-luna" : "gpt-4.1-mini"),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You organise a person's spoken voice note. Split it into chapters where the topic changes, and write a summary. Use the SAME language as the transcript (Arabic stays Arabic, English stays English). Return JSON: {\"summary\": \"one or two sentences\", \"chapters\": [{\"start\": seconds, \"title\": \"2-6 word topic\"}]}. Start times must be taken from the [seconds] markers. A short note may have a single chapter. Do not invent content." },
        { role: "user", content: lines.slice(0, 60_000) },
      ],
    }, { timeout: 90_000, maxRetries: 0 });
    const parsed = parseChapters(JSON.parse(response.choices[0]?.message?.content || "{}"), duration);
    if (!parsed) { res.status(422).json({ error: "Chapters couldn't be made for this recording. Please try again." }); return; }
    await db.update(audioLibraryTable).set({ chapters: parsed.chapters, summary: parsed.summary || null })
      .where(and(eq(audioLibraryTable.id, current.id), eq(audioLibraryTable.url, current.url)));
    const [saved] = await select().where(eq(audioLibraryTable.id, current.id));
    res.json(serialize(saved));
  } catch (error) {
    const [code, message] = transcriptionFailure(error);
    res.status(code).json({ error: message });
  }
});

/** A safe file name from the recording's name or text, e.g. "Morning drive idea.mp3". */
function exportName(item: AudioLibraryRecord, ext: string) {
  const base = (item.title || item.transcript?.slice(0, 60) || `Voice note ${item.capturedAt.toISOString().slice(0, 10)}`)
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Voice note";
  return `${base}.${ext}`;
}

router.get("/audio-library/:itemId/export", async (req, res): Promise<void> => {
  const params = UpdateAudioLibraryItemParams.safeParse(req.params);
  const query = ExportAudioLibraryItemQueryParams.safeParse(req.query);
  if (!params.success || !query.success) { res.status(400).json({ error: "Choose a format: mp3, wav, m4a, ogg, opus, or flac." }); return; }
  const [current] = await db.select().from(audioLibraryTable).where(eq(audioLibraryTable.id, params.data.itemId));
  if (!current) { res.status(404).json({ error: "Not in the library" }); return; }
  try {
    await convertRecording(current.url, query.data.format, query.data.quality ?? "high", (path, mime, ext) => new Promise<void>((resolve, reject) => {
      const name = exportName(current, ext);
      // ASCII fallback plus the real (possibly Arabic) name, per RFC 6266.
      const ascii = name.replace(/[^\x20-\x7e]/g, "_");
      res.setHeader("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`);
      res.setHeader("Cache-Control", "private, no-store");
      res.sendFile(path, { headers: { "Content-Type": mime } }, (error) => (error ? reject(error) : resolve()));
    }));
  } catch (error) {
    if (!res.headersSent) editFailure(res, error);
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
      .set({ url: current.originalUrl, originalUrl: null, durationSeconds, transcript: null, words: null,
        marks: current.originalMarks ?? current.marks ?? [], originalMarks: null, chapters: null, summary: null })
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
