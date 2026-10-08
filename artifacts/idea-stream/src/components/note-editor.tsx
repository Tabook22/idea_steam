import { useEffect, useRef } from "react";
import { Bold, CheckSquare, Heading1, Heading2, Highlighter, Italic, List, ListOrdered, Quote, Redo2, Strikethrough, Underline, Undo2 } from "lucide-react";

/**
 * A focused note editor: headings, bold/italic/underline/strike, highlight, bullet, numbered and
 * check lists, quotes. Writes HTML (cleaned again on the server).
 */
export function NoteEditor({ value, onChange, placeholder, copy, autoFocus = false, dark = false }: {
  value: string;
  onChange: (html: string) => void;
  placeholder: string;
  copy: (en: string, ar: string) => string;
  autoFocus?: boolean;
  dark?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  // Set from outside only when it differs (typing keeps the cursor where it is).
  useEffect(() => {
    if (box.current && box.current.innerHTML !== value) box.current.innerHTML = value;
  }, [value]);
  useEffect(() => {
    if (!autoFocus || !box.current) return;
    box.current.focus();
    const range = document.createRange();
    range.selectNodeContents(box.current);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [autoFocus]);

  const emit = () => onChange(box.current?.innerHTML ?? "");
  const command = (name: string, argument?: string) => {
    box.current?.focus();
    document.execCommand(name, false, argument);
    emit();
  };
  const block = (tag: string) => {
    const current = document.queryCommandValue("formatBlock").toLowerCase();
    command("formatBlock", current === tag ? "p" : tag);
  };
  const highlight = () => {
    box.current?.focus();
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    // A <mark> around the selection (or out of one, when already highlighted).
    const parent = selection.anchorNode?.parentElement?.closest("mark");
    if (parent) {
      parent.replaceWith(...Array.from(parent.childNodes));
    } else {
      const mark = document.createElement("mark");
      try { selection.getRangeAt(0).surroundContents(mark); } catch { command("hiliteColor", "#fde68a"); return; }
    }
    emit();
  };
  const checklist = () => {
    box.current?.focus();
    if (!document.queryCommandState("insertUnorderedList")) document.execCommand("insertUnorderedList");
    const li = window.getSelection()?.anchorNode?.parentElement?.closest("li") ?? (window.getSelection()?.anchorNode as HTMLElement | null)?.closest?.("li");
    if (li && !/^[☐☑]/.test(li.textContent ?? "")) li.insertBefore(document.createTextNode("☐ "), li.firstChild);
    emit();
  };
  // Tapping a box ticks it.
  const toggleBox = (event: React.MouseEvent) => {
    const li = (event.target as HTMLElement).closest("li");
    if (!li || !box.current?.contains(li)) return;
    const first = li.firstChild;
    if (first?.nodeType === Node.TEXT_NODE && /^[☐☑]/.test(first.textContent ?? "")) {
      const rect = li.getBoundingClientRect();
      const nearStart = getComputedStyle(li).direction === "rtl" ? rect.right - event.clientX < 28 : event.clientX - rect.left < 28;
      if (!nearStart) return;
      first.textContent = (first.textContent!.startsWith("☐") ? "☑" : "☐") + first.textContent!.slice(1);
      emit();
    }
  };

  const tools: Array<[React.ReactNode, string, () => void]> = [
    [<Heading1 size={16} />, copy("Title", "عنوان"), () => block("h1")],
    [<Heading2 size={16} />, copy("Heading", "عنوان فرعي"), () => block("h2")],
    [<Bold size={16} />, copy("Bold", "عريض"), () => command("bold")],
    [<Italic size={16} />, copy("Italic", "مائل"), () => command("italic")],
    [<Underline size={16} />, copy("Underline", "تسطير"), () => command("underline")],
    [<Strikethrough size={16} />, copy("Strike through", "يتوسطه خط"), () => command("strikeThrough")],
    [<Highlighter size={16} />, copy("Highlight", "تمييز"), highlight],
    [<List size={16} />, copy("Bullets", "نقاط"), () => command("insertUnorderedList")],
    [<ListOrdered size={16} />, copy("Numbers", "ترقيم"), () => command("insertOrderedList")],
    [<CheckSquare size={16} />, copy("Checklist", "قائمة مهام"), checklist],
    [<Quote size={16} />, copy("Quote", "اقتباس"), () => block("blockquote")],
    [<Undo2 size={16} />, copy("Undo", "تراجع"), () => command("undo")],
    [<Redo2 size={16} />, copy("Redo", "إعادة"), () => command("redo")],
  ];

  return (
    <div className={`overflow-hidden rounded-2xl border ${dark ? "border-white/15 bg-white/[0.04]" : "bg-card"}`}>
      <div className={`flex gap-0.5 overflow-x-auto border-b px-1.5 py-1 ${dark ? "border-white/10" : ""}`} role="toolbar" aria-label={copy("Formatting", "التنسيق")}>
        {tools.map(([icon, label, action]) => (
          <button key={label} type="button" title={label} aria-label={label}
            onMouseDown={(event) => event.preventDefault()} onClick={action}
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${dark ? "text-white/75 hover:bg-white/10" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>
            {icon}
          </button>
        ))}
      </div>
      <div
        ref={box}
        contentEditable
        suppressContentEditableWarning
        dir="auto"
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder}
        data-placeholder={placeholder}
        onInput={emit}
        onClick={toggleBox}
        className={`note-paper min-h-40 px-4 py-3 text-[15px] leading-7 outline-none ${dark ? "text-white" : ""}`}
      />
    </div>
  );
}
