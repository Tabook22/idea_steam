import { test } from "node:test";
import assert from "node:assert/strict";
import { findSimilar, soundPrint } from "../artifacts/idea-stream/src/lib/similar-sounds.ts";

const RATE = 16000;
function noiseSource(seed = 1) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 - 0.5; }; }

/** A vowel: a voice at `pitch` shaped by two formants, with soft edges. */
function vowel(t, length, pitch, f1, f2) {
  const edge = Math.min(1, t / 0.04, (length - t) / 0.04);
  let value = 0;
  for (let h = 1; h <= 30; h++) {
    const f = pitch * h;
    const shape = Math.exp(-(((f - f1) / 120) ** 2)) + 0.5 * Math.exp(-(((f - f2) / 200) ** 2));
    value += shape * Math.sin(2 * Math.PI * f * t);
  }
  return 0.2 * Math.max(0, edge) * value;
}

/** A "word": syllables whose vowels and pitch keep changing. */
function word(t, length, seed) {
  const syllable = Math.floor(t / 0.18);
  const f1 = [300, 700, 450, 800, 350, 650][(syllable + seed) % 6];
  const f2 = [2300, 1200, 1900, 1000, 2100, 1500][(syllable * 2 + seed) % 6];
  const local = t - syllable * 0.18;
  return vowel(local, 0.18, 120 + 25 * Math.sin(t * 7 + seed), f1, f2) * (local < 0.16 ? 1 : 0);
}

function recording(parts) {
  const total = parts.reduce((sum, part) => sum + part.length + 0.25, 0.3);
  const samples = new Float32Array(Math.round(total * RATE));
  const rand = noiseSource(4);
  for (let i = 0; i < samples.length; i++) samples[i] = 0.002 * rand();
  const placed = [];
  let at = 0.3;
  for (const part of parts) {
    const offset = Math.round(at * RATE);
    for (let i = 0; i < Math.round(part.length * RATE); i++) {
      const t = i / RATE;
      samples[offset + i] += part.kind === "uh" ? vowel(t, part.length, part.pitch, 550, 1250) : word(t, part.length, part.seed);
    }
    placed.push({ ...part, start: at, end: at + part.length });
    at += part.length + 0.25;
  }
  return { samples, placed };
}

const parts = [
  { kind: "word", length: 1.0, seed: 0 },
  { kind: "uh", length: 0.35, pitch: 115 },
  { kind: "word", length: 1.2, seed: 2 },
  { kind: "uh", length: 0.42, pitch: 124 },
  { kind: "word", length: 0.8, seed: 3 },
  { kind: "uh", length: 0.3, pitch: 108 },
  { kind: "word", length: 1.1, seed: 5 },
];

test("selecting one 'uh' finds every 'uh' and no words", () => {
  const { samples, placed } = recording(parts);
  const print = soundPrint(samples, RATE);
  const fillers = placed.filter((part) => part.kind === "uh");
  const matches = findSimilar(print, { start: fillers[0].start - 0.05, end: fillers[0].end + 0.05 });
  assert.equal(matches.length, 3, JSON.stringify(matches));
  for (const filler of fillers) {
    assert.ok(matches.some((m) => m.start < filler.end && m.end > filler.start && m.start >= filler.start - 0.12 && m.end <= filler.end + 0.12), `found the 'uh' at ${filler.start.toFixed(2)} s: ${JSON.stringify(matches)}`);
  }
});

test("strict finds fewer or the same; loose finds at least as many", () => {
  const { samples, placed } = recording(parts);
  const print = soundPrint(samples, RATE);
  const filler = placed.find((part) => part.kind === "uh");
  const example = { start: filler.start, end: filler.end };
  const strict = findSimilar(print, example, "strict").length;
  const normal = findSimilar(print, example, "normal").length;
  const loose = findSimilar(print, example, "loose").length;
  assert.ok(strict <= normal && normal <= loose && strict >= 1, `${strict} ${normal} ${loose}`);
});

test("parts already cut are skipped, and silence never matches", () => {
  const { samples, placed } = recording(parts);
  const print = soundPrint(samples, RATE);
  const fillers = placed.filter((part) => part.kind === "uh");
  const matches = findSimilar(print, { start: fillers[0].start, end: fillers[0].end }, "loose", [{ start: fillers[1].start, end: fillers[1].end }]);
  assert.ok(!matches.some((m) => m.start < fillers[1].end && m.end > fillers[1].start), JSON.stringify(matches));
  const quiet = findSimilar(print, { start: 0, end: 0.28 }, "loose");
  assert.equal(quiet.length, 0, "a silent example finds nothing");
});
