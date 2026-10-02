import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Inbox, Link2, Loader2, Mic, WifiOff } from "lucide-react";
import {
  createIdea,
  IdeaAttachmentType,
  IdeaInputSource,
  useListSubjects,
} from "@workspace/api-client-react";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { ToastAction } from "@/components/ui/toast";
import { useRecorder } from "@/components/recorder-provider";
import { buzz, usePressToTalk } from "@/components/press-to-talk";
import { useToast } from "@/hooks/use-toast";
import { ensureInboxId, fileableSubjects } from "@/lib/inbox";
import { useLanguage } from "@/lib/i18n";
import { useRecorderPrefs } from "@/lib/recorder-prefs";

export const OPEN_CAPTURE_EVENT = "idea-stream:capture";
export const openCapture = () => window.dispatchEvent(new Event(OPEN_CAPTURE_EVENT));

const DRAFT_KEY = "idea-stream-capture-draft";
const URL_PATTERN = /https?:\/\/[^\s<>"']+/i;

const readDraft = () => { try { return localStorage.getItem(DRAFT_KEY) || ""; } catch { return ""; } };
const writeDraft = (value: string) => {
  try { if (value) localStorage.setItem(DRAFT_KEY, value); else localStorage.removeItem(DRAFT_KEY); } catch { /* optional */ }
};

/** "+" panel: type or hold to talk, tap a subject, save. Works from every page. */
export function CaptureSheet() {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const [location, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: subjects = [] } = useListSubjects();
  const { start, stage, ready, rescue, online } = useRecorder();
  const [prefs, setPrefs] = useRecorderPrefs();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(readDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);

  const choices = fileableSubjects(subjects);
  const notebook = Number(location.match(/^\/subjects\/(\d+)/)?.[1]) || null;
  const remembered = prefs.subjectId !== null && choices.some((subject) => subject.id === prefs.subjectId) ? prefs.subjectId : null;
  const [picked, setPicked] = useState<number | null | undefined>(undefined);
  const subjectId = picked !== undefined ? picked : notebook && choices.some((s) => s.id === notebook) ? notebook : remembered;
  const subjectTitle = subjectId === null ? copy("Idea inbox", "صندوق الأفكار") : choices.find((s) => s.id === subjectId)?.title ?? "";
  const link = text.match(URL_PATTERN)?.[0]?.replace(/[).,;!?]+$/, "") ?? null;

  useEffect(() => {
    const show = () => { setPicked(undefined); setError(""); setOpen(true); };
    window.addEventListener(OPEN_CAPTURE_EVENT, show);
    return () => window.removeEventListener(OPEN_CAPTURE_EVENT, show);
  }, []);
  useEffect(() => { writeDraft(text); }, [text]);

  const choose = (id: number | null) => {
    setPicked(id);
    setPrefs({ subjectId: id });
    buzz(8);
  };

  const talk = usePressToTalk({
    disabled: !ready || !!rescue || stage !== "idle",
    onTap: () => {
      setOpen(false);
      void start(subjectId, prefs.limit, { language: prefs.language, autoTranscribe: prefs.autoTranscribe });
    },
    onHoldStart: () => {
      setOpen(false);
      void start(subjectId, prefs.limit, { language: prefs.language, autoTranscribe: prefs.autoTranscribe, hold: true });
    },
  });

  async function save() {
    const content = text.trim();
    if (!content || saving) return;
    setSaving(true);
    setError("");
    try {
      const target = subjectId ?? await ensureInboxId(subjects, isArabic);
      const url = link && (() => { try { return new URL(link).toString(); } catch { return null; } })();
      const idea = await createIdea(target, {
        content,
        source: url && content === link ? IdeaInputSource.link : IdeaInputSource.text,
        attachments: url ? [{ type: IdeaAttachmentType.link, url, name: new URL(url).hostname.replace(/^www\./, "") }] : [],
      });
      buzz([10, 30, 10]);
      setText("");
      setOpen(false);
      void queryClient.invalidateQueries();
      toast({
        title: copy(`Saved to “${subjectTitle}”`, `حُفظت في «${subjectTitle}»`),
        action: (
          <ToastAction altText={copy("Open", "فتح")} onClick={() => navigate(`/subjects/${idea.subjectId}#idea-${idea.id}`)}>
            {copy("Open", "فتح")}
          </ToastAction>
        ),
      });
    } catch {
      setError(copy("Couldn't save. Your text is kept here; try again when you're connected.", "تعذر الحفظ. نصك محفوظ هنا؛ حاول مجددًا عند الاتصال."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={open} onOpenChange={setOpen} repositionInputs={false}>
      <DrawerContent
        className="mx-auto max-h-[92dvh] max-w-xl rounded-t-[1.75rem] border-x-0 px-0 sm:border-x"
        onOpenAutoFocus={(event) => { event.preventDefault(); setTimeout(() => field.current?.focus(), 150); }}
      >
        <DrawerTitle className="sr-only">{copy("New idea", "فكرة جديدة")}</DrawerTitle>
        <DrawerDescription className="sr-only">{copy("Type or hold the microphone to talk, choose a subject, and save.", "اكتب أو اضغط مطولًا على الميكروفون للتحدث، اختر موضوعًا، واحفظ.")}</DrawerDescription>
        <div className="flex min-h-0 flex-col overflow-y-auto px-5 pb-4 pt-3" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
          <textarea
            ref={field}
            data-bare-field
            dir="auto"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(); } }}
            placeholder={copy("What's on your mind?", "ما الذي يدور في ذهنك؟")}
            aria-label={copy("Your idea", "فكرتك")}
            rows={4}
            className="min-h-28 w-full resize-none bg-transparent font-serif text-xl leading-8 outline-none placeholder:text-muted-foreground/70"
          />
          {link && (
            <p className="mb-2 inline-flex max-w-full items-center gap-2 self-start rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
              <Link2 size={14} className="shrink-0" />
              <span className="truncate">{copy("Link will be attached", "سيُرفق الرابط")} · {link.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)}</span>
            </p>
          )}

          <p className="mb-2 mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{copy("Save to", "احفظ في")}</p>
          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]" role="radiogroup" aria-label={copy("Subject", "الموضوع")}>
            {[{ id: null as number | null, title: copy("Inbox", "الصندوق") }, ...choices].map((subject) => {
              const current = subject.id === subjectId;
              return (
                <button
                  key={subject.id ?? "inbox"}
                  ref={current ? (element) => element?.scrollIntoView({ block: "nearest", inline: "nearest" }) : undefined}
                  type="button"
                  role="radio"
                  aria-checked={current}
                  onClick={() => choose(subject.id)}
                  className={`inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition active:scale-95 ${
                    current ? "border-primary bg-primary text-primary-foreground shadow-sm" : "bg-background text-foreground hover:border-primary/40"
                  }`}
                >
                  {current ? <Check size={14} /> : subject.id === null ? <Inbox size={14} /> : null}
                  {subject.title}
                </button>
              );
            })}
          </div>

          {error && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" role="alert">{error}</p>}
          {!online && (
            <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground"><WifiOff size={14} />
              {copy("Offline. Voice notes still save on this phone; typed text is kept as a draft.", "غير متصل. الملاحظات الصوتية تُحفظ على الهاتف؛ والنص يبقى كمسودة.")}
            </p>
          )}

          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              {...talk}
              disabled={!ready || !!rescue || stage !== "idle"}
              aria-label={copy("Record: tap for a long note, or hold to talk and release to save", "سجّل: اضغط لتسجيل طويل، أو اضغط مطولًا وتحدث ثم اترك للحفظ")}
              className="group flex h-14 shrink-0 touch-none select-none items-center gap-2.5 rounded-full border-2 border-red-500/80 bg-red-50 ps-2 pe-4 text-red-700 transition active:scale-95 active:bg-red-100 disabled:opacity-50 dark:bg-red-950/30 dark:text-red-300 [-webkit-touch-callout:none]"
            >
              <span className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-rose-400 to-red-600 text-white shadow-md shadow-red-500/30">
                <Mic size={20} />
              </span>
              <span className="text-start leading-tight">
                <span className="block text-sm font-semibold">{copy("Hold to talk", "اضغط وتحدث")}</span>
                <span className="block text-[11px] opacity-75">{copy("tap for longer", "أو انقر لتسجيل أطول")}</span>
              </span>
            </button>
            <Button
              className="h-14 min-w-0 flex-1 rounded-full text-base shadow-md shadow-primary/20"
              disabled={!text.trim() || saving || !online}
              onClick={() => void save()}
            >
              {saving ? <Loader2 size={18} className="me-2 animate-spin" /> : <Check size={18} className="me-2" />}
              <span className="truncate">{copy(`Save to ${subjectTitle}`, `احفظ في ${subjectTitle}`)}</span>
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
