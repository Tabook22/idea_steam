import { Timer } from "lucide-react";
import { PHASE_INFO, clockText, useCountdown, type LiveState } from "@/lib/live-api";

type Copy = (en: string, ar: string) => string;

/** The step everyone is on, what to do, and the time left: shown to participants on their phones. */
export function PhaseBanner({ state, copy, extra }: { state: LiveState; copy: Copy; extra?: React.ReactNode }) {
  const info = PHASE_INFO[state.session.phase];
  const left = useCountdown(state.session.phaseEndsAt, state.now);
  if (state.session.phase === "free" && left === null) return null;
  const ending = left !== null && left <= 30;
  return (
    <div className="rounded-3xl p-4 text-white shadow-lg" style={{ background: `linear-gradient(135deg, ${info.color}, ${info.color}cc)` }} role="status">
      <div className="flex items-center gap-3">
        <span className="text-3xl leading-none">{info.emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold leading-tight">{copy(info.en, info.ar)}</p>
          <p className="text-sm leading-snug text-white/90">{copy(info.doEn, info.doAr)}</p>
        </div>
        {left !== null && (
          <span className={`flex shrink-0 items-center gap-1 rounded-2xl bg-white/20 px-3 py-2 font-mono text-2xl font-bold tabular-nums ${ending ? "animate-pulse" : ""}`}>
            <Timer size={18} />{left > 0 ? clockText(left) : copy("Time!", "انتهى!")}
          </span>
        )}
      </div>
      {extra}
    </div>
  );
}

/** The same, large, for the projector. */
export function PhaseOverlay({ state, copy }: { state: LiveState; copy: Copy }) {
  const info = PHASE_INFO[state.session.phase];
  const left = useCountdown(state.session.phaseEndsAt, state.now);
  if (state.session.phase === "free" && left === null) return null;
  return (
    <div className="fixed end-[2vw] top-[2vw] z-10 flex items-center gap-[1vw] rounded-[1.4vw] px-[1.4vw] py-[0.8vw] text-white shadow-2xl" style={{ background: info.color }}>
      <span className="text-[2.4vw] leading-none">{info.emoji}</span>
      <span className="text-[1.6vw] font-bold">{copy(info.en, info.ar)}</span>
      {left !== null && <span className={`font-mono text-[2.6vw] font-black tabular-nums ${left <= 30 ? "animate-pulse" : ""}`}>{left > 0 ? clockText(left) : copy("Time!", "انتهى!")}</span>}
    </div>
  );
}
