import { Router, type IRouter } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import { compilationImagesTable, compilationVisualsTable, db, subjectCompilationsTable, type CompilationVisualRecord, type VisualVersion } from "@workspace/db";
import { ListCompilationVisualsParams, PlanCompilationVisualsBody, RedoVisualBody, RestoreVisualBody, UpdateVisualBody, UpdateVisualParams } from "@workspace/api-zod";
import { aiConfigured, openai, toFile } from "@workspace/integrations-openai-ai-server";
import { readStoredFile, storeBytes } from "../lib/audio-edit";
import { cleanPlan, PICTURE_STYLES, picturePrompt, plainDraft, planPrompt, retouchPrompt, storedId, VISUAL_KINDS, type VisualKind } from "../lib/visuals";

const router: IRouter = Router();
// Planning reads the whole draft carefully, so it uses the stronger model by default.
const planModel = () => process.env.OPENAI_VISUAL_PLAN_MODEL || (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ? (process.env.OPENAI_TEXT_MODEL || "gpt-5.6-luna") : "gpt-4.1");
const imageModel = () => process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
const STORED = /^\/api\/storage\/objects\/[a-f0-9-]{36}$/;

const view = (visual: CompilationVisualRecord) => ({
  id: visual.id, compilationId: visual.compilationId, kind: visual.kind, title: visual.title, caption: visual.caption, why: visual.why,
  anchor: visual.anchor, style: visual.style, spec: visual.spec, status: visual.status, imageUrl: visual.imageUrl, error: visual.error,
  history: (visual.history ?? []).map((version) => ({ imageUrl: version.imageUrl, title: version.title, note: version.note, at: version.at })),
  createdAt: visual.createdAt.toISOString(),
});
const MAX_VERSIONS = 15;
/** The visual as it is now, kept as a version before a change (`note` says what change follows). */
const versionOf = (visual: CompilationVisualRecord, note: string): VisualVersion => ({
  imageUrl: visual.imageUrl, title: visual.title, caption: visual.caption, style: visual.style,
  spec: Object.fromEntries(Object.entries(visual.spec).filter(([key]) => key !== "pending")), note, at: new Date().toISOString(),
});
const withVersion = (visual: CompilationVisualRecord, note: string) => [...(visual.history ?? []), versionOf(visual, note)].slice(-MAX_VERSIONS);

/** Where the draft shows one picture, it now shows another (same place, same caption). */
async function swapInDraft(compilationId: number, from: string | null, to: string | null) {
  const oldId = storedId(from), newId = storedId(to);
  if (!oldId || !newId || oldId === newId) return;
  await db.update(subjectCompilationsTable).set({ content: sql`replace(${subjectCompilationsTable.content}, ${oldId}, ${newId})` })
    .where(eq(subjectCompilationsTable.id, compilationId));
  await db.update(compilationImagesTable).set({ objectPath: sql`replace(${compilationImagesTable.objectPath}, ${oldId}, ${newId})` })
    .where(and(eq(compilationImagesTable.compilationId, compilationId), sql`${compilationImagesTable.objectPath} like ${"%" + oldId}`));
}
async function find(id: number) {
  const [visual] = await db.select().from(compilationVisualsTable).where(eq(compilationVisualsTable.id, id));
  return visual ?? null;
}
const visualId = (raw: unknown) => { const parsed = UpdateVisualParams.safeParse(raw); return parsed.success ? parsed.data.visualId : null; };

async function plan(draft: string, options: { kinds: VisualKind[]; count: number; audience: string; language: string; request?: string }) {
  const response = await openai.chat.completions.create({
    model: planModel(),
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: planPrompt(options) },
      { role: "user", content: `The draft:\n\n${draft.slice(0, 60_000)}` },
    ],
  }, { timeout: 120_000, maxRetries: 1 });
  let raw: unknown = null;
  try { raw = JSON.parse(response.choices[0]?.message?.content ?? "null"); } catch { /* treated as no visuals */ }
  return cleanPlan(raw, options.kinds, options.request ? 1 : options.count);
}

const drawing = new Set<number>();
let running = 0;
const queue: number[] = [];
/** Pictures are drawn in the background, two at a time (they take up to a minute each). */
function drawLater(id: number) {
  if (drawing.has(id)) return;
  drawing.add(id);
  queue.push(id);
  pump();
}
function pump() {
  while (running < 2 && queue.length) {
    const id = queue.shift()!;
    running++;
    void draw(id).finally(() => { running--; drawing.delete(id); pump(); });
  }
}
async function draw(id: number) {
  const visual = await find(id);
  if (!visual || visual.kind !== "picture") return;
  const pending = (visual.spec.pending ?? null) as { mode: "retouch" | "redraw"; wish?: string } | null;
  const { pending: _done, ...spec } = visual.spec;
  try {
    const audience = typeof visual.spec.audience === "string" ? visual.spec.audience : "students";
    // JPEG keeps drafts and PDFs light (a PNG is ten times bigger).
    const common = { model: imageModel(), size: "1536x1024", quality: "medium", output_format: "jpeg", output_compression: 88 };
    const result = pending?.mode === "retouch" && visual.imageUrl && pending.wish
      ? await openai.images.edit({
        ...common,
        image: await toFile(await readStoredFile(visual.imageUrl), "picture.jpg", { type: "image/jpeg" }),
        prompt: retouchPrompt(pending.wish, visual.style),
        input_fidelity: "high",
      } as unknown as Parameters<typeof openai.images.edit>[0], { timeout: 180_000, maxRetries: 1 })
      : await openai.images.generate({
        ...common,
        prompt: picturePrompt(String(visual.spec.prompt ?? visual.title), visual.style, audience),
      } as Parameters<typeof openai.images.generate>[0], { timeout: 180_000, maxRetries: 1 });
    const base64 = (result as { data?: Array<{ b64_json?: string }> }).data?.[0]?.b64_json;
    if (!base64) throw new Error("no image");
    const bytes = Buffer.from(base64, "base64");
    const url = await storeBytes(bytes, bytes[0] === 0x89 ? "image/png" : "image/jpeg");
    await db.update(compilationVisualsTable).set({ imageUrl: url, spec, status: "ready", error: null }).where(eq(compilationVisualsTable.id, id));
    // The draft shows the new version where it showed the old one.
    await swapInDraft(visual.compilationId, visual.imageUrl, url);
  } catch (error) {
    const message = (error as Error).message ?? "";
    console.warn("Visual: drawing failed:", message);
    const refused = /safety|policy|moderation|rejected/i.test(message);
    const friendly = refused ? "The picture service declined this one. Try describing it differently." : "The picture couldn't be drawn. Try again.";
    // A change that failed leaves the picture as it was.
    if (pending && visual.imageUrl) {
      const history = visual.history ?? [];
      const last = history.at(-1);
      await db.update(compilationVisualsTable).set({
        status: "ready", error: friendly, history: history.slice(0, -1),
        spec: last ? { ...last.spec, audience: spec.audience } : spec, style: last?.style ?? visual.style,
      }).where(eq(compilationVisualsTable.id, id));
    } else {
      await db.update(compilationVisualsTable).set({ status: "failed", error: friendly, spec }).where(eq(compilationVisualsTable.id, id));
    }
  }
}

// After a restart, pictures that were being drawn are drawn again.
setTimeout(() => {
  void db.select({ id: compilationVisualsTable.id }).from(compilationVisualsTable).where(eq(compilationVisualsTable.status, "drawing"))
    .then((rows) => rows.forEach((row) => drawLater(row.id))).catch(() => {});
}, 9000).unref?.();

router.get("/compilations/:compilationId/visuals", async (req, res): Promise<void> => {
  const params = ListCompilationVisualsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Unknown draft" }); return; }
  const visuals = await db.select().from(compilationVisualsTable).where(eq(compilationVisualsTable.compilationId, params.data.compilationId))
    .orderBy(asc(compilationVisualsTable.position), asc(compilationVisualsTable.id));
  res.json(visuals.map(view));
});

router.post("/compilations/:compilationId/visuals/plan", async (req, res): Promise<void> => {
  const params = ListCompilationVisualsParams.safeParse(req.params);
  const body = PlanCompilationVisualsBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Choose at least one kind of visual." }); return; }
  const [compilation] = await db.select().from(subjectCompilationsTable).where(eq(subjectCompilationsTable.id, params.data.compilationId));
  if (!compilation) { res.status(404).json({ error: "Draft not found" }); return; }
  if (!aiConfigured) { res.status(503).json({ error: "AI is not configured yet, so visuals can't be made." }); return; }
  const draft = plainDraft(compilation.content);
  if (draft.length < 40) { res.status(409).json({ error: "This draft is too short to illustrate." }); return; }
  const kinds = [...new Set(body.data.kinds)].filter((kind): kind is VisualKind => (VISUAL_KINDS as readonly string[]).includes(kind));
  const style = body.data.style && PICTURE_STYLES[body.data.style] ? body.data.style : "illustration";
  const audience = body.data.audience ?? "students";
  try {
    const items = await plan(draft, { kinds, count: body.data.count ?? 4, audience, language: body.data.language ?? "auto", request: body.data.request?.trim() || undefined });
    if (!items.length) { res.status(422).json({ error: "No visuals could be made from this draft. Try other kinds." }); return; }
    const existing = await db.select({ id: compilationVisualsTable.id }).from(compilationVisualsTable).where(eq(compilationVisualsTable.compilationId, compilation.id));
    const made = await db.insert(compilationVisualsTable).values(items.map((item, index) => ({
      compilationId: compilation.id,
      kind: item.kind, title: item.title, caption: item.caption, why: item.why, anchor: item.anchor,
      style: item.kind === "picture" ? style : "",
      spec: item.kind === "picture" ? { ...item.spec, audience } : item.spec,
      status: item.kind === "picture" ? "drawing" as const : "ready" as const,
      position: existing.length + index,
    }))).returning();
    made.filter((visual) => visual.kind === "picture").forEach((visual) => drawLater(visual.id));
    res.status(201).json(made.map(view));
  } catch (error) {
    console.warn("Visual plan failed:", (error as Error).message);
    res.status(502).json({ error: "The draft couldn't be read right now. Please try again." });
  }
});

router.post("/visuals/:visualId/redo", async (req, res): Promise<void> => {
  const id = visualId(req.params);
  const body = RedoVisualBody.safeParse(req.body ?? {});
  const visual = id === null ? null : await find(id);
  if (!visual || !body.success) { res.status(404).json({ error: "Visual not found" }); return; }
  if (!aiConfigured) { res.status(503).json({ error: "AI is not configured yet." }); return; }
  if (visual.status === "drawing") { res.status(409).json({ error: "It's still being drawn. Wait a moment." }); return; }
  const wish = body.data.wish?.trim();
  if (visual.kind === "picture") {
    const style = body.data.style && PICTURE_STYLES[body.data.style] ? body.data.style : visual.style;
    const retouch = body.data.mode === "retouch" && !!wish && !!visual.imageUrl && style === visual.style;
    const current = String(visual.spec.prompt ?? "");
    // Redraw: the user's own description, or the current one with the wish added.
    const prompt = body.data.prompt?.trim() || (wish && !retouch ? `${current} Also: ${wish}` : current);
    const note = retouch ? `Retouch: ${wish}` : body.data.prompt?.trim() ? "Redrawn from an edited description" : wish ? `Redraw: ${wish}` : style !== visual.style ? `Redraw in another style` : "Redraw";
    await db.update(compilationVisualsTable).set({
      style, status: "drawing", error: null,
      spec: { ...visual.spec, prompt, pending: { mode: retouch ? "retouch" : "redraw", wish: wish ?? "" } },
      // A picture that was never drawn has nothing to go back to.
      ...(visual.imageUrl ? { history: withVersion(visual, note) } : {}),
    }).where(eq(compilationVisualsTable.id, visual.id));
    drawLater(visual.id);
    res.json(view((await find(visual.id))!));
    return;
  }
  const [compilation] = await db.select().from(subjectCompilationsTable).where(eq(subjectCompilationsTable.id, visual.compilationId));
  if (!compilation) { res.status(404).json({ error: "Draft not found" }); return; }
  try {
    const request = `Remake the ${visual.kind} visual "${visual.title}" (now: ${JSON.stringify(visual.spec).slice(0, 2000)}).${wish ? ` Change: ${wish}` : " Make it clearer and better organised."}`;
    const [item] = await plan(plainDraft(compilation.content), { kinds: [visual.kind as VisualKind], count: 1, audience: "students", language: "auto", request });
    if (!item) { res.status(422).json({ error: "It couldn't be remade. Try a different wish." }); return; }
    // The old picture of the diagram no longer matches.
    await db.update(compilationVisualsTable).set({ title: item.title, caption: item.caption, why: item.why, anchor: item.anchor || visual.anchor, spec: item.spec, imageUrl: null, status: "ready", error: null, history: withVersion(visual, wish ? `Change: ${wish}` : "Remade") })
      .where(eq(compilationVisualsTable.id, visual.id));
    res.json(view((await find(visual.id))!));
  } catch (error) {
    console.warn("Visual redo failed:", (error as Error).message);
    res.status(502).json({ error: "It couldn't be remade right now. Please try again." });
  }
});

router.post("/visuals/:visualId/restore", async (req, res): Promise<void> => {
  const id = visualId(req.params);
  const body = RestoreVisualBody.safeParse(req.body);
  const visual = id === null ? null : await find(id);
  if (!visual || !body.success) { res.status(404).json({ error: "Visual not found" }); return; }
  if (visual.status === "drawing") { res.status(409).json({ error: "It's still being drawn. Wait a moment." }); return; }
  const history = visual.history ?? [];
  const chosen = history[body.data.version];
  if (!chosen) { res.status(404).json({ error: "That version no longer exists." }); return; }
  // The current one becomes a version, so going back can be undone.
  const rest = history.filter((_, index) => index !== body.data.version);
  await db.update(compilationVisualsTable).set({
    imageUrl: chosen.imageUrl, title: chosen.title, caption: chosen.caption, style: chosen.style, spec: chosen.spec, status: "ready", error: null,
    history: [...rest, versionOf(visual, "Went back to an earlier version")].slice(-MAX_VERSIONS),
  }).where(eq(compilationVisualsTable.id, visual.id));
  await swapInDraft(visual.compilationId, visual.imageUrl, chosen.imageUrl);
  res.json(view((await find(visual.id))!));
});

router.patch("/visuals/:visualId", async (req, res): Promise<void> => {
  const id = visualId(req.params);
  const body = UpdateVisualBody.safeParse(req.body);
  const visual = id === null ? null : await find(id);
  if (!visual || !body.success) { res.status(404).json({ error: "Visual not found" }); return; }
  const changes: Partial<typeof compilationVisualsTable.$inferInsert> = {};
  if (body.data.title !== undefined) {
    changes.title = body.data.title.trim();
    // Diagrams show their title, so their saved picture is made again.
    if (visual.kind !== "picture" && changes.title !== visual.title) changes.imageUrl = null;
  }
  if (body.data.caption !== undefined) changes.caption = body.data.caption.trim();
  // A diagram's picture, made by the app (pictures drawn by the AI keep theirs).
  if (body.data.imageUrl !== undefined && visual.kind !== "picture") {
    if (!STORED.test(body.data.imageUrl)) { res.status(400).json({ error: "Unknown picture" }); return; }
    changes.imageUrl = body.data.imageUrl;
  }
  if (Object.keys(changes).length) await db.update(compilationVisualsTable).set(changes).where(eq(compilationVisualsTable.id, visual.id));
  res.json(view((await find(visual.id))!));
});

router.delete("/visuals/:visualId", async (req, res): Promise<void> => {
  const id = visualId(req.params);
  if (id === null) { res.status(400).json({ error: "Unknown visual" }); return; }
  await db.delete(compilationVisualsTable).where(eq(compilationVisualsTable.id, id));
  res.sendStatus(204);
});

export default router;
