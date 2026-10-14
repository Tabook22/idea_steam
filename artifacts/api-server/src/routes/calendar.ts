import { Router, type IRouter } from "express";
import { and, asc, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";
import { appSettingsTable, db, eventsTable, meetingsTable, pushSubscriptionsTable, tasksTable, type EventRecord } from "@workspace/db";
import { cleanEvent, dueReminders, parseMapLink, reminderText, zonedToUtc } from "../lib/reminders";
import { makeVapidKeys, sendPush, type VapidKeys } from "../lib/web-push";
import { telegramLinked, telegramToOwner } from "./telegram";

/**
 * The calendar: events (meetings to hold, anything else) with places and reminders; places found
 * through OpenStreetMap; reminders sent to the owner's Telegram and to phones with notifications on.
 */
const router: IRouter = Router();
const BASE = (process.env.APP_BASE_PATH || "").replace(/\/$/, "");

async function setting<T>(key: string): Promise<T | null> {
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, key));
  return (row?.value as T | undefined) ?? null;
}
async function saveSetting(key: string, value: Record<string, unknown>) {
  await db.insert(appSettingsTable).values({ key, value }).onConflictDoUpdate({ target: appSettingsTable.key, set: { value, updatedAt: new Date() } });
}
async function vapid() {
  const found = await setting<VapidKeys>("vapid");
  if (found) return found;
  const keys = makeVapidKeys();
  await saveSetting("vapid", keys as unknown as Record<string, unknown>);
  return keys;
}
const timezone = async () => (await setting<{ timezone?: string }>("calendar"))?.timezone || "Asia/Muscat";

/** A reminder to every place it can reach: Telegram, and phones with notifications on. */
export async function notify(message: { title: string; body: string; text: string; url: string }) {
  const results = { telegram: false, push: 0 };
  try { results.telegram = await telegramToOwner(message.text); } catch (error) { console.warn("Reminder: Telegram failed:", (error as Error).message); }
  const subscriptions = await db.select().from(pushSubscriptionsTable);
  if (subscriptions.length) {
    const keys = await vapid();
    for (const subscription of subscriptions) {
      try {
        const outcome = await sendPush({ endpoint: subscription.endpoint, keys: subscription.keys }, { title: message.title, body: message.body, url: message.url, tag: message.url }, keys);
        if (outcome === "gone") await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, subscription.endpoint));
        else results.push++;
      } catch (error) { console.warn("Reminder: push failed:", (error as Error).message); }
    }
  }
  return results;
}

const view = (event: EventRecord) => ({
  id: event.id, kind: event.kind, title: event.title, startsAt: event.startsAt.toISOString(), endsAt: event.endsAt?.toISOString() ?? null, allDay: event.allDay,
  location: event.location ?? null, subjectId: event.subjectId, participants: event.participants, agenda: event.agenda, notes: event.notes,
  reminders: event.reminders, meetingId: event.meetingId, createdAt: event.createdAt.toISOString(),
});
const range = (from: unknown, to: unknown) => {
  const start = typeof from === "string" ? new Date(from) : new Date(Date.now() - 31 * 86_400_000);
  const end = typeof to === "string" ? new Date(to) : new Date(Date.now() + 62 * 86_400_000);
  return Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) ? null : { start, end };
};

/** Everything dated between two moments: events, recorded meetings, and tasks with a due date. */
router.get("/calendar", async (req, res): Promise<void> => {
  const span = range(req.query.from, req.query.to);
  if (!span) { res.status(400).json({ error: "Unknown dates" }); return; }
  const events = await db.select().from(eventsTable).where(and(gte(eventsTable.startsAt, new Date(span.start.getTime() - 86_400_000)), lte(eventsTable.startsAt, span.end))).orderBy(asc(eventsTable.startsAt));
  const meetings = await db.select({ id: meetingsTable.id, title: meetingsTable.title, createdAt: meetingsTable.createdAt, location: meetingsTable.location, eventId: meetingsTable.eventId, subjectId: meetingsTable.subjectId, status: meetingsTable.status })
    .from(meetingsTable).where(and(gte(meetingsTable.createdAt, span.start), lte(meetingsTable.createdAt, span.end)));
  const tasks = await db.select({ id: tasksTable.id, text: tasksTable.text, due: tasksTable.due, time: tasksTable.time, done: tasksTable.done, person: tasksTable.person })
    .from(tasksTable).where(isNotNull(tasksTable.due));
  const from = span.start.toISOString().slice(0, 10), to = span.end.toISOString().slice(0, 10);
  res.json({
    events: events.map(view),
    meetings: meetings.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
    tasks: tasks.filter((task) => task.due! >= from && task.due! <= to),
    timezone: await timezone(),
  });
});

router.get("/events", async (req, res): Promise<void> => {
  const span = range(req.query.from, req.query.to);
  if (!span) { res.status(400).json({ error: "Unknown dates" }); return; }
  const events = await db.select().from(eventsTable).where(and(gte(eventsTable.startsAt, span.start), lte(eventsTable.startsAt, span.end))).orderBy(asc(eventsTable.startsAt));
  res.json(events.map(view));
});

router.post("/events", async (req, res): Promise<void> => {
  const event = cleanEvent(req.body);
  if (!event) { res.status(400).json({ error: "Give it a title and a start time." }); return; }
  const [saved] = await db.insert(eventsTable).values(event).returning();
  res.status(201).json(view(saved!));
});

router.get("/events/:id", async (req, res): Promise<void> => {
  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, Number(req.params.id)));
  if (!event) { res.status(404).json({ error: "Event not found" }); return; }
  res.json(view(event));
});

router.put("/events/:id", async (req, res): Promise<void> => {
  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, Number(req.params.id)));
  const next = cleanEvent(req.body);
  if (!event || !next) { res.status(event ? 400 : 404).json({ error: event ? "Give it a title and a start time." : "Event not found" }); return; }
  // A new time (or new reminders) means the reminders go out again.
  const reset = event.startsAt.getTime() !== next.startsAt.getTime() || JSON.stringify(event.reminders) !== JSON.stringify(next.reminders);
  const [saved] = await db.update(eventsTable).set({ ...next, ...(reset ? { reminded: [] } : {}) }).where(eq(eventsTable.id, event.id)).returning();
  res.json(view(saved!));
});

router.delete("/events/:id", async (req, res): Promise<void> => {
  await db.delete(eventsTable).where(eq(eventsTable.id, Number(req.params.id)));
  res.sendStatus(204);
});

/* ------------------------------ Places ------------------------------ */

const OSM = () => (process.env.PLACES_API || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
const osmHeaders = { "User-Agent": "IdeaStream/1.0 (private notebook)", "Accept-Language": "ar,en" };
type OsmPlace = { display_name: string; lat: string; lon: string; name?: string };
const toPlace = (found: OsmPlace) => ({ name: found.name || found.display_name.split(",")[0]!.trim(), address: found.display_name, lat: Number(found.lat), lng: Number(found.lon) });

router.get("/places", async (req, res): Promise<void> => {
  const query = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 200) : "";
  if (query.length < 2) { res.json([]); return; }
  try {
    const response = await fetch(`${OSM()}/search?format=jsonv2&limit=6&q=${encodeURIComponent(query)}`, { headers: osmHeaders, signal: AbortSignal.timeout(10_000) });
    res.json(((await response.json()) as OsmPlace[]).map(toPlace));
  } catch { res.status(502).json({ error: "Place search is unavailable right now." }); }
});

router.get("/places/reverse", async (req, res): Promise<void> => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) { res.status(400).json({ error: "Unknown position" }); return; }
  try {
    const response = await fetch(`${OSM()}/reverse?format=jsonv2&lat=${lat}&lon=${lng}`, { headers: osmHeaders, signal: AbortSignal.timeout(10_000) });
    const found = (await response.json()) as OsmPlace;
    res.json(found?.display_name ? { ...toPlace(found), lat, lng } : { name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng });
  } catch { res.json({ name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng }); }
});

/** A Google Maps link (short ones are followed) as a place. */
router.get("/places/link", async (req, res): Promise<void> => {
  let url = typeof req.query.url === "string" ? req.query.url.trim() : "";
  if (!/^https?:\/\/[^\s]+$/i.test(url)) { res.status(400).json({ error: "Paste a map link." }); return; }
  for (let hop = 0; hop < 5 && !parseMapLink(url); hop++) {
    const host = new URL(url).hostname;
    if (!/(^|\.)(goo\.gl|google\.[a-z.]+|app\.goo\.gl)$/.test(host)) break;
    try {
      const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8_000) });
      const next = response.headers.get("location");
      if (!next) break;
      url = new URL(next, url).toString();
    } catch { break; }
  }
  const found = parseMapLink(url);
  if (!found) { res.status(422).json({ error: "No position found in that link. Use “Share → Copy link” in Google Maps." }); return; }
  res.json({ name: found.name || `${found.lat.toFixed(5)}, ${found.lng.toFixed(5)}`, lat: found.lat, lng: found.lng });
});

/* ------------------------------ Reminders ------------------------------ */

router.get("/reminders/status", async (_req, res): Promise<void> => {
  const devices = await db.select({ endpoint: pushSubscriptionsTable.endpoint, device: pushSubscriptionsTable.device }).from(pushSubscriptionsTable);
  res.json({ telegram: await telegramLinked(), pushKey: (await vapid()).publicKey, devices: devices.map((d) => ({ endpoint: d.endpoint, device: d.device })), timezone: await timezone() });
});
router.post("/reminders/timezone", async (req, res): Promise<void> => {
  const tz = typeof req.body?.timezone === "string" ? req.body.timezone : "";
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); } catch { res.status(400).json({ error: "Unknown time zone" }); return; }
  await saveSetting("calendar", { timezone: tz });
  res.json({ timezone: tz });
});
router.post("/reminders/push", async (req, res): Promise<void> => {
  const sub = req.body?.subscription;
  if (typeof sub?.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) || typeof sub?.keys?.p256dh !== "string" || typeof sub?.keys?.auth !== "string") { res.status(400).json({ error: "Unknown subscription" }); return; }
  const device = typeof req.body?.device === "string" ? req.body.device.slice(0, 120) : "";
  await db.insert(pushSubscriptionsTable).values({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, device })
    .onConflictDoUpdate({ target: pushSubscriptionsTable.endpoint, set: { keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, device } });
  res.json({ ok: true });
});
router.delete("/reminders/push", async (req, res): Promise<void> => {
  if (typeof req.body?.endpoint === "string") await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, req.body.endpoint));
  res.json({ ok: true });
});
router.post("/reminders/test", async (_req, res): Promise<void> => {
  const result = await notify({ title: "🔔 Idea Stream", body: "Reminders work on this device. / التذكيرات تعمل.", text: "🔔 Reminders work. You'll get your meetings and tasks here. / التذكيرات تعمل.", url: `${BASE}/calendar` });
  res.json(result);
});

/** Every half minute: event reminders that are due, and tasks reaching their due time. */
let checking = false;
export async function checkReminders(now = new Date()) {
  if (checking) return;
  checking = true;
  try {
    const tz = await timezone();
    const soon = await db.select().from(eventsTable).where(and(gte(eventsTable.startsAt, new Date(now.getTime() - 30 * 60_000)), lte(eventsTable.startsAt, new Date(now.getTime() + 3 * 86_400_000))));
    for (const event of soon) {
      const { send, done } = dueReminders(event, now);
      if (send === null) continue;
      await db.update(eventsTable).set({ reminded: [...event.reminded, ...done] }).where(eq(eventsTable.id, event.id));
      await notify({ ...reminderText(event, now, tz), url: `${BASE}/calendar?event=${event.id}` });
    }
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
    const tasks = await db.select().from(tasksTable).where(and(eq(tasksTable.done, false), isNull(tasksTable.remindedAt), isNotNull(tasksTable.due), lte(tasksTable.due, today)));
    for (const task of tasks) {
      // A task without a time is reminded at 8:00 on its day.
      const at = zonedToUtc(task.due!, task.time || "08:00", tz);
      if (at > now) continue;
      await db.update(tasksTable).set({ remindedAt: now }).where(eq(tasksTable.id, task.id));
      if (now.getTime() - at.getTime() > 2 * 3600_000) continue;
      const ar = /[؀-ۿ]/.test(task.text);
      const text = `✅ ${ar ? "مهمة مستحقة" : "Task due"}${task.time ? ` ${task.time}` : ""}: ${task.text}${task.person ? ` (${task.person})` : ""}`;
      await notify({ title: text, body: ar ? "اضغط لفتح المهام." : "Tap to open your tasks.", text, url: `${BASE}/tasks` });
    }
  } catch (error) {
    console.warn("Reminders check failed:", (error as Error).message);
  } finally { checking = false; }
}
if (process.env.NODE_ENV !== "test") setInterval(() => void checkReminders(), 30_000).unref?.();

export default router;
