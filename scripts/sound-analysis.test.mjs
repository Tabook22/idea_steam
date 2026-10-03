import { test } from "node:test";
import assert from "node:assert/strict";
import { analyse, detectHum, powerSpectrum, spectrogram, freqAtY, yAtFreq } from "../artifacts/idea-stream/src/lib/sound-analysis.ts";

const RATE = 16000;
// Deterministic "random" numbers so results never flake.
function noiseSource(seed = 1) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 - 0.5; }; }

function make(seconds, fill) {
  const samples = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < samples.length; i++) samples[i] = fill(i / RATE, i);
  return samples;
}

/** Speech-like: a gliding voice pitch with formants, switched on and off in syllables (~4 per second). */
function speech(t, rand) {
  const syllable = Math.max(0, Math.sin(2 * Math.PI * 2 * t)) ** 2; // 4 bursts per second
  const pitch = 120 + 30 * Math.sin(2 * Math.PI * 0.7 * t) + 15 * Math.sin(2 * Math.PI * 3.1 * t);
  let value = 0;
  for (let h = 1; h <= 25; h++) {
    const f = pitch * h;
    const formant = Math.exp(-(((f - 700) / 300) ** 2)) + 0.6 * Math.exp(-(((f - 1800) / 400) ** 2)) + 0.3 * Math.exp(-(((f - 2800) / 500) ** 2));
    value += (formant * Math.sin(2 * Math.PI * pitch * t * h)) / h ** 0.3;
  }
  return 0.25 * syllable * value + 0.002 * rand();
}
/** Music-like: held chords that change every second. */
function music(t) {
  const chords = [[261.6, 329.6, 392], [220, 277.2, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6]];
  const chord = chords[Math.floor(t) % chords.length];
  return chord.reduce((sum, f) => sum + 0.12 * (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(4 * Math.PI * f * t)), 0);
}

const run = (samples) => analyse(samples, RATE, spectrogram(samples, RATE));
const main = (result) => Object.entries(result.share).sort((a, b) => b[1] - a[1])[0][0];

test("a full-scale sine reads about 0 dB at its frequency", () => {
  const samples = make(1, (t) => Math.sin(2 * Math.PI * 1000 * t));
  const power = powerSpectrum(samples, 0, 2048);
  const bin = Math.round(1000 / (RATE / 2048));
  const db = 10 * Math.log10(Math.max(power[bin - 1], power[bin], power[bin + 1]));
  assert.ok(Math.abs(db) < 2, `${db}`);
});

test("speech is recognised as voice", () => {
  const rand = noiseSource(3);
  const result = run(make(8, (t) => speech(t, rand)));
  assert.equal(main(result), "voice", JSON.stringify(result.share));
});

test("held chords are recognised as music", () => {
  const result = run(make(8, (t) => music(t)));
  assert.equal(main(result), "music", JSON.stringify(result.share));
});

test("steady hiss is recognised as noise", () => {
  const rand = noiseSource(5);
  const result = run(make(6, () => 0.2 * rand()));
  assert.equal(main(result), "noise", JSON.stringify(result.share));
});

test("near-silence is recognised as silence", () => {
  const rand = noiseSource(7);
  const result = run(make(5, () => 0.0005 * rand()));
  assert.equal(main(result), "silence", JSON.stringify(result.share));
});

test("a recording with speech, then music, then silence is split into those parts", () => {
  const rand = noiseSource(9);
  const result = run(make(15, (t) => (t < 6 ? speech(t, rand) : t < 11 ? music(t) : 0.0003 * rand())));
  const at = (time) => result.segments.find((s) => s.start <= time && s.end > time)?.kind;
  assert.equal(at(3), "voice", JSON.stringify(result.segments));
  assert.equal(at(8.5), "music", JSON.stringify(result.segments));
  assert.equal(at(13), "silence", JSON.stringify(result.segments));
});

test("50 Hz mains hum is detected, and not where there is none", () => {
  const rand = noiseSource(11);
  const withHum = make(8, (t) => speech(t, rand) + 0.02 * (Math.sin(2 * Math.PI * 50 * t) + 0.5 * Math.sin(2 * Math.PI * 100 * t) + 0.3 * Math.sin(2 * Math.PI * 150 * t)));
  assert.equal(detectHum(withHum, RATE), 50);
  const sixty = make(8, (t) => speech(t, rand) + 0.02 * (Math.sin(2 * Math.PI * 60 * t) + 0.5 * Math.sin(2 * Math.PI * 120 * t)));
  assert.equal(detectHum(sixty, RATE), 60);
  assert.equal(detectHum(make(8, (t) => speech(t, rand)), RATE), null);
});

test("noisy speech suggests noise reduction; clean speech does not", () => {
  const rand = noiseSource(13);
  const noisy = run(make(8, (t) => speech(t, rand) + 0.03 * rand()));
  assert.ok((noisy.suggestion.noise ?? 0) >= 2, JSON.stringify({ s: noisy.suggestion, floor: noisy.noiseFloorDb, voice: noisy.voiceLevelDb }));
  const clean = run(make(8, (t) => speech(t, rand)));
  assert.ok((clean.suggestion.noise ?? 0) <= 1, JSON.stringify({ s: clean.suggestion, floor: clean.noiseFloorDb, voice: clean.voiceLevelDb }));
});

test("low rumble is detected and the rumble band is cut", () => {
  const rand = noiseSource(17);
  const result = run(make(8, (t) => speech(t, rand) + 0.25 * Math.sin(2 * Math.PI * 35 * t) + 0.15 * Math.sin(2 * Math.PI * 47 * t)));
  assert.equal(result.rumble, true);
  assert.ok((result.suggestion.bands?.rumble ?? 0) < 0);
});

test("the frequency scale round-trips", () => {
  for (const f of [50, 300, 1000, 8000]) assert.ok(Math.abs(freqAtY(yAtFreq(f, 200, 8000), 200, 8000) - f) < 1e-6);
});
