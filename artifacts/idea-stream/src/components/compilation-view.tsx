import { useState, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Wand2, Plus, Save, Sparkles, BookText, Edit2, Trash2, Clock, Download } from "lucide-react";

import {
  Compilation,
  CompilationInputTone,
  useCompileSubject,
  useListSubjectCompilations,
  useUpdateSubjectCompilation,
  useDeleteSubjectCompilation,
  getListSubjectCompilationsQueryKey,
} from "@workspace/api-client-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useLanguage } from "@/lib/i18n";
import { formatDateTime } from "@/lib/formatters";
import {
  normalizeDraftHtml,
  RichTextEditor,
  sanitizeDraftHtml,
} from "@/components/rich-text-editor";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface CompilationViewProps {
  subjectId: number;
  subjectTitle: string;
  hasIdeas: boolean;
}

export function CompilationView({ subjectId, subjectTitle, hasIdeas }: CompilationViewProps) {
  const [tone, setTone] = useState<CompilationInputTone>(CompilationInputTone.clear);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState<"pdf" | "docx">("pdf");
  const [isUploadingDraftImage, setIsUploadingDraftImage] = useState(false);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t, language } = useLanguage();

  const outputOptions = [
    [CompilationInputTone.clear, t("clearDirect")],
    [CompilationInputTone.conversational, t("conversational")],
    [CompilationInputTone.academic, t("academic")],
    [CompilationInputTone.cinematic, t("cinematic")],
    [CompilationInputTone.newspaper_article, t("newspaperArticle")],
    [CompilationInputTone.advertisement, t("advertisement")],
    [CompilationInputTone.discussion_invitation, t("discussionInvitation")],
    [CompilationInputTone.official_letter, t("officialLetter")],
    [CompilationInputTone.masters_proposal, t("mastersProposal")],
    [CompilationInputTone.phd_proposal, t("phdProposal")],
    [CompilationInputTone.summary_only, t("summaryOnly")],
    [CompilationInputTone.objectives_goals, t("objectivesGoals")],
  ] as const;

  const getToneLabel = (toneValue: string) => {
    const option = outputOptions.find(o => o[0] === toneValue);
    return option ? option[1] : toneValue;
  };

  const { data: compilations = [], isLoading } = useListSubjectCompilations(subjectId, {
    query: {
      enabled: !isNaN(subjectId),
      queryKey: getListSubjectCompilationsQueryKey(subjectId)
    }
  });

  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    if (!isLoading) {
      if (compilations.length === 0) {
        setIsCreatingNew(true);
        setSelectedId(null);
      } else if (!isCreatingNew && (!selectedId || !compilations.find(c => c.id === selectedId))) {
        setSelectedId(compilations[0].id);
      }
    }
  }, [compilations, isLoading, selectedId, isCreatingNew]);

  const selectedCompilation = useMemo(() => 
    compilations.find(c => c.id === selectedId) || null
  , [compilations, selectedId]);

  const compileSubject = useCompileSubject();
  const updateCompilation = useUpdateSubjectCompilation();
  const deleteCompilation = useDeleteSubjectCompilation();

  // Reset edit state when selected compilation changes externally
  useEffect(() => {
    if (!isEditing && selectedCompilation) {
      setEditDraft(selectedCompilation.content);
    }
  }, [selectedCompilation, isEditing]);

  const handleCompile = () => {
    if (!hasIdeas) {
      toast({
        title: t("nothingToCompile"),
        description: t("addFragmentsFirst"),
      });
      return;
    }

    compileSubject.mutate(
      { subjectId, data: { tone } },
      {
        onSuccess: (data) => {
          queryClient.setQueryData<Compilation[]>(
            getListSubjectCompilationsQueryKey(subjectId),
            (old) => [data, ...(old ?? []).filter(c => c.id !== data.id)],
          );
          setSelectedId(data.id);
          setEditDraft(data.content);
          setIsEditing(false);
          setIsCreatingNew(false);
          toast({
            title: t("compilationComplete"),
            description: t("compilationCompleteDetail"),
          });
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: t("compilationFailed"),
            description: t("compilationFailedDetail"),
          });
        }
      }
    );
  };

  const handleSaveEdit = () => {
    if (isUploadingDraftImage) return;
    if (!selectedCompilation || editDraft === selectedCompilation.content) {
      setIsEditing(false);
      return;
    }

    updateCompilation.mutate(
      { subjectId, compilationId: selectedCompilation.id, data: { content: editDraft } },
      {
        onSuccess: (data) => {
          queryClient.setQueryData<Compilation[]>(
            getListSubjectCompilationsQueryKey(subjectId),
            (old) => old ? old.map(c => c.id === data.id ? data : c) : []
          );
          setIsEditing(false);
          toast({
            title: t("draftSaved"),
          });
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: t("error"),
            description: t("draftSaveFailed"),
          });
        }
      }
    );
  };

  const handleStartEdit = () => {
    if (!selectedCompilation) return;
    setEditDraft(selectedCompilation.content);
    setIsEditing(true);
  };

  const handleDownload = async () => {
    if (!selectedCompilation) return;

    setIsDownloading(true);
    try {
      const response = await fetch(
        `/api/subjects/${subjectId}/compilations/${selectedCompilation.id}/download`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ format: downloadFormat }),
        },
      );
      if (!response.ok) throw new Error("Download failed");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      const safeName =
        subjectTitle
          .trim()
          .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
          .replace(/\s+/g, " ")
          .slice(0, 80) || "compiled-draft";
      link.href = url;
      link.download = `${safeName}-${getToneLabel(selectedCompilation.tone)}.${downloadFormat}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      toast({ title: t("draftDownloaded") });
    } catch {
      toast({
        variant: "destructive",
        title: t("error"),
        description: t("draftDownloadFailed"),
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDelete = () => {
    if (!selectedCompilation) return;
    
    deleteCompilation.mutate(
      { subjectId, compilationId: selectedCompilation.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSubjectCompilationsQueryKey(subjectId) });
          setIsDeleteDialogOpen(false);
          setIsEditing(false);
          toast({
            title: t("compilationDeleted"),
          });
          
          const remaining = compilations.filter(c => c.id !== selectedCompilation.id);
          if (remaining.length > 0) {
            setSelectedId(remaining[0].id);
          } else {
            setSelectedId(null);
            setIsCreatingNew(true);
          }
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: t("error"),
            description: t("deleteCompilationFailed"),
          });
        }
      }
    );
  };

  if (isLoading) {
    return (
      <Card className="h-full flex flex-col shadow-lg border-primary/30 bg-card overflow-hidden min-h-[500px] animate-pulse">
         <div className="h-16 bg-muted/50 border-b border-border/50 shrink-0" />
         <div className="h-24 bg-muted/20 border-b border-border/50 shrink-0" />
         <div className="flex-1 bg-muted/10" />
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col shadow-lg border-primary/30 bg-card overflow-hidden min-h-[500px]">
      <CardHeader className="border-b border-border/50 bg-primary/5 py-3 md:py-4 px-4 md:px-6 flex flex-row items-center justify-between space-y-0 shrink-0 gap-2">
        <div className="flex items-center gap-2 shrink-0">
          <BookText className="h-4 w-4 md:h-5 md:w-5 text-primary shrink-0" />
          <CardTitle className="font-serif text-lg md:text-xl truncate">{t("compiledDraft")}</CardTitle>
        </div>
        <Button 
          size="sm" 
          variant={isCreatingNew ? "secondary" : "outline"}
          onClick={() => { setIsCreatingNew(true); setSelectedId(null); setIsEditing(false); }}
          className="h-8 border-primary/20 shrink-0"
        >
          <Plus className="h-3.5 w-3.5 me-1.5" /> {t("newCompilation")}
        </Button>
      </CardHeader>

      {compilations.length > 0 && (
        <div className="shrink-0 border-b border-border/50 bg-muted/5 max-h-[25vh] overflow-y-auto p-2 space-y-1">
          {compilations.map(c => (
            <button
              key={c.id}
              onClick={() => { setSelectedId(c.id); setIsCreatingNew(false); setIsEditing(false); }}
              className={`w-full text-start flex flex-col sm:flex-row sm:items-center justify-between gap-1 p-2.5 rounded-md transition-all ${
                selectedId === c.id && !isCreatingNew
                  ? "bg-primary/10 border border-primary/20 shadow-sm"
                  : "hover:bg-muted border border-transparent"
              }`}
            >
              <span className="font-medium text-sm text-foreground">{getToneLabel(c.tone)}</span>
              <span className="text-xs text-muted-foreground flex items-center">
                <Clock className="h-3 w-3 me-1" /> {formatDateTime(c.createdAt, language)}
              </span>
            </button>
          ))}
        </div>
      )}

      <CardContent className="flex-1 p-0 overflow-hidden flex flex-col relative">
        {compileSubject.isPending && (
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-20 flex flex-col items-center justify-center">
            <div className="w-16 h-16 relative">
              <div className="absolute inset-0 rounded-full border-t-2 border-primary animate-spin"></div>
              <Wand2 className="absolute inset-0 m-auto h-6 w-6 text-primary animate-pulse" />
            </div>
            <p className="mt-4 font-serif font-medium text-primary">{t("weaving")}</p>
          </div>
        )}

        {isCreatingNew || (compilations.length === 0 && !selectedCompilation) ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-8 text-center overflow-y-auto min-h-[400px]">
            <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4 md:mb-6 shrink-0">
              <Wand2 className="h-6 w-6 md:h-8 md:w-8 text-primary" />
            </div>
            <h3 className="font-serif text-xl md:text-2xl mb-2 font-semibold tracking-tight shrink-0">{t("shapeDraft")}</h3>
            <p className="text-sm md:text-base text-muted-foreground max-w-sm mx-auto mb-6 md:mb-8 font-serif leading-relaxed shrink-0">
              {t("shapeDraftDetail")}
            </p>
            
            <div className="w-full max-w-xs space-y-4 shrink-0">
              <Select 
                value={tone} 
                onValueChange={(val) => setTone(val as CompilationInputTone)}
                disabled={!hasIdeas}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("selectTone")} />
                </SelectTrigger>
                <SelectContent>
                  {outputOptions.map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <Button 
                className="w-full" 
                size="lg" 
                onClick={handleCompile}
                disabled={!hasIdeas || compileSubject.isPending}
              >
                <Sparkles className="me-2 h-4 w-4" />
                {t("compileFragments")}
              </Button>
            </div>
          </div>
        ) : selectedCompilation ? (
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            <div className="shrink-0 flex items-center justify-between p-2 md:px-4 border-b border-border/30 bg-muted/5 min-h-[48px]">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium bg-primary/10 text-primary px-2.5 py-1 rounded-full">
                  {getToneLabel(selectedCompilation.tone)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {isEditing ? (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)} className="h-8 text-xs">
                      {t("cancel")}
                    </Button>
                    <Button size="sm" onClick={handleSaveEdit} disabled={updateCompilation.isPending} className="h-8 text-xs">
                      <Save className="me-1.5 h-3.5 w-3.5" /> {t("save")}
                    </Button>
                  </>
                ) : (
                  <>
                    <Select
                      value={downloadFormat}
                      onValueChange={(value) => setDownloadFormat(value as "pdf" | "docx")}
                    >
                      <SelectTrigger className="h-8 w-24 bg-background text-xs" aria-label={t("downloadFormat")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pdf">{t("pdfFormat")}</SelectItem>
                        <SelectItem value="docx">{t("docxFormat")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDownload}
                      disabled={isDownloading}
                      className="h-8 border-primary/20 hover:bg-primary/10 text-xs"
                      title={t("downloadDraft")}
                    >
                      <Download className="me-1.5 h-3.5 w-3.5" />
                      {isDownloading ? t("downloading") : t("download")}
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={handleStartEdit}
                      className="h-8 border-primary/20 hover:bg-primary/10 text-xs"
                      title={t("edit")}
                    >
                      <Edit2 className="me-1.5 h-3.5 w-3.5" /> {t("edit")}
                    </Button>
                    
                    <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                      <DialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 text-xs" title={t("delete")}>
                          <Trash2 className="me-1.5 h-3.5 w-3.5" /> {t("delete")}
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="w-[95vw] sm:w-full max-w-md rounded-xl">
                        <DialogHeader>
                          <DialogTitle>{t("deleteCompilation")}</DialogTitle>
                          <DialogDescription>
                            {t("deleteCompilationConfirm")}
                          </DialogDescription>
                        </DialogHeader>
                        <DialogFooter className="gap-2 sm:gap-0 mt-4 sm:mt-0">
                          <Button variant="outline" className="w-full sm:w-auto" onClick={() => setIsDeleteDialogOpen(false)}>{t("cancel")}</Button>
                          <Button variant="destructive" className="w-full sm:w-auto" onClick={handleDelete} disabled={deleteCompilation.isPending}>
                            {deleteCompilation.isPending ? t("deleting") : t("delete")}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </>
                )}
              </div>
            </div>
            <div 
              className="rich-text-content flex-1 overflow-auto p-6 text-foreground cursor-text"
              onClick={handleStartEdit}
              title={t("openLargeEditor")}
              dangerouslySetInnerHTML={{
                __html: sanitizeDraftHtml(normalizeDraftHtml(selectedCompilation.content || "")),
              }}
            />
          </div>
        ) : null}
      </CardContent>

      <Dialog
        open={isEditing}
        onOpenChange={(open) => {
          if (open) handleStartEdit();
          else setIsEditing(false);
        }}
      >
        <DialogContent className="flex h-[80vh] min-h-[420px] w-[80vw] min-w-[320px] max-w-none resize flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
          <DialogHeader className="shrink-0 border-b border-border/50 bg-primary/5 px-5 py-4 pe-12">
            <DialogTitle className="font-serif text-xl">
              {t("editCompiledDraft")}
            </DialogTitle>
            <DialogDescription>
              {selectedCompilation
                ? `${getToneLabel(selectedCompilation.tone)} • ${formatDateTime(selectedCompilation.createdAt, language)}`
                : t("compiledDraft")}
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col">
            <RichTextEditor
              value={editDraft}
              onChange={setEditDraft}
              compilationId={selectedCompilation?.id ?? 0}
              onUploadingChange={(isUploading) => {
                setIsUploadingDraftImage(isUploading);
              }}
            />
          </div>

          <DialogFooter className="shrink-0 gap-2 border-t border-border/50 bg-background px-5 py-3 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setIsEditing(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={updateCompilation.isPending || isUploadingDraftImage}
            >
              <Save className="me-2 h-4 w-4" />
              {updateCompilation.isPending ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
