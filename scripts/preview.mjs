/** Local design preview only. All records are synthetic and live in memory. */
import { createServer as createHttpServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
const requireFrontend = createRequire(
  new URL("../artifacts/idea-stream/package.json", import.meta.url),
);
const { createServer } = await import(
  pathToFileURL(requireFrontend.resolve("vite")).href
);
const now = new Date().toISOString();
let nextId = 100;
const notebooks = [
  {
    id: 1,
    title: "The art of paying attention",
    intro:
      "Small observations about creativity, everyday life, and seeing familiar things differently.",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 2,
    title: "Learning beyond the classroom",
    intro:
      "Questions and research directions for a more curious, human approach to education.",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 3,
    title: "Stories worth telling",
    intro:
      "Seeds for the next video: a good question, an unexpected connection, a different perspective.",
    createdAt: now,
    updatedAt: now,
  },
];
const ideas = [
  {
    id: 11,
    subjectId: 1,
    content:
      "What if creativity begins with noticing, rather than inventing? Keep a small record of the things that interrupt an ordinary day.",
    source: "text",
    attachments: [],
    createdAt: now,
  },
  {
    id: 12,
    subjectId: 1,
    content:
      "An article could connect a walk without headphones, a conversation with a stranger, and the habit of writing one observation each evening.",
    source: "text",
    attachments: [],
    createdAt: now,
  },
  {
    id: 21,
    subjectId: 2,
    content:
      "Research question: How might short reflective journals help students recognize connections between their courses and everyday experiences? This needs evidence and a study design.",
    source: "text",
    attachments: [],
    createdAt: now,
  },
  {
    id: 31,
    subjectId: 3,
    content:
      "Video idea: follow one passing thought from a voice memo to a finished story. Show the messy middle, not just the polished result.",
    source: "text",
    attachments: [],
    createdAt: now,
  },
];
const drafts = [];
const audioUploads = new Map();
const serialize = (notebook) => ({
  ...notebook,
  ideaCount: ideas.filter((idea) => idea.subjectId === notebook.id).length,
});
const api = createHttpServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  const send = (value, status = 200) => {
    res.statusCode = status;
    res.end(JSON.stringify(value));
  };
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    const path = url.pathname;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (path.startsWith("/api/preview-audio/") && req.method === "PUT") {
      audioUploads.set(path.slice("/api/preview-audio/".length), {
        data: Buffer.concat(chunks),
        type: req.headers["content-type"] || "audio/webm",
      });
      return send({});
    }
    if (path.startsWith("/api/storage/objects/") && req.method === "GET") {
      const audio = audioUploads.get(
        path.slice("/api/storage/objects/".length),
      );
      if (!audio)
        return send(
          {
            error:
              "Preview audio resets when the server restarts; the device copy is still in the recorder.",
          },
          404,
        );
      res.setHeader("Content-Type", audio.type);
      return res.end(audio.data);
    }
    const body = chunks.length
      ? JSON.parse(Buffer.concat(chunks).toString())
      : {};
    if (path === "/api/storage/uploads/request-url" && req.method === "POST") {
      const id = crypto.randomUUID();
      return send({
        uploadURL: `/api/preview-audio/${id}`,
        objectPath: `/objects/${id}`,
      });
    }
    if (path === "/api/transcriptions")
      return send({
        text: "[Preview transcript — simulated, not your recorded words.] Your original audio is available to play. Connect the real backend for transcription.",
      });
    if (path === "/api/subjects") {
      if (req.method === "GET") return send(notebooks.map(serialize));
      if (req.method === "POST") {
        const notebook = {
          id: ++nextId,
          title: body.title,
          intro: body.intro || "",
          createdAt: now,
          updatedAt: now,
        };
        notebooks.unshift(notebook);
        return send(serialize(notebook), 201);
      }
    }
    const match = path.match(
      /^\/api\/subjects\/(\d+)(?:\/(ideas|compilations|compile))?$/,
    );
    if (match) {
      const id = Number(match[1]);
      const notebook = notebooks.find((n) => n.id === id);
      if (!notebook) return send({ error: "Preview notebook not found" }, 404);
      if (!match[2]) {
        if (req.method === "PATCH")
          Object.assign(notebook, body, {
            updatedAt: new Date().toISOString(),
          });
        if (req.method === "DELETE") {
          notebooks.splice(notebooks.indexOf(notebook), 1);
          return send({});
        }
        return send({
          ...serialize(notebook),
          ideas: ideas.filter((i) => i.subjectId === id),
        });
      }
      if (match[2] === "ideas") {
        if (req.method === "POST") {
          const existing =
            body.clientCaptureId &&
            ideas.find((idea) => idea.clientCaptureId === body.clientCaptureId);
          if (existing) return send(existing);
          const idea = {
            ...body,
            id: ++nextId,
            subjectId: id,
            attachments: body.attachments || [],
            createdAt: body.capturedAt || new Date().toISOString(),
          };
          ideas.unshift(idea);
          notebook.updatedAt = idea.createdAt;
          return send(idea, 201);
        }
        return send(ideas.filter((i) => i.subjectId === id));
      }
      if (match[2] === "compilations")
        return send(drafts.filter((d) => d.subjectId === id));
      if (match[2] === "compile" && req.method === "POST") {
        const draft = {
          id: ++nextId,
          subjectId: id,
          tone: body.tone,
          content: `# Design preview draft\n\nThis is a simulated draft for testing the editor. Connect the real API to generate original work.\n\n## Your starting material\n\n${ideas
            .filter((i) => i.subjectId === id)
            .map((i) => i.content)
            .join("\n\n")}`,
          createdAt: now,
          updatedAt: now,
        };
        drafts.unshift(draft);
        return send(draft);
      }
    }
    const ideaMatch = path.match(/^\/api\/ideas\/(\d+)$/);
    if (ideaMatch) {
      const index = ideas.findIndex((i) => i.id === Number(ideaMatch[1]));
      if (index < 0) return send({ error: "Not found" }, 404);
      if (req.method === "PATCH") {
        if (
          body.subjectId !== undefined &&
          !notebooks.some((n) => n.id === body.subjectId)
        )
          return send({ error: "Destination notebook not found" }, 404);
        const previous = ideas[index].subjectId;
        Object.assign(ideas[index], body);
        for (const notebook of notebooks)
          if ([previous, ideas[index].subjectId].includes(notebook.id))
            notebook.updatedAt = new Date().toISOString();
        return send(ideas[index]);
      }
      if (req.method === "DELETE") {
        ideas.splice(index, 1);
        return send({});
      }
    }
    const draftMatch = path.match(
      /^\/api\/subjects\/\d+\/compilations\/(\d+)$/,
    );
    if (draftMatch) {
      const index = drafts.findIndex((d) => d.id === Number(draftMatch[1]));
      if (index < 0) return send({ error: "Not found" }, 404);
      if (req.method === "PATCH") {
        Object.assign(drafts[index], body);
        return send(drafts[index]);
      }
      if (req.method === "DELETE") {
        drafts.splice(index, 1);
        return send({});
      }
    }
    if (path === "/api/youtube-transcripts")
      return send({
        text: "[Preview captions] Every meaningful project starts with an idea. Capture the thought, collect the connections, then create something new.",
      });
    return send(
      {
        error:
          "This service needs the real backend; it is unavailable in design preview.",
      },
      503,
    );
  } catch {
    send({ error: "Invalid preview request" }, 400);
  }
});
await new Promise((resolve) => api.listen(5174, "127.0.0.1", resolve));
process.env.VITE_DESIGN_PREVIEW = "true";
process.env.API_PROXY_TARGET = "http://127.0.0.1:5174";
process.env.PORT = "5173";
const vite = await createServer({
  configFile: fileURLToPath(
    new URL("../artifacts/idea-stream/vite.config.ts", import.meta.url),
  ),
  server: { host: "127.0.0.1" },
});
await vite.listen();
vite.printUrls();
console.log(
  "Design preview only. Synthetic data resets on restart. No database or AI credentials are used.",
);
async function close() {
  await vite.close();
  api.close();
  process.exit();
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
