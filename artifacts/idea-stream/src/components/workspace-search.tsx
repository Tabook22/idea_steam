import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { keepPreviousData } from "@tanstack/react-query";
import {
  ArrowRight,
  AudioLines,
  BookOpen,
  CornerDownLeft,
  FileText,
  FileType,
  Image as ImageIcon,
  Link2,
  Loader2,
  Mic,
  PenLine,
  Search,
  X,
} from "lucide-react";
import {
  getSearchWorkspaceQueryKey,
  useSearchWorkspace,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { highlight } from "@/lib/search-highlight";
import { useLanguage } from "@/lib/i18n";

const RECENT_KEY = "idea-stream-recent-searches";
const OPEN_SEARCH_EVENT = "idea-stream:search";
export const openSearch = () => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));

function readRecent(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(value) ? value.filter((item) => typeof item === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}

function rememberSearch(query: string) {
  try {
    const next = [query, ...readRecent().filter((item) => item !== query)].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* Recent searches are a convenience only. */ }
}

function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlight(text, query).map((segment, index) =>
        segment.match ? (
          <mark key={index} className="rounded-sm bg-amber-200/70 text-foreground [box-decoration-break:clone] dark:bg-amber-500/30">{segment.text}</mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

const sourceIcon: Record<string, ReactNode> = {
  voice: <Mic size={16} />,
  audio: <AudioLines size={16} />,
  link: <Link2 size={16} />,
  image: <ImageIcon size={16} />,
  pdf: <FileType size={16} />,
  document: <FileType size={16} />,
};

type Item = { key: string; href: string; render: (active: boolean) => ReactNode };

/** Search every idea, voice transcript, note, notebook, and draft. Opens with Ctrl/⌘ + K or "/". */
export function WorkspaceSearch() {
  const { isArabic, language } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const list = useRef<HTMLDivElement>(null);
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement &&
        (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName));
      if ((event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) || (event.key === "/" && !typing)) {
        event.preventDefault();
        setOpen(true);
      }
    };
    const show = () => setOpen(true);
    window.addEventListener("keydown", key);
    window.addEventListener(OPEN_SEARCH_EVENT, show);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener(OPEN_SEARCH_EVENT, show);
    };
  }, []);

  useEffect(() => {
    if (open) { setRecent(readRecent()); setActive(0); }
  }, [open]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 220);
    return () => clearTimeout(timer);
  }, [query]);

  const enabled = open && debounced.length >= 2;
  const { data, isFetching, isError } = useSearchWorkspace(
    { q: debounced },
    {
      query: {
        queryKey: getSearchWorkspaceQueryKey({ q: debounced }),
        enabled,
        placeholderData: keepPreviousData,
        staleTime: 15_000,
        retry: false,
      },
    },
  );
  const results = enabled ? data : undefined;
  const date = useMemo(() => new Intl.DateTimeFormat(language, { dateStyle: "medium" }), [language]);

  const go = (href: string) => {
    if (debounced.length >= 2) rememberSearch(debounced);
    setOpen(false);
    navigate(href);
    // In-app navigation does not fire hashchange; the notebook page listens for it to scroll.
    setTimeout(() => window.dispatchEvent(new HashChangeEvent("hashchange")), 50);
  };

  const sections: Array<{ title: string; items: Item[] }> = [];
  if (results) {
    if (results.ideas.length)
      sections.push({
        title: copy("Ideas", "الأفكار"),
        items: results.ideas.map((idea) => ({
          key: `idea-${idea.id}`,
          href: `/subjects/${idea.subjectId}#idea-${idea.id}`,
          render: () => (
            <>
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                {sourceIcon[idea.source] ?? <FileText size={16} />}
              </span>
              <span className="min-w-0 flex-1">
                <span dir="auto" className="line-clamp-2 block text-sm leading-6"><Highlighted text={idea.snippet} query={debounced} /></span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/80">{idea.subjectTitle}</span>
                  <span aria-hidden="true">·</span>
                  <span>{date.format(new Date(idea.createdAt))}</span>
                  {idea.matchedIn !== "content" && (
                    <span className="rounded-full bg-secondary px-2 py-0.5">
                      {idea.matchedIn === "transcript" ? copy("in transcript", "في النص المفرّغ")
                        : idea.matchedIn === "note" ? copy("in a note", "في ملاحظة")
                        : copy("in an attachment", "في مرفق")}
                    </span>
                  )}
                </span>
              </span>
            </>
          ),
        })),
      });
    if (results.subjects.length)
      sections.push({
        title: copy("Notebooks", "الدفاتر"),
        items: results.subjects.map((subject) => ({
          key: `subject-${subject.id}`,
          href: `/subjects/${subject.id}`,
          render: () => (
            <>
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
                <BookOpen size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span dir="auto" className="block text-sm font-medium"><Highlighted text={subject.title} query={debounced} /></span>
                <span dir="auto" className="line-clamp-1 block text-xs text-muted-foreground">
                  {copy(`${subject.ideaCount} ideas`, `${subject.ideaCount} فكرة`)}
                  {subject.snippet && <> · <Highlighted text={subject.snippet} query={debounced} /></>}
                </span>
              </span>
            </>
          ),
        })),
      });
    if (results.drafts.length)
      sections.push({
        title: copy("Drafts", "المسودات"),
        items: results.drafts.map((draft) => ({
          key: `draft-${draft.id}`,
          href: `/subjects/${draft.subjectId}#draft-studio`,
          render: () => (
            <>
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-secondary text-foreground/70">
                <PenLine size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span dir="auto" className="line-clamp-2 block text-sm leading-6"><Highlighted text={draft.snippet} query={debounced} /></span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/80">{draft.subjectTitle}</span> · {date.format(new Date(draft.updatedAt))}
                </span>
              </span>
            </>
          ),
        })),
      });
  }
  const flat = sections.flatMap((section) => section.items);
  const total = flat.length;

  useEffect(() => { setActive(0); }, [debounced]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!total) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => (value + 1) % total); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => (value - 1 + total) % total); }
    else if (event.key === "Enter") { event.preventDefault(); go(flat[active].href); }
  };

  let index = -1;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={copy("Search everything", "ابحث في كل شيء")}
        className="inline-flex h-9 items-center gap-2 rounded-lg border bg-card px-2.5 text-sm text-muted-foreground shadow-sm transition-colors hover:border-primary/40 hover:text-foreground sm:w-56 sm:px-3"
      >
        <Search size={16} />
        <span className="hidden flex-1 text-start sm:inline">{copy("Search ideas…", "ابحث في أفكارك…")}</span>
        <kbd className="hidden rounded border bg-muted px-1.5 font-sans text-[10px] font-medium sm:inline">{mac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="flex h-[100dvh] max-w-2xl flex-col gap-0 overflow-hidden rounded-none p-0 sm:top-[10vh] sm:h-auto sm:max-h-[78vh] sm:translate-y-0 sm:rounded-2xl data-[state=open]:sm:slide-in-from-top-[2%] [&>button:last-child]:hidden"
          onOpenAutoFocus={(event) => { event.preventDefault(); (event.currentTarget as HTMLElement).querySelector("input")?.focus(); }}
        >
          <DialogTitle className="sr-only">{copy("Search", "بحث")}</DialogTitle>
          <DialogDescription className="sr-only">
            {copy("Search ideas, voice transcripts, notes, notebooks, and drafts.", "ابحث في الأفكار والنصوص المفرّغة والملاحظات والدفاتر والمسودات.")}
          </DialogDescription>
          <div className="flex items-center gap-3 border-b px-4 py-3" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
            {isFetching ? <Loader2 size={20} className="shrink-0 animate-spin text-primary" /> : <Search size={20} className="shrink-0 text-muted-foreground" />}
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              data-bare-field
              dir="auto"
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              spellCheck={false}
              maxLength={200}
              placeholder={copy("Search ideas, transcripts, notes, drafts…", "ابحث في الأفكار والنصوص والملاحظات والمسودات…")}
              aria-label={copy("Search", "بحث")}
              aria-controls="workspace-search-results"
              aria-activedescendant={total ? `search-option-${active}` : undefined}
              className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label={copy("Clear", "مسح")} className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary">
                <X size={16} />
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-2 py-1 text-sm font-medium text-primary sm:hidden">
              {copy("Cancel", "إلغاء")}
            </button>
            <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 font-sans text-[10px] text-muted-foreground sm:inline">Esc</kbd>
          </div>

          <div ref={list} id="workspace-search-results" role="listbox" aria-label={copy("Results", "النتائج")} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
            {debounced.length < 2 ? (
              <div className="px-3 py-6">
                {recent.length > 0 && (
                  <>
                    <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{copy("Recent", "عمليات بحث سابقة")}</p>
                    <div className="mb-8 flex flex-wrap gap-2">
                      {recent.map((item) => (
                        <button key={item} type="button" dir="auto" onClick={() => setQuery(item)} className="rounded-full border bg-card px-3.5 py-1.5 text-sm hover:border-primary/40 hover:bg-primary/5">
                          {item}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <div className="flex flex-col items-center text-center">
                  <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary"><Search size={22} /></span>
                  <p className="mt-3 font-serif text-lg">{copy("Find anything you've captured", "اعثر على أي شيء التقطته")}</p>
                  <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
                    {copy("Search words you typed or said in a voice note, link notes, notebook names, and drafts, in Arabic or English.", "ابحث عن كلمات كتبتها أو قلتها في ملاحظة صوتية، وملاحظات الروابط، وأسماء الدفاتر، والمسودات، بالعربية أو الإنجليزية.")}
                  </p>
                </div>
              </div>
            ) : isError ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground" role="status">{copy("Search is unavailable right now. Please try again.", "البحث غير متاح الآن. حاول مجددًا.")}</p>
            ) : !results ? (
              <div className="space-y-2 p-2" aria-hidden="true">
                {[0, 1, 2].map((row) => (
                  <div key={row} className="flex gap-3 rounded-xl p-2">
                    <div className="h-8 w-8 animate-pulse rounded-lg bg-muted" />
                    <div className="flex-1 space-y-2"><div className="h-3.5 w-11/12 animate-pulse rounded bg-muted" /><div className="h-3 w-1/3 animate-pulse rounded bg-muted" /></div>
                  </div>
                ))}
              </div>
            ) : !total ? (
              <div className="px-4 py-12 text-center" role="status">
                <p className="font-serif text-lg">{copy("No matches", "لا توجد نتائج")}</p>
                <p dir="auto" className="mt-1 text-sm text-muted-foreground">
                  {copy(`Nothing contains “${debounced}” yet. Try a shorter word.`, `لا شيء يحتوي «${debounced}» بعد. جرّب كلمة أقصر.`)}
                </p>
              </div>
            ) : (
              sections.map((section) => (
                <div key={section.title} className="mb-2" role="group" aria-label={section.title}>
                  <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{section.title}</p>
                  {section.items.map((item) => {
                    index++;
                    const current = index;
                    const selected = current === active;
                    return (
                      <div
                        key={item.key}
                        id={`search-option-${current}`}
                        data-index={current}
                        role="option"
                        aria-selected={selected}
                        onMouseMove={() => setActive(current)}
                        onClick={() => go(item.href)}
                        className={`group flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 transition-colors ${selected ? "bg-primary/[0.07]" : ""}`}
                      >
                        {item.render(selected)}
                        <ArrowRight size={16} className={`mt-2 shrink-0 text-primary transition-opacity rtl:rotate-180 ${selected ? "opacity-100" : "opacity-0"}`} />
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {total > 0 && (
            <div className="hidden items-center gap-4 border-t px-4 py-2 text-[11px] text-muted-foreground sm:flex">
              <span className="inline-flex items-center gap-1"><kbd className="rounded border bg-muted px-1">↑</kbd><kbd className="rounded border bg-muted px-1">↓</kbd>{copy("move", "تنقل")}</span>
              <span className="inline-flex items-center gap-1"><kbd className="rounded border bg-muted px-1"><CornerDownLeft size={10} /></kbd>{copy("open", "فتح")}</span>
              <span className="ms-auto">{copy(`${total} results`, `${total} نتيجة`)}</span>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
