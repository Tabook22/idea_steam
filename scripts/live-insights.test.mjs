import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInsights, evenness, timeline } from "../artifacts/api-server/src/lib/live-insights.ts";

const t = (minute) => new Date(Date.UTC(2026, 9, 16, 9, minute));
const people = [
  { id: 1, name: "Sara", emoji: "🦊", team: 1, createdAt: t(0) },
  { id: 2, name: "Ali", emoji: "🐼", team: 1, createdAt: t(0) },
  { id: 3, name: "Lina", emoji: "🦉", team: 2, createdAt: t(0) },
  { id: 4, name: "Omar", emoji: "🚀", team: 2, createdAt: t(0) },
  { id: 5, name: "Quiet", emoji: "🙂", team: 2, createdAt: t(0) },
];
const card = (id, participantId, space, team, extra = {}) => ({ id, participantId, space, team, text: `idea ${id}`, parentId: null, hidden: false, createdAt: t(id), ...extra });
const cards = [
  card(1, 1, "team", 1),
  card(2, 1, "all", 1),
  card(3, 2, "me", null),
  card(4, 3, "all", 2),
  card(5, 3, "team", 2, { parentId: 2 }), // Lina builds on Sara's idea (another team)
  card(6, 4, "team", 2, { hidden: true }),
  card(7, 1, "me", null),
  card(8, 1, "me", null),
];
const comments = [
  { id: 1, cardId: 1, participantId: 2, text: "yes", createdAt: t(10) },
  { id: 2, cardId: 2, participantId: 3, text: "nice", createdAt: t(11) },
  { id: 3, cardId: 6, participantId: 1, text: "on a hidden idea", createdAt: t(12) },
];
const reactions = [{ cardId: 4, participantId: 1, emoji: "💡", createdAt: t(13) }, { cardId: 1, participantId: 0, emoji: "👍", createdAt: t(14) }];
const votes = [{ cardId: 2, participantId: 3, createdAt: t(15) }, { cardId: 2, participantId: 4, createdAt: t(16) }, { cardId: 4, participantId: 2, createdAt: t(17) }];
const insights = buildInsights(people, cards, comments, reactions, votes, 2, t(20));
const member = (id) => insights.members.find((m) => m.id === id);
const team = (n) => insights.teams.find((x) => x.team === n);

test("each member's contribution, counted once and only where it shows", () => {
  assert.deepEqual(
    [member(1).ideas, member(1).privateIdeas, member(1).comments, member(1).reactions, member(1).votes],
    [2, 2, 0, 1, 0], "Sara: 2 shared ideas, 2 private, a reaction; her comment on a hidden idea doesn't count");
  assert.deepEqual([member(3).ideas, member(3).builds, member(3).comments, member(3).votes], [1, 1, 1, 1], "Lina's build-on is a build, not a new idea");
  assert.equal(member(4).ideas, 0, "a hidden idea doesn't count");
  assert.equal(member(2).privateIdeas, 1);
});

test("impact: what others did with your ideas (never your own votes or comments)", () => {
  assert.deepEqual([member(1).votesReceived, member(1).commentsReceived, member(1).buildsReceived, member(1).reactionsReceived], [2, 2, 1, 0],
    "the host's reaction (participant 0) isn't a member's");
  assert.equal(member(1).impact, 2 * 2 + 2 * 1 + 1 * 2);
  assert.equal(member(3).votesReceived, 1);
});

test("effort points are as shown to the host", () => {
  // Sara: 2 ideas ×3 + 2 private ×1 + 1 reaction ×1
  assert.equal(member(1).effort, 6 + 2 + 1);
  // Lina: 1 idea ×3 + 1 build ×3 + 1 comment ×2 + 1 vote ×1
  assert.equal(member(3).effort, 3 + 3 + 2 + 1);
});

test("help across teams, given and received", () => {
  assert.equal(member(3).helpsOtherTeams, 3, "Lina: a build, a comment and a vote on team 1's ideas");
  assert.equal(member(1).helpsOtherTeams, 1, "Sara: a reaction on team 2's idea");
  assert.equal(team(1).helpsGiven, 2, "Sara's reaction and Ali's vote");
  assert.equal(team(1).helpsReceived, 4, "Lina's build, comment and vote, and Omar's vote");
  assert.equal(team(2).helpsReceived, 2);
});

test("teams compared: totals, per person, participation and the top idea", () => {
  assert.deepEqual([team(1).ideas, team(1).privateIdeas, team(1).votesReceived], [2, 3, 2]);
  assert.equal(team(1).effortPerPerson, (member(1).effort + member(2).effort) / 2);
  assert.equal(team(2).participation, 0.67, "Quiet did nothing yet: 2 of 3");
  assert.equal(team(1).topCardId, 2);
  assert.equal(team(2).topCardId, 4);
});

test("evenness: everyone equal is 1, one person doing everything is 0", () => {
  assert.equal(evenness([5, 5, 5]), 1);
  assert.equal(evenness([9, 0, 0]), 0);
  assert.equal(evenness([0, 0]), 1, "nothing yet isn't uneven");
  assert.ok(evenness([6, 3, 3]) > 0.4 && evenness([6, 3, 3]) < 0.9);
});

test("activity over time, in equal slices", () => {
  assert.deepEqual(timeline([t(0), t(1), t(5), t(10)], t(0), t(12), 4), [2, 1, 0, 1]);
  assert.deepEqual(timeline([], t(0), t(12), 3), [0, 0, 0]);
  assert.equal(insights.timeline.length, 12);
  assert.equal(insights.timeline.reduce((a, b) => a + b, 0), insights.members.reduce((sum, m) => sum + m.ideas + m.builds + m.privateIdeas + m.comments + m.reactions + m.votes, 0));
});
