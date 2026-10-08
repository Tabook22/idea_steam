import { test } from "node:test";
import assert from "node:assert/strict";
import { SpeakerMap, clock, mergeSegments, minutesPrompt, minutesText, parseMinutes, plainTranscript, speakerName, talkTime, transcriptLines, voiceSample } from "../artifacts/api-server/src/lib/meeting-minutes.ts";

test("speakers keep one name across the parts of a long meeting", () => {
  const map = new SpeakerMap();
  map.startPart();
  assert.equal(map.id("A"), "S1");
  assert.equal(map.id("B"), "S2");
  assert.equal(map.id("A"), "S1");
  map.remember("S1");
  map.remember("S2");
  // Next part: the service recognises the known voices by name, and labels new ones A, B…
  map.startPart();
  assert.equal(map.id("S2"), "S2");
  assert.equal(map.id("A"), "S3", "a new voice gets a new id");
  assert.equal(map.id("A"), "S3");
  map.startPart();
  assert.equal(map.id("A"), "S4", "letters are per part");
});

test("pieces by the same speaker close together are merged; empty ones dropped", () => {
  const merged = mergeSegments([
    { start: 0, end: 2, speaker: "S1", text: "Hello" },
    { start: 2.5, end: 4, speaker: "S1", text: " everyone." },
    { start: 4.2, end: 6, speaker: "S2", text: "Hi." },
    { start: 6.1, end: 6.5, speaker: "S2", text: "  " },
    { start: 9, end: 10, speaker: "S2", text: "Later." },
  ]);
  assert.deepEqual(merged.map((s) => [s.speaker, s.text]), [["S1", "Hello everyone."], ["S2", "Hi."], ["S2", "Later."]]);
});

test("a voice sample is a clean 3–9 s stretch of that speaker", () => {
  const segments = [{ start: 0, end: 2, speaker: "S1" }, { start: 5, end: 20, speaker: "S1" }, { start: 21, end: 25, speaker: "S2" }];
  assert.deepEqual(voiceSample(segments, "S1"), { start: 5, end: 14 });
  assert.deepEqual(voiceSample(segments, "S2"), { start: 21, end: 25 });
  assert.equal(voiceSample(segments, "S3"), null);
});

test("speakers are shown by name once named, otherwise as Speaker N", () => {
  const segments = [{ start: 65, end: 70, speaker: "S1", text: "Budget first." }, { start: 71, end: 80, speaker: "S2", text: "Agreed." }];
  const names = { S1: "Sara" };
  assert.equal(speakerName("S2", names), "Speaker 2");
  assert.equal(transcriptLines(segments, names), "[1:05] Sara: Budget first.\n[1:11] Speaker 2: Agreed.");
  assert.equal(plainTranscript(segments, names), "Sara: Budget first.\nSpeaker 2: Agreed.");
  assert.deepEqual(talkTime(segments), { S1: 5, S2: 9 });
  assert.equal(clock(3725), "1:02:05");
});

test("the minutes prompt carries the date, agenda, people and markers", () => {
  const prompt = minutesPrompt({ title: "Workshop planning", agenda: "1. Budget\n2. Room", participants: ["Sara", "Ali"], markers: [{ at: 125, kind: "decision" }], recordedOn: new Date("2026-10-08T09:00:00Z") });
  assert.match(prompt, /2026-10-08/);
  assert.match(prompt, /Participants: Sara, Ali/);
  assert.match(prompt, /1\. Budget/);
  assert.match(prompt, /DECISION at 2:05/);
});

test("the AI's minutes are checked: times inside the meeting, valid dates, topics in order", () => {
  const minutes = parseMinutes({
    summary: "We planned the workshop.",
    decisions: [{ text: "Hold it on Thursday", at: 30 }, { text: "" }],
    actions: [{ text: "Book the room", owner: "S2", due: "2026-10-09", at: 50 }, { text: "Print cards", owner: "", due: "soon", at: 9999 }],
    questions: [{ text: "Who pays for the projector?", at: -4 }],
    quotes: [{ text: "Small things matter.", speaker: "Sara", at: 70 }],
    topics: [{ title: "Room", start: 300 }, { title: "Budget", start: 5 }, { title: "Too close", start: 12 }, { title: "", start: 400 }],
  }, 600);
  assert.equal(minutes.decisions.length, 1);
  assert.deepEqual(minutes.actions[1], { text: "Print cards", owner: null, due: null, at: 600 });
  assert.equal(minutes.questions[0].at, null);
  assert.deepEqual(minutes.topics, [{ title: "Budget", start: 0 }, { title: "Room", start: 300 }]);
  assert.equal(parseMinutes({ decisions: [] }, 100), null, "no summary, no minutes");

  const text = minutesText("Workshop planning", minutes, { S2: "Ali" }, false);
  assert.match(text, /^# Workshop planning/);
  assert.match(text, /- Book the room — Ali \(2026-10-09\)/);
  const plain = minutesText("تخطيط الورشة", minutes, {}, true, "plain");
  assert.match(plain, /^🗓 تخطيط الورشة/);
  assert.match(plain, /📌 المهام/);
  assert.match(plain, /• Book the room — Speaker 2/);
});
