/**
 * Meetings: speakers across a long recording, the transcript, and checking the AI's minutes.
 * Pure functions (no database, files or AI), so they can be tested alone.
 */
import type { MeetingMarker, MeetingMinutes, MeetingSegment } from "@workspace/db";

export const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Speakers are named S1, S2… for the whole meeting. The AI labels speakers A, B… per part of the
 * audio; a label that is a known speaker (from earlier parts' voice samples) keeps its name, and
 * new letters become new speakers.
 */
export class SpeakerMap {
  private next = 1;
  private perPart = new Map<string, string>();
  constructor(private known: Set<string> = new Set()) {}
  startPart() { this.perPart = new Map(); }
  id(label: string) {
    if (this.known.has(label)) return label;
    let id = this.perPart.get(label);
    if (!id) {
      while (this.known.has(`S${this.next}`)) this.next++;
      id = `S${this.next++}`;
      this.perPart.set(label, id);
    }
    return id;
  }
  remember(id: string) { this.known.add(id); }
  get knownCount() { return this.known.size; }
}

/** Consecutive pieces by the same speaker (with only a short pause between) become one. */
export function mergeSegments(segments: MeetingSegment[], gap = 1.5): MeetingSegment[] {
  const out: MeetingSegment[] = [];
  for (const segment of [...segments].sort((a, b) => a.start - b.start)) {
    const text = segment.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const last = out.at(-1);
    if (last && last.speaker === segment.speaker && segment.start - last.end <= gap && last.text.length < 1200) {
      last.end = Math.max(last.end, segment.end);
      last.text = `${last.text} ${text}`;
    } else {
      out.push({ start: round(segment.start), end: round(segment.end), speaker: segment.speaker, text });
    }
  }
  return out;
}

const round = (value: number) => Math.round(value * 10) / 10;

/** A clean stretch of one speaker (3–9 s, the longer the better) to recognise their voice later. */
export function voiceSample(segments: Array<{ start: number; end: number; speaker: string }>, speaker: string) {
  let best: { start: number; end: number } | null = null;
  for (const segment of segments) {
    if (segment.speaker !== speaker) continue;
    const length = segment.end - segment.start;
    if (length < 3) continue;
    const end = segment.start + Math.min(length, 9);
    if (!best || end - segment.start > best.end - best.start) best = { start: segment.start, end };
  }
  return best;
}

export const speakerName = (id: string, names: Record<string, string>) => names[id]?.trim() || `Speaker ${id.replace(/^S/, "")}`;

/** "[12:04] Sara: …" lines, for the AI and for search. */
export function transcriptLines(segments: MeetingSegment[], names: Record<string, string>) {
  return segments.map((segment) => `[${clock(segment.start)}] ${speakerName(segment.speaker, names)}: ${segment.text}`).join("\n");
}

/** The plain transcript kept on the recording (so Ask, search and connections find it). */
export const plainTranscript = (segments: MeetingSegment[], names: Record<string, string>) =>
  segments.map((segment) => `${speakerName(segment.speaker, names)}: ${segment.text}`).join("\n");

/** Seconds each speaker talked. */
export function talkTime(segments: MeetingSegment[]) {
  const totals: Record<string, number> = {};
  for (const segment of segments) totals[segment.speaker] = (totals[segment.speaker] ?? 0) + Math.max(0, segment.end - segment.start);
  return totals;
}

const MARK_NAMES: Record<MeetingMarker["kind"], string> = { important: "IMPORTANT", decision: "DECISION", action: "ACTION", question: "QUESTION" };

export function minutesPrompt(meeting: { title: string; agenda: string; participants: string[]; markers: MeetingMarker[]; recordedOn: Date }) {
  return [
    "You write the minutes of a recorded meeting from its transcript (\"[m:ss] Speaker: text\").",
    "Write in the main language of the meeting (Arabic meeting → Arabic minutes, English → English).",
    `The meeting "${meeting.title}" was held on ${meeting.recordedOn.toISOString().slice(0, 10)}. Turn relative dates (\"next Thursday\") into YYYY-MM-DD on or after that day.`,
    meeting.participants.length ? `Participants: ${meeting.participants.join(", ")}.` : "",
    meeting.agenda.trim() ? `Agenda:\n${meeting.agenda.trim().slice(0, 2000)}` : "",
    meeting.markers.length ? `The person recording marked these moments: ${meeting.markers.map((mark) => `${MARK_NAMES[mark.kind]} at ${clock(mark.at)}`).join("; ")}. Pay special attention to what was said around them.` : "",
    "Return JSON: {\"summary\": 3-6 sentences, \"decisions\": [{\"text\", \"at\": seconds}], \"actions\": [{\"text\": short imperative, \"owner\": person's name as said or the speaker label, or null, \"due\": \"YYYY-MM-DD\" or null, \"at\": seconds}], \"questions\": [{\"text\": open question not yet answered, \"at\": seconds}], \"quotes\": [{\"text\": a key sentence quoted exactly, \"speaker\": as in the transcript, \"at\": seconds}], \"topics\": [{\"title\": 2-6 words, \"start\": seconds}]}.",
    "`at` and `start` are seconds taken from the [m:ss] markers. Topics follow the meeting in order; the first starts at 0. Up to 10 decisions, 15 actions, 6 questions, 5 quotes, 12 topics. Only what was actually said.",
  ].filter(Boolean).join("\n");
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
const time = (value: unknown, duration: number) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(round(value), duration) : null);
const date = (value: unknown) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? value : null);
const list = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object") : []);

/** The AI's minutes, checked: real text, times inside the meeting, valid dates. */
export function parseMinutes(raw: unknown, duration: number): MeetingMinutes | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const summary = text(data.summary, 2000);
  if (!summary) return null;
  const topics = list(data.topics)
    .map((entry) => ({ title: text(entry.title, 80), start: time(entry.start, duration) ?? -1 }))
    .filter((topic) => topic.title && topic.start >= 0)
    .sort((a, b) => a.start - b.start)
    .filter((topic, index, all) => index === 0 || topic.start - all[index - 1].start >= 20)
    .slice(0, 12);
  if (topics.length) topics[0].start = 0;
  return {
    summary,
    decisions: list(data.decisions).map((entry) => ({ text: text(entry.text, 300), at: time(entry.at, duration) })).filter((entry) => entry.text).slice(0, 10),
    actions: list(data.actions).map((entry) => ({ text: text(entry.text, 200), owner: text(entry.owner, 60) || null, due: date(entry.due), at: time(entry.at, duration) })).filter((entry) => entry.text).slice(0, 15),
    questions: list(data.questions).map((entry) => ({ text: text(entry.text, 300), at: time(entry.at, duration) })).filter((entry) => entry.text).slice(0, 6),
    quotes: list(data.quotes).map((entry) => ({ text: text(entry.text, 300), speaker: text(entry.speaker, 60) || null, at: time(entry.at, duration) })).filter((entry) => entry.text).slice(0, 5),
    topics,
  };
}

/** The minutes as readable text: for the notebook, copying and downloading. */
export function minutesText(title: string, minutes: MeetingMinutes, names: Record<string, string>, arabic: boolean, style: "markdown" | "plain" = "markdown") {
  const label = (en: string, ar: string) => (arabic ? ar : en);
  const owner = (value: string | null) => (value ? (/^S\d+$/.test(value) ? speakerName(value, names) : value) : null);
  const plain = style === "plain";
  const heading = (icon: string, en: string, ar: string) => (plain ? `${icon} ${label(en, ar)}` : `## ${label(en, ar)}`);
  const bullet = plain ? "•" : "-";
  const lines = [plain ? `🗓 ${title}` : `# ${title}`, "", minutes.summary];
  if (minutes.decisions.length) lines.push("", heading("✅", "Decisions", "القرارات"), ...minutes.decisions.map((entry) => `${bullet} ${entry.text}`));
  if (minutes.actions.length) lines.push("", heading("📌", "Action items", "المهام"), ...minutes.actions.map((entry) => `${bullet} ${entry.text}${owner(entry.owner) ? ` — ${owner(entry.owner)}` : ""}${entry.due ? ` (${entry.due})` : ""}`));
  if (minutes.questions.length) lines.push("", heading("❓", "Open questions", "أسئلة مفتوحة"), ...minutes.questions.map((entry) => `${bullet} ${entry.text}`));
  if (minutes.topics.length) lines.push("", heading("🧭", "Topics", "المحاور"), ...minutes.topics.map((topic) => `${bullet} ${clock(topic.start)} ${topic.title}`));
  return lines.join("\n");
}

/** Answers about one meeting, citing the moments ([m:ss]) they come from. */
export const MEETING_ASK = [
  "You answer questions about one recorded meeting, using ONLY its transcript and minutes.",
  "Answer in the SAME language as the question. Be direct and short (under 150 words), with bullet points when listing.",
  "After each fact, cite the moment it was said as [m:ss] (or [h:mm:ss]) copied from the transcript.",
  "Name speakers as the transcript does. If the meeting doesn't say, say so plainly.",
].join(" ");
