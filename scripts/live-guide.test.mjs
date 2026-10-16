import { test } from "node:test";
import assert from "node:assert/strict";
import { hostStep, participantNudge, suggestTeamSize } from "../artifacts/idea-stream/src/lib/live-guide.ts";

const room = (session = {}, extra = {}) => ({
  session: { phase: "free", status: "open", teamCount: 0, challenge: "", votesPerPerson: 3, synthesis: null, ...session },
  people: [], cards: [], ...extra,
});
const done = (...steps) => new Set(steps);

test("the host goes step by step through the setup", () => {
  assert.equal(hostStep(room(), done()), "challenge");
  assert.equal(hostStep(room({ challenge: "How might we…" }), done()), "screen");
  assert.equal(hostStep(room({ challenge: "x" }), done("screen")), "join");
  assert.equal(hostStep(room({ challenge: "x" }), done("screen", "join")), "teams");
  assert.equal(hostStep(room({ challenge: "x", teamCount: 3 }), done("screen", "join")), "think", "teams already made");
  assert.equal(hostStep(room(), done("challenge", "screen", "join", "teams")), "think", "skipped steps count as done");
});

test("once the workshop runs, the room's step is the host's step", () => {
  for (const phase of ["think", "share", "vote", "build", "present"]) assert.equal(hostStep(room({ phase }), done()), phase);
  assert.equal(hostStep(room({ phase: "present" }), done("present")), "wrap");
  assert.equal(hostStep(room({ status: "ended" }), done()), "wrap");
  // Back to "open" after Share: carry on from the next step not done.
  assert.equal(hostStep(room({ challenge: "x", teamCount: 2 }), done("screen", "join", "think", "share")), "vote");
});

test("team sizes suit the room", () => {
  assert.deepEqual([3, 5, 8, 12, 20, 40, 100].map(suggestTeamSize), [3, 5, 3, 3, 4, 4, 5]);
});

const me = (cards, extra = {}) => ({ cards, me: { team: 2 }, votesUsed: 0, ...extra });
const card = (space, extra = {}) => ({ space, mine: true, votes: null, myVote: false, ...extra });

test("thinking alone: write in Me", () => {
  assert.match(participantNudge(room({ phase: "think" }, me([])), "me").en, /first idea/);
  assert.match(participantNudge(room({ phase: "think" }, me([card("me"), card("me")])), "me").en, /2 ideas/);
  assert.equal(participantNudge(room({ phase: "think" }, me([])), "all").go, "me");
});

test("sharing: share your best idea, then go to your team", () => {
  assert.match(participantNudge(room({ phase: "share" }, me([card("me")])), "me").en, /Share with my team/);
  assert.equal(participantNudge(room({ phase: "share" }, me([card("me")])), "team").go, "me");
  const shared = me([card("me"), card("team")]);
  assert.equal(participantNudge(room({ phase: "share" }, shared), "me").go, "team");
  assert.match(participantNudge(room({ phase: "share" }, shared), "team").en, /Build on this/);
  assert.match(participantNudge(room({ phase: "share" }, me([], { me: { team: null } })), "me").en, /putting people in teams/);
});

test("voting: dots left, then wait", () => {
  assert.match(participantNudge(room({ phase: "vote" }, me([], { votesUsed: 1 })), "team").en, /2 dots left/);
  assert.match(participantNudge(room({ phase: "vote" }, me([], { votesUsed: 3 })), "team").en, /All your dots/);
  assert.equal(participantNudge(room({ phase: "vote" }, me([])), "me").go, "team");
  assert.equal(participantNudge(room({ phase: "vote" }, me([], { me: { team: null } })), "me").go, "all");
});

test("other steps, the end, and Arabic", () => {
  assert.match(participantNudge(room({ phase: "build" }, me([])), "team").en, /Build on this/);
  assert.match(participantNudge(room({ phase: "present" }, me([])), "team").en, /big screen/);
  assert.match(participantNudge(room({ status: "ended" }, me([])), "me").en, /over/);
  assert.match(participantNudge(room({}, me([])), "me").en, /Start by writing/);
  assert.match(participantNudge(room({ phase: "vote" }, me([], { votesUsed: 1 })), "team").ar, /باقي 2/);
});

test("voting and building open the space with more ideas from others", async () => {
  const { bestTab } = await import("../artifacts/idea-stream/src/lib/live-guide.ts");
  const other = (space) => ({ space, mine: false, votes: null, myVote: false });
  assert.equal(bestTab(room({}, me([other("team"), other("team"), other("all")]))), "team");
  assert.equal(bestTab(room({}, me([other("team"), other("all"), other("all")]))), "all");
  assert.equal(bestTab(room({}, me([]))), "team", "a tie goes to the team");
  assert.equal(bestTab(room({}, me([other("team")], { me: { team: null } }))), "all");
  assert.equal(participantNudge(room({ phase: "vote" }, me([other("all")])), "me").go, "all");
});
