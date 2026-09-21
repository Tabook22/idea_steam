import { RequestUploadUrlResponse } from "../lib/api-zod/src/generated/api.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { scryptSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import { Readable } from "node:stream";
import { appPath, uploadCredentials } from "../artifacts/idea-stream/src/lib/app-path.ts";
import { privateAccess } from "../artifacts/api-server/src/lib/private-access.ts";
import {
  ObjectStorageService,
  localUpload,
} from "../artifacts/api-server/src/lib/storage-service.ts";
const require = createRequire(
  new URL("../artifacts/api-server/package.json", import.meta.url),
);
const express = require("express");

test("subpath API and media URLs stay inside /ideas without changing external destinations", () => {
  assert.equal(appPath("/api/subjects", "/ideas/"), "/ideas/api/subjects");
  assert.equal(
    appPath("/api/storage/objects/id", "/ideas/"),
    "/ideas/api/storage/objects/id",
  );
  assert.equal(
    appPath("/ideas/api/subjects", "/ideas/"),
    "/ideas/api/subjects",
  );
  assert.equal(
    appPath("https://storage.example/upload", "/ideas/"),
    "https://storage.example/upload",
  );
  assert.equal(appPath("/api/subjects", "/"), "/api/subjects");
});

test("private VPS uploads require login and a valid size-bound signature, persist across instances, and reject traversal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "idea-stream-vps-test-"));
  const env = {
    LOCAL_STORAGE_DIR: directory,
    UPLOAD_SIGNING_SECRET: "test-secret-longer-than-thirty-two-characters",
    APP_BASE_PATH: "/ideas",
    APP_ORIGIN: "https://nasserdiary.com",
    APP_REQUIRE_AUTH: "true",
    APP_USERNAME: "owner",
    APP_PASSWORD_HASH: `test-salt:${scryptSync("test-password", "test-salt", 32).toString("hex")}`,
  };
  const storage = new ObjectStorageService(env);
  const app = express();
  app.use(privateAccess(env));
  app.put("/ideas/api/storage/local-upload/:id", localUpload(env));
  app.get("/ideas/api/storage/objects/:id", async (req, res) => {
    try {
      const file = await storage.getObjectEntityFile(
        `/objects/${req.params.id}`,
      );
      const response = await storage.downloadObject(file);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      Readable.fromWeb(response.body).pipe(res);
    } catch {
      res.sendStatus(404);
    }
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const localUrl = url => { const parsed = new URL(url); return origin + parsed.pathname + parsed.search; };
  const headers = {
    Authorization: `Basic ${Buffer.from("owner:test-password").toString("base64")}`,
  };
  try {
    const url = await storage.getObjectEntityUploadURL("uploads", {
      size: 5,
      contentType: "audio/webm",
    });
    const objectPath = storage.normalizeObjectEntityPath(url);
    assert.ok(RequestUploadUrlResponse.safeParse({uploadURL:url,objectPath}).success);
    assert.equal(uploadCredentials(url,"https://nasserdiary.com"),"same-origin");
    assert.equal(uploadCredentials("https://storage.example/put","https://nasserdiary.com"),"omit");
    const unauth = await fetch(localUrl(url), { method: "PUT", body: "hello" });
    assert.equal(unauth.status, 401);
    assert.match(unauth.headers.get("www-authenticate"), /Idea Stream/);
    assert.equal(
      (
        await fetch(localUrl(url) + "x", {
          method: "PUT",
          headers,
          body: "hello",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(localUrl(url), {
          method: "PUT",
          headers: { ...headers, Origin: "https://other.test" },
          body: "hello",
        })
      ).status,
      403,
    );
    assert.equal(
      (await fetch(localUrl(url), { method: "PUT", headers, body: "hello" }))
        .status,
      200,
    );
    const response = await fetch(origin + "/ideas/api/storage" + objectPath, {
      headers,
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "hello");
    assert.equal(response.headers.get("content-type"), "audio/webm");
    const reopened = new ObjectStorageService(env);
    assert.equal(
      await (
        await reopened.downloadObject(
          await reopened.getObjectEntityFile(objectPath),
        )
      ).text(),
      "hello",
    );
    await assert.rejects(
      reopened.getObjectEntityFile("/objects/../../private/app.env"),
    );
    await assert.rejects(
      storage.getObjectEntityUploadURL("uploads", {
        size: 51 * 1024 * 1024,
        contentType: "audio/webm",
      }),
    );
    const incomplete = await storage.getObjectEntityUploadURL("uploads", {
      size: 6,
      contentType: "audio/webm",
    });
    assert.equal(
      (
        await fetch(localUrl(incomplete), {
          method: "PUT",
          headers,
          body: "short",
        })
      ).status,
      400,
    );
    await assert.rejects(
      storage.getObjectEntityFile(
        storage.normalizeObjectEntityPath(incomplete),
      ),
    );
    assert.throws(() => privateAccess({ APP_REQUIRE_AUTH: "true" }));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("idea-stream-vps-test-"));
    await rm(directory, { recursive: true, force: true });
  }
});
