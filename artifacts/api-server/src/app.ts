import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import path from "node:path";
import { privateAccess } from "./lib/private-access";
import { localUpload } from "./lib/storage-service";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.set("trust proxy", "loopback");
app.use(privateAccess());
app.use(cors({ credentials: true, origin: process.env.APP_ORIGIN || true }));
app.put("/api/storage/local-upload/:id", localUpload());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API endpoint not found" });
});

if (process.env.FRONTEND_DIST) {
  const directory = path.resolve(process.env.FRONTEND_DIST);
  app.use(
    express.static(directory, {
      setHeaders(res, file) {
        if (file.endsWith("index.html") || file.endsWith("recorder-sw.js"))
          res.setHeader("Cache-Control", "no-cache");
      },
    }),
  );
  app.get("/{*path}", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(directory, "index.html"));
  });
}

export default app;
