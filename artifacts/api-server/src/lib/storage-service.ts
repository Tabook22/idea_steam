import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  readFile,
  writeFile,
  stat,
  rename,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { RequestHandler } from "express";
import type { File } from "@google-cloud/storage";
import {
  ObjectStorageService as CloudStorage,
  ObjectNotFoundError,
} from "./objectStorage";
export { ObjectNotFoundError } from "./objectStorage";

const MAX_UPLOAD = 50 * 1024 * 1024;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
type LocalFile = {
  localId: string;
  root: string;
  size: number;
  contentType: string;
};
type UploadMetadata = { size: number; contentType?: string };
const signature = (secret: string, message: string) =>
  createHmac("sha256", secret).update(message).digest("hex");
function safeType(value: string) {
  const mime = value.split(";")[0].toLowerCase();
  return /^(audio|video)\/[a-z0-9.+-]+$/.test(mime) ||
    /^(image\/(png|jpeg|webp|gif|avif)|application\/pdf|text\/plain)$/.test(
      mime,
    )
    ? mime
    : "application/octet-stream";
}

export class ObjectStorageService {
  private cloud = new CloudStorage();
  private env: NodeJS.ProcessEnv;
  constructor(env = process.env) {
    this.env = env;
  }
  async getObjectEntityUploadURL(
    folder = "uploads",
    metadata?: UploadMetadata,
  ) {
    if (!this.env.LOCAL_STORAGE_DIR)
      return this.cloud.getObjectEntityUploadURL(folder);
    const secret = this.env.UPLOAD_SIGNING_SECRET;
    if (!secret || secret.length < 32)
      throw new Error(
        "UPLOAD_SIGNING_SECRET must contain at least 32 characters",
      );
    if (
      !metadata ||
      !Number.isSafeInteger(metadata.size) ||
      metadata.size <= 0 ||
      metadata.size > MAX_UPLOAD
    )
      throw new Error("Upload must be between 1 byte and 50 MB");
    const id = randomUUID();
    const payload = Buffer.from(
      JSON.stringify({
        id,
        size: metadata.size,
        contentType: safeType(metadata.contentType || ""),
        expires: Date.now() + 15 * 60_000,
      }),
    ).toString("base64url");
    const base = (this.env.APP_BASE_PATH || "").replace(/\/$/, "");
    const origin = this.env.APP_ORIGIN || `http://127.0.0.1:${this.env.PORT || "5000"}`;
    return new URL(`${base}/api/storage/local-upload/${id}?token=${payload}.${signature(secret, payload)}`, origin).href;
  }
  normalizeObjectEntityPath(url: string) {
    if (!this.env.LOCAL_STORAGE_DIR)
      return this.cloud.normalizeObjectEntityPath(url);
    const id = new URL(url, "http://local").pathname.split("/").at(-1) || "";
    if (!uuid.test(id)) throw new ObjectNotFoundError();
    return `/objects/${id}`;
  }
  async getObjectEntityFile(path: string): Promise<File | LocalFile> {
    const root = this.env.LOCAL_STORAGE_DIR;
    if (!root) return this.cloud.getObjectEntityFile(path);
    const id = path.slice("/objects/".length);
    if (!path.startsWith("/objects/") || !uuid.test(id))
      throw new ObjectNotFoundError();
    try {
      const meta = JSON.parse(await readFile(join(root, `${id}.json`), "utf8"));
      const info = await stat(join(root, id));
      return {
        localId: id,
        root,
        size: info.size,
        contentType: safeType(meta.contentType),
      };
    } catch {
      throw new ObjectNotFoundError();
    }
  }
  async searchPublicObject(path: string): Promise<File | null> {
    if (this.env.LOCAL_STORAGE_DIR) return null;
    return this.cloud.searchPublicObject(path);
  }
  async downloadObject(file: File | LocalFile, cacheTtlSec = 3600) {
    if (!("localId" in file))
      return this.cloud.downloadObject(file, cacheTtlSec);
    return new Response(
      Readable.toWeb(
        createReadStream(join(file.root, file.localId)),
      ) as ReadableStream,
      {
        headers: {
          "Content-Type": file.contentType,
          "Content-Length": String(file.size),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          ...(file.contentType === "application/octet-stream"
            ? { "Content-Disposition": "attachment" }
            : {}),
        },
      },
    );
  }
}

/** Stream bounded, signed uploads to disk; publish only after the complete body has arrived. */
export function localUpload(env = process.env): RequestHandler {
  return async (req, res) => {
    const root = env.LOCAL_STORAGE_DIR;
    if (!root || !env.UPLOAD_SIGNING_SECRET) {
      res.sendStatus(404);
      return;
    }
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const [payload, mac] = token.split(".");
    let meta: {
      id: string;
      size: number;
      contentType: string;
      expires: number;
    };
    try {
      if (
        !payload ||
        !/^[a-f0-9]{64}$/.test(mac) ||
        !timingSafeEqual(
          Buffer.from(mac, "hex"),
          Buffer.from(signature(env.UPLOAD_SIGNING_SECRET, payload), "hex"),
        )
      )
        throw new Error("Invalid signature");
      meta = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      if (
        !uuid.test(meta.id) ||
        meta.id !== req.params.id ||
        meta.expires < Date.now() ||
        !Number.isSafeInteger(meta.size) ||
        meta.size <= 0 ||
        meta.size > MAX_UPLOAD
      )
        throw new Error("Invalid upload");
    } catch {
      res.status(403).json({ error: "Invalid or expired upload URL" });
      return;
    }
    await mkdir(root, { recursive: true, mode: 0o700 });
    const temporary = join(root, `${meta.id}.${randomUUID()}.partial`);
    let bytes = 0;
    try {
      await pipeline(
        req,
        new Transform({
          transform(chunk, _encoding, callback) {
            bytes += chunk.length;
            callback(
              bytes > meta.size
                ? new Error("Upload exceeds declared size")
                : null,
              chunk,
            );
          },
        }),
        createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
      );
      if (bytes !== meta.size) throw new Error("Incomplete upload");
      await rename(temporary, join(root, meta.id));
      await writeFile(
        join(root, `${meta.id}.json`),
        JSON.stringify({ contentType: safeType(meta.contentType) }),
        { mode: 0o600 },
      );
      res.status(200).json({ saved: true });
    } catch {
      await unlink(temporary).catch(() => {});
      if (!res.headersSent && !res.destroyed)
        res
          .status(400)
          .json({ error: "Upload incomplete; retry from the original file" });
    }
  };
}
