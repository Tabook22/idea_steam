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
