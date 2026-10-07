import { and, eq, inArray } from "drizzle-orm";
import { audioLibraryTable, db, tasksTable, type AudioLibraryRecord } from "@workspace/db";
import { aiConfigured, openai } from "@workspace/integrations-openai-ai-server";
import { locateQuote, parseTasks, sameTask, taskPrompt, textHash } from "./tasks";

const textModel = () => process.env.OPENAI_TEXT_MODEL || (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ? "gpt-5.6-luna" : "gpt-4.1-mini");

/** One scan at a time per recording. */
const scanning = new Map<number, Promise<number>>();

/**
 * Finds the tasks in a recording's text and adds the new ones (a task already found for this
 * recording is not added twice, even after an edit). Returns how many were added.
 */
export function findTasks(item: AudioLibraryRecord, force = false): Promise<number> {
  const running = scanning.get(item.id);
  if (running) return running;
  const work = (async () => {
    const transcript = item.transcript?.trim();
    if (!transcript || !aiConfigured || item.kind !== "recording") return 0;
    const hash = textHash(transcript);
    if (!force && item.tasksScannedFor === hash) return 0;
    const response = await openai.chat.completions.create({
      model: textModel(),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: taskPrompt(item.capturedAt) },
        { role: "user", content: transcript.slice(0, 40_000) },
      ],
    }, { timeout: 60_000, maxRetries: 1 });
    let raw: unknown = {};
    try { raw = JSON.parse(response.choices[0]?.message?.content || "{}"); } catch { /* treated as none */ }
    const found = parseTasks(raw);
    const existing = await db.select({ text: tasksTable.text }).from(tasksTable)
      .where(and(eq(tasksTable.source, "recording"), eq(tasksTable.sourceId, item.id)));
    const fresh = found.filter((task) => !existing.some((old) => sameTask(old.text, task.text)));
    // Word timings belong to the voice; with background music before it, the moment comes later.
    const pre = item.mix?.pre ?? 0;
    if (fresh.length)
      await db.insert(tasksTable).values(fresh.map((task) => {
        const at = locateQuote(task.quote, transcript, item.words, item.mix?.voiceDuration ?? item.durationSeconds);
        return { text: task.text, due: task.due, time: task.time, person: task.person, quote: task.quote,
          source: "recording" as const, sourceId: item.id, at: at === null ? null : at + pre };
      }));
    await db.update(audioLibraryTable).set({ tasksScannedFor: hash }).where(eq(audioLibraryTable.id, item.id));
    return fresh.length;
  })().finally(() => scanning.delete(item.id));
  scanning.set(item.id, work);
  return work;
}

/** After new text arrives: look for tasks in the background (the text is already saved). */
export function findTasksLater(itemId: number) {
  void (async () => {
    const [item] = await db.select().from(audioLibraryTable).where(eq(audioLibraryTable.id, itemId));
    if (item) await findTasks(item);
  })().catch((error) => console.warn("Tasks: couldn't search a recording:", (error as Error).message));
}

export async function recordingsById(ids: number[]) {
  if (!ids.length) return new Map<number, AudioLibraryRecord>();
  const rows = await db.select().from(audioLibraryTable).where(inArray(audioLibraryTable.id, ids));
  return new Map(rows.map((row) => [row.id, row]));
}
