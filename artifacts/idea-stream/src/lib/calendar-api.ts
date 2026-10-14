import { liveFetch } from "@/lib/live-api";

/** The calendar: events, places and reminders. */
export type Place = { name: string; address?: string; lat?: number; lng?: number };
export type CalendarEvent = {
  id: number; kind: "meeting" | "event"; title: string; startsAt: string; endsAt: string | null; allDay: boolean;
  location: Place | null; subjectId: number | null; participants: string[]; agenda: string; notes: string;
  reminders: number[]; meetingId: number | null; createdAt: string;
};
export type EventInput = Omit<CalendarEvent, "id" | "meetingId" | "createdAt">;
export type CalendarData = {
  events: CalendarEvent[];
  meetings: Array<{ id: number; title: string; createdAt: string; location: Place | null; eventId: number | null; subjectId: number | null; status: string }>;
  tasks: Array<{ id: number; text: string; due: string; time: string | null; done: boolean; person: string | null }>;
  timezone: string;
};
export type ReminderStatus = { telegram: boolean; pushKey: string; devices: Array<{ endpoint: string; device: string }>; timezone: string };

export const getCalendar = (from: Date, to: Date) => liveFetch<CalendarData>(`/api/calendar?from=${from.toISOString()}&to=${to.toISOString()}`);
export const saveEvent = (input: EventInput, id?: number) => liveFetch<CalendarEvent>(id ? `/api/events/${id}` : "/api/events", { method: id ? "PUT" : "POST", json: input });
export const deleteEvent = (id: number) => liveFetch<void>(`/api/events/${id}`, { method: "DELETE" });
export const searchPlaces = (q: string) => liveFetch<Place[]>(`/api/places?q=${encodeURIComponent(q)}`);
export const placeAt = (lat: number, lng: number) => liveFetch<Place>(`/api/places/reverse?lat=${lat}&lng=${lng}`);
export const placeFromLink = (url: string) => liveFetch<Place>(`/api/places/link?url=${encodeURIComponent(url)}`);
export const reminderStatus = () => liveFetch<ReminderStatus>("/api/reminders/status");

/** Google Maps, Google Earth, and a map to show on the page. */
export function placeLinks(place: Place | null | undefined) {
  if (!place) return null;
  const point = typeof place.lat === "number" && typeof place.lng === "number";
  const query = point ? `${place.lat},${place.lng}` : (place.address || place.name).trim();
  if (!query) return null;
  return {
    maps: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
    earth: point ? `https://earth.google.com/web/search/${place.lat},${place.lng}` : `https://earth.google.com/web/search/${encodeURIComponent(query)}`,
    embed: `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=${point ? 16 : 14}&output=embed`,
  };
}

/** The phone's own time zone, kept on the server so reminders go out at the right local time. */
export function shareTimezone() {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezone) void liveFetch("/api/reminders/timezone", { method: "POST", json: { timezone } }).catch(() => {});
  } catch { /* optional */ }
}

const b64ToBytes = (value: string) => {
  const padded = (value + "===".slice((value.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};
/** Turns on notifications on this phone or computer (asks permission, then registers it). */
export async function enablePush(publicKey: string, device: string) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("unsupported");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("denied");
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  await liveFetch("/api/reminders/push", { method: "POST", json: { subscription: subscription.toJSON(), device } });
  return subscription.endpoint;
}
export async function thisDevicePush() {
  try {
    if (!("serviceWorker" in navigator)) return null;
    const registration = await navigator.serviceWorker.getRegistration();
    return (await registration?.pushManager.getSubscription())?.endpoint ?? null;
  } catch { return null; }
}

/** Calendar maths in local time. */
export const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
export const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
export const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
/** The 6 weeks shown for a month, starting on Saturday (Arabic) or Monday. */
export function monthGrid(month: Date, weekStartsOn: number) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = addDays(first, -((first.getDay() - weekStartsOn + 7) % 7));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
/** "Record now" is offered from an hour before a meeting until two hours after it starts. */
export const isRecordable = (start: Date, now = Date.now()) => start.getTime() - now < 3600_000 && now - start.getTime() < 2 * 3600_000;
export const REMINDER_CHOICES: Array<[number, string, string]> = [
  [0, "At the time", "في الموعد"], [10, "10 min before", "قبل 10 د"], [30, "30 min before", "قبل 30 د"], [60, "1 hour before", "قبل ساعة"], [1440, "1 day before", "قبل يوم"],
];
