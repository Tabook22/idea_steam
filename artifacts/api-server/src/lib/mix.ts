/**
 * Background music: where the voice and the music sit in the result, and the ffmpeg graph
 * that mixes them. The timing plan mirrors artifacts/idea-stream/src/lib/mix.ts (the live
 * preview); scripts/mix.test.mjs checks they agree.
 */

export type MixFit = "loop" | "stretch" | "once";
export type MixSettings = {
  musicStart: number;
  regionStart: number;
  regionEnd: number;
  fit: MixFit;
  musicVolume: number;
  voiceVolume: number;
  fadeIn: number;
  fadeOut: number;
  duck: number;
  makeRoom: boolean;
};

export type MixPlan = {
  /** Silence before the voice (an intro), in seconds. */
  pre: number;
  /** When the music starts in the result. */
  offset: number;
  /** How long the music block is. */
  region: number;
  /** Usable length of the song (from musicStart). */
  source: number;
  /** Tempo change for "stretch" (>1 faster, <1 slower), limited to 0.5–2. */
  tempo: number;
  /** Whether the song repeats to fill the block. */
  loops: boolean;
  /** How long music is actually heard. */
  played: number;
  total: number;
};

export const STRETCH_LIMITS = { min: 0.5, max: 2 };

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
    // Beyond what stretching can do naturally, the stretched song repeats.
    loops = source / tempo < region - 0.01;
  }
  const total = Math.max(pre + voiceDuration, offset + played);
  return { pre, offset, region, source, tempo: round(tempo, 4), loops, played: round(played, 3), total: round(total, 3) };
}

const round = (value: number, places = 3) => Math.round(value * 10 ** places) / 10 ** places;
const n = (value: number) => String(round(value, 3));

/** Ducking per level: [threshold, ratio]. About 7, 12 and 15 dB lower while speaking (measured on speech). */
export const DUCK = [[1, 1], [0.04, 2], [0.02, 4], [0.01, 20]] as const;
const RATE = 48000;
const NORMALIZE = `aresample=${RATE},aformat=sample_fmts=fltp:channel_layouts=mono`;

/** The ffmpeg graph: input 0 is the voice, input 1 the music; the result is labelled [out]. */
export function mixGraph(plan: MixPlan, settings: MixSettings, window?: { start: number; seconds: number }) {
  const music: string[] = [`[1:a]${NORMALIZE}`, `atrim=start=${n(Math.max(0, settings.musicStart))}`, "asetpts=PTS-STARTPTS"];
  if (settings.fit === "stretch" && plan.tempo !== 1) music.push(`rubberband=tempo=${plan.tempo}`);
  if (plan.loops) music.push(`aloop=loop=-1:size=${Math.ceil((plan.source / plan.tempo) * RATE)}`);
  music.push(`atrim=duration=${n(plan.played)}`);
  if (settings.makeRoom) music.push("equalizer=f=1500:t=q:w=0.6:g=-5");
  music.push(`volume=${n(settings.musicVolume)}dB`);
  const fadeIn = Math.min(settings.fadeIn, plan.played / 2);
  const fadeOut = Math.min(settings.fadeOut, plan.played / 2);
  if (fadeIn > 0) music.push(`afade=t=in:st=0:d=${n(fadeIn)}`);
  if (fadeOut > 0) music.push(`afade=t=out:st=${n(plan.played - fadeOut)}:d=${n(fadeOut)}`);
  music.push(`adelay=delays=${Math.round(plan.offset * 1000)}:all=1`, `apad=whole_dur=${n(plan.total)}`);

  const voice = [`[0:a]${NORMALIZE}`, `volume=${n(settings.voiceVolume)}dB`, `adelay=delays=${Math.round(plan.pre * 1000)}:all=1`, `apad=whole_dur=${n(plan.total)}`];
  const ending = ["alimiter=limit=0.97:level=false:latency=1", `atrim=duration=${n(plan.total)}`];
  if (window) ending.push(`atrim=start=${n(window.start)}:duration=${n(window.seconds)}`, "asetpts=PTS-STARTPTS");

  const parts = [`${music.join(",")}[m]`, `${voice.join(",")}[v]`];
  const duck = Math.max(0, Math.min(3, Math.round(settings.duck)));
  if (duck) {
    // The voice drives a compressor on the music: it dips while you speak and comes back after.
    parts.push("[v]asplit=2[v1][vk]");
    parts.push(`[m][vk]sidechaincompress=threshold=${DUCK[duck][0]}:ratio=${DUCK[duck][1]}:attack=15:release=350[md]`);
    parts.push(`[v1][md]amix=inputs=2:normalize=0:duration=longest,${ending.join(",")}[out]`);
  } else {
    parts.push(`[v][m]amix=inputs=2:normalize=0:duration=longest,${ending.join(",")}[out]`);
  }
  return parts.join(";");
}
