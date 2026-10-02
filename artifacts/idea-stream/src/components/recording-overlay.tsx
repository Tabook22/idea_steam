import { useEffect, useRef } from "react";
import { FolderCheck, Loader2, Square } from "lucide-react";
import { useListSubjects } from "@workspace/api-client-react";
import { useRecorder } from "@/components/recorder-provider";
import { useLanguage } from "@/lib/i18n";

const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

/** Live bars driven by the microphone level. */
export function LevelBars({ readLevel, bars = 28, className = "" }: { readLevel: () => number; bars?: number; className?: string }) {
  const refs = useRef<Array<HTMLSpanElement | null>>([]);
  useEffect(() => {
    const history = new Array(bars).fill(0);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setInterval(() => {
      history.shift();
      history.push(readLevel());
      history.forEach((level, index) => {
        const bar = refs.current[index];
        if (bar) bar.style.transform = `scaleY(${Math.max(0.08, Math.min(1, level * 1.6))})`;
      });
    }, reduce ? 400 : 80);
    return () => clearInterval(timer);
  }, [bars, readLevel]);
  return (
    <div className={`flex h-20 items-center justify-center gap-[5px] ${className}`} aria-hidden="true">
      {Array.from({ length: bars }, (_, index) => (
        <span
          key={index}
          ref={(element) => { refs.current[index] = element; }}
          className="h-full w-[5px] rounded-full bg-current transition-transform duration-75"
          style={{ transform: "scaleY(0.08)", opacity: 0.35 + (index / bars) * 0.65 }}
        />
      ))}
    </div>
  );
}

/** Full-screen, high-contrast recording view: one huge target to stop and save. */
export function DrivingMode() {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const { stage, seconds, stop, readLevel, audioLevel, target } = useRecorder();
  const { data: subjects = [] } = useListSubjects();
  const limit = target?.limit ?? 900;
  const destination = subjects.find((subject) => subject.id === target?.subjectId)?.title
    ?? copy("Idea inbox", "صندوق الأفكار");
  const stopButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    stopButton.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  const saving = stage === "saving";
  const starting = stage === "starting";
  const hold = !!target?.hold;
  const remaining = Math.max(0, limit - seconds);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={copy("Recording in progress", "التسجيل جارٍ")}
      className="fixed inset-0 z-[60] flex flex-col bg-[hsl(158_38%_11%)] text-[hsl(43_30%_95%)]"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-center justify-between gap-3 px-5 pt-5 sm:px-8">
        <span className="inline-flex items-center gap-2.5 rounded-full bg-red-500/15 px-4 py-2 text-sm font-semibold text-red-200">
          <span className="relative flex h-2.5 w-2.5">
            {stage === "recording" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />}
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
          </span>
          {saving ? copy("Saving…", "جارٍ الحفظ…") : starting ? copy("Getting ready…", "جارٍ التجهيز…") : copy("Recording", "يسجّل الآن")}
        </span>
        <span className="inline-flex min-w-0 items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm">
          <FolderCheck size={16} className="shrink-0" />
          <span className="truncate">{destination}</span>
        </span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <p className="font-mono text-7xl font-light tabular-nums tracking-wider sm:text-8xl" role="timer" aria-live="off">
          {clock(seconds)}
        </p>
        <LevelBars readLevel={readLevel} className="mt-8 w-full max-w-md text-emerald-300" />
        <p className="mt-4 text-base text-white/70" role="status">
          {saving
            ? copy("Keeping your idea safe on this device…", "نحفظ فكرتك على هذا الجهاز…")
            : starting
              ? copy("Opening the microphone…", "جارٍ فتح الميكروفون…")
            : audioLevel > 0.04
              ? copy("Listening. Speak naturally.", "أستمع إليك. تحدّث بشكل طبيعي.")
              : copy("Speak toward your phone", "تحدّث باتجاه الهاتف")}
        </p>
        <p className="mt-2 text-sm text-white/45">
          {copy("Stops by itself in", "يتوقف تلقائيًا بعد")} {clock(remaining)}
        </p>
        {target?.autoTranscribe !== false && (
          <p className="mt-6 max-w-sm rounded-2xl bg-white/5 px-4 py-2.5 text-sm text-white/70">
            {copy(`Your words will be saved as text in “${destination}”.`, `ستُحفظ كلماتك نصًا في «${destination}».`)}
          </p>
        )}
      </div>
      <div className="px-4 pb-5 sm:px-8 sm:pb-8">
        <button
          ref={stopButton}
          type="button"
          disabled={saving || starting}
          onClick={stop}
          className="flex h-[30vh] min-h-36 max-h-72 w-full flex-col items-center justify-center gap-3 rounded-[2rem] bg-red-600 text-white shadow-2xl shadow-red-950/50 transition active:scale-[0.98] disabled:opacity-70 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/60"
        >
          {saving || starting ? <Loader2 size={48} className="animate-spin" /> : <Square size={46} fill="currentColor" />}
          <span className="text-2xl font-semibold">
            {hold ? copy("Release to save", "اترك للحفظ") : copy("Tap to stop & save", "اضغط للإيقاف والحفظ")}
          </span>
          <span className="text-sm text-white/75">{hold ? copy("Keep holding while you talk", "استمر بالضغط أثناء الكلام") : "Alt + R"}</span>
        </button>
      </div>
    </div>
  );
}

