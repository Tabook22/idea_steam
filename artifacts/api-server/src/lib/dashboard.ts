/** Home dashboard pieces that need no database: days, streaks, and picking an idea to bring back. */

/** The calendar day ("2026-10-07") of a moment, for someone `offsetMinutes` ahead of UTC. */
export function localDay(moment: Date, offsetMinutes: number) {
  return new Date(moment.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** The last `count` days, oldest first, ending today (in the person's time zone). */
export function lastDays(now: Date, offsetMinutes: number, count: number) {
  const today = new Date(`${localDay(now, offsetMinutes)}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) =>
    new Date(today.getTime() - (count - 1 - index) * 86_400_000).toISOString().slice(0, 10));
}

/**
 * Days in a row with something captured, counting back from today. If nothing yet today, the
 * streak still counts up to yesterday (it isn't broken until a whole day passes).
 */
export function streak(activeDays: Set<string>, days: string[]) {
  let index = days.length - 1;
  if (!activeDays.has(days[index])) index--;
  let count = 0;
  while (index >= 0 && activeDays.has(days[index])) { count++; index--; }
  return count;
}

/** A steady pick for the day: the same idea all day, a different one tomorrow; `shuffle` moves on. */
export function pickForDay<T>(items: T[], day: string, shuffle = 0): T | null {
  if (!items.length) return null;
  let hash = 0;
  for (const char of day) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return items[(hash + shuffle) % items.length];
}

export const plainSnippet = (content: string | null | undefined, length = 160) => {
  const text = content?.replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").replace(/\s+([,.;:!?،؛؟])/g, "$1").trim();
  return text ? (text.length > length ? `${text.slice(0, length).trim()}…` : text) : null;
};
