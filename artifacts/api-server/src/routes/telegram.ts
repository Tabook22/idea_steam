import { Router, type IRouter, type Request } from "express";
import { asc, eq, inArray } from "drizzle-orm";
import { appSettingsTable, db, ideasTable, subjectsTable } from "@workspace/db";
import { aiConfigured } from "@workspace/integrations-openai-ai-server";
import { storeBytes } from "../lib/audio-edit";
import { TranscriptionBusyError, transcribeStoredAudio } from "../lib/stored-transcription";
import { hashtagTarget, INBOX_TITLES, isArabicText, looksLikeToken, newPairCode, newSecret, onlyLink, parseCommand, reply, type TelegramSettings } from "../lib/telegram";
import { addRecordingsToLibrary } from "./audio-library";

/**
 * Capture from Telegram. /telegram (behind the sign-in) connects the owner's bot; Telegram calls
 * /telegram/webhook/<secret> with each message, and only the paired chat can save ideas.
 */
const router: IRouter = Router();
const API = () => (process.env.TELEGRAM_API || "https://api.telegram.org").replace(/\/$/, "");
const BASE = (process.env.APP_BASE_PATH || "").replace(/\/$/, "");
const MAX_FILE = 20 * 1024 * 1024;

async function settings(): Promise<TelegramSettings | null> {
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "telegram"));
  return (row?.value as TelegramSettings | undefined) ?? null;
}
async function save(value: TelegramSettings | null) {
  if (!value) { await db.delete(appSettingsTable).where(eq(appSettingsTable.key, "telegram")); return; }
  await db.insert(appSettingsTable).values({ key: "telegram", value }).onConflictDoUpdate({ target: appSettingsTable.key, set: { value, updatedAt: new Date() } });
}
async function telegram<T>(token: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API()}/bot${token}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => ({})) as { ok?: boolean; result?: T; description?: string };
  if (!data.ok) throw new Error(data.description || `Telegram ${method} failed`);
  return data.result as T;
}
const say = (token: string, chatId: number, text: string, replyTo?: number) =>
  telegram(token, "sendMessage", { chat_id: chatId, text, ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}) }).catch(() => {});

/** What the app shows (never the token). */
const status = (value: TelegramSettings | null) => value
  ? { connected: true, botUsername: value.botUsername, linked: value.chatId !== null, chatName: value.chatName, pairLink: value.chatId === null ? `https://t.me/${value.botUsername}?start=${value.pairCode}` : null }
  : { connected: false, botUsername: null, linked: false, chatName: "", pairLink: null };

router.get("/telegram", async (_req, res): Promise<void> => { res.json(status(await settings())); });

/** Connect a bot: check the token, point its webhook here, and get a pairing link. */
router.post("/telegram/connect", async (req: Request, res): Promise<void> => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (!looksLikeToken(token)) { res.status(400).json({ error: "That doesn't look like a bot token. Copy the whole line BotFather gave you." }); return; }
  try {
    const me = await telegram<{ username: string }>(token, "getMe");
    const secret = newSecret();
    // The address Telegram calls: this same site (as you're using it now), so redirects can't break it.
    const origin = `${req.protocol}://${req.get("host")}`;
    await telegram(token, "setWebhook", { url: `${origin}${BASE}/api/telegram/webhook/${secret}`, secret_token: secret, allowed_updates: ["message"], drop_pending_updates: true });
    const value: TelegramSettings = { token, botUsername: me.username, secret, chatId: null, chatName: "", pairCode: newPairCode() };
    await save(value);
    res.json(status(value));
  } catch (error) {
    res.status(400).json({ error: `Telegram didn't accept it: ${(error as Error).message}` });
  }
});

/** Pair another chat (the old one stops being able to save). */
router.post("/telegram/unlink", async (_req, res): Promise<void> => {
  const value = await settings();
  if (!value) { res.status(404).json({ error: "No bot connected." }); return; }
  const next = { ...value, chatId: null, chatName: "", pairCode: newPairCode() };
  await save(next);
  res.json(status(next));
});

router.delete("/telegram", async (_req, res): Promise<void> => {
  const value = await settings();
  if (value) await telegram(value.token, "deleteWebhook", { drop_pending_updates: true }).catch(() => {});
  await save(null);
  res.json(status(null));
});

type TgFile = { file_id: string; file_size?: number; mime_type?: string; file_name?: string; duration?: number };
type TgMessage = {
  message_id: number; chat: { id: number; type: string }; from?: { first_name?: string };
  text?: string; caption?: string; voice?: TgFile; audio?: TgFile; video?: TgFile; video_note?: TgFile; document?: TgFile; photo?: TgFile[];
};

async function download(token: string, file: TgFile) {
  if ((file.file_size ?? 0) > MAX_FILE) throw new Error("too big");
  const info = await telegram<{ file_path: string }>(token, "getFile", { file_id: file.file_id });
  const response = await fetch(`${API()}/file/bot${token}/${info.file_path}`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error("download failed");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_FILE) throw new Error("too big");
  return bytes;
}
async function transcribe(url: string) {
  if (!aiConfigured) return "";
  for (let attempt = 0; attempt < 30; attempt++) {
    try { return await transcribeStoredAudio(url, "auto"); }
    catch (error) {
      if (!(error instanceof TranscriptionBusyError)) return "";
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  return "";
}
async function inboxId(arabic: boolean) {
  const [found] = await db.select({ id: subjectsTable.id }).from(subjectsTable).where(inArray(subjectsTable.title, INBOX_TITLES));
  if (found) return found.id;
  const [created] = await db.insert(subjectsTable).values({ title: arabic ? "صندوق الأفكار" : "Idea inbox", intro: arabic ? "سجّل الآن ونظّم لاحقًا." : "Capture now. Organize later." }).returning({ id: subjectsTable.id });
  return created!.id;
}

/** One message from the paired chat, saved as an idea. */
async function capture(value: TelegramSettings, message: TgMessage) {
  const words = (message.text ?? message.caption ?? "").trim();
  const subjects = await db.select({ id: subjectsTable.id, title: subjectsTable.title }).from(subjectsTable).orderBy(asc(subjectsTable.id));
  const target = hashtagTarget(subjects, words);
  let arabic = isArabicText(words);
  const captureId = `tg-${message.chat.id}-${message.message_id}`;
  const [already] = await db.select({ id: ideasTable.id }).from(ideasTable).where(eq(ideasTable.clientCaptureId, captureId));
  if (already) return;

  type Attachment = (typeof ideasTable.$inferInsert)["attachments"] extends (infer A)[] | undefined ? A : never;
  let source: (typeof ideasTable.$inferInsert)["source"] = "text";
  let content = target.text;
  const attachments: Attachment[] = [];
  const sound = message.voice ?? message.audio ?? message.video_note;
  if (sound) {
    const mime = message.video_note ? "video/mp4" : sound.mime_type || "audio/ogg";
    const url = await storeBytes(await download(value.token, sound), mime);
    const transcript = await transcribe(url);
    arabic = arabic || isArabicText(transcript);
    source = "voice";
    content = [target.text, transcript].filter(Boolean).join("\n\n") || (arabic ? "🎤 رسالة صوتية" : "🎤 Voice note");
    attachments.push({ type: "audio", url, name: sound.file_name || (arabic ? "رسالة صوتية من تيليجرام" : "Telegram voice note"), mimeType: mime, ...(sound.duration ? { durationSeconds: sound.duration } : {}), ...(transcript ? { transcript } : {}) } as Attachment);
  } else if (message.photo?.length) {
    const photo = message.photo[message.photo.length - 1]!;
    const url = await storeBytes(await download(value.token, photo), "image/jpeg");
    source = "image";
    content = target.text || (arabic ? "📷 صورة" : "📷 Photo");
    attachments.push({ type: "image", url, name: "Telegram photo.jpg", mimeType: "image/jpeg" } as Attachment);
  } else if (message.video) {
    const mime = message.video.mime_type || "video/mp4";
    const url = await storeBytes(await download(value.token, message.video), mime);
    source = "video";
    content = target.text || (arabic ? "🎬 فيديو" : "🎬 Video");
    attachments.push({ type: "video", url, name: message.video.file_name || "Telegram video.mp4", mimeType: mime } as Attachment);
  } else if (message.document) {
    const mime = message.document.mime_type || "application/octet-stream";
    const url = await storeBytes(await download(value.token, message.document), mime);
    const kind = mime === "application/pdf" ? "pdf" : mime.startsWith("image/") ? "image" : "document";
    source = kind;
    content = target.text || message.document.file_name || "📎";
    attachments.push({ type: kind, url, name: message.document.file_name || "file", mimeType: mime } as Attachment);
  } else if (target.text && onlyLink(target.text)) {
    source = "link";
    attachments.push({ type: "link", url: target.text, name: target.text } as Attachment);
  }
  if (!content.trim() && !attachments.length) { await say(value.token, message.chat.id, reply("empty", { arabic }), message.message_id); return; }

  const subjectId = target.subject?.id ?? await inboxId(arabic);
  const notebook = target.subject?.title ?? (subjects.find((s) => s.id === subjectId)?.title ?? (arabic ? "صندوق الأفكار" : "Idea inbox"));
  const [idea] = await db.insert(ideasTable).values({ subjectId, content: content.trim(), source, attachments, clientCaptureId: captureId })
    .onConflictDoNothing({ target: ideasTable.clientCaptureId }).returning();
  if (!idea) return;
  await db.update(subjectsTable).set({ updatedAt: new Date() }).where(eq(subjectsTable.id, subjectId));
  // Voice notes also go to the audio library, like recordings made in the app.
  if (source === "voice") await addRecordingsToLibrary(db, idea, notebook).catch(() => {});
  await say(value.token, message.chat.id, reply("saved", { notebook, arabic, preview: source === "voice" ? content : undefined }), message.message_id);
}

async function handle(value: TelegramSettings, message: TgMessage) {
  const command = parseCommand(message.text);
  const arabic = isArabicText(message.text ?? message.caption ?? "") || (message.from?.first_name ? isArabicText(message.from.first_name) : false);
  if (value.chatId === null) {
    // Pairing: the first private chat that brings the right code becomes the owner's.
    if (command?.command === "start" && command.arg === value.pairCode && message.chat.type === "private") {
      await save({ ...value, chatId: message.chat.id, chatName: message.from?.first_name ?? "" });
      await say(value.token, message.chat.id, reply("paired", { name: message.from?.first_name, arabic }));
    } else await say(value.token, message.chat.id, reply("private"));
    return;
  }
  if (message.chat.id !== value.chatId) { await say(value.token, message.chat.id, reply("private")); return; }
  if (command && ["start", "help", "notebooks"].includes(command.command)) {
    const subjects = await db.select({ title: subjectsTable.title }).from(subjectsTable).orderBy(asc(subjectsTable.title));
    await say(value.token, message.chat.id, reply("help", { arabic, notebooks: command.command === "help" ? [] : subjects.map((s) => s.title).filter((t) => !INBOX_TITLES.includes(t)) }));
    return;
  }
  try { await capture(value, message); }
  catch (error) {
    console.warn("Telegram capture failed:", (error as Error).message);
    await say(value.token, message.chat.id, (error as Error).message === "too big" ? (arabic ? "⚠️ الملف أكبر من 20 ميغابايت." : "⚠️ That file is over 20 MB.") : reply("failed", { arabic }), message.message_id);
  }
}

/** Telegram calls this with each message. Answered at once; the saving happens just after. */
router.post("/telegram/webhook/:secret", async (req, res): Promise<void> => {
  const value = await settings();
  if (!value || req.params.secret !== value.secret || req.headers["x-telegram-bot-api-secret-token"] !== value.secret) { res.sendStatus(404); return; }
  res.json({ ok: true });
  const message = req.body?.message as TgMessage | undefined;
  if (message?.chat?.id) void handle(value, message);
});

export default router;
