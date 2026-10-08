import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  createBook,
  deleteBook,
  getBook,
  getMeeting,
  requestUploadUrl,
  saveBookPages,
  saveMeetingNotebook,
  updateBook,
  useListAudioLibrary,
  useListBooks,
  useListSubjects,
  type BookSummary,
  type NotebookDoc,
} from "@workspace/api-client-react";
import { BookOpen, BookPlus, CalendarClock, Ellipsis, FileDown, Headphones, Loader2, NotebookPen, Pencil, Trash2 } from "lucide-react";
import { NotebookEditor } from "@/components/notebook-editor";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { appPath, uploadCredentials } from "@/lib/app-path";
import { COVER_COLORS, COVER_NAMES, type CoverColor } from "@/lib/covers";
import { useLanguage } from "@/lib/i18n";
import { PAGE_H, PAGE_W, drawPaper, newNotebook, type MeetingNotebookDoc, type PageColor, type Paper } from "@/lib/notebook";
import { notebookPdf } from "@/lib/notebook-render";

/**
 * Books: handwriting notebooks (pages written by hand or typed, with pictures, video and sound)
 * kept for a subject, a recording, or on their own. Meeting notebooks are listed with them.
 */

type Copy = (en: string, ar: string) => string;
export type BookTarget = { kind: "book" | "meeting"; id: number };
const OPEN_BOOK_EVENT = "idea-stream-open-book";
export const openBook = (target: BookTarget) => window.dispatchEvent(new CustomEvent(OPEN_BOOK_EVENT, { detail: target }));
const targetOf = (book: Pick<BookSummary, "kind" | "id">): BookTarget => ({ kind: book.kind === "meeting" ? "meeting" : "book", id: book.id });

export async function uploadFile(file: Blob, name: string, type: string) {
  const target = await requestUploadUrl({ name, size: file.size, contentType: type });
  const response = await fetch(appPath(target.uploadURL, import.meta.env.BASE_URL), {
    method: "PUT", body: file, headers: { "Content-Type": type }, credentials: uploadCredentials(target.uploadURL, location.origin),
  });
  if (!response.ok) throw new Error("upload");
  return `/api/storage${target.objectPath}`;
}

function coverGradient(name: string) {
  const { from, to } = COVER_COLORS[(name in COVER_COLORS ? name : "ocean") as CoverColor];
  return `radial-gradient(circle at 85% 12%, rgba(255,255,255,0.22) 0, rgba(255,255,255,0) 45%), linear-gradient(150deg, ${from}, ${to})`;
}

const kindIcon = { meeting: CalendarClock, subject: NotebookPen, audio: Headphones, loose: BookOpen } as const;
export function kindLabel(book: BookSummary, copy: Copy) {
  if (book.kind === "meeting") return copy("Meeting", "اجتماع");
  if (book.kind === "subject") return book.subjectTitle ?? "";
  if (book.kind === "audio") return book.audioTitle ?? copy("Recording", "تسجيل");
  return copy("Loose book", "كراسة مستقلة");
}

function PaperThumb({ paper, color }: { paper: string; color: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(canvas.current!.width / PAGE_W, 0, 0, canvas.current!.width / PAGE_W, 0, 0);
    drawPaper(ctx, paper as Paper, color as PageColor);
  }, [paper, color]);
  return <canvas ref={canvas} width={120} height={Math.round(120 * PAGE_H / PAGE_W)} className="h-full w-full" />;
}

/** A book as a cover: its colour, a window onto its first page, its title. */
export function BookCover({ book, copy, onOpen, menu }: { book: BookSummary; copy: Copy; onOpen: () => void; menu?: React.ReactNode }) {
  const Icon = kindIcon[book.kind];
  return (
    <div className="group relative min-w-0">
      <button type="button" onClick={onOpen} aria-label={copy(`Open ${book.title}`, `افتح ${book.title}`)}
        className="relative block aspect-[3/4] w-full overflow-hidden rounded-e-xl rounded-s-[5px] text-start shadow-[0_10px_24px_-12px_rgba(0,0,0,0.55)] ring-1 ring-black/10 transition-transform duration-200 group-hover:-translate-y-1 group-hover:shadow-[0_18px_30px_-14px_rgba(0,0,0,0.55)]"
        style={{ backgroundImage: coverGradient(book.cover) }}>
        <span aria-hidden="true" className="absolute inset-y-0 start-0 w-2.5 bg-gradient-to-r from-black/30 to-black/5 rtl:bg-gradient-to-l" />
        <span aria-hidden="true" className="absolute inset-y-0 start-3 w-px bg-white/25" />
        <span className="absolute inset-x-[16%] top-[8%] bottom-[40%] overflow-hidden rounded-[3px] bg-white shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06),0_2px_6px_rgba(0,0,0,0.25)]">
          {book.preview
            ? <img src={appPath(book.preview, import.meta.env.BASE_URL)} alt="" loading="lazy" className="h-full w-full object-cover object-top" />
            : <PaperThumb paper={book.paper} color={book.paperColor} />}
        </span>
        <span className="absolute inset-x-[12%] bottom-[6%] top-[63%] flex flex-col justify-end gap-0.5 text-white">
          <span dir="auto" className="line-clamp-2 font-serif text-[13px] font-semibold leading-[1.15] drop-shadow sm:text-[15px]">{book.title}</span>
          <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-white/80">
            <Icon size={11} className="shrink-0" />
            {copy(`${book.pageCount} page${book.pageCount === 1 ? "" : "s"}`, `${book.pageCount} صفحة`)}
          </span>
        </span>
      </button>
      {menu && <div className="absolute end-1.5 top-1.5 opacity-90 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">{menu}</div>}
    </div>
  );
}

/** Rename, recolour, move, PDF, delete. */
export function BookMenu({ book, copy, onEdit }: { book: BookSummary; copy: Copy; onEdit: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  async function pdf() {
    setBusy(true);
    try {
      const doc = book.kind === "meeting" ? (await getMeeting(book.id)).notebook : (await getBook(book.id)).doc;
      if (!doc) return;
      const file = await notebookPdf(doc as unknown as MeetingNotebookDoc, (item) => (item.url ? appPath(item.url, import.meta.env.BASE_URL) : undefined));
      const url = URL.createObjectURL(file);
      const link = Object.assign(document.createElement("a"), { href: url, download: `${book.title.replace(/[\\/:*?"<>|]+/g, " ").slice(0, 80) || "Book"}.pdf` });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch {
      toast({ variant: "destructive", title: copy("The PDF couldn't be made.", "تعذر إنشاء ملف PDF.") });
    } finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm(copy(`Delete the book "${book.title}" and all its pages?`, `حذف الكراسة «${book.title}» وكل صفحاتها؟`))) return;
    try {
      await deleteBook(book.id);
      await queryClient.invalidateQueries({ queryKey: ["/api/books"] });
      if (book.subjectId) await queryClient.invalidateQueries({ queryKey: [`/api/subjects/${book.subjectId}/ideas`] });
      toast({ title: copy("Book deleted.", "حُذفت الكراسة.") });
    } catch {
      toast({ variant: "destructive", title: copy("It couldn't be deleted.", "تعذر الحذف.") });
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={copy(`More for ${book.title}`, `المزيد لـ ${book.title}`)} className="grid h-8 w-8 place-items-center rounded-full bg-black/35 text-white backdrop-blur hover:bg-black/50">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Ellipsis size={16} />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => openBook(targetOf(book))}><BookOpen size={15} className="me-2" />{copy("Open", "افتح")}</DropdownMenuItem>
        {book.kind === "meeting" ? (
          <DropdownMenuItem asChild><Link href={`/meetings/${book.id}`}><CalendarClock size={15} className="me-2" />{copy("Go to the meeting", "اذهب إلى الاجتماع")}</Link></DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={onEdit}><Pencil size={15} className="me-2" />{copy("Rename, cover, move…", "الاسم والغلاف والنقل…")}</DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => void pdf()} disabled={!book.pageCount}><FileDown size={15} className="me-2" />{copy("Download PDF", "تنزيل PDF")}</DropdownMenuItem>
        {book.kind !== "meeting" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void remove()} className="text-destructive focus:text-destructive"><Trash2 size={15} className="me-2" />{copy("Delete", "حذف")}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type Belongs = "subject" | "audio" | "loose";

/**
 * A new book, or an existing one's name, cover and place. With `fixed`, the book always goes to
 * that subject or recording.
 */
export function BookDialog({ open, onOpenChange, book, fixed }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  book?: BookSummary | null;
  fixed?: { subjectId?: number; libraryItemId?: number };
}) {
  const { isArabic } = useLanguage();
  const copy: Copy = (en, ar) => (isArabic ? ar : en);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: subjects = [] } = useListSubjects();
  const { data: recordings = [] } = useListAudioLibrary();
  const [title, setTitle] = useState("");
  const [cover, setCover] = useState<CoverColor>("ocean");
  const [belongs, setBelongs] = useState<Belongs>("loose");
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [itemId, setItemId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(book?.title ?? "");
    setCover((book?.cover as CoverColor) ?? COVER_NAMES[Math.floor(Math.random() * COVER_NAMES.length)]);
    const s = book ? book.subjectId : fixed?.subjectId ?? null;
    const i = book ? book.libraryItemId : fixed?.libraryItemId ?? null;
    setSubjectId(s);
    setItemId(i);
    setBelongs(i !== null ? "audio" : s !== null ? "subject" : "loose");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const voices = recordings.filter((item) => item.kind !== "music");
  const ready = title.trim() && (belongs !== "subject" || subjectId !== null) && (belongs !== "audio" || itemId !== null);
  async function save() {
    if (!ready) return;
    setSaving(true);
    const place = { subjectId: belongs === "subject" ? subjectId : null, libraryItemId: belongs === "audio" ? itemId : null };
    try {
      if (book) {
        await updateBook(book.id, { title: title.trim(), cover, ...place });
        if (book.subjectId) await queryClient.invalidateQueries({ queryKey: [`/api/subjects/${book.subjectId}/ideas`] });
      } else {
        const made = await createBook({ title: title.trim(), cover, ...place });
        openBook({ kind: "book", id: made.id });
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/books"] });
      if (place.subjectId) await queryClient.invalidateQueries({ queryKey: [`/api/subjects/${place.subjectId}/ideas`] });
      onOpenChange(false);
    } catch {
      toast({ variant: "destructive", title: copy("It couldn't be saved.", "تعذر الحفظ.") });
    } finally { setSaving(false); }
  }

  const fixedPlace = !book && fixed && (fixed.subjectId !== undefined || fixed.libraryItemId !== undefined);
  const fixedName = fixed?.subjectId !== undefined ? subjects.find((s) => s.id === fixed.subjectId)?.title
    : fixed?.libraryItemId !== undefined ? (() => { const item = recordings.find((r) => r.id === fixed.libraryItemId); return item?.title || item?.transcript?.slice(0, 60); })() : undefined;
  const choice = (value: Belongs, label: string, Icon: typeof BookOpen) => (
    <button type="button" onClick={() => setBelongs(value)} aria-pressed={belongs === value}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition-colors ${belongs === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
      <Icon size={14} />{label}
    </button>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">{book ? copy("Book details", "تفاصيل الكراسة") : copy("New book", "كراسة جديدة")}</DialogTitle>
          <DialogDescription>{copy("Pages you write by hand or type, with pictures, video and sound.", "صفحات تكتبها بخط يدك أو بلوحة المفاتيح، مع صور وفيديو وصوت.")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="flex gap-4">
            <div className="w-20 shrink-0">
              <div className="relative aspect-[3/4] overflow-hidden rounded-e-lg rounded-s-[4px] shadow-md" style={{ backgroundImage: coverGradient(cover) }}>
                <span className="absolute inset-y-0 start-0 w-2 bg-black/25" />
                <span dir="auto" className="absolute inset-x-2 bottom-2 line-clamp-3 font-serif text-[11px] font-semibold leading-tight text-white">{title || copy("Untitled", "بلا عنوان")}</span>
              </div>
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <label className="block text-sm font-medium">
                {copy("Name", "الاسم")}
                <Input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} dir="auto" className="mt-1"
                  placeholder={copy("e.g. Lecture notes, Ideas for chapter 2", "مثلًا: ملاحظات المحاضرة، أفكار الفصل الثاني")}
                  onKeyDown={(event) => { if (event.key === "Enter") void save(); }} />
              </label>
              <div>
                <p className="mb-1.5 text-sm font-medium">{copy("Cover", "الغلاف")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {COVER_NAMES.map((name) => (
                    <button key={name} type="button" onClick={() => setCover(name)} aria-label={isArabic ? COVER_COLORS[name].ar : COVER_COLORS[name].en} aria-pressed={cover === name}
                      className={`h-7 w-7 rounded-full ring-offset-2 ring-offset-background transition ${cover === name ? "ring-2 ring-primary" : ""}`} style={{ backgroundImage: coverGradient(name) }} />
                  ))}
                </div>
              </div>
            </div>
          </div>
          {fixedPlace ? (
            <p className="rounded-lg bg-secondary/60 px-3 py-2 text-sm text-muted-foreground">
              {fixed.subjectId !== undefined ? copy("In the notebook", "في الدفتر") : copy("Notes on the recording", "ملاحظات على التسجيل")}{" "}
              <b dir="auto" className="text-foreground">{fixedName ?? "…"}</b>
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium">{copy("Belongs to", "تابعة لـ")}</p>
              <div className="flex gap-1 rounded-xl bg-secondary p-1">
                {choice("subject", copy("Notebook", "دفتر"), NotebookPen)}
                {choice("audio", copy("Recording", "تسجيل"), Headphones)}
                {choice("loose", copy("Nothing", "لا شيء"), BookOpen)}
              </div>
              {belongs === "subject" && (
                <select value={subjectId ?? ""} onChange={(event) => setSubjectId(event.target.value ? Number(event.target.value) : null)} className="h-10 w-full rounded-md border bg-background px-3 text-sm" aria-label={copy("Notebook", "الدفتر")}>
                  <option value="">{copy("Choose a notebook…", "اختر دفترًا…")}</option>
                  {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.title}</option>)}
                </select>
              )}
              {belongs === "audio" && (
                <select value={itemId ?? ""} onChange={(event) => setItemId(event.target.value ? Number(event.target.value) : null)} className="h-10 w-full rounded-md border bg-background px-3 text-sm" aria-label={copy("Recording", "التسجيل")}>
                  <option value="">{copy("Choose a recording…", "اختر تسجيلًا…")}</option>
                  {voices.map((item) => <option key={item.id} value={item.id}>{item.title || item.transcript?.slice(0, 60) || copy("Recording", "تسجيل")} · {new Date(item.createdAt).toLocaleDateString(isArabic ? "ar" : undefined)}</option>)}
                </select>
              )}
              {belongs === "subject" && <p className="text-xs text-muted-foreground">{copy("Its words and pages also appear in the notebook, so you can search and ask about them.", "تظهر كلماتها وصفحاتها في الدفتر أيضًا، فيمكنك البحث فيها والسؤال عنها.")}</p>}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{copy("Cancel", "إلغاء")}</Button>
          <Button onClick={() => void save()} disabled={!ready || saving}>
            {saving ? <Loader2 size={16} className="me-2 animate-spin" /> : book ? null : <BookPlus size={16} className="me-2" />}
            {book ? copy("Save", "حفظ") : copy("Create and open", "أنشئ وافتح")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The books of one notebook (subject) or one recording, with a button for a new one. */
export function BookShelf({ subjectId, libraryItemId }: { subjectId?: number; libraryItemId?: number }) {
  const { isArabic } = useLanguage();
  const copy: Copy = (en, ar) => (isArabic ? ar : en);
  const { data: books, isLoading } = useListBooks({ ...(subjectId !== undefined ? { subjectId } : {}), ...(libraryItemId !== undefined ? { libraryItemId } : {}) });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<BookSummary | null>(null);
  const fixed = { ...(subjectId !== undefined ? { subjectId } : {}), ...(libraryItemId !== undefined ? { libraryItemId } : {}) };
  return (
    <div>
      {isLoading ? (
        <div className="grid h-32 place-items-center text-muted-foreground"><Loader2 className="animate-spin" /></div>
      ) : !books?.length ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-gradient-to-br from-amber-50/80 to-transparent px-4 py-7 text-center dark:from-amber-950/20">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"><NotebookPen size={22} /></span>
          <div>
            <p className="font-serif text-lg">{copy("Write by hand, like a real notebook", "اكتب بخط يدك، كأنها كراسة حقيقية")}</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              {libraryItemId !== undefined
                ? copy("Keep notes on this recording: write with a pen or finger, type, add pictures, video and sound.", "دوّن ملاحظاتك على هذا التسجيل: بالقلم أو الإصبع أو لوحة المفاتيح، مع صور وفيديو وصوت.")
                : copy("Pages that are lined, dotted or blank. Write with a pen or finger, type, add pictures, video and sound.", "صفحات مسطّرة أو منقّطة أو بيضاء. اكتب بالقلم أو الإصبع أو لوحة المفاتيح، وأضف صورًا وفيديو وصوتًا.")}
            </p>
          </div>
          <Button onClick={() => setCreating(true)}><BookPlus size={16} className="me-2" />{copy("New book", "كراسة جديدة")}</Button>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {books.map((book) => (
            <BookCover key={`${book.kind}-${book.id}`} book={book} copy={copy} onOpen={() => openBook(targetOf(book))}
              menu={<BookMenu book={book} copy={copy} onEdit={() => setEditing(book)} />} />
          ))}
          <button type="button" onClick={() => setCreating(true)}
            className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary">
            <BookPlus size={22} />{copy("New book", "كراسة جديدة")}
          </button>
        </div>
      )}
      {books && books.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {copy("All your books are also in ", "كل كراساتك موجودة أيضًا في ")}
          <Link href="/books" className="font-medium text-primary hover:underline">{copy("Books", "الكراسات")}</Link>.
        </p>
      )}
      <BookDialog open={creating} onOpenChange={setCreating} fixed={fixed} />
      <BookDialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }} book={editing} />
    </div>
  );
}

/**
 * Opens a book (or a meeting's notebook) full screen from anywhere. It saves as you write, and
 * once more with page pictures when you tap Done.
 */
export function BookHost() {
  const { isArabic } = useLanguage();
  const copy: Copy = (en, ar) => (isArabic ? ar : en);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [book, setBook] = useState<{ target: BookTarget; title: string; doc: MeetingNotebookDoc; subjectId: number | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<"saved" | "saving" | "error" | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const waiting = useRef(false);

  useEffect(() => {
    const show = async (event: Event) => {
      const target = (event as CustomEvent<BookTarget>).detail;
      setLoading(true);
      try {
        if (target.kind === "meeting") {
          const meeting = await getMeeting(target.id);
          setBook({ target, title: meeting.title, doc: (meeting.notebook as unknown as MeetingNotebookDoc | null) ?? newNotebook(), subjectId: meeting.subjectId });
        } else {
          const found = await getBook(target.id);
          setBook({ target, title: found.title, doc: (found.doc as unknown as MeetingNotebookDoc | null) ?? newNotebook(), subjectId: found.subjectId });
        }
        setState(null);
      } catch {
        toast({ variant: "destructive", title: copy("The book couldn't be opened.", "تعذر فتح الكراسة.") });
      } finally { setLoading(false); }
    };
    window.addEventListener(OPEN_BOOK_EVENT, show);
    return () => window.removeEventListener(OPEN_BOOK_EVENT, show);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (waiting.current) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  function save(target: BookTarget, doc: MeetingNotebookDoc) {
    window.clearTimeout(timer.current);
    waiting.current = true;
    let ok = false;
    chain.current = chain.current.then(async () => {
      setState("saving");
      try {
        const notebook = doc as unknown as NotebookDoc;
        if (target.kind === "meeting") await saveMeetingNotebook(target.id, { notebook });
        else await saveBookPages(target.id, { notebook });
        setState("saved");
        ok = true;
      } catch { setState("error"); }
      waiting.current = false;
    });
    return chain.current.then(() => ok);
  }
  const refresh = async (subjectId: number | null, target: BookTarget) => {
    await queryClient.invalidateQueries({ queryKey: ["/api/books"] });
    if (subjectId) await queryClient.invalidateQueries({ queryKey: [`/api/subjects/${subjectId}/ideas`] });
    if (target.kind === "meeting") await queryClient.invalidateQueries({ queryKey: [`/api/meetings/${target.id}`] });
  };

  const label = state === "saving" ? copy("Saving…", "جارٍ الحفظ…") : state === "saved" ? copy("Saved", "محفوظ") : state === "error" ? copy("Not saved, check your connection", "لم يُحفظ، تحقّق من الاتصال") : undefined;
  return (
    <>
      {loading && (
        <div className="fixed inset-0 z-[95] grid place-items-center bg-black/30 backdrop-blur-sm" role="status">
          <span className="flex items-center gap-2 rounded-full bg-background px-4 py-2 text-sm shadow-lg"><Loader2 size={16} className="animate-spin" />{copy("Opening the book…", "جارٍ فتح الكراسة…")}</span>
        </div>
      )}
      {book && (
        <NotebookEditor
          key={`${book.target.kind}-${book.target.id}`}
          doc={book.doc}
          title={book.title}
          copy={copy}
          status={label}
          storeMedia={async (item, file) => ({ ...item, url: await uploadFile(file, item.name || "file", item.mimeType || file.type || "application/octet-stream") })}
          storeSnapshot={async (page, png) => ({ url: await uploadFile(png, "page.png", "image/png"), rev: page.rev })}
          onChange={(doc) => {
            const target = book.target;
            window.clearTimeout(timer.current);
            waiting.current = true;
            timer.current = window.setTimeout(() => void save(target, doc), 2500);
          }}
          onDone={(doc) => {
            const { target, subjectId } = book;
            setBook(null);
            void save(target, doc).then((ok) => {
              if (!ok) toast({ variant: "destructive", title: copy("The book couldn't be saved. Check your connection and open it again.", "تعذر حفظ الكراسة. تحقّق من الاتصال وافتحها مجددًا.") });
              return refresh(subjectId, target);
            }).then(() => {
              if (target.kind === "book") window.setTimeout(() => void refresh(subjectId, target), 12_000); // after the handwriting is read
            });
          }}
        />
      )}
    </>
  );
}

/** Top bar: the way to Books. */
export function BooksButton() {
  const { isArabic } = useLanguage();
  const label = isArabic ? "الكراسات" : "Books";
  return (
    <Link href="/books" aria-label={label} title={label}
      className="hidden h-9 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-sm font-medium text-muted-foreground shadow-sm transition-colors hover:border-primary/40 hover:text-foreground md:inline-flex">
      <NotebookPen size={16} />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}
