import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link } from "wouter";
import { Mic, Square } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { RecordingStore, type LocalRecording } from "@/lib/recording-store";
import { syncRecording } from "@/lib/recording-sync";
import { useLanguage } from "@/lib/i18n";

const preview = import.meta.env.VITE_DESIGN_PREVIEW === "true";
export const recordingStore = new RecordingStore(
  preview ? "idea-stream-preview-recordings-v1" : "idea-stream-recordings-v1",
);
const lockPrefix = preview ? "idea-stream-preview" : "idea-stream";
const mimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
type Stage = "idle" | "starting" | "recording" | "saving";
type Session = {
  id: string;
  recorder: MediaRecorder;
  stream: MediaStream;
  started: number;
  writes: Promise<void>;
  chunks: Blob[];
  failed: boolean;
  interrupted: boolean;
  release: () => void;
  limit: number;
};
type RecorderContextValue = {
  records: LocalRecording[];
  stage: Stage;
  seconds: number;
  activeId: string | null;
  ready: boolean;
  error: string | null;
  syncingId: string | null;
  online: boolean;
  rescue: { id: string; url: string; blob: Blob } | null;
  start: (subjectId?: number | null, limit?: number) => Promise<void>;
  stop: () => void;
  refresh: () => Promise<void>;
  sync: (force?: boolean) => Promise<void>;
  retryRescue: () => Promise<void>;
};
const RecorderContext = createContext<RecorderContextValue | null>(null);

async function microphoneLock(): Promise<() => void> {
  if (!navigator.locks) return () => {};
  return new Promise((resolve, reject) => {
    navigator.locks
      .request(`${lockPrefix}-microphone`, { ifAvailable: true }, (lock) => {
        if (!lock) {
          reject(
            new Error(
              "Another tab is recording. Return to that tab to stop and save.",
            ),
          );
          return;
        }
        return new Promise<void>((release) => resolve(release));
      })
      .catch(reject);
  });
}

export function RecorderProvider({ children }: { children: ReactNode }) {
  const [records, setRecords] = useState<LocalRecording[]>([]);
  const [stage, setStage] = useState<Stage>("idle");
  const [seconds, setSeconds] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [rescue, setRescue] = useState<RecorderContextValue["rescue"]>(null);
  const session = useRef<Session | null>(null);
  const preparing = useRef(false);
  const syncing = useRef(false);
  const mounted = useRef(true);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const { language, isArabic } = useLanguage();
  const queryClient = useQueryClient();
  const refresh = useCallback(async () => {
    const list = await recordingStore.list();
    if (mounted.current) setRecords(list);
  }, []);
  const sync = useCallback(
    async (force = false) => {
      if (
        syncing.current ||
        !navigator.onLine ||
        session.current ||
        preparing.current
      )
        return;
      syncing.current = true;
      const work = async () => {
        try {
          for (const record of await recordingStore.list()) {
            if (session.current || preparing.current) break;
            if (
              record.status !== "saved" ||
              (!force && record.nextRetryAt > Date.now())
            )
              continue;
            setSyncingId(record.id);
            const idea = await syncRecording(recordingStore, record.id);
            if (idea) await queryClient.invalidateQueries();
            await refresh();
          }
        } finally {
          setSyncingId(null);
        }
      };
      try {
        if (navigator.locks)
          await navigator.locks.request(
            `${lockPrefix}-sync`,
            { ifAvailable: true },
            (lock) => (lock ? work() : undefined),
          );
        else await work();
      } catch {
        /* Local originals remain intact; the next foreground retry can recover. */
      } finally {
        syncing.current = false;
      }
    },
    [queryClient, refresh],
  );

  const acquireWakeLock = useCallback(async () => {
    if (
      !session.current ||
      document.visibilityState !== "visible" ||
      !navigator.wakeLock
    )
      return;
    try {
      const lock = await navigator.wakeLock.request("screen");
      if (session.current) wakeLock.current = lock;
      else await lock.release();
    } catch {
      /* A wake lock is best effort, never a prerequisite for saving. */
    }
  }, []);
  const stop = useCallback(() => {
    const current = session.current;
    if (current && current.recorder.state !== "inactive") {
      setStage("saving");
      current.recorder.stop();
    }
  }, []);

  const start = useCallback(
    async (subjectId: number | null = null, limit = 900) => {
      if (session.current || preparing.current || rescue) return;
      preparing.current = true;
      setStage("starting");
      setError(null);
      let release = () => {};
      let stream: MediaStream | undefined;
      let createdId: string | undefined;
      try {
        if (
          !navigator.mediaDevices?.getUserMedia ||
          typeof MediaRecorder === "undefined"
        )
          throw new Error(
            isArabic
              ? "التسجيل غير مدعوم. افتح التطبيق عبر HTTPS في متصفح حديث."
              : "Recording needs a supported browser and HTTPS (or localhost).",
          );
        release = await microphoneLock();
        // Request from this start action, before any network work. A blank IDB write tests storage first.
        const id = crypto.randomUUID();
        createdId = id;
        const capturedAt = new Date().toISOString();
        await recordingStore.create({
          id,
          capturedAt,
          updatedAt: Date.now(),
          title: `${isArabic ? "فكرة صوتية" : "Voice idea"} · ${new Intl.DateTimeFormat(language, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date())}`,
          status: "recording",
          chunks: 0,
          bytes: 0,
          mimeType: "",
          durationSeconds: 0,
          language,
          subjectId,
          attempts: 0,
          nextRetryAt: 0,
        });
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (!mounted.current) throw new Error("Recorder closed");
        const mimeType = mimeTypes.find((type) =>
          MediaRecorder.isTypeSupported(type),
        );
        const recorder = new MediaRecorder(stream, {
          ...(mimeType ? { mimeType } : {}),
          audioBitsPerSecond: 64_000,
        });
        await recordingStore.patch(id, { mimeType: recorder.mimeType });
        const current: Session = {
          id,
          recorder,
          stream,
          release,
          started: Date.now(),
          writes: Promise.resolve(),
          chunks: [],
          failed: false,
          interrupted: false,
          limit: Math.min(900, Math.max(10, limit)),
        };
        session.current = current;
        recorder.ondataavailable = (event) => {
          if (!event.data.size) return;
          current.chunks.push(event.data);
          current.writes = current.writes.then(async () => {
            if (current.failed) return;
            try {
              await recordingStore.append(
                id,
                event.data,
                Math.round((Date.now() - current.started) / 1000),
              );
            } catch {
              current.failed = true;
              current.interrupted = true;
              stop();
            }
          });
        };
        recorder.onerror = () => {
          current.interrupted = true;
          stop();
        };
        stream.getAudioTracks().forEach((track) =>
          track.addEventListener("ended", () => {
            if (session.current === current) {
              current.interrupted = true;
              stop();
            }
          }),
        );
        recorder.onstop = () => {
          void (async () => {
            setStage("saving");
            await current.writes;
            current.stream.getTracks().forEach((track) => track.stop());
            await wakeLock.current?.release().catch(() => {});
            wakeLock.current = null;
            try {
              if (current.failed)
                throw new Error(
                  "Storage is full or unavailable. Download the rescue recording before leaving this page, or retry saving.",
                );
              const saved = await recordingStore.get(id);
              if (!saved?.bytes) {
                await recordingStore.remove(id);
                throw new Error(
                  "No audio was captured. Check your microphone and try again.",
                );
              }
              await recordingStore.patch(id, {
                status: "saved",
                interrupted: current.interrupted,
                durationSeconds: Math.round(
                  (Date.now() - current.started) / 1000,
                ),
              });
              if ("speechSynthesis" in window) {
                const cue = new SpeechSynthesisUtterance(
                  isArabic ? "تم الحفظ على الجهاز" : "Saved on device",
                );
                cue.lang = isArabic ? "ar" : "en";
                window.speechSynthesis.speak(cue);
              }
            } catch (failure) {
              const blob = new Blob(current.chunks, {
                type: recorder.mimeType,
              });
              if (blob.size)
                setRescue({ id, blob, url: URL.createObjectURL(blob) });
              setError(
                failure instanceof Error
                  ? failure.message
                  : "Could not save audio. Keep this page open.",
              );
            } finally {
              session.current = null;
              preparing.current = false;
              current.release();
              setActiveId(null);
              setStage("idle");
              await refresh().catch(() => {});
              if (!current.failed) void sync();
            }
          })();
        };
        recorder.start(1000);
        setActiveId(id);
        setSeconds(0);
        setStage("recording");
        preparing.current = false;
        void navigator.storage?.persist?.().catch(() => {});
        void acquireWakeLock();
        void refresh().catch(() => {});
      } catch (failure) {
        stream?.getTracks().forEach((track) => track.stop());
        release();
        if (createdId) await recordingStore.remove(createdId).catch(() => {});
        preparing.current = false;
        session.current = null;
        setStage("idle");
        setError(
          failure instanceof Error
            ? failure.message
            : isArabic
              ? "تعذر بدء التسجيل"
              : "Couldn't start recording",
        );
      }
    },
    [acquireWakeLock, isArabic, language, refresh, rescue, stop, sync],
  );

  const retryRescue = useCallback(async () => {
    if (!rescue) return;
    try {
      // Keep existing checkpoints until a complete replacement has committed.
      await recordingStore.replaceAudio(rescue.id, rescue.blob);
      URL.revokeObjectURL(rescue.url);
      setRescue(null);
      setError(null);
      await refresh();
      void sync();
    } catch {
      setError(
        "Device storage is still unavailable. Download the rescue audio before leaving.",
      );
    }
  }, [refresh, rescue, sync]);

  useEffect(() => {
    mounted.current = true;
    const initialize = async () => {
      try {
        if (navigator.locks)
          await navigator.locks.request(
            `${lockPrefix}-microphone`,
            { ifAvailable: true },
            (lock) => (lock ? recordingStore.recoverInterrupted() : undefined),
          );
        else {
          for (const row of await recordingStore.list())
            if (
              row.status === "recording" &&
              Date.now() - row.updatedAt > 60_000
            )
              await recordingStore.patch(row.id, {
                status: "saved",
                interrupted: true,
              });
        }
        await refresh();
        setReady(true);
        void sync();
      } catch {
        setError(
          "Device storage is unavailable. Enable browser storage before recording.",
        );
      }
    };
    void initialize();
    const timer = window.setInterval(() => {
      const current = session.current;
      if (current) {
        const elapsed = Math.floor((Date.now() - current.started) / 1000);
        setSeconds(elapsed);
        if (elapsed >= current.limit) stop();
      }
    }, 500);
    const retryTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void sync();
        void refresh().catch(() => {});
      }
    }, 10_000);
    const network = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) void sync();
    };
    const visibility = () => {
      if (document.visibilityState === "visible") {
        void acquireWakeLock();
        void sync();
      } else if (session.current?.recorder.state === "recording")
        session.current.recorder.requestData();
    };
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      clearInterval(retryTimer);
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
      document.removeEventListener("visibilitychange", visibility);
      stop();
    };
  }, [acquireWakeLock, refresh, stop, sync]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (stage !== "idle" || rescue) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [stage, rescue]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        !event.altKey ||
        event.key.toLowerCase() !== "r" ||
        event.repeat ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      )
        return;
      event.preventDefault();
      if (session.current) stop();
      else void start();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [start, stop]);

  return (
    <RecorderContext.Provider
      value={{
        records,
        stage,
        seconds,
        activeId,
        ready,
        error,
        syncingId,
        online,
        rescue,
        start,
        stop,
        refresh,
        sync,
        retryRescue,
      }}
    >
      {children}
      {rescue && stage === "idle" && (
        <div
          className="fixed bottom-4 inset-x-4 z-50 mx-auto max-w-lg rounded-2xl border border-red-300 bg-red-50 p-4 text-red-950 shadow-xl"
          role="alert"
        >
          <Link href="/record" className="text-sm underline">
            {isArabic
              ? "تعذر حفظ الصوت. افتح المسجل لإنقاذ التسجيل قبل مغادرة الصفحة."
              : "Audio needs your attention. Open the recorder to rescue it before leaving this page."}
          </Link>
        </div>
      )}
      {stage !== "idle" && (
        <div
          className="fixed bottom-4 inset-x-4 z-50 mx-auto max-w-md flex items-center gap-3 rounded-2xl bg-primary text-primary-foreground p-3 shadow-xl"
          role="status"
        >
          <Mic className="h-5 w-5 animate-pulse" />
          <Link href="/record" className="flex-1 text-sm">
            {isArabic ? "جارٍ التسجيل" : "Recording"} ·{" "}
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
          </Link>
          <button
            onClick={stop}
            disabled={stage !== "recording"}
            className="flex items-center gap-2 rounded-xl bg-white/20 px-4 py-3 text-sm"
          >
            <Square size={16} />
            {isArabic ? "إيقاف وحفظ" : "Stop & save"}
          </button>
        </div>
      )}
    </RecorderContext.Provider>
  );
}
export function useRecorder() {
  const value = useContext(RecorderContext);
  if (!value) throw new Error("RecorderProvider is missing");
  return value;
}
