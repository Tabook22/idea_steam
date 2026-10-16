import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPulse, crossTeamHelps, keywords, lastActivity, pulseFeed, roomLinks, similarRooms } from "../artifacts/api-server/src/lib/live-pulse.ts";

const t = (minute) => new Date(Date.UTC(2026, 9, 16, 9, minute));
const people = [
  { id: 1, name: "Sara", emoji: "🦊", team: 1, createdAt: t(0) },
  { id: 2, name: "Ahmed", emoji: "🐼", team: 1, createdAt: t(0) },
  { id: 3, name: "Lina", emoji: "🦉", team: 2, createdAt: t(1) },
  { id: 4, name: "Omar", emoji: "🚀", team: 3, createdAt: t(1) },
  { id: 5, name: "Late", emoji: "🙂", team: null, createdAt: t(2) },
];
const card = (id, participantId, space, team, text, extra = {}) => ({ id, participantId, space, team, text, parentId: null, hidden: false, createdAt: t(id), ...extra });
const cards = [
  card(1, 1, "team", 1, "Solar panels on the school roof to cut electricity bills"),
  card(2, 3, "team", 2, "Rooftop solar panels and a battery for the school"),
  card(3, 4, "all", 3, "A weekly market for local farmers"),
  card(4, 2, "me", null, "My secret idea about solar panels"),
  card(5, 4, "team", 3, "Hidden thing", { hidden: true }),
  card(6, 3, "team", 2, "Add a small wind turbine too", { parentId: 1 }),
];
const comments = [
  { id: 1, cardId: 1, participantId: 3, text: "Great, we could share the battery", createdAt: t(10) },
  { id: 2, cardId: 1, participantId: 2, text: "Same team comment", createdAt: t(11) },
  { id: 3, cardId: 4, participantId: 3, text: "on a private card", createdAt: t(9) },
  { id: 4, cardId: 5, participantId: 1, text: "on a hidden card", createdAt: t(13) },
];
const reactions = [
  { cardId: 3, participantId: 1, emoji: "💡", createdAt: t(14) },
  { cardId: 3, participantId: 0, emoji: "👍", createdAt: t(15) },
  { cardId: 1, participantId: 1, emoji: "👍", createdAt: t(16) },
];
const votes = [{ cardId: 2, participantId: 4, createdAt: t(17) }, { cardId: 2, participantId: 5, createdAt: t(18) }];

test("help across teams counts comments, reactions, votes and build-ons; never private or hidden cards", () => {
  const helps = crossTeamHelps(people, cards, comments, reactions, votes);
  assert.deepEqual(helps.map((h) => `${h.personId}:${h.from}->${h.to}:${h.kind}`).sort(), [
    "1:1->3:reaction", "3:2->1:build", "3:2->1:comment", "4:3->2:vote",
  ]);
});

test("lines between teams join both directions, strongest first, with who helped", () => {
  const links = roomLinks(crossTeamHelps(people, cards, comments, reactions, votes));
  assert.deepEqual(links[0], { a: 1, b: 2, count: 2, people: [3], kinds: { comment: 1, build: 1 } });
  assert.equal(links.length, 3);
  assert.deepEqual(roomLinks([]), []);
});

test("keywords skip small words and match Arabic with or without ال", () => {
  assert.deepEqual([...keywords("The Solar panels for the school!")].sort(), ["panel", "school", "solar"]);
  assert.deepEqual([...keywords("الطاقة الشمسية في المدرسة")].sort(), [...keywords("طاقه شمسيه للمدرسة")].sort());
});

test("teams with similar ideas are found by their shared words", () => {
  const similar = similarRooms(people, cards);
  assert.equal(similar.length, 1);
  assert.equal(similar[0].a, 1);
  assert.equal(similar[0].b, 2);
  assert.ok(similar[0].words.includes("solar") && similar[0].words.includes("school"), similar[0].words.join());
  // A private idea about solar panels doesn't make team 1 look like anyone.
  assert.deepEqual(similarRooms(people, [cards[1], cards[3]]), []);
});

test("words every team uses don't make teams look alike", () => {
  const many = [1, 2, 3, 4].map((team) => card(10 + team, null, "team", team, `school garden project ${["robots coding", "robots coding", "music choir", "sports football"][team - 1]}`));
  const pairs = similarRooms(people, many);
  assert.deepEqual(pairs.map((p) => `${p.a}-${p.b}:${p.words.join(",")}`), ["1-2:coding,robot"]);
});

test("the feed is newest first, without private or hidden things", () => {
  const feed = pulseFeed(people, cards, comments, reactions, votes);
  assert.equal(feed[0].kind, "vote");
  assert.equal(feed[0].personId, 5);
  assert.ok(!feed.some((e) => e.text.includes("secret") || e.text.includes("private") || e.text.includes("hidden")));
  const build = feed.find((e) => e.kind === "build");
  assert.deepEqual([build.team, build.toTeam, build.text], [2, 1, "Add a small wind turbine too"]);
  assert.equal(feed.find((e) => e.kind === "comment" && e.personId === 2).toTeam, null, "same-team comments aren't 'help'");
  assert.equal(feed.filter((e) => e.kind === "join").length, 5);
});

test("an idea shared later appears when it was shared", () => {
  const shared = card(7, 2, "team", 1, "Moved from Me", { createdAt: t(1), updatedAt: t(30) });
  assert.equal(pulseFeed(people, [shared], [], [], [])[0].at, t(30).toISOString());
});

test("each team's last activity, including private writing (when, never what)", () => {
  const last = lastActivity(people, cards, comments, reactions, votes);
  assert.equal(last[1], t(16).toISOString());
  assert.equal(last[2], t(10).toISOString());
  assert.equal(last[3], t(17).toISOString());
  assert.equal(lastActivity(people, [card(9, 2, "me", null, "x", { createdAt: t(40) })], [], [], [])[1], t(40).toISOString());
});

test("everything together", () => {
  const pulse = buildPulse(people, cards, comments, reactions, votes);
  assert.deepEqual(Object.keys(pulse), ["links", "helps", "similar", "feed", "lastActivity"]);
  assert.equal(pulse.helps[0].kind, "vote");
});

const view = await import("../artifacts/idea-stream/src/lib/live-pulse-view.ts");
test("teams sit around a ring inside the screen, never overlapping its edges", () => {
  assert.deepEqual(view.ringLayout(1), [{ x: 50, y: 50 }]);
  const two = view.ringLayout(2);
  assert.ok(two[0].x < 50 && two[1].x > 50 && Math.abs(two[0].y - 50) < 0.01, "two teams: left and right");
  for (const n of [3, 4, 6, 8, 12]) {
    const { w, h } = view.tileSize(n);
    const spots = view.ringLayout(n);
    assert.equal(spots.length, n);
    assert.ok(spots[0].x === 50 && spots[0].y < 50, "the first at the top");
    for (const s of spots) assert.ok(s.x - w / 2 >= 0 && s.x + w / 2 <= 100 && s.y - h / 2 >= 0 && s.y + h / 2 <= 100, `${n}: ${JSON.stringify(s)}`);
  }
});

test("a team is active, quiet or waiting by its last activity", () => {
  const now = Date.parse("2026-10-16T09:30:00Z");
  assert.equal(view.roomStatus("2026-10-16T09:29:00Z", now), "active");
  assert.equal(view.roomStatus("2026-10-16T09:25:00Z", now), "quiet");
  assert.equal(view.roomStatus("2026-10-16T09:00:00Z", now), "waiting");
  assert.equal(view.roomStatus(undefined, now), "waiting");
  assert.equal(view.ago("2026-10-16T09:29:55Z", now), "now");
  assert.equal(view.ago("2026-10-16T09:27:00Z", now), "3m");
  assert.deepEqual(view.tourOrder([1, 2, 3], { 2: "2026-10-16T09:29:00Z", 3: "2026-10-16T09:20:00Z" }), [0, 2, 3, 1]);
});

test("team tiles never overlap, for 2 to 16 teams", () => {
  for (let n = 2; n <= 16; n++) {
    const { w, h } = view.tileSize(n);
    const spots = view.ringLayout(n);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const apart = Math.abs(spots[i].x - spots[j].x) >= w || Math.abs(spots[i].y - spots[j].y) >= h;
      assert.ok(apart, `${n} teams: ${i} and ${j} overlap`);
    }
  }
});

test("line badges sit off the tiles when there's room along the line", () => {
  const spots = view.ringLayout(8), size = view.tileSize(8);
  const onTile = (p) => spots.some((s) => Math.abs(s.x - p.x) < size.w / 2 && Math.abs(s.y - p.y) < size.h / 2);
  let off = 0, total = 0;
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) { total++; if (!onTile(view.badgeSpot(spots[i], spots[j], spots, size))) off++; }
  assert.equal(off, total, `${off} of ${total}`);
  assert.deepEqual(view.badgeSpot({ x: 0, y: 50 }, { x: 100, y: 50 }, [], size), { x: 50, y: 50 });
});
