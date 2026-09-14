import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  type Idea,
  type IdeaAttachment,
  IdeaSource,
  useUpdateIdea,
  useDeleteIdea,
  getListIdeasQueryKey,
  getGetSubjectQueryKey,
  useListIdeas,
  useTranslateNote,
  useExtractYoutubeTranscript,
} from "@workspace/api-client-react";
import { formatTimeAgo } from "@/lib/formatters";
import { Edit3, Trash2, Mic, FileText, Check, X, Image as ImageIcon, Video, Link2, ExternalLink, FileAudio, FileType, Play, ChevronDown, ChevronUp, Languages, Loader2, Maximize2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useLanguage } from "@/lib/i18n";

interface IdeaListProps {
  subjectId: number;
  initialIdeas: Idea[];
}

function getYoutubeId(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname === "youtu.be") return url.pathname.slice(1).split("/")[0];
    if (url.hostname.includes("youtube.com")) {
      if (url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/embed/")) return url.pathname.split("/")[2];
      return url.searchParams.get("v");
    }
  } catch {
    return null;
  }
  return null;
}

function AttachmentCard({
  attachment,
  attachmentIndex,
  idea,
  subjectId,
}: {
  attachment: IdeaAttachment;
  attachmentIndex: number;
  idea: Idea;
  subjectId: number;
}) {
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [note, setNote] = useState(attachment.note ?? "");
  const [isExpanded, setIsExpanded] = useState(false);
  const [translation, setTranslation] = useState<{ text: string; language: "en" | "ar" } | null>(null);
  const [transcript, setTranscript] = useState(attachment.transcript ?? "");
  const [transcriptTranslation, setTranscriptTranslation] = useState<{ text: string; language: "en" | "ar" } | null>(null);
  const [isEditingTranscript, setIsEditingTranscript] = useState(false);
  const [isTranscriptExpanded, setIsTranscriptExpanded] = useState(false);
  const [isDocumentViewerOpen, setIsDocumentViewerOpen] = useState(false);
  const [documentViewerSize, setDocumentViewerSize] = useState<{ width: number; height: number } | null>(null);
  const queryClient = useQueryClient();
  const updateIdea = useUpdateIdea();
  const translateNote = useTranslateNote();
  const extractTranscript = useExtractYoutubeTranscript();
  const { toast } = useToast();
  const { t } = useLanguage();
  const youtubeId = attachment.type === "link" ? getYoutubeId(attachment.url) : null;
  const label = youtubeId ? "YouTube" : attachment.type;
  const canPreviewDocument = attachment.type === "pdf" || attachment.type === "document";
  const icon = attachment.type === "audio" ? <FileAudio className="h-7 w-7" /> :
    attachment.type === "pdf" ? <FileType className="h-7 w-7" /> :
    attachment.type === "document" ? <FileText className="h-7 w-7" /> :
    attachment.type === "video" ? <Video className="h-7 w-7" /> :
    attachment.type === "image" ? <ImageIcon className="h-7 w-7" /> :
    <Link2 className="h-7 w-7" />;

  const saveTranscript = (value: string) => {
    const attachments = idea.attachments.map((item, index) => index === attachmentIndex ? { ...item, transcript: value.trim() || undefined } : item);
    updateIdea.mutate(
      { ideaId: idea.id, data: { attachments } },
      {
        onSuccess: () => {
          setTranscript(value.trim());
          setIsEditingTranscript(false);
          queryClient.invalidateQueries({ queryKey: getListIdeasQueryKey(subjectId) });
          queryClient.invalidateQueries({ queryKey: getGetSubjectQueryKey(subjectId) });
          toast({ title: t("transcriptSaved") });
        },
        onError: () => toast({ variant: "destructive", title: t("error"), description: t("transcriptSaveFailed") }),
      },
    );
  };

  const startDocumentResize = (direction: string, event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const viewer = event.currentTarget.parentElement;
    if (!viewer) return;
    const rect = viewer.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const maxWidth = window.innerWidth * 0.95;
    const maxHeight = window.innerHeight * 0.95;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      const widthDelta = direction.includes("e") ? deltaX * 2 : direction.includes("w") ? -deltaX * 2 : 0;
      const heightDelta = direction.includes("s") ? deltaY * 2 : direction.includes("n") ? -deltaY * 2 : 0;
      setDocumentViewerSize({
        width: Math.min(maxWidth, Math.max(320, rect.width + widthDelta)),
        height: Math.min(maxHeight, Math.max(360, rect.height + heightDelta)),
      });
    };
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  return (
    <div className={youtubeId ? "grid items-start gap-3 sm:col-span-2 md:grid-cols-[minmax(0,1fr)_17rem] lg:col-span-3" : ""}>
      {youtubeId && (
        <div className="rounded-lg border bg-muted/10 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-primary">{t("videoTranscript")}</p>
            {transcript && !isEditingTranscript && (
              <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setIsEditingTranscript(true)}>{t("edit")}</Button>
            )}
          </div>
          {isEditingTranscript ? (
            <div className="space-y-2">
              <Textarea value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder={t("transcriptPlaceholderManual")} className="min-h-64 bg-background text-sm" />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => { setTranscript(attachment.transcript ?? ""); setIsEditingTranscript(false); }}>{t("cancel")}</Button>
                <Button type="button" size="sm" disabled={updateIdea.isPending} onClick={() => saveTranscript(transcript)}>{t("save")}</Button>
              </div>
            </div>
          ) : transcript ? (
            <>
              <p className={`whitespace-pre-wrap text-sm leading-relaxed ${isTranscriptExpanded ? "" : "line-clamp-[12]"}`}>{transcript}</p>
              {transcriptTranslation && (
                <div className="mt-3 rounded-md bg-primary/5 p-3" dir={transcriptTranslation.language === "ar" ? "rtl" : "ltr"}>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                    {transcriptTranslation.language === "ar" ? t("arabicTranslation") : t("englishTranslation")}
                  </p>
                  <p className={`whitespace-pre-wrap text-sm leading-relaxed ${isTranscriptExpanded ? "" : "line-clamp-[12]"}`}>{transcriptTranslation.text}</p>
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button type="button" variant="ghost" size="sm" className="h-9 sm:h-8 px-3 sm:px-2 text-xs text-primary" onClick={() => setIsTranscriptExpanded((value) => !value)}>
                  {isTranscriptExpanded ? <ChevronUp className="me-1 h-3.5 w-3.5" /> : <ChevronDown className="me-1 h-3.5 w-3.5" />}
                  {isTranscriptExpanded ? t("showLess") : t("showMore")}
                </Button>
                {(["ar", "en"] as const).map((targetLanguage) => (
                  <Button
                    key={targetLanguage}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 sm:h-8 px-3 sm:px-2 text-xs"
                    disabled={translateNote.isPending}
                    onClick={() => translateNote.mutate(
                      { data: { text: transcript, targetLanguage } },
                      {
                        onSuccess: (result) => {
                          setTranscriptTranslation(result);
                          setIsTranscriptExpanded(true);
                        },
                        onError: () => toast({ variant: "destructive", title: t("error"), description: t("transcriptTranslationFailed") }),
                      },
                    )}
                  >
                    {translateNote.isPending ? <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" /> : <Languages className="me-1 h-3.5 w-3.5" />}
                    {targetLanguage === "ar" ? t("translateArabic") : t("translateEnglish")}
                  </Button>
                ))}
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={extractTranscript.isPending || updateIdea.isPending}
                onClick={() => extractTranscript.mutate(
                  { data: { url: attachment.url } },
                  {
                    onSuccess: (result) => saveTranscript(result.text),
                    onError: () => {
                      setIsEditingTranscript(true);
                      toast({ variant: "destructive", title: t("transcriptUnavailable"), description: t("transcriptUnavailableDetail") });
                    },
                  },
                )}
              >
                {extractTranscript.isPending ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <FileText className="me-2 h-4 w-4" />}
                {extractTranscript.isPending ? t("extractingTranscript") : t("extractTranscript")}
              </Button>
              <Button type="button" variant="ghost" className="w-full text-primary" onClick={() => setIsEditingTranscript(true)}>
                {t("addTranscriptManually")}
              </Button>
              <p className="text-center text-xs text-muted-foreground">{t("transcriptOptionsHelp")}</p>
            </div>
          )}
        </div>
      )}
      <div className="overflow-hidden rounded-lg border bg-muted/15">
      {canPreviewDocument ? (
        <button type="button" onClick={() => setIsDocumentViewerOpen(true)} className="group/attachment block w-full text-start">
          <div className="relative flex h-32 items-center justify-center overflow-hidden bg-muted">
            <div className="text-primary">{icon}</div>
          </div>
          <div className="flex items-center gap-2 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{attachment.name}</p>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
            </div>
            <Maximize2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          </div>
        </button>
      ) : (
      <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="group/attachment block">
        <div className="relative flex h-32 items-center justify-center overflow-hidden bg-muted">
          {attachment.type === "image" ? (
            <img src={attachment.url} alt={attachment.name} className="h-full w-full object-cover transition-transform group-hover/attachment:scale-105" />
          ) : youtubeId ? (
            <>
              <img src={`https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`} alt={attachment.name} className="h-full w-full object-cover" />
              <span className="absolute rounded-full bg-red-600 p-2 text-white"><Play className="h-5 w-5 fill-current" /></span>
            </>
          ) : (
            <div className="text-primary">{icon}</div>
          )}
        </div>
        <div className="flex items-center gap-2 p-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{attachment.name}</p>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          </div>
          <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
        </div>
      </a>
      )}
      {canPreviewDocument && (
        <Dialog open={isDocumentViewerOpen} onOpenChange={(open) => { setIsDocumentViewerOpen(open); if (!open) setDocumentViewerSize(null); }}>
          <DialogContent
            className="flex h-[100dvh] w-[100vw] max-w-none sm:h-[85vh] sm:min-h-[360px] sm:max-h-[95vh] sm:w-[85vw] sm:min-w-[320px] sm:max-w-[95vw] flex-col gap-3 overflow-hidden p-3 sm:p-4 rounded-none sm:rounded-xl border-0 sm:border"
            style={documentViewerSize ?? undefined}
          >
            <div onPointerDown={(event) => startDocumentResize("n", event)} className="hidden sm:block absolute inset-x-3 top-0 z-20 h-2 cursor-n-resize touch-none" />
            <div onPointerDown={(event) => startDocumentResize("s", event)} className="hidden sm:block absolute inset-x-3 bottom-0 z-20 h-2 cursor-s-resize touch-none" />
            <div onPointerDown={(event) => startDocumentResize("w", event)} className="hidden sm:block absolute inset-y-3 left-0 z-20 w-2 cursor-w-resize touch-none" />
            <div onPointerDown={(event) => startDocumentResize("e", event)} className="hidden sm:block absolute inset-y-3 right-0 z-20 w-2 cursor-e-resize touch-none" />
            <div onPointerDown={(event) => startDocumentResize("nw", event)} className="hidden sm:block absolute left-0 top-0 z-30 h-4 w-4 cursor-nw-resize touch-none" />
            <div onPointerDown={(event) => startDocumentResize("ne", event)} className="hidden sm:block absolute right-0 top-0 z-30 h-4 w-4 cursor-ne-resize touch-none" />
            <div onPointerDown={(event) => startDocumentResize("sw", event)} className="hidden sm:block absolute bottom-0 left-0 z-30 h-4 w-4 cursor-sw-resize touch-none" />
            <div onPointerDown={(event) => startDocumentResize("se", event)} className="hidden sm:block absolute bottom-0 right-0 z-30 h-4 w-4 cursor-se-resize touch-none" />
            <DialogHeader className="shrink-0 pe-8 text-start mt-8 sm:mt-0">
              <DialogTitle className="truncate text-lg">{attachment.name}</DialogTitle>
              <DialogDescription className="text-xs sm:text-sm">{t("documentPreviewHelp")}</DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-white">
              <iframe
                src={attachment.url}
                title={attachment.name}
                className="h-full min-h-0 sm:min-h-[600px] w-full min-w-0 sm:min-w-[700px] border-0"
              />
            </div>
            <div className="flex shrink-0 justify-end mb-2 sm:mb-0">
              <Button asChild type="button" variant="outline" size="sm" className="w-full sm:w-auto h-11 sm:h-9">
                <a href={attachment.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="me-2 h-4 w-4" />
                  {t("openInNewTab")}
                </a>
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {attachment.type === "audio" && (
        <div className="border-t px-2 py-2"><audio src={attachment.url} controls preload="metadata" className="h-9 w-full" /></div>
      )}
      <div className="border-t p-3">
        {isEditingNote ? (
          <div className="space-y-2">
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("attachmentNotePlaceholder")} className="min-h-20 bg-background text-sm" autoFocus />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => { setNote(attachment.note ?? ""); setIsEditingNote(false); }}>{t("cancel")}</Button>
              <Button
                type="button"
                size="sm"
                disabled={updateIdea.isPending}
                onClick={() => {
                  const attachments = idea.attachments.map((item, index) => index === attachmentIndex ? { ...item, note: note.trim() || undefined } : item);
                  updateIdea.mutate(
                    { ideaId: idea.id, data: { attachments } },
                    {
                      onSuccess: () => {
                        queryClient.invalidateQueries({ queryKey: getListIdeasQueryKey(subjectId) });
                        queryClient.invalidateQueries({ queryKey: getGetSubjectQueryKey(subjectId) });
                        setIsEditingNote(false);
                        toast({ title: t("noteSaved") });
                      },
                      onError: () => toast({ variant: "destructive", title: t("error"), description: t("noteSaveFailed") }),
                    },
                  );
                }}
              >
                {t("save")}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            {attachment.note ? (
              <>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("attachmentNote")}</p>
                <p className={`whitespace-pre-wrap text-sm ${isExpanded ? "" : "line-clamp-3"}`}>{attachment.note}</p>
                {translation && (
                  <div className="mt-3 rounded-md bg-primary/5 p-2" dir={translation.language === "ar" ? "rtl" : "ltr"}>
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-primary">{translation.language === "ar" ? t("arabicTranslation") : t("englishTranslation")}</p>
                    <p className={`whitespace-pre-wrap text-sm ${isExpanded ? "" : "line-clamp-3"}`}>{translation.text}</p>
                  </div>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button type="button" variant="ghost" size="sm" className="h-9 sm:h-8 px-3 sm:px-2 text-xs" onClick={() => setIsExpanded((value) => !value)}>
                    {isExpanded ? <ChevronUp className="me-1 h-3.5 w-3.5" /> : <ChevronDown className="me-1 h-3.5 w-3.5" />}
                    {isExpanded ? t("showLess") : t("showMore")}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-9 sm:h-8 px-3 sm:px-2 text-xs" onClick={() => setIsEditingNote(true)}>
                    {t("editAttachmentNote")}
                  </Button>
                  {(["ar", "en"] as const).map((targetLanguage) => (
                    <Button
                      key={targetLanguage}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 sm:h-8 px-3 sm:px-2 text-xs"
                      disabled={translateNote.isPending}
                      onClick={() => translateNote.mutate(
                        { data: { text: attachment.note!, targetLanguage } },
                        {
                          onSuccess: (result) => { setTranslation(result); setIsExpanded(true); },
                          onError: () => toast({ variant: "destructive", title: t("error"), description: t("translationFailed") }),
                        },
                      )}
                    >
                      {translateNote.isPending ? <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" /> : <Languages className="me-1 h-3.5 w-3.5" />}
                      {targetLanguage === "ar" ? t("translateArabic") : t("translateEnglish")}
                    </Button>
                  ))}
                </div>
              </>
            ) : (
              <button type="button" onClick={() => setIsEditingNote(true)} className="w-full text-start text-sm font-medium text-primary">+ {t("addAttachmentNote")}</button>
            )}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

export function IdeaList({ subjectId, initialIdeas }: IdeaListProps) {
  const { t } = useLanguage();
  const { data: latestIdeas, isLoading } = useListIdeas(subjectId);
  const ideas = latestIdeas || initialIdeas;
  
  if (isLoading && !ideas.length) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <Skeleton key={i} className="h-32 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (!ideas.length) {
    return (
      <div className="py-16 px-4 text-center border-2 border-dashed border-border rounded-xl">
        <div className="mx-auto w-12 h-12 bg-muted/50 rounded-full flex items-center justify-center mb-4">
          <FileText className="h-6 w-6 text-muted-foreground/50" />
        </div>
        <p className="text-lg font-serif text-muted-foreground mb-1">{t("emptyStream")}</p>
        <p className="text-sm text-muted-foreground/70">
          {t("emptyStreamDetail")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 relative before:absolute before:inset-y-0 before:start-[1.125rem] sm:before:start-6 before:w-px before:bg-border/60 ms-0 ps-10 sm:ps-14">
      {ideas.map((idea) => (
        <IdeaItem key={idea.id} idea={idea} subjectId={subjectId} />
      ))}
    </div>
  );
}

function IdeaItem({ idea, subjectId }: { idea: Idea; subjectId: number }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(idea.content);
  const [isContentExpanded, setIsContentExpanded] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { language, t } = useLanguage();
  
  const updateIdea = useUpdateIdea();
  const deleteIdea = useDeleteIdea();

  const handleSave = () => {
    if (!editContent.trim() || editContent === idea.content) {
      setIsEditing(false);
      return;
    }

    updateIdea.mutate(
      { ideaId: idea.id, data: { content: editContent } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListIdeasQueryKey(subjectId) });
          setIsEditing(false);
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: t("error"),
            description: t("editFailed"),
          });
        }
      }
    );
  };

  const handleDelete = () => {
    deleteIdea.mutate(
      { ideaId: idea.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListIdeasQueryKey(subjectId) });
          queryClient.invalidateQueries({ queryKey: getGetSubjectQueryKey(subjectId) });
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: t("error"),
            description: t("deleteFailed"),
          });
        }
      }
    );
  };

  return (
    <div className="relative group">
      {/* Timeline dot */}
      <div className="absolute -start-[1.375rem] sm:-start-8 top-5 w-3 h-3 rounded-full bg-background border-2 border-primary ring-4 ring-background z-10" />
      
      <div className="bg-card rounded-xl border border-border/60 p-4 sm:p-5 shadow-sm hover:shadow-md transition-shadow group-hover:border-primary/20">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 bg-muted/50 px-2 py-0.5 rounded-md">
              {idea.source === IdeaSource.voice ? <Mic className="h-3 w-3" /> :
                idea.source === IdeaSource.image ? <ImageIcon className="h-3 w-3" /> :
                idea.source === IdeaSource.video ? <Video className="h-3 w-3" /> :
                idea.source === IdeaSource.audio ? <FileAudio className="h-3 w-3" /> :
                idea.source === IdeaSource.pdf ? <FileType className="h-3 w-3" /> :
                idea.source === IdeaSource.document ? <FileText className="h-3 w-3" /> :
                idea.source === IdeaSource.link ? <Link2 className="h-3 w-3" /> :
                <FileText className="h-3 w-3" />}
              {idea.source === IdeaSource.voice ? t("voiceNote") :
                idea.source === IdeaSource.image ? t("imageNote") :
                idea.source === IdeaSource.video ? t("videoNote") :
                idea.source === IdeaSource.audio ? t("audioNote") :
                idea.source === IdeaSource.pdf ? t("pdfNote") :
                idea.source === IdeaSource.document ? t("documentNote") :
                idea.source === IdeaSource.link ? t("linkNote") :
                t("textNote")}
            </span>
            <span className="text-xs text-muted-foreground/60">•</span>
            <span className="text-xs text-muted-foreground/80">{formatTimeAgo(idea.createdAt, language)}</span>
          </div>
          
          {!isEditing && (
            <div className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex items-center gap-1 mt-1 sm:mt-0">
              <Button variant="ghost" size="icon" className="h-9 w-9 sm:h-8 sm:w-8 text-muted-foreground hover:text-foreground" onClick={() => setIsEditing(true)}>
                <Edit3 className="h-4 w-4" />
              </Button>
              
              <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9 sm:h-8 sm:w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="w-[95vw] sm:w-full max-w-md rounded-xl">
                  <DialogHeader>
                    <DialogTitle>{t("deleteFragment")}</DialogTitle>
                    <DialogDescription>
                      {t("deleteFragmentConfirm")}
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter className="gap-2 sm:gap-0 mt-4 sm:mt-0">
                    <Button variant="outline" className="w-full sm:w-auto" onClick={() => setIsDeleteDialogOpen(false)}>{t("cancel")}</Button>
                    <Button variant="destructive" className="w-full sm:w-auto" onClick={handleDelete} disabled={deleteIdea.isPending}>
                      {deleteIdea.isPending ? t("deleting") : t("delete")}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </div>
        
        {idea.attachments.length > 0 && !isEditing && (
          <div className="mb-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("attachedUploads")} ({idea.attachments.length})</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {idea.attachments.map((attachment, index) => (
              <AttachmentCard key={`${attachment.url}-${index}`} attachment={attachment} attachmentIndex={index} idea={idea} subjectId={subjectId} />
            ))}
            </div>
          </div>
        )}

        {isEditing ? (
          <div className="space-y-3 mt-2">
            <Textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="min-h-[100px] resize-y bg-background font-serif text-base focus-visible:ring-primary/20"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
                <X className="h-4 w-4 me-1.5" /> {t("cancel")}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={updateIdea.isPending}>
                <Check className="h-4 w-4 me-1.5" /> {t("save")}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <div className={`prose prose-sm max-w-none text-foreground font-serif leading-relaxed text-[1.05rem] ${isContentExpanded ? "" : "line-clamp-4"}`}>
              {idea.content.split('\n').map((paragraph, i) => (
                paragraph ? <p key={i} className="mb-2 last:mb-0">{paragraph}</p> : <br key={i} />
              ))}
            </div>
            {(idea.content.length > 220 || idea.content.split("\n").length > 4) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2 h-8 px-2 text-xs text-primary"
                onClick={() => setIsContentExpanded((value) => !value)}
              >
                {isContentExpanded ? <ChevronUp className="me-1 h-3.5 w-3.5" /> : <ChevronDown className="me-1 h-3.5 w-3.5" />}
                {isContentExpanded ? t("collapseDetails") : t("expandDetails")}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
