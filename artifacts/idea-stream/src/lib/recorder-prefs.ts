import { useEffect, useState } from "react";

export type SpokenLanguage = "auto" | "en" | "ar";
export type RecorderPrefs = {
  subjectId: number | null;
  language: SpokenLanguage;
  limit: number;
  autoTranscribe: boolean;
};

export const RECORDING_LIMITS = [30, 60, 120, 300, 900];
const KEY = "idea-stream-recorder-prefs";

/** Last-used recorder choices, so every way of starting a capture behaves the same. */
export function readRecorderPrefs(): RecorderPrefs {
  let saved: Partial<RecorderPrefs> = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch { /* Preferences are a convenience only. */ }
  const fromUrl = typeof location === "undefined" ? 0 : Number(new URLSearchParams(location.search).get("limit"));
  return {
    subjectId: typeof saved.subjectId === "number" ? saved.subjectId : null,
    language: saved.language === "en" || saved.language === "ar" ? saved.language : "auto",
    limit: RECORDING_LIMITS.includes(fromUrl)
      ? fromUrl
      : RECORDING_LIMITS.includes(saved.limit as number) ? (saved.limit as number) : 900,
    // Text is made later from the audio library unless "convert automatically" was chosen.
    autoTranscribe: (saved as { textMode?: string }).textMode === "auto",
  };
}

export function writeRecorderPrefs(prefs: RecorderPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...prefs, textMode: prefs.autoTranscribe ? "auto" : "later" }));
  } catch { /* Ignore unavailable storage. */ }
}

const listeners = new Set<(prefs: RecorderPrefs) => void>();

/** Shared, persisted recorder choices; every mounted control stays in sync. */
export function useRecorderPrefs() {
  const [prefs, setPrefs] = useState<RecorderPrefs>(readRecorderPrefs);
  useEffect(() => {
    listeners.add(setPrefs);
    return () => { listeners.delete(setPrefs); };
  }, []);
  const update = (change: Partial<RecorderPrefs>) => {
    const next = { ...readRecorderPrefs(), ...prefs, ...change };
    writeRecorderPrefs(next);
    listeners.forEach((listener) => listener(next));
  };
  return [prefs, update] as const;
}
