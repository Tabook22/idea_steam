import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  IdeaAttachmentType,
  IdeaInputSource,
  getGetSubjectQueryKey,
  getListIdeasQueryKey,
  useCreateIdea,
  useTranscribeAudio,
} from "@workspace/api-client-react";
import { AlertCircle, FileAudio, FileText, ImagePlus, Link2, Mic, PenTool, Send, Square, Upload, Video, X } from "lucide-react";
import { useAudioRecorder } from "@/hooks/use-audio-recorder";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/i18n";

type Tab = "text" | "voice" | "media" | "link";
type MediaAttachment = {
  type: "image" | "video" | "audio" | "pdf" | "document";
  url: string;
  name: string;
  mimeType?: string;
  note?: string;
};

export function CreateIdeaForm({ subjectId }: { subjectId: number }) {
  const [activeTab, setActiveTab] = useState<Tab>("text");
  const [content, setContent] = useState("");
  const [transcript, setTranscript] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkNote, setLinkNote] = useState("");
  const [uploads, setUploads] = useState<MediaAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { language, t } = useLanguage();
  const queryClient = useQueryClient();
  const createIdea = useCreateIdea();
  const transcribeAudio = useTranscribeAudio();
  const { isRecording, isSupported, startRecording, stopRecording } = useAudioRecorder();

  const reset = () => {
    setContent("");
    setTranscript("");
    setLinkUrl("");
    setLinkNote("");
    setUploads([]);
  };

  const blobToBase64 = async (blob: Blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    return btoa(binary);
  };

  const handleStartRecording = async () => {
    reset();
    try {
      await startRecording();
    } catch {
      toast({ variant: "destructive", title: t("error"), description: t("microphoneFailed") });
    }
  };

  const handleStopRecording = async () => {
    try {
      const audio = await stopRecording();
      const result = await transcribeAudio.mutateAsync({
        data: { audioBase64: await blobToBase64(audio), mimeType: audio.type || "audio/webm", language },
      });
      setTranscript(result.text);
      setContent(result.text);
    } catch {
      toast({ variant: "destructive", title: t("error"), description: t("transcriptionFailed") });
    }
  };

  const getAttachmentType = (file: File): MediaAttachment["type"] | null => {
    if (file.type.startsWith("image/")) return "image";
    if (file.type.startsWith("video/")) return "video";
    if (file.type.startsWith("audio/")) return "audio";
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return "pdf";
    if (
      file.type.includes("word") ||
      file.type.includes("document") ||
      file.type.includes("text") ||
      /\.(docx?|txt|rtf|odt)$/i.test(file.name)
    ) return "document";
    return null;
  };

  const handleFiles = async (files?: FileList | null) => {
    if (!files?.length) return;
    const pendingFiles = Array.from(files);
    const invalid = pendingFiles.find((file) => !getAttachmentType(file));
    if (invalid) {
      toast({ variant: "destructive", title: t("error"), description: t("mediaTypeError") });
      return;
    }
    if (pendingFiles.some((file) => file.size > 100 * 1024 * 1024)) {
      toast({ variant: "destructive", title: t("error"), description: t("mediaSizeError") });
      return;
    }
    if (uploads.length + pendingFiles.length > 10) {
      toast({ variant: "destructive", title: t("error"), description: t("uploadLimit") });
      return;
    }

    setIsUploading(true);
    try {
      const completed: MediaAttachment[] = [];
      for (const file of pendingFiles) {
        const attachmentType = getAttachmentType(file)!;
        const request = await fetch("/api/storage/uploads/request-url", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || "application/octet-stream" }),
        });
        if (!request.ok) throw new Error("Upload URL failed");
        const { uploadURL, objectPath } = await request.json() as { uploadURL: string; objectPath: string };
        const upload = await fetch(uploadURL, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!upload.ok) throw new Error("Upload failed");
        completed.push({
          type: attachmentType,
          url: `/api/storage${objectPath}`,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
        });
      }
      setUploads((current) => [...current, ...completed]);
      if (!content && completed.length) setContent(completed.map((item) => item.name).join(", "));
    } catch {
      toast({ variant: "destructive", title: t("error"), description: t("uploadFailed") });
    } finally {
      setIsUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const saveIdea = () => {
    let source: (typeof IdeaInputSource)[keyof typeof IdeaInputSource] = IdeaInputSource.text;
    const attachments = [];
    if (activeTab === "voice") source = IdeaInputSource.voice;
    if (activeTab === "media" && uploads.length) {
      source = IdeaInputSource[uploads[0].type];
      attachments.push(...uploads.map((upload) => ({
        type: IdeaAttachmentType[upload.type],
        url: upload.url,
        name: upload.name,
        mimeType: upload.mimeType,
          note: upload.note?.trim() || undefined,
      })));
    }
    if (activeTab === "link") {
      try {
        const url = new URL(linkUrl);
        source = IdeaInputSource.link;
        attachments.push({ type: IdeaAttachmentType.link, url: url.toString(), name: url.hostname, note: linkNote.trim() || undefined });
      } catch {
        toast({ variant: "destructive", title: t("error"), description: t("invalidLink") });
        return;
      }
    }
    const finalContent = content.trim() || (activeTab === "link" ? linkUrl : uploads.map((item) => item.name).join(", "));
    if (!finalContent || (activeTab === "media" && !uploads.length)) return;

    createIdea.mutate(
      { subjectId, data: { content: finalContent, source, attachments } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListIdeasQueryKey(subjectId) });
          queryClient.invalidateQueries({ queryKey: getGetSubjectQueryKey(subjectId) });
          toast({ title: t("fragmentAdded") });
          reset();
        },
        onError: () => toast({ variant: "destructive", title: t("error"), description: t("saveFragmentFailed") }),
      },
    );
  };

  const tabs: Array<[Tab, typeof PenTool, string]> = [
    ["text", PenTool, t("type")],
    ["voice", Mic, t("voice")],
    ["media", ImagePlus, t("media")],
    ["link", Link2, t("links")],
  ];

  const busy = isRecording || transcribeAudio.isPending || isUploading || createIdea.isPending;

  return (
    <Card className="overflow-hidden border-border bg-card/50 shadow-sm">
      <div className="grid grid-cols-4 border-b border-border/50">
        {tabs.map(([tab, Icon, label]) => (
          <button
            key={tab}
            type="button"
            onClick={() => { setActiveTab(tab); reset(); }}
            className={`flex items-center justify-center gap-1.5 px-1 py-3 text-[10px] sm:text-xs md:text-sm font-medium transition-colors ${activeTab === tab ? "border-b-2 border-primary bg-card text-foreground" : "bg-muted/30 text-muted-foreground hover:bg-muted/50"}`}
          >
            <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" /> 
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>

      <CardContent className="space-y-4 bg-card p-4 sm:p-6">
        {activeTab === "voice" && !isSupported ? (
          <div className="flex flex-col items-center rounded-lg border border-destructive/20 bg-destructive/5 py-6 sm:py-8 px-4 text-center text-destructive">
            <AlertCircle className="mb-3 h-6 w-6 sm:h-8 sm:w-8" />
            <p className="text-sm sm:text-base">{t("voiceUnsupported")}</p>
          </div>
        ) : activeTab === "voice" ? (
          <div className="flex flex-col items-center rounded-lg border bg-muted/20 py-8 px-4 sm:p-6">
            <Button type="button" size="icon" variant={isRecording ? "destructive" : "outline"} className="mb-4 h-20 w-20 sm:h-16 sm:w-16 rounded-full shadow-sm hover:scale-105 transition-transform" onClick={isRecording ? handleStopRecording : handleStartRecording} disabled={transcribeAudio.isPending}>
              {isRecording ? <Square className="h-8 w-8 sm:h-6 sm:w-6 fill-current" /> : <Mic className="h-8 w-8 sm:h-7 sm:w-7" />}
            </Button>
            <p className="text-sm font-medium">{isRecording ? t("recording") : transcribeAudio.isPending ? t("transcribing") : t("tapToSpeak")}</p>
          </div>
        ) : activeTab === "media" ? (
          <div className="rounded-lg border border-dashed p-4 sm:p-6 text-center bg-muted/10">
            <input ref={fileInput} className="hidden" type="file" multiple accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.rtf,.odt" onChange={(event) => handleFiles(event.target.files)} />
            {uploads.length > 0 && (
              <div className="mb-4 grid gap-2 text-start grid-cols-1 sm:grid-cols-2">
                {uploads.map((upload, index) => (
                  <div key={`${upload.url}-${index}`} className="rounded-lg border bg-background p-2.5 shadow-sm">
                    <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-primary">
                      {upload.type === "image" ? <img src={upload.url} alt="" className="h-full w-full object-cover" /> :
                        upload.type === "video" ? <Video className="h-5 w-5 sm:h-6 sm:w-6" /> :
                        upload.type === "audio" ? <FileAudio className="h-5 w-5 sm:h-6 sm:w-6" /> :
                        <FileText className="h-5 w-5 sm:h-6 sm:w-6" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{upload.name}</p>
                      <p className="text-[10px] sm:text-xs uppercase text-muted-foreground">{upload.type}</p>
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={t("removeUpload")} onClick={() => setUploads((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                      <X className="h-4 w-4" />
                    </Button>
                    </div>
                    <Input
                      value={upload.note ?? ""}
                      onChange={(event) => setUploads((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, note: event.target.value } : item))}
                      placeholder={t("attachmentNotePlaceholder")}
                      className="mt-2 h-9 text-sm"
                    />
                  </div>
                ))}
              </div>
            )}
            <div>
              <Button type="button" variant="outline" className="w-full sm:w-auto h-11 sm:h-9" onClick={() => fileInput.current?.click()} disabled={isUploading}>
                <Upload className="me-2 h-4 w-4" /> {isUploading ? t("uploading") : uploads.length ? t("addMoreUploads") : t("chooseMedia")}
              </Button>
              <p className="mt-3 sm:mt-2 text-xs text-muted-foreground">{t("supportedUploads")}</p>
            </div>
          </div>
        ) : activeTab === "link" ? (
          <div className="space-y-3">
            <Input type="url" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder={t("linkPlaceholder")} className="h-11 sm:h-9" />
            <Input value={linkNote} onChange={(event) => setLinkNote(event.target.value)} placeholder={t("attachmentNotePlaceholder")} className="h-11 sm:h-9" />
            <p className="text-xs text-muted-foreground">{t("linkHelp")}</p>
          </div>
        ) : null}

        <Textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder={activeTab === "voice" ? t("transcriptPlaceholder") : activeTab === "media" ? t("mediaCaption") : activeTab === "link" ? t("linkCaption") : t("thoughtPlaceholder")}
          className="min-h-[110px] resize-y bg-transparent text-base p-3 sm:p-4"
          disabled={busy}
        />
        <div className="flex justify-end">
          <Button type="button" size="lg" className="w-full sm:w-auto sm:h-9 sm:px-4 sm:py-2" onClick={saveIdea} disabled={busy || (activeTab === "media" && !uploads.length) || (activeTab === "link" && !linkUrl)}>
            <Send className="me-2 h-4 w-4" />
            {createIdea.isPending ? t("saving") : t("saveFragment")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}