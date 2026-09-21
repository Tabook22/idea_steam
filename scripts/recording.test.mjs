import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { RecordingStore } from "../artifacts/idea-stream/src/lib/recording-store.ts";
import { syncRecording } from "../artifacts/idea-stream/src/lib/recording-sync.ts";
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
  const { store, id } = await recording();
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
  assert.equal(calls.filter((url) => url === "/api/transcriptions").length, 1);
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
    if (url === "/api/transcriptions")
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
