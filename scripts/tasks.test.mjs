import { test } from "node:test";
import assert from "node:assert/strict";
import { locateQuote, parseTasks, sameTask, taskPrompt } from "../artifacts/api-server/src/lib/tasks.ts";
import { addDays, calendarFile, groupOf, groupTasks } from "../artifacts/idea-stream/src/lib/task-dates.ts";

test("the AI's tasks are checked: real text, valid dates and times only", () => {
  const tasks = parseTasks({ tasks: [
    { text: "  Ask the school to cover the projector ", due: "2026-10-08", time: "09:30", person: "Sara", quote: "ask the school to cover" },
    { text: "Book room", due: "next Thursday", time: "25:00" },
    { text: "x" },
    "nonsense",
    { text: "اتصل بسارة", due: "2026-02-30", time: "10:00" },
  ] });
  assert.equal(tasks.length, 3);
  assert.deepEqual(tasks[0], { text: "Ask the school to cover the projector", due: "2026-10-08", time: "09:30", person: "Sara", quote: "ask the school to cover" });
  assert.deepEqual([tasks[1].due, tasks[1].time], [null, null], "a date the AI wrote in words is dropped, and a time without a date too");
  assert.equal(tasks[2].text, "اتصل بسارة");
  assert.deepEqual(parseTasks({}), []);
  assert.deepEqual(parseTasks(null), []);
  assert.equal(parseTasks({ tasks: Array.from({ length: 20 }, (_, i) => ({ text: `Task number ${i}` })) }).length, 10);
});

test("the prompt tells the AI which day the note was recorded", () => {
  const prompt = taskPrompt(new Date("2026-10-07T09:00:00Z"));
  assert.match(prompt, /Wednesday 2026-10-07/);
  assert.match(prompt, /SAME language/);
});

test("the moment a task was said is found exactly from word timings", () => {
  const words = "So we need to ask the school to cover the projector okay".split(" ").map((word, i) => ({ word, start: i * 0.5 + 10, end: i * 0.5 + 10.3 }));
  assert.equal(locateQuote("Ask the school, to cover", null, words, 30), 10 + 4 * 0.5 - 1.5);
  assert.equal(locateQuote("nothing like this", null, words, 30), null);
});

test("without timings, the moment is estimated from where the words sit in the text", () => {
  const transcript = `${"word ".repeat(50)}call Sara about the budget ${"word ".repeat(50)}`;
  const at = locateQuote("call Sara about", transcript, null, 100);
  assert.ok(at > 40 && at < 50, `about halfway (${at})`);
  assert.equal(locateQuote(null, transcript, null, 100), null);
});

test("the same task said again isn't added twice", () => {
  assert.ok(sameTask("Ask the school to cover the projector.", "ask the school to cover the projector"));
  assert.ok(!sameTask("Ask the school", "Ask the teacher"));
});

test("tasks are grouped by when they're due", () => {
  const today = "2026-10-07";
  const task = (id, due, done = false) => ({ id, text: `t${id}`, due, time: null, done });
  assert.equal(groupOf(task(1, "2026-10-06"), today), "overdue");
  assert.equal(groupOf(task(2, today), today), "today");
  assert.equal(groupOf(task(3, addDays(today, 7)), today), "week");
  assert.equal(groupOf(task(4, addDays(today, 8)), today), "later");
  assert.equal(groupOf(task(5, null), today), "someday");
  assert.equal(groupOf(task(6, "2026-10-01", true), today), "done");
  const groups = groupTasks([task(7, "2026-10-12"), task(8, "2026-10-09"), task(9, "2026-10-09", true), task(10, "2026-10-01", true)], today);
  assert.deepEqual(groups.week.map((t) => t.id), [8, 7]);
  assert.deepEqual(groups.done.map((t) => t.id), [10, 9]);
});

test("calendar files: all-day with a 9:00 reminder, or timed with a 15-minute reminder", () => {
  const ics = calendarFile([
    { id: 1, text: "Call Sara, about budget", due: "2026-10-08", time: null, done: false, person: "Sara" },
    { id: 2, text: "Book room", due: "2026-10-09", time: "14:30", done: false },
    { id: 3, text: "Done already", due: "2026-10-09", time: null, done: true },
    { id: 4, text: "No date", due: null, time: null, done: false },
  ], new Date("2026-10-07T10:00:00Z"));
  assert.match(ics, /BEGIN:VCALENDAR\r\n/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2);
  assert.match(ics, /SUMMARY:Call Sara\\, about budget/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261008\r\nDTEND;VALUE=DATE:20261009/);
  assert.match(ics, /TRIGGER:PT9H/);
  assert.match(ics, /DTSTART:20261009T143000\r\nDTEND:20261009T153000/);
  assert.match(ics, /TRIGGER:-PT15M/);
  assert.match(ics, /DTSTAMP:20261007T100000Z/);
});
