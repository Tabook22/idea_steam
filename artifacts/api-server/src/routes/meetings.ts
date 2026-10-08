import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { audioLibraryTable, db, meetingsTable, subjectsTable, tasksTable, type MeetingRecord } from "@workspace/db";
import { AskMeetingBody, AskMeetingParams, GetMeetingParams, ProcessMeetingBody, SaveMeetingNotesBody, UpdateMeetingBody } from "@workspace/api-zod";
import { cleanNotes, notesForMinutes } from "../lib/meeting-notes";
import { aiConfigured, openai } from "@workspace/integrations-openai-ai-server";
import { MEETING_ASK, mergeNamedSpeakers, minutesText, plainTranscript, speakerName, talkTime, transcriptLines } from "../lib/meeting-minutes";
import { isProcessing, processMeetingLater, resumeMeetings, syncMeetingIdea } from "../lib/meeting-process";
import { textHash } from "../lib/tasks";

const router: IRouter = Router();
const textModel = () => process.env.OPENAI_TEXT_MODEL || (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ? "gpt-5.6-luna" : "gpt-4.1-mini");

// Meetings that were being processed when the server stopped carry on shortly after it starts.
setTimeout(() => { void resumeMeetings().catch(() => {}); }, 8000).unref?.();

async function context(meetings: MeetingRecord[]) {
  const itemIds = meetings.map((meeting) => meeting.libraryItemId);
  const subjectIds = [...new Set(meetings.map((meeting) => meeting.subjectId).filter((id): id is number => id !== null))];
  const items = itemIds.length ? await db.select().from(audioLibraryTable).where(inArray(audioLibraryTable.id, itemIds)) : [];
  const subjects = subjectIds.length ? await db.select({ id: subjectsTable.id, title: subjectsTable.title }).from(subjectsTable).where(inArray(subjectsTable.id, subjectIds)) : [];
  return { items: new Map(items.map((item) => [item.id, item])), subjects: new Map(subjects.map((subject) => [subject.id, subject.title])) };
}

function summary(meeting: MeetingRecord, ctx: Awaited<ReturnType<typeof context>>) {
  const item = ctx.items.get(meeting.libraryItemId);
  return {
    id: meeting.id,
    title: meeting.title,
    status: meeting.status,
    stage: meeting.stage,
    libraryItemId: meeting.libraryItemId,
    durationSeconds: item?.durationSeconds ?? null,
    subjectId: meeting.subjectId,
    subjectTitle: meeting.subjectId ? ctx.subjects.get(meeting.subjectId) ?? null : null,
    speakerCount: new Set((meeting.segments ?? []).map((segment) => segment.speaker)).size,
    actionCount: meeting.minutes?.actions.length ?? 0,
    summary: meeting.minutes?.summary ?? null,
    createdAt: meeting.createdAt.toISOString(),
  };
}

function full(meeting: MeetingRecord, ctx: Awaited<ReturnType<typeof context>>) {
  const names = meeting.speakers ?? {};
  const segments = meeting.segments ?? [];
  const totals = talkTime(segments);
  const arabic = /[؀-ۿ]/.test(meeting.minutes?.summary ?? segments[0]?.text ?? "");
  return {
    ...summary(meeting, ctx),
    url: ctx.items.get(meeting.libraryItemId)?.url ?? "",
    error: meeting.error,
    participants: meeting.participants,
    agenda: meeting.agenda,
    markers: meeting.markers,
    segments,
    speakers: Object.entries(totals).sort((a, b) => b[1] - a[1])
      .map(([id, seconds]) => ({ id, name: speakerName(id, names), seconds: Math.round(seconds), named: !!names[id]?.trim() })),
    minutes: meeting.minutes,
    minutesText: meeting.minutes ? minutesText(meeting.title, meeting.minutes, names, arabic) : null,
    notes: meeting.notes ?? [],
  };
}

async function one(id: number) {
  const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, id));
  return meeting ? full(meeting, await context([meeting])) : null;
}

router.get("/meetings", async (_req, res): Promise<void> => {
  const meetings = await db.select().from(meetingsTable).orderBy(desc(meetingsTable.createdAt));
  // Picked up again if the server was restarted in the middle (and nothing is working on it).
  for (const meeting of meetings)
    if (meeting.status === "processing" && !isProcessing(meeting.id) && Date.now() - meeting.updatedAt.getTime() > 60_000) processMeetingLater(meeting.id);
  const ctx = await context(meetings);
  res.json(meetings.map((meeting) => summary(meeting, ctx)));
});

router.get("/meetings/:meetingId", async (req, res): Promise<void> => {
  const params = GetMeetingParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Unknown meeting" }); return; }
  const meeting = await one(params.data.meetingId);
  if (!meeting) { res.status(404).json({ error: "Meeting not found" }); return; }
  res.json(meeting);
});

router.patch("/meetings/:meetingId", async (req, res): Promise<void> => {
  const params = GetMeetingParams.safeParse(req.params);
  const body = UpdateMeetingBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid change" }); return; }
  const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, params.data.meetingId));
  if (!meeting) { res.status(404).json({ error: "Meeting not found" }); return; }
  const changes: Partial<typeof meetingsTable.$inferInsert> = {};
  if (body.data.title?.trim()) {
    changes.title = body.data.title.trim();
    await db.update(audioLibraryTable).set({ title: changes.title }).where(eq(audioLibraryTable.id, meeting.libraryItemId));
  }
  if (body.data.subjectId !== undefined) changes.subjectId = body.data.subjectId;
  if (body.data.speakers) {
    const before = meeting.speakers ?? {};
    const names = { ...before };
    for (const [id, name] of Object.entries(body.data.speakers)) {
      if (!/^S\d+$/.test(id)) continue;
      if (name.trim()) names[id] = name.trim().slice(0, 60); else delete names[id];
    }
    // The same name on two speakers means one person: merge them.
    const merged = mergeNamedSpeakers(meeting.segments ?? [], names);
    changes.speakers = merged.names;
    if (merged.merged) {
      changes.segments = merged.segments;
      if (meeting.minutes)
        changes.minutes = { ...meeting.minutes, actions: meeting.minutes.actions.map((action) => ({ ...action, owner: action.owner ? merged.rename.get(action.owner) ?? action.owner : null })) };
    }
    // Names flow into the recording's text and the tasks found in this meeting.
    if (merged.segments.length) {
      const transcript = plainTranscript(merged.segments, merged.names);
      await db.update(audioLibraryTable).set({ transcript, tasksScannedFor: textHash(transcript.trim()) }).where(eq(audioLibraryTable.id, meeting.libraryItemId));
    }
    for (const id of Object.keys(body.data.speakers)) {
      const oldName = speakerName(id, before);
      const newName = speakerName(id, names);
      if (oldName !== newName)
        await db.update(tasksTable).set({ person: newName })
          .where(and(eq(tasksTable.source, "recording"), eq(tasksTable.sourceId, meeting.libraryItemId), eq(tasksTable.person, oldName)));
    }
  }
  if (Object.keys(changes).length) await db.update(meetingsTable).set(changes).where(eq(meetingsTable.id, meeting.id));
  res.json(await one(meeting.id));
});

router.put("/meetings/:meetingId/notes", async (req, res): Promise<void> => {
  const params = GetMeetingParams.safeParse(req.params);
  const body = SaveMeetingNotesBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "These notes couldn't be saved." }); return; }
  const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, params.data.meetingId));
  if (!meeting) { res.status(404).json({ error: "Meeting not found" }); return; }
  await db.update(meetingsTable).set({ notes: cleanNotes(body.data.notes) }).where(eq(meetingsTable.id, meeting.id));
  // The notebook entry shows the latest notes and files.
  await syncMeetingIdea(meeting.id).catch(() => {});
  res.json(await one(meeting.id));
});

router.post("/meetings/:meetingId/process", async (req, res): Promise<void> => {
  const params = GetMeetingParams.safeParse(req.params);
  const body = ProcessMeetingBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) { res.status(400).json({ error: "Unknown meeting" }); return; }
  const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, params.data.meetingId));
  if (!meeting) { res.status(404).json({ error: "Meeting not found" }); return; }
  if (!aiConfigured) { res.status(503).json({ error: "AI is not configured yet, so the meeting can't be turned into minutes." }); return; }
  if (!isProcessing(meeting.id)) {
    await db.update(meetingsTable).set({ status: "processing", stage: "waiting", error: null, ...(body.data.fresh ? { segments: null } : {}) })
      .where(eq(meetingsTable.id, meeting.id));
    processMeetingLater(meeting.id);
  }
  res.status(202).json(await one(meeting.id));
});

router.post("/meetings/:meetingId/ask", async (req, res): Promise<void> => {
  const params = AskMeetingParams.safeParse(req.params);
  const body = AskMeetingBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Type a question to ask." }); return; }
  const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, params.data.meetingId));
  if (!meeting?.segments?.length) { res.status(409).json({ error: "This meeting has no text yet." }); return; }
  if (!aiConfigured) { res.status(503).json({ error: "AI is not configured yet." }); return; }
  const names = meeting.speakers ?? {};
  try {
    const response = await openai.chat.completions.create({
      model: textModel(),
      messages: [
        { role: "system", content: MEETING_ASK },
        { role: "user", content: [
          `Meeting: ${meeting.title}`,
          meeting.minutes ? `Minutes:\n${minutesText(meeting.title, meeting.minutes, names, false)}` : "",
          meeting.notes?.length ? `Notes taken during the meeting:\n${notesForMinutes(meeting.notes)}` : "",
          `Transcript:\n${transcriptLines(meeting.segments, names).slice(0, 150_000)}`,
        ].filter(Boolean).join("\n\n") },
        ...(body.data.history ?? []).slice(-4).flatMap((turn) => [
          { role: "user" as const, content: turn.question.slice(0, 500) },
          { role: "assistant" as const, content: turn.answer.slice(0, 1500) },
        ]),
        { role: "user", content: body.data.question.trim().slice(0, 500) },
      ],
    }, { timeout: 90_000, maxRetries: 1 });
    res.json({ answer: response.choices[0]?.message?.content?.trim() || "" });
  } catch (error) {
    console.warn("Meeting ask failed:", (error as Error).message);
    res.status(502).json({ error: "Couldn't answer right now. Please try again." });
  }
});

export default router;
