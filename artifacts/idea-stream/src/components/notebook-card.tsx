import { useEffect, useRef, useState } from "react";
import { BookOpen, FileDown, Loader2, PenLine, ScanText } from "lucide-react";
import { NotebookEditor } from "@/components/notebook-editor";
import { getMeetingFile } from "@/lib/meeting-files";
import { PAGE_H, PAGE_W, drawPage, newNotebook, type MeetingNotebookDoc, type NotebookPage, type PageItem } from "@/lib/notebook";
import { notebookPdf } from "@/lib/notebook-render";
import { appPath } from "@/lib/app-path";

/**
 * The meeting notebook, closed: its first page, how many pages, and buttons to open it, get a
 * PDF, or read the handwriting. Opening shows the full notebook editor.
 */
export function NotebookCard({ doc, title, copy, dark = false, storeMedia, storeSnapshot, onSave, onRead }: {
  doc: MeetingNotebookDoc | null;
  title: string;
  copy: (en: string, ar: string) => string;
  dark?: boolean;
  storeMedia: (item: PageItem, file: Blob) => Promise<PageItem>;
  storeSnapshot: (page: NotebookPage, png: Blob) => Promise<NotebookPage["snapshot"]>;
  onSave: (doc: MeetingNotebookDoc) => void | Promise<void>;
  /** Afterwards: turn the handwriting into text (AI). */
  onRead?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const pages = doc?.pages ?? [];
  const written = pages.filter((page) => page.strokes.length || page.items.length).length;
  const handwriting = pages.map((page) => page.handwriting?.trim()).filter(Boolean);

  useEffect(() => {
    const target = preview.current;
    const first = pages[0];
    if (!target) return;
    const ctx = target.getContext("2d")!;
    drawPage(ctx, first ?? newNotebook().pages[0], target.width / PAGE_W);
  }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pdf() {
    if (!doc) return;
    setBusy(copy("Making the PDF…", "جارٍ إنشاء ملف PDF…"));
    try {
      const local: Record<string, string> = {};
      for (const item of doc.pages.flatMap((page) => page.items).filter((item) => item.pending)) {
        const blob = await getMeetingFile(item.id).catch(() => undefined);
        if (blob) local[item.id] = URL.createObjectURL(blob);
      }
      const file = await notebookPdf(doc, (item) => local[item.id] ?? (item.url ? appPath(item.url, import.meta.env.BASE_URL) : undefined));
      const url = URL.createObjectURL(file);
      const link = Object.assign(document.createElement("a"), { href: url, download: `${title.replace(/[\\/:*?"<>|]+/g, " ").slice(0, 80) || "Notebook"}.pdf` });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => { URL.revokeObjectURL(url); Object.values(local).forEach((one) => URL.revokeObjectURL(one)); }, 4000);
    } finally { setBusy(null); }
  }
  async function read() {
    if (!onRead) return;
    setBusy(copy("Reading your handwriting…", "جارٍ قراءة خطّك…"));
    try { await onRead(); } finally { setBusy(null); }
  }

  const soft = dark ? "text-white/60" : "text-muted-foreground";
  const button = dark ? "bg-white/10 text-white hover:bg-white/15" : "bg-secondary hover:bg-secondary/80";
  return (
    <div className={`overflow-hidden rounded-2xl border ${dark ? "border-white/10 bg-gradient-to-br from-amber-200/10 to-white/[0.03] text-white" : "bg-gradient-to-br from-amber-50 via-card to-card shadow-sm dark:from-amber-950/20"}`}>
      <div className="flex gap-3 p-3">
        <button type="button" onClick={() => setOpen(true)} className="shrink-0 overflow-hidden rounded-md shadow-md ring-1 ring-black/10" aria-label={copy("Open the notebook", "افتح الدفتر")}>
          <canvas ref={preview} width={84} height={Math.round(84 * PAGE_H / PAGE_W)} className="block" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-serif text-lg"><BookOpen size={17} className="text-amber-600" />{copy("Notebook", "الدفتر")}</p>
          <p className={`text-xs ${soft}`}>
            {pages.length
              ? copy(`${pages.length} page${pages.length === 1 ? "" : "s"} · ${written} written`, `${pages.length} صفحة · ${written} مكتوبة`)
              : copy("Write by hand with a pen or finger, or type. Add pictures, video and sound.", "اكتب بخط يدك بالقلم أو الإصبع، أو اكتب بلوحة المفاتيح. أضف صورًا وفيديو وصوتًا.")}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-3.5 text-xs font-semibold text-primary-foreground">
              <PenLine size={14} />{pages.length ? copy("Open", "افتح") : copy("Start writing", "ابدأ الكتابة")}
            </button>
            {pages.length > 0 && (
              <button type="button" onClick={() => void pdf()} disabled={!!busy} className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium ${button}`}><FileDown size={14} />PDF</button>
            )}
            {onRead && pages.some((page) => page.strokes.length) && (
              <button type="button" onClick={() => void read()} disabled={!!busy} className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium ${button}`}>
                <ScanText size={14} />{copy("Read handwriting", "اقرأ الخط")}
              </button>
            )}
          </div>
          {busy && <p className={`mt-2 flex items-center gap-1.5 text-xs ${soft}`} role="status"><Loader2 size={13} className="animate-spin" />{busy}</p>}
        </div>
      </div>
      {handwriting.length > 0 && (
        <details className={`border-t px-3 py-2 text-sm ${dark ? "border-white/10" : ""}`}>
          <summary className={`cursor-pointer text-xs font-semibold ${soft}`}>{copy("Your handwriting as text", "خطّك كنص")}</summary>
          <div className="mt-2 space-y-2">
            {pages.map((page, index) => page.handwriting?.trim() ? (
              <div key={page.id}>
                <p className={`text-[11px] font-semibold ${soft}`}>{copy(`Page ${index + 1}`, `الصفحة ${index + 1}`)}</p>
                <p dir="auto" className="whitespace-pre-wrap text-start leading-6">{page.handwriting}</p>
              </div>
            ) : null)}
          </div>
        </details>
      )}
      {open && (
        <NotebookEditor
          doc={doc ?? newNotebook()}
          title={title}
          copy={copy}
          storeMedia={storeMedia}
          storeSnapshot={storeSnapshot}
          onDone={(next) => { setOpen(false); void onSave(next); }}
        />
      )}
    </div>
  );
}
