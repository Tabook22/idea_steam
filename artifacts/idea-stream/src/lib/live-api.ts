import { useCallback, useEffect, useRef, useState } from "react";
import { appPath } from "@/lib/app-path";
import { encode } from "@/lib/vendor/uqr";

/** Live workshops: what the server sends, the calls, and a polling hook. */

export type LiveSpace = "me" | "team" | "all";
export type LivePerson = { id: number; name: string; emoji: string; team: number | null; online: boolean };
export type LiveAuthor = { id: number; name: string; emoji: string; team: number | null } | null;
export type LiveCard = {
  id: number; author: LiveAuthor; mine: boolean; space: LiveSpace; team: number | null; text: string; parentId: number | null; hidden: boolean;
  media: { url: string; type: string } | null;
  reactions: Array<{ emoji: string; count: number; mine: boolean }>;
  comments: Array<{ id: number; author: LiveAuthor; mine: boolean; text: string; createdAt: string }>;
  createdAt: string;
};
export type LiveSessionInfo = { id: number; code: string; title: string; challenge: string; status: "open" | "closed" | "ended"; teamCount: number; createdAt: string };
export type LiveState = {
  version: number; session: LiveSessionInfo; people: LivePerson[]; cards: LiveCard[];
  me?: LivePerson; privateCounts?: Record<string, number>;
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
