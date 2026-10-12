import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanRichHtml, richToPlain, sameWords } from "../artifacts/api-server/src/lib/rich-html.ts";

test("formatted notes are made safe but keep their formatting", () => {
  const html = cleanRichHtml(`<p style="text-align: center; position: fixed">Title <b onclick="x()">bold</b> <i>it</i> <u>under</u></p><script>alert(1)</script><hr><ul><li>one</li></ul><p style="margin-left: 2em">in</p><img src="/ideas/api/storage/objects/abc" onerror="x()"><a href="javascript:alert(1)">bad</a><iframe src="x"></iframe>`);
  assert.match(html, /<p style="text-align:center">Title <b>bold<\/b> <i>it<\/i> <u>under<\/u><\/p>/);
  assert.match(html, /<hr \/>|<hr>/);
  assert.match(html, /<ul><li>one<\/li><\/ul>/);
  assert.match(html, /margin-left:2em/);
  assert.match(html, /<img src="\/ideas\/api\/storage\/objects\/abc" \/>/);
  assert.doesNotMatch(html, /script|onclick|onerror|javascript|iframe|position/);
});

test("its words become plain text: paragraphs, list items, lines", () => {
  const plain = richToPlain("<h2>Plan</h2><p>Use <b>clean</b> data &amp; check&nbsp;facts.</p><ul><li>Salalah</li><li>Mirbat</li></ul><hr><p>End</p>");
  assert.equal(plain, "Plan\nUse clean data & check facts.\n\n• Salalah\n\n• Mirbat\n\nEnd");
  assert.equal(richToPlain("<p>نص <strong>عربي</strong></p>"), "نص عربي");
});

test("formatting is shown only while it still matches the words", () => {
  assert.ok(sameWords("<p>Hello <b>world</b></p>", "Hello world"));
  assert.ok(!sameWords("<p>Hello <b>world</b></p>", "Hello world, edited elsewhere"));
});
