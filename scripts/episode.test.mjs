import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const duration = (path) => Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).stdout.toString().trim());

test("Script to Episode: sections are trimmed, tightened, joined with short gaps, and chapters start where each section does", { skip: !hasFfmpeg }, async () => {
  const store = mkdtempSync(join(tmpdir(), "episode-test-"));
  process.env.LOCAL_STORAGE_DIR = store;
  try {
    // A take: 1.5 s silence, 2 s tone, a 2 s pause, 1.5 s tone (7 s in all).
    const take = join(store, "take.webm");
    const made = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-filter_complex", "[0:a]atrim=duration=1.5[s];[1:a]atrim=duration=2,volume=0.3[t];[0:a]atrim=duration=2.0[p];[1:a]atrim=duration=1.5,volume=0.3[t2];[s][t][p][t2]concat=n=4:v=0:a=1[out]",
      "-map", "[out]", "-c:a", "libopus", "-f", "webm", take]);
    assert.equal(made.status, 0, made.stderr?.toString());
    const urls = [1, 2].map(() => {
      const id = randomUUID();
      copyFileSync(take, join(store, id));
      writeFileSync(join(store, `${id}.json`), JSON.stringify({ contentType: "audio/webm" }));
      return `/api/storage/objects/${id}`;
    });
    const { buildEpisode } = await import("../artifacts/api-server/src/lib/audio-edit.ts");

    const tight = await buildEpisode(urls, { clean: false, tighten: true, gap: 0.6 });
    const tightLength = duration(join(store, tight.url.split("/").pop()));
    // Each take: 0.15 s lead-in + 2 + a 0.7 s pause + 1.5 = about 4.35 s; two takes and one gap ≈ 9.3 s.
    assert.ok(tightLength > 8.6 && tightLength < 10, `tightened episode is ${tightLength} s`);
    assert.equal(tight.starts[0], 0);
    assert.ok(tight.starts[1] > 4 && tight.starts[1] < 5.2, `second section starts at ${tight.starts[1]} s`);

    const loose = await buildEpisode(urls, { clean: true, tighten: false, gap: 0.6 });
    const looseLength = duration(join(store, loose.url.split("/").pop()));
    // Without tightening only the start is trimmed: 0.15 + 5.5 = about 5.65 s per take.
    assert.ok(looseLength > tightLength + 2, `keeping pauses makes it longer (${looseLength} s)`);
    await assert.rejects(buildEpisode([], { clean: true, tighten: true, gap: 0.6 }), /1 to 40/);
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});
