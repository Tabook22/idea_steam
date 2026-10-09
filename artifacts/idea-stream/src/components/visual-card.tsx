import { useEffect, useState } from "react";
import type { Visual } from "@workspace/api-client-react";
import {
  BarChart3,
  Brush,
  Check,
  ChevronDown,
  Columns3,
  Download,
  GitBranch,
  History,
  ImageIcon,
  ListOrdered,
  Loader2,
  Maximize2,
  Milestone,
  Paintbrush,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  TriangleAlert,
  Wand2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { appPath } from "@/lib/app-path";
import { renderDiagram, type DiagramKind, type Palette } from "@/lib/visual-draw";

type Copy = (en: string, ar: string) => string;
export type RedoOptions = { wish?: string; mode?: "retouch" | "redraw"; style?: string; prompt?: string };

export const VISUAL_KINDS = [
  { kind: "picture", icon: ImageIcon, en: "Pictures", ar: "رسوم", hint: ["Drawn by AI in the style you choose", "يرسمها الذكاء الاصطناعي بالأسلوب الذي تختاره"] },
  { kind: "concept", icon: GitBranch, en: "Concept map", ar: "خريطة مفاهيم", hint: ["The main idea and its branches", "الفكرة الرئيسية وفروعها"] },
  { kind: "steps", icon: ListOrdered, en: "Steps", ar: "خطوات", hint: ["A process, in order", "عملية بالترتيب"] },
  { kind: "timeline", icon: Milestone, en: "Timeline", ar: "خط زمني", hint: ["Events over time", "أحداث عبر الزمن"] },
  { kind: "compare", icon: Columns3, en: "Comparison", ar: "مقارنة", hint: ["Side by side", "جنبًا إلى جنب"] },
  { kind: "chart", icon: BarChart3, en: "Chart", ar: "رسم بياني", hint: ["Only numbers from the text", "أرقام من النص فقط"] },
  { kind: "facts", icon: Sparkles, en: "Key facts", ar: "حقائق رئيسية", hint: ["The essentials at a glance", "الأساسيات بنظرة"] },
] as const;
export const PICTURE_STYLES = [
  { id: "cartoon", emoji: "🎨", en: "Cartoon", ar: "كرتون" },
  { id: "illustration", emoji: "🖼️", en: "Illustration", ar: "رسم توضيحي" },
  { id: "textbook", emoji: "🔬", en: "Textbook", ar: "كتاب مدرسي" },
  { id: "sketch", emoji: "✍️", en: "Whiteboard", ar: "سبورة" },
  { id: "watercolor", emoji: "🖌️", en: "Watercolour", ar: "ألوان مائية" },
  { id: "clay", emoji: "🧸", en: "3D clay", ar: "صلصال ثلاثي" },
  { id: "comic", emoji: "💬", en: "Comic strip", ar: "قصة مصورة" },
  { id: "realistic", emoji: "📷", en: "Realistic", ar: "واقعي" },
];
const kindInfo = (kind: string) => VISUAL_KINDS.find((item) => item.kind === kind) ?? VISUAL_KINDS[0];

/** One-tap ideas for the change box. */
const PICTURE_IDEAS: Array<[string, string]> = [
  ["Warmer, softer colours", "ألوان أدفأ وأنعم"],
  ["Brighter and more cheerful", "أكثر إشراقًا وبهجة"],
  ["Add more detail", "أضف تفاصيل أكثر"],
  ["Simpler, fewer objects", "أبسط، بعناصر أقل"],
  ["Add a teacher explaining it", "أضف معلّمًا يشرح"],
  ["Add curious students", "أضف طلابًا فضوليين"],
  ["Make the main idea bigger", "كبّر الفكرة الرئيسية"],
  ["Plain white background", "خلفية بيضاء بسيطة"],
];
const DIAGRAM_IDEAS: Array<[string, string]> = [
  ["Fewer words", "كلمات أقل"],
  ["Add an example", "أضف مثالًا"],
  ["More detail", "تفاصيل أكثر"],
  ["Simpler, for children", "أبسط، للأطفال"],
  ["Write it in Arabic", "اكتبه بالعربية"],
  ["Write it in English", "اكتبه بالإنجليزية"],
];

/** A diagram drawn by the app, shown as an image. */
function useDiagram(visual: Pick<Visual, "kind" | "spec" | "title">, palette: Palette) {
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

/**
 * One visual: its picture, words and actions, and under it a box to customise it: describe a
 * change and retouch the same picture (or draw it again), edit the full drawing description, or go
 * back to an earlier version.
 */
export function VisualCard({ visual, palette, inDraft, busy, copy, onAdd, onRemoveFromDraft, onRedo, onRestore, onEdit, onDelete, onDownload, onOpen }: {
  visual: Visual; palette: Palette; inDraft: boolean; busy: boolean; copy: Copy;
  onAdd: () => void; onRemoveFromDraft: () => void;
  onRedo: (options: RedoOptions) => Promise<boolean>; onRestore: (version: number) => void;
  onEdit: (title: string, caption: string) => void;
  onDelete: () => void; onDownload: () => void; onOpen: (src: string) => void;
}) {
  const info = kindInfo(visual.kind);
  const picture = visual.kind === "picture";
  const diagram = useDiagram(visual, palette);
  const src = picture ? (visual.imageUrl ? appPath(visual.imageUrl, import.meta.env.BASE_URL) : null) : diagram;
  const [wish, setWish] = useState("");
  const [style, setStyle] = useState(visual.style);
  const [prompt, setPrompt] = useState(String(visual.spec.prompt ?? ""));
  const [showPrompt, setShowPrompt] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(visual.title);
  const [caption, setCaption] = useState(visual.caption);
  useEffect(() => { setStyle(visual.style); setPrompt(String(visual.spec.prompt ?? "")); }, [visual.style, visual.spec.prompt]);
  const drawing = visual.status === "drawing";
  const retouching = drawing && !!src;
  const history = visual.history ?? [];
  const styleInfo = PICTURE_STYLES.find((option) => option.id === visual.style);
  const promptChanged = prompt.trim() && prompt.trim() !== String(visual.spec.prompt ?? "").trim();

  const send = async (options: RedoOptions) => { if (await onRedo(options)) { setWish(""); setShowPrompt(false); } };
  const addIdea = (idea: string) => setWish((current) => (current.trim() ? `${current.trim().replace(/[.,;]$/, "")}, ${idea.toLowerCase()}` : idea));

  return (
    <article className={`group overflow-hidden rounded-3xl border bg-card shadow-sm transition-shadow hover:shadow-md ${inDraft ? "ring-2 ring-emerald-500/60" : ""}`}>
      <div className="relative bg-muted/30">
        {drawing && !src ? (
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
              <Button size="sm" variant="outline" onClick={() => void send({ mode: "redraw" })} disabled={busy}><RefreshCw size={14} className="me-1.5" />{copy("Try again", "حاول مجددًا")}</Button>
            </span>
          </div>
        ) : src ? (
          <button type="button" onClick={() => onOpen(src)} className="block w-full" aria-label={copy(`Enlarge ${visual.title}`, `كبّر ${visual.title}`)} disabled={retouching}>
            <img src={src} alt={visual.title} className={`block max-h-[420px] w-full object-contain transition ${retouching ? "opacity-60 blur-[1px]" : ""}`} />
            {!retouching && <span className="absolute end-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100"><Maximize2 size={15} /></span>}
          </button>
        ) : (
          <div className="grid aspect-[3/2] place-items-center"><Loader2 className="animate-spin text-muted-foreground" /></div>
        )}
        {retouching && (
          <span className="absolute inset-0 grid place-items-center">
            <span className="flex items-center gap-2 rounded-full bg-background/95 px-4 py-2 text-sm font-medium shadow-lg"><Paintbrush size={16} className="animate-pulse text-violet-600" />{copy("Working on your change…", "جارٍ تنفيذ التعديل…")}</span>
          </span>
        )}
        <span className="absolute start-2 top-2 inline-flex items-center gap-1 rounded-full bg-background/90 px-2.5 py-1 text-[11px] font-semibold shadow-sm backdrop-blur">
          <info.icon size={12} className="text-primary" />{copy(info.en, info.ar)}
          {picture && styleInfo && <span className="font-normal text-muted-foreground">· {copy(styleInfo.en, styleInfo.ar)}</span>}
        </span>
        {inDraft && <span className="absolute end-2 bottom-2 inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow"><Check size={12} />{copy("In the draft", "في المسودة")}</span>}
      </div>

      <div className="space-y-3 p-4">
        {visual.status === "ready" && visual.error && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><TriangleAlert size={14} className="mt-0.5 shrink-0" />{visual.error} {copy("The picture is as it was.", "بقيت الصورة كما كانت.")}</p>
        )}
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
          <div>
            <h3 dir="auto" className="font-serif text-lg leading-snug">{visual.title}</h3>
            {visual.caption && <p dir="auto" className="mt-1 text-sm leading-6 text-muted-foreground">{visual.caption}</p>}
            {visual.anchor && <p dir="auto" className="mt-1 line-clamp-1 text-xs text-muted-foreground/80">{copy("Goes after", "بعد")} “{visual.anchor}”</p>}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {inDraft ? (
            <Button size="sm" variant="outline" className="rounded-full" onClick={onRemoveFromDraft} disabled={busy}><X size={14} className="me-1" />{copy("Take out of the draft", "أخرجه من المسودة")}</Button>
          ) : (
            <Button size="sm" className="rounded-full" onClick={onAdd} disabled={busy || drawing || visual.status === "failed" || !src}>
              {busy ? <Loader2 size={14} className="me-1 animate-spin" /> : <Plus size={14} className="me-1" />}{copy("Add to the draft", "أضفه إلى المسودة")}
            </Button>
          )}
          <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full" onClick={() => { setTitle(visual.title); setCaption(visual.caption); setEditing(true); }} aria-label={copy("Edit the title and caption", "عدّل العنوان والتعليق")} title={copy("Edit the title and caption", "عدّل العنوان والتعليق")}><Pencil size={14} /></Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full" onClick={onDownload} disabled={!src} aria-label={copy("Download", "تنزيل")} title={copy("Download", "تنزيل")}><Download size={14} /></Button>
          <Button size="icon" variant="ghost" className="ms-auto h-8 w-8 rounded-full text-muted-foreground hover:text-destructive" onClick={onDelete} aria-label={copy("Delete", "حذف")} title={copy("Delete", "حذف")}><Trash2 size={14} /></Button>
        </div>

        {/* Customise: describe a change, edit the drawing description, or go back. */}
        <section className="space-y-2.5 rounded-2xl border border-violet-200/70 bg-gradient-to-br from-violet-50/80 to-transparent p-3 dark:border-violet-900/50 dark:from-violet-950/20" aria-label={copy("Customise", "خصّص")}>
          <p className="flex items-center gap-1.5 text-xs font-semibold text-violet-900 dark:text-violet-200">
            <Wand2 size={14} />{picture ? copy("Customise this picture", "خصّص هذه الصورة") : copy("Change this diagram", "غيّر هذا المخطط")}
          </p>
          <textarea dir="auto" value={wish} onChange={(event) => setWish(event.target.value)} maxLength={1000} rows={2} disabled={drawing}
            aria-label={picture ? copy("Describe a change to the picture", "صِف تعديلًا على الصورة") : copy("Describe a change to the diagram", "صِف تعديلًا على المخطط")}
            placeholder={picture
              ? copy("Describe a change… e.g. add an owl on the branch, make the roots glow blue", "صِف التعديل… مثلًا: أضف بومة على الغصن، اجعل الجذور تتوهج بالأزرق")
              : copy("Describe a change… e.g. add a branch about tokens, shorter labels", "صِف التعديل… مثلًا: أضف فرعًا عن الرموز، عناوين أقصر")}
            onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && wish.trim()) void send(picture ? { wish: wish.trim(), mode: visual.imageUrl ? "retouch" : "redraw" } : { wish: wish.trim() }); }}
            className="w-full resize-y rounded-xl border bg-background px-3 py-2 text-sm leading-6 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200 dark:focus:ring-violet-900" />
          <div className="flex flex-wrap gap-1">
            {(picture ? PICTURE_IDEAS : DIAGRAM_IDEAS).map(([en, ar]) => (
              <button key={en} type="button" onClick={() => addIdea(copy(en, ar))} disabled={drawing}
                className="rounded-full border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-violet-300 hover:text-foreground disabled:opacity-50">+ {copy(en, ar)}</button>
            ))}
          </div>
          {picture ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" className="rounded-full bg-violet-600 hover:bg-violet-700" disabled={busy || drawing || !wish.trim() || !visual.imageUrl || style !== visual.style}
                  onClick={() => void send({ wish: wish.trim(), mode: "retouch" })}
                  title={copy("Keeps this picture and changes only what you describe", "يحتفظ بهذه الصورة ويغيّر ما تصفه فقط")}>
                  <Brush size={14} className="me-1.5" />{copy("Retouch this picture", "عدّل هذه الصورة")}
                </Button>
                <Button size="sm" variant="outline" className="rounded-full" disabled={busy || drawing}
                  onClick={() => void send({ ...(wish.trim() ? { wish: wish.trim() } : {}), mode: "redraw", ...(style !== visual.style ? { style } : {}) })}
                  title={copy("A new drawing, with your change if you wrote one", "رسمة جديدة، مع تعديلك إن كتبته")}>
                  <RefreshCw size={14} className="me-1.5" />{copy("Draw again", "ارسم من جديد")}
                </Button>
                <select value={style} onChange={(event) => setStyle(event.target.value)} disabled={drawing} aria-label={copy("Style for drawing again", "أسلوب الرسم من جديد")}
                  className="h-8 rounded-full border bg-background px-2.5 text-xs">
                  {PICTURE_STYLES.map((option) => <option key={option.id} value={option.id}>{option.emoji} {copy(option.en, option.ar)}</option>)}
                </select>
              </div>
              <p className="text-[11px] leading-5 text-muted-foreground">
                {style !== visual.style
                  ? copy("A new style means drawing again.", "الأسلوب الجديد يعني الرسم من جديد.")
                  : copy("Retouch keeps the picture and changes only what you ask. Draw again makes a new one.", "التعديل يحتفظ بالصورة ويغيّر ما تطلبه فقط. والرسم من جديد يصنع صورة جديدة.")}
              </p>
              <button type="button" onClick={() => setShowPrompt((open) => !open)} aria-expanded={showPrompt}
                className="flex items-center gap-1 text-xs font-medium text-violet-800 hover:underline dark:text-violet-300">
                <ChevronDown size={14} className={`transition-transform ${showPrompt ? "rotate-180" : ""}`} />{copy("Drawing description (prompt)", "وصف الرسم (الأمر)")}
              </button>
              {showPrompt && (
                <div className="space-y-2">
                  <textarea dir="auto" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={2000} rows={5} disabled={drawing}
                    aria-label={copy("Drawing description", "وصف الرسم")}
                    className="w-full resize-y rounded-xl border bg-background px-3 py-2 font-mono text-xs leading-5" />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">{copy("Rewrite it freely, in any language. Lettering is always left out so nothing is misspelled.", "أعد كتابته كما تشاء وبأي لغة. لا تُكتب حروف في الصورة كي لا تظهر أخطاء.")}</span>
                    <Button size="sm" variant="outline" className="rounded-full" disabled={busy || drawing || !promptChanged}
                      onClick={() => void send({ prompt: prompt.trim(), mode: "redraw", ...(style !== visual.style ? { style } : {}) })}>
                      <RefreshCw size={14} className="me-1.5" />{copy("Draw from this description", "ارسم من هذا الوصف")}
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <Button size="sm" className="rounded-full bg-violet-600 hover:bg-violet-700" disabled={busy || !wish.trim()} onClick={() => void send({ wish: wish.trim() })}>
              {busy ? <Loader2 size={14} className="me-1.5 animate-spin" /> : <RefreshCw size={14} className="me-1.5" />}{copy("Apply the change", "طبّق التعديل")}
            </Button>
          )}
          {history.length > 0 && (
            <div className="border-t border-violet-200/60 pt-2.5 dark:border-violet-900/40">
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground"><History size={13} />{copy("Earlier versions: tap one to go back", "النسخ السابقة: اضغط نسخة للرجوع إليها")}</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {history.map((version, index) => ({ version, index })).reverse().map(({ version, index }) => (
                  <VersionButton key={`${index}-${version.at}`} version={version} visual={visual} number={index + 1} palette={palette} copy={copy}
                    disabled={busy || drawing} onClick={() => onRestore(index)} />
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </article>
  );
}

function VersionButton({ version, visual, number, palette, copy, disabled, onClick }: {
  version: Visual["history"][number]; visual: Visual; number: number; palette: Palette; copy: Copy; disabled: boolean; onClick: () => void;
}) {
  const label = `${copy(`Version ${number}`, `النسخة ${number}`)}${version.note ? ` · ${copy("then", "ثم")}: ${version.note}` : ""}`;
  const src = version.imageUrl ? appPath(version.imageUrl, import.meta.env.BASE_URL) : null;
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label}
      className="group/version relative h-14 w-20 shrink-0 overflow-hidden rounded-lg border bg-background shadow-sm transition hover:ring-2 hover:ring-violet-400 disabled:opacity-50">
      {src ? <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
        : <span className="grid h-full w-full place-items-center text-[10px] font-medium text-muted-foreground">{visual.kind === "picture" ? "—" : copy("Diagram", "مخطط")}</span>}
      <span className="absolute bottom-0.5 start-0.5 rounded bg-black/60 px-1 text-[10px] font-semibold text-white">{number}</span>
    </button>
  );
}
