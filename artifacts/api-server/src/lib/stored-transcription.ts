import {
  detectAudioFormat,
  ensureCompatibleFormat,
  speechToText,
  speechToWords,
} from "@workspace/integrations-openai-ai-server/audio";
import { ObjectNotFoundError, ObjectStorageService } from "./storage-service";

const objectStorageService = new ObjectStorageService();
const appBasePath = (process.env.APP_BASE_PATH || "").replace(/\/$/, "");

/** Storage URLs may carry the deployment's base path (e.g. /ideas); compare without it. */
export const canonicalStorageUrl = (url: string) =>
  appBasePath && url.startsWith(`${appBasePath}/api/storage/`) ? url.slice(appBasePath.length) : url;

export const isStoredAudioUrl = (url: string) => canonicalStorageUrl(url).startsWith("/api/storage/objects/");
const LIMIT = 24 * 1024 * 1024;
const jobs = new Map<string, Promise<string>>();

/** Downloads stored audio (24 MB limit) in a format the transcription service accepts. */
async function loadStoredAudio(storageUrl: string) {
  const file = await objectStorageService.getObjectEntityFile(storageUrl.slice("/api/storage".length));
  const response = await objectStorageService.downloadObject(file, 0);
  if (Number(response.headers.get("content-length")) > LIMIT) {
    await response.body?.cancel();
    throw new Error("audio-too-large");
  }
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length > LIMIT) throw new Error("audio-too-large");
  const detected = detectAudioFormat(audio);
  if (detected === "unknown") throw new Error("unsupported-audio");
  return detected === "ogg" ? await ensureCompatibleFormat(audio) : { buffer: audio, format: detected };
}

const wordJobs = new Map<string, ReturnType<typeof speechToWords>>();

/** Every word with its start and end time, for editing audio by editing text. */
export async function wordsForStoredAudio(storageUrl: string, language: "auto" | "en" | "ar") {
  let job = wordJobs.get(storageUrl);
  if (!job) {
    if (wordJobs.size + jobs.size >= 3) throw new TranscriptionBusyError();
    job = loadStoredAudio(storageUrl).then((prepared) =>
      speechToWords(prepared.buffer, prepared.format, language === "auto" ? undefined : language));
    wordJobs.set(storageUrl, job);
  }
  try {
    return await job;
  } finally {
    wordJobs.delete(storageUrl);
  }
}

export class TranscriptionBusyError extends Error {
  constructor() { super("transcription-busy"); }
}

/**
 * Transcribes audio already saved in this app's storage (no second upload). Concurrent
 * requests for the same recording share one job; at most two different jobs run at once.
 */
export async function transcribeStoredAudio(storageUrl: string, language: "auto" | "en" | "ar") {
  let job = jobs.get(storageUrl);
  if (!job) {
    if (jobs.size >= 2) throw new TranscriptionBusyError();
    job = (async () => {
      const prepared = await loadStoredAudio(storageUrl);
      return (await speechToText(prepared.buffer, prepared.format, language === "auto" ? undefined : language)).trim();
    })();
    jobs.set(storageUrl, job);
  }
  try {
    return await job;
  } finally {
    jobs.delete(storageUrl);
  }
}

/** Status and message for a failed transcription. Permanent failures get a 4xx so clients stop retrying. */
export function transcriptionFailure(error: unknown): [number, string] {
  if (error instanceof TranscriptionBusyError) return [429, "Transcription is busy. Please retry shortly."];
  const message = error instanceof Error ? error.message : "";
  const status = (error as { status?: number })?.status;
  const reason = error instanceof ObjectNotFoundError ? "missing-audio"
    : ["audio-too-large", "unsupported-audio"].includes(message) ? message
    : status === 400 ? "provider-rejected-audio" : "provider-or-storage";
  // Never log audio, provider request bodies, or credentials.
  console.warn("Saved recording transcription failed", { status, reason });
  return reason === "missing-audio" ? [404, "The saved audio file could not be found on the server."]
    : reason === "audio-too-large" ? [413, "This recording exceeds the 24 MB transcription limit. Download and split it into shorter recordings."]
    : reason === "unsupported-audio" ? [415, "This audio format can't be transcribed. Use MP3, WAV, M4A, WebM, or OGG."]
    : reason === "provider-rejected-audio" ? [422, "The transcription service couldn't read this audio. Your recording is still saved."]
    : status === 401 || status === 403 ? [503, "The server's OpenAI key cannot access transcription. Check its permissions."]
    : status === 429 ? [429, "OpenAI quota or rate limit reached. Check API billing or retry later."]
    : [502, "Transcription could not finish. Your recording is saved; please retry."];
}
