import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { askPassagesTable, db, subjectsTable, tasksTable, weeklyDigestsTable } from "@workspace/db";
import { GetDigestQueryParams, GetRelatedQueryParams, MakeDigestBody } from "@workspace/api-zod";
import { aiConfigured, openai } from "@workspace/integrations-openai-ai-server";
import { EMBED_NOW, embedMissing, gather, indexInBackground, syncIndex, textModel } from "../lib/ask-index";
import { bestFit, centroid, groupBySimilarity, isoWeek, parseDigest, relatedTo, sourceKey, sourceVectors, type SourceKey } from "../lib/connections";
import { lastDays, localDay, plainSnippet } from "../lib/dashboard";

const router: IRouter = Router();
const INBOX = new Set(["Idea inbox", "صندوق الأفكار"]);

/** The index, brought up to date at most once a minute (the rest is embedded in the background). */
let lastSync = 0;
let syncing: Promise<void> | null = null;
async function snapshot() {
  const data = await gather();
  if (Date.now() - lastSync > 60_000) {
    syncing ??= (async () => {
      await syncIndex(data.passages);
      if (aiConfigured) await embedMissing(EMBED_NOW);
      lastSync = Date.now();
      indexInBackground();
    })().finally(() => { syncing = null; });
    await syncing;
  }
  const rows = await db.select({ source: askPassagesTable.source, sourceId: askPassagesTable.sourceId, embedding: askPassagesTable.embedding }).from(askPassagesTable);
  return { ...data, vectors: sourceVectors(rows) };
}

type Snapshot = Awaited<ReturnType<typeof snapshot>>;

function describe(key: SourceKey, data: Snapshot) {
  const [kind, raw] = key.split(":") as ["recording" | "idea" | "draft", string];
  const id = Number(raw);
  if (kind === "recording") {
    const item = data.items.find((entry) => entry.id === id);
    if (!item) return null;
    const link = (data.links.get(id) ?? [])[0];
    return { kind, id, title: item.title || plainSnippet(item.transcript, 80) || "Voice note", subjectId: link?.subjectId ?? null, subjectTitle: link?.subjectTitle ?? null, url: item.url };
  }
  if (kind === "idea") {
    const row = data.ideas.find((entry) => entry.idea.id === id);
    if (!row) return null;
    return { kind, id, title: plainSnippet(row.idea.content, 80) || row.subjectTitle, subjectId: row.idea.subjectId, subjectTitle: row.subjectTitle, url: null };
  }
  const row = data.drafts.find((entry) => entry.draft.id === id);
  if (!row) return null;
  return { kind, id, title: row.subjectTitle, subjectId: row.draft.subjectId, subjectTitle: row.subjectTitle, url: null };
}

router.get("/related", async (req, res): Promise<void> => {
  const query = GetRelatedQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Choose a recording or an idea." }); return; }
  const { kind, id } = query.data;
  try {
    const data = await snapshot();
    // A voice note filed into a subject is the same words twice: don't call it "related".
    const exclude = new Set<SourceKey>();
    if (kind === "recording") for (const link of data.links.get(id) ?? []) exclude.add(sourceKey("idea", link.ideaId));
    else for (const [itemId, links] of data.links) if (links.some((link) => link.ideaId === id)) exclude.add(sourceKey("recording", itemId));
    const found = relatedTo(sourceKey(kind, id), data.vectors, { exclude, limit: 5, min: 0.3 });
    res.json(found.map(({ key, score }) => {
      const item = describe(key, data);
      return item ? { ...item, score: Math.round(score * 100) / 100 } : null;
    }).filter(Boolean));
  } catch (error) {
    req.log?.error({ err: error }, "Related failed");
    res.status(500).json({ error: "Related ideas are unavailable right now." });
  }
});

/** Names for suggested groups, made once per set of recordings. */
const groupNames = new Map<string, { title: string; icon: string | null }>();

async function nameGroup(key: string, snippets: string[], fallback: string) {
  const known = groupNames.get(key);
  if (known) return known;
  let name = { title: fallback, icon: null as string | null };
  if (aiConfigured) {
    try {
      const response = await openai.chat.completions.create({
        model: textModel(),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "These voice notes are about one topic. Name the topic for a notebook: 2-5 words, in the SAME language as the notes (Arabic stays Arabic), plus one fitting emoji. Return JSON {\"title\": string, \"emoji\": string}." },
          { role: "user", content: snippets.map((text, index) => `${index + 1}. ${text}`).join("\n").slice(0, 6000) },
        ],
      }, { timeout: 30_000, maxRetries: 1 });
      const raw = JSON.parse(response.choices[0]?.message?.content || "{}") as { title?: unknown; emoji?: unknown };
      const title = typeof raw.title === "string" ? raw.title.trim().slice(0, 60) : "";
      const icon = typeof raw.emoji === "string" ? [...raw.emoji.trim()].slice(0, 2).join("") || null : null;
      if (title) name = { title, icon };
    } catch (error) {
      console.warn("Connections: couldn't name a group:", (error as Error).message);
      return name;
    }
  }
  groupNames.set(key, name);
  return name;
}

router.get("/connections", async (_req, res): Promise<void> => {
  try {
    const data = await snapshot();
    const titleOf = (id: number) => {
      const item = data.items.find((entry) => entry.id === id);
      return item?.title || plainSnippet(item?.transcript, 70) || "Voice note";
    };
    const unfiled = data.items.filter((item) => !(data.links.get(item.id)?.length) && data.vectors.has(sourceKey("recording", item.id)));
    const groups = groupBySimilarity(unfiled.map((item) => sourceKey("recording", item.id)), data.vectors, { threshold: 0.5 });
    const grouped = new Set(groups.flat());
    const named = [];
    for (const group of groups) {
      const ids = group.map((key) => Number(key.split(":")[1])).sort((a, b) => a - b);
      const key = ids.join("-");
      const snippets = ids.map((id) => {
        const item = data.items.find((entry) => entry.id === id)!;
        return [item.title, plainSnippet(item.transcript, 240)].filter(Boolean).join(": ");
      });
      const name = await nameGroup(key, snippets, titleOf(ids[0]));
      named.push({ key, title: name.title, icon: name.icon, items: ids.map((id) => ({ id, title: titleOf(id) })) });
    }

    // Each notebook's direction: its ideas and the recordings filed in it.
    const notebooks = [...new Map(data.ideas.map((row) => [row.idea.subjectId, row.subjectTitle])).entries()]
      .filter(([, title]) => !INBOX.has(title))
      .map(([id]) => {
        const vectors = [
          ...data.ideas.filter((row) => row.idea.subjectId === id).map((row) => data.vectors.get(sourceKey("idea", row.idea.id))),
        ].filter((vector): vector is number[] => !!vector);
        const vector = centroid(vectors);
        return vector ? { id, vector } : null;
      })
      .filter((entry): entry is { id: number; vector: number[] } => !!entry);
    const subjects = new Map(data.ideas.map((row) => [row.idea.subjectId, row.subjectTitle]));
    const icons = await subjectIcons();
    const filings = unfiled
      .filter((item) => !grouped.has(sourceKey("recording", item.id)))
      .map((item) => {
        const fit = bestFit(data.vectors.get(sourceKey("recording", item.id))!, notebooks, 0.45);
        return fit ? { itemId: item.id, itemTitle: titleOf(item.id), subjectId: fit.id, subjectTitle: subjects.get(fit.id) ?? "", subjectIcon: icons.get(fit.id) ?? null, score: fit.score } : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => !!entry)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ score: _score, ...rest }) => rest);
    res.json({ groups: named, filings, ready: data.vectors.size > 0 });
  } catch (error) {
    console.warn("Connections failed:", (error as Error).message);
    res.status(500).json({ error: "Suggestions are unavailable right now." });
  }
});

async function subjectIcons() {
  const rows = await db.select({ id: subjectsTable.id, icon: subjectsTable.icon }).from(subjectsTable);
  return new Map(rows.map((row) => [row.id, row.icon]));
}

/** This week's material: recordings and written ideas from the last 7 days. */
async function thisWeek(offset: number) {
  const data = await gather();
  const days = new Set(lastDays(new Date(), offset, 7));
  const recordings = data.items.filter((item) => days.has(localDay(item.capturedAt, offset)));
  const ideas = data.ideas.filter((row) => row.idea.source !== "voice" && days.has(localDay(row.idea.createdAt, offset)));
  return { data, recordings, ideas };
}

async function respond(week: string, offset: number) {
  const [row] = await db.select().from(weeklyDigestsTable).where(eq(weeklyDigestsTable.week, week));
  const { data, recordings, ideas } = await thisWeek(offset);
  const titles = new Map(data.ideas.map((entry) => [entry.idea.subjectId, entry.subjectTitle]));
  const digest = row ? parseDigest(row.content, new Set(titles.keys())) : null;
  return {
    week,
    digest: digest ? { ...digest, ready: digest.ready.map((entry) => ({ ...entry, subjectTitle: titles.get(entry.subjectId) ?? "" })) } : null,
    createdAt: row?.createdAt.toISOString() ?? null,
    items: recordings.length + ideas.length,
  };
}

router.get("/digest", async (req, res): Promise<void> => {
  const query = GetDigestQueryParams.safeParse(req.query);
  const offset = query.success ? query.data.offset ?? 0 : 0;
  res.json(await respond(isoWeek(localDay(new Date(), offset)), offset));
});

router.post("/digest", async (req, res): Promise<void> => {
  const body = MakeDigestBody.safeParse(req.body ?? {});
  if (!body.success) { res.status(400).json({ error: "Invalid request" }); return; }
  const offset = body.data.offset ?? 0;
  const arabic = body.data.language === "ar";
  if (!aiConfigured) { res.status(503).json({ error: arabic ? "الذكاء الاصطناعي غير مفعّل بعد." : "AI is not configured yet, so the digest can't be written." }); return; }
  const week = isoWeek(localDay(new Date(), offset));
  try {
    const { data, recordings, ideas } = await thisWeek(offset);
    if (recordings.length + ideas.length < 2) {
      res.status(400).json({ error: arabic ? "سجّل أو اكتب بعض الأفكار هذا الأسبوع أولًا." : "Record or write a few ideas this week first." });
      return;
    }
    const tasks = await db.select().from(tasksTable);
    const since = Date.now() - 7 * 86_400_000;
    const notebooks = [...new Map(data.ideas.map((row) => [row.idea.subjectId, row.subjectTitle])).entries()]
      .filter(([, title]) => !INBOX.has(title))
      .map(([id, title]) => ({ id, title, ideas: data.ideas.filter((row) => row.idea.subjectId === id).length,
        thisWeek: data.ideas.filter((row) => row.idea.subjectId === id && row.idea.createdAt.getTime() >= since).length + recordings.filter((item) => (data.links.get(item.id) ?? []).some((link) => link.subjectId === id)).length }));
    const material = [
      "RECORDINGS THIS WEEK:",
      ...recordings.slice(0, 25).map((item) => `- ${item.title ? `${item.title}: ` : ""}${plainSnippet(item.transcript, 400) ?? "(no text yet)"}`),
      "WRITTEN IDEAS THIS WEEK:",
      ...ideas.slice(0, 25).map((row) => `- [${row.subjectTitle}] ${plainSnippet(row.idea.content, 300)}`),
      "NOTEBOOKS (id, title, total ideas, new this week):",
      ...notebooks.map((notebook) => `- ${notebook.id} | ${notebook.title} | ${notebook.ideas} | ${notebook.thisWeek}`),
      `TASKS: ${tasks.filter((task) => !task.done).length} open, ${tasks.filter((task) => task.done && task.doneAt && task.doneAt.getTime() >= since).length} done this week.`,
    ].join("\n");
    const response = await openai.chat.completions.create({
      model: textModel(),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: [
          `You write a short, warm weekly digest of a person's own ideas and voice notes, in ${arabic ? "Arabic" : "English"}, speaking to them as "you".`,
          "Find the real themes across the week (connect ideas from different notes), the open questions they raised but haven't answered, and which notebooks have enough material to become a draft now.",
          "Return JSON: {\"headline\": one encouraging sentence about the week, \"themes\": [{\"title\": 2-5 words, \"summary\": 1-2 sentences}] (2-4), \"questions\": [open questions, as questions] (0-3), \"ready\": [{\"subjectId\": a notebook id from the list, \"reason\": one sentence}] (0-2), \"nudge\": one small concrete next step}.",
          "Use only what is in the material. Do not invent facts.",
        ].join(" ") },
        { role: "user", content: material.slice(0, 30_000) },
      ],
    }, { timeout: 90_000, maxRetries: 1 });
    const raw = JSON.parse(response.choices[0]?.message?.content || "{}");
    const digest = parseDigest(raw, new Set(notebooks.map((notebook) => notebook.id)));
    if (!digest) { res.status(422).json({ error: arabic ? "تعذر كتابة الملخص. حاول مجددًا." : "The digest couldn't be written. Please try again." }); return; }
    await db.insert(weeklyDigestsTable).values({ week, language: arabic ? "ar" : "en", content: digest })
      .onConflictDoUpdate({ target: weeklyDigestsTable.week, set: { language: arabic ? "ar" : "en", content: digest, createdAt: new Date() } });
    res.json(await respond(week, offset));
  } catch (error) {
    console.warn("Digest failed:", (error as Error).message);
    res.status(502).json({ error: arabic ? "تعذر كتابة الملخص الآن." : "The digest couldn't be written right now." });
  }
});

export default router;
