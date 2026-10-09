/**
 * Visuals from a Creation studio draft. The AI reads the draft and plans visuals: pictures it then
 * draws (illustration, cartoon, …) and diagrams the app draws itself from exact data (concept map,
 * steps, timeline, comparison, chart, key facts), so labels are always spelled right, in Arabic too.
 */

export const VISUAL_KINDS = ["picture", "concept", "steps", "timeline", "compare", "chart", "facts"] as const;
export type VisualKind = (typeof VISUAL_KINDS)[number];

/** Picture styles: how each one is described to the image model. */
export const PICTURE_STYLES: Record<string, string> = {
  cartoon: "a friendly cartoon illustration with bold clean outlines, flat bright colours and expressive, likeable characters",
  illustration: "a clean modern editorial illustration in a flat vector style with soft gradients and a limited, harmonious palette",
  textbook: "a clear scientific textbook illustration on a plain white background, accurate shapes and proportions, the look of a well-drawn educational figure",
  sketch: "a hand-drawn whiteboard sketch in black marker with a few accent colours, like a teacher explaining on a whiteboard",
  watercolor: "a soft watercolour illustration on textured paper with gentle washes of colour",
  clay: "a playful 3D clay-style render with soft studio lighting and rounded shapes",
  comic: "a comic strip of three panels side by side that tells the idea as a small story, with clear simple drawings",
  realistic: "a realistic, photo-like image with natural light and a clear subject",
};
export const AUDIENCES: Record<string, string> = {
  kids: "young children: simple, warm, cheerful and safe, one big clear idea",
  students: "school and university students: clear and memorable, focused on understanding",
  adults: "general adult readers: polished and engaging",
  experts: "specialists: precise and detailed, nothing childish",
};

export type VisualPlanItem = {
  kind: VisualKind;
  title: string;
  caption: string;
  why: string;
  anchor: string;
  spec: Record<string, unknown>;
};

const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
const list = (value: unknown, max: number) => (Array.isArray(value) ? value.slice(0, max) : []);
const object = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/** The draft as plain text (drafts may be rich text). */
export function plainDraft(content: string) {
  return content
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(br|\/p|\/h[1-6]|\/li|\/div|\/blockquote)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function planPrompt(options: { kinds: VisualKind[]; count: number; audience: string; language: string; request?: string }) {
  const kinds: Record<VisualKind, string> = {
    picture: `"picture": an illustration of a scene, metaphor or example. spec: {"prompt": "in English, 40-90 words: what to draw (subjects, setting, composition, mood) so it explains the idea; no words, letters or numbers in the picture"}`,
    concept: `"concept": a concept map. spec: {"center": "the main idea", "branches": [{"label": "...", "items": ["...", "..."]}]} with 3-6 branches and 0-4 items each`,
    steps: `"steps": a process or sequence. spec: {"steps": [{"title": "...", "detail": "one short sentence"}]} with 3-7 steps in order`,
    timeline: `"timeline": events in time. spec: {"events": [{"when": "date or period as written", "title": "...", "detail": "short"}]} with 3-8 events in order`,
    compare: `"compare": a comparison table. spec: {"columns": ["A", "B"], "rows": [{"label": "aspect", "values": ["for A", "for B"]}]} with 2-3 columns and 2-7 rows`,
    chart: `"chart": a bar or pie chart. spec: {"type": "bar" or "pie", "unit": "e.g. % or students", "data": [{"label": "...", "value": number}]} with 2-8 values. ONLY when the draft itself gives these numbers; never estimate or invent numbers`,
    facts: `"facts": key facts at a glance. spec: {"facts": [{"icon": "one emoji", "value": "short number or word", "label": "what it means"}]} with 3-6 facts taken from the draft`,
  };
  return [
    "You are an instructional designer and visual explainer. Read the draft carefully, understand its message, and plan visuals that help a reader understand and remember it.",
    `Audience: ${AUDIENCES[options.audience] ?? AUDIENCES.students}.`,
    options.request
      ? `The user asked for this visual: "${options.request}". Plan exactly 1 visual that does it, choosing the best kind from the allowed ones.`
      : `Plan up to ${options.count} visuals, each for a different part or idea of the draft, ordered as they appear in it. Use the kind that suits each idea best and give the reader variety: different kinds where the draft allows it, no two of the same kind unless the draft clearly needs it, and pictures for at most half of them.`,
    "Allowed kinds:",
    ...options.kinds.map((kind) => `- ${kinds[kind]}`),
    "Rules:",
    "- Be faithful to the draft: use only its facts, names and numbers. Never invent data, dates, quotes or statistics.",
    `- Every title, caption, label and item is in ${options.language === "ar" ? "Arabic" : options.language === "en" ? "English" : "the language of the draft"}, short (labels up to 6 words). The picture prompt is always in English.`,
    "- caption: one sentence a teacher would say to explain the visual. why: a few words on why it helps here.",
    "- anchor: copy exactly 4-12 consecutive words from the paragraph this visual should follow.",
    'Answer with JSON only: {"visuals": [{"kind": "...", "title": "...", "caption": "...", "why": "...", "anchor": "...", "spec": {...}}]}',
  ].join("\n");
}

/** Checks one visual's data and keeps it within what the app can draw. Null when unusable. */
export function cleanSpec(kind: VisualKind, raw: unknown): Record<string, unknown> | null {
  const spec = object(raw);
  switch (kind) {
    case "picture": {
      const prompt = text(spec.prompt, 1200);
      return prompt.length >= 10 ? { prompt } : null;
    }
    case "concept": {
      const branches = list(spec.branches, 6).map((value) => {
        const branch = object(value);
        return { label: text(branch.label, 60), items: list(branch.items, 4).map((item) => text(item, 70)).filter(Boolean) };
      }).filter((branch) => branch.label);
      const center = text(spec.center, 60);
      return center && branches.length >= 2 ? { center, branches } : null;
    }
    case "steps": {
      const steps = list(spec.steps, 8).map((value) => ({ title: text(object(value).title, 60), detail: text(object(value).detail, 140) })).filter((step) => step.title);
      return steps.length >= 2 ? { steps } : null;
    }
    case "timeline": {
      const events = list(spec.events, 8).map((value) => ({ when: text(object(value).when, 30), title: text(object(value).title, 60), detail: text(object(value).detail, 120) })).filter((event) => event.title);
      return events.length >= 2 ? { events } : null;
    }
    case "compare": {
      const columns = list(spec.columns, 3).map((column) => text(column, 40)).filter(Boolean);
      if (columns.length < 2) return null;
      const rows = list(spec.rows, 7).map((value) => {
        const row = object(value);
        const values = list(row.values, columns.length).map((cell) => text(cell, 90));
        while (values.length < columns.length) values.push("");
        return { label: text(row.label, 50), values };
      }).filter((row) => row.label && row.values.some(Boolean));
      return rows.length >= 1 ? { columns, rows } : null;
    }
    case "chart": {
      const data = list(spec.data, 8).map((value) => ({ label: text(object(value).label, 40), value: Number(object(value).value) }))
        .filter((point) => point.label && Number.isFinite(point.value) && point.value >= 0);
      return data.length >= 2 ? { type: spec.type === "pie" ? "pie" : "bar", unit: text(spec.unit, 20), data } : null;
    }
    case "facts": {
      const facts = list(spec.facts, 6).map((value) => ({ icon: text(object(value).icon, 8), value: text(object(value).value, 24), label: text(object(value).label, 80) })).filter((fact) => fact.value && fact.label);
      return facts.length >= 2 ? { facts } : null;
    }
  }
}

/** The AI's plan, checked: known and allowed kinds, usable data, sensible text. */
export function cleanPlan(raw: unknown, allowed: VisualKind[], max: number): VisualPlanItem[] {
  const out: VisualPlanItem[] = [];
  for (const value of list(object(raw).visuals, 12)) {
    const item = object(value);
    const kind = item.kind as VisualKind;
    if (!allowed.includes(kind)) continue;
    const spec = cleanSpec(kind, item.spec);
    if (!spec) continue;
    out.push({ kind, title: text(item.title, 120) || "Visual", caption: text(item.caption, 300), why: text(item.why, 160), anchor: text(item.anchor, 160), spec });
    if (out.length >= max) break;
  }
  return out;
}

/** What the image model is asked to draw. */
export function picturePrompt(prompt: string, style: string, audience: string) {
  return [
    `Create ${PICTURE_STYLES[style] ?? PICTURE_STYLES.illustration}.`,
    `It is for ${AUDIENCES[audience] ?? AUDIENCES.students}.`,
    `Subject: ${prompt}`,
    "Make the idea instantly clear: one focal point, uncluttered composition, good contrast.",
    "Absolutely no words, letters, numbers, captions or labels anywhere in the image.",
  ].join(" ");
}


/** Retouching a drawn picture: change only what's asked, keep the rest exactly. */
export function retouchPrompt(wish: string, style: string) {
  return [
    `Edit this picture: ${wish}.`,
    `Keep everything else exactly as it is: the same composition, characters, objects, colours and style (${PICTURE_STYLES[style] ?? PICTURE_STYLES.illustration}), unless the change asks otherwise.`,
    "Absolutely no words, letters, numbers, captions or labels anywhere in the image.",
  ].join(" ");
}

/** A draft's picture URLs end in the stored file's id; swapping a picture swaps that id. */
export const storedId = (url: string | null | undefined) => url?.match(/[a-f0-9-]{36}$/)?.[0] ?? null;
