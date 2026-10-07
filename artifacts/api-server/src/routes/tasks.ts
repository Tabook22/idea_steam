import { Router, type IRouter } from "express";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { audioLibraryTable, db, tasksTable, type TaskRecord } from "@workspace/db";
import { CreateTaskBody, DeleteTaskParams, FindRecordingTasksParams, UpdateTaskBody, UpdateTaskParams } from "@workspace/api-zod";
import { aiConfigured } from "@workspace/integrations-openai-ai-server";
import { findTasks, recordingsById } from "../lib/task-extract";
import { textHash } from "../lib/tasks";

const router: IRouter = Router();

const titleOf = (item: { title: string | null; transcript: string | null }) => {
  const words = item.title || item.transcript?.replace(/\s+/g, " ").trim();
  return words ? (words.length > 70 ? `${words.slice(0, 70).trim()}…` : words) : null;
};

async function serializeAll(rows: TaskRecord[]) {
  const ids = [...new Set(rows.filter((row) => row.source === "recording" && row.sourceId).map((row) => row.sourceId!))];
  const sources = await recordingsById(ids);
  return rows.map((row) => {
    const item = row.sourceId ? sources.get(row.sourceId) : undefined;
    return {
      id: row.id, text: row.text, due: row.due, time: row.time, person: row.person, done: row.done,
      doneAt: row.doneAt?.toISOString() ?? null, source: row.source, sourceId: row.sourceId,
      sourceTitle: item ? titleOf(item) : null, sourceUrl: item?.url ?? null, at: row.at, createdAt: row.createdAt.toISOString(),
    };
  });
}

router.get("/tasks", async (_req, res): Promise<void> => {
  const rows = await db.select().from(tasksTable).orderBy(asc(tasksTable.done), asc(tasksTable.due), desc(tasksTable.createdAt));
  res.json(await serializeAll(rows));
});

router.post("/tasks", async (req, res): Promise<void> => {
  const body = CreateTaskBody.safeParse(req.body);
  if (!body.success || !body.data.text.trim()) { res.status(400).json({ error: "Write the task first." }); return; }
  const [row] = await db.insert(tasksTable).values({
    text: body.data.text.trim(), due: body.data.due ?? null, time: body.data.due ? body.data.time ?? null : null, source: "manual",
  }).returning();
  res.status(201).json((await serializeAll([row]))[0]);
});

router.patch("/tasks/:taskId", async (req, res): Promise<void> => {
  const params = UpdateTaskParams.safeParse(req.params);
  const body = UpdateTaskBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid task change" }); return; }
  const changes: Partial<typeof tasksTable.$inferInsert> = {};
  if (body.data.text !== undefined && body.data.text.trim()) changes.text = body.data.text.trim();
  if (body.data.due !== undefined) { changes.due = body.data.due; if (!body.data.due) changes.time = null; }
  if (body.data.time !== undefined) changes.time = body.data.time;
  if (body.data.done !== undefined) { changes.done = body.data.done; changes.doneAt = body.data.done ? new Date() : null; }
  if (!Object.keys(changes).length) { res.status(400).json({ error: "Nothing to change" }); return; }
  const [row] = await db.update(tasksTable).set(changes).where(eq(tasksTable.id, params.data.taskId)).returning();
  if (!row) { res.status(404).json({ error: "Task not found" }); return; }
  res.json((await serializeAll([row]))[0]);
});

router.delete("/tasks/:taskId", async (req, res): Promise<void> => {
  const params = DeleteTaskParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid task" }); return; }
  await db.delete(tasksTable).where(eq(tasksTable.id, params.data.taskId));
  res.status(204).end();
});

/** Recordings with text that was never searched for tasks (or has changed since). */
async function waiting() {
  const rows = await db.select().from(audioLibraryTable)
    .where(and(eq(audioLibraryTable.kind, "recording"), isNotNull(audioLibraryTable.transcript)))
    .orderBy(desc(audioLibraryTable.capturedAt));
  return rows.filter((row) => row.transcript?.trim() && row.tasksScannedFor !== textHash(row.transcript.trim()));
}

router.post("/tasks/scan", async (_req, res): Promise<void> => {
  if (!aiConfigured) { res.status(503).json({ error: "AI is not configured yet, so tasks can't be found." }); return; }
  const list = await waiting();
  let found = 0;
  let scanned = 0;
  try {
    for (const item of list.slice(0, 8)) { found += await findTasks(item); scanned++; }
  } catch (error) {
    console.warn("Tasks: scan stopped:", (error as Error).message);
    if (!scanned) { res.status(502).json({ error: "Tasks couldn't be found right now. Please try again." }); return; }
  }
  res.json({ scanned, found, remaining: Math.max(0, list.length - scanned) });
});

router.post("/audio-library/:itemId/tasks", async (req, res): Promise<void> => {
  const params = FindRecordingTasksParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Unknown recording" }); return; }
  const [item] = await db.select().from(audioLibraryTable).where(eq(audioLibraryTable.id, params.data.itemId));
  if (!item) { res.status(404).json({ error: "Not in the library" }); return; }
  if (!item.transcript?.trim()) { res.status(400).json({ error: "Convert this recording to text first." }); return; }
  if (!aiConfigured) { res.status(503).json({ error: "AI is not configured yet, so tasks can't be found." }); return; }
  try {
    await findTasks(item, true);
    const rows = await db.select().from(tasksTable)
      .where(and(eq(tasksTable.source, "recording"), eq(tasksTable.sourceId, item.id))).orderBy(asc(tasksTable.createdAt));
    res.json(await serializeAll(rows));
  } catch (error) {
    console.warn("Tasks: couldn't search a recording:", (error as Error).message);
    res.status(502).json({ error: "Tasks couldn't be found right now. Please try again." });
  }
});

export default router;
