import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as client from "../artifacts/idea-stream/src/lib/sound-lab.ts";
import * as server from "../artifacts/api-server/src/lib/sound-lab.ts";

test("the noise level of a stretch is measured like ffmpeg measures it", () => {
  const samples = new Float32Array(16000).map((_, i) => 0.1 * Math.sin((2 * Math.PI * 440 * i) / 16000));
  assert.ok(Math.abs(client.rmsDb(samples, 16000, 0, 1) - -23) < 0.2, String(client.rmsDb(samples, 16000, 0, 1)));
});

test("the live preview and the server use the same bands and box filters", () => {
  assert.deepEqual(client.BANDS.map(({ id, type, frequency, q }) => ({ id, type, frequency, q })), server.BANDS.map((band) => ({ ...band })));
  assert.deepEqual(client.NOISE_REDUCTION, server.NOISE_REDUCTION);
  assert.equal(client.HUM_Q, server.HUM_Q);
  for (const edit of [
    { start: 1, end: 2, low: 900, high: 1100, gain: -40 },
    { start: 0, end: 5, low: 60, high: 12000, gain: 6 },
    { start: 3, end: 4, low: 5000, high: 300, gain: -12 },
    { start: 2, end: 3, low: 20, high: 25, gain: -6 },
  ]) assert.deepEqual(client.editFilters(edit), server.editFilters(edit), JSON.stringify(edit));
});

const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const neutral = { noise: 0, noiseSample: null, noiseFloor: null, hum: null, bands: { rumble: 0, warmth: 0, voice: 0, presence: 0, air: 0 }, edits: [], volume: 0, level: false, deess: false };

function render(dir, name, settings) {
  const out = join(dir, `${name}.wav`);
  // 6 s: a 1 kHz tone, 50 Hz hum (with harmonics), 40 Hz rumble and steady hiss.
  const source = "sine=f=1000:d=6:r=16000,volume=0.3[a];sine=f=50:d=6:r=16000,volume=0.1[h];sine=f=100:d=6:r=16000,volume=0.05[h2];sine=f=40:d=6:r=16000,volume=0.15[r];anoisesrc=d=6:r=16000:a=0.03:seed=3[n];[a][h][h2][r][n]amix=inputs=5:normalize=0";
  const chain = server.soundLabFilters(settings).join(",");
  const result = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-y", "-filter_complex", `${source},${chain}`, "-ac", "1", out], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr.slice(-1500));
  return out;
}
function level(file, { from = 0, to = 6, f, w = 20 } = {}) {
  const band = f ? `,bandpass=f=${f}:t=h:w=${w},bandpass=f=${f}:t=h:w=${w}` : "";
  const result = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-i", file, "-af", `atrim=${from}:${to}${band},volumedetect`, "-f", "null", "-"], { encoding: "utf8" });
  return Number(result.stderr.match(/mean_volume: (-?[\d.]+) dB/)?.[1]);
}

test("each Sound lab tool does what it says on real audio", { skip: !ffmpeg && "ffmpeg not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "sound-lab-"));
  try {
    const before = render(dir, "before", neutral);
    const hum = render(dir, "hum", { ...neutral, hum: 50 });
    assert.ok(level(before, { f: 50, w: 6 }) - level(hum, { f: 50, w: 6 }) > 15, "hum removal takes out 50 Hz");
    assert.ok(Math.abs(level(before, { f: 1000 }) - level(hum, { f: 1000 })) < 1, "hum removal leaves the voice range alone");

    const rumble = render(dir, "rumble", { ...neutral, bands: { ...neutral.bands, rumble: -24 } });
    assert.ok(level(before, { f: 40, w: 8 }) - level(rumble, { f: 40, w: 8 }) > 12, "cutting the rumble band lowers 40 Hz");

    const box = render(dir, "box", { ...neutral, edits: [{ start: 2, end: 4, low: 800, high: 1250, gain: -40 }] });
    assert.ok(level(before, { from: 2.2, to: 3.8, f: 1000 }) - level(box, { from: 2.2, to: 3.8, f: 1000 }) > 25, "a box removes the tone inside it");
    assert.ok(Math.abs(level(before, { from: 0, to: 1.8, f: 1000 }) - level(box, { from: 0, to: 1.8, f: 1000 })) < 1, "and leaves it before");
    assert.ok(Math.abs(level(before, { from: 4.2, to: 6, f: 1000 }) - level(box, { from: 4.2, to: 6, f: 1000 })) < 1, "and after");

    // A chord spread across a box: every note goes, not just the middle one.
    const chordSource = "sine=f=261.6:d=6:r=16000,volume=0.3[c1];sine=f=329.6:d=6:r=16000,volume=0.3[c2];sine=f=392:d=6:r=16000,volume=0.3[c3];[c1][c2][c3]amix=inputs=3:normalize=0";
    const chord = (name, settings) => {
      const out = join(dir, `${name}.wav`);
      const result = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-y", "-filter_complex", `${chordSource},${server.soundLabFilters(settings).join(",")}`, "-ac", "1", out], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr.slice(-800));
      return out;
    };
    const chordBefore = chord("chord-before", neutral);
    const chordAfter = chord("chord-after", { ...neutral, edits: [{ start: 1, end: 5, low: 220, high: 440, gain: -40 }] });
    for (const note of [261.6, 329.6, 392]) {
      const drop = level(chordBefore, { from: 1.5, to: 4.5, f: note, w: 6 }) - level(chordAfter, { from: 1.5, to: 4.5, f: note, w: 6 });
      assert.ok(drop > 30, `the ${note} Hz note drops by ${drop.toFixed(1)} dB`);
    }

    const quieter = render(dir, "quieter", { ...neutral, edits: [{ start: 1, end: 2, low: 20, high: 20000, gain: -12 }] });
    assert.ok(Math.abs(level(before, { from: 1.1, to: 1.9 }) - level(quieter, { from: 1.1, to: 1.9 }) - 12) < 1.5, "a full-height box changes the volume for that time");

    // The hiss alone measures about -35 dB; that is what the app would measure and send.
    const measured = render(dir, "measured", { ...neutral, noise: 4, noiseFloor: -35 });
    assert.ok(level(before, { f: 6000, w: 400 }) - level(measured, { f: 6000, w: 400 }) > 12, "noise reduction with the measured level removes the hiss");
    assert.ok(Math.abs(level(before, { f: 1000 }) - level(measured, { f: 1000 })) < 1.5, "and keeps the tone");

    // The test tones are quiet (ffmpeg's sine is 1/8 scale), so push +24 dB: well past full scale.
    const loud = render(dir, "loud", { ...neutral, volume: 12, edits: [{ start: 0, end: 6, low: 20, high: 20000, gain: 12 }] });
    const peak = Number(spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-i", loud, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" }).stderr.match(/max_volume: (-?[\d.]+) dB/)?.[1]);
    assert.ok(peak <= 0 && peak > -1, `louder never clips (peak ${peak} dB)`);

    render(dir, "everything", { noise: 4, noiseSample: { start: 0, end: 1 }, noiseFloor: -40, hum: 60, bands: { rumble: -10, warmth: 3, voice: 2, presence: 4, air: -3 }, edits: [{ start: 1, end: 1.5, low: 200, high: 9000, gain: 6 }], volume: -3, level: true, deess: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
