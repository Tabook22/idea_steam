import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as client from "../artifacts/idea-stream/src/lib/mix.ts";
import * as server from "../artifacts/api-server/src/lib/mix.ts";

const base = { musicStart: 0, regionStart: 0, regionEnd: 4, fit: "loop", musicVolume: 0, voiceVolume: 0, fadeIn: 0, fadeOut: 0, duck: 0, makeRoom: false };

test("the live preview and the server plan the same timing", () => {
  for (const settings of [
    base,
    { ...base, regionStart: -2, regionEnd: 5 },
    { ...base, fit: "stretch", regionEnd: 3 },
    { ...base, fit: "stretch", regionEnd: 30 },
    { ...base, fit: "once", regionStart: 1, regionEnd: 10, musicStart: 0.5 },
  ]) assert.deepEqual(client.mixPlan(4, 2, settings), server.mixPlan(4, 2, settings), JSON.stringify(settings));
});

test("an intro moves the voice later and an outro makes the result longer", () => {
  const plan = client.mixPlan(4, 2, { ...base, regionStart: -2, regionEnd: 5 });
  assert.equal(plan.pre, 2);
  assert.equal(plan.offset, 0);
  assert.equal(plan.total, 7);
  assert.equal(plan.loops, true);
});

test("stretch slows a short song to fit, and loops only beyond the natural limit", () => {
  const slow = client.mixPlan(4, 2, { ...base, fit: "stretch", regionEnd: 3 });
  assert.ok(Math.abs(slow.tempo - 2 / 3) < 0.001 && !slow.loops, JSON.stringify(slow));
  const far = client.mixPlan(4, 2, { ...base, fit: "stretch", regionEnd: 30 });
  assert.equal(far.tempo, 0.5);
  assert.equal(far.loops, true);
  const fast = client.mixPlan(4, 10, { ...base, fit: "stretch", regionEnd: 4 });
  assert.equal(fast.tempo, 2);
});

test("the timeline knows which moment of the song is heard", () => {
  const settings = { ...base, musicStart: 0.5, regionEnd: 4 };
  const plan = client.mixPlan(4, 2, settings); // 1.5 s of song, looping
  assert.equal(client.songTimeAt(plan, settings, 0), 0.5);
  assert.ok(Math.abs(client.songTimeAt(plan, settings, 1.6) - 0.6) < 1e-9);
  assert.equal(client.songTimeAt(plan, settings, 4.1), null);
});

const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

test("real mixes: placement, loop, stretch, once, fades and ducking", { skip: !ffmpeg && "ffmpeg not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "mix-"));
  // Voice: a 1 kHz tone for 4 s. Music: a 300 Hz tone for 2 s.
  const render = (name, settings) => {
    const plan = server.mixPlan(4, 2, settings);
    const out = join(dir, `${name}.wav`);
    const result = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-y", "-f", "lavfi", "-i", "sine=f=1000:d=4:r=48000", "-f", "lavfi", "-i", "sine=f=300:d=2:r=48000",
      "-filter_complex", server.mixGraph(plan, settings), "-map", "[out]", out], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr.slice(-1500));
    return out;
  };
  const level = (file, from, to, f) => Number(spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-i", file, "-af", `atrim=${from}:${to},bandpass=f=${f}:t=h:w=40,bandpass=f=${f}:t=h:w=40,volumedetect`, "-f", "null", "-"], { encoding: "utf8" }).stderr.match(/mean_volume: (-?[\d.]+|-inf)/)?.[1] ?? -200);
  const length = (file) => Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).stdout);
  const heard = (db) => db > -60;
  try {
    const intro = render("intro", { ...base, regionStart: -2, regionEnd: 5 });
    assert.ok(Math.abs(length(intro) - 7) < 0.05, `length ${length(intro)}`);
    assert.ok(heard(level(intro, 0.3, 1.7, 300)) && !heard(level(intro, 0.3, 1.7, 1000)), "intro: music before the voice");
    assert.ok(heard(level(intro, 2.5, 5.5, 1000)), "voice after the intro");
    assert.ok(heard(level(intro, 6.2, 6.9, 300)) && !heard(level(intro, 6.2, 6.9, 1000)), "outro: music loops on after the voice");

    const stretch = render("stretch", { ...base, fit: "stretch", regionEnd: 3 });
    assert.ok(heard(level(stretch, 2.5, 2.9, 300)), "stretched music still playing at 2.5 s");
    assert.ok(!heard(level(stretch, 3.3, 3.9, 300)), "and finished at the end of its 3 s block");

    const once = render("once", { ...base, fit: "once", regionEnd: 4 });
    assert.ok(heard(level(once, 1.5, 1.9, 300)) && !heard(level(once, 2.3, 3.8, 300)), "play once stops when the song ends");

    const faded = render("faded", { ...base, regionEnd: 4, fadeIn: 1.5 });
    assert.ok(level(faded, 0, 0.3, 300) < level(faded, 1.6, 1.9, 300) - 10, "fade in starts quiet");

    const plain = render("plain", { ...base, regionStart: -2, regionEnd: 5, duck: 0 });
    const ducked = render("ducked", { ...base, regionStart: -2, regionEnd: 5, duck: 3 });
    const dip = (file) => level(file, 0.5, 1.5, 300) - level(file, 3, 5, 300);
    assert.ok(Math.abs(dip(plain)) < 1.5, `no ducking: music steady (${dip(plain).toFixed(1)} dB)`);
    assert.ok(dip(ducked) > 6, `ducking lowers the music while the voice speaks (${dip(ducked).toFixed(1)} dB)`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
