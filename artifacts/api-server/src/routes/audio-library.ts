import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
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
  AddAudioLibraryItemToSubjectBody,
  RemoveAudioLibraryItemFromSubjectParams,
  MixAudioLibraryItemBody,
  PreviewMixAudioLibraryItemBody,
  PreviewSoundLabAudioLibraryItemBody,
  SoundLabAudioLibraryItemBody,
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
import { AudioEditError, convertRecording, duplicateStored, enhanceRecording, joinRecordings, keepRanges, mixPreview, mixRecording, soundLabPreview, soundLabRecording, storedDuration } from "../lib/audio-edit";
import { aiConfigured, openai } from "@workspace/integrations-openai-ai-server";
import { cleanMarks, joinMarks, parseChapters, remapMarks, transcriptSegments } from "../lib/audio-marks";
import { LEGACY_SUFFIX, findLegacySource, snippet } from "../lib/legacy-mix";

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

type SubjectLink = { subjectId: number; subjectTitle: string; ideaId: number };

/**
 * The subjects each recording is in: ideas whose audio came from it (by library link), plays
 * the same file, or is the idea it was first saved from.
 */
export async function subjectLinks(items: AudioLibraryRecord[]) {
  const links = new Map<number, SubjectLink[]>();
  if (!items.length) return links;
  const ideas = await db
    .select({ id: ideasTable.id, subjectId: ideasTable.subjectId, subjectTitle: subjectsTable.title, attachments: ideasTable.attachments })
    .from(ideasTable)
    .innerJoin(subjectsTable, eq(subjectsTable.id, ideasTable.subjectId))
    .where(sql`${ideasTable.attachments} @> '[{"type":"audio"}]'::jsonb`);
  const byUrl = new Map<string, AudioLibraryRecord>(items.map((item) => [canonicalStorageUrl(item.url), item]));
  const byId = new Map<number, AudioLibraryRecord>(items.map((item) => [item.id, item]));
  const bySourceIdea = new Map<number, AudioLibraryRecord>(items.filter((item) => item.sourceIdeaId != null).map((item) => [item.sourceIdeaId!, item]));
  for (const idea of ideas) {
    const owners = new Set<AudioLibraryRecord>();
    for (const attachment of idea.attachments) {
      if (attachment.type !== "audio") continue;
      const owner = (attachment.libraryItemId != null ? byId.get(attachment.libraryItemId) : undefined) ?? byUrl.get(canonicalStorageUrl(attachment.url));
      if (owner) owners.add(owner);
    }
    const first = bySourceIdea.get(idea.id);
    if (first) owners.add(first);
    for (const owner of owners) {
      const list = links.get(owner.id) ?? [];
      if (!list.some((link) => link.ideaId === idea.id)) list.push({ subjectId: idea.subjectId, subjectTitle: idea.subjectTitle, ideaId: idea.id });
      links.set(owner.id, list);
    }
  }
  return links;
}

/**
 * The library is the master copy: after its audio or text changes, the subject ideas made from
 * it play the new version, and an idea still waiting for its text gets the transcript.
 */
async function relink(itemId: number) {
  const [item] = await db.select().from(audioLibraryTable).where(eq(audioLibraryTable.id, itemId));
  if (!item) return;
  const linked = await db.select().from(ideasTable).where(sql`${ideasTable.attachments} @> ${JSON.stringify([{ libraryItemId: itemId }])}::jsonb`);
  for (const idea of linked) {
    const waiting = idea.attachments.some((attachment) => attachment.libraryItemId === itemId && attachment.awaitingText);
    const text = item.transcript?.trim();
    const attachments = idea.attachments.map((attachment) => attachment.libraryItemId !== itemId ? attachment : {
      ...attachment,
      url: item.url,
      ...(item.mimeType ? { mimeType: item.mimeType } : {}),
      ...(item.durationSeconds != null ? { durationSeconds: item.durationSeconds } : {}),
      marks: item.marks ?? [],
      ...(text ? { transcript: text, awaitingText: undefined } : {}),
    });
    await db.update(ideasTable).set({ attachments, ...(waiting && text ? { content: text } : {}) }).where(eq(ideasTable.id, idea.id));
  }
}

const relinkLater = (itemId: number) => { void relink(itemId).catch(() => { /* the library copy is saved; subjects catch up next change */ }); };

function serialize({ item, ideaId, subjectId }: { item: AudioLibraryRecord; ideaId: number | null; subjectId: number | null }, bakedMusic = false, subjects: SubjectLink[] = []) {
  return {
    bakedMusic,
    subjects,
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
    kind: item.kind,
    mix: item.mix ? { voiceUrl: item.mix.voiceUrl, voiceDuration: item.mix.voiceDuration, musicItemId: item.mix.musicItemId, musicUrl: item.mix.musicUrl, musicTitle: item.mix.musicTitle, pre: item.mix.pre, settings: item.mix.settings } : null,
    capturedAt: item.capturedAt.toISOString(),
    createdAt: item.createdAt.toISOString(),
  };
}

router.get("/audio-library", async (_req, res): Promise<void> => {
  const rows = await select().orderBy(desc(audioLibraryTable.capturedAt), desc(audioLibraryTable.id));
  const items = rows.map((row) => row.item);
  const links = await subjectLinks(items);
  // Old "· with music" copies whose voice can still be recovered can have their music removed.
  res.json(rows.map((row) => serialize(row, !!findLegacySource(row.item, items), links.get(row.item.id) ?? [])));
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
      title: body.data.title?.trim() || null,
      kind: body.data.kind ?? "recording",
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
  if (current.item.transcript) {
    // Already has text: make sure the subjects it was added to have it too.
    await relink(current.item.id).catch(() => {});
    res.json(serialize(current));
    return;
  }
  if (!isStoredAudioUrl(current.item.url)) {
    res.status(400).json({ error: "Only recordings saved in this app can be transcribed" });
    return;
  }
  try {
    const text = await transcribeStoredAudio(canonicalStorageUrl(current.item.url), body.data.language ?? "auto");
    if (!text) { res.status(422).json({ error: "No speech was detected. Your audio is still saved." }); return; }
    await db.update(audioLibraryTable).set({ transcript: text }).where(eq(audioLibraryTable.id, current.item.id));
    await relink(current.item.id).catch(() => {});
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
    await relink(id);
  })().catch(() => { /* The audio is saved; the text can be added later. */ });
}

/**
 * After the voice under background music changes (cut, cleaned, improved), lay the same music
 * back on. A music block that ran to the end of the voice keeps doing so.
 */
async function remix(current: AudioLibraryRecord, voice: { url: string; marks: number[]; duration: number | null }) {
  const layer = current.mix!;
  const before = layer.voiceDuration ?? voice.duration ?? 0;
  const after = voice.duration ?? before;
  const settings = { ...layer.settings };
  if (settings.regionEnd >= before - 0.05) settings.regionEnd = Math.max(settings.regionStart + 1, after + (settings.regionEnd - before));
  const mixed = await mixRecording(voice.url, layer.musicUrl, settings);
  const { pre, total } = mixed.plan;
  return {
    url: mixed.url,
    mimeType: mixed.mimeType,
    durationSeconds: Math.round(total),
    marks: cleanMarks(voice.marks.map((mark) => mark + pre), total),
    mix: { ...layer, voiceUrl: voice.url, voiceMarks: voice.marks, voiceDuration: after, pre, settings },
  };
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
    if (current.mix) {
      const edited = await keepRanges(current.mix.voiceUrl, body.data.keep);
      const layered = await remix(current, { url: edited.url, marks: remapMarks(current.mix.voiceMarks, body.data.keep), duration: edited.durationSeconds });
      const [updated] = await db.update(audioLibraryTable).set({
        ...layered,
        transcript: null, words: null, chapters: null, summary: null,
        originalMarks: current.originalMarks ?? current.mix.voiceMarks,
        originalUrl: current.originalUrl ?? current.mix.voiceUrl,
      }).where(and(eq(audioLibraryTable.id, current.id), eq(audioLibraryTable.url, current.url)))
        .returning({ id: audioLibraryTable.id });
      if (!updated) { res.status(409).json({ error: "This recording changed meanwhile. Please reopen it." }); return; }
      retranscribe(current.id, layered.url);
      relinkLater(current.id);
      const [saved] = await select().where(eq(audioLibraryTable.id, current.id));
      res.json(serialize(saved));
      return;
    }
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
      mix: null,
    }).where(and(eq(audioLibraryTable.id, current.id), eq(audioLibraryTable.url, current.url)))
      .returning({ id: audioLibraryTable.id });
    if (!updated) { res.status(409).json({ error: "This recording changed meanwhile. Please reopen it." }); return; }
    retranscribe(current.id, edited.url);
    relinkLater(current.id);
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
    const result = await wordsForStoredAudio(canonicalStorageUrl(current.mix?.voiceUrl ?? current.url), body.data.language ?? "auto");
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
    const voiceUrl = current.mix?.voiceUrl ?? current.url;
    const voiceDone = await enhanceRecording(voiceUrl, { denoise: body.data.denoise ?? true, level: body.data.level ?? true });
    const improved = current.mix ? await remix(current, { url: voiceDone.url, marks: current.mix.voiceMarks, duration: current.mix.voiceDuration }) : { ...voiceDone, mix: null };
    // Timing is unchanged, so the transcript and word timings stay valid.
    const [updated] = await db.update(audioLibraryTable).set({
      url: improved.url,
      mimeType: improved.mimeType,
      ...(current.mix ? { durationSeconds: (improved as { durationSeconds?: number }).durationSeconds, marks: (improved as { marks?: number[] }).marks } : {}),
      originalMarks: current.originalMarks ?? current.mix?.voiceMarks ?? current.marks ?? [],
      originalUrl: current.originalUrl ?? current.mix?.voiceUrl ?? current.url,
      mix: improved.mix,
    }).where(and(eq(audioLibraryTable.id, current.id), eq(audioLibraryTable.url, current.url)))
      .returning({ id: audioLibraryTable.id });
    if (!updated) { res.status(409).json({ error: "This recording changed meanwhile. Please try again." }); return; }
    relinkLater(current.id);
    const [saved] = await select().where(eq(audioLibraryTable.id, current.id));
    res.json(serialize(saved));
  } catch (error) {
    editFailure(res, error);
  }
});

router.post("/audio-library/:itemId/sound-lab", async (req, res): Promise<void> => {
  const params = UpdateAudioLibraryItemParams.safeParse(req.params);
  const body = SoundLabAudioLibraryItemBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid sound settings" }); return; }
  const [current] = await db.select().from(audioLibraryTable).where(eq(audioLibraryTable.id, params.data.itemId));
  if (!current) { res.status(404).json({ error: "Not in the library" }); return; }
  try {
    const voiceUrl = current.mix?.voiceUrl ?? current.url;
    const voiceDone = await soundLabRecording(voiceUrl, { ...body.data, hum: body.data.hum ?? null });
    const improved = current.mix ? await remix(current, { url: voiceDone.url, marks: current.mix.voiceMarks, duration: current.mix.voiceDuration }) : { ...voiceDone, mix: null };
    // Timing is unchanged, so the transcript, word timings, bookmarks and chapters stay valid.
    const [updated] = await db.update(audioLibraryTable).set({
      url: improved.url,
      mimeType: improved.mimeType,
      ...(current.mix ? { durationSeconds: (improved as { durationSeconds?: number }).durationSeconds, marks: (improved as { marks?: number[] }).marks } : {}),
      originalMarks: current.originalMarks ?? current.mix?.voiceMarks ?? current.marks ?? [],
      originalUrl: current.originalUrl ?? current.mix?.voiceUrl ?? current.url,
      mix: improved.mix,
    }).where(and(eq(audioLibraryTable.id, current.id), eq(audioLibraryTable.url, current.url)))
      .returning({ id: audioLibraryTable.id });
    if (!updated) { res.status(409).json({ error: "This recording changed meanwhile. Please try again." }); return; }
    relinkLater(current.id);
    const [saved] = await select().where(eq(audioLibraryTable.id, current.id));
    res.json(serialize(saved));
  } catch (error) {
    editFailure(res, error);
  }
});

router.post("/audio-library/:itemId/sound-lab/preview", async (req, res): Promise<void> => {
  const params = UpdateAudioLibraryItemParams.safeParse(req.params);
  const body = PreviewSoundLabAudioLibraryItemBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid sound settings" }); return; }
  const [current] = await db.select().from(audioLibraryTable).where(eq(audioLibraryTable.id, params.data.itemId));
  if (!current) { res.status(404).json({ error: "Not in the library" }); return; }
  try {
    const { settings, start, seconds } = body.data;
    await soundLabPreview(current.mix?.voiceUrl ?? current.url, { ...settings, hum: settings.hum ?? null }, start, seconds ?? 15, (path) => new Promise<void>((resolve, reject) => {
      res.setHeader("Cache-Control", "private, no-store");
      res.sendFile(path, { headers: { "Content-Type": "audio/mpeg" } }, (error) => (error ? reject(error) : resolve()));
    }));
  } catch (error) {
    if (!res.headersSent) editFailure(res, error);
  }
});

/**
 * The voice to mix (the voice-only layer if the recording already has music) and the music
 * (a library item, or the song an existing mix used even if it was later removed from the library).
 */
async function mixSources(itemId: number, musicItemId: number) {
  const [item] = await db.select().from(audioLibraryTable).where(eq(audioLibraryTable.id, itemId));
  if (!item) return null;
  const [music] = await db.select().from(audioLibraryTable).where(eq(audioLibraryTable.id, musicItemId));
  const musicUrl = music?.url ?? (item.mix?.musicItemId === musicItemId ? item.mix.musicUrl : null);
  if (!musicUrl) return null;
  return {
    item,
    voiceUrl: item.mix?.voiceUrl ?? item.url,
    voiceMarks: item.mix?.voiceMarks ?? item.marks ?? [],
    voiceDuration: item.mix ? item.mix.voiceDuration : item.durationSeconds,
    musicUrl,
    musicTitle: music?.title ?? item.mix?.musicTitle ?? null,
  };
}

const shiftChapters = (chapters: AudioLibraryRecord["chapters"], by: number, length: number) =>
  chapters?.map((chapter) => ({ ...chapter, start: Math.max(0, Math.min(length, chapter.start + by)) })) ?? null;

router.post("/audio-library/:itemId/mix", async (req, res): Promise<void> => {
  const params = UpdateAudioLibraryItemParams.safeParse(req.params);
  const body = MixAudioLibraryItemBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid music settings" }); return; }
  const sources = await mixSources(params.data.itemId, body.data.musicItemId);
  if (!sources) { res.status(404).json({ error: "The recording or the music is no longer in the library" }); return; }
  const { item, voiceUrl, voiceMarks, voiceDuration, musicUrl, musicTitle } = sources;
  try {
    const mixed = await mixRecording(voiceUrl, musicUrl, body.data.settings);
    const { pre, total } = mixed.plan;
    const marks = cleanMarks(voiceMarks.map((mark) => mark + pre), total);
    const layer = {
      voiceUrl, voiceMarks, voiceDuration, musicItemId: body.data.musicItemId, musicUrl, musicTitle, pre,
      settings: body.data.settings,
    };
    if ((body.data.target ?? "copy") === "same") {
      // Music on this recording, removable later: the voice-only audio is kept in the layer.
      const [updated] = await db.update(audioLibraryTable).set({
        url: mixed.url,
        mimeType: mixed.mimeType,
        durationSeconds: Math.round(total),
        marks,
        words: null,
        chapters: shiftChapters(item.chapters, pre - (item.mix?.pre ?? 0), total),
        mix: layer,
      }).where(and(eq(audioLibraryTable.id, item.id), eq(audioLibraryTable.url, item.url)))
        .returning({ id: audioLibraryTable.id });
      if (!updated) { res.status(409).json({ error: "This recording changed meanwhile. Please try again." }); return; }
      relinkLater(item.id);
      const [saved] = await select().where(eq(audioLibraryTable.id, item.id));
      res.json(serialize(saved));
      return;
    }
    const [inserted] = await db.insert(audioLibraryTable).values({
      url: mixed.url,
      title: body.data.title?.trim() || null,
      mimeType: mixed.mimeType,
      durationSeconds: Math.round(total),
      transcript: item.transcript,
      marks,
      kind: "recording",
      mix: layer,
    }).returning({ id: audioLibraryTable.id });
    const [saved] = await select().where(eq(audioLibraryTable.id, inserted.id));
    res.status(201).json(serialize(saved));
  } catch (error) {
    editFailure(res, error);
  }
});

router.post("/audio-library/:itemId/mix/remove", async (req, res): Promise<void> => {
  const params = UpdateAudioLibraryItemParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid item" }); return; }
  const [current] = await db.select().from(audioLibraryTable).where(eq(audioLibraryTable.id, params.data.itemId));
  if (!current) { res.status(404).json({ error: "Not in the library" }); return; }
  if (!current.mix) {
    // An old copy with the music baked in: give it back the voice of the recording it was made from.
    const all = await db.select().from(audioLibraryTable);
    const source = findLegacySource(current, all);
    if (!source) { res.status(409).json({ error: "This recording has no background music that can be removed." }); return; }
    try {
      const voiceUrl = await duplicateStored(source.mix?.voiceUrl ?? source.url);
      const durationSeconds = (source.mix ? source.mix.voiceDuration : source.durationSeconds) ?? await storedDuration(voiceUrl).catch(() => null);
      await db.update(audioLibraryTable).set({
        url: voiceUrl,
        mimeType: source.mimeType,
        durationSeconds: durationSeconds == null ? null : Math.round(durationSeconds),
        marks: source.mix?.voiceMarks ?? source.marks ?? [],
        // The copy's name was "<name> · with music"; an automatic name (start of the transcript) stays automatic.
        title: ((name) => (name && name !== snippet(current.transcript) ? name : null))(current.title?.replace(LEGACY_SUFFIX, "").trim()),
        words: null, chapters: null, summary: null,
      }).where(eq(audioLibraryTable.id, current.id));
      relinkLater(current.id);
      const [saved] = await select().where(eq(audioLibraryTable.id, current.id));
      res.json(serialize(saved));
    } catch (error) {
      editFailure(res, error);
    }
    return;
  }
  try {
    const { mix } = current;
    // A copy's voice may still belong to the recording it was made from: give it its own file.
    const [sharing] = await db.select({ id: audioLibraryTable.id }).from(audioLibraryTable).where(eq(audioLibraryTable.url, mix.voiceUrl));
    const voiceUrl = sharing && sharing.id !== current.id ? await duplicateStored(mix.voiceUrl) : mix.voiceUrl;
    const durationSeconds = mix.voiceDuration ?? await storedDuration(voiceUrl).catch(() => null);
    const [updated] = await db.update(audioLibraryTable).set({
      url: voiceUrl,
      mimeType: null,
      durationSeconds,
      marks: mix.voiceMarks,
      words: null,
      chapters: shiftChapters(current.chapters, -mix.pre, durationSeconds ?? Infinity),
      mix: null,
    }).where(and(eq(audioLibraryTable.id, current.id), eq(audioLibraryTable.url, current.url)))
      .returning({ id: audioLibraryTable.id });
    if (!updated) { res.status(409).json({ error: "This recording changed meanwhile. Please try again." }); return; }
    relinkLater(current.id);
    const [saved] = await select().where(eq(audioLibraryTable.id, current.id));
    res.json(serialize(saved));
  } catch (error) {
    editFailure(res, error);
  }
});

router.post("/audio-library/:itemId/mix/preview", async (req, res): Promise<void> => {
  const params = UpdateAudioLibraryItemParams.safeParse(req.params);
  const body = PreviewMixAudioLibraryItemBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid music settings" }); return; }
  const sources = await mixSources(params.data.itemId, body.data.musicItemId);
  if (!sources) { res.status(404).json({ error: "The recording or the music is no longer in the library" }); return; }
  try {
    await mixPreview(sources.voiceUrl, sources.musicUrl, body.data.settings, body.data.start, body.data.seconds ?? 15, (path) => new Promise<void>((resolve, reject) => {
      res.setHeader("Cache-Control", "private, no-store");
      res.sendFile(path, { headers: { "Content-Type": "audio/mpeg" } }, (error) => (error ? reject(error) : resolve()));
    }));
  } catch (error) {
    if (!res.headersSent) editFailure(res, error);
  }
});

const audioExtension = (mime: string | null) => (mime?.includes("mp4") ? "m4a" : mime?.includes("mpeg") ? "mp3" : mime?.includes("wav") ? "wav" : "webm");

router.post("/audio-library/:itemId/subjects", async (req, res): Promise<void> => {
  const params = UpdateAudioLibraryItemParams.safeParse(req.params);
  const body = AddAudioLibraryItemToSubjectBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) { res.status(400).json({ error: "Choose a subject" }); return; }
  const [row] = await select().where(eq(audioLibraryTable.id, params.data.itemId));
  if (!row) { res.status(404).json({ error: "Not in the library" }); return; }
  const [subject] = await db.select({ id: subjectsTable.id, title: subjectsTable.title }).from(subjectsTable).where(eq(subjectsTable.id, body.data.subjectId));
  if (!subject) { res.status(404).json({ error: "That subject no longer exists." }); return; }
  const item = row.item;
  let links = (await subjectLinks([item])).get(item.id) ?? [];
  if (!links.some((link) => link.subjectId === subject.id)) {
    const text = item.transcript?.trim();
    const [idea] = await db.insert(ideasTable).values({
      subjectId: subject.id,
      content: text || item.title || "Voice note",
      source: "voice",
      attachments: [{
        type: "audio",
        url: item.url,
        name: `${(item.title || "voice-note").replace(/[\\/:*?"<>|]+/g, " ").slice(0, 60)}.${audioExtension(item.mimeType)}`,
        ...(item.mimeType ? { mimeType: item.mimeType } : {}),
        ...(text ? { transcript: text } : { awaitingText: true }),
        ...(item.durationSeconds != null ? { durationSeconds: item.durationSeconds } : {}),
        ...(item.marks?.length ? { marks: item.marks } : {}),
        libraryItemId: item.id,
      }],
    }).returning();
    await db.update(subjectsTable).set({ updatedAt: new Date() }).where(eq(subjectsTable.id, subject.id));
    if (item.sourceIdeaId == null) {
      await db.update(audioLibraryTable).set({ sourceIdeaId: idea.id, sourceSubjectTitle: subject.title }).where(eq(audioLibraryTable.id, item.id));
    }
    links = [...links, { subjectId: subject.id, subjectTitle: subject.title, ideaId: idea.id }];
  }
  const [saved] = await select().where(eq(audioLibraryTable.id, item.id));
  res.json(serialize(saved, false, links));
});

router.post("/audio-library/:itemId/subjects/:subjectId/remove", async (req, res): Promise<void> => {
  const params = RemoveAudioLibraryItemFromSubjectParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid request" }); return; }
  const [row] = await select().where(eq(audioLibraryTable.id, params.data.itemId));
  if (!row) { res.status(404).json({ error: "Not in the library" }); return; }
  const item = row.item;
  const links = (await subjectLinks([item])).get(item.id) ?? [];
  const removing = links.filter((link) => link.subjectId === params.data.subjectId);
  for (const link of removing) {
    const [idea] = await db.select().from(ideasTable).where(eq(ideasTable.id, link.ideaId));
    if (!idea) continue;
    const mine = (attachment: (typeof idea.attachments)[number]) =>
      attachment.type === "audio" && (attachment.libraryItemId === item.id || canonicalStorageUrl(attachment.url) === canonicalStorageUrl(item.url));
    const rest = idea.attachments.filter((attachment) => !mine(attachment));
    // An idea that was just this recording goes; one with other material keeps it.
    if (!rest.length || idea.id === item.sourceIdeaId && rest.length === idea.attachments.length) await db.delete(ideasTable).where(eq(ideasTable.id, idea.id));
    else await db.update(ideasTable).set({ attachments: rest }).where(eq(ideasTable.id, idea.id));
  }
  if (removing.some((link) => link.ideaId === item.sourceIdeaId)) {
    const next = links.find((link) => link.subjectId !== params.data.subjectId);
    await db.update(audioLibraryTable).set({ sourceIdeaId: next?.ideaId ?? null, sourceSubjectTitle: next?.subjectTitle ?? null }).where(eq(audioLibraryTable.id, item.id));
  }
  const [saved] = await select().where(eq(audioLibraryTable.id, item.id));
  res.json(serialize(saved, false, links.filter((link) => link.subjectId !== params.data.subjectId)));
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
      const result = await wordsForStoredAudio(canonicalStorageUrl(current.mix?.voiceUrl ?? current.url), "auto");
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
    const chapters = current.mix ? shiftChapters(parsed.chapters, current.mix.pre, duration) : parsed.chapters;
    await db.update(audioLibraryTable).set({ chapters, summary: parsed.summary || null })
      .where(and(eq(audioLibraryTable.id, current.id), eq(audioLibraryTable.url, current.url)));
    relinkLater(current.id);
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
        marks: current.originalMarks ?? current.marks ?? [], originalMarks: null, chapters: null, summary: null, mix: null })
      .where(eq(audioLibraryTable.id, current.id));
    retranscribe(current.id, current.originalUrl);
    relinkLater(current.id);
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
