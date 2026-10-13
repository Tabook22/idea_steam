import { test } from "node:test";
import assert from "node:assert/strict";
import { hashtagTarget, looksLikeToken, onlyLink, parseCommand, reply } from "../artifacts/api-server/src/lib/telegram.ts";

test("bot tokens and commands are recognised", () => {
  assert.ok(looksLikeToken("123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"));
  assert.ok(!looksLikeToken("hello"));
  assert.ok(!looksLikeToken("123:short"));
  assert.deepEqual(parseCommand("/start abc123"), { command: "start", arg: "abc123" });
  assert.deepEqual(parseCommand("/notebooks@MyIdeasBot"), { command: "notebooks", arg: "" });
  assert.equal(parseCommand("just text"), null);
});

test("#tags file a message into a notebook (start of the name, any case, Arabic too)", () => {
  const subjects = [{ id: 1, title: "Idea inbox" }, { id: 2, title: "Video stories" }, { id: 3, title: "الفيزياء" }, { id: 4, title: "Physics lab" }];
  assert.deepEqual(hashtagTarget(subjects, "#video film the morning commute"), { subject: subjects[1], text: "film the morning commute" });
  assert.deepEqual(hashtagTarget(subjects, "#Physics_lab bring goggles").subject, subjects[3]);
  assert.deepEqual(hashtagTarget(subjects, "#فيزياء اقرأ الفصل الثالث"), { subject: subjects[2], text: "اقرأ الفصل الثالث" }, "the Arabic article ال doesn't matter");
  assert.deepEqual(hashtagTarget(subjects, "#idea not the inbox"), { subject: null, text: "#idea not the inbox" }, "the inbox isn't a target; unknown tags stay in the text");
  assert.deepEqual(hashtagTarget(subjects, "no tag here"), { subject: null, text: "no tag here" });
});

test("links and replies", () => {
  assert.ok(onlyLink("https://youtu.be/abc"));
  assert.ok(!onlyLink("see https://youtu.be/abc"));
  assert.match(reply("saved", { notebook: "Idea inbox" }), /Saved to «Idea inbox»/);
  assert.match(reply("saved", { notebook: "صندوق الأفكار", arabic: true }), /حُفظت في/);
  assert.match(reply("help", { notebooks: ["Video stories"] }), /#Video_stories/);
  assert.match(reply("private"), /private/);
});
