import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useRecorder } from "@/components/recorder-provider";

const HOLD_MS = 300;
export const buzz = (pattern: number | number[] = 18) => {
  try { navigator.vibrate?.(pattern); } catch { /* Haptics are optional. */ }
};

/**
 * Tap → onTap (a normal recording). Press and hold → onHoldStart, and the recording
 * stops and saves when the finger lifts. The release is caught on the window, so it
 * still works when the recording screen covers the button or the button disappears.
 */
export function usePressToTalk({ onTap, onHoldStart, disabled }: {
  onTap: () => void;
  onHoldStart: () => void;
  disabled?: boolean;
}) {
  const { stage, stop } = useRecorder();
  const stageRef = useRef(stage);
  const stopRef = useRef(stop);
  const timer = useRef<number>(0);
  const pressed = useRef(false);
  const holding = useRef(false);
  const releasedEarly = useRef(false);
  /** The finger holding the button; other fingers (e.g. tapping "Mark") never count as releasing it. */
  const holder = useRef<number | null>(null);
  stageRef.current = stage;
  stopRef.current = stop;

  // Released while the microphone was still opening: stop as soon as it is recording.
  useEffect(() => {
    if (stage === "recording" && releasedEarly.current) {
      releasedEarly.current = false;
      stop();
    }
    if (stage === "idle") releasedEarly.current = false;
  }, [stage, stop]);

  useEffect(() => {
    const up = (event: Event) => {
      if (event instanceof PointerEvent && holder.current !== null && event.pointerId !== holder.current) return;
      holder.current = null;
      window.clearTimeout(timer.current);
      const wasHolding = holding.current;
      pressed.current = false;
      holding.current = false;
      if (!wasHolding) return;
      buzz([12, 40, 12]);
      if (stageRef.current === "recording") stopRef.current();
      else if (stageRef.current === "starting") releasedEarly.current = true;
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", up);
      window.clearTimeout(timer.current);
    };
  }, []);

  return {
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      if (disabled || event.button !== 0) return;
      holder.current = event.pointerId;
      pressed.current = true;
      holding.current = false;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        if (!pressed.current) return;
        holding.current = true;
        buzz(25);
        onHoldStart();
      }, HOLD_MS);
    },
    onPointerUp() {
      // A short press is a tap; a long press is handled by the window listener.
      if (pressed.current && !holding.current && !disabled) {
        window.clearTimeout(timer.current);
        pressed.current = false;
        onTap();
      }
    },
    onPointerLeave(event: ReactPointerEvent<HTMLElement>) {
      // Sliding off before the hold begins cancels the press (like any button).
      if (!holding.current && event.pointerType === "mouse") {
        window.clearTimeout(timer.current);
        pressed.current = false;
      }
    },
    onContextMenu(event: { preventDefault: () => void }) { event.preventDefault(); },
    onKeyDown(event: { key: string; preventDefault: () => void }) {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (!disabled) onTap(); }
    },
  };
}
