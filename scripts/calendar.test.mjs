import { test } from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv, createECDH, createHmac, createPublicKey, randomBytes, verify } from "node:crypto";
import { cleanEvent, cleanPlace, dueReminders, parseMapLink, placeLinks, reminderText, zonedToUtc } from "../artifacts/api-server/src/lib/reminders.ts";
import { encryptPayload, makeVapidKeys, vapidHeader } from "../artifacts/api-server/src/lib/web-push.ts";

const at = (iso) => new Date(iso);

test("only the nearest overdue reminder is sent; the rest count as done", () => {
  const event = { startsAt: at("2026-10-14T10:00:00Z"), reminders: [10, 30, 1440], reminded: [] };
  assert.deepEqual(dueReminders(event, at("2026-10-13T09:00:00Z")), { send: null, done: [] });
  assert.deepEqual(dueReminders(event, at("2026-10-13T10:00:00Z")), { send: 1440, done: [1440] });
  // Made at the last minute: one reminder, not three.
  assert.deepEqual(dueReminders(event, at("2026-10-14T09:55:00Z")), { send: 10, done: [10, 30, 1440] });
  assert.deepEqual(dueReminders({ ...event, reminded: [1440] }, at("2026-10-14T09:31:00Z")), { send: 30, done: [30] });
  assert.deepEqual(dueReminders({ ...event, reminded: [10, 30, 1440] }, at("2026-10-14T09:59:00Z")), { send: null, done: [] });
  // Long past: nothing.
  assert.deepEqual(dueReminders({ ...event, reminders: [0] }, at("2026-10-14T11:00:00Z")), { send: null, done: [] });
  assert.deepEqual(dueReminders({ ...event, reminders: [0] }, at("2026-10-14T10:05:00Z")), { send: 0, done: [0] });
});

test("a local time in a time zone becomes the right moment, across daylight saving", () => {
  assert.equal(zonedToUtc("2026-10-14", "08:00", "Asia/Muscat").toISOString(), "2026-10-14T04:00:00.000Z");
  assert.equal(zonedToUtc("2026-07-01", "09:30", "Europe/London").toISOString(), "2026-07-01T08:30:00.000Z");
  assert.equal(zonedToUtc("2026-12-01", "09:30", "Europe/London").toISOString(), "2026-12-01T09:30:00.000Z");
  assert.equal(zonedToUtc("2026-01-15", "23:00", "America/New_York").toISOString(), "2026-01-16T04:00:00.000Z");
});

test("Google Maps links give the place's position and name", () => {
  assert.deepEqual(parseMapLink("https://www.google.com/maps/place/Muscat+Grand+Mall/@23.5880,58.3829,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d23.5885!4d58.3891"), { lat: 23.5885, lng: 58.3891, name: "Muscat Grand Mall" });
  assert.deepEqual(parseMapLink("https://www.google.com/maps/@23.61,58.54,15z"), { lat: 23.61, lng: 58.54 });
  assert.deepEqual(parseMapLink("https://maps.google.com/?q=23.6,58.5"), { lat: 23.6, lng: 58.5 });
  assert.deepEqual(parseMapLink("https://www.google.com/maps/search/?api=1&query=-33.86,151.21"), { lat: -33.86, lng: 151.21 });
  assert.equal(parseMapLink("https://www.google.com/maps/@123,58,15z"), null);
  assert.equal(parseMapLink("https://example.com/no-place"), null);
});

test("places are checked, and link to Google Maps and Google Earth", () => {
  assert.equal(cleanPlace({ name: "  " }), null);
  assert.equal(cleanPlace("Room 3"), null);
  assert.deepEqual(cleanPlace({ name: " Room   3 ", lat: "x" }), { name: "Room 3" });
  assert.deepEqual(cleanPlace({ name: "Office", address: "Way 12", lat: 23.1234567, lng: 58.7654321 }), { name: "Office", address: "Way 12", lat: 23.123457, lng: 58.765432 });
  assert.deepEqual(cleanPlace({ name: "Nowhere", lat: 95, lng: 10 }), { name: "Nowhere" });
  assert.deepEqual(placeLinks({ name: "Office", lat: 23.5, lng: 58.4 }), {
    maps: "https://www.google.com/maps/search/?api=1&query=23.5%2C58.4", earth: "https://earth.google.com/web/search/23.5,58.4",
  });
  assert.equal(placeLinks({ name: "Room 3" }).maps, "https://www.google.com/maps/search/?api=1&query=Room%203");
  assert.equal(placeLinks(null), null);
});

test("events are checked before saving", () => {
  assert.equal(cleanEvent({ title: "", startsAt: "2026-10-14T10:00:00Z" }), null);
  assert.equal(cleanEvent({ title: "x", startsAt: "soon" }), null);
  const event = cleanEvent({ title: " Budget  review ", startsAt: "2026-10-14T10:00:00Z", endsAt: "2026-10-14T09:00:00Z", reminders: [30, 30, 7, 1440, "10"], participants: ["Sara", " ", 5], location: { name: "Room 3" } });
  assert.equal(event.title, "Budget review");
  assert.equal(event.kind, "meeting");
  assert.equal(event.endsAt, null, "an end before the start is dropped");
  assert.deepEqual(event.reminders, [10, 30, 1440]);
  assert.deepEqual(event.participants, ["Sara"]);
  assert.deepEqual(event.location, { name: "Room 3" });
  assert.deepEqual(cleanEvent({ title: "x", startsAt: "2026-10-14T10:00:00Z" }).reminders, [30]);
  assert.equal(cleanEvent({ title: "x", kind: "event", startsAt: "2026-10-14T10:00:00Z" }).kind, "event");
});

test("reminders say when, where, and the agenda, in the event's language", () => {
  const start = at("2026-10-14T06:00:00Z");
  const event = { title: "Budget review", startsAt: start, allDay: false, kind: "meeting", location: { name: "Room 3", lat: 23.5, lng: 58.4 }, agenda: "Q4 numbers" };
  const soon = reminderText(event, at("2026-10-14T05:30:00Z"), "Asia/Muscat");
  assert.equal(soon.title, "In 30 min: Budget review");
  assert.match(soon.text, /📍 Room 3/);
  assert.match(soon.text, /google\.com\/maps/);
  assert.match(soon.text, /📝 Q4 numbers/);
  assert.match(reminderText(event, at("2026-10-14T04:00:00Z"), "Asia/Muscat").title, /^In 2 h, at 10:00 AM/);
  assert.match(reminderText(event, at("2026-10-14T06:00:00Z"), "Asia/Muscat").title, /^Now/);
  const arabic = reminderText({ ...event, title: "مراجعة الميزانية", location: null, agenda: "" }, at("2026-10-14T05:50:00Z"), "Asia/Muscat");
  assert.equal(arabic.title, "بعد 10 دقيقة: مراجعة الميزانية");
  assert.equal(arabic.body, "اضغط لفتح التقويم.");
});

// The browser's side of RFC 8291, to prove the phone can read what the server sends.
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();
function browserDecrypt(body, browser, auth) {
  const salt = body.subarray(0, 16);
  const keyLength = body[20];
  const serverPublic = body.subarray(21, 21 + keyLength);
  const shared = browser.computeSecret(serverPublic);
  const ikm = hmac(hmac(auth, shared), Buffer.concat([Buffer.from("WebPush: info\0"), browser.getPublicKey(), serverPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const key = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: aes128gcm\0"), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: nonce\0"), Buffer.from([1])])).subarray(0, 12);
  const sealed = body.subarray(21 + keyLength);
  const decipher = createDecipheriv("aes-128-gcm", key, nonce);
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  const plain = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
  assert.equal(plain[plain.length - 1], 2, "last-record padding marker");
  return plain.subarray(0, -1).toString();
}

test("push notifications are encrypted so only that phone can read them", () => {
  const browser = createECDH("prime256v1");
  browser.generateKeys();
  const auth = randomBytes(16);
  const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: browser.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } };
  const message = JSON.stringify({ title: "In 30 min: Budget review", body: "📍 Room 3", url: "/calendar" });
  const body = encryptPayload(Buffer.from(message), subscription);
  assert.equal(body.readUInt32BE(16), 4096);
  assert.equal(browserDecrypt(body, browser, auth), message);
  // Another phone can't.
  const other = createECDH("prime256v1");
  other.generateKeys();
  assert.throws(() => browserDecrypt(body, other, auth));
});

test("the VAPID header is a valid ES256 token for the push service", () => {
  const keys = makeVapidKeys();
  assert.equal(Buffer.from(keys.publicKey, "base64url").length, 65);
  const header = vapidHeader("https://fcm.googleapis.com/fcm/send/abc", keys, "mailto:me@example.com", Date.UTC(2026, 9, 14));
  const [, token, k] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, keys.publicKey);
  const [head, claims, signature] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(claims, "base64url")), { aud: "https://fcm.googleapis.com", exp: Date.UTC(2026, 9, 14) / 1000 + 12 * 3600, sub: "mailto:me@example.com" });
  const publicKey = createPublicKey({ key: { kty: "EC", crv: "P-256", x: keys.privateJwk.x, y: keys.privateJwk.y }, format: "jwk" });
  assert.ok(verify("sha256", Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")));
});
