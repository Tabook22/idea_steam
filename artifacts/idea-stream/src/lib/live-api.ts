import { useCallback, useEffect, useRef, useState } from "react";
import { appPath } from "@/lib/app-path";
import { encode } from "@/lib/vendor/uqr";

/** Live workshops: what the server sends, the calls, and a polling hook. */

export type LiveSpace = "me" | "team" | "all";
export type LivePerson = { id: number; name: string; emoji: string; team: number | null; online: boolean };
export type LiveAuthor = { id: number; name: string; emoji: string; team: number | null } | null;
export type LiveCard = {
  id: number; author: LiveAuthor; mine: boolean; space: LiveSpace; team: number | null; text: string; parentId: number | null; hidden: boolean;
  /** On the shared board: its spot (null: placed automatically) and paper colour. */
  board: { x: number; y: number } | null; color: string | null;
  media: { url: string; type: string } | null;
  reactions: Array<{ emoji: string; count: number; mine: boolean }>;
  /** Dots on it (null while voting: people see only their own). */
  votes: number | null;
  myVote: boolean;
  comments: Array<{ id: number; author: LiveAuthor; mine: boolean; text: string; createdAt: string }>;
  createdAt: string;
};
export type LivePhase = "free" | "think" | "share" | "vote" | "build" | "present";
export type LiveSynthesis = { summary: string; themes: Array<{ title: string; summary: string; cardIds: number[] }>; standouts: Array<{ cardId: number; why: string }>; gaps: string[] };
export type LiveSessionInfo = {
  id: number; code: string; title: string; challenge: string; status: "open" | "closed" | "ended"; teamCount: number; createdAt: string;
  phase: LivePhase; phaseEndsAt: string | null; votesPerPerson: number; synthesis: LiveSynthesis | null; synthesisAt: string | null;
};
export type LiveState = {
  version: number; session: LiveSessionInfo; people: LivePerson[]; cards: LiveCard[];
  me?: LivePerson; privateCounts?: Record<string, number>;
  /** The server's clock (timers count down by it), and the dots this participant used. */
  now: string; votesUsed?: number;
  /** The Pulse screen (asked for with ?pulse=1, the instructor only). */
  pulse?: LivePulse;
};
export type PulseHelpKind = "comment" | "reaction" | "vote" | "build";
export type LivePulse = {
  links: Array<{ a: number; b: number; count: number; people: number[]; kinds: Partial<Record<PulseHelpKind, number>> }>;
  helps: Array<{ from: number; to: number; personId: number; kind: PulseHelpKind; cardId: number; at: string }>;
  similar: Array<{ a: number; b: number; words: string[]; score: number }>;
  feed: Array<{ at: string; kind: "idea" | "join" | PulseHelpKind; team: number | null; personId: number | null; toTeam: number | null; cardId: number | null; text: string }>;
  lastActivity: Record<string, string>;
};
export type LiveSessionSummary = LiveSessionInfo & { participantCount: number; cardCount: number };

export class LiveError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function liveFetch<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const response = await fetch(appPath(path, import.meta.env.BASE_URL), {
    credentials: "same-origin",
    ...rest,
    ...(json !== undefined ? { body: JSON.stringify(json), headers: { "Content-Type": "application/json", ...(rest.headers ?? {}) } } : {}),
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new LiveError(response.status, (body as { error?: string }).error ?? "Something went wrong. Try again.");
  return body as T;
}

/** "MYC482" → "MYC-482". */
export const showCode = (code: string) => (code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code);
export const joinLink = (code: string) => `${location.origin}${appPath(`/join/${code}`, import.meta.env.BASE_URL)}`;

/** The QR code as one SVG path (dark modules), with its size in modules. */
export function qrPath(text: string) {
  const { size, data } = encode(text, { ecc: "M", border: 2 });
  let path = "";
  data.forEach((row, y) => row.forEach((dark, x) => { if (dark) path += `M${x},${y}h1v1h-1z`; }));
  return { size, path };
}

/**
 * The session's state, kept fresh by polling (quick while visible, slow in the background). The
 * server answers "unchanged" most of the time, so a hundred phones cost little.
 */
export function useLiveState(url: string | null, every = 3000) {
  const [state, setState] = useState<LiveState | null>(null);
  const [error, setError] = useState<LiveError | null>(null);
  const version = useRef<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (!url) return;
    window.clearTimeout(timer.current);
    try {
      const next = await liveFetch<LiveState | { version: number; unchanged: true }>(`${url}${url.includes("?") ? "&" : "?"}since=${version.current ?? ""}`);
      if (!alive.current) return;
      if (!("unchanged" in next)) { version.current = next.version; setState(next); }
      setError(null);
    } catch (failure) {
      if (alive.current) setError(failure instanceof LiveError ? failure : new LiveError(0, "No connection. Retrying…"));
    }
    if (alive.current) timer.current = window.setTimeout(() => void load(), document.hidden ? every * 4 : every);
  }, [url, every]);

  useEffect(() => {
    alive.current = true;
    version.current = null;
    void load();
    const wake = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", wake);
    return () => { alive.current = false; window.clearTimeout(timer.current); document.removeEventListener("visibilitychange", wake); };
  }, [load]);

  /** After a change: fetch right away (and always the full state). */
  const refresh = useCallback(() => { version.current = null; return load(); }, [load]);
  return { state, error, refresh };
}

/** Photos are made smaller on the phone before upload (fast on busy workshop Wi-Fi). */
export async function shrinkPhoto(file: File, max = 1600): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob ?? file), "image/jpeg", 0.85));
  } catch { return file; }
}

export const TEAM_COLORS = ["#2563eb", "#16a34a", "#ea580c", "#db2777", "#7c3aed", "#0891b2", "#ca8a04", "#dc2626", "#4f46e5", "#059669", "#c026d3", "#0d9488"];
export const teamColor = (team: number | null) => (team ? TEAM_COLORS[(team - 1) % TEAM_COLORS.length] : "#64748b");
export const LIVE_EMOJIS = ["🙂", "😎", "🤓", "🦊", "🐼", "🦁", "🐯", "🐨", "🐙", "🦉", "🐝", "🌟", "🚀", "🌈", "🔥", "🍀"];

/** The workshop's steps: what each asks of people. */
export const PHASE_INFO: Record<LivePhase, { emoji: string; en: string; ar: string; doEn: string; doAr: string; color: string }> = {
  free: { emoji: "💬", en: "Open", ar: "مفتوح", doEn: "Share ideas any way you like.", doAr: "شارك أفكارك كما تشاء.", color: "#64748b" },
  think: { emoji: "🤔", en: "Think alone", ar: "فكّر وحدك", doEn: "Write your own ideas in Me. Nobody sees them yet.", doAr: "اكتب أفكارك في «أنا». لا يراها أحد بعد.", color: "#7c3aed" },
  share: { emoji: "🤝", en: "Share in your team", ar: "شارك فريقك", doEn: "Share your best ideas with your team and build on theirs.", doAr: "شارك أفضل أفكارك مع فريقك وابنِ على أفكارهم.", color: "#2563eb" },
  vote: { emoji: "🗳️", en: "Vote", ar: "صوّت", doEn: "Put your dots on the ideas you like most.", doAr: "ضع نقاطك على الأفكار التي تعجبك أكثر.", color: "#db2777" },
  build: { emoji: "🛠️", en: "Build", ar: "طوّر", doEn: "Develop the top ideas: how would it work? What's needed?", doAr: "طوّر الأفكار الأعلى: كيف ستعمل؟ وما المطلوب؟", color: "#ea580c" },
  present: { emoji: "🎤", en: "Present", ar: "اعرض", doEn: "Teams present their best idea.", doAr: "تعرض الفرق أفضل أفكارها.", color: "#16a34a" },
};

/** Seconds left on the phase timer, by the server's clock (null: no timer). */
export function useCountdown(endsAt: string | null | undefined, serverNow: string | undefined) {
  const [, tick] = useState(0);
  const offset = useRef(0);
  useEffect(() => { if (serverNow) offset.current = Date.parse(serverNow) - Date.now(); }, [serverNow]);
  useEffect(() => {
    if (!endsAt) return;
    const timer = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(timer);
  }, [endsAt]);
  if (!endsAt) return null;
  return Math.max(0, Math.round((Date.parse(endsAt) - (Date.now() + offset.current)) / 1000));
}
export const clockText = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
