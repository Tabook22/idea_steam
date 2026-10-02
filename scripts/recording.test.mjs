import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { RecordingStore } from "../artifacts/idea-stream/src/lib/recording-store.ts";
import { maxTranscriptionAttempts, syncRecording, transcribeRecording } from "../artifacts/idea-stream/src/lib/recording-sync.ts";
import {
  spokenSubject,
  retryDelay,
} from "../artifacts/idea-stream/src/lib/recording-utils.ts";

async function recording(subjectId = null) {
  const name = `test-${crypto.randomUUID()}`;
  const store = new RecordingStore(name);
  const id = crypto.randomUUID();
  await store.create({
    id,
    title: "Voice idea",
    capturedAt: "2026-09-20T12:00:00.000Z",
    updatedAt: Date.now(),
    durationSeconds: 0,
    bytes: 0,
    chunks: 0,
    mimeType: "audio/webm",
    language: "en",
    subjectId,
    status: "recording",
    attempts: 0,
    nextRetryAt: 0,
  });
  return { store, id, name };
}
const response = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("chunks remain ordered across reconnect, recover unfinished recordings, remove empty sessions", async () => {
  const { store, id, name } = await recording();
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      store.append(id, new Blob([`${i},`]), i + 1),
    ),
  );
  const reopened = new RecordingStore(name);
  assert.equal(
    await (await reopened.audio(id)).text(),
    "0,1,2,3,4,5,6,7,8,9,10,11,",
  );
  await reopened.create({
    ...(await store.get(id)),
    id: "empty",
    chunks: 0,
    bytes: 0,
  });
  await reopened.recoverInterrupted();
  assert.equal((await reopened.get(id)).status, "saved");
  assert.equal((await reopened.get(id)).interrupted, true);
  assert.equal(await reopened.get("empty"), undefined);
  await assert.rejects(reopened.append(id, new Blob(["late"]), 20));
  assert.equal((await reopened.get(id)).chunks, 12);
  await reopened.remove(id);
  assert.equal((await reopened.audio(id)).size, 0);
});

test("rescue replacement preserves metadata and atomically replaces partial chunks", async () => {
  const { store, id } = await recording(2);
  await store.append(id, new Blob(["partial"]), 3);
  await store.replaceAudio(
    id,
    new Blob(["complete rescue"], { type: "audio/mp4" }),
  );
  assert.equal(await (await store.audio(id)).text(), "complete rescue");
  assert.equal((await store.get(id)).subjectId, 2);
  assert.equal((await store.get(id)).chunks, 1);
  assert.equal((await store.get(id)).status, "saved");
  await assert.rejects(store.replaceAudio("missing", new Blob(["lost"])));
});

test("spoken routing requires an unambiguous leading command", () => {
  const subjects = [
    { id: 1, title: "Education" },
    { id: 2, title: "التعليم" },
  ];
  assert.equal(
    spokenSubject("Save this under Education. My idea is…", subjects),
    1,
  );
  assert.equal(spokenSubject("احفظ في التعليم. فكرتي هي…", subjects), 2);
  assert.equal(
    spokenSubject("We could save this under Education. Maybe.", subjects),
    null,
  );
  assert.equal(
    spokenSubject("Save this under Education someday", subjects),
    null,
  );
  assert.equal(
    spokenSubject("Save under Education. Idea", [
      ...subjects,
      { id: 3, title: "education" },
    ]),
    null,
  );
  assert.equal(retryDelay(1), 5000);
  assert.equal(retryDelay(100), 300000);
});

test("lost create response retries the same capture ID, keeps checkpoints and original audio", async () => {
  const { store, id } = await recording(2);
  await store.append(id, new Blob(["original audio"]), 3);
  await store.patch(id, { status: "saved" });
  const calls = [];
  const remote = new Map();
  let loseResponse = true;
  const fetcher = async (url, options = {}) => {
    calls.push(url);
    if (url === "/api/storage/uploads/request-url")
      return response({
        uploadURL: "/signed-upload",
        objectPath: "/objects/test",
      });
    if (url === "/signed-upload") return response({});
    if (url === "/api/transcriptions")
      return response({
        text: "Save this under Education. My original thought.",
      });
    if (url === "/api/subjects")
      return response([{ id: 2, title: "Education" }]);
    assert.equal(url, "/api/subjects/2/ideas");
    const body = JSON.parse(options.body);
    assert.equal(body.clientCaptureId, id);
    assert.equal(body.capturedAt, "2026-09-20T12:00:00.000Z");
    assert.equal(body.attachments[0].transcript, undefined);
    if (!remote.has(id)) remote.set(id, { ...body, id: 55, subjectId: 2 });
    if (loseResponse) {
      loseResponse = false;
      throw new Error("Connection lost after commit");
    }
    return response(remote.get(id));
  };
  assert.equal(await syncRecording(store, id, { fetcher }), null);
  assert.equal((await store.get(id)).status, "saved");
  assert.ok((await store.get(id)).nextRetryAt > Date.now());
  assert.equal((await syncRecording(store, id, { fetcher })).id, 55);
  assert.equal(remote.size, 1);
  assert.equal(calls.filter((url) => url === "/signed-upload").length, 1);
  assert.equal(calls.filter((url) => url === "/api/transcriptions").length, 0);
  assert.equal((await store.get(id)).status, "synced");
  assert.equal(await (await store.audio(id)).text(), "original audio");
});

test("transcription outage still saves audio to the explicitly selected notebook", async () => {
  const { store, id } = await recording(7);
  await store.append(id, new Blob(["audio"]), 1);
  await store.patch(id, {
    status: "saved",
    uploadedAudio: {
      url: "/api/storage/objects/test",
      name: "audio.webm",
      mimeType: "audio/webm",
    },
  });
  const fetcher = async (url, options) => {
    if (url === "/api/ideas/8/transcription")
      return response({ error: "offline" }, 503);
    if (url === "/api/subjects")
      return response([{ id: 7, title: "Research" }]);
    assert.equal(url, "/api/subjects/7/ideas");
    const body = JSON.parse(options.body);
    assert.equal(body.content, "Voice idea");
    assert.equal(body.attachments[0].url, "/api/storage/objects/test");
    return response({ ...body, id: 8, subjectId: 7 });
  };
  assert.ok(await syncRecording(store, id, { fetcher }));
  assert.equal((await store.get(id)).status, "synced");
  await transcribeRecording(store, id, { fetcher });
  assert.equal((await store.get(id)).transcriptionStatus, "unavailable");
});

test("deleted destination and disconnected server preserve local audio for later filing", async () => {
  const { store, id } = await recording(99);
  await store.append(id, new Blob(["audio"]), 1);
  await store.patch(id, {
    status: "saved",
    transcriptionStatus: "done",
    transcript: "Idea",
    uploadedAudio: {
      url: "/audio",
      name: "audio.webm",
      mimeType: "audio/webm",
    },
  });
  assert.equal(
    await syncRecording(store, id, { fetcher: async () => response([]) }),
    null,
  );
  assert.match((await store.get(id)).error, /no longer exists/);
  assert.equal(
    await syncRecording(store, id, {
      fetcher: async () => {
        throw new Error("offline");
      },
    }),
    null,
  );
  assert.equal((await store.get(id)).status, "saved");
  assert.equal(await (await store.audio(id)).text(), "audio");
});


test("failed transcription retries saved audio, auto-detects language, and never duplicates an idea", async () => {
  const { store, id } = await recording(7);
  await store.append(id, new Blob(["original"]), 4);
  await store.patch(id, { status: "synced", ideaId: 42, transcriptionStatus: "unavailable" });
  let calls = 0;
  const fetcher = async (url, options) => {
    assert.equal(url, "/ideas/api/ideas/42/transcription");
    const body = JSON.parse(options.body);
    assert.equal(body.language, "auto");
    assert.equal(body.expectedContent, "Voice idea");
    calls++;
    if (calls === 1) return response({ error: "Quota reached" }, 429);
    return response({ text: "فكرة عن التعليم", idea: { id: 42, subjectId: 7 } });
  };
  await transcribeRecording(store, id, { fetcher, basePath: "/ideas/" });
  assert.equal((await store.get(id)).transcriptionError, "Quota reached");
  assert.equal((await store.get(id)).status, "synced");
  assert.ok((await store.get(id)).nextTranscriptionAt > Date.now());
  await transcribeRecording(store, id, { fetcher, basePath: "/ideas/" });
  assert.equal((await store.get(id)).transcript, "فكرة عن التعليم");
  assert.equal((await store.get(id)).transcriptionStatus, "done");
  await transcribeRecording(store, id, { fetcher });
  assert.equal(calls, 2);
  assert.equal(await (await store.audio(id)).text(), "original");
});

test("explicit spoken-language hint is separate from the interface language", async () => {
  const { store, id } = await recording(7);
  await store.append(id, new Blob(["audio"]), 1);
  await store.patch(id, { status: "synced", ideaId: 8, language: "en", transcriptionLanguage: "ar" });
  await transcribeRecording(store, id, { fetcher: async (_url, options) => {
    assert.equal(JSON.parse(options.body).language, "ar");
    return response({ text: "هذه فكرة", idea: { id: 8, subjectId: 7 } });
  }});
  assert.equal((await store.get(id)).transcript, "هذه فكرة");
});

import { mergeRecordingTranscript } from "../artifacts/api-server/src/lib/recording-transcript.ts";
test("server transcript merge preserves concurrent edits, attachment metadata and existing transcripts", () => {
  const attachments = [{ type: "audio", url: "/audio", name: "Original", note: "Keep me" }, { type: "link", url: "/other" }];
  const first = mergeRecordingTranscript("Voice idea", attachments, "/audio", "The words", "Voice idea");
  assert.equal(first.content, "The words");
  assert.equal(first.attachments[0].note, "Keep me");
  assert.equal(first.attachments[0].transcript, "The words");
  const edited = mergeRecordingTranscript("My edited note", first.attachments, "/audio", "Other words", "Voice idea");
  assert.equal(edited.content, "My edited note");
  assert.equal(edited.attachments[0].transcript, "The words");
  assert.deepEqual(edited.attachments[1], attachments[1]);
});

test("permanent transcription failures stop automatic retries; temporary ones keep retrying", async () => {
  for (const [status, permanent] of [[422, true], [415, true], [429, false], [502, false]]) {
    const { store, id } = await recording(7);
    await store.append(id, new Blob(["audio"]), 1);
    await store.patch(id, { status: "synced", ideaId: 8 });
    await transcribeRecording(store, id, { fetcher: async () => response({ error: "nope" }, status) });
    const saved = await store.get(id);
    assert.equal(saved.transcriptionStatus, "unavailable");
    assert.equal(saved.transcriptionAttempts >= maxTranscriptionAttempts, permanent, `status ${status}`);
    assert.equal(await (await store.audio(id)).text(), "audio");
  }
});

test("library-only recordings upload once, never touch subjects, and transcribe into the library item", async () => {
  const { store, id } = await recording();
  await store.append(id, new Blob(["library audio"]), 1);
  await store.patch(id, { status: "saved", destination: "library", durationSeconds: 12, transcriptionLanguage: "ar" });
  const calls = [];
  let created = 0;
  const fetcher = async (url, options = {}) => {
    calls.push(`${options.method || "GET"} ${url}`);
    if (url === "/api/storage/uploads/request-url") return response({ uploadURL: "/signed-upload", objectPath: "/objects/lib-1" });
    if (url === "/signed-upload") return response({});
    if (url === "/api/audio-library/recordings") {
      const body = JSON.parse(options.body);
      assert.equal(body.clientCaptureId, id);
      assert.equal(body.durationSeconds, 12);
      created++;
      if (created === 1) throw new Error("connection lost after the server saved it");
      return response({ id: 77, url: body.url, transcript: null });
    }
    if (url === "/api/audio-library/77/transcription") {
      assert.equal(JSON.parse(options.body).language, "ar");
      return response({ id: 77, transcript: "تسجيل في المكتبة" });
    }
    throw new Error(`unexpected ${url}`);
  };
  assert.equal(await syncRecording(store, id, { fetcher }), null);
  assert.equal((await store.get(id)).status, "saved");
  assert.equal((await syncRecording(store, id, { fetcher })).id, 77);
  const saved = await store.get(id);
  assert.equal(saved.status, "synced");
  assert.equal(saved.libraryItemId, 77);
  assert.equal(saved.subjectId, null);
  assert.ok(!calls.some((call) => call.includes("/api/subjects")), "no subject requests");
  assert.equal(calls.filter((call) => call.endsWith("/signed-upload")).length, 1, "audio uploaded once");
  await transcribeRecording(store, id, { fetcher });
  assert.equal((await store.get(id)).transcript, "تسجيل في المكتبة");
  assert.equal(await (await store.audio(id)).text(), "library audio");
});
