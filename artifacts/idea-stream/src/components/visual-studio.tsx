import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  deleteVisual,
  getListCompilationVisualsQueryKey,
  planCompilationVisuals,
  redoVisual,
  restoreVisual,
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
import { PICTURE_STYLES as STYLES, VISUAL_KINDS as KINDS, VisualCard, type RedoOptions } from "@/components/visual-card";
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

const AUDIENCES: Array<[string, string, string]> = [["kids", "Children", "أطفال"], ["students", "Students", "طلاب"], ["adults", "Adults", "بالغون"], ["experts", "Experts", "متخصصون"]];
const PREFS_KEY = "idea-stream-visual-prefs";
type Prefs = { kinds: Kind[]; style: string; audience: string; palette: Palette; count: number; language: "auto" | "ar" | "en" };
const DEFAULT_PREFS: Prefs = { kinds: ["picture", "concept", "steps", "facts", "chart"], style: "illustration", audience: "students", palette: "bright", count: 4, language: "auto" };
function readPrefs(): Prefs {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") }; } catch { return DEFAULT_PREFS; }
}
const errorText = (error: unknown, fallback: string) => (error as { data?: { error?: string } })?.data?.error ?? fallback;

/**
 * Turns a draft into visuals: the AI reads it and suggests pictures (drawn in the chosen style) and
 * diagrams (drawn exactly by the app). Each can be changed, downloaded, or added to the draft after
 * the paragraph it explains, so it goes into Read, PDF and Word too.
 */
export function VisualStudio({ open, onOpenChange, compilationId, content, saveContent, onDraftChanged }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  compilationId: number;
  content: string;
  /** Saves the draft with visuals added or removed (rich text with its marker). */
  saveContent: (html: string) => Promise<void>;
  /** The server changed the draft (a retouched picture took the old one's place): load it again. */
  onDraftChanged: () => void;
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
  const setVisual = (saved: Visual) => queryClient.setQueryData<Visual[]>(key, (old) => old?.map((one) => (one.id === saved.id ? saved : one)));
  /** A diagram in the draft shows its new version in the same place (the server swaps pictures when they're drawn). */
  async function replaceDiagramInDraft(before: Visual, after: Visual) {
    if (after.kind === "picture" || !before.imageUrl || !hasVisual(html, shownUrl(before.imageUrl))) return;
    const url = await pictureUrl(after);
    await saveContent(insertVisual(removeVisual(html, shownUrl(before.imageUrl)), { url: shownUrl(url), title: after.title, caption: after.caption, anchor: after.anchor }));
  }
  const redo = async (visual: Visual, options: RedoOptions) => {
    let ok = false;
    await busyWith(visual.id, async () => {
      try {
        const saved = await redoVisual(visual.id, options);
        setVisual(saved);
        await replaceDiagramInDraft(visual, saved);
        if (saved.kind === "picture")
          toast({ title: (options.mode === "retouch" ? copy("Retouching your picture… about a minute.", "جارٍ تعديل صورتك… نحو دقيقة.") : copy("Drawing it again… about a minute.", "جارٍ الرسم من جديد… نحو دقيقة."))
            + (inDraft(visual) ? copy(" The draft gets the new version when it's ready.", " وستأخذ المسودة النسخة الجديدة عندما تجهز.") : "") });
        ok = true;
      } catch (error) { toast({ variant: "destructive", title: errorText(error, copy("It couldn't be changed.", "تعذر التعديل.")) }); }
    });
    return ok;
  };
  const restore = (visual: Visual, version: number) => busyWith(visual.id, async () => {
    try {
      const saved = await restoreVisual(visual.id, { version });
      setVisual(saved);
      if (saved.kind === "picture") onDraftChanged(); else await replaceDiagramInDraft(visual, saved);
      toast({ title: copy(`Back to version ${version + 1}. The one you had is kept as a version too.`, `رجعت إلى النسخة ${version + 1}. والنسخة التي كانت محفوظة أيضًا.`) });
    } catch (error) { toast({ variant: "destructive", title: errorText(error, copy("It couldn't go back.", "تعذر الرجوع.")) }); }
  });
  // When a picture finishes drawing, the server may have put it in the draft in place of the old one.
  const statuses = useRef(new Map<number, string>());
  useEffect(() => {
    let finished = false;
    for (const visual of visuals) {
      if (statuses.current.get(visual.id) === "drawing" && visual.status !== "drawing") finished = true;
      statuses.current.set(visual.id, visual.status);
    }
    if (finished) onDraftChanged();
  }, [visuals]); // eslint-disable-line react-hooks/exhaustive-deps
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
                      <button key={item.kind} type="button" onClick={() => toggleKind(item.kind)} aria-pressed={prefs.kinds.includes(item.kind)} title={copy(item.hint[0], item.hint[1])} className={chip(prefs.kinds.includes(item.kind))}>
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
                    onAdd={() => void addOne(visual)} onRemoveFromDraft={() => void takeOut(visual)} onRedo={(options) => redo(visual, options)} onRestore={(version) => void restore(visual, version)}
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
