import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Copy,
  Eraser,
  FileDown,
  Film,
  Hand,
  Highlighter,
  ImagePlus,
  Layers,
  Loader2,
  Minus,
  Music,
  PenLine,
  Plus,
  Redo2,
  Settings2,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { sanitizeDraftHtml } from "@/components/rich-text-editor";
import { getMeetingFile } from "@/lib/meeting-files";
import {
  INKS,
  MARKERS,
  PAGE_COLORS,
  PAGE_H,
  PAGE_W,
  compactPoints,
  drawPage,
  drawPaper,
  newPage,
  pageHasContent,
  strokesAt,
  uid,
  type MeetingNotebookDoc,
  type NotebookPage,
  type PageColor,
  type PageItem,
  type Paper,
  type Stroke,
} from "@/lib/notebook";
import { notebookPdf, renderPageImage } from "@/lib/notebook-render";
import { appPath } from "@/lib/app-path";

type Tool = "pen" | "marker" | "eraser" | "text" | "select";
type Copy = (en: string, ar: string) => string;
const PEN_SIZES = [2, 3.5, 6];
const MAX_MEDIA = 50 * 1024 * 1024;

/**
 * A handwriting notebook (meetings and books): pages you write on by hand (pen with pressure, highlighter, eraser)
 * or type on, with images, video and audio placed on the page. Pages in a sidebar; each page has
 * its own paper (lined, blank, dots, grid) and colour. Undo/redo, PDF.
 */
export function NotebookEditor({ doc: initial, title, copy, storeMedia, storeSnapshot, onDone, onChange, status }: {
  doc: MeetingNotebookDoc;
  title: string;
  copy: Copy;
  /** Keeps a photo/video/sound (on this device, or uploaded) and returns the finished item. */
  storeMedia: (item: PageItem, file: Blob) => Promise<PageItem>;
  /** Keeps a picture of a page and returns where it is. */
  storeSnapshot: (page: NotebookPage, png: Blob) => Promise<NotebookPage["snapshot"]>;
  onDone: (doc: MeetingNotebookDoc) => void;
  /** Every change while writing (books save as you go). */
  onChange?: (doc: MeetingNotebookDoc) => void;
  /** Shown under the title, e.g. "Saved". */
  status?: string;
}) {
  const [doc, setDoc] = useState<MeetingNotebookDoc>(initial);
  const docRef = useRef(doc);
  docRef.current = doc;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    onChange?.(doc);
  }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps
  const [current, setCurrent] = useState(0);
  const [tool, setTool] = useState<Tool>("pen");
  const [ink, setInk] = useState(INKS[0]);
  const [penSize, setPenSize] = useState(PEN_SIZES[1]);
  const [marker, setMarker] = useState(MARKERS[0]);
  const [stylusOnly, setStylusOnly] = useState(false);
  const [settings, setSettings] = useState(false);
  const [pagesOpen, setPagesOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [local, setLocal] = useState<Record<string, string>>({});
  const undoStack = useRef<Array<{ pageId: string; page: NotebookPage }>>([]);
  const redoStack = useRef<Array<{ pageId: string; page: NotebookPage }>>([]);
  const [, setHistoryTick] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLInputElement>(null);

  // Media still on this device is shown from the device.
  useEffect(() => {
    const missing = doc.pages.flatMap((page) => page.items).filter((item) => item.pending && !local[item.id]);
    if (!missing.length) return;
    let cancelled = false;
    void Promise.all(missing.map(async (item) => [item.id, await getMeetingFile(item.id).catch(() => undefined)] as const)).then((found) => {
      if (cancelled) return;
      const urls: Record<string, string> = {};
      for (const [id, blob] of found) if (blob) urls[id] = URL.createObjectURL(blob);
      setLocal((all) => ({ ...all, ...urls }));
    });
    return () => { cancelled = true; };
  }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps
  const src = useCallback((item: PageItem) => local[item.id] ?? (item.url ? appPath(item.url, import.meta.env.BASE_URL) : undefined), [local]);

  /** Changes a page (undoable), marking it changed since its last picture. */
  const changePage = useCallback((pageId: string, change: (page: NotebookPage) => NotebookPage, undoable = true) => {
    const before = docRef.current.pages.find((page) => page.id === pageId);
    if (!before) return;
    if (undoable) {
      undoStack.current = [...undoStack.current.slice(-80), { pageId, page: before }];
      redoStack.current = [];
      setHistoryTick((tick) => tick + 1);
    }
    const next = { ...docRef.current, pages: docRef.current.pages.map((page) => (page.id === pageId ? { ...change(page), rev: page.rev + 1 } : page)) };
    docRef.current = next;
    setDoc(next);
  }, []);
  const restore = (from: typeof undoStack, to: typeof redoStack) => {
    const step = from.current.pop();
    if (!step) return;
    const present = docRef.current.pages.find((page) => page.id === step.pageId);
    if (present) to.current.push({ pageId: step.pageId, page: present });
    const next = { ...docRef.current, pages: docRef.current.pages.map((page) => (page.id === step.pageId ? { ...step.page, rev: page.rev + 1 } : page)) };
    docRef.current = next;
    setDoc(next);
    setHistoryTick((tick) => tick + 1);
  };
  const undo = () => restore(undoStack, redoStack);
  const redo = () => restore(redoStack, undoStack);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (editing || !(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      if (event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  // Which page is in view.
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setCurrent(Number((visible.target as HTMLElement).dataset.index));
    }, { root: box, threshold: [0.35, 0.6] });
    box.querySelectorAll("[data-page]").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [doc.pages.length]);
  const goTo = (index: number) => {
    scroller.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setPagesOpen(false);
  };

  // Pages: add, duplicate, move, delete, paper and colour.
  const page = doc.pages[Math.min(current, doc.pages.length - 1)];
  const setPages = (pages: NotebookPage[]) => { const next = { ...docRef.current, pages }; docRef.current = next; setDoc(next); };
  const addPage = (after = current) => {
    const pages = [...docRef.current.pages];
    const like = pages[after] ?? page;
    pages.splice(after + 1, 0, newPage(like.paper, like.color));
    setPages(pages);
    setTimeout(() => goTo(after + 1), 60);
  };
  const duplicatePage = () => {
    const copyOf: NotebookPage = { ...structuredClone(page), id: uid("p"), rev: 0, snapshot: undefined, handwriting: undefined,
      strokes: page.strokes.map((stroke) => ({ ...stroke, id: uid("s") })), items: page.items.map((item) => ({ ...item, id: item.pending ? item.id : uid("i") })) };
    const pages = [...doc.pages];
    pages.splice(current + 1, 0, copyOf);
    setPages(pages);
    setTimeout(() => goTo(current + 1), 60);
  };
  const deletePage = () => {
    if (doc.pages.length === 1) { setPages([newPage(page.paper, page.color)]); return; }
    if (pageHasContent(page) && !window.confirm(copy(`Delete page ${current + 1}?`, `حذف الصفحة ${current + 1}؟`))) return;
    setPages(doc.pages.filter((_, index) => index !== current));
    setCurrent(Math.max(0, current - 1));
  };
  const movePage = (delta: number) => {
    const target = current + delta;
    if (target < 0 || target >= doc.pages.length) return;
    const pages = [...doc.pages];
    [pages[current], pages[target]] = [pages[target], pages[current]];
    setPages(pages);
    setTimeout(() => goTo(target), 60);
  };
  const styleAll = (patch: Partial<Pick<NotebookPage, "paper" | "color">>, all: boolean) =>
    setPages(doc.pages.map((one, index) => (all || index === current ? { ...one, ...patch, rev: one.rev + 1 } : one)));

  // Media.
  async function insertMedia(kind: "image" | "video" | "audio", file: File) {
    if (file.size > MAX_MEDIA) { window.alert(copy("That file is over 50 MB.", "الملف أكبر من 50 ميغابايت.")); return; }
    setBusy(copy("Adding…", "جارٍ الإضافة…"));
    try {
      let w = kind === "audio" ? 440 : 480, h = kind === "audio" ? 96 : 270;
      if (kind === "image") {
        const bitmap = await createImageBitmap(file).catch(() => null);
        if (bitmap) { const ratio = Math.min(520 / bitmap.width, 520 / bitmap.height, 1); w = Math.round(bitmap.width * ratio); h = Math.round(bitmap.height * ratio); }
      }
      const target = page;
      const item: PageItem = { id: uid("i"), kind, x: Math.round((PAGE_W - w) / 2), y: 160, w, h, name: file.name, mimeType: file.type };
      const stored = await storeMedia(item, file);
      changePage(target.id, (one) => ({ ...one, items: [...one.items, stored] }));
      setTool("select");
      setSelected(stored.id);
    } catch {
      window.alert(copy("It couldn't be added. Please try again.", "تعذرت الإضافة. حاول مجددًا."));
    } finally { setBusy(null); }
  }

  async function finish() {
    setEditing(null);
    setBusy(copy("Saving your pages…", "جارٍ حفظ صفحاتك…"));
    try {
      // A picture of each changed page (for the notebook entry and reading handwriting).
      const pages = await Promise.all(docRef.current.pages.map(async (one) => {
        if (!pageHasContent(one)) return { ...one, snapshot: undefined };
        if (one.snapshot && one.snapshot.rev === one.rev && (one.snapshot.url || one.snapshot.pending)) return one;
        try {
          const png = await renderPageImage(one, src);
          return { ...one, snapshot: await storeSnapshot(one, png) };
        } catch { return one; }
      }));
      onDone({ ...docRef.current, pages });
    } finally { setBusy(null); }
  }
  async function exportPdf() {
    setBusy(copy("Making the PDF…", "جارٍ إنشاء ملف PDF…"));
    try {
      const pdf = await notebookPdf(docRef.current, src);
      const url = URL.createObjectURL(pdf);
      const link = Object.assign(document.createElement("a"), { href: url, download: `${title.replace(/[\\/:*?"<>|]+/g, " ").slice(0, 80) || "Notebook"}.pdf` });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } finally { setBusy(null); }
  }

  const toolButton = (active: boolean) => `grid h-10 w-10 shrink-0 place-items-center rounded-xl transition ${active ? "bg-primary text-primary-foreground shadow" : "text-foreground hover:bg-secondary"}`;
  const colors = tool === "marker" ? MARKERS : INKS;
  const activeColor = tool === "marker" ? marker : ink;

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-[#e9e6df] text-foreground dark:bg-[#0d1117]" role="dialog" aria-modal="true" aria-label={copy("Notebook", "الدفتر")}
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      {/* Top bar */}
      <div className="flex items-center gap-1 border-b bg-background/95 px-2 py-1.5 backdrop-blur">
        <button type="button" onClick={() => void finish()} className="inline-flex h-10 items-center gap-1.5 rounded-xl px-2.5 text-sm font-semibold hover:bg-secondary" aria-label={copy("Done", "تم")}>
          <ArrowLeft size={18} className="rtl:rotate-180" />{copy("Done", "تم")}
        </button>
        <div className="min-w-0 flex-1 px-1">
          <p dir="auto" className="truncate text-sm font-semibold">{title}</p>
          <p className="text-[11px] text-muted-foreground">{copy(`Page ${current + 1} of ${doc.pages.length}`, `الصفحة ${current + 1} من ${doc.pages.length}`)}{status ? ` · ${status}` : ""}</p>
        </div>
        <button type="button" onClick={undo} disabled={!undoStack.current.length} aria-label={copy("Undo", "تراجع")} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-secondary disabled:opacity-30"><Undo2 size={18} /></button>
        <button type="button" onClick={redo} disabled={!redoStack.current.length} aria-label={copy("Redo", "إعادة")} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-secondary disabled:opacity-30"><Redo2 size={18} /></button>
        <button type="button" onClick={() => setPagesOpen((open) => !open)} aria-label={copy("Pages", "الصفحات")} aria-expanded={pagesOpen} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-secondary md:hidden"><Layers size={18} /></button>
        <div className="relative">
          <button type="button" onClick={() => setSettings((open) => !open)} aria-label={copy("Page style", "شكل الصفحة")} aria-expanded={settings} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-secondary"><Settings2 size={18} /></button>
          {settings && (
            <PageStyle page={page} copy={copy} onClose={() => setSettings(false)} onChange={styleAll} />
          )}
        </div>
        <button type="button" onClick={() => void exportPdf()} aria-label={copy("Download PDF", "تنزيل PDF")} title={copy("Download PDF", "تنزيل PDF")} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-secondary"><FileDown size={18} /></button>
      </div>

      {/* Tools */}
      <div className="flex items-center gap-1 overflow-x-auto border-b bg-background/90 px-2 py-1.5">
        <button type="button" onClick={() => setTool("pen")} aria-pressed={tool === "pen"} aria-label={copy("Pen", "قلم")} className={toolButton(tool === "pen")}><PenLine size={18} /></button>
        <button type="button" onClick={() => setTool("marker")} aria-pressed={tool === "marker"} aria-label={copy("Highlighter", "قلم تمييز")} className={toolButton(tool === "marker")}><Highlighter size={18} /></button>
        <button type="button" onClick={() => setTool("eraser")} aria-pressed={tool === "eraser"} aria-label={copy("Eraser", "ممحاة")} className={toolButton(tool === "eraser")}><Eraser size={18} /></button>
        <button type="button" onClick={() => setTool("text")} aria-pressed={tool === "text"} aria-label={copy("Type text", "اكتب نصًا")} className={toolButton(tool === "text")}><Type size={18} /></button>
        <button type="button" onClick={() => setTool("select")} aria-pressed={tool === "select"} aria-label={copy("Select and move", "تحديد وتحريك")} className={toolButton(tool === "select")}><Hand size={18} /></button>
        <span className="mx-1 h-7 w-px shrink-0 bg-border" />
        {(tool === "pen" || tool === "marker") && (
          <>
            {colors.map((color) => (
              <button key={color} type="button" onClick={() => (tool === "marker" ? setMarker(color) : setInk(color))} aria-label={color} aria-pressed={activeColor === color}
                className={`h-7 w-7 shrink-0 rounded-full border border-black/10 ring-offset-2 ring-offset-background ${activeColor === color ? "ring-2 ring-primary" : ""}`} style={{ background: color }} />
            ))}
            {tool === "pen" && (
              <>
                <span className="mx-1 h-7 w-px shrink-0 bg-border" />
                {PEN_SIZES.map((size) => (
                  <button key={size} type="button" onClick={() => setPenSize(size)} aria-pressed={penSize === size} aria-label={copy(`Pen size ${size}`, `حجم القلم ${size}`)} className={toolButton(penSize === size)}>
                    <span className="rounded-full bg-current" style={{ width: size * 2 + 2, height: size * 2 + 2 }} />
                  </button>
                ))}
              </>
            )}
            <span className="mx-1 h-7 w-px shrink-0 bg-border" />
          </>
        )}
        <button type="button" onClick={() => image.current?.click()} aria-label={copy("Add a picture", "أضف صورة")} className={toolButton(false)}><ImagePlus size={18} /></button>
        <button type="button" onClick={() => video.current?.click()} aria-label={copy("Add a video", "أضف فيديو")} className={toolButton(false)}><Film size={18} /></button>
        <button type="button" onClick={() => audio.current?.click()} aria-label={copy("Add a sound", "أضف صوتًا")} className={toolButton(false)}><Music size={18} /></button>
        <label className="ms-1 flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground" title={copy("With a stylus: fingers scroll, only the pen writes", "مع القلم الإلكتروني: الأصابع تمرّر والقلم فقط يكتب")}>
          <input type="checkbox" checked={stylusOnly} onChange={(event) => setStylusOnly(event.target.checked)} className="h-3.5 w-3.5" />{copy("Pen only", "القلم فقط")}
        </label>
        <input ref={image} type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void insertMedia("image", file); event.target.value = ""; }} />
        <input ref={video} type="file" accept="video/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void insertMedia("video", file); event.target.value = ""; }} />
        <input ref={audio} type="file" accept="audio/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void insertMedia("audio", file); event.target.value = ""; }} />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Pages sidebar (a drawer on phones) */}
        <aside className={`${pagesOpen ? "fixed inset-x-0 bottom-0 top-[6.5rem] z-10 flex" : "hidden"} w-full flex-col border-e bg-background md:static md:flex md:w-32`} aria-label={copy("Pages", "الصفحات")}>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <ol className="grid grid-cols-3 gap-2 md:grid-cols-1">
              {doc.pages.map((one, index) => (
                <li key={one.id}>
                  <button type="button" onClick={() => goTo(index)} aria-current={index === current ? "page" : undefined}
                    className={`block w-full rounded-lg p-1 ${index === current ? "bg-primary/15 ring-2 ring-primary" : "hover:bg-secondary"}`}>
                    <Thumb page={one} />
                    <span className="mt-0.5 block text-center text-[11px] font-medium tabular-nums text-muted-foreground">{index + 1}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <div className="grid grid-cols-5 gap-1 border-t p-2 md:grid-cols-2">
            <button type="button" onClick={() => addPage()} aria-label={copy("New page", "صفحة جديدة")} title={copy("New page", "صفحة جديدة")} className="col-span-1 grid h-9 place-items-center rounded-lg bg-primary text-primary-foreground md:col-span-2"><Plus size={17} /></button>
            <button type="button" onClick={duplicatePage} aria-label={copy("Duplicate page", "كرر الصفحة")} title={copy("Duplicate page", "كرر الصفحة")} className="grid h-9 place-items-center rounded-lg hover:bg-secondary"><Copy size={15} /></button>
            <button type="button" onClick={deletePage} aria-label={copy("Delete page", "احذف الصفحة")} title={copy("Delete page", "احذف الصفحة")} className="grid h-9 place-items-center rounded-lg hover:bg-destructive/10 hover:text-destructive"><Trash2 size={15} /></button>
            <button type="button" onClick={() => movePage(-1)} disabled={current === 0} aria-label={copy("Move page up", "انقل الصفحة لأعلى")} className="grid h-9 place-items-center rounded-lg hover:bg-secondary disabled:opacity-30"><ArrowUp size={15} /></button>
            <button type="button" onClick={() => movePage(1)} disabled={current === doc.pages.length - 1} aria-label={copy("Move page down", "انقل الصفحة لأسفل")} className="grid h-9 place-items-center rounded-lg hover:bg-secondary disabled:opacity-30"><ArrowDown size={15} /></button>
          </div>
        </aside>

        {/* The pages */}
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-2 py-4 sm:px-6" onPointerDown={(event) => { if (event.target === event.currentTarget) { setSelected(null); setEditing(null); } }}>
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {doc.pages.map((one, index) => (
              <div key={one.id} data-page data-index={index}>
                <PageView
                  page={one}
                  tool={tool}
                  pen={{ color: ink, width: penSize }}
                  marker={{ color: marker, width: 22 }}
                  stylusOnly={stylusOnly}
                  onStylus={() => setStylusOnly(true)}
                  selected={selected}
                  editing={editing}
                  setSelected={setSelected}
                  setEditing={setEditing}
                  change={(change, undoable) => changePage(one.id, change, undoable)}
                  src={src}
                  copy={copy}
                />
                <p className="mt-1.5 text-center text-[11px] tabular-nums text-muted-foreground">{index + 1}</p>
              </div>
            ))}
            <button type="button" onClick={() => addPage(doc.pages.length - 1)} className="mx-auto mb-10 inline-flex items-center gap-1.5 rounded-full border bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-secondary">
              <Plus size={15} />{copy("Add a page", "أضف صفحة")}
            </button>
          </div>
        </div>
      </div>

      {busy && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/30" role="status">
          <p className="flex items-center gap-2 rounded-2xl bg-background px-5 py-3 text-sm font-medium shadow-xl"><Loader2 size={16} className="animate-spin text-primary" />{busy}</p>
        </div>
      )}
    </div>
  );
}

/** Paper (lined, blank, dots, grid) and page colour, for this page or all. */
function PageStyle({ page, copy, onClose, onChange }: { page: NotebookPage; copy: Copy; onClose: () => void; onChange: (patch: Partial<Pick<NotebookPage, "paper" | "color">>, all: boolean) => void }) {
  const [all, setAll] = useState(false);
  const papers: Array<[Paper, string]> = [["lined", copy("Lined", "مسطّر")], ["blank", copy("Blank", "فارغ")], ["dots", copy("Dots", "نقاط")], ["grid", copy("Grid", "مربعات")]];
  return (
    <div className="absolute end-0 z-30 mt-1 w-72 rounded-2xl border bg-popover p-4 shadow-2xl">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{copy("Page style", "شكل الصفحة")}</p>
        <button type="button" onClick={onClose} aria-label={copy("Close", "إغلاق")} className="grid h-8 w-8 place-items-center rounded-full hover:bg-secondary"><X size={15} /></button>
      </div>
      <p className="mt-3 text-xs font-semibold text-muted-foreground">{copy("Paper", "الورق")}</p>
      <div className="mt-1.5 grid grid-cols-4 gap-2">
        {papers.map(([paper, label]) => (
          <button key={paper} type="button" onClick={() => onChange({ paper }, all)} aria-pressed={page.paper === paper}
            className={`rounded-xl border p-1 text-[10px] font-medium ${page.paper === paper ? "border-primary ring-2 ring-primary/40" : ""}`}>
            <MiniPaper paper={paper} color={page.color} />{label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs font-semibold text-muted-foreground">{copy("Page colour", "لون الصفحة")}</p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {(Object.keys(PAGE_COLORS) as PageColor[]).map((color) => (
          <button key={color} type="button" onClick={() => onChange({ color }, all)} aria-pressed={page.color === color} aria-label={copy(PAGE_COLORS[color].en, PAGE_COLORS[color].ar)} title={copy(PAGE_COLORS[color].en, PAGE_COLORS[color].ar)}
            className={`h-8 w-8 rounded-full border border-black/15 ring-offset-2 ring-offset-popover ${page.color === color ? "ring-2 ring-primary" : ""}`} style={{ background: PAGE_COLORS[color].paper }} />
        ))}
      </div>
      <label className="mt-4 flex items-center gap-2 text-xs">
        <input type="checkbox" checked={all} onChange={(event) => setAll(event.target.checked)} className="h-3.5 w-3.5" />{copy("Apply to all pages", "طبّق على كل الصفحات")}
      </label>
    </div>
  );
}

function MiniPaper({ paper, color }: { paper: Paper; color: PageColor }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(56 / PAGE_W * 2.4, 0, 0, 56 / PAGE_W * 2.4, 0, 0);
    drawPaper(ctx, paper, color);
  }, [paper, color]);
  return <canvas ref={canvas} width={56} height={56} className="mb-1 h-10 w-full rounded-md border" />;
}

/** A small picture of a page for the sidebar. */
function Thumb({ page }: { page: NotebookPage }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const ctx = target.getContext("2d")!;
    const scale = target.width / PAGE_W;
    drawPage(ctx, page, scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = "rgba(100, 116, 139, 0.25)";
    for (const item of page.items) ctx.fillRect(item.x, item.y, item.w, item.kind === "text" ? Math.min(item.h, 60) : item.h);
  }, [page]);
  return <canvas ref={canvas} width={120} height={Math.round(120 * PAGE_H / PAGE_W)} className="w-full rounded-md bg-white shadow-sm" />;
}

/** One page: paper and ink on a canvas, with typed text and media above it. */
function PageView({ page, tool, pen, marker, stylusOnly, onStylus, selected, editing, setSelected, setEditing, change, src, copy }: {
  page: NotebookPage;
  tool: Tool;
  pen: { color: string; width: number };
  marker: { color: string; width: number };
  stylusOnly: boolean;
  onStylus: () => void;
  selected: string | null;
  editing: string | null;
  setSelected: (id: string | null) => void;
  setEditing: (id: string | null) => void;
  change: (change: (page: NotebookPage) => NotebookPage, undoable?: boolean) => void;
  src: (item: PageItem) => string | undefined;
  copy: Copy;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const base = useRef<HTMLCanvasElement | null>(null);
  const live = useRef<Stroke | null>(null);
  const erased = useRef<Set<string> | null>(null);
  const frame = useRef(0);
  const [width, setWidth] = useState(0);
  const scale = width / PAGE_W;

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Paper and ink drawn once into a buffer; while writing, only the new stroke is added on top.
  const ratio = typeof window === "undefined" ? 1 : Math.min(2.5, window.devicePixelRatio || 1);
  const paint = useCallback(() => {
    const target = canvas.current;
    if (!target || !base.current) return;
    const ctx = target.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(base.current, 0, 0);
    if (live.current) { ctx.setTransform(scale * ratio, 0, 0, scale * ratio, 0, 0); drawLive(ctx, live.current); }
  }, [scale, ratio]);
  useEffect(() => {
    if (!width || !canvas.current) return;
    const w = Math.round(width * ratio), h = Math.round(width * PAGE_H / PAGE_W * ratio);
    canvas.current.width = w;
    canvas.current.height = h;
    base.current ??= document.createElement("canvas");
    base.current.width = w;
    base.current.height = h;
    const ctx = base.current.getContext("2d")!;
    const hidden = erased.current;
    drawPage(ctx, hidden ? { ...page, strokes: page.strokes.filter((stroke) => !hidden.has(stroke.id)) } : page, scale * ratio);
    paint();
  }, [page, width, ratio, scale, paint]);

  const toPage = (event: React.PointerEvent): [number, number, number] => {
    const rect = box.current!.getBoundingClientRect();
    const pressure = event.pointerType === "pen" ? (event.pressure || 0.5) : 0.5;
    return [((event.clientX - rect.left) / rect.width) * PAGE_W, ((event.clientY - rect.top) / rect.height) * PAGE_H, pressure];
  };
  const drawing = tool === "pen" || tool === "marker" || tool === "eraser";

  const down = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "pen" && !stylusOnly) onStylus();
    if (drawing) {
      if (stylusOnly && event.pointerType === "touch") return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setSelected(null);
      if (tool === "eraser") {
        erased.current = new Set();
        eraseAt(event);
      } else {
        live.current = { id: uid("s"), tool: tool === "marker" ? "marker" : "pen", color: tool === "marker" ? marker.color : pen.color, width: tool === "marker" ? marker.width : pen.width, points: [toPage(event)] };
        paint();
      }
      return;
    }
    if (event.target !== event.currentTarget && event.target !== canvas.current) return;
    setSelected(null);
    if (tool === "text") {
      // Keep the browser from moving focus away from the new text box.
      event.preventDefault();
      const [x, y] = toPage(event);
      const item: PageItem = { id: uid("i"), kind: "text", x: Math.max(16, Math.min(PAGE_W - 220, x - 8)), y: Math.max(16, y - 14), w: Math.min(420, PAGE_W - 32 - Math.max(16, x - 8)), h: 40, html: "", size: 22 };
      change((one) => ({ ...one, items: [...one.items, item] }));
      setEditing(item.id);
      setSelected(item.id);
    } else {
      setEditing(null);
    }
  };
  const eraseAt = (event: React.PointerEvent) => {
    const [x, y] = toPage(event);
    const hit = strokesAt(page.strokes, x, y, 10);
    if (!hit.size || !erased.current) return;
    hit.forEach((id) => erased.current!.add(id));
    const ctx = base.current!.getContext("2d")!;
    const hidden = erased.current;
    drawPage(ctx, { ...page, strokes: page.strokes.filter((stroke) => !hidden.has(stroke.id)) }, scale * ratio);
    paint();
  };
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    if (tool === "eraser" && erased.current) { eraseAt(event); return; }
    if (!live.current) return;
    const events = typeof event.nativeEvent.getCoalescedEvents === "function" ? event.nativeEvent.getCoalescedEvents() : [event.nativeEvent];
    for (const one of events.length ? events : [event.nativeEvent]) live.current.points.push(toPage(one as unknown as React.PointerEvent));
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(paint);
  };
  const up = () => {
    if (erased.current) {
      const gone = erased.current;
      erased.current = null;
      if (gone.size) change((one) => ({ ...one, strokes: one.strokes.filter((stroke) => !gone.has(stroke.id)) }));
      return;
    }
    const stroke = live.current;
    live.current = null;
    if (!stroke) return;
    const finished = { ...stroke, points: compactPoints(stroke.points) };
    change((one) => ({ ...one, strokes: [...one.strokes, finished] }));
  };

  const height = width * PAGE_H / PAGE_W;
  return (
    <div ref={box} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      className="relative mx-auto w-full overflow-hidden rounded-sm shadow-[0_2px_12px_rgba(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.04)]"
      style={{ height: height || undefined, touchAction: drawing && !stylusOnly ? "none" : "pan-y", cursor: drawing ? "crosshair" : tool === "text" ? "text" : "default" }}>
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
      {page.items.map((item) => (
        <ItemView key={item.id} item={item} scale={scale} tool={tool} selected={selected === item.id} editing={editing === item.id}
          src={src(item)} ink={PAGE_COLORS[page.color].ink} copy={copy}
          onSelect={() => setSelected(item.id)} onEdit={() => { setSelected(item.id); setEditing(item.id); }}
          onChange={(patch, undoable) => change((one) => ({ ...one, items: one.items.map((other) => (other.id === item.id ? { ...other, ...patch } : other)) }), undoable)}
          onRemove={() => { change((one) => ({ ...one, items: one.items.filter((other) => other.id !== item.id) })); setSelected(null); setEditing(null); }}
          onStopEditing={() => setEditing(null)} />
      ))}
    </div>
  );
}

/** The stroke being written (drawn simply; it's smoothed once finished). */
function drawLive(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const points = stroke.points;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = stroke.color;
  ctx.globalAlpha = stroke.tool === "marker" ? 0.38 : 1;
  ctx.lineWidth = stroke.width;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i - 1];
    const [x2, y2] = points[i];
    ctx.quadraticCurveTo(x1, y1, (x1 + x2) / 2, (y1 + y2) / 2);
  }
  if (points.length === 1) ctx.lineTo(points[0][0] + 0.1, points[0][1]);
  ctx.stroke();
  ctx.restore();
}

/** Typed text, a picture, a video or a sound on the page: move and resize it with the hand tool. */
function ItemView({ item, scale, tool, selected, editing, src, ink, copy, onSelect, onEdit, onChange, onRemove, onStopEditing }: {
  item: PageItem; scale: number; tool: Tool; selected: boolean; editing: boolean; src?: string; ink: string; copy: Copy;
  onSelect: () => void; onEdit: () => void;
  onChange: (patch: Partial<PageItem>, undoable?: boolean) => void;
  onRemove: () => void; onStopEditing: () => void;
}) {
  const text = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: "move" | "size"; x: number; y: number; item: PageItem } | null>(null);
  const [preview, setPreview] = useState<Partial<PageItem> | null>(null);
  const shown = { ...item, ...preview };
  const drawing = tool === "pen" || tool === "marker" || tool === "eraser";
  const html = useMemo(() => sanitizeDraftHtml(item.html ?? ""), [item.html]);

  useEffect(() => {
    if (!editing || !text.current) return;
    text.current.innerHTML = html;
    text.current.focus();
    const range = document.createRange();
    range.selectNodeContents(text.current);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveText = () => {
    const value = text.current?.innerHTML ?? "";
    const empty = !(text.current?.textContent ?? "").trim();
    if (empty) { onRemove(); return; }
    const h = Math.max(40, Math.round((text.current?.scrollHeight ?? 40) / scale));
    if (value !== item.html || h !== item.h) onChange({ html: value, h });
    onStopEditing();
  };

  const start = (kind: "move" | "size") => (event: React.PointerEvent) => {
    if (tool !== "select" || editing) return;
    event.stopPropagation();
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    onSelect();
    drag.current = { kind, x: event.clientX, y: event.clientY, item };
  };
  const moving = (event: React.PointerEvent) => {
    const current = drag.current;
    if (!current) return;
    const dx = (event.clientX - current.x) / scale, dy = (event.clientY - current.y) / scale;
    if (current.kind === "move") setPreview({ x: Math.round(current.item.x + dx), y: Math.round(current.item.y + dy) });
    else {
      const w = Math.max(60, Math.round(current.item.w + dx));
      // Pictures and video keep their shape; text and sound only change width.
      const h = current.item.kind === "image" || current.item.kind === "video" ? Math.round(current.item.h * (w / current.item.w)) : current.item.h;
      setPreview({ w, h });
    }
  };
  const stop = () => {
    if (drag.current && preview) onChange(preview);
    drag.current = null;
    setPreview(null);
  };

  const style: React.CSSProperties = {
    left: shown.x * scale, top: shown.y * scale, width: shown.w * scale,
    height: item.kind === "text" ? undefined : shown.h * scale,
    minHeight: item.kind === "text" ? 30 * scale : undefined,
    pointerEvents: drawing ? "none" : "auto",
  };
  return (
    <div className={`absolute ${selected && tool === "select" ? "ring-2 ring-sky-500 ring-offset-1" : ""} ${tool === "select" && !editing ? "cursor-move" : ""}`} style={style}
      onPointerDown={(event) => { if (tool === "select") start("move")(event); else if (tool === "text" && item.kind === "text") { event.stopPropagation(); onEdit(); } }}
      onPointerMove={moving} onPointerUp={stop} onPointerCancel={stop}
      onDoubleClick={() => { if (item.kind === "text") onEdit(); }}>
      {item.kind === "text" ? (
        editing ? (
          <div ref={text} contentEditable suppressContentEditableWarning dir="auto" onBlur={saveText} onPointerDown={(event) => event.stopPropagation()}
            // Kept as you type, so closing the notebook never loses words.
            onInput={() => onChange({ html: text.current?.innerHTML ?? "", h: Math.max(40, Math.round((text.current?.scrollHeight ?? 40) / scale)) }, false)}
            className="note-paper min-h-full rounded-md bg-sky-50/60 px-1 outline-none ring-1 ring-sky-400 dark:bg-sky-950/30"
            style={{ fontSize: (item.size ?? 22) * scale, lineHeight: 1.4, color: item.color ?? ink }} />
        ) : (
          <div dir="auto" className="note-paper px-1" style={{ fontSize: (item.size ?? 22) * scale, lineHeight: 1.4, color: item.color ?? ink }} dangerouslySetInnerHTML={{ __html: html }} />
        )
      ) : item.kind === "image" ? (
        src ? <img src={src} alt={item.name ?? ""} draggable={false} className="h-full w-full select-none object-contain" /> : <div className="grid h-full w-full place-items-center bg-black/5"><Loader2 className="animate-spin text-muted-foreground" /></div>
      ) : item.kind === "video" ? (
        <video src={src} controls={tool !== "select"} playsInline className="h-full w-full rounded-lg bg-black object-contain" />
      ) : (
        <div className="flex h-full w-full items-center gap-2 rounded-2xl border bg-background/90 px-3 shadow-sm">
          <Music size={18 * Math.max(scale, 0.6)} className="shrink-0 text-primary" />
          <audio src={src} controls={tool !== "select"} className="h-9 min-w-0 flex-1" />
        </div>
      )}
      {selected && tool === "select" && !editing && (
        <>
          <div className="absolute -top-10 end-0 flex items-center gap-1 rounded-full border bg-background px-1 py-0.5 shadow-lg" onPointerDown={(event) => event.stopPropagation()}>
            {item.kind === "text" && (
              <>
                <button type="button" onClick={() => onChange({ size: Math.max(12, (item.size ?? 22) - 4) })} aria-label={copy("Smaller", "أصغر")} className="grid h-7 w-7 place-items-center rounded-full hover:bg-secondary"><Minus size={13} /></button>
                <button type="button" onClick={() => onChange({ size: Math.min(80, (item.size ?? 22) + 4) })} aria-label={copy("Larger", "أكبر")} className="grid h-7 w-7 place-items-center rounded-full hover:bg-secondary"><Plus size={13} /></button>
                {INKS.slice(0, 5).map((color) => (
                  <button key={color} type="button" onClick={() => onChange({ color })} aria-label={color} className="h-5 w-5 rounded-full border border-black/10" style={{ background: color }} />
                ))}
                <button type="button" onClick={onEdit} aria-label={copy("Edit text", "عدّل النص")} className="grid h-7 w-7 place-items-center rounded-full hover:bg-secondary"><Type size={13} /></button>
              </>
            )}
            <button type="button" onClick={onRemove} aria-label={copy("Delete", "حذف")} className="grid h-7 w-7 place-items-center rounded-full text-destructive hover:bg-destructive/10"><Trash2 size={13} /></button>
          </div>
          <span onPointerDown={start("size")} className="absolute -bottom-2 -end-2 h-5 w-5 cursor-nwse-resize rounded-full border-2 border-white bg-sky-500 shadow" aria-hidden="true" />
        </>
      )}
    </div>
  );
}
