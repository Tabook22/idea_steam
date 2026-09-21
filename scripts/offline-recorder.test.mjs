import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { offlineRecorderShell } from "../artifacts/idea-stream/offline-recorder-plugin.ts";

function worker(html = "<html>shell</html>") {
  const plugin = offlineRecorderShell();
  plugin.configResolved({ base: "/notebook/" });
  let source;
  plugin.generateBundle.call(
    {
      emitFile(asset) {
        source = asset.source;
      },
    },
    {},
    {
      "index.html": { type: "asset", source: html },
      "assets/index.js": { type: "chunk", code: "app code" },
      "assets/index.css": { type: "asset", source: "body{}" },
    },
  );
  return source;
}

test("offline shell restores navigation, excludes APIs, and isolates cache cleanup", async () => {
  const listeners = {};
  const cached = new Map();
  const removed = [];
  let claimed = false;
  const cache = {
    async addAll(requests) {
      for (const req of requests) cached.set(req.url, `cached:${req.url}`);
    },
    async match(req) {
      return cached.get(
        typeof req === "string" ? req : new URL(req.url).pathname,
      );
    },
  };
  const source = worker();
  const prefix = JSON.parse(source.match(/const CACHE_PREFIX = (.+);/)[1]);
  vm.runInNewContext(source, {
    URL,
    Request: class {
      constructor(url) {
        this.url = url;
      }
    },
    self: {
      location: { origin: "https://example.test" },
      clients: {
        async claim() {
          claimed = true;
        },
      },
      addEventListener(type, callback) {
        listeners[type] = callback;
      },
    },
    caches: {
      async open() {
        return cache;
      },
      async keys() {
        return ["unrelated-app", `${prefix}old`];
      },
      async delete(key) {
        removed.push(key);
      },
    },
    async fetch() {
      throw new Error("network unavailable");
    },
  });
  let pending;
  listeners.install({
    waitUntil(promise) {
      pending = promise;
    },
  });
  await pending;
  assert.ok(cached.has("/notebook/index.html"));
  listeners.activate({
    waitUntil(promise) {
      pending = promise;
    },
  });
  await pending;
  assert.deepEqual(removed, [`${prefix}old`]);
  assert.equal(claimed, true);
  const event = (path) => ({
    request: {
      url: `https://example.test${path}`,
      method: "GET",
      mode: "navigate",
    },
    respondWith(promise) {
      pending = promise;
    },
  });
  listeners.fetch(event("/notebook/record"));
  assert.equal(await pending, "cached:/notebook/index.html");
  pending = null;
  listeners.fetch(event("/api/storage/objects/private"));
  assert.equal(pending, null);
  listeners.fetch(event("/notebook/api/subjects"));
  assert.equal(pending, null);
  pending = null;
  listeners.fetch(event("/different-app"));
  assert.equal(pending, null);
  assert.notEqual(
    worker("new html"),
    source,
    "HTML-only releases must create a fresh cache",
  );
});
