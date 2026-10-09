import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  deleteVisual,
  getListCompilationVisualsQueryKey,
  planCompilationVisuals,
  redoVisual,
  updateVisual,
  useListCompilationVisuals,
  type Visual,
  type VisualPlanInputKindsItem,
} from "@workspace/api-client-react";
import {
  BarChart3,
  Check,
  ChevronDown,
  Columns3,
  Download,
  GitBranch,
  ImageIcon,
  ListOrdered,
  Loader2,
  Maximize2,
  Milestone,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  TriangleAlert,
  Wand2,
  X,
} from "lucide-react";
import { uploadFile } from "@/components/books";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { appPath } from "@/lib/app-path";
import { useLanguage } from "@/lib/i18n";
import { PALETTES, canvasPng, renderDiagram, type DiagramKind, type Palette } from "@/lib/visual-draw";
import { hasVisual, insertVisual, removeVisual } from "@/lib/visual-insert";

type Copy = (en: string, ar: string) => string;
type Kind = VisualPlanInputKindsItem;

const KINDS: Array<{ kind: Kind; icon: typeof ImageIcon; en: string; ar: string; hint: [string, string] }> = [
  { kind: "picture", icon: ImageIcon, en: "Pictures", ar: "رسوم", hint: ["Drawn by AI in the style you choose", "يرسمها الذكاء الاصطناعي بالأسلوب الذي تختاره"] },
  { kind: "concept", icon: GitBranch, en: "Concept map", ar: "خريطة مفاهيم", hint: ["The main idea and its branches", "الفكرة الرئيسية وفروعها"] },
  { kind: "steps", icon: ListOrdered, en: "Steps", ar: "خطوات", hint: ["A process, in order", "عملية بالترتيب"] },
  { kind: "timeline", icon: Milestone, en: "Timeline", ar: "خط زمني", hint: ["Events over time", "أحداث عبر الزمن"] },
  { kind: "compare", icon: Columns3, en: "Comparison", ar: "مقارنة", hint: ["Side by side", "جنبًا إلى جنب"] },
  { kind: "chart", icon: BarChart3, en: "Chart", ar: "رسم بياني", hint: ["Only numbers from the text", "أرقام من النص فقط"] },
  { kind: "facts", icon: Sparkles, en: "Key facts", ar: "حقائق رئيسية", hint: ["The essentials at a glance", "الأساسيات بنظرة"] },
];
const STYLES: Array<{ id: string; emoji: string; en: string; ar: string }> = [
  { id: "cartoon", emoji: "🎨", en: "Cartoon", ar: "كرتون" },
  { id: "illustration", emoji: "🖼️", en: "Illustration", ar: "رسم توضيحي" },
  { id: "textbook", emoji: "🔬", en: "Textbook", ar: "كتاب مدرسي" },
  { id: "sketch", emoji: "✍️", en: "Whiteboard", ar: "سبورة" },
  { id: "watercolor", emoji: "🖌️", en: "Watercolour", ar: "ألوان مائية" },
  { id: "clay", emoji: "🧸", en: "3D clay", ar: "صلصال ثلاثي" },
  { id: "comic", emoji: "💬", en: "Comic strip", ar: "قصة مصورة" },
  { id: "realistic", emoji: "📷", en: "Realistic", ar: "واقعي" },
];
const AUDIENCES: Array<[string, string, string]> = [["kids", "Children", "أطفال"], ["students", "Students", "طلاب"], ["adults", "Adults", "بالغون"], ["experts", "Experts", "متخصصون"]];
const PREFS_KEY = "idea-stream-visual-prefs";
type Prefs = { kinds: Kind[]; style: string; audience: string; palette: Palette; count: number; language: "auto" | "ar" | "en" };
const DEFAULT_PREFS: Prefs = { kinds: ["picture", "concept", "steps", "facts", "chart"], style: "illustration", audience: "students", palette: "bright", count: 4, language: "auto" };
function readPrefs(): Prefs {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") }; } catch { return DEFAULT_PREFS; }
}
const kindInfo = (kind: string) => KINDS.find((item) => item.kind === kind) ?? KINDS[0];
const errorText = (error: unknown, fallback: string) => (error as { data?: { error?: string } })?.data?.error ?? fallback;

/** A diagram drawn by the app, shown as an image. */
function useDiagram(visual: Visual, palette: Palette) {
  const [src, setSrc] = useState<string | null>(null);
  const key = JSON.stringify([visual.spec, visual.title, palette]);
  useEffect(() => {
    if (visual.kind === "picture") return;
    let cancelled = false;
    void renderDiagram(visual.kind as DiagramKind, visual.spec, visual.title, palette).then((canvas) => { if (!cancelled) setSrc(canvas.toDataURL("image/png")); }).catch(() => {});
    return () => { cancelled = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return src;
}

function VisualCard({ visual, palette, inDraft, busy, copy, onAdd, onRemoveFromDraft, onRedo, onEdit, onDelete, onDownload, onOpen }: {
  visual: Visual; palette: Palette; inDraft: boolean; busy: boolean; copy: Copy;
  onAdd: () => void; onRemoveFromDraft: () => void; onRedo: (wish: string, style?: string) => void; onEdit: (title: string, caption: string) => void;
  onDelete: () => void; onDownload: () => void; onOpen: (src: string) => void;
}) {
  const info = kindInfo(visual.kind);
  const diagram = useDiagram(visual, palette);
  const src = visual.kind === "picture" ? (visual.imageUrl ? appPath(visual.imageUrl, import.meta.env.BASE_URL) : null) : diagram;
  const [changing, setChanging] = useState(false);
  const [wish, setWish] = useState("");
  const [style, setStyle] = useState(visual.style);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(visual.title);
  const [caption, setCaption] = useState(visual.caption);
  const drawing = visual.status === "drawing";
  return (
    <article className={`group overflow-hidden rounded-3xl border bg-card shadow-sm transition-shadow hover:shadow-md ${inDraft ? "ring-2 ring-emerald-500/60" : ""}`}>
      <div className="relative bg-muted/30">
        {drawing ? (
          <div className="grid aspect-[3/2] place-items-center overflow-hidden bg-[linear-gradient(110deg,hsl(var(--muted))_30%,hsl(var(--background))_50%,hsl(var(--muted))_70%)] bg-[length:200%_100%] motion-safe:animate-[visual-shimmer_1.6s_linear_infinite]">
            <span className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <Wand2 className="animate-pulse text-primary" />
              {copy("Drawing… about a minute", "جارٍ الرسم… نحو دقيقة")}
            </span>
          </div>
        ) : visual.status === "failed" ? (
          <div className="grid aspect-[3/2] place-items-center p-6 text-center">
            <span className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <TriangleAlert className="text-amber-500" />{visual.error ?? copy("It couldn't be drawn.", "تعذر الرسم.")}
              <Button size="sm" variant="outline" onClick={() => onRedo("")} disabled={busy}><RefreshCw size={14} className="me-1.5" />{copy("Try again", "حاول مجددًا")}</Button>
            </span>
          </div>
        ) : src ? (
          <button type="button" onClick={() => onOpen(src)} className="block w-full" aria-label={copy(`Enlarge ${visual.title}`, `كبّر ${visual.title}`)}>
            <img src={src} alt={visual.title} className="block max-h-[420px] w-full object-contain" />
            <span className="absolute end-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100"><Maximize2 size={15} /></span>
          </button>
        ) : (
          <div className="grid aspect-[3/2] place-items-center"><Loader2 className="animate-spin text-muted-foreground" /></div>
        )}
        <span className="absolute start-2 top-2 inline-flex items-center gap-1 rounded-full bg-background/90 px-2.5 py-1 text-[11px] font-semibold shadow-sm backdrop-blur">
          <info.icon size={12} className="text-primary" />{copy(info.en, info.ar)}
          {visual.kind === "picture" && visual.style && <span className="font-normal text-muted-foreground">· {copy(STYLES.find((s) => s.id === visual.style)?.en ?? "", STYLES.find((s) => s.id === visual.style)?.ar ?? "")}</span>}
        </span>
        {inDraft && <span className="absolute end-2 bottom-2 inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow"><Check size={12} />{copy("In the draft", "في المسودة")}</span>}
      </div>
      <div className="space-y-2 p-4">
        {editing ? (
          <div className="space-y-2">
            <Input dir="auto" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} aria-label={copy("Title", "العنوان")} />
            <textarea dir="auto" value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={300} rows={2} aria-label={copy("Caption", "التعليق")}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>{copy("Cancel", "إلغاء")}</Button>
              <Button size="sm" onClick={() => { onEdit(title, caption); setEditing(false); }}>{copy("Save", "حفظ")}</Button>
            </div>
          </div>
        ) : (
          <>
            <h3 dir="auto" className="font-serif text-lg leading-snug">{visual.title}</h3>
            {visual.caption && <p dir="auto" className="text-sm leading-6 text-muted-foreground">{visual.caption}</p>}
            {visual.anchor && <p dir="auto" className="line-clamp-1 text-xs text-muted-foreground/80">{copy("Goes after", "بعد")} “{visual.anchor}”</p>}
          </>
        )}
        {changing && (
          <form className="space-y-2 rounded-2xl bg-secondary/60 p-3" onSubmit={(event) => { event.preventDefault(); onRedo(wish, visual.kind === "picture" ? style : undefined); setChanging(false); setWish(""); }}>
            <Input dir="auto" autoFocus value={wish} onChange={(event) => setWish(event.target.value)} maxLength={500}
              placeholder={visual.kind === "picture" ? copy("e.g. show a forest from below, warmer colours", "مثلًا: أظهر الغابة من الأسفل بألوان أدفأ") : copy("e.g. fewer branches, add the cost", "مثلًا: فروع أقل، أضف التكلفة")} />
            {visual.kind === "picture" && (
              <div className="flex flex-wrap gap-1">
                {STYLES.map((option) => (
                  <button key={option.id} type="button" onClick={() => setStyle(option.id)} aria-pressed={style === option.id}
                    className={`rounded-full border px-2.5 py-1 text-xs ${style === option.id ? "border-primary bg-primary text-primary-foreground" : "bg-background"}`}>{option.emoji} {copy(option.en, option.ar)}</button>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setChanging(false)}>{copy("Cancel", "إلغاء")}</Button>
              <Button type="submit" size="sm" disabled={busy}><RefreshCw size={14} className="me-1.5" />{visual.kind === "picture" ? copy("Draw again", "ارسم مجددًا") : copy("Remake", "أعد الإنشاء")}</Button>
            </div>
          </form>
        )}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {inDraft ? (
            <Button size="sm" variant="outline" className="rounded-full" onClick={onRemoveFromDraft} disabled={busy}><X size={14} className="me-1" />{copy("Take out of the draft", "أخرجه من المسودة")}</Button>
          ) : (
            <Button size="sm" className="rounded-full" onClick={onAdd} disabled={busy || drawing || visual.status === "failed" || !src}>
              {busy ? <Loader2 size={14} className="me-1 animate-spin" /> : <Plus size={14} className="me-1" />}{copy("Add to the draft", "أضفه إلى المسودة")}
            </Button>
          )}
          <Button size="sm" variant="ghost" className="rounded-full" onClick={() => setChanging((open) => !open)} disabled={busy || drawing}><RefreshCw size={14} className="me-1" />{copy("Change", "غيّر")}</Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full" onClick={() => { setTitle(visual.title); setCaption(visual.caption); setEditing(true); }} aria-label={copy("Edit the words", "عدّل الكلمات")}><Pencil size={14} /></Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full" onClick={onDownload} disabled={!src} aria-label={copy("Download", "تنزيل")}><Download size={14} /></Button>
          <Button size="icon" variant="ghost" className="ms-auto h-8 w-8 rounded-full text-muted-foreground hover:text-destructive" onClick={onDelete} aria-label={copy("Delete", "حذف")}><Trash2 size={14} /></Button>
        </div>
      </div>
    </article>
  );
}

/**
 * Turns a draft into visuals: the AI reads it and suggests pictures (drawn in the chosen style) and
 * diagrams (drawn exactly by the app). Each can be changed, downloaded, or added to the draft after
 * the paragraph it explains, so it goes into Read, PDF and Word too.
 */
export function VisualStudio({ open, onOpenChange, compilationId, content, saveContent }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  compilationId: number;
  content: string;
  /** Saves the draft with visuals added or removed (rich text with its marker). */
  saveContent: (html: string) => Promise<void>;
}) {
  const { isArabic } = useLanguage();
  const copy: Copy = (en, ar) => (isArabic ? ar : en);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [prefs, setPrefsState] = useState<Prefs>(readPrefs);
  const setPrefs = (patch: Partial<Prefs>) => setPrefsState((current) => {
    const next = { ...current, ...patch };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* optional */ }
    return next;
  });
  const { data: visuals = [], isLoading } = useListCompilationVisuals(compilationId, {
    query: { enabled: open, refetchInterval: (query: { state: { data?: unknown } }) => ((query.state.data as Visual[] | undefined)?.some((v) => v.status === "drawing") ? 3000 : false) } as never,
  });
  const [planning, setPlanning] = useState<string | null>(null);
  const [working, setWorking] = useState<Set<number>>(new Set());
  const [request, setRequest] = useState("");
  const [showOptions, setShowOptions] = useState(true);
  const [large, setLarge] = useState<string | null>(null);
  useEffect(() => { if (open) setShowOptions(visuals.length === 0); }, [open, visuals.length === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const key = getListCompilationVisualsQueryKey(compilationId);
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const html = useMemo(() => {
    const marker = "<!--idea-stream-rich-text-->";
    if (content.startsWith(marker)) return content.slice(marker.length);
    return content.split(/\n{2,}/).map((paragraph) => {
      const escaped = paragraph.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
      if (escaped.startsWith("### ")) return `<h3>${escaped.slice(4)}</h3>`;
      if (escaped.startsWith("## ")) return `<h2>${escaped.slice(3)}</h2>`;
      if (escaped.startsWith("# ")) return `<h1>${escaped.slice(2)}</h1>`;
      return `<p>${escaped}</p>`;
    }).join("");
  }, [content]);
  const shownUrl = (url: string) => appPath(url, import.meta.env.BASE_URL);
  const inDraft = (visual: Visual) => !!visual.imageUrl && hasVisual(html, shownUrl(visual.imageUrl));

  const busyWith = async (id: number, work: () => Promise<void>) => {
    setWorking((current) => new Set(current).add(id));
    try { await work(); } finally { setWorking((current) => { const next = new Set(current); next.delete(id); return next; }); }
  };

  async function makeVisuals(own?: string) {
    if (!prefs.kinds.length) { toast({ title: copy("Choose at least one kind of visual.", "اختر نوعًا واحدًا على الأقل.") }); return; }
    setPlanning(own ? copy("Making your visual…", "جارٍ إنشاء رسمتك…") : copy("Reading the draft and planning visuals…", "جارٍ قراءة المسودة وتخطيط الرسوم…"));
    try {
      const made = await planCompilationVisuals(compilationId, {
        kinds: prefs.kinds, style: prefs.style, audience: prefs.audience, language: prefs.language, count: prefs.count, ...(own ? { request: own } : {}),
      });
      queryClient.setQueryData<Visual[]>(key, (old) => [...(old ?? []), ...made]);
      setShowOptions(false);
      setRequest("");
      const pictures = made.filter((visual) => visual.kind === "picture").length;
      toast({ title: copy(`${made.length} visual${made.length === 1 ? "" : "s"} ready${pictures ? `, ${pictures} picture${pictures === 1 ? " is" : "s are"} being drawn` : ""}.`, `${made.length} رسمة جاهزة${pictures ? `، و${pictures} قيد الرسم` : ""}.`) });
    } catch (error) {
      toast({ variant: "destructive", title: errorText(error, copy("Visuals couldn't be made. Please try again.", "تعذر إنشاء الرسوم. حاول مجددًا.")) });
    } finally { setPlanning(null); }
  }

  /** The visual's picture URL; a diagram is drawn and uploaded first. */
  async function pictureUrl(visual: Visual) {
    if (visual.kind === "picture") return visual.imageUrl!;
    const canvas = await renderDiagram(visual.kind as DiagramKind, visual.spec, visual.title, prefs.palette);
    const url = await uploadFile(await canvasPng(canvas), `${visual.title.slice(0, 60) || "diagram"}.png`, "image/png");
    const saved = await updateVisual(visual.id, { imageUrl: url });
    queryClient.setQueryData<Visual[]>(key, (old) => old?.map((one) => (one.id === saved.id ? saved : one)));
    return url;
  }
  async function add(list: Visual[]) {
    let next = html;
    for (const visual of list) {
      const url = await pictureUrl(visual);
      next = insertVisual(next, { url: shownUrl(url), title: visual.title, caption: visual.caption, anchor: visual.anchor });
    }
    await saveContent(next);
  }
  const addOne = (visual: Visual) => busyWith(visual.id, async () => {
    try { await add([visual]); toast({ title: copy("Added to the draft, after the paragraph it explains.", "أُضيفت إلى المسودة بعد الفقرة التي تشرحها.") }); }
    catch { toast({ variant: "destructive", title: copy("It couldn't be added. Please try again.", "تعذرت الإضافة. حاول مجددًا.") }); }
  });
  const ready = visuals.filter((visual) => visual.status === "ready" && !inDraft(visual));
  async function addAll() {
    setPlanning(copy("Adding the visuals to the draft…", "جارٍ إضافة الرسوم إلى المسودة…"));
    try { await add(ready); toast({ title: copy("All visuals are in the draft.", "كل الرسوم في المسودة.") }); }
    catch { toast({ variant: "destructive", title: copy("Some visuals couldn't be added.", "تعذرت إضافة بعض الرسوم.") }); }
    finally { setPlanning(null); }
  }
  const takeOut = (visual: Visual) => busyWith(visual.id, async () => {
    try { await saveContent(removeVisual(html, shownUrl(visual.imageUrl!))); }
    catch { toast({ variant: "destructive", title: copy("The draft couldn't be saved.", "تعذر حفظ المسودة.") }); }
  });
  const redo = (visual: Visual, wish: string, style?: string) => busyWith(visual.id, async () => {
    try {
      // A visual in the draft is replaced there once it's made again.
      const wasIn = inDraft(visual);
      if (wasIn) await saveContent(removeVisual(html, shownUrl(visual.imageUrl!)));
      const saved = await redoVisual(visual.id, { ...(wish ? { wish } : {}), ...(style ? { style } : {}) });
      queryClient.setQueryData<Visual[]>(key, (old) => old?.map((one) => (one.id === saved.id ? saved : one)));
      if (wasIn) toast({ title: copy("Taken out of the draft while it changes. Add it again when you like it.", "أُخرجت من المسودة أثناء التغيير. أضفها مجددًا عندما تعجبك.") });
    } catch (error) { toast({ variant: "destructive", title: errorText(error, copy("It couldn't be changed.", "تعذر التغيير.")) }); }
  });
  const edit = (visual: Visual, title: string, caption: string) => busyWith(visual.id, async () => {
    try {
      const wasIn = inDraft(visual);
      const saved = await updateVisual(visual.id, { title, caption });
      queryClient.setQueryData<Visual[]>(key, (old) => old?.map((one) => (one.id === saved.id ? saved : one)));
      // The draft shows the new words too.
      if (wasIn) {
        const url = await pictureUrl(saved);
        const without = removeVisual(html, shownUrl(visual.imageUrl!));
        await saveContent(insertVisual(without, { url: shownUrl(url), title: saved.title, caption: saved.caption, anchor: saved.anchor }));
      }
    } catch { toast({ variant: "destructive", title: copy("It couldn't be saved.", "تعذر الحفظ.") }); }
  });
  const remove = (visual: Visual) => busyWith(visual.id, async () => {
    if (!window.confirm(copy("Delete this visual?", "حذف هذه الرسمة؟"))) return;
    try {
      if (inDraft(visual)) await saveContent(removeVisual(html, shownUrl(visual.imageUrl!)));
      await deleteVisual(visual.id);
      queryClient.setQueryData<Visual[]>(key, (old) => old?.filter((one) => one.id !== visual.id));
    } catch { toast({ variant: "destructive", title: copy("It couldn't be deleted.", "تعذر الحذف.") }); }
  });
  async function download(visual: Visual) {
    try {
      const blob = visual.kind === "picture"
        ? await (await fetch(shownUrl(visual.imageUrl!))).blob()
        : await canvasPng(await renderDiagram(visual.kind as DiagramKind, visual.spec, visual.title, prefs.palette));
      const url = URL.createObjectURL(blob);
      const link = Object.assign(document.createElement("a"), { href: url, download: `${visual.title.replace(/[\\/:*?"<>|]+/g, " ").slice(0, 80) || "visual"}.png` });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch { toast({ variant: "destructive", title: copy("The download failed.", "فشل التنزيل.") }); }
  }

  const toggleKind = (kind: Kind) => setPrefs({ kinds: prefs.kinds.includes(kind) ? prefs.kinds.filter((one) => one !== kind) : [...prefs.kinds, kind] });
  const chip = (active: boolean) => `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${active ? "border-primary bg-primary text-primary-foreground shadow-sm" : "bg-background text-muted-foreground hover:text-foreground"}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[94vh] w-[96vw] max-w-6xl flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="shrink-0 border-b bg-gradient-to-r from-violet-500/10 via-primary/5 to-amber-400/10 px-5 py-4 pe-12">
          <DialogTitle className="flex items-center gap-2 font-serif text-2xl"><Wand2 className="text-violet-600" size={22} />{copy("Visuals for this draft", "رسوم لهذه المسودة")}</DialogTitle>
          <DialogDescription>{copy("The AI reads your draft, finds what's worth showing, and makes pictures, diagrams and charts. Add them to the draft and they go into Read, PDF and Word.", "يقرأ الذكاء الاصطناعي مسودتك، ويختار ما يستحق العرض، ويصنع رسومًا ومخططات ورسومًا بيانية. أضفها إلى المسودة لتظهر في القراءة وPDF وWord.")}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <section className="border-b bg-muted/20 px-5 py-4">
            <button type="button" onClick={() => setShowOptions((show) => !show)} className="flex w-full items-center justify-between text-start" aria-expanded={showOptions}>
              <span className="font-semibold">{visuals.length ? copy("Make more visuals", "اصنع رسومًا أخرى") : copy("What would help your readers?", "ما الذي سيساعد قرّاءك؟")}</span>
              <ChevronDown size={18} className={`transition-transform ${showOptions ? "rotate-180" : ""}`} />
            </button>
            {showOptions && (
              <div className="mt-4 space-y-5">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{copy("Kinds of visuals", "أنواع الرسوم")}</p>
                  <div className="flex flex-wrap gap-2">
                    {KINDS.map((item) => (
                      <button key={item.kind} type="button" onClick={() => toggleKind(item.kind)} aria-pressed={prefs.kinds.includes(item.kind)} title={copy(...item.hint)} className={chip(prefs.kinds.includes(item.kind))}>
                        <item.icon size={15} />{copy(item.en, item.ar)}
                      </button>
                    ))}
                  </div>
                </div>
                {prefs.kinds.includes("picture") && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{copy("Picture style", "أسلوب الرسم")}</p>
                    <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                      {STYLES.map((style) => (
                        <button key={style.id} type="button" onClick={() => setPrefs({ style: style.id })} aria-pressed={prefs.style === style.id}
                          className={`flex flex-col items-center gap-1 rounded-2xl border px-1 py-2.5 text-xs font-medium transition-all ${prefs.style === style.id ? "border-primary bg-primary/10 text-foreground shadow-sm ring-1 ring-primary" : "bg-background text-muted-foreground hover:text-foreground"}`}>
                          <span className="text-2xl leading-none">{style.emoji}</span>{copy(style.en, style.ar)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{copy("For", "لمن")}</p>
                    <div className="flex flex-wrap gap-1.5">{AUDIENCES.map(([id, en, ar]) => <button key={id} type="button" onClick={() => setPrefs({ audience: id })} aria-pressed={prefs.audience === id} className={chip(prefs.audience === id)}>{copy(en, ar)}</button>)}</div>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{copy("Diagram colours", "ألوان المخططات")}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(Object.keys(PALETTES) as Palette[]).map((name) => (
                        <button key={name} type="button" onClick={() => setPrefs({ palette: name })} aria-pressed={prefs.palette === name} className={chip(prefs.palette === name)}>
                          <span className="flex">{PALETTES[name].colors.slice(0, 3).map((color) => <span key={color} className="-me-1 h-3.5 w-3.5 rounded-full border border-white" style={{ background: color }} />)}</span>
                          <span className="ms-1">{copy(PALETTES[name].en, PALETTES[name].ar)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{copy("How many", "كم رسمة")}</p>
                    <div className="flex gap-1.5">{[2, 4, 6].map((count) => <button key={count} type="button" onClick={() => setPrefs({ count })} aria-pressed={prefs.count === count} className={chip(prefs.count === count)}>{count}</button>)}</div>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{copy("Words in diagrams", "كلمات المخططات")}</p>
                    <div className="flex flex-wrap gap-1.5">{([["auto", "As the draft", "كلغة المسودة"], ["ar", "العربية", "العربية"], ["en", "English", "English"]] as const).map(([id, en, ar]) => <button key={id} type="button" onClick={() => setPrefs({ language: id })} aria-pressed={prefs.language === id} className={chip(prefs.language === id)}>{copy(en, ar)}</button>)}</div>
                  </div>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Button size="lg" className="rounded-full bg-gradient-to-r from-violet-600 to-primary shadow-md" onClick={() => void makeVisuals()} disabled={!!planning}>
                    {planning ? <Loader2 size={18} className="me-2 animate-spin" /> : <Sparkles size={18} className="me-2" />}{copy("Read the draft and make visuals", "اقرأ المسودة واصنع الرسوم")}
                  </Button>
                  <form className="flex min-w-0 flex-1 gap-2" onSubmit={(event) => { event.preventDefault(); if (request.trim()) void makeVisuals(request.trim()); }}>
                    <Input dir="auto" value={request} onChange={(event) => setRequest(event.target.value)} maxLength={500} className="rounded-full"
                      placeholder={copy("…or describe your own, e.g. “a cartoon of tree roots talking to each other”", "…أو صِف رسمتك، مثلًا: «جذور أشجار تتحدث مع بعضها بأسلوب كرتوني»")} aria-label={copy("Describe your own visual", "صِف رسمتك")} />
                    <Button type="submit" variant="outline" className="shrink-0 rounded-full" disabled={!request.trim() || !!planning}><Send size={15} /></Button>
                  </form>
                </div>
              </div>
            )}
          </section>
          {planning && (
            <div className="mx-5 mt-4 flex items-center gap-3 rounded-2xl border border-violet-300/60 bg-violet-50 px-4 py-3 text-sm text-violet-900 dark:border-violet-800/50 dark:bg-violet-950/30 dark:text-violet-100" role="status">
              <Loader2 size={16} className="animate-spin" />{planning}
            </div>
          )}
          <div className="p-5">
            {isLoading ? (
              <div className="grid h-40 place-items-center text-muted-foreground"><Loader2 className="animate-spin" /></div>
            ) : !visuals.length ? (
              <div className="mx-auto max-w-lg py-8 text-center text-sm text-muted-foreground">
                <div className="mb-4 flex justify-center gap-3 text-3xl" aria-hidden="true">🎨 🗺️ 📊 🧭</div>
                {copy("Pictures are drawn by AI in your chosen style. Diagrams and charts are drawn exactly from your text, with every word spelled right, Arabic included. Charts only use numbers that are in your draft.",
                  "الرسوم يرسمها الذكاء الاصطناعي بالأسلوب الذي تختاره. أما المخططات والرسوم البيانية فتُرسم بدقة من نصك وبكلمات صحيحة الإملاء، بالعربية أيضًا. والرسوم البيانية لا تستخدم إلا الأرقام الموجودة في مسودتك.")}
              </div>
            ) : (
              <div className="grid gap-5 md:grid-cols-2">
                {visuals.map((visual) => (
                  <VisualCard key={visual.id} visual={visual} palette={prefs.palette} inDraft={inDraft(visual)} busy={working.has(visual.id)} copy={copy}
                    onAdd={() => void addOne(visual)} onRemoveFromDraft={() => void takeOut(visual)} onRedo={(wish, style) => void redo(visual, wish, style)}
                    onEdit={(title, caption) => void edit(visual, title, caption)} onDelete={() => void remove(visual)} onDownload={() => void download(visual)} onOpen={setLarge} />
                ))}
              </div>
            )}
          </div>
        </div>
        {visuals.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-card px-5 py-3">
            <p className="text-xs text-muted-foreground">
              {copy(`${visuals.filter(inDraft).length} of ${visuals.length} in the draft`, `${visuals.filter(inDraft).length} من ${visuals.length} في المسودة`)}
              {visuals.some((visual) => visual.status === "drawing") && <span className="ms-2 inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" />{copy("drawing…", "جارٍ الرسم…")}</span>}
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>{copy("Done", "تم")}</Button>
              <Button onClick={() => void addAll()} disabled={!ready.length || !!planning}><Plus size={16} className="me-1.5" />{copy(`Add all to the draft (${ready.length})`, `أضف الكل إلى المسودة (${ready.length})`)}</Button>
            </div>
          </div>
        )}
        {large && (
          <div className="fixed inset-0 z-[100] grid place-items-center bg-black/80 p-4" onClick={() => setLarge(null)} role="dialog" aria-label={copy("Large view", "عرض كبير")}>
            <img src={large} alt="" className="max-h-full max-w-full rounded-xl bg-white object-contain shadow-2xl" />
            <button type="button" className="absolute end-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white" aria-label={copy("Close", "إغلاق")}><X /></button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
