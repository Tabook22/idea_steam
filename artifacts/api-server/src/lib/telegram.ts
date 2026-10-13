/**
 * Capture from Telegram: the owner's own bot sends whatever they write, say or photograph into the
 * Idea inbox (or a notebook named with #). These are the rules, kept free of the network.
 */
import { randomBytes } from "node:crypto";

export const INBOX_TITLES = ["Idea inbox", "صندوق الأفكار"];

export type TelegramSettings = {
  token: string;
  botUsername: string;
  /** Part of the webhook address, and the header Telegram sends back: proves a call is from Telegram. */
  secret: string;
  /** The one chat allowed to save ideas, once paired. */
  chatId: number | null;
  chatName: string;
  /** What /start must carry to pair a chat (a fresh one after each unlink). */
  pairCode: string;
};

export const newSecret = () => randomBytes(24).toString("hex");
export const newPairCode = () => randomBytes(9).toString("base64url").replace(/[^A-Za-z0-9]/g, "x");

/** A bot token as BotFather gives it: "123456789:AA…". */
export const looksLikeToken = (value: unknown): value is string => typeof value === "string" && /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/.test(value.trim());

/** "/start CODE" → { command: "start", arg: "CODE" } ("/start@MyBot" works too). */
export function parseCommand(text: string | undefined) {
  const match = text?.trim().match(/^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  return match ? { command: match[1]!.toLowerCase(), arg: (match[2] ?? "").trim() } : null;
}

const fold = (value: string) => value.toLowerCase().normalize("NFKC").replace(/[ً-ْـ]/g, "").replace(/^ال/, "").replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * "#Physics read chapter 3" → the notebook called "Physics" and the text without the tag. A tag can
 * be the start of the name ("#welcome" for "Welcome week"); no match keeps the text as it is.
 */
export function hashtagTarget<T extends { id: number; title: string }>(subjects: T[], text: string) {
  const match = text.match(/^\s*#([\p{L}\p{N}_-]+)\s*/u);
  if (!match) return { subject: null as T | null, text };
  const tag = fold(match[1]!);
  const candidates = subjects.filter((subject) => !INBOX_TITLES.includes(subject.title));
  const subject = candidates.find((s) => fold(s.title) === tag) ?? candidates.find((s) => fold(s.title).startsWith(tag)) ?? null;
  return subject ? { subject, text: text.slice(match[0].length).trim() } : { subject: null, text };
}

/** A message that is only a web address. */
export const onlyLink = (text: string) => /^https?:\/\/\S+$/i.test(text.trim());

export const isArabicText = (text: string) => /[؀-ۿ]/.test(text);

/** What the bot says back (in the language you wrote in). */
export function reply(kind: "saved" | "help" | "private" | "paired" | "failed" | "empty", input: { notebook?: string; preview?: string; arabic?: boolean; name?: string; notebooks?: string[] } = {}) {
  const ar = !!input.arabic;
  switch (kind) {
    case "saved": return `✅ ${ar ? "حُفظت في" : "Saved to"} «${input.notebook}»${input.preview ? `\n\n${input.preview.slice(0, 600)}` : ""}`;
    case "paired": return ar
      ? `🎉 تم الربط${input.name ? ` يا ${input.name}` : ""}! كل ما ترسله هنا يُحفظ في صندوق الأفكار:\n• نص أو رابط\n• رسالة صوتية (تُكتب تلقائيًا)\n• صورة أو ملف PDF أو فيديو\n\nابدأ الرسالة بـ #اسم_الدفتر لحفظها في دفتر معيّن. /notebooks لعرض دفاترك.`
      : `🎉 Linked${input.name ? `, ${input.name}` : ""}! Everything you send here is saved in your Idea inbox:\n• text or a link\n• a voice note (written out for you)\n• a photo, PDF or video\n\nStart with #NotebookName to file it into a notebook. /notebooks lists them.`;
    case "help": return ar
      ? `أرسل نصًا أو رسالة صوتية أو صورة أو رابطًا أو ملفًا وسيُحفظ في صندوق الأفكار.\nابدأ بـ #اسم_الدفتر لحفظه في دفتر.${input.notebooks?.length ? `\n\nدفاترك:\n${input.notebooks.map((n) => `#${n.replace(/\s+/g, "_")}`).join("\n")}` : ""}`
      : `Send text, a voice note, a photo, a link or a file and it's saved in your Idea inbox.\nStart with #NotebookName to file it into a notebook.${input.notebooks?.length ? `\n\nYour notebooks:\n${input.notebooks.map((n) => `#${n.replace(/\s+/g, "_")}`).join("\n")}` : ""}`;
    case "private": return "🔒 This is a private Idea Stream bot. / هذا بوت خاص.";
    case "failed": return ar ? "⚠️ تعذر الحفظ. حاول مجددًا." : "⚠️ It couldn't be saved. Please try again.";
    case "empty": return ar ? "لم أجد شيئًا لأحفظه." : "There was nothing to save in that message.";
  }
}
