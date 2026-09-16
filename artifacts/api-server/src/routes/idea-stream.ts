import { Router, type IRouter } from "express";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { and, asc, count, desc, eq, isNotNull } from "drizzle-orm";
import {
  compilationImagesTable,
  db,
  ideaChatMessagesTable,
  ideasTable,
  subjectCompilationsTable,
  subjectsTable,
} from "@workspace/db";
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
  ListSubjectCompilationsParams,
  ListSubjectCompilationsResponse,
  UpdateIdeaBody,
  UpdateIdeaParams,
  UpdateIdeaResponse,
  UpdateSubjectBody,
  UpdateSubjectParams,
  UpdateSubjectResponse,
  UpdateSubjectCompilationBody,
  UpdateSubjectCompilationParams,
  UpdateSubjectCompilationResponse,
  DeleteSubjectCompilationParams,
  TranscribeAudioBody,
  TranscribeAudioResponse,
  TranslateNoteBody,
  TranslateNoteResponse,
  ExtractYoutubeTranscriptBody,
  ExtractYoutubeTranscriptResponse,
  ClearIdeaChatParams,
  ListIdeaChatMessagesParams,
  ListIdeaChatMessagesResponse,
  SendIdeaChatMessageBody,
  SendIdeaChatMessageParams,
  SendIdeaChatMessageResponse,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  ensureCompatibleFormat,
  speechToText,
} from "@workspace/integrations-openai-ai-server/audio";
import { ObjectStorageService } from "../lib/objectStorage";
import sanitizeHtml from "sanitize-html";

const router: IRouter = Router();
const execFileAsync = promisify(execFile);
const objectStorageService = new ObjectStorageService();
const RICH_TEXT_MARKER = "<!--idea-stream-rich-text-->";

function sanitizeStoredDraft(value: string) {
  if (!value.startsWith(RICH_TEXT_MARKER)) return value;
  const safeHtml = sanitizeHtml(value.slice(RICH_TEXT_MARKER.length), {
    allowedTags: [
      "p", "br", "h1", "h2", "h3", "strong", "b", "em", "i", "u", "s",
      "strike", "ul", "ol", "li", "blockquote", "a", "img", "span", "div", "font",
    ],
    allowedAttributes: {
      "*": ["dir", "style"],
      a: ["href", "target", "rel"],
      img: ["src", "alt"],
      font: ["face", "size", "color"],
    },
    allowedStyles: {
      "*": {
        "text-align": [/^(left|right|center|justify)$/],
        color: [/^#[0-9a-f]{3,8}$/i, /^rgb\([\d\s,.%]+\)$/i],
        "font-family": [/^[\w\s,'"-]+$/],
        "font-size": [/^[\d.]+(px|pt|em|rem|%)$/],
        width: [/^[\d.]+(px|em|rem|%)$/],
        "max-width": [/^[\d.]+(px|em|rem|%)$/],
        height: [/^(auto|[\d.]+(px|em|rem|%))$/],
        display: [/^(block|inline|inline-block)$/],
        float: [/^(left|right|none)$/],
        margin: [/^[\d.]+(px|em|rem|%)(\s+(auto|[\d.]+(px|em|rem|%))){0,3}$/],
        "margin-top": [/^(auto|[\d.]+(px|em|rem|%))$/],
        "margin-right": [/^(auto|[\d.]+(px|em|rem|%))$/],
        "margin-bottom": [/^(auto|[\d.]+(px|em|rem|%))$/],
        "margin-left": [/^(auto|[\d.]+(px|em|rem|%))$/],
      },
    },
    allowedSchemes: ["http", "https"],
    allowedSchemesByTag: { img: ["http", "https"] },
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: {
          ...attribs,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
    },
  });
  return `${RICH_TEXT_MARKER}${safeHtml}`;
}

function extractStoredCompilationImages(content: string) {
  if (!content.startsWith(RICH_TEXT_MARKER)) return [];
  const images = new Map<string, { objectPath: string; altText: string }>();
  const imagePattern = /<img\b([^>]*)>/gi;
  for (const match of content.matchAll(imagePattern)) {
    const attributes = match[1] ?? "";
    const src = attributes.match(/\bsrc=(?:"([^"]*)"|'([^']*)')/i);
    const alt = attributes.match(/\balt=(?:"([^"]*)"|'([^']*)')/i);
    const objectPath = src?.[1] ?? src?.[2] ?? "";
    if (!objectPath.startsWith("/api/storage/objects/")) continue;
    images.set(objectPath, {
      objectPath,
      altText: (alt?.[1] ?? alt?.[2] ?? "").slice(0, 500),
    });
  }
  return Array.from(images.values());
}

function serializeChatMessage(
  message: typeof ideaChatMessagesTable.$inferSelect,
) {
  return {
    ...message,
    createdAt: message.createdAt.toISOString(),
  };
}

function serializeCompilation(
  compilation: typeof subjectCompilationsTable.$inferSelect,
) {
  return {
    ...compilation,
    createdAt: compilation.createdAt.toISOString(),
    updatedAt: compilation.updatedAt.toISOString(),
  };
}

function normalizeExtractedText(value: string) {
  return value
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 120_000);
}

async function extractAttachmentText(attachment: {
  type: string;
  url: string;
  name: string;
  mimeType?: string;
}) {
  if (!attachment.url.startsWith("/api/storage/objects/")) return "";

  const objectPath = attachment.url.slice("/api/storage".length);
  const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
  const response = await objectStorageService.downloadObject(objectFile, 0);
  const declaredSize = Number(response.headers.get("content-length") || "0");
  if (declaredSize > 25 * 1024 * 1024) {
    throw new Error("Document is too large to extract");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 25 * 1024 * 1024) {
    throw new Error("Document is too large to extract");
  }

  const fileName = attachment.name.toLowerCase();
  const mimeType = attachment.mimeType?.toLowerCase() ?? "";
  if (
    mimeType.startsWith("text/") ||
    fileName.endsWith(".txt") ||
    fileName.endsWith(".md") ||
    fileName.endsWith(".rtf")
  ) {
    return normalizeExtractedText(bytes.toString("utf8"));
  }

  const tempDirectory = await mkdtemp(join(tmpdir(), "idea-document-"));
  const inputPath = join(tempDirectory, fileName.replace(/[^a-z0-9._-]/g, "_") || "document");
  try {
    await writeFile(inputPath, bytes);
    if (attachment.type === "pdf" || mimeType === "application/pdf" || fileName.endsWith(".pdf")) {
      const { stdout } = await execFileAsync("pdftotext", [inputPath, "-"], {
        maxBuffer: 4 * 1024 * 1024,
      });
      return normalizeExtractedText(stdout);
    }
    if (fileName.endsWith(".doc")) {
      const { stdout } = await execFileAsync("antiword", [inputPath], {
        maxBuffer: 4 * 1024 * 1024,
      });
      return normalizeExtractedText(stdout);
    }
    if (fileName.endsWith(".docx") || fileName.endsWith(".odt")) {
      const innerPath = fileName.endsWith(".docx") ? "word/document.xml" : "content.xml";
      const { stdout } = await execFileAsync("unzip", ["-p", inputPath, innerPath], {
        maxBuffer: 4 * 1024 * 1024,
      });
      return normalizeExtractedText(
        stdout
          .replace(/<w:tab\/>/g, "\t")
          .replace(/<\/w:p>|<\/text:p>/g, "\n")
          .replace(/<[^>]+>/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, "\"")
          .replace(/&apos;/g, "'"),
      );
    }
    return "";
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

async function buildIdeaContext(idea: typeof ideasTable.$inferSelect) {
  const attachmentSections = await Promise.all(
    idea.attachments.map(async (attachment, index) => {
      let extractedText = attachment.extractedText ?? "";
      if (
        !extractedText &&
        (attachment.type === "pdf" || attachment.type === "document")
      ) {
        try {
          extractedText = await extractAttachmentText(attachment);
        } catch (error) {
          console.error(`Text extraction failed for ${attachment.name}`, error);
        }
      }

      const availableContent = [
        attachment.note ? `User note:\n${attachment.note}` : "",
        attachment.transcript ? `Transcript:\n${attachment.transcript}` : "",
        extractedText ? `Extracted document text:\n${extractedText}` : "",
      ].filter(Boolean);
      if (availableContent.length === 0) return "";

      return `Attachment ${index + 1} (${attachment.name}, ${attachment.type}):\n${availableContent.join("\n\n")}`;
    }),
  );

  const attachmentContext = attachmentSections.filter(Boolean).join("\n\n");

  return `IDEA TEXT:\n${idea.content}\n\nATTACHMENT CONTENT:\n${attachmentContext || "No additional text is available."}`.slice(0, 120_000);
}

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

router.post("/youtube-transcripts", async (req, res): Promise<void> => {
  const body = ExtractYoutubeTranscriptBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const workingDir = await mkdtemp(join(tmpdir(), "idea-stream-youtube-"));
  try {
    try {
      await execFileAsync(
        "yt-dlp",
        [
          "--skip-download",
          "--write-subs",
          "--write-auto-subs",
          "--sub-langs", "en-orig,en,ar",
          "--sub-format", "vtt",
          "--no-playlist",
          "-o", join(workingDir, "%(id)s"),
          body.data.url,
        ],
        { timeout: 90_000, maxBuffer: 2 * 1024 * 1024 },
      );
    } catch {
      // yt-dlp may report one unavailable language after successfully saving another.
    }

    const files = (await readdir(workingDir)).filter((name) => name.endsWith(".vtt"));
    const preferredFile =
      files.find((name) => name.endsWith(".en-orig.vtt")) ??
      files.find((name) => name.endsWith(".en.vtt")) ??
      files.find((name) => name.endsWith(".ar.vtt")) ??
      files[0];
    if (!preferredFile) {
      res.status(422).json({ error: "No captions are available for this video" });
      return;
    }

    const vtt = await readFile(join(workingDir, preferredFile), "utf8");
    const seen = new Set<string>();
    const text = vtt
      .split(/\r?\n/)
      .filter((line) =>
        line.trim() &&
        line.trim() !== "WEBVTT" &&
        !line.includes("-->") &&
        !/^(Kind|Language):/.test(line),
      )
      .map((line) => line.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim())
      .filter((line) => {
        if (!line || seen.has(line)) return false;
        seen.add(line);
        return true;
      })
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (!text) {
      res.status(422).json({ error: "The available captions were empty" });
      return;
    }
    res.json(ExtractYoutubeTranscriptResponse.parse({ text }));
  } catch (error) {
    console.error("YouTube transcript extraction failed", error);
    res.status(502).json({ error: "The YouTube transcript could not be extracted" });
  } finally {
    await rm(workingDir, { recursive: true, force: true });
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

router.get("/ideas/:ideaId/chat", async (req, res): Promise<void> => {
  const params = ListIdeaChatMessagesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [idea] = await db
    .select({ id: ideasTable.id })
    .from(ideasTable)
    .where(eq(ideasTable.id, params.data.ideaId));
  if (!idea) {
    res.status(404).json({ error: "Idea not found" });
    return;
  }

  const messages = await db
    .select()
    .from(ideaChatMessagesTable)
    .where(eq(ideaChatMessagesTable.ideaId, idea.id))
    .orderBy(asc(ideaChatMessagesTable.createdAt), asc(ideaChatMessagesTable.id));

  res.json(
    ListIdeaChatMessagesResponse.parse(messages.map(serializeChatMessage)),
  );
});

router.delete("/ideas/:ideaId/chat", async (req, res): Promise<void> => {
  const params = ClearIdeaChatParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [idea] = await db
    .select({ id: ideasTable.id })
    .from(ideasTable)
    .where(eq(ideasTable.id, params.data.ideaId));
  if (!idea) {
    res.status(404).json({ error: "Idea not found" });
    return;
  }

  await db
    .delete(ideaChatMessagesTable)
    .where(eq(ideaChatMessagesTable.ideaId, idea.id));
  res.sendStatus(204);
});

router.post("/ideas/:ideaId/chat/messages", async (req, res): Promise<void> => {
  const params = SendIdeaChatMessageParams.safeParse(req.params);
  const body = SendIdeaChatMessageBody.safeParse(req.body);
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
    .select()
    .from(ideasTable)
    .where(eq(ideasTable.id, params.data.ideaId));
  if (!idea) {
    res.status(404).json({ error: "Idea not found" });
    return;
  }

  try {
    const history = await db
      .select()
      .from(ideaChatMessagesTable)
      .where(eq(ideaChatMessagesTable.ideaId, idea.id))
      .orderBy(desc(ideaChatMessagesTable.createdAt), desc(ideaChatMessagesTable.id))
      .limit(20);
    history.reverse();

    const ideaContext = await buildIdeaContext(idea);
    const response = await openai.chat.completions.create({
      model: "gpt-5.6-luna",
      max_completion_tokens: 4096,
      messages: [
        {
          role: "system",
          content:
            `You are an expert thinking partner and editor helping the user develop one specific idea. Ground every answer in the supplied idea and attachment content. Help clarify, challenge, organize, summarize, expand, rewrite, or reshape it according to the user's request. Do not claim to have read content that is not included. Clearly flag uncertainty and avoid inventing facts. Reply in the same language as the user's latest message unless they request another language.\n\n${ideaContext}`,
        },
        ...history.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        { role: "user" as const, content: body.data.content.trim() },
      ],
    });
    const assistantContent = response.choices[0]?.message.content?.trim();
    if (!assistantContent) {
      res.status(502).json({ error: "The assistant did not return a response" });
      return;
    }

    const [userMessage, assistantMessage] = await db.transaction(async (tx) => {
      const [savedUserMessage] = await tx
        .insert(ideaChatMessagesTable)
        .values({
          ideaId: idea.id,
          role: "user",
          content: body.data.content.trim(),
        })
        .returning();
      const [savedAssistantMessage] = await tx
        .insert(ideaChatMessagesTable)
        .values({
          ideaId: idea.id,
          role: "assistant",
          content: assistantContent,
        })
        .returning();
      return [savedUserMessage, savedAssistantMessage];
    });

    res.status(201).json(
      SendIdeaChatMessageResponse.parse({
        userMessage: serializeChatMessage(userMessage),
        assistantMessage: serializeChatMessage(assistantMessage),
      }),
    );
  } catch (error) {
    console.error("Idea chat failed", error);
    res.status(502).json({ error: "The idea chat could not respond" });
  }
});

router.get("/subjects/:subjectId/compilations", async (req, res): Promise<void> => {
  const params = ListSubjectCompilationsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  let compilations = await db
    .select()
    .from(subjectCompilationsTable)
    .where(eq(subjectCompilationsTable.subjectId, params.data.subjectId))
    .orderBy(desc(subjectCompilationsTable.createdAt));

  if (compilations.length > 0) {
    await db
      .update(subjectsTable)
      .set({ draft: null })
      .where(
        and(
          eq(subjectsTable.id, params.data.subjectId),
          isNotNull(subjectsTable.draft),
        ),
      );
  } else {
    const imported = await db.transaction(async (transaction) => {
      const [legacySubject] = await transaction
        .select({
          id: subjectsTable.id,
          draft: subjectsTable.draft,
          updatedAt: subjectsTable.updatedAt,
        })
        .from(subjectsTable)
        .where(
          and(
            eq(subjectsTable.id, params.data.subjectId),
            isNotNull(subjectsTable.draft),
          ),
        )
        .for("update");

      if (!legacySubject?.draft?.trim()) return null;

      await transaction
        .update(subjectsTable)
        .set({ draft: null })
        .where(eq(subjectsTable.id, legacySubject.id));

      const [legacyCompilation] = await transaction
        .insert(subjectCompilationsTable)
        .values({
          subjectId: legacySubject.id,
          tone: "clear",
          content: legacySubject.draft,
          createdAt: legacySubject.updatedAt,
          updatedAt: legacySubject.updatedAt,
        })
        .returning();
      return legacyCompilation;
    });

    if (imported) compilations = [imported];
  }

  res.json(
    ListSubjectCompilationsResponse.parse(compilations.map(serializeCompilation)),
  );
});

router.patch(
  "/subjects/:subjectId/compilations/:compilationId",
  async (req, res): Promise<void> => {
    const params = UpdateSubjectCompilationParams.safeParse(req.params);
    const body = UpdateSubjectCompilationBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success
          ? params.error.message
          : !body.success
            ? body.error.message
            : "Invalid request",
      });
      return;
    }

    const safeContent = sanitizeStoredDraft(body.data.content);
    const images = extractStoredCompilationImages(safeContent);
    const compilation = await db.transaction(async (transaction) => {
      const [updated] = await transaction
        .update(subjectCompilationsTable)
        .set({
          content: safeContent,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(subjectCompilationsTable.id, params.data.compilationId),
            eq(subjectCompilationsTable.subjectId, params.data.subjectId),
          ),
        )
        .returning();

      if (!updated) return undefined;

      await transaction
        .delete(compilationImagesTable)
        .where(eq(compilationImagesTable.compilationId, updated.id));
      if (images.length > 0) {
        await transaction.insert(compilationImagesTable).values(
          images.map((image) => ({
            compilationId: updated.id,
            objectPath: image.objectPath,
            altText: image.altText,
          })),
        );
      }
      return updated;
    });

    if (!compilation) {
      res.status(404).json({ error: "Compiled draft not found" });
      return;
    }

    res.json(
      UpdateSubjectCompilationResponse.parse(serializeCompilation(compilation)),
    );
  },
);

router.delete(
  "/subjects/:subjectId/compilations/:compilationId",
  async (req, res): Promise<void> => {
    const params = DeleteSubjectCompilationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [deleted] = await db
      .delete(subjectCompilationsTable)
      .where(
        and(
          eq(subjectCompilationsTable.id, params.data.compilationId),
          eq(subjectCompilationsTable.subjectId, params.data.subjectId),
        ),
      )
      .returning({ id: subjectCompilationsTable.id });

    if (!deleted) {
      res.status(404).json({ error: "Compiled draft not found" });
      return;
    }

    res.status(204).end();
  },
);

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

  const outputInstructions: Record<string, string> = {
    clear: "Create a clear, direct, well-structured draft.",
    conversational: "Create a natural, engaging conversational draft.",
    academic: "Create a rigorous academic draft with formal reasoning and clear sections. Do not invent citations.",
    cinematic: "Create a vivid, cinematic, descriptive draft while preserving the source meaning.",
    newspaper_article: "Write a professional newspaper article with a strong headline, lead paragraph, logical body, and concise conclusion. Distinguish facts from interpretation and do not invent quotations or evidence.",
    advertisement: "Write a persuasive advertisement with a clear value proposition, audience-focused benefits, memorable message, and call to action. Do not make unsupported claims.",
    discussion_invitation: "Write an invitation for discussion that introduces the topic, explains why it matters, presents key questions, and ends with a clear invitation to participate.",
    official_letter: "Write a formal official letter with an appropriate subject line, salutation, concise purpose, supporting details, requested action, and professional closing. Use placeholders where recipient details are unavailable.",
    masters_proposal: "Create a structured master's degree research proposal with a working title, background, problem statement, research questions, objectives, proposed methodology, expected contribution, scope, and preliminary timeline. Do not invent sources or results.",
    phd_proposal: "Create a rigorous PhD research proposal with a working title, research context and gap, problem statement, research questions, objectives, conceptual direction, methodology, originality and expected contribution, scope, ethics considerations, and preliminary timeline. Do not invent sources or results.",
    summary_only: "Return only a faithful, concise summary of the supplied material. Preserve the central meaning and do not add recommendations or new facts.",
    objectives_goals: "Extract and organize only the main objective, supporting objectives, goals, intended outcomes, and success indicators that are supported by the supplied material. Clearly label anything that is implied rather than explicit.",
  };
  const requestedOutput = body.data.tone ?? "clear";

  const response = await openai.chat.completions.create({
    model: "gpt-5.6-luna",
    max_completion_tokens: 8192,
    messages: [
      {
        role: "system",
        content:
          `You are an expert editor. Transform the user's accumulated idea fragments into the requested output. Preserve the author's meaning, remove unnecessary repetition, create a logical progression, and do not invent unsupported facts. Match the primary language of the supplied material. Return only the finished output.\n\nRequired format: ${outputInstructions[requestedOutput] ?? outputInstructions.clear}`,
      },
      {
        role: "user",
        content: `Title: ${subject.title}\nIntroduction: ${subject.intro || "None"}\nRequested output type: ${requestedOutput}\n\nIdea fragments in chronological order:\n${ideas.map((idea, index) => `${index + 1}. ${idea.content}`).join("\n")}`,
      },
    ],
  });

  const draft = response.choices[0]?.message.content?.trim();
  if (!draft) {
    res.status(502).json({ error: "The draft could not be generated" });
    return;
  }

  const [compilation] = await db
    .insert(subjectCompilationsTable)
    .values({
      subjectId: subject.id,
      tone: requestedOutput,
      content: draft,
    })
    .returning();

  res.json(
    CompileSubjectResponse.parse(serializeCompilation(compilation)),
  );
});

export default router;