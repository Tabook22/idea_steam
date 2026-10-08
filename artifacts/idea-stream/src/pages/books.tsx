import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useListBooks, type BookSummary } from "@workspace/api-client-react";
import { ArrowLeft, BookOpen, BookPlus, CalendarClock, Headphones, Library, Loader2, NotebookPen, Search } from "lucide-react";
import { BookCover, BookDialog, BookMenu, openBook } from "@/components/books";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/lib/i18n";

type Filter = "all" | BookSummary["kind"];
type Group = { key: string; title: string; icon: typeof BookOpen; href?: string; books: BookSummary[] };

/**
 * Books: every handwriting book, kept on shelves by what it belongs to: meetings, each notebook
 * (subject), each recording, and loose books.
 */
export default function BooksPage() {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const { data: books = [], isLoading } = useListBooks();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<BookSummary | null>(null);

  const counts = useMemo(() => {
    const out: Record<Filter, number> = { all: books.length, meeting: 0, subject: 0, audio: 0, loose: 0 };
    for (const book of books) out[book.kind]++;
    return out;
  }, [books]);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const shown = books.filter((book) => (filter === "all" || book.kind === filter)
      && (!needle || [book.title, book.subjectTitle, book.audioTitle].some((text) => text?.toLowerCase().includes(needle))));
    const out = new Map<string, Group>();
    const add = (key: string, make: () => Omit<Group, "books">, book: BookSummary) => {
      if (!out.has(key)) out.set(key, { ...make(), books: [] });
      out.get(key)!.books.push(book);
    };
    for (const book of shown) {
      if (book.kind === "meeting") add("meetings", () => ({ key: "meetings", title: copy("Meetings", "الاجتماعات"), icon: CalendarClock, href: "/meetings" }), book);
      else if (book.kind === "subject") add(`s${book.subjectId}`, () => ({ key: `s${book.subjectId}`, title: book.subjectTitle ?? "", icon: NotebookPen, href: `/subjects/${book.subjectId}` }), book);
      else if (book.kind === "audio") add(`a${book.libraryItemId}`, () => ({ key: `a${book.libraryItemId}`, title: book.audioTitle ?? copy("Recording", "تسجيل"), icon: Headphones, href: "/library" }), book);
      else add("loose", () => ({ key: "loose", title: copy("Loose books", "كراسات مستقلة"), icon: BookOpen }), book);
    }
    // Most recently used shelf first (books arrive newest first).
    return [...out.values()];
  }, [books, filter, query, isArabic]); // eslint-disable-line react-hooks/exhaustive-deps

  const chips: Array<[Filter, string, typeof BookOpen]> = [
    ["all", copy("All", "الكل"), Library],
    ["meeting", copy("Meetings", "الاجتماعات"), CalendarClock],
    ["subject", copy("Notebooks", "الدفاتر"), NotebookPen],
    ["audio", copy("Recordings", "التسجيلات"), Headphones],
    ["loose", copy("Loose", "مستقلة"), BookOpen],
  ];
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-2 sm:px-6">
      <Link href="/app" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft size={16} className="rtl:rotate-180" />{copy("Home", "الرئيسية")}
      </Link>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-4xl tracking-tight">{copy("Books", "الكراسات")}</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            {copy("Your handwritten and typed pages, on shelves by meeting, notebook and recording.", "صفحاتك المكتوبة بخط اليد أو بلوحة المفاتيح، مرتّبة على رفوف حسب الاجتماع والدفتر والتسجيل.")}
          </p>
        </div>
        <Button onClick={() => setCreating(true)} className="rounded-full"><BookPlus size={16} className="me-2" />{copy("New book", "كراسة جديدة")}</Button>
      </div>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:w-64">
          <Search size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy("Find a book…", "ابحث عن كراسة…")} className="ps-9" aria-label={copy("Find a book", "ابحث عن كراسة")} />
        </div>
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" role="tablist">
          {chips.map(([value, label, Icon]) => (
            <button key={value} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)}
              className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors ${filter === value ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}>
              <Icon size={14} />{label}<span className={`text-xs ${filter === value ? "text-primary-foreground/75" : "text-muted-foreground/70"}`}>{counts[value]}</span>
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid h-48 place-items-center text-muted-foreground"><Loader2 className="animate-spin" /></div>
      ) : !books.length ? (
        <div className="mx-auto mt-6 flex max-w-md flex-col items-center gap-4 rounded-3xl border border-dashed bg-gradient-to-br from-amber-50 to-transparent px-6 py-10 text-center dark:from-amber-950/20">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"><NotebookPen size={26} /></span>
          <p className="font-serif text-2xl">{copy("Your first book", "كراستك الأولى")}</p>
          <p className="text-sm text-muted-foreground">
            {copy("Make a book for a notebook, a recording, or just for yourself. Write by hand or type on lined, dotted or blank pages, and add pictures, video and sound.",
              "أنشئ كراسة لدفتر أو تسجيل أو لنفسك فقط. اكتب بخط يدك أو بلوحة المفاتيح على صفحات مسطّرة أو منقّطة أو بيضاء، وأضف صورًا وفيديو وصوتًا.")}
          </p>
          <Button onClick={() => setCreating(true)} size="lg" className="rounded-full"><BookPlus size={18} className="me-2" />{copy("New book", "كراسة جديدة")}</Button>
        </div>
      ) : !groups.length ? (
        <p className="py-16 text-center text-muted-foreground">{copy("No books match.", "لا توجد كراسات مطابقة.")}</p>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.key} aria-label={group.title}>
              <div className="mb-3 flex items-center gap-2 border-b pb-2">
                <group.icon size={17} className="shrink-0 text-primary" />
                {group.href
                  ? <Link href={group.href} dir="auto" className="min-w-0 truncate font-serif text-xl hover:text-primary">{group.title}</Link>
                  : <h2 dir="auto" className="min-w-0 truncate font-serif text-xl">{group.title}</h2>}
                <span className="ms-auto shrink-0 text-xs text-muted-foreground">{copy(`${group.books.length} book${group.books.length === 1 ? "" : "s"}`, `${group.books.length} كراسة`)}</span>
              </div>
              {/* The shelf: books stand on a wooden ledge. */}
              <div className="relative">
                <div className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-5 lg:grid-cols-6">
                  {group.books.map((book) => (
                    <div key={`${book.kind}-${book.id}`}>
                      <BookCover book={book} copy={copy} onOpen={() => openBook({ kind: book.kind === "meeting" ? "meeting" : "book", id: book.id })}
                        menu={<BookMenu book={book} copy={copy} onEdit={() => setEditing(book)} />} />
                      <p className="mt-2 truncate text-[11px] text-muted-foreground">
                        {new Date(book.updatedAt).toLocaleDateString(isArabic ? "ar" : undefined, { day: "numeric", month: "short", year: "numeric" })}
                        {" · "}{copy(`${book.writtenCount} written`, `${book.writtenCount} مكتوبة`)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
      <BookDialog open={creating} onOpenChange={setCreating} />
      <BookDialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }} book={editing} />
    </main>
  );
}
