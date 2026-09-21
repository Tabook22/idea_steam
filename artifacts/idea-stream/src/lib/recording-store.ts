export type RecordingStatus = "recording" | "saved" | "synced";
export interface LocalRecording {
  id: string;
  title: string;
  capturedAt: string;
  updatedAt: number;
  durationSeconds: number;
  bytes: number;
  chunks: number;
  mimeType: string;
  language: "en" | "ar";
  subjectId: number | null;
  status: RecordingStatus;
  interrupted?: boolean;
  transcript?: string;
  transcriptionStatus?: "done" | "unavailable" | "too-large";
  uploadedAudio?: { url: string; name: string; mimeType: string };
  ideaId?: number;
  error?: string;
  attempts: number;
  nextRetryAt: number;
}

/** Chunk writes and their metadata commit together. Never discard the local original on sync. */
export class RecordingStore {
  private database: Promise<IDBDatabase> | undefined;
  private name: string;
  constructor(name = "idea-stream-recordings-v1") {
    this.name = name;
  }
  private open() {
    this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("recordings", { keyPath: "id" });
        request.result
          .createObjectStore("chunks", { keyPath: ["recordingId", "index"] })
          .createIndex("recordingId", "recordingId");
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => {
        this.database = undefined;
        reject(request.error);
      };
      request.onblocked = () =>
        reject(
          new Error(
            "Close other Idea Stream tabs to upgrade recording storage.",
          ),
        );
    });
    return this.database;
  }
  private async transaction<T>(
    names: string[],
    mode: IDBTransactionMode,
    work: (tx: IDBTransaction, result: (value: T) => void) => void,
  ): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(names, mode);
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onerror = () =>
        reject(tx.error || new Error("Recording storage failed"));
      tx.onabort = () =>
        reject(tx.error || new Error("Recording storage was interrupted"));
      try {
        work(tx, (next) => {
          value = next;
        });
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
  }
  async create(record: LocalRecording) {
    await this.transaction(["recordings"], "readwrite", (tx) => {
      tx.objectStore("recordings").add(record);
    });
  }
  async get(id: string): Promise<LocalRecording | undefined> {
    return this.transaction(["recordings"], "readonly", (tx, done) => {
      const req = tx.objectStore("recordings").get(id);
      req.onsuccess = () => done(req.result);
    });
  }
  async list(): Promise<LocalRecording[]> {
    const records = await this.transaction<LocalRecording[]>(
      ["recordings"],
      "readonly",
      (tx, done) => {
        const req = tx.objectStore("recordings").getAll();
        req.onsuccess = () => done(req.result);
      },
    );
    return records.sort(
      (a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt),
    );
  }
  async patch(id: string, changes: Partial<LocalRecording>): Promise<void> {
    await this.transaction(["recordings"], "readwrite", (tx) => {
      const store = tx.objectStore("recordings");
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result)
          store.put({ ...req.result, ...changes, id, updatedAt: Date.now() });
      };
    });
  }
  async append(id: string, blob: Blob, durationSeconds: number): Promise<void> {
    if (!blob.size) return;
    await this.transaction(["recordings", "chunks"], "readwrite", (tx) => {
      const records = tx.objectStore("recordings");
      const req = records.get(id);
      req.onsuccess = () => {
        const record = req.result as LocalRecording | undefined;
        if (!record || record.status !== "recording") {
          tx.abort();
          return;
        }
        tx.objectStore("chunks").add({
          recordingId: id,
          index: record.chunks,
          blob,
        });
        records.put({
          ...record,
          mimeType: record.mimeType || blob.type,
          chunks: record.chunks + 1,
          bytes: record.bytes + blob.size,
          durationSeconds,
          updatedAt: Date.now(),
        });
      };
    });
  }
  async audio(id: string): Promise<Blob> {
    return this.transaction(
      ["recordings", "chunks"],
      "readonly",
      (tx, done) => {
        const meta = tx.objectStore("recordings").get(id);
        meta.onsuccess = () => {
          const req = tx
            .objectStore("chunks")
            .index("recordingId")
            .getAll(IDBKeyRange.only(id));
          req.onsuccess = () =>
            done(
              new Blob(
                req.result
                  .sort((a, b) => a.index - b.index)
                  .map((item) => item.blob),
                { type: meta.result?.mimeType || "audio/webm" },
              ),
            );
        };
      },
    );
  }
  /** Only call while holding the microphone lock: another tab may still be recording. */
  async recoverInterrupted() {
    for (const record of await this.list()) {
      if (record.status !== "recording") continue;
      if (record.bytes)
        await this.patch(record.id, { status: "saved", interrupted: true });
      else await this.remove(record.id);
    }
  }
  async remove(id: string) {
    await this.transaction(["recordings", "chunks"], "readwrite", (tx) => {
      tx.objectStore("recordings").delete(id);
      const cursor = tx
        .objectStore("chunks")
        .index("recordingId")
        .openCursor(IDBKeyRange.only(id));
      cursor.onsuccess = () => {
        if (cursor.result) {
          cursor.result.delete();
          cursor.result.continue();
        }
      };
    });
  }
  async replaceAudio(id: string, blob: Blob) {
    await this.transaction(["recordings", "chunks"], "readwrite", (tx) => {
      const meta = tx.objectStore("recordings").get(id);
      meta.onsuccess = () => {
        if (!meta.result) {
          tx.abort();
          return;
        }
        const cursor = tx
          .objectStore("chunks")
          .index("recordingId")
          .openCursor(IDBKeyRange.only(id));
        cursor.onsuccess = () => {
          if (cursor.result) {
            cursor.result.delete();
            cursor.result.continue();
          } else {
            tx.objectStore("chunks").put({ recordingId: id, index: 0, blob });
            tx.objectStore("recordings").put({
              ...meta.result,
              status: "saved",
              mimeType: blob.type,
              bytes: blob.size,
              chunks: 1,
              interrupted: true,
              updatedAt: Date.now(),
            });
          }
        };
      };
    });
  }
}
