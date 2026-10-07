/** Grouping tasks by when they're due, and calendar files for them. */

export type DatedTask = { id: number; text: string; due: string | null; time: string | null; done: boolean; person?: string | null; sourceTitle?: string | null };
export type Group = "overdue" | "today" | "week" | "later" | "someday" | "done";
export const GROUPS: Group[] = ["overdue", "today", "week", "later", "someday", "done"];

/** Today as YYYY-MM-DD in the device's own time zone. */
export function todayKey(now = new Date()) {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export function groupOf(task: DatedTask, today: string): Group {
  if (task.done) return "done";
  if (!task.due) return "someday";
  if (task.due < today) return "overdue";
  if (task.due === today) return "today";
  if (task.due <= addDays(today, 7)) return "week";
  return "later";
}

/** Tasks per group, each sorted by date (then time); done ones newest first. */
export function groupTasks<T extends DatedTask>(tasks: T[], today: string): Record<Group, T[]> {
  const groups = Object.fromEntries(GROUPS.map((group) => [group, [] as T[]])) as Record<Group, T[]>;
  for (const task of tasks) groups[groupOf(task, today)].push(task);
  const byDate = (a: T, b: T) => `${a.due ?? ""}${a.time ?? ""}`.localeCompare(`${b.due ?? ""}${b.time ?? ""}`) || a.id - b.id;
  for (const group of GROUPS) groups[group].sort(group === "done" ? (a, b) => b.id - a.id : byDate);
  return groups;
}

const escape = (text: string) => text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const compact = (day: string) => day.replace(/-/g, "");

/**
 * A calendar file (.ics) for dated tasks: all-day events, or one hour at the set time, each
 * with a reminder (at 9:00 that day, or 15 minutes before).
 */
export function calendarFile(tasks: DatedTask[], stamp = new Date()) {
  const now = stamp.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const events = tasks.filter((task) => task.due && !task.done).map((task) => {
    const lines = ["BEGIN:VEVENT", `UID:idea-stream-task-${task.id}@nasserdiary`, `DTSTAMP:${now}`, `SUMMARY:${escape(task.text)}`];
    const details = [task.person && `With: ${task.person}`, task.sourceTitle && `From your recording: ${task.sourceTitle}`].filter(Boolean).join("\n");
    if (details) lines.push(`DESCRIPTION:${escape(details)}`);
    if (task.time) {
      const start = `${compact(task.due!)}T${task.time.replace(":", "")}00`;
      const [h, m] = task.time.split(":").map(Number);
      const endHour = Math.min(23, h + 1);
      lines.push(`DTSTART:${start}`, `DTEND:${compact(task.due!)}T${String(endHour).padStart(2, "0")}${String(endHour === h ? 59 : m).padStart(2, "0")}00`);
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escape(task.text)}`, "TRIGGER:-PT15M", "END:VALARM");
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compact(task.due!)}`, `DTEND;VALUE=DATE:${compact(addDays(task.due!, 1))}`);
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escape(task.text)}`, "TRIGGER:PT9H", "END:VALARM");
    }
    lines.push("END:VEVENT");
    return lines.join("\r\n");
  });
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Idea Stream//Tasks//EN", "CALSCALE:GREGORIAN", ...events, "END:VCALENDAR", ""].join("\r\n");
}
