import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  IdeaAttachmentType,
  IdeaInputSource,
  getGetSubjectQueryKey,
  getListIdeasQueryKey,
  getListSubjectsQueryKey,
  useCreateIdea,
  useExtractYoutubeTranscript,
} from "@workspace/api-client-react";
import {
  FileAudio,
  FileText,
  ImagePlus,
  Link2,
  Mic,
  PenTool,
  Send,
  Upload,
  Video,
  X,
} from "lucide-react";
import { useRecorder } from "@/components/recorder-provider";
import { VoiceCapture } from "@/components/voice-capture";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/i18n";

export type CaptureMode = "text" | "voice" | "media" | "link";
type Tab = CaptureMode;
type MediaAttachment = {
  type: "image" | "video" | "audio" | "pdf" | "document";
  url: string;
  name: string;
  mimeType?: string;
  note?: string;
};

export function CreateIdeaForm({
  subjectId,
  initialMode = "text",
  onBusyChange,
}: {
  subjectId: number;
  initialMode?: CaptureMode;
  onBusyChange?: (busy: boolean) => void;
}) {
  const draftKey = `idea-stream-capture-${subjectId}`;
  const [restored] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey) || "{}");
      return {
        content: typeof saved?.content === "string" ? saved.content : "",
        linkUrl: typeof saved?.linkUrl === "string" ? saved.linkUrl : "",
        linkNote: typeof saved?.linkNote === "string" ? saved.linkNote : "",
      };
    } catch {
      return {};
    }
  });
  const [activeTab, setActiveTab] = useState<Tab>(initialMode);
  const [content, setContent] = useState<string>(restored.content || "");
  const [linkUrl, setLinkUrl] = useState<string>(restored.linkUrl || "");
  const [linkNote, setLinkNote] = useState<string>(restored.linkNote || "");
  const [uploads, setUploads] = useState<MediaAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { language, isArabic, t } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const queryClient = useQueryClient();
  const createIdea = useCreateIdea();
  const extractTranscript = useExtractYoutubeTranscript();
  const [videoTranscript, setVideoTranscript] = useState("");
  const recorder = useRecorder();
  const busy = recorder.stage !== "idle" || isUploading || createIdea.isPending || extractTranscript.isPending;
  const [draftStored, setDraftStored] = useState(false);

  useEffect(() => {
    try {
      if (content || linkUrl || linkNote)
        localStorage.setItem(
          draftKey,
          JSON.stringify({ content, linkUrl, linkNote }),
        );
      else localStorage.removeItem(draftKey);
      setDraftStored(Boolean(content || linkUrl || linkNote));
    } catch {
      setDraftStored(false);
    }
  }, [content, linkUrl, linkNote, draftKey]);
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (busy) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const isYoutube = (() => {
    try {
      const url = new URL(linkUrl);
      return (
        ["https:", "http:"].includes(url.protocol) &&
        [
          "youtube.com",
          "www.youtube.com",
          "m.youtube.com",
          "youtu.be",
        ].includes(url.hostname)
      );
    } catch {
      return false;
    }
  })();

  const importTranscript = async () => {
    try {
      const result = await extractTranscript.mutateAsync({
        data: { url: linkUrl },
      });
      setVideoTranscript(result.text);
      setContent((current) =>
        current ? `${current}\n\n${result.text}` : result.text,
      );
      toast({
        title: copy(
          "Transcript added. Review it before saving.",
          "تمت إضافة النص. راجعه قبل الحفظ.",
        ),
      });
    } catch {
      toast({
        variant: "destructive",
        title: copy("Transcript unavailable", "النص غير متاح"),
        description: copy(
          "This video may not have accessible captions. You can still save the link and add your own notes or paste a transcript.",
          "قد لا يتوفر نص لهذا الفيديو. يمكنك حفظ الرابط وإضافة ملاحظاتك أو لصق النص.",
        ),
      });
    }
  };

  const reset = () => {
    setContent("");
    setLinkUrl("");
    setLinkNote("");
    setUploads([]);
    setVideoTranscript("");
  };

  const getAttachmentType = (file: File): MediaAttachment["type"] | null => {
    if (file.type.startsWith("image/")) return "image";
    if (file.type.startsWith("video/")) return "video";
    if (file.type.startsWith("audio/")) return "audio";
    if (
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf")
    )
      return "pdf";
    if (
      file.type.includes("word") ||
      file.type.includes("document") ||
      file.type.includes("text") ||
      /\.(docx?|txt|rtf|odt)$/i.test(file.name)
    )
      return "document";
    return null;
  };

  const uploadFile = async (
    file: File,
    attachmentType: MediaAttachment["type"],
  ): Promise<MediaAttachment> => {
    const request = await fetch("/api/storage/uploads/request-url", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: file.name,
        size: file.size,
        contentType: file.type || "application/octet-stream",
      }),
    });
    if (!request.ok) throw new Error("Upload URL failed");
    const { uploadURL, objectPath } = (await request.json()) as {
      uploadURL: string;
      objectPath: string;
    };
    const upload = await fetch(uploadURL, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!upload.ok) throw new Error("Upload failed");
    return {
      type: attachmentType,
      url: `/api/storage${objectPath}`,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
    };
  };

  const handleFiles = async (files?: FileList | null) => {
    if (!files?.length) return;
    const pendingFiles = Array.from(files);
    const invalid = pendingFiles.find((file) => !getAttachmentType(file));
    if (invalid) {
      toast({
        variant: "destructive",
        title: t("error"),
        description: t("mediaTypeError"),
      });
      return;
    }
    if (pendingFiles.some((file) => file.size > 100 * 1024 * 1024)) {
      toast({
        variant: "destructive",
        title: t("error"),
        description: t("mediaSizeError"),
      });
      return;
    }
    if (uploads.length + pendingFiles.length > 10) {
      toast({
        variant: "destructive",
        title: t("error"),
        description: t("uploadLimit"),
      });
      return;
    }

    setIsUploading(true);
    try {
      for (const file of pendingFiles) {
        const attachmentType = getAttachmentType(file)!;
        const completed = await uploadFile(file, attachmentType);
        setUploads((current) => [...current, completed]);
      }
    } catch {
      toast({
        variant: "destructive",
        title: t("error"),
        description: t("uploadFailed"),
      });
    } finally {
      setIsUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const saveIdea = () => {
    let source: (typeof IdeaInputSource)[keyof typeof IdeaInputSource] =
      IdeaInputSource.text;
    const attachments = [];
    if (uploads.length) {
      if (activeTab === "media") source = IdeaInputSource[uploads[0].type];
      attachments.push(
        ...uploads.map((upload) => ({
          type: IdeaAttachmentType[upload.type],
          url: upload.url,
          name: upload.name,
          mimeType: upload.mimeType,
          note: upload.note?.trim() || undefined,
        })),
      );
    }
    if (activeTab === "link" || linkUrl.trim()) {
      try {
        const url = new URL(linkUrl);
        if (!["https:", "http:"].includes(url.protocol))
          throw new Error("Invalid protocol");
        if (activeTab === "link") source = IdeaInputSource.link;
        attachments.push({
          type: IdeaAttachmentType.link,
          url: url.toString(),
          name: url.hostname,
          note: linkNote.trim() || undefined,
          transcript: videoTranscript || undefined,
        });
      } catch {
        toast({
          variant: "destructive",
          title: t("error"),
          description: t("invalidLink"),
        });
        return;
      }
    }
    const finalContent = content.trim() || (activeTab === "link" ? linkUrl : uploads.map(item => item.name).join(", "));
    if (!finalContent || (activeTab === "media" && !uploads.length)) return;

    createIdea.mutate(
      { subjectId, data: { content: finalContent, source, attachments } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getListIdeasQueryKey(subjectId),
          });
          queryClient.invalidateQueries({
            queryKey: getGetSubjectQueryKey(subjectId),
          });
          queryClient.invalidateQueries({
            queryKey: getListSubjectsQueryKey(),
          });
          toast({ title: t("fragmentAdded") });
          reset();
        },
        onError: () =>
          toast({
            variant: "destructive",
            title: t("error"),
            description: t("saveFragmentFailed"),
          }),
      },
    );
  };

  const tabs: Array<[Tab, typeof PenTool, string]> = [
    ["text", PenTool, t("type")],
    ["voice", Mic, t("voice")],
    ["media", ImagePlus, t("media")],
    ["link", Link2, t("links")],
  ];

  return (
    <Card className="overflow-hidden border-border bg-card/50 shadow-sm">
      <div className="grid grid-cols-4 border-b border-border/50">
        {tabs.map(([tab, Icon, label]) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            disabled={busy}
            aria-pressed={activeTab === tab}
            className={`flex items-center justify-center gap-1.5 px-1 py-3 text-[10px] sm:text-xs md:text-sm font-medium transition-colors ${activeTab === tab ? "border-b-2 border-primary bg-card text-foreground" : "bg-muted/30 text-muted-foreground hover:bg-muted/50"}`}
          >
            <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>

      <CardContent className="space-y-4 bg-card p-4 sm:p-6">
        {activeTab === "voice" ? (
          <VoiceCapture subjectId={subjectId} />
        ) : activeTab === "media" ? (
          <div className="rounded-lg border border-dashed p-4 sm:p-6 text-center bg-muted/10">
            <input
              ref={fileInput}
              className="hidden"
              type="file"
              multiple
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.rtf,.odt"
              onChange={(event) => handleFiles(event.target.files)}
            />
            {uploads.length > 0 && (
              <div className="mb-4 grid gap-2 text-start grid-cols-1 sm:grid-cols-2">
                {uploads.map((upload, index) => (
                  <div
                    key={`${upload.url}-${index}`}
                    className="rounded-lg border bg-background p-2.5 shadow-sm"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-primary">
                        {upload.type === "image" ? (
                          <img
                            src={upload.url}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : upload.type === "video" ? (
                          <Video className="h-5 w-5 sm:h-6 sm:w-6" />
                        ) : upload.type === "audio" ? (
                          <FileAudio className="h-5 w-5 sm:h-6 sm:w-6" />
                        ) : (
                          <FileText className="h-5 w-5 sm:h-6 sm:w-6" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {upload.name}
                        </p>
                        <p className="text-[10px] sm:text-xs uppercase text-muted-foreground">
                          {upload.type}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        aria-label={t("removeUpload")}
                        onClick={() =>
                          setUploads((current) =>
                            current.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          )
                        }
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <Input
                      value={upload.note ?? ""}
                      onChange={(event) =>
                        setUploads((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, note: event.target.value }
                              : item,
                          ),
                        )
                      }
                      placeholder={t("attachmentNotePlaceholder")}
                      className="mt-2 h-9 text-sm"
                    />
                  </div>
                ))}
              </div>
            )}
            <div>
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto h-11 sm:h-9"
                onClick={() => fileInput.current?.click()}
                disabled={isUploading}
              >
                <Upload className="me-2 h-4 w-4" />{" "}
                {isUploading
                  ? t("uploading")
                  : uploads.length
                    ? t("addMoreUploads")
                    : t("chooseMedia")}
              </Button>
              <p className="mt-3 sm:mt-2 text-xs text-muted-foreground">
                {t("supportedUploads")}
              </p>
            </div>
          </div>
        ) : activeTab === "link" ? (
          <div className="space-y-3">
            <Input
              type="url"
              aria-label={t("links")}
              value={linkUrl}
              disabled={busy}
              onChange={(event) => {
                setLinkUrl(event.target.value);
                setVideoTranscript("");
              }}
              placeholder={t("linkPlaceholder")}
              className="h-11 sm:h-9"
            />
            <Input
              value={linkNote}
              onChange={(event) => setLinkNote(event.target.value)}
              placeholder={t("attachmentNotePlaceholder")}
              className="h-11 sm:h-9"
            />
            <p className="text-xs text-muted-foreground">{t("linkHelp")}</p>
            {isYoutube && (
              <Button
                variant="outline"
                disabled={busy || !!videoTranscript}
                onClick={importTranscript}
              >
                <Video className="me-2 h-4 w-4" />
                {extractTranscript.isPending
                  ? copy("Getting captions…", "جارٍ جلب النص…")
                  : videoTranscript
                    ? copy("Transcript added", "تمت إضافة النص")
                    : copy("Get YouTube transcript", "جلب نص يوتيوب")}
              </Button>
            )}
          </div>
        ) : null}

        {activeTab !== "voice" && <>
        <Textarea
          aria-label={t("captureFragment")}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder={
            activeTab === "media"
                ? t("mediaCaption")
                : activeTab === "link"
                  ? t("linkCaption")
                  : t("thoughtPlaceholder")
          }
          className="min-h-[110px] resize-y bg-transparent text-base p-3 sm:p-4"
          disabled={busy}
        />
        {(uploads.length > 0 || linkUrl) && (
          <p className="text-xs text-muted-foreground">
            {copy(
              "Sources from all capture modes will be included when you save.",
              "ستُرفق المصادر من جميع أوضاع الإدخال عند الحفظ.",
            )}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[10px] text-muted-foreground" role="status">
            {draftStored
              ? copy(
                  "Text draft kept on this device",
                  "مسودة النص محفوظة على هذا الجهاز",
                )
              : copy("Small thoughts welcome.", "كل فكرة تستحق الحفظ.")}
          </span>
          <Button
            type="button"
            size="lg"
            className="w-full sm:w-auto sm:h-9 sm:px-4 sm:py-2"
            onClick={saveIdea}
            disabled={
              busy ||
              (activeTab === "text" && !content.trim()) ||
              (activeTab === "media" && !uploads.length) ||
              (activeTab === "link" && !linkUrl)
            }
          >
            <Send className="me-2 h-4 w-4" />
            {createIdea.isPending ? t("saving") : t("saveFragment")}
          </Button>
        </div>
        </>}
      </CardContent>
    </Card>
  );
}
