import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { scryptSync } from "node:crypto";
import { canSee, cleanName, makeCode, makeTeams, normalizeCode, smallestTeam } from "../artifacts/api-server/src/lib/live.ts";
import { privateAccess } from "../artifacts/api-server/src/lib/private-access.ts";

const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const express = require("express");

test("join codes are easy to read off a projector, and typing them is forgiving", () => {
  for (let i = 0; i < 200; i++) assert.match(makeCode(), /^[A-HJ-NP-Z]{3}[2-9]{3}$/);
  assert.equal(normalizeCode(" myc-482 "), "MYC482");
  assert.equal(normalizeCode(42), "");
});

test("names are tidied: spaces, control characters, length", () => {
  assert.equal(cleanName("  Sara \n  Ali\u0007 "), "Sara Ali");
  assert.equal(cleanName("x".repeat(80)).length, 40);
  assert.equal(cleanName("   "), "");
});

test("teams are random and even (sizes differ by at most one), late joiners go to the smallest", () => {
  const ids = Array.from({ length: 23 }, (_, i) => i + 1);
  const { count, teams } = makeTeams(ids, 5);
  assert.equal(count, 5);
  const sizes = [1, 2, 3, 4, 5].map((team) => [...teams.values()].filter((t) => t === team).length);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, sizes.join());
  assert.equal(teams.size, 23);
  assert.equal(makeTeams([1], 4).count, 1);
  assert.equal(smallestTeam([1, 1, 2, 3, 3], 3), 2);
  assert.equal(smallestTeam([1, 2], 3), 3, "an empty team first");
  assert.equal(smallestTeam([], 0), null, "no teams yet");
});

test("who sees what: private, team, everyone, hidden", () => {
  const sara = { kind: "participant", id: 1, team: 1 };
  const ali = { kind: "participant", id: 2, team: 1 };
  const omar = { kind: "participant", id: 3, team: 2 };
  const teacher = { kind: "instructor" };
  const card = (space, extra = {}) => ({ participantId: 1, space, team: space === "team" ? 1 : null, hidden: false, ...extra });
  // Private: only Sara, not even the instructor.
  assert.deepEqual([sara, ali, omar, teacher].map((viewer) => canSee(card("me"), viewer)), [true, false, false, false]);
  // Team: Sara's team and the instructor.
  assert.deepEqual([sara, ali, omar, teacher].map((viewer) => canSee(card("team"), viewer)), [true, true, false, true]);
  // Everyone.
  assert.deepEqual([sara, ali, omar, teacher].map((viewer) => canSee(card("all"), viewer)), [true, true, true, true]);
  // Hidden by the instructor: its author and the instructor only.
  assert.deepEqual([sara, ali, omar, teacher].map((viewer) => canSee(card("all", { hidden: true }), viewer)), [true, false, false, true]);
  // The instructor's own posts are for everyone.
  assert.equal(canSee({ participantId: null, space: "all", team: null, hidden: false }, omar), true);
  // Someone not in a team yet sees no team cards.
  assert.equal(canSee(card("team"), { kind: "participant", id: 9, team: null }), false);
});

test("the sign-in gate lets participants reach only the workshop: join page, app code, workshop API", async () => {
  const env = {
    APP_BASE_PATH: "/ideas",
    APP_ORIGIN: "https://nasserdiary.com",
    APP_USERNAME: "owner",
    APP_PASSWORD_HASH: `salt:${scryptSync("pw", "salt", 32).toString("hex")}`,
  };
  const app = express();
  app.use(privateAccess(env));
  app.all("/{*path}", (req, res) => res.send(`reached ${req.path}`));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const get = (path, headers = {}) => fetch(`${origin}${path}`, { redirect: "manual", headers: { "Sec-Fetch-Dest": "empty", ...headers } });
  try {
    for (const path of ["/join", "/join/MYC482", "/assets/index-AbC123.js", "/assets/index-x.css", "/api/live/MYC482", "/api/live/MYC482/state", "/api/live/MYC482/files/12"])
      assert.equal((await get(path, { Accept: "text/html" })).status, 200, path);
    const post = await fetch(`${origin}/api/live/MYC482/join`, { method: "POST", headers: { Origin: env.APP_ORIGIN, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(post.status, 200, "joining is allowed from the site itself");
    const foreign = await fetch(`${origin}/api/live/MYC482/join`, { method: "POST", headers: { Origin: "https://evil.example" }, body: "{}" });
    assert.equal(foreign.status, 403, "but not from another site");
    // Everything else still needs the owner's sign-in.
    for (const path of ["/api/live-admin/sessions", "/api/subjects", "/api/storage/objects/0f8fad5b-d9cb-469f-a165-70867728950e", "/api/livex", "/join/a/b"])
      assert.notEqual((await get(path)).status, 200, path);
    assert.equal((await get("/live/3", { Accept: "text/html", "Sec-Fetch-Mode": "navigate" })).status, 303, "the instructor pages ask for sign-in");
  } finally { server.close(); }
});

test("phase timers and dot voting rules", async () => {
  const { phaseEnd, canVote } = await import("../artifacts/api-server/src/lib/live.ts");
  assert.equal(phaseEnd(5, 0).getTime(), 300_000);
  assert.equal(phaseEnd(500, 0).getTime(), 120 * 60_000, "at most two hours");
  assert.equal(phaseEnd(0), null);
  assert.equal(phaseEnd("x"), null);
  const base = { phase: "vote", own: false, already: false, used: 0, allowed: 3 };
  assert.equal(canVote(base), null);
  assert.match(canVote({ ...base, phase: "share" }), /isn't open/);
  assert.match(canVote({ ...base, own: true }), /your own/);
  assert.match(canVote({ ...base, used: 3 }), /all your dots/);
  assert.equal(canVote({ ...base, used: 3, already: true }), null, "taking a dot back is always fine");
});

test("the AI's themes are checked: real ideas only, each in one theme", async () => {
  const { cleanSynthesis } = await import("../artifacts/api-server/src/lib/live.ts");
  const ids = new Set([1, 2, 3, 4]);
  const result = cleanSynthesis({
    summary: "Two directions.",
    themes: [{ title: "Buddies", summary: "Pairing.", cardIds: [1, 2, 99] }, { title: "Repeat", cardIds: [2] }, { title: "Events", summary: "Day one.", cardIds: ["3", 4] }],
    standouts: [{ cardId: 3, why: "Cheap and fun." }, { cardId: 42, why: "invented" }],
    gaps: ["Cost", "", "Families", "Transport", "too many"],
  }, ids);
  assert.deepEqual(result.themes.map((t) => [t.title, t.cardIds]), [["Buddies", [1, 2]], ["Events", [3, 4]]]);
  assert.deepEqual(result.standouts.map((s) => s.cardId), [3]);
  assert.deepEqual(result.gaps, ["Cost", "Families", "Transport"]);
  assert.equal(cleanSynthesis({}, ids), null);
});

test("the workshop report has the challenge, themes, top votes and every team", async () => {
  const { liveReportHtml } = await import("../artifacts/api-server/src/lib/live.ts");
  const html = liveReportHtml({
    title: "Welcome week", challenge: "How might we <help> newcomers?", date: new Date("2026-10-13"), people: 23, teamCount: 2,
    cards: [
      { id: 1, text: "Buddy system", author: "Sara", team: 1, space: "team", votes: 5 },
      { id: 2, text: "Treasure hunt", author: "Ali", team: 2, space: "team", votes: 2 },
      { id: 3, text: "Welcome map", author: "Mona", team: null, space: "all", votes: 0 },
    ],
    synthesis: { summary: "People want connection.", themes: [{ title: "Belonging", summary: "Pairing up.", cardIds: [1] }], standouts: [{ cardId: 2, why: "Fun." }], gaps: ["Families"] },
  });
  assert.match(html, /How might we &lt;help&gt; newcomers\?/);
  assert.match(html, /23 participants/);
  assert.match(html, /People want connection\./);
  assert.match(html, /Belonging/);
  assert.match(html, /Most votes<\/h2><ol><li>Buddy system/);
  assert.match(html, /Team 1<\/h2>/);
  assert.match(html, /Team 2<\/h2>/);
  assert.match(html, /Shared with everyone<\/h2><ul><li>Welcome map/);
});

test("Telegram can reach only the capture webhook (with its long secret), nothing else", async () => {
  const env = { APP_BASE_PATH: "/ideas", APP_ORIGIN: "https://nasserdiary.com", APP_USERNAME: "owner", APP_PASSWORD_HASH: `salt:${scryptSync("pw", "salt", 32).toString("hex")}` };
  const app = express();
  app.use(privateAccess(env));
  app.all("/{*path}", (_req, res) => res.send("reached"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const hook = await fetch(`${origin}/api/telegram/webhook/${"a1".repeat(24)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(hook.status, 200, "Telegram sends no Origin header and no sign-in");
    for (const path of ["/api/telegram", "/api/telegram/connect", "/api/telegram/webhook/short", "/api/telegram/webhook/" + "a1".repeat(24) + "/x"])
      assert.notEqual((await fetch(`${origin}${path}`, { method: "POST", headers: { "Sec-Fetch-Dest": "empty" } })).status, 200, path);
  } finally { server.close(); }
});
