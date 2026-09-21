import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeYoutubeVideoUrl } from "../artifacts/api-server/src/lib/youtube-url.ts";

test("video links normalize to a single video and discard tracking or playlist parameters", () => {
  for (const input of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=untrusted&start=30",
    "https://youtu.be/dQw4w9WgXcQ?t=2",
    "https://m.youtube.com/shorts/dQw4w9WgXcQ",
    "https://youtube.com/embed/dQw4w9WgXcQ",
    "https://youtube.com/live/dQw4w9WgXcQ",
  ])
    assert.equal(
      normalizeYoutubeVideoUrl(input),
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
});

test("the caption service rejects arbitrary hosts, malformed videos, credentials, and protocols", () => {
  for (const input of [
    "https://example.com/video",
    "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
    "https://youtube.com@127.0.0.1/watch?v=dQw4w9WgXcQ",
    "file:///etc/passwd",
    "https://youtube.com/playlist?list=123",
    "https://youtube.com/watch?v=short",
    "https://user:password@youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com:8080/watch?v=dQw4w9WgXcQ",
    "--exec=anything",
    "",
  ])
    assert.equal(normalizeYoutubeVideoUrl(input), null, input);
});
