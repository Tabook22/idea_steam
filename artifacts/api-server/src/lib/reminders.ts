/**
 * The calendar's rules, free of the database: which reminders are due, what they say, places and
 * map links (Google Maps and Google Earth), and turning a local date and time into a moment.
 */
import type { Place } from "@workspace/db";

export const REMINDER_CHOICES = [0, 5, 10, 15, 30, 60, 120, 1440, 2880];

/**
 * Reminders to send now for an event. When several are overdue at once (an event made at the last
 * minute), only the nearest is sent and the rest count as done. Nothing for events long past.
 */
export function dueReminders(event: { startsAt: Date; reminders: number[]; reminded: number[] }, now = new Date()) {
  const start = event.startsAt.getTime();
  if (now.getTime() - start > 30 * 60_000) return { send: null as number | null, done: [] as number[] };
  const overdue = event.reminders.filter((minutes) => !event.reminded.includes(minutes) && start - minutes * 60_000 <= now.getTime());
  if (!overdue.length) return { send: null, done: [] };
  return { send: Math.min(...overdue), done: overdue };
}

const time = (date: Date, tz: string, ar: boolean) => new Intl.DateTimeFormat(ar ? "ar" : "en", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(date);
const day = (date: Date, tz: string, ar: boolean) => new Intl.DateTimeFormat(ar ? "ar" : "en", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(date);

/** "⏰ In 30 min: Budget review · 10:00 · Room 3", in the event's language. */
export function reminderText(event: { title: string; startsAt: Date; allDay: boolean; location: Place | null; kind: string; agenda?: string }, now: Date, tz: string) {
  const ar = /[؀-ۿ]/.test(event.title);
  const t = (en: string, arabic: string) => (ar ? arabic : en);
  const minutes = Math.round((event.startsAt.getTime() - now.getTime()) / 60_000);
  const when = event.allDay ? t("Today", "اليوم")
    : minutes <= 1 ? t("Now", "الآن")
    : minutes < 60 ? t(`In ${minutes} min`, `بعد ${minutes} دقيقة`)
    : minutes < 24 * 60 ? t(`In ${Math.round(minutes / 60)} h, at ${time(event.startsAt, tz, ar)}`, `بعد ${Math.round(minutes / 60)} ساعة، الساعة ${time(event.startsAt, tz, ar)}`)
    : `${day(event.startsAt, tz, ar)} · ${time(event.startsAt, tz, ar)}`;
  const icon = event.kind === "meeting" ? "📅" : "⏰";
  const lines = [`${icon} ${when}: ${event.title}`];
  if (event.location?.name) lines.push(`📍 ${event.location.name}`);
  const links = placeLinks(event.location);
  if (links) lines.push(links.maps);
  if (event.agenda?.trim()) lines.push(`📝 ${event.agenda.trim().slice(0, 300)}`);
  return { title: `${when}: ${event.title}`, body: lines.slice(1).join("\n") || t("Tap to open the calendar.", "اضغط لفتح التقويم."), text: lines.join("\n") };
}

/** Google Maps and Google Earth links for a place (by position, or by name). */
export function placeLinks(place: Place | null | undefined) {
  if (!place) return null;
  const hasPoint = typeof place.lat === "number" && typeof place.lng === "number";
  const query = hasPoint ? `${place.lat},${place.lng}` : (place.address || place.name || "").trim();
  if (!query) return null;
  return {
    maps: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
    earth: hasPoint ? `https://earth.google.com/web/search/${place.lat},${place.lng}` : `https://earth.google.com/web/search/${encodeURIComponent(query)}`,
  };
}

const coordinate = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** The position (and place name) in a Google Maps link, if it has one. */
export function parseMapLink(url: string): { lat: number; lng: number; name?: string } | null {
  let decoded = url;
  try { decoded = decodeURIComponent(url); } catch { /* keep as is */ }
  const name = decoded.match(/\/place\/([^/@?]+)/)?.[1]?.replace(/\+/g, " ").trim();
  const patterns = [/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/, /[?&](?:q|query|ll|center|destination)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (match && coordinate(Number(match[1]), Number(match[2]))) return { lat: Number(match[1]), lng: Number(match[2]), ...(name ? { name } : {}) };
  }
  return null;
}

/** A place as sent by the app, checked. */
export function cleanPlace(raw: unknown): Place | null {
  if (!raw || typeof raw !== "object") return null;
  const place = raw as Record<string, unknown>;
  const name = typeof place.name === "string" ? place.name.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  if (!name) return null;
  const lat = Number(place.lat), lng = Number(place.lng);
  return {
    name,
    ...(typeof place.address === "string" && place.address.trim() ? { address: place.address.trim().slice(0, 300) } : {}),
    ...(place.lat != null && place.lng != null && coordinate(lat, lng) ? { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 } : {}),
  };
}

/** A local date and time ("2026-10-14", "09:30") in a time zone, as a moment. */
export function zonedToUtc(date: string, clock: string, tz: string) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = clock.split(":").map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, hh!, mm!);
  const offsetAt = (at: number) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(at)).map((part) => [part.type, part.value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute)) - at;
  };
  // Two passes handle daylight-saving changes.
  let at = guess - offsetAt(guess);
  at = guess - offsetAt(at);
  return new Date(at);
}

/** An event as sent by the app, checked (null when it can't be saved). */
export function cleanEvent(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const title = typeof e.title === "string" ? e.title.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  const startsAt = typeof e.startsAt === "string" ? new Date(e.startsAt) : null;
  if (!title || !startsAt || Number.isNaN(startsAt.getTime())) return null;
  const endsAt = typeof e.endsAt === "string" && e.endsAt ? new Date(e.endsAt) : null;
  return {
    kind: e.kind === "event" ? "event" as const : "meeting" as const,
    title,
    startsAt,
    endsAt: endsAt && !Number.isNaN(endsAt.getTime()) && endsAt > startsAt ? endsAt : null,
    allDay: e.allDay === true,
    location: cleanPlace(e.location),
    subjectId: Number.isInteger(e.subjectId) ? (e.subjectId as number) : null,
    participants: (Array.isArray(e.participants) ? e.participants : []).filter((p): p is string => typeof p === "string").map((p) => p.trim().slice(0, 80)).filter(Boolean).slice(0, 30),
    agenda: typeof e.agenda === "string" ? e.agenda.trim().slice(0, 4000) : "",
    notes: typeof e.notes === "string" ? e.notes.trim().slice(0, 8000) : "",
    reminders: [...new Set((Array.isArray(e.reminders) ? e.reminders : [30]).map(Number).filter((m) => REMINDER_CHOICES.includes(m)))].sort((a, b) => a - b),
  };
}
