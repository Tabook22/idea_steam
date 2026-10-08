/**
 * Turning a recorded meeting into text with speakers, then minutes: action items become tasks,
 * topics become chapters, and the minutes go into the meeting's notebook.
 */
import { readFile } from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";
import { audioLibraryTable, db, ideasTable, meetingsTable, tasksTable, type MeetingSegment } from "@workspace/db";
import { aiConfigured, openai, toFile } from "@workspace/integrations-openai-ai-server";
import { withMeetingAudio } from "./audio-edit";
import { SpeakerMap, mergeSegments, minutesPrompt, minutesText, parseMinutes, plainTranscript, speakerName, transcriptLines, voiceSample } from "./meeting-minutes";
import { sameTask, textHash } from "./tasks";
import { noteAttachments, notesForMinutes, notesSection } from "./meeting-notes";

const DIARIZE_MODEL = process.env.OPENAI_DIARIZE_MODEL || "gpt-4o-transcribe-diarize";
const PART_SECONDS = Number(process.env.MEETING_PART_SECONDS) || 600;
const textModel = () => process.env.OPENAI_TEXT_MODEL || (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ? "gpt-5.6-luna" : "gpt-4.1-mini");

/** Meetings being processed now (one at a time, in order). */
const active = new Set<number>();
let queue: Promise<void> = Promise.resolve();

export const isProcessing = (id: number) => active.has(id);

export function processMeetingLater(id: number) {
  if (active.has(id)) return;
  active.add(id);
  queue = queue.then(() => processMeeting(id)).catch(() => { /* recorded on the meeting */ }).finally(() => active.delete(id));
}

const stage = (id: number, value: string | null) => db.update(meetingsTable).set({ stage: value }).where(eq(meetingsTable.id, id));

type DiarizedSegment = { start: number; end: number; speaker: string; text: string };

export async function transcribeMeeting(url: string, onPart: (done: number, total: number) => Promise<unknown>) {
  return withMeetingAudio(url, PART_SECONDS, async ({ duration, parts, clip }) => {
    const speakers = new SpeakerMap();
    const voices: Array<{ name: string; data: string }> = [];
    const all: MeetingSegment[] = [];
    for (const [index, part] of parts.entries()) {
      speakers.startPart();
      const file = await toFile(await readFile(part.path), `part${index}.mp3`, { type: "audio/mpeg" });
      const result = await openai.audio.transcriptions.create({
        file,
        model: DIARIZE_MODEL,
        response_format: "diarized_json",
        chunking_strategy: "auto",
        // Voices learned from earlier parts keep the same speaker all through the meeting.
        ...(voices.length ? { known_speaker_names: voices.map((voice) => voice.name), known_speaker_references: voices.map((voice) => voice.data) } : {}),
      } as Parameters<typeof openai.audio.transcriptions.create>[0], { timeout: 15 * 60_000, maxRetries: 1 }) as unknown as { segments?: DiarizedSegment[] };
      const segments = (result.segments ?? []).map((segment) => ({
        start: part.start + segment.start, end: part.start + segment.end, speaker: speakers.id(segment.speaker), text: segment.text,
      }));
      all.push(...segments);
      // Learn the voices of new speakers (the service accepts up to four).
      if (index < parts.length - 1)
        for (const speaker of new Set(segments.map((segment) => segment.speaker))) {
          if (voices.length >= 4 || voices.some((voice) => voice.name === speaker)) continue;
          const sample = voiceSample(segments, speaker);
          if (!sample) continue;
          const audio = await clip(sample.start, sample.end);
          voices.push({ name: speaker, data: `data:audio/mpeg;base64,${audio.toString("base64")}` });
          speakers.remember(speaker);
        }
      await onPart(index + 1, parts.length);
    }
    return { duration, segments: mergeSegments(all) };
  });
}

export async function processMeeting(id: number) {
  const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, id));
  if (!meeting) return;
  const [item] = await db.select().from(audioLibraryTable).where(eq(audioLibraryTable.id, meeting.libraryItemId));
  if (!item) { await db.update(meetingsTable).set({ status: "failed", error: "The meeting's recording was removed from the library." }).where(eq(meetingsTable.id, id)); return; }
  if (!aiConfigured) { await db.update(meetingsTable).set({ status: "failed", stage: null, error: "AI is not configured yet, so the meeting can't be turned into minutes." }).where(eq(meetingsTable.id, id)); return; }
  await db.update(meetingsTable).set({ status: "processing", stage: "transcribing", error: null }).where(eq(meetingsTable.id, id));
  try {
    // 1. Text with speakers (kept if it was already made, e.g. when retrying the minutes).
    let segments = meeting.segments;
    let duration = item.durationSeconds ?? 0;
    if (!segments?.length) {
      const result = await transcribeMeeting(item.mix?.voiceUrl ?? item.url, (done, total) => stage(id, total > 1 ? `transcribing ${done}/${total}` : "transcribing"));
      segments = result.segments;
      duration = Math.round(result.duration) || duration;
      if (!segments.length) throw new Error("No speech was found in this meeting.");
      await db.update(meetingsTable).set({ segments }).where(eq(meetingsTable.id, id));
    }
    duration = duration || Math.ceil(segments.at(-1)!.end);
    const names = meeting.speakers ?? {};
    const transcript = plainTranscript(segments, names);
    // The recording carries the text too (search, Ask, connections); its tasks come from the minutes.
    await db.update(audioLibraryTable).set({
      transcript, tasksScannedFor: textHash(transcript.trim()), title: item.title ?? meeting.title,
      ...(item.durationSeconds ? {} : { durationSeconds: duration }),
    }).where(eq(audioLibraryTable.id, item.id));

    // 2. Minutes.
    await stage(id, "writing");
    const response = await openai.chat.completions.create({
      model: textModel(),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: minutesPrompt({ title: meeting.title, agenda: meeting.agenda, participants: meeting.participants, markers: meeting.markers, recordedOn: item.capturedAt, notes: notesForMinutes(meeting.notes ?? []) }) },
        { role: "user", content: transcriptLines(segments, names).slice(0, 150_000) },
      ],
    }, { timeout: 5 * 60_000, maxRetries: 1 });
    let raw: unknown = {};
    try { raw = JSON.parse(response.choices[0]?.message?.content || "{}"); } catch { /* checked below */ }
    const minutes = parseMinutes(raw, duration);
    if (!minutes) throw new Error("The minutes couldn't be written. Please try again.");
    const arabic = /[؀-ۿ]/.test(minutes.summary);

    // 3. Chapters and summary on the recording; action items into Tasks.
    await db.update(audioLibraryTable).set({ chapters: minutes.topics.length > 1 ? minutes.topics : null, summary: minutes.summary })
      .where(eq(audioLibraryTable.id, item.id));
    const existing = await db.select({ text: tasksTable.text }).from(tasksTable)
      .where(and(eq(tasksTable.source, "recording"), eq(tasksTable.sourceId, item.id)));
    const owner = (value: string | null) => (value ? (/^S\d+$/.test(value) ? speakerName(value, names) : value) : null);
    const fresh = minutes.actions.filter((action) => !existing.some((task) => sameTask(task.text, action.text)));
    if (fresh.length)
      await db.insert(tasksTable).values(fresh.map((action) => ({
        text: action.text, due: action.due, person: owner(action.owner), source: "recording" as const, sourceId: item.id,
        at: action.at === null ? null : Math.max(0, action.at - 2),
      })));

    await db.update(meetingsTable).set({ minutes, status: "ready", stage: null, error: null }).where(eq(meetingsTable.id, id));
    // 4. The minutes, your notes, photos and documents in the meeting's notebook.
    await syncMeetingIdea(id).catch((failure) => console.warn("Meeting: notebook entry failed:", (failure as Error).message));
  } catch (error) {
    const message = (error as Error).message || "";
    console.warn(`Meeting ${id} failed:`, message);
    const friendly = /No speech|minutes couldn't/.test(message) ? message
      : /too large|413/i.test(message) ? "This meeting is too long to process in one go."
      : "The meeting couldn't be processed right now. Your recording is safe; tap Try again.";
    await db.update(meetingsTable).set({ status: "failed", stage: null, error: friendly }).where(eq(meetingsTable.id, id));
  }
}

/**
 * The meeting's entry in its notebook: the minutes and your written notes, with the recording,
 * photos, drawings and documents attached. Made once, then kept up to date.
 */
export async function syncMeetingIdea(id: number) {
  const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, id));
  if (!meeting?.subjectId || !meeting.minutes) return;
  const [item] = await db.select().from(audioLibraryTable).where(eq(audioLibraryTable.id, meeting.libraryItemId));
  if (!item) return;
  const names = meeting.speakers ?? {};
  const notes = meeting.notes ?? [];
  const arabic = /[\u0600-\u06FF]/.test(meeting.minutes.summary);
  const content = [minutesText(meeting.title, meeting.minutes, names, arabic, "plain"), notesSection(notes, arabic)].filter(Boolean).join("\n\n");
  const attachments = [
    { type: "audio" as const, url: item.url, name: meeting.title, mimeType: item.mimeType ?? "audio/webm", ...(item.durationSeconds ? { durationSeconds: item.durationSeconds } : {}), libraryItemId: item.id },
    ...noteAttachments(notes),
  ];
  if (meeting.ideaId) {
    const [updated] = await db.update(ideasTable).set({ content, attachments }).where(eq(ideasTable.id, meeting.ideaId)).returning({ id: ideasTable.id });
    if (updated) return;
  }
  const [idea] = await db.insert(ideasTable).values({ subjectId: meeting.subjectId, content, source: "audio", attachments }).returning({ id: ideasTable.id });
  if (idea) await db.update(meetingsTable).set({ ideaId: idea.id }).where(eq(meetingsTable.id, id));
}

/** After a server restart, meetings that were being processed carry on. */
export async function resumeMeetings() {
  const stuck = await db.select({ id: meetingsTable.id }).from(meetingsTable).where(eq(meetingsTable.status, "processing"));
  for (const { id } of stuck) processMeetingLater(id);
}

export async function meetingsFor(ids: number[]) {
  if (!ids.length) return [];
  return db.select().from(meetingsTable).where(inArray(meetingsTable.libraryItemId, ids));
}
