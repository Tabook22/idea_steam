import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bookmark, Check, FolderCheck, Loader2, Square } from "lucide-react";
import { useListSubjects } from "@workspace/api-client-react";
import { useRecorder } from "@/components/recorder-provider";
import { MeetingNotepad } from "@/components/meeting-notepad";
import { putMeetingFile } from "@/lib/meeting-files";
import { useLanguage } from "@/lib/i18n";

/** 05:07, or 1:05:07 past an hour (meetings). */
const clock = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const rest = String(seconds % 60).padStart(2, "0");
  return hours ? `${hours}:${minutes}:${rest}` : `${minutes}:${rest}`;
};

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

/**
 * A ring of bars around the timer that moves with your voice: the newest sound enters at the
 * top and travels clockwise, so a sentence draws itself around the circle.
 */
export function VoiceRing({ readLevel, active, children }: { readLevel: () => number; active: boolean; children: React.ReactNode }) {
  const BARS = 72;
  const refs = useRef<Array<SVGLineElement | null>>([]);
  const glow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const history = new Array(BARS).fill(0);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let smooth = 0;
    const timer = window.setInterval(() => {
      const level = active ? Math.min(1, readLevel() * 1.8) : 0;
      smooth = smooth * 0.7 + level * 0.3;
      history.pop();
      history.unshift(level);
      history.forEach((value, index) => {
        const line = refs.current[index];
        if (line) line.setAttribute("y1", String(-118 - Math.max(0.04, value) * 34));
      });
      if (glow.current) glow.current.style.transform = `scale(${1 + smooth * 0.18})`;
    }, reduce ? 300 : 60);
    return () => clearInterval(timer);
  }, [readLevel, active]);
  return (
    <div className="relative grid h-[17rem] w-[17rem] place-items-center sm:h-[19rem] sm:w-[19rem]">
      <div ref={glow} aria-hidden="true" className="absolute inset-10 rounded-full bg-emerald-400/15 blur-2xl transition-transform duration-100" />
      <svg viewBox="-160 -160 320 320" className="absolute inset-0 h-full w-full text-emerald-300" aria-hidden="true">
        <circle r="112" fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1.5" />
        {Array.from({ length: BARS }, (_, index) => (
          <line key={index} ref={(element) => { refs.current[index] = element; }}
            x1="0" x2="0" y1="-120" y2="-116" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round"
            strokeOpacity={0.35 + 0.65 * (1 - index / BARS)}
            transform={`rotate(${(index * 360) / BARS})`} />
        ))}
      </svg>
      <div className="relative text-center">{children}</div>
    </div>
  );
}

/** After saving: a "Saved" badge that flies into the Library tab (or fades, on a computer). */
export function SavedBurst({ onDone }: { onDone: () => void }) {
  const { isArabic } = useLanguage();
  const badge = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = badge.current;
    if (!element) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tab = [...document.querySelectorAll<HTMLElement>("nav a")].find((link) => /\/library$/.test(link.getAttribute("href") ?? "") && link.offsetParent !== null);
    const from = element.getBoundingClientRect();
    const to = tab?.getBoundingClientRect();
    const fly = to
      ? `translate(${to.left + to.width / 2 - (from.left + from.width / 2)}px, ${to.top + to.height / 2 - (from.top + from.height / 2)}px) scale(0.2)`
      : "translateY(-24px) scale(0.9)";
    const animation = element.animate([
      { transform: "translateY(16px) scale(0.6)", opacity: 0 },
      { transform: "translateY(0) scale(1.06)", opacity: 1, offset: 0.14 },
      { transform: "translateY(0) scale(1)", opacity: 1, offset: 0.2 },
      { transform: "translateY(0) scale(1)", opacity: 1, offset: 0.68 },
      { transform: fly, opacity: to ? 0.9 : 0, offset: 0.97 },
      { transform: fly, opacity: 0 },
    ], { duration: reduce ? 1600 : 2300, easing: "cubic-bezier(.45,.05,.3,1)", fill: "forwards" });
    animation.onfinish = () => {
      tab?.animate([{ transform: "scale(1)" }, { transform: "scale(1.25)" }, { transform: "scale(1)" }], { duration: 420, easing: "ease-out" });
      onDone();
    };
    return () => animation.cancel();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-[28%] z-[70] flex justify-center" role="status" aria-live="polite">
      <div ref={badge} className="flex items-center gap-2.5 rounded-full bg-primary px-5 py-3 text-primary-foreground shadow-2xl shadow-primary/40" style={{ opacity: 0 }}>
        <span className="grid h-7 w-7 place-items-center rounded-full bg-white/20"><Check size={17} strokeWidth={3} /></span>
        <span className="text-sm font-semibold">{isArabic ? "حُفظ في المكتبة" : "Saved to your library"}</span>
      </div>
    </div>,
    document.body,
  );
}

/** The four things worth marking in a meeting. */
export const MEETING_MARKS = [
  { kind: "important", icon: "⭐", en: "Important", ar: "مهم", tone: "border-amber-300/40 bg-amber-400/15 text-amber-100" },
  { kind: "decision", icon: "✅", en: "Decision", ar: "قرار", tone: "border-emerald-300/40 bg-emerald-400/15 text-emerald-100" },
  { kind: "action", icon: "📌", en: "Action", ar: "مهمة", tone: "border-sky-300/40 bg-sky-400/15 text-sky-100" },
  { kind: "question", icon: "❓", en: "Question", ar: "سؤال", tone: "border-violet-300/40 bg-violet-400/15 text-violet-100" },
] as const;

/**
 * Recording a meeting: a compact bar (time, level, End), the four markers, and the notepad for
 * notes, photos, documents and drawings, all saved on this device as you go.
 */
function MeetingRecordingView({ remaining }: { remaining: number }) {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const { stage, seconds, stop, readLevel, target, addMark, markKinds, meetingNotes, updateMeetingNotes, elapsed } = useRecorder();
  const meeting = target!.meeting!;
  const [confirm, setConfirm] = useState(false);
  const level = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setInterval(() => { if (level.current) level.current.style.transform = `scaleX(${Math.max(0.03, Math.min(1, readLevel() * 1.6))})`; }, 100);
    return () => { document.body.style.overflow = previous; window.clearInterval(timer); };
  }, [readLevel]);
  const saving = stage === "saving";
  const recording = stage === "recording";
  return (
    <div role="dialog" aria-modal="true" aria-label={copy("Meeting in progress", "اجتماع جارٍ")}
      className="fixed inset-0 z-[60] flex flex-col bg-ink text-ink-foreground"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="border-b border-white/10 px-4 pb-2 pt-3">
        <div className="flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            {recording && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />}
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
          </span>
          <div className="min-w-0 flex-1">
            <p dir="auto" className="truncate text-sm font-semibold">{meeting.title}</p>
            <p className="font-mono text-xs tabular-nums text-white/60" role="timer">
              {saving ? copy("Saving…", "جارٍ الحفظ…") : stage === "starting" ? copy("Getting ready…", "جارٍ التجهيز…") : clock(seconds)}
              <span className="ms-2 text-white/35">{copy("stops in", "يتوقف بعد")} {clock(remaining)}</span>
            </p>
          </div>
          <button type="button" onClick={() => setConfirm(true)} disabled={!recording}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-red-600 px-4 text-sm font-semibold text-white shadow-lg disabled:opacity-60">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Square size={13} fill="currentColor" />}{copy("End", "إنهاء")}
          </button>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
          <div ref={level} className="h-full origin-left rounded-full bg-emerald-400 transition-transform duration-100 rtl:origin-right" style={{ transform: "scaleX(0.03)" }} />
        </div>
        <div className="mt-2.5 grid grid-cols-4 gap-1.5" role="group" aria-label={copy("Mark this moment as", "علّم هذه اللحظة كـ")}>
          {MEETING_MARKS.map((mark) => {
            const count = markKinds.filter((kind) => kind === mark.kind).length;
            return (
              <button key={mark.kind} type="button" disabled={!recording}
                onPointerDown={() => addMark(mark.kind)} onClick={(event) => { if (event.detail === 0) addMark(mark.kind); }}
                className={`flex h-12 flex-col items-center justify-center rounded-xl border text-[11px] font-semibold transition active:scale-95 disabled:opacity-50 ${mark.tone}`}>
                <span className="text-base leading-none" aria-hidden="true">{mark.icon}</span>
                <span className="mt-0.5">{copy(mark.en, mark.ar)}{count > 0 ? ` · ${count}` : ""}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <MeetingNotepad
          notes={meetingNotes}
          onChange={updateMeetingNotes}
          now={elapsed}
          dark
          arabic={isArabic}
          copy={copy}
          storeFile={async (note, file) => { await putMeetingFile(note.id, file); return { ...note, pending: true }; }}
        />
        <p className="mt-4 text-center text-xs text-white/40">
          {copy("Tell everyone the meeting is being recorded. Notes and photos are saved on this phone and uploaded with the recording.",
            "أخبر الحاضرين أن الاجتماع يُسجَّل. تُحفظ الملاحظات والصور على هذا الهاتف وتُرفع مع التسجيل.")}
        </p>
      </div>
      {confirm && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black/60 p-6" role="alertdialog" aria-modal="true" aria-label={copy("End the meeting?", "إنهاء الاجتماع؟")}>
          <div className="w-full max-w-sm rounded-3xl bg-[#10241c] p-5 text-center shadow-2xl">
            <p className="font-serif text-xl">{copy("End the meeting and save?", "إنهاء الاجتماع وحفظه؟")}</p>
            <p className="mt-1 text-sm text-white/60">{copy("The minutes, speakers and action items are made next.", "يُكتب المحضر والمتحدثون والمهام بعد ذلك.")}</p>
            <div className="mt-5 grid gap-2">
              <button type="button" onClick={() => { setConfirm(false); stop(); }} className="h-12 rounded-2xl bg-red-600 font-semibold text-white">{copy("End & save", "إنهاء وحفظ")}</button>
              <button type="button" onClick={() => setConfirm(false)} className="h-12 rounded-2xl bg-white/10 font-medium">{copy("Keep recording", "تابع التسجيل")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Full-screen, high-contrast recording view: one huge target to stop and save. */
export function DrivingMode() {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const { stage, seconds, stop, readLevel, audioLevel, target, addMark, markCount, markKinds } = useRecorder();
  const meeting = target?.meeting;
  const { data: subjects = [] } = useListSubjects();
  const limit = target?.limit ?? 900;
  const destination = meeting
    ? meeting.title
    : target?.libraryOnly
    ? copy("Audio library", "مكتبة الصوت")
    : subjects.find((subject) => subject.id === target?.subjectId)?.title ?? copy("Audio library", "مكتبة الصوت");
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
  if (meeting) return <MeetingRecordingView remaining={remaining} />;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={copy("Recording in progress", "التسجيل جارٍ")}
      className="fixed inset-0 z-[60] flex flex-col bg-ink text-ink-foreground"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-center justify-between gap-3 px-5 pt-5 sm:px-8">
        <span className="inline-flex items-center gap-2.5 rounded-full bg-red-500/15 px-4 py-2 text-sm font-semibold text-red-200">
          <span className="relative flex h-2.5 w-2.5">
            {stage === "recording" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />}
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
          </span>
          {saving ? copy("Saving…", "جارٍ الحفظ…") : starting ? copy("Getting ready…", "جارٍ التجهيز…") : meeting ? copy("Meeting", "اجتماع") : copy("Recording", "يسجّل الآن")}
        </span>
        <span className="inline-flex min-w-0 items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm">
          <FolderCheck size={16} className="shrink-0" />
          <span className="truncate">{destination}</span>
        </span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <VoiceRing readLevel={readLevel} active={stage === "recording"}>
          <p className="font-mono text-5xl font-light tabular-nums tracking-wider sm:text-6xl" role="timer" aria-live="off">
            {clock(seconds)}
          </p>
          {markCount > 0 && !meeting && (
            <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-amber-200"><Bookmark size={12} />{markCount}</p>
          )}
        </VoiceRing>
        <p className="mt-2 text-base text-white/70" role="status">
          {saving
            ? copy("Keeping your idea safe on this device…", "نحفظ فكرتك على هذا الجهاز…")
            : starting
              ? copy("Opening the microphone…", "جارٍ فتح الميكروفون…")
            : meeting
              ? copy("Place the phone in the middle of the table.", "ضع الهاتف في منتصف الطاولة.")
            : audioLevel > 0.04
              ? copy("Listening. Speak naturally.", "أستمع إليك. تحدّث بشكل طبيعي.")
              : copy("Speak toward your phone", "تحدّث باتجاه الهاتف")}
        </p>
        <p className="mt-2 text-sm text-white/45">
          {copy("Stops by itself in", "يتوقف تلقائيًا بعد")} {clock(remaining)}
        </p>
        {meeting && (
          <p className="mt-5 max-w-sm rounded-2xl bg-white/5 px-4 py-2.5 text-sm text-white/70">
            {copy("Let everyone know the meeting is being recorded. Minutes, speakers and action items are made after you end it.",
              "أخبر الحاضرين أن الاجتماع يُسجَّل. يُكتب المحضر والمتحدثون والمهام بعد إنهائه.")}
          </p>
        )}
        {target?.autoTranscribe !== false && !meeting && (
          <p className="mt-6 max-w-sm rounded-2xl bg-white/5 px-4 py-2.5 text-sm text-white/70">
            {target?.libraryOnly || target?.subjectId == null
              ? copy("Saving to your audio library. You can add it to any subject from there.", "يُحفظ في مكتبة الصوت، ويمكنك إضافته لأي موضوع من هناك.")
              : copy(`Saving to your audio library, and as text in “${destination}”.`, `يُحفظ في مكتبة الصوت، ونصًا في «${destination}».`)}
          </p>
        )}
      </div>
      <div className="px-4 pb-5 sm:px-8 sm:pb-8">
        {meeting ? (
          <div className="mb-3 grid grid-cols-2 gap-2" role="group" aria-label={copy("Mark this moment as", "علّم هذه اللحظة كـ")}>
            {MEETING_MARKS.map((mark) => {
              const count = markKinds.filter((kind) => kind === mark.kind).length;
              return (
                <button key={mark.kind} type="button" disabled={stage !== "recording"}
                  onPointerDown={() => addMark(mark.kind)}
                  onClick={(event) => { if (event.detail === 0) addMark(mark.kind); }}
                  className={`flex h-14 items-center justify-center gap-2 rounded-2xl border text-base font-semibold transition active:scale-[0.97] disabled:opacity-50 ${mark.tone}`}>
                  <span aria-hidden="true">{mark.icon}</span>{copy(mark.en, mark.ar)}
                  {count > 0 && <span className="rounded-full bg-white/90 px-2 text-xs font-bold text-black">{count}</span>}
                </button>
              );
            })}
          </div>
        ) : (
        <button
          type="button"
          // Marks on touch-down: a second finger (while the first holds REC) gets no "click" on phones.
          onPointerDown={() => addMark()}
          // Keyboard (Enter/Space) produces a click without a pointer; detail is 0 then.
          onClick={(event) => { if (event.detail === 0) addMark(); }}
          disabled={stage !== "recording"}
          aria-label={copy("Mark this moment", "علّم هذه اللحظة")}
          className="mb-3 flex h-16 w-full items-center justify-center gap-3 rounded-2xl border border-amber-300/40 bg-amber-400/15 text-lg font-semibold text-amber-100 transition active:scale-[0.98] active:bg-amber-400/30 disabled:opacity-50"
        >
          <Bookmark size={22} />
          {copy("Mark this moment", "علّم هذه اللحظة")}
          {markCount > 0 && <span className="rounded-full bg-amber-300 px-2.5 py-0.5 text-sm font-bold text-amber-950">{markCount}</span>}
        </button>
        )}
        <button
          ref={stopButton}
          type="button"
          disabled={saving || starting}
          onClick={stop}
          className="flex h-[30vh] min-h-36 max-h-72 w-full flex-col items-center justify-center gap-3 rounded-[2rem] bg-red-600 text-white shadow-2xl shadow-red-950/50 transition active:scale-[0.98] disabled:opacity-70 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/60"
        >
          {saving || starting ? <Loader2 size={48} className="animate-spin" /> : <Square size={46} fill="currentColor" />}
          <span className="text-2xl font-semibold">
            {hold ? copy("Release to save", "اترك للحفظ") : meeting ? copy("End meeting & save", "أنهِ الاجتماع واحفظ") : copy("Tap to stop & save", "اضغط للإيقاف والحفظ")}
          </span>
          <span className="text-sm text-white/75">{hold ? copy("Keep holding while you talk", "استمر بالضغط أثناء الكلام") : "Alt + R"}</span>
        </button>
      </div>
    </div>
  );
}

