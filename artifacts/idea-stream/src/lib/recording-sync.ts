import { appPath, uploadCredentials } from "./app-path.ts";
import { deleteMeetingFile, getMeetingFile } from "./meeting-files.ts";
import type { AudioLibraryItem, Idea } from "@workspace/api-client-react";
import { RecordingStore } from "./recording-store.ts";
import { retryDelay } from "./recording-utils.ts";

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
): Promise<Idea | AudioLibraryItem | null> {
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
    // Meeting notepad: photos, documents and drawings kept on the phone are uploaded first.
    if (record.meeting && record.meetingNotes?.some((note) => note.pending)) {
      const notes = [...record.meetingNotes];
      for (const [index, note] of notes.entries()) {
        if (!note.pending) continue;
        const file = await getMeetingFile(note.id);
        if (!file) { notes[index] = { ...note, pending: false }; continue; }
        const type = note.mimeType || file.type || "application/octet-stream";
        const upload = await json<{ uploadURL: string; objectPath: string }>(fetcher, "/api/storage/uploads/request-url", { name: note.name || "file", size: file.size, contentType: type });
        await request(fetcher, upload.uploadURL, {
          method: "PUT",
          credentials: uploadCredentials(upload.uploadURL, typeof location === "undefined" ? undefined : location.origin),
          headers: { "Content-Type": type },
          body: file,
        });
        notes[index] = { ...note, pending: false, url: `/api/storage${upload.objectPath}` };
        await store.patch(id, { meetingNotes: notes });
      }
      record.meetingNotes = notes;
      for (const note of notes) if (note.kind !== "text") void deleteMeetingFile(note.id).catch(() => {});
    }
    // The handwriting notebook: its pictures, video, sound and page pictures go up first.
    if (record.meeting && record.meetingNotebook) {
      const doc = structuredClone(record.meetingNotebook);
      const send = async (key: string, name: string, fallbackType: string) => {
        const file = await getMeetingFile(key);
        if (!file) return null;
        const type = file.type || fallbackType;
        const upload = await json<{ uploadURL: string; objectPath: string }>(fetcher, "/api/storage/uploads/request-url", { name, size: file.size, contentType: type });
        await request(fetcher, upload.uploadURL, {
          method: "PUT",
          credentials: uploadCredentials(upload.uploadURL, typeof location === "undefined" ? undefined : location.origin),
          headers: { "Content-Type": type },
          body: file,
        });
        return `/api/storage${upload.objectPath}`;
      };
      let changed = false;
      for (const page of doc.pages) {
        for (const item of page.items) {
          if (!item.pending) continue;
          const url = await send(item.id, item.name || "file", item.mimeType || "application/octet-stream");
          if (url) item.url = url;
          delete item.pending;
          changed = true;
        }
        if (page.snapshot?.pending) {
          const url = await send(`snap-${page.id}`, "page.png", "image/png");
          page.snapshot = url ? { url, rev: page.snapshot.rev } : undefined;
          changed = true;
        }
      }
      if (changed) await store.patch(id, { meetingNotebook: doc });
      record.meetingNotebook = doc;
    }
    // Every recording is saved to the audio library first; that copy is the master.
    let item = record.libraryItemId ? null : await json<AudioLibraryItem>(fetcher, "/api/audio-library/recordings", {
      url: record.uploadedAudio.url,
      clientCaptureId: record.id,
      mimeType: record.uploadedAudio.mimeType,
      capturedAt: record.capturedAt,
      ...(record.durationSeconds ? { durationSeconds: record.durationSeconds } : {}),
      ...(record.marks?.length ? { marks: record.marks } : {}),
      // A meeting: the server makes its text (with speakers) and minutes.
      ...(record.meeting ? { meeting: {
        ...record.meeting,
        markers: (record.marks ?? []).map((at, index) => ({ at, kind: record.markKinds?.[index] ?? "important" })),
        notes: (record.meetingNotes ?? []).filter((note) => !note.pending).map(({ pending: _pending, ...note }) => note),
        ...(record.meetingNotebook ? { notebook: record.meetingNotebook } : {}),
      } } : {}),
    });
    const libraryItemId = record.libraryItemId ?? item!.id;
    await store.patch(id, { libraryItemId });
    // Then, if a subject was chosen while recording, it goes there too.
    let ideaId = record.ideaId;
    let subjectId = record.subjectId;
    if (subjectId !== null && !ideaId) {
      try {
        item = await json<AudioLibraryItem>(fetcher, `/api/audio-library/${libraryItemId}/subjects`, { subjectId });
        ideaId = item.subjects.find((link) => link.subjectId === subjectId)?.ideaId;
      } catch (error) {
        // Deleted meanwhile: the recording stays safely in the library. Otherwise try again later.
        if ((error as { status?: number }).status !== 404) throw error;
        subjectId = null;
      }
    }
    await store.patch(id, {
      status: "synced",
      libraryItemId,
      ...(ideaId ? { ideaId } : {}),
      subjectId,
      ...(subjectId === null ? { destination: "library" as const } : {}),
      error: undefined,
      nextRetryAt: 0,
      attempts: 0,
    });
    changed?.();
    return item;
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
  if (!record || record.status !== "synced" || record.transcriptionStatus === "done") return null;
  if (!record.libraryItemId && !record.ideaId) return null;
  try {
    if (record.libraryItemId) {
      const response = await request(fetcher, appPath(`/api/audio-library/${record.libraryItemId}/transcription`, basePath), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: record.transcriptionLanguage || "auto" }),
      });
      const item = await response.json() as AudioLibraryItem;
      if (!item.transcript?.trim()) throw new Error("No speech detected");
      await store.patch(id, { transcript: item.transcript, transcriptionStatus: "done", transcriptionError: undefined,
        transcriptionAttempts: 0, nextTranscriptionAt: 0 });
      changed?.();
      return item;
    }
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
