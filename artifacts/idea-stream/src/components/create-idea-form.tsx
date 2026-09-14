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
import { AlertCircle, ImagePlus, Link2, Mic, PenTool, Send, Square, Upload, Video } from "lucide-react";
import { useAudioRecorder } from "@/hooks/use-audio-recorder";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/i18n";

type Tab = "text" | "voice" | "media" | "link";
type MediaAttachment = {
  type: "image" | "video";
  url: string;
  name: string;
  mimeType?: string;
};

export function CreateIdeaForm({ subjectId }: { subjectId: number }) {
  const [activeTab, setActiveTab] = useState<Tab>("text");
  const [content, setContent] = useState("");
  const [transcript, setTranscript] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [media, setMedia] = useState<MediaAttachment | null>(null);
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
    setMedia(null);
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

  const handleFile = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      toast({ variant: "destructive", title: t("error"), description: t("mediaTypeError") });
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      toast({ variant: "destructive", title: t("error"), description: t("mediaSizeError") });
      return;
    }

    setIsUploading(true);
    try {
      const request = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!request.ok) throw new Error("Upload URL failed");
      const { uploadURL, objectPath } = await request.json() as { uploadURL: string; objectPath: string };
      const upload = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!upload.ok) throw new Error("Upload failed");
      setMedia({
        type: file.type.startsWith("video/") ? "video" : "image",
        url: `/api/storage${objectPath}`,
        name: file.name,
        mimeType: file.type,
      });
      if (!content) setContent(file.name);
    } catch {
      toast({ variant: "destructive", title: t("error"), description: t("uploadFailed") });
    } finally {
      setIsUploading(false);
    }
  };

  const saveIdea = () => {
    let source: (typeof IdeaInputSource)[keyof typeof IdeaInputSource] = IdeaInputSource.text;
    const attachments = [];
    if (activeTab === "voice") source = IdeaInputSource.voice;
    if (activeTab === "media" && media) {
      source = media.type === "video" ? IdeaInputSource.video : IdeaInputSource.image;
      attachments.push({
        type: media.type === "video" ? IdeaAttachmentType.video : IdeaAttachmentType.image,
        url: media.url,
        name: media.name,
        mimeType: media.mimeType,
      });
    }
    if (activeTab === "link") {
      try {
        const url = new URL(linkUrl);
        source = IdeaInputSource.link;
        attachments.push({ type: IdeaAttachmentType.link, url: url.toString(), name: url.hostname });
      } catch {
        toast({ variant: "destructive", title: t("error"), description: t("invalidLink") });
        return;
      }
    }
    const finalContent = content.trim() || (activeTab === "link" ? linkUrl : media?.name || "");
    if (!finalContent || (activeTab === "media" && !media)) return;

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
            className={`flex items-center justify-center gap-1.5 px-2 py-3 text-xs font-medium sm:text-sm ${activeTab === tab ? "border-b-2 border-primary bg-card text-foreground" : "bg-muted/30 text-muted-foreground"}`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      <CardContent className="space-y-4 bg-card p-4 sm:p-6">
        {activeTab === "voice" && !isSupported ? (
          <div className="flex flex-col items-center rounded-lg border border-destructive/20 bg-destructive/5 py-8 text-center text-destructive">
            <AlertCircle className="mb-3 h-8 w-8" />
            <p>{t("voiceUnsupported")}</p>
          </div>
        ) : activeTab === "voice" ? (
          <div className="flex flex-col items-center rounded-lg border bg-muted/20 p-6">
            <Button type="button" size="icon" variant={isRecording ? "destructive" : "outline"} className="mb-3 h-16 w-16 rounded-full" onClick={isRecording ? handleStopRecording : handleStartRecording} disabled={transcribeAudio.isPending}>
              {isRecording ? <Square className="h-6 w-6 fill-current" /> : <Mic className="h-7 w-7" />}
            </Button>
            <p className="text-sm font-medium">{isRecording ? t("recording") : transcribeAudio.isPending ? t("transcribing") : t("tapToSpeak")}</p>
          </div>
        ) : activeTab === "media" ? (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <input ref={fileInput} className="hidden" type="file" accept="image/*,video/*" capture="environment" onChange={(event) => handleFile(event.target.files?.[0])} />
            {media ? (
              <div className="space-y-3">
                {media.type === "image" ? <img src={media.url} alt={media.name} className="mx-auto max-h-56 rounded-lg object-contain" /> : <video src={media.url} controls className="mx-auto max-h-56 rounded-lg" />}
                <p className="text-sm text-muted-foreground">{media.name}</p>
              </div>
            ) : (
              <Button type="button" variant="outline" onClick={() => fileInput.current?.click()} disabled={isUploading}>
                <Upload className="me-2 h-4 w-4" /> {isUploading ? t("uploading") : t("chooseMedia")}
              </Button>
            )}
          </div>
        ) : activeTab === "link" ? (
          <div className="space-y-2">
            <Input type="url" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder={t("linkPlaceholder")} />
            <p className="text-xs text-muted-foreground">{t("linkHelp")}</p>
          </div>
        ) : null}

        <Textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder={activeTab === "voice" ? t("transcriptPlaceholder") : activeTab === "media" ? t("mediaCaption") : activeTab === "link" ? t("linkCaption") : t("thoughtPlaceholder")}
          className="min-h-[110px] resize-y bg-transparent text-base"
          disabled={busy}
        />
        <div className="flex justify-end">
          <Button type="button" onClick={saveIdea} disabled={busy || (activeTab === "media" && !media) || (activeTab === "link" && !linkUrl)}>
            {activeTab === "media" && media?.type === "video" ? <Video className="me-2 h-4 w-4" /> : <Send className="me-2 h-4 w-4" />}
            {createIdea.isPending ? t("saving") : t("saveFragment")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}