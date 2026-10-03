/**
 * Background music timing, shared by the live preview and the timeline drawing. The server
 * uses the same plan (artifacts/api-server/src/lib/mix.ts); scripts/mix.test.mjs checks both.
 */

export type MixFit = "loop" | "stretch" | "once";
export type MixSettings = {
  /** Where in the song to begin (seconds). */
  musicStart: number;
  /** Where the music block starts and ends, on the recording's clock (negative = intro, past the end = outro). */
  regionStart: number;
  regionEnd: number;
  fit: MixFit;
  musicVolume: number;
  voiceVolume: number;
  fadeIn: number;
  fadeOut: number;
  /** Lower the music while you speak: 0 off … 3 strong. */
  duck: number;
  makeRoom: boolean;
};

export type MixPlan = { pre: number; offset: number; region: number; source: number; tempo: number; loops: boolean; played: number; total: number };

export const STRETCH_LIMITS = { min: 0.5, max: 2 };
export const REGION_LIMITS = { before: 30, after: 30, min: 1 };

const round = (value: number, places = 3) => Math.round(value * 10 ** places) / 10 ** places;

export function mixPlan(voiceDuration: number, musicDuration: number, settings: MixSettings): MixPlan {
  const source = Math.max(0.1, musicDuration - Math.max(0, settings.musicStart));
  const region = Math.max(0.5, settings.regionEnd - settings.regionStart);
  const pre = Math.max(0, -settings.regionStart);
  const offset = settings.regionStart + pre;
  let tempo = 1;
  let loops = false;
  let played = region;
  if (settings.fit === "once") {
    played = Math.min(source, region);
  } else if (settings.fit === "loop") {
    loops = source < region - 0.01;
  } else {
    tempo = Math.min(STRETCH_LIMITS.max, Math.max(STRETCH_LIMITS.min, source / region));
    loops = source / tempo < region - 0.01;
  }
  const total = Math.max(pre + voiceDuration, offset + played);
  return { pre, offset, region, source, tempo: round(tempo, 4), loops, played: round(played, 3), total: round(total, 3) };
}

/**
 * The moment of the song heard `elapsed` seconds into the music block (null once it has
 * stopped). Used to draw the music and to start playback anywhere.
 */
export function songTimeAt(plan: MixPlan, settings: MixSettings, elapsed: number): number | null {
  if (elapsed < 0 || elapsed >= plan.played) return null;
  const into = elapsed * plan.tempo;
  const span = plan.source;
  return Math.max(0, settings.musicStart) + (plan.loops ? into % span : Math.min(into, span));
}

/** How much the live preview lowers the music while you speak (the server uses a compressor). */
export const DUCK_DB = [0, 7, 12, 15];

export const DEFAULT_MIX: MixSettings = {
  musicStart: 0, regionStart: 0, regionEnd: 10, fit: "loop",
  musicVolume: -18, voiceVolume: 0, fadeIn: 2, fadeOut: 3, duck: 2, makeRoom: true,
};

export type MixPreset = "under" | "introOutro" | "intro" | "stretch";

/** Ready-made starting points; everything stays adjustable afterwards. */
export function presetSettings(preset: MixPreset, voiceDuration: number, current: MixSettings): MixSettings {
  const base = { ...current };
  switch (preset) {
    case "under": return { ...base, regionStart: 0, regionEnd: voiceDuration, fit: "loop", musicVolume: -18, duck: 2, fadeIn: 2, fadeOut: 3, makeRoom: true };
    case "introOutro": return { ...base, regionStart: -6, regionEnd: voiceDuration + 5, fit: "loop", musicVolume: -10, duck: 3, fadeIn: 1, fadeOut: 4, makeRoom: true };
    case "intro": return { ...base, regionStart: -8, regionEnd: Math.min(voiceDuration, 3), fit: "once", musicVolume: -10, duck: 3, fadeIn: 0.5, fadeOut: 3, makeRoom: false };
    case "stretch": return { ...base, regionStart: 0, regionEnd: voiceDuration, fit: "stretch", musicVolume: -18, duck: 2, fadeIn: 2, fadeOut: 3, makeRoom: true };
  }
}
