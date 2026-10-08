/** Meeting page helpers: clickable moments in answers, speaker colours, and times. */

export type AnswerPiece = { text: string } | { at: number; label: string };

/** "[12:04]" and "[1:02:05]" in an answer become moments you can play. */
export function answerPieces(answer: string): AnswerPiece[] {
  const pieces: AnswerPiece[] = [];
  let last = 0;
  for (const match of answer.matchAll(/\[(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]/g)) {
    if (match.index! > last) pieces.push({ text: answer.slice(last, match.index) });
    const hours = Number(match[1] ?? 0);
    pieces.push({ at: hours * 3600 + Number(match[2]) * 60 + Number(match[3]), label: match[0].slice(1, -1) });
    last = match.index! + match[0].length;
  }
  if (last < answer.length) pieces.push({ text: answer.slice(last) });
  return pieces.map((piece) => ("text" in piece ? { text: piece.text.replace(/\*\*/g, "") } : piece));
}

export const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`;
};

const COLORS = [
  { dot: "bg-sky-500", text: "text-sky-700 dark:text-sky-300", soft: "bg-sky-500/10" },
  { dot: "bg-rose-500", text: "text-rose-700 dark:text-rose-300", soft: "bg-rose-500/10" },
  { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300", soft: "bg-amber-500/10" },
  { dot: "bg-violet-500", text: "text-violet-700 dark:text-violet-300", soft: "bg-violet-500/10" },
  { dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300", soft: "bg-emerald-500/10" },
  { dot: "bg-orange-500", text: "text-orange-700 dark:text-orange-300", soft: "bg-orange-500/10" },
  { dot: "bg-teal-500", text: "text-teal-700 dark:text-teal-300", soft: "bg-teal-500/10" },
  { dot: "bg-fuchsia-500", text: "text-fuchsia-700 dark:text-fuchsia-300", soft: "bg-fuchsia-500/10" },
];

/** The same colour for a speaker everywhere (S1 is always the first colour). */
export const speakerColor = (id: string) => COLORS[(Math.max(1, Number(id.replace(/^S/, "")) || 1) - 1) % COLORS.length];

/** The segment being spoken at a moment (the last one started), or -1. */
export function segmentAt(segments: Array<{ start: number }>, time: number) {
  let lo = 0, hi = segments.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].start <= time) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

/** A default title, e.g. "Meeting · Oct 8, 10:30". */
export const defaultMeetingTitle = (language: string, now = new Date()) =>
  `${language === "ar" ? "اجتماع" : "Meeting"} · ${new Intl.DateTimeFormat(language, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(now)}`;
