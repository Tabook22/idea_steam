import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, ChevronDown, Download, FileText, LayoutTemplate, Loader2, Paperclip, PenTool, Play, Plus, Trash2, X } from "lucide-react";
import { SketchPad } from "@/components/sketch-pad";
import { NoteEditor } from "@/components/note-editor";
import { sanitizeDraftHtml } from "@/components/rich-text-editor";
import { appPath } from "@/lib/app-path";
import { getMeetingFile } from "@/lib/meeting-files";
import { MAX_FILE, compressPhoto, fileSize, newNote, noteTemplate, type MeetingNote } from "@/lib/meeting-notes";
import { clock } from "@/lib/meeting-view";

/**
 * The meeting notepad: write formatted notes, take photos, attach documents and draw, each kept
 * at the moment of the meeting it was added. Used live (on this device) and afterwards.
 */
export function MeetingNotepad({ notes, onChange, now, storeFile, seek, dark = false, copy, arabic }: {
  notes: MeetingNote[];
  onChange: (notes: MeetingNote[]) => void;
  /** Seconds into the meeting now (null once it's over). */
  now: () => number | null;
  /** Keeps a photo/document/drawing (on the device, or uploaded) and returns the finished note. */
  storeFile: (note: MeetingNote, file: Blob) => Promise<MeetingNote>;
  seek?: (at: number) => void;
  dark?: boolean;
  copy: (en: string, ar: string) => string;
  arabic: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [viewing, setViewing] = useState<MeetingNote | null>(null);
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState(false);
  const [local, setLocal] = useState<Record<string, string>>({});
  const photo = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const latest = useRef(notes);
  latest.current = notes;

  // Pictures still on this device are shown from the device.
  useEffect(() => {
    let cancelled = false;
    const missing = notes.filter((note) => note.pending && !local[note.id]);
    if (!missing.length) return;
    void Promise.all(missing.map(async (note) => [note.id, await getMeetingFile(note.id).catch(() => undefined)] as const)).then((found) => {
      if (cancelled) return;
      const urls: Record<string, string> = {};
      for (const [id, blob] of found) if (blob) urls[id] = URL.createObjectURL(blob);
      setLocal((current) => ({ ...current, ...urls }));
    });
    return () => { cancelled = true; };
  }, [notes]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { Object.values(local).forEach((url) => URL.revokeObjectURL(url)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const src = (note: MeetingNote) => local[note.id] ?? (note.url ? appPath(note.url, import.meta.env.BASE_URL) : undefined);
  const update = (id: string, patch: Partial<MeetingNote>) => onChange(latest.current.map((note) => (note.id === id ? { ...note, ...patch } : note)));
  const add = (note: MeetingNote) => onChange([...latest.current, note]);
  const remove = (note: MeetingNote) => {
    const label = note.kind === "text" ? copy("Delete this note?", "حذف هذه الملاحظة؟") : copy("Remove this from the meeting?", "إزالة هذا من الاجتماع؟");
    if (!window.confirm(label)) return;
    onChange(latest.current.filter((other) => other.id !== note.id));
    if (editing === note.id) setEditing(null);
  };

  const write = (html = "") => {
    const note = newNote("text", now(), { html });
    add(note);
    setEditing(note.id);
    setTemplates(false);
  };
  async function keep(kind: MeetingNote["kind"], blob: Blob, name: string) {
    if (blob.size > MAX_FILE) { window.alert(copy("That file is over 50 MB.", "الملف أكبر من 50 ميغابايت.")); return; }
    setBusy(true);
    try {
      const note = newNote(kind, now(), { name, mimeType: blob.type || "application/octet-stream", size: blob.size });
      add(await storeFile(note, blob));
    } catch {
      window.alert(copy("It couldn't be added. Please try again.", "تعذرت الإضافة. حاول مجددًا."));
    } finally { setBusy(false); }
  }
  const pickedPhotos = async (files: FileList | null) => {
    for (const picked of Array.from(files ?? [])) await keep("photo", await compressPhoto(picked), picked.name || "Photo.jpg");
  };
  const pickedFiles = async (files: FileList | null) => {
    for (const picked of Array.from(files ?? [])) await keep(picked.type.startsWith("image/") ? "photo" : "file", picked.type.startsWith("image/") ? await compressPhoto(picked) : picked, picked.name);
  };

  const ordered = useMemo(() => [...notes].sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity) || a.createdAt.localeCompare(b.createdAt)), [notes]);
  const tone = dark
    ? { card: "border-white/10 bg-white/[0.05] text-white", soft: "text-white/55", button: "bg-white/10 text-white hover:bg-white/15", chip: "bg-white/10 text-white/80" }
    : { card: "border bg-card", soft: "text-muted-foreground", button: "bg-secondary text-foreground hover:bg-secondary/80", chip: "bg-primary/10 text-primary" };

  const toolButton = `flex h-14 w-full flex-col items-center justify-center gap-0.5 rounded-2xl text-xs font-semibold ${tone.button}`;
  return (
    <div>
      <div className="grid grid-cols-5 gap-1.5" role="toolbar" aria-label={copy("Add to the notepad", "أضف إلى المفكرة")}>
        <button type="button" onClick={() => write()} className={toolButton}><Plus size={17} />{copy("Note", "ملاحظة")}</button>
        <button type="button" onClick={() => photo.current?.click()} className={toolButton}><Camera size={17} />{copy("Photo", "صورة")}</button>
        <button type="button" onClick={() => file.current?.click()} className={toolButton}><Paperclip size={17} />{copy("File", "ملف")}</button>
        <button type="button" onClick={() => setDrawing(true)} className={toolButton}><PenTool size={17} />{copy("Draw", "رسم")}</button>
        <div className="relative">
          <button type="button" onClick={() => setTemplates((value) => !value)} aria-expanded={templates} className={toolButton}>
            <LayoutTemplate size={17} /><span className="inline-flex items-center gap-0.5">{copy("Template", "قالب")}<ChevronDown size={11} /></span>
          </button>
          {templates && (
            <div className={`absolute end-0 z-30 mt-1 w-56 overflow-hidden rounded-2xl border shadow-xl ${dark ? "border-white/15 bg-[#10241c] text-white" : "bg-popover"}`}>
              {([["meeting", copy("Meeting notes", "محضر اجتماع")], ["decisions", copy("Decisions & actions", "قرارات ومهام")], ["oneOnOne", copy("One-to-one", "لقاء ثنائي")]] as const).map(([kind, label]) => (
                <button key={kind} type="button" onClick={() => write(noteTemplate(kind, arabic))} className={`block w-full px-4 py-3 text-start text-sm ${dark ? "hover:bg-white/10" : "hover:bg-secondary"}`}>{label}</button>
              ))}
            </div>
          )}
        </div>

        <input ref={photo} type="file" accept="image/*" capture="environment" multiple hidden onChange={(event) => { void pickedPhotos(event.target.files); event.target.value = ""; }} />
        <input ref={file} type="file" multiple hidden accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,image/*"
          onChange={(event) => { void pickedFiles(event.target.files); event.target.value = ""; }} />
      </div>

      {busy && <p className={`mt-2 flex items-center gap-2 text-xs ${tone.soft}`} role="status"><Loader2 size={14} className="animate-spin" />{copy("Adding…", "جارٍ الإضافة…")}</p>}
      {!ordered.length && (
        <div className={`mt-3 rounded-2xl border border-dashed px-4 py-6 text-center text-sm ${dark ? "border-white/15 text-white/55" : "text-muted-foreground"}`}>
          {copy("Write notes, snap the whiteboard, attach the agenda or sketch an idea. Everything is kept with the moment of the meeting it belongs to.",
            "اكتب الملاحظات، صوّر السبورة، أرفق جدول الأعمال أو ارسم فكرة. يُحفظ كل شيء مع لحظته من الاجتماع.")}
        </div>
      )}

      <ol className="mt-3 space-y-3">
        {ordered.map((note) => (
          <li key={note.id} className={`overflow-hidden rounded-2xl ${tone.card}`}>
            <div className="flex items-center gap-2 px-3 pt-2.5 text-xs">
              {note.at !== null && (
                <button type="button" onClick={() => seek?.(note.at!)} disabled={!seek}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono tabular-nums ${tone.chip}`} dir="ltr">
                  {seek && <Play size={9} />}{clock(note.at)}
                </button>
              )}
              <span className={`min-w-0 flex-1 truncate ${tone.soft}`}>
                {note.kind === "text" ? copy("Note", "ملاحظة") : note.kind === "photo" ? copy("Photo", "صورة") : note.kind === "drawing" ? copy("Drawing", "رسم") : note.name}
                {note.pending && <span className="ms-1.5">· {copy("on this phone", "على الهاتف")}</span>}
              </span>
              {note.kind === "text" && editing !== note.id && (
                <button type="button" onClick={() => setEditing(note.id)} className={`rounded-full px-2.5 py-1 font-medium ${tone.button}`}>{copy("Edit", "تعديل")}</button>
              )}
              {note.kind === "text" && editing === note.id && (
                <button type="button" onClick={() => setEditing(null)} className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 font-semibold text-primary-foreground"><Check size={12} />{copy("Done", "تم")}</button>
              )}
              <button type="button" onClick={() => remove(note)} aria-label={copy("Delete", "حذف")} className={`grid h-7 w-7 place-items-center rounded-full ${dark ? "hover:bg-white/10" : "hover:bg-destructive/10 hover:text-destructive"}`}><Trash2 size={14} /></button>
            </div>
            <div className="p-3 pt-2">
              {note.kind === "text" ? (
                editing === note.id ? (
                  <NoteEditor value={note.html ?? ""} onChange={(html) => update(note.id, { html })} autoFocus dark={dark} copy={copy}
                    placeholder={copy("Write here… (headings, lists, checklists, highlight)", "اكتب هنا… (عناوين، قوائم، مهام، تمييز)")} />
                ) : (
                  <div dir="auto" className="note-paper cursor-text text-[15px] leading-7" onClick={() => setEditing(note.id)}
                    dangerouslySetInnerHTML={{ __html: sanitizeDraftHtml(note.html ?? "") || `<p>${copy("(empty note)", "(ملاحظة فارغة)")}</p>` }} />
                )
              ) : note.kind === "file" ? (
                <a href={src(note)} target="_blank" rel="noreferrer" download={note.pending ? note.name : undefined}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${dark ? "bg-white/[0.06] hover:bg-white/10" : "bg-secondary/60 hover:bg-secondary"}`}>
                  <FileText size={22} className="shrink-0 text-primary" />
                  <span className="min-w-0 flex-1"><span dir="auto" className="block truncate text-sm font-medium">{note.name}</span><span className={`text-xs ${tone.soft}`}>{fileSize(note.size)}</span></span>
                  <Download size={16} className={tone.soft} />
                </a>
              ) : (
                <button type="button" onClick={() => setViewing(note)} className="block w-full overflow-hidden rounded-xl bg-white" aria-label={copy("View larger", "عرض أكبر")}>
                  {src(note) ? <img src={src(note)} alt={note.name ?? ""} loading="lazy" className="max-h-72 w-full object-contain" /> : <span className="grid h-32 place-items-center"><Loader2 className="animate-spin text-muted-foreground" /></span>}
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>

      {drawing && (
        <SketchPad copy={copy} onClose={() => setDrawing(false)}
          onSave={(png) => { setDrawing(false); void keep("drawing", png, `${copy("Drawing", "رسم")}.png`); }} />
      )}
      {viewing && (
        <div className="fixed inset-0 z-[85] flex flex-col bg-black/95" role="dialog" aria-modal="true" onClick={() => setViewing(null)}>
          <button type="button" aria-label={copy("Close", "إغلاق")} className="ms-auto m-3 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white"><X size={20} /></button>
          {src(viewing) && <img src={src(viewing)} alt="" className="min-h-0 flex-1 object-contain p-2" />}
        </div>
      )}
    </div>
  );
}
