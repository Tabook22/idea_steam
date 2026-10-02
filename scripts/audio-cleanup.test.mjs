import { test } from "node:test";
import assert from "node:assert/strict";
import { fillerIndexes, isWordRemoved, longPauses, rangesForWords, silentEdges, subtractRange } from "../artifacts/idea-stream/src/lib/audio-cleanup.ts";

// Synthetic audio at 8 kHz: segments of "speech" (a tone) and silence, with a little background noise.
function audio(parts, rate = 8000) {
  const total = parts.reduce((sum, [, seconds]) => sum + seconds, 0);
  const samples = new Float32Array(Math.round(total * rate));
  let offset = 0;
  let seed = 1;
  for (const [kind, seconds] of parts) {
    const n = Math.round(seconds * rate);
    for (let i = 0; i < n; i++) {
      seed = (seed * 16807) % 2147483647;
      const noise = ((seed / 2147483647) - 0.5) * 0.004;
      samples[offset + i] = noise + (kind === "speech" ? 0.3 * Math.sin((2 * Math.PI * 220 * i) / rate) : 0);
    }
    offset += n;
  }
  return { samples, rate };
}
const near = (a, b, tolerance = 0.06) => Math.abs(a - b) <= tolerance;

test("long pauses are shortened, short ones kept", () => {
  const { samples, rate } = audio([["speech", 1], ["silence", 3], ["speech", 1], ["silence", 0.5], ["speech", 1]]);
  const cuts = longPauses(samples, rate);
  assert.equal(cuts.length, 1, "only the 3 s pause");
  assert.ok(near(cuts[0].start, 1.2) && near(cuts[0].end, 3.8), JSON.stringify(cuts));
});

test("silence before speaking and after stopping is trimmed with a margin", () => {
  const { samples, rate } = audio([["silence", 2], ["speech", 1], ["silence", 1.5]]);
  const edges = silentEdges(samples, rate);
  assert.equal(edges.length, 2);
  assert.ok(near(edges[0].start, 0) && near(edges[0].end, 1.85), JSON.stringify(edges));
  assert.ok(near(edges[1].start, 3.15) && near(edges[1].end, 4.5), JSON.stringify(edges));
});

const words = [
  { word: "So", start: 0.0, end: 0.3 }, { word: "um,", start: 0.5, end: 0.8 }, { word: "the", start: 1.0, end: 1.1 },
  { word: "اممم", start: 1.4, end: 1.9 }, { word: "idea", start: 2.0, end: 2.5 }, { word: "يعني", start: 2.6, end: 2.9 },
];

test("filler sounds are found in English and Arabic; meaningful words are kept", () => {
  assert.deepEqual(fillerIndexes(words), [1, 3]);
});

test("striking neighbouring words also removes the gap between them", () => {
  const separate = rangesForWords(words, [1]);
  assert.ok(near(separate[0].start, 0.47) && near(separate[0].end, 0.86), JSON.stringify(separate));
  const together = rangesForWords(words, [2, 3]);
  assert.deepEqual(together.map((r) => [+r.start.toFixed(2), +r.end.toFixed(2)]), [[0.97, 1.4], [1.1, 1.96]]);
  assert.ok(isWordRemoved(words[2], together) && isWordRemoved(words[3], together) && !isWordRemoved(words[4], together));
});

test("putting a word back subtracts it from the cuts", () => {
  assert.deepEqual(subtractRange([{ start: 0, end: 10 }], { start: 4, end: 6 }), [{ start: 0, end: 4 }, { start: 6, end: 10 }]);
});
