/** The meeting notepad: notes, photos, documents and drawings, each at a moment of the meeting. */

export type NoteKind = "text" | "photo" | "file" | "drawing";
export type MeetingNote = {
  id: string;
  kind: NoteKind;
  /** Seconds into the meeting; null when added afterwards. */
  at: number | null;
  html?: string;
  url?: string;
  name?: string;
  mimeType?: string;
  size?: number;
  createdAt: string;
  /** Still only on this device (its file waits in the meeting file store). */
  pending?: boolean;
};

export const newNoteId = () => `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function newNote(kind: NoteKind, at: number | null, extra: Partial<MeetingNote> = {}): MeetingNote {
  return { id: newNoteId(), kind, at: at === null ? null : Math.round(at * 10) / 10, createdAt: new Date().toISOString(), ...extra };
}

/** Ready-made layouts for a meeting page. */
export function noteTemplate(kind: "meeting" | "decisions" | "oneOnOne", arabic: boolean) {
  const t = (en: string, ar: string) => (arabic ? ar : en);
  if (kind === "decisions")
    return `<h2>✅ ${t("Decisions", "القرارات")}</h2><ul><li><br></li></ul><h2>📌 ${t("Actions", "المهام")}</h2><ul><li>☐ <br></li></ul>`;
  if (kind === "oneOnOne")
    return `<h2>🙂 ${t("How are things?", "كيف تسير الأمور؟")}</h2><p><br></p><h2>🎯 ${t("Progress", "التقدّم")}</h2><ul><li><br></li></ul><h2>🧱 ${t("Blockers", "العوائق")}</h2><ul><li><br></li></ul><h2>📌 ${t("Next steps", "الخطوات التالية")}</h2><ul><li>☐ <br></li></ul>`;
  return `<h2>👥 ${t("Attendees", "الحاضرون")}</h2><p><br></p><h2>🗂 ${t("Agenda", "جدول الأعمال")}</h2><ol><li><br></li></ol><h2>📝 ${t("Notes", "الملاحظات")}</h2><ul><li><br></li></ul><h2>✅ ${t("Decisions", "القرارات")}</h2><ul><li><br></li></ul><h2>📌 ${t("Action items", "المهام")}</h2><ul><li>☐ <br></li></ul>`;
}

/** A note's words, for previews. */
export const notePlain = (html: string) => html.replace(/<\/(p|div|h[1-3]|li)>|<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** Phone photos made lighter for upload: at most 2000 px on the long side, JPEG. */
export async function compressPhoto(file: Blob, longest = 2000, quality = 0.85): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

export const fileSize = (bytes?: number) =>
  !bytes ? "" : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export const MAX_FILE = 50 * 1024 * 1024;
