import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { audioLibraryTable, db, ideasTable, subjectCompilationsTable, subjectsTable } from "@workspace/db";
import { GetDashboardQueryParams } from "@workspace/api-zod";
import { lastDays, localDay, pickForDay, plainSnippet, streak } from "../lib/dashboard";

const router: IRouter = Router();
const DAYS = 35;
const INBOX = new Set(["Idea inbox", "صندوق الأفكار"]);

router.get("/dashboard", async (req, res): Promise<void> => {
  const query = GetDashboardQueryParams.safeParse(req.query);
  const offset = query.success ? query.data.offset ?? 0 : 0;
  const shuffle = query.success ? query.data.shuffle ?? 0 : 0;
  const now = new Date();
  try {
    const [recordings, ideas, subjects, drafts] = await Promise.all([
      db.select({ id: audioLibraryTable.id, title: audioLibraryTable.title, transcript: audioLibraryTable.transcript, url: audioLibraryTable.url,
        durationSeconds: audioLibraryTable.durationSeconds, capturedAt: audioLibraryTable.capturedAt })
        .from(audioLibraryTable).where(eq(audioLibraryTable.kind, "recording")).orderBy(desc(audioLibraryTable.capturedAt)),
      db.select({ id: ideasTable.id, subjectId: ideasTable.subjectId, content: ideasTable.content, source: ideasTable.source, createdAt: ideasTable.createdAt })
        .from(ideasTable).orderBy(desc(ideasTable.createdAt)),
      db.select({ id: subjectsTable.id, title: subjectsTable.title }).from(subjectsTable),
      db.select({ id: subjectCompilationsTable.id, subjectId: subjectCompilationsTable.subjectId, updatedAt: subjectCompilationsTable.updatedAt })
        .from(subjectCompilationsTable).orderBy(desc(subjectCompilationsTable.updatedAt)).limit(1),
    ]);
    const subjectTitle = new Map(subjects.map((subject) => [subject.id, subject.title]));
    // A voice note filed into a subject is both a recording and an idea: count it once.
    const writtenIdeas = ideas.filter((idea) => idea.source !== "voice");

    const days = lastDays(now, offset, DAYS);
    const counts = new Map(days.map((day) => [day, { date: day, recordings: 0, ideas: 0 }]));
    for (const item of recordings) { const entry = counts.get(localDay(item.capturedAt, offset)); if (entry) entry.recordings++; }
    for (const idea of writtenIdeas) { const entry = counts.get(localDay(idea.createdAt, offset)); if (entry) entry.ideas++; }
    const activity = [...counts.values()];
    const active = new Set(activity.filter((day) => day.recordings + day.ideas > 0).map((day) => day.date));
    const lastWeek = new Set(days.slice(-7));
    const weekRecordings = recordings.filter((item) => lastWeek.has(localDay(item.capturedAt, offset)));

    // Pick up where you left off: the newest recording, idea or draft.
    const newestRecording = recordings[0];
    const newestIdea = ideas.find((idea) => !INBOX.has(subjectTitle.get(idea.subjectId) ?? ""));
    const newestDraft = drafts[0];
    const options = [
      newestRecording && { at: newestRecording.capturedAt, value: { kind: "recording" as const, id: newestRecording.id,
        title: newestRecording.title || plainSnippet(newestRecording.transcript, 80) || null, subjectId: null, subjectTitle: null,
        date: newestRecording.capturedAt.toISOString(), url: newestRecording.url } },
      newestIdea && { at: newestIdea.createdAt, value: { kind: "idea" as const, id: newestIdea.id, title: plainSnippet(newestIdea.content, 80),
        subjectId: newestIdea.subjectId, subjectTitle: subjectTitle.get(newestIdea.subjectId) ?? null, date: newestIdea.createdAt.toISOString(), url: null } },
      newestDraft && { at: newestDraft.updatedAt, value: { kind: "draft" as const, id: newestDraft.id, title: subjectTitle.get(newestDraft.subjectId) ?? null,
        subjectId: newestDraft.subjectId, subjectTitle: subjectTitle.get(newestDraft.subjectId) ?? null, date: newestDraft.updatedAt.toISOString(), url: null } },
    ].filter(Boolean) as Array<{ at: Date; value: { kind: "recording" | "idea" | "draft"; id: number; title: string | null; subjectId: number | null; subjectTitle: string | null; date: string; url: string | null } }>;
    options.sort((a, b) => b.at.getTime() - a.at.getTime());

    // Bring back an older idea or recording (at least a week old, else a day), the same one all day.
    const old = (moment: Date, days: number) => now.getTime() - moment.getTime() > days * 86_400_000;
    const candidates = (minimumDays: number) => [
      ...writtenIdeas.filter((idea) => old(idea.createdAt, minimumDays) && (plainSnippet(idea.content)?.length ?? 0) >= 25)
        .map((idea) => ({ kind: "idea" as const, id: idea.id, text: plainSnippet(idea.content, 220)!, subjectId: idea.subjectId,
          subjectTitle: subjectTitle.get(idea.subjectId) ?? null, at: idea.createdAt, url: null, durationSeconds: null })),
      ...recordings.filter((item) => old(item.capturedAt, minimumDays) && (item.transcript?.trim().length ?? 0) >= 25)
        .map((item) => ({ kind: "recording" as const, id: item.id, text: plainSnippet(item.transcript, 220)!, subjectId: null,
          subjectTitle: item.title, at: item.capturedAt, url: item.url, durationSeconds: item.durationSeconds })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());
    const pool = candidates(7).length ? candidates(7) : candidates(1);
    const picked = pickForDay(pool, days.at(-1)!, shuffle);

    res.json({
      days: activity,
      streak: streak(active, days),
      week: {
        recordings: weekRecordings.length,
        ideas: writtenIdeas.filter((idea) => lastWeek.has(localDay(idea.createdAt, offset))).length,
        minutes: Math.round(weekRecordings.reduce((sum, item) => sum + (item.durationSeconds ?? 0), 0) / 60),
      },
      totals: { recordings: recordings.length, ideas: ideas.length, notebooks: subjects.filter((subject) => !INBOX.has(subject.title)).length },
      continueWith: options[0]?.value ?? null,
      resurfaced: picked ? {
        kind: picked.kind, id: picked.id, text: picked.text, subjectId: picked.subjectId, subjectTitle: picked.subjectTitle,
        date: picked.at.toISOString(), url: picked.url, durationSeconds: picked.durationSeconds,
        daysAgo: Math.max(1, Math.floor((now.getTime() - picked.at.getTime()) / 86_400_000)), choices: pool.length,
      } : null,
    });
  } catch (error) {
    req.log?.error({ err: error }, "Dashboard failed");
    res.status(500).json({ error: "The dashboard is unavailable right now." });
  }
});

export default router;
