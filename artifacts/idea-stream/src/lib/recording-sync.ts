import { appPath, uploadCredentials } from "./app-path.ts";
import type { Idea, Subject } from "@workspace/api-client-react";
import { RecordingStore } from "./recording-store.ts";
import {
  retryDelay,
  spokenSubject,
} from "./recording-utils.ts";

type SyncOptions = {
  fetcher?: typeof fetch;
  basePath?: string;
  changed?: () => void;
};
async function request(
  fetcher: typeof fetch,
  url: string,
  options: RequestInit = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150_000);
  try {
    const response = await fetcher(url, {
      credentials: "include",
      ...options,
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw Object.assign(
        new Error(detail?.error || `Request failed (${response.status}). Your original recording is safe.`),
        { status: response.status },
      );
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}
async function json<T>(
  fetcher: typeof fetch,
  url: string,
  body?: unknown,
): Promise<T> {
  return (
    await request(
      fetcher,
      url,
      body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
    )
  ).json();
}
/** Called under the origin-wide sync lock. Every remote stage has a durable checkpoint. */
export async function syncRecording(
  store: RecordingStore,
  id: string,
  { fetcher = fetch, changed, basePath = "/" }: SyncOptions = {},
): Promise<Idea | null> {
  const nativeFetch = fetcher;
  fetcher = (input, options) =>
    nativeFetch(
      typeof input === "string" ? appPath(input, basePath) : input,
      options,
    );
  let record = await store.get(id);
  if (!record || record.status !== "saved" || !record.bytes) return null;
  try {
    const audio = await store.audio(id);
    if (!record.uploadedAudio) {
      const mimeType = record.mimeType || audio.type || "audio/webm";
      const name = `idea-${record.id}.${mimeType.includes("mp4") ? "m4a" : "webm"}`;
      const upload = await json<{ uploadURL: string; objectPath: string }>(
        fetcher,
        "/api/storage/uploads/request-url",
        { name, size: audio.size, contentType: mimeType },
      );
      await request(fetcher, upload.uploadURL, {
        method: "PUT",
        credentials: uploadCredentials(upload.uploadURL, typeof location === "undefined" ? undefined : location.origin),
        headers: { "Content-Type": mimeType },
        body: audio,
      });
      record.uploadedAudio = {
        url: appPath(`/api/storage${upload.objectPath}`, basePath),
        name,
        mimeType,
      };
      await store.patch(id, { uploadedAudio: record.uploadedAudio });
    }
    const subjects = await json<Subject[]>(fetcher, "/api/subjects");
    let subjectId = record.subjectId;
    if (subjectId === null && record.transcript)
      subjectId = spokenSubject(record.transcript, subjects);
    if (subjectId === null) {
      const inbox =
        subjects.find((subject) =>
          ["Idea inbox", "صندوق الأفكار"].includes(subject.title),
        ) ??
        (await json<Subject>(fetcher, "/api/subjects", {
          title: record.language === "ar" ? "صندوق الأفكار" : "Idea inbox",
          intro:
            record.language === "ar"
              ? "سجّل الآن ونظّم لاحقًا."
              : "Capture now. Organize later.",
        }));
      subjectId = inbox.id;
    }
    if (
      record.subjectId !== null &&
      !subjects.some((subject) => subject.id === record!.subjectId)
    )
      throw new Error(
        "The selected notebook no longer exists. Choose another notebook; your audio remains saved on this device.",
      );
    const idea = await json<Idea>(fetcher, `/api/subjects/${subjectId}/ideas`, {
      clientCaptureId: record.id,
      capturedAt: record.capturedAt,
      content: record.transcript || record.title,
      source: "voice",
      attachments: [{ type: "audio", ...record.uploadedAudio, ...(record.durationSeconds ? { durationSeconds: record.durationSeconds } : {}) }],
    });
    await store.patch(id, {
      status: "synced",
      ideaId: idea.id,
      subjectId: idea.subjectId,
      error: undefined,
      nextRetryAt: 0,
      attempts: 0,
    });
    changed?.();
    return idea;
  } catch (error) {
    const attempts = record.attempts + 1;
    await store.patch(id, {
      error:
        error instanceof Error
          ? error.message
          : "Sync unavailable. Recording kept on this device.",
      attempts,
      nextRetryAt: Date.now() + retryDelay(attempts),
    });
    changed?.();
    return null;
  }
}

/** Automatic transcription stops after this many failures; a manual retry resets the count. */
export const maxTranscriptionAttempts = 3;

/** Transcription is a separate, retryable stage after the remote audio is safe. */
export async function transcribeRecording(
  store: RecordingStore, id: string,
  { fetcher = fetch, changed, basePath = "/" }: SyncOptions = {},
) {
  const record = await store.get(id);
  if (!record?.ideaId || record.status !== "synced" || record.transcriptionStatus === "done") return null;
  try {
    const response = await request(fetcher, appPath(`/api/ideas/${record.ideaId}/transcription`, basePath), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: record.transcriptionLanguage || "auto", expectedContent: record.title }),
    });
    const result = await response.json() as { text: string; idea: Idea };
    if (!result.text?.trim()) throw new Error("No speech detected");
    await store.patch(id, { transcript: result.text, transcriptionStatus: "done", transcriptionError: undefined,
      transcriptionAttempts: 0, nextTranscriptionAt: 0, subjectId: result.idea.subjectId });
    changed?.();
    return result.idea;
  } catch (error) {
    // Silent, missing, oversized, or unreadable audio fails the same way every time; only a manual retry resends it.
    const status = (error as { status?: number }).status;
    const permanent = status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
    const attempts = permanent ? maxTranscriptionAttempts : (record.transcriptionAttempts || 0) + 1;
    await store.patch(id, { transcriptionStatus: "unavailable", transcriptionAttempts: attempts,
      nextTranscriptionAt: Date.now() + Math.max(30_000, retryDelay(attempts)),
      transcriptionError: error instanceof Error ? error.message : "Transcription unavailable" });
    changed?.();
    return null;
  }
}
