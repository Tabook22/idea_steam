import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalStorageUrl } from "./stored-transcription";
import { soundLabFilters, type SoundLabSettings } from "./sound-lab";
import { mixGraph, mixPlan, type MixSettings } from "./mix";

/**
 * Cutting and joining recordings with ffmpeg. Edits always write a NEW stored file;
 * the source files are never modified or deleted (ideas and "Restore original" rely on it).
 */
export type Range = { start: number; end: number };

export class AudioEditError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_SOURCE_BYTES = 60 * 1024 * 1024;
const FADE = 0.015;
let running = 0;

function storageRoot() {
  const root = process.env.LOCAL_STORAGE_DIR;
  if (!root) throw new AudioEditError(501, "Audio editing needs the server's own storage (the VPS setup).");
  return root;
}

/** Local path of a recording stored by this app, plus the URL prefix it was saved under. */
async function storedFile(url: string) {
  const canonical = canonicalStorageUrl(url);
  const id = canonical.startsWith("/api/storage/objects/") ? canonical.slice("/api/storage/objects/".length) : "";
  if (!uuid.test(id)) throw new AudioEditError(400, "Only recordings saved in this app can be edited.");
  const path = join(storageRoot(), id);
  const info = await stat(path).catch(() => null);
  if (!info) throw new AudioEditError(404, "The saved audio file could not be found on the server.");
  if (info.size > MAX_SOURCE_BYTES) throw new AudioEditError(413, "This recording is too large to edit.");
  return { path, prefix: url.slice(0, url.length - canonical.length) };
}

function run(command: string, args: string[], timeoutMs = 180_000) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-20_000); });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new AudioEditError(504, "Editing took too long. Try a shorter recording.")); }, timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else {
        // Keep the tool's own explanation in the server log (never shown to users).
        console.warn(`${command} failed (${code}):`, output.split("\n").filter((line) => /error|invalid|failed|no such|unable/i.test(line)).slice(-4).join(" | "));
        reject(new AudioEditError(422, "This audio couldn't be processed. Your recording is unchanged."));
      }
    });
  });
}

/** Length in seconds. Browser recordings often lack a duration header, so fall back to decoding. */
export async function audioDuration(path: string) {
  const probed = Number((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).catch(() => "")).trim());
  if (Number.isFinite(probed) && probed > 0) return probed;
  const log = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", path, "-f", "null", "-"]).catch(() => "");
  const times = [...log.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  const last = times.at(-1);
  return last ? Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]) : 0;
}

/** Validates kept ranges: sorted, non-overlapping, inside the recording, and not empty. */
export function normalizeRanges(ranges: Range[], duration: number) {
  if (!ranges.length || ranges.length > 200) throw new AudioEditError(400, "Choose what to keep.");
  const limit = duration > 0 ? duration + 0.25 : Infinity;
  let previousEnd = -1;
  const result: Range[] = [];
  for (const { start, end } of ranges) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > limit || start < previousEnd)
      throw new AudioEditError(400, "The selection is not valid. Please try again.");
    previousEnd = end;
    result.push({ start, end: Math.min(end, duration > 0 ? duration : end) });
  }
  if (result.reduce((sum, r) => sum + (r.end - r.start), 0) < 0.3)
    throw new AudioEditError(400, "Keep at least a moment of audio.");
  return result;
}

async function withWorkspace<T>(work: (dir: string) => Promise<T>) {
  if (running >= 2) throw new AudioEditError(429, "Another edit is in progress. Please try again in a moment.");
  running++;
  const dir = await mkdtemp(join(tmpdir(), "idea-stream-edit-"));
  try { return await work(dir); } finally {
    running--;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const NORMALIZE = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono";

/** Moves the finished file into storage under a new id and returns its URL with the source's prefix. */
async function publish(output: string, prefix: string) {
  const root = storageRoot();
  const id = randomUUID();
  await rename(output, join(root, id)).catch(async () => {
    // Different filesystem: copy through a temporary name in the storage folder.
    const { copyFile } = await import("node:fs/promises");
    const temporary = join(root, `${id}.${randomUUID()}.partial`);
    await copyFile(output, temporary);
    await rename(temporary, join(root, id));
  });
  await writeFile(join(root, `${id}.json`), JSON.stringify({ contentType: "audio/webm" }), { mode: 0o600 });
  const duration = await audioDuration(join(root, id));
  return { url: `${prefix}/api/storage/objects/${id}`, durationSeconds: Math.max(1, Math.round(duration)), mimeType: "audio/webm" };
}

const encode = ["-c:a", "libopus", "-b:a", "64k", "-ac", "1", "-f", "webm"];

/** Keeps only the given ranges of a recording, with tiny fades at each joint to avoid clicks. */
export async function keepRanges(url: string, ranges: Range[]) {
  const source = await storedFile(url);
  const duration = await audioDuration(source.path);
  const keep = normalizeRanges(ranges, duration);
  return withWorkspace(async (dir) => {
    const labels = keep.map((_, index) => `s${index}`);
    const parts = keep.map(({ start, end }, index) => {
      const length = end - start;
      const fades = length > FADE * 4 ? `,afade=t=in:d=${FADE},afade=t=out:st=${(length - FADE).toFixed(3)}:d=${FADE}` : "";
      return `[${labels[index]}]atrim=start=${start.toFixed(3)}:end=${end.toFixed(3)},asetpts=PTS-STARTPTS${fades}[k${index}]`;
    });
    const graph = [
      `[0:a]${NORMALIZE},asplit=${keep.length}${labels.map((label) => `[${label}]`).join("")}`,
      ...parts,
      `${keep.map((_, index) => `[k${index}]`).join("")}concat=n=${keep.length}:v=0:a=1[out]`,
    ].join(";");
    const output = join(dir, "edited.webm");
    await run("ffmpeg", ["-hide_banner", "-nostdin", "-y", "-i", source.path, "-filter_complex", graph, "-map", "[out]", ...encode, output]);
    return publish(output, source.prefix);
  });
}

/** Joins recordings, in order, into one new recording. */
export async function joinRecordings(urls: string[]) {
  if (urls.length < 2 || urls.length > 20) throw new AudioEditError(400, "Choose 2 to 20 recordings to join.");
  const sources = await Promise.all(urls.map(storedFile));
  return withWorkspace(async (dir) => {
    const graph = [
      ...sources.map((_, index) => `[${index}:a]${NORMALIZE}[a${index}]`),
      `${sources.map((_, index) => `[a${index}]`).join("")}concat=n=${sources.length}:v=0:a=1[out]`,
    ].join(";");
    const output = join(dir, "joined.webm");
    await run("ffmpeg", ["-hide_banner", "-nostdin", "-y", ...sources.flatMap((source) => ["-i", source.path]), "-filter_complex", graph, "-map", "[out]", ...encode, output], 300_000);
    return publish(output, sources[0].prefix);
  });
}

export async function storedDuration(url: string) {
  const source = await storedFile(url);
  return Math.max(1, Math.round(await audioDuration(source.path)));
}

export type EnhanceOptions = { denoise: boolean; level: boolean };

/**
 * Cleaner sound for recordings made on the move: removes low rumble and steady background
 * noise (road, fan, air conditioning) and evens out loudness to a comfortable level.
 * Timing is unchanged, so the transcript and word timings stay valid.
 */
export async function enhanceRecording(url: string, { denoise, level }: EnhanceOptions) {
  if (!denoise && !level) throw new AudioEditError(400, "Choose at least one improvement.");
  const source = await storedFile(url);
  return withWorkspace(async (dir) => {
    const filters = [NORMALIZE];
    if (denoise) filters.push("highpass=f=80", "afftdn=nr=12:nf=-30:tn=1");
    // Podcast-style loudness; true peak capped so it never clips.
    if (level) filters.push("loudnorm=I=-16:TP=-1.5:LRA=11");
    const output = join(dir, "enhanced.webm");
    await run("ffmpeg", ["-hide_banner", "-nostdin", "-y", "-i", source.path, "-af", filters.join(","), ...encode, output]);
    return publish(output, source.prefix);
  });
}

export const EXPORT_FORMATS = {
  mp3: { ext: "mp3", mime: "audio/mpeg", qualities: { standard: ["-c:a", "libmp3lame", "-b:a", "128k"], high: ["-c:a", "libmp3lame", "-b:a", "192k"], best: ["-c:a", "libmp3lame", "-b:a", "320k"] }, container: "mp3" },
  wav: { ext: "wav", mime: "audio/wav", qualities: { standard: ["-c:a", "pcm_s16le", "-ar", "16000"], high: ["-c:a", "pcm_s16le", "-ar", "44100"], best: ["-c:a", "pcm_s16le", "-ar", "48000"] }, container: "wav" },
  m4a: { ext: "m4a", mime: "audio/mp4", qualities: { standard: ["-c:a", "aac", "-b:a", "96k"], high: ["-c:a", "aac", "-b:a", "128k"], best: ["-c:a", "aac", "-b:a", "192k"] }, container: "ipod" },
  ogg: { ext: "ogg", mime: "audio/ogg", qualities: { standard: ["-c:a", "libvorbis", "-q:a", "4"], high: ["-c:a", "libvorbis", "-q:a", "6"], best: ["-c:a", "libvorbis", "-q:a", "8"] }, container: "ogg" },
  opus: { ext: "opus", mime: "audio/ogg", qualities: { standard: ["-c:a", "libopus", "-b:a", "32k"], high: ["-c:a", "libopus", "-b:a", "64k"], best: ["-c:a", "libopus", "-b:a", "96k"] }, container: "opus" },
  flac: { ext: "flac", mime: "audio/flac", qualities: { standard: ["-c:a", "flac", "-ar", "16000"], high: ["-c:a", "flac", "-ar", "44100"], best: ["-c:a", "flac", "-ar", "48000"] }, container: "flac" },
} as const;
export type ExportFormat = keyof typeof EXPORT_FORMATS;
export type ExportQuality = "standard" | "high" | "best";

/**
 * Converts a recording to another format for download. `deliver` receives the finished file
 * and must finish sending it before returning; the temporary copy is removed afterwards.
 * The stored recording itself is not changed.
 */
export async function convertRecording(url: string, format: ExportFormat, quality: ExportQuality, deliver: (path: string, mime: string, ext: string) => Promise<void>) {
  const source = await storedFile(url);
  const spec = EXPORT_FORMATS[format];
  return withWorkspace(async (dir) => {
    const output = join(dir, `export.${spec.ext}`);
    // Voice recordings are mono; keep them mono (smaller files, same sound).
    await run("ffmpeg", ["-hide_banner", "-nostdin", "-y", "-i", source.path, "-vn", "-ac", "1", ...spec.qualities[quality], "-f", spec.container, output], 300_000);
    await deliver(output, spec.mime, spec.ext);
  });
}

/** Loudness (RMS dBFS) of the background noise: the quietest tenth of 50 ms moments. */
export async function measureNoiseFloor(path: string) {
  const output = await run("ffmpeg", ["-hide_banner", "-nostdin", "-i", path, "-af",
    "aresample=16000,asetnsamples=n=800,astats=metadata=1:reset=1,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=-",
    "-f", "null", "-"], 120_000);
  const levels = [...output.matchAll(/RMS_level=(-?[\d.]+)/g)].map((match) => Number(match[1])).filter((value) => Number.isFinite(value) && value > -100).sort((a, b) => a - b);
  return levels.length ? levels[Math.floor(levels.length * 0.1)] : -60;
}

async function soundLabChain(path: string, settings: SoundLabSettings) {
  // The app sends the noise level it measured; if it didn't, measure it here.
  const floor = settings.noise > 0 && (settings.noiseFloor == null) ? await measureNoiseFloor(path) : settings.noiseFloor;
  return [NORMALIZE, ...soundLabFilters({ ...settings, noiseFloor: floor })].join(",");
}

/** Sound lab, whole recording: saves a new file (the original is kept for restoring). */
export async function soundLabRecording(url: string, settings: SoundLabSettings) {
  const source = await storedFile(url);
  return withWorkspace(async (dir) => {
    const output = join(dir, "lab.webm");
    const chain = await soundLabChain(source.path, settings);
    await run("ffmpeg", ["-hide_banner", "-nostdin", "-y", "-i", source.path, "-af", chain, "-c:a", "libopus", "-b:a", "96k", "-ac", "1", "-f", "webm", output], 300_000);
    return publish(output, source.prefix);
  });
}

/** Sound lab, a short stretch rendered with the exact settings, to compare before saving. */
export async function soundLabPreview(url: string, settings: SoundLabSettings, start: number, seconds: number, deliver: (path: string) => Promise<void>) {
  const source = await storedFile(url);
  return withWorkspace(async (dir) => {
    const output = join(dir, "preview.mp3");
    const chain = await soundLabChain(source.path, settings);
    // Process from the beginning (timed edits use the recording's own clock), then keep the stretch.
    await run("ffmpeg", ["-hide_banner", "-nostdin", "-y", "-to", String(start + seconds), "-i", source.path,
      "-af", `${chain},atrim=start=${start},asetpts=PTS-STARTPTS`, "-c:a", "libmp3lame", "-b:a", "160k", "-ac", "1", output], 120_000);
    await deliver(output);
  });
}

/** Voice plus background music, saved as a new file. Returns the file and the timing used. */
export async function mixRecording(voiceUrl: string, musicUrl: string, settings: MixSettings) {
  const voice = await storedFile(voiceUrl);
  const music = await storedFile(musicUrl);
  return withWorkspace(async (dir) => {
    const plan = mixPlan(await audioDuration(voice.path), await audioDuration(music.path), settings);
    const output = join(dir, "mix.webm");
    await run("ffmpeg", ["-hide_banner", "-nostdin", "-y", "-i", voice.path, "-i", music.path, "-filter_complex", mixGraph(plan, settings), "-map", "[out]",
      "-c:a", "libopus", "-b:a", "96k", "-ac", "1", "-f", "webm", output], 600_000);
    return { ...(await publish(output, voice.prefix)), plan };
  });
}

/** A short stretch of the mix, to listen to before saving. */
export async function mixPreview(voiceUrl: string, musicUrl: string, settings: MixSettings, start: number, seconds: number, deliver: (path: string) => Promise<void>) {
  const voice = await storedFile(voiceUrl);
  const music = await storedFile(musicUrl);
  return withWorkspace(async (dir) => {
    const plan = mixPlan(await audioDuration(voice.path), await audioDuration(music.path), settings);
    const from = Math.max(0, Math.min(start, Math.max(0, plan.total - 1)));
    const output = join(dir, "mix-preview.mp3");
    await run("ffmpeg", ["-hide_banner", "-nostdin", "-y", "-i", voice.path, "-i", music.path,
      "-filter_complex", mixGraph(plan, settings, { start: from, seconds }), "-map", "[out]", "-c:a", "libmp3lame", "-b:a", "160k", "-ac", "1", output], 180_000);
    await deliver(output);
  });
}

/** A separate copy of a stored recording (same format), for when two items would share one file. */
export async function duplicateStored(url: string) {
  const source = await storedFile(url);
  const root = storageRoot();
  const id = randomUUID();
  const { copyFile, readFile } = await import("node:fs/promises");
  const meta = await readFile(`${source.path}.json`, "utf8").catch(() => JSON.stringify({ contentType: "audio/webm" }));
  const temporary = join(root, `${id}.${randomUUID()}.partial`);
  await copyFile(source.path, temporary);
  await rename(temporary, join(root, id));
  await writeFile(join(root, `${id}.json`), meta, { mode: 0o600 });
  return `${source.prefix}/api/storage/objects/${id}`;
}
