import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { count, desc, eq } from "drizzle-orm";
import { db, ideasTable, subjectsTable } from "@workspace/db";
import {
  CompileSubjectBody,
  CompileSubjectParams,
  CompileSubjectResponse,
  CreateIdeaBody,
  CreateIdeaParams,
  CreateIdeaResponse,
  CreateSubjectBody,
  CreateSubjectResponse,
  DeleteIdeaParams,
  DeleteSubjectParams,
  GetSubjectParams,
  GetSubjectResponse,
  ListIdeasParams,
  ListIdeasResponse,
  ListSubjectsResponse,
  UpdateIdeaBody,
  UpdateIdeaParams,
  UpdateIdeaResponse,
  UpdateSubjectBody,
  UpdateSubjectParams,
  UpdateSubjectResponse,
  TranscribeAudioBody,
  TranscribeAudioResponse,
  TranslateNoteBody,
  TranslateNoteResponse,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  ensureCompatibleFormat,
  speechToText,
} from "@workspace/integrations-openai-ai-server/audio";

const router: IRouter = Router();

router.use((req, res, next) => {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});

router.post("/transcriptions", async (req, res): Promise<void> => {
  const body = TranscribeAudioBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  try {
    const audio = Buffer.from(body.data.audioBase64, "base64");
    if (audio.length === 0 || audio.length > 15 * 1024 * 1024) {
      res.status(400).json({ error: "Recording must be between 1 byte and 15 MB" });
      return;
    }

    const { buffer, format } = await ensureCompatibleFormat(audio);
    const text = (await speechToText(buffer, format)).trim();
    if (!text) {
      res.status(422).json({ error: "No speech was detected in the recording" });
      return;
    }

    res.json(TranscribeAudioResponse.parse({ text }));
  } catch (error) {
    console.error("Audio transcription failed", error);
    res.status(502).json({ error: "The recording could not be transcribed" });
  }
});

router.post("/note-translations", async (req, res): Promise<void> => {
  const body = TranslateNoteBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  try {
    const languageName = body.data.targetLanguage === "ar" ? "Arabic" : "English";
    const response = await openai.chat.completions.create({
      model: "gpt-5.6-luna",
      max_completion_tokens: 2048,
      messages: [
        {
          role: "system",
          content: `Translate the user's note into ${languageName}. Preserve its meaning, tone, names, links, and formatting. Return only the translation.`,
        },
        { role: "user", content: body.data.text },
      ],
    });
    const text = response.choices[0]?.message.content?.trim();
    if (!text) {
      res.status(502).json({ error: "The note could not be translated" });
      return;
    }
    res.json(TranslateNoteResponse.parse({ text, language: body.data.targetLanguage }));
  } catch (error) {
    console.error("Note translation failed", error);
    res.status(502).json({ error: "The note could not be translated" });
  }
});

const serializeSubject = (
  subject: typeof subjectsTable.$inferSelect,
  ideaCount: number,
) => ({
  id: subject.id,
  title: subject.title,
  intro: subject.intro,
  createdAt: subject.createdAt.toISOString(),
  updatedAt: subject.updatedAt.toISOString(),
  ideaCount,
});

const serializeIdea = (idea: typeof ideasTable.$inferSelect) => ({
  id: idea.id,
  subjectId: idea.subjectId,
  content: idea.content,
  source: idea.source,
  attachments: idea.attachments,
  createdAt: idea.createdAt.toISOString(),
});

router.get("/subjects", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      subject: subjectsTable,
      ideaCount: count(ideasTable.id),
    })
    .from(subjectsTable)
    .leftJoin(ideasTable, eq(ideasTable.subjectId, subjectsTable.id))
    .groupBy(subjectsTable.id)
    .orderBy(desc(subjectsTable.updatedAt));

  res.json(
    ListSubjectsResponse.parse(
      rows.map(({ subject, ideaCount }) =>
        serializeSubject(subject, Number(ideaCount)),
      ),
    ),
  );
});

router.post("/subjects", async (req, res): Promise<void> => {
  const body = CreateSubjectBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [subject] = await db
    .insert(subjectsTable)
    .values({ title: body.data.title.trim(), intro: body.data.intro ?? "" })
    .returning();

  res.status(201).json(CreateSubjectResponse.parse(serializeSubject(subject, 0)));
});

router.get("/subjects/:subjectId", async (req, res): Promise<void> => {
  const params = GetSubjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [subject] = await db
    .select()
    .from(subjectsTable)
    .where(eq(subjectsTable.id, params.data.subjectId));

  if (!subject) {
    res.status(404).json({ error: "Subject not found" });
    return;
  }

  const ideas = await db
    .select()
    .from(ideasTable)
    .where(eq(ideasTable.subjectId, subject.id))
    .orderBy(desc(ideasTable.createdAt));

  res.json(
    GetSubjectResponse.parse({
      ...serializeSubject(subject, ideas.length),
      ideas: ideas.map(serializeIdea),
      draft: subject.draft,
    }),
  );
});

router.patch("/subjects/:subjectId", async (req, res): Promise<void> => {
  const params = UpdateSubjectParams.safeParse(req.params);
  const body = UpdateSubjectBody.safeParse(req.body);
  if (!params.success || !body.success) {
    const error = !params.success
      ? params.error.message
      : !body.success
        ? body.error.message
        : "Invalid request";
    res.status(400).json({ error });
    return;
  }

  const [subject] = await db
    .update(subjectsTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(eq(subjectsTable.id, params.data.subjectId))
    .returning();

  if (!subject) {
    res.status(404).json({ error: "Subject not found" });
    return;
  }

  const [{ ideaCount }] = await db
    .select({ ideaCount: count(ideasTable.id) })
    .from(ideasTable)
    .where(eq(ideasTable.subjectId, subject.id));

  res.json(
    UpdateSubjectResponse.parse(
      serializeSubject(subject, Number(ideaCount)),
    ),
  );
});

router.delete("/subjects/:subjectId", async (req, res): Promise<void> => {
  const params = DeleteSubjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(subjectsTable)
    .where(eq(subjectsTable.id, params.data.subjectId))
    .returning({ id: subjectsTable.id });

  if (!deleted) {
    res.status(404).json({ error: "Subject not found" });
    return;
  }

  res.sendStatus(204);
});

router.get("/subjects/:subjectId/ideas", async (req, res): Promise<void> => {
  const params = ListIdeasParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const ideas = await db
    .select()
    .from(ideasTable)
    .where(eq(ideasTable.subjectId, params.data.subjectId))
    .orderBy(desc(ideasTable.createdAt));

  res.json(ListIdeasResponse.parse(ideas.map(serializeIdea)));
});

router.post("/subjects/:subjectId/ideas", async (req, res): Promise<void> => {
  const params = CreateIdeaParams.safeParse(req.params);
  const body = CreateIdeaBody.safeParse(req.body);
  if (!params.success || !body.success) {
    const error = !params.success
      ? params.error.message
      : !body.success
        ? body.error.message
        : "Invalid request";
    res.status(400).json({ error });
    return;
  }

  const [idea] = await db
    .insert(ideasTable)
    .values({
      subjectId: params.data.subjectId,
      content: body.data.content.trim(),
      source: body.data.source ?? "text",
      attachments: body.data.attachments ?? [],
    })
    .returning();

  await db
    .update(subjectsTable)
    .set({ updatedAt: new Date() })
    .where(eq(subjectsTable.id, params.data.subjectId));

  res.status(201).json(CreateIdeaResponse.parse(serializeIdea(idea)));
});

router.patch("/ideas/:ideaId", async (req, res): Promise<void> => {
  const params = UpdateIdeaParams.safeParse(req.params);
  const body = UpdateIdeaBody.safeParse(req.body);
  if (!params.success || !body.success) {
    const error = !params.success
      ? params.error.message
      : !body.success
        ? body.error.message
        : "Invalid request";
    res.status(400).json({ error });
    return;
  }

  const [idea] = await db
    .update(ideasTable)
    .set(body.data)
    .where(eq(ideasTable.id, params.data.ideaId))
    .returning();

  if (!idea) {
    res.status(404).json({ error: "Idea not found" });
    return;
  }

  res.json(UpdateIdeaResponse.parse(serializeIdea(idea)));
});

router.delete("/ideas/:ideaId", async (req, res): Promise<void> => {
  const params = DeleteIdeaParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(ideasTable)
    .where(eq(ideasTable.id, params.data.ideaId))
    .returning({ id: ideasTable.id });

  if (!deleted) {
    res.status(404).json({ error: "Idea not found" });
    return;
  }

  res.sendStatus(204);
});

router.post("/subjects/:subjectId/compile", async (req, res): Promise<void> => {
  const params = CompileSubjectParams.safeParse(req.params);
  const body = CompileSubjectBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) {
    const error = !params.success
      ? params.error.message
      : !body.success
        ? body.error.message
        : "Invalid request";
    res.status(400).json({ error });
    return;
  }

  const [subject] = await db
    .select()
    .from(subjectsTable)
    .where(eq(subjectsTable.id, params.data.subjectId));
  const ideas = await db
    .select()
    .from(ideasTable)
    .where(eq(ideasTable.subjectId, params.data.subjectId))
    .orderBy(ideasTable.createdAt);

  if (!subject) {
    res.status(404).json({ error: "Subject not found" });
    return;
  }
  if (ideas.length === 0) {
    res.status(400).json({ error: "Add at least one idea before compiling" });
    return;
  }

  const response = await openai.chat.completions.create({
    model: "gpt-5.6-luna",
    max_completion_tokens: 8192,
    messages: [
      {
        role: "system",
        content:
          "You are an expert editor. Turn the user's accumulated idea fragments into one coherent, polished draft. Preserve the author's meaning, remove repetition, create a logical progression, and do not invent unsupported facts. Return only the finished draft.",
      },
      {
        role: "user",
        content: `Title: ${subject.title}\nIntroduction: ${subject.intro || "None"}\nRequested tone: ${body.data.tone ?? "clear"}\n\nIdea fragments in chronological order:\n${ideas.map((idea, index) => `${index + 1}. ${idea.content}`).join("\n")}`,
      },
    ],
  });

  const draft = response.choices[0]?.message.content?.trim();
  if (!draft) {
    res.status(502).json({ error: "The draft could not be generated" });
    return;
  }

  await db
    .update(subjectsTable)
    .set({ draft, updatedAt: new Date() })
    .where(eq(subjectsTable.id, subject.id));

  res.json(
    CompileSubjectResponse.parse({
      subjectId: subject.id,
      title: subject.title,
      draft,
      generatedAt: new Date().toISOString(),
    }),
  );
});

export default router;