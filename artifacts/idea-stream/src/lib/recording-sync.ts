import { appPath, uploadCredentials } from "./app-path.ts";
import type { Idea, Subject } from "@workspace/api-client-react";
import { RecordingStore } from "./recording-store.ts";
import {
  recordingTitle,
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
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetcher(url, {
      credentials: "include",
      ...options,
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(
        `Sync failed (${response.status}). Your recording is still on this device.`,
      );
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
async function base64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
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
    if (!record.transcriptionStatus) {
      if (audio.size > 12 * 1024 * 1024) {
        record.transcriptionStatus = "too-large";
      } else {
        try {
          const result = await json<{ text: string }>(
            fetcher,
            "/api/transcriptions",
            {
              audioBase64: await base64(audio),
              mimeType: record.mimeType,
              language: record.language,
            },
          );
          if (!result.text?.trim()) throw new Error("Empty transcript");
          record.transcript = result.text.trim();
          record.title = recordingTitle(result.text, record.title);
          record.transcriptionStatus = "done";
        } catch {
          record.transcriptionStatus = "unavailable";
        }
      }
      await store.patch(id, {
        transcript: record.transcript,
        title: record.title,
        transcriptionStatus: record.transcriptionStatus,
      });
      changed?.();
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
      attachments: [{ type: "audio", ...record.uploadedAudio }],
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
