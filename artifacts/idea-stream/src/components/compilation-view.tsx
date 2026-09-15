import { useState, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Wand2, Plus, Save, Sparkles, BookText, Edit2, Trash2, Clock, X } from "lucide-react";

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
  hasIdeas: boolean;
}

export function CompilationView({ subjectId, hasIdeas }: CompilationViewProps) {
  const [tone, setTone] = useState<CompilationInputTone>(CompilationInputTone.clear);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

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
         <div className="h-16 bg-muted/50 w-full" />
         <div className="flex-1 bg-muted/20" />
      </Card>
    );
  }

  if (isCreatingNew || (!selectedCompilation && compilations.length === 0)) {
    return (
      <Card className="h-full border-primary/20 bg-card/80 shadow-md flex flex-col items-center justify-center p-6 md:p-8 text-center min-h-[400px]">
        {compilations.length > 0 && (
          <Button 
            variant="ghost" 
            size="sm" 
            className="absolute top-4 start-4 text-muted-foreground"
            onClick={() => setIsCreatingNew(false)}
          >
            <X className="h-4 w-4 me-2" />
            {t("cancel")}
          </Button>
        )}
        
        <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4 md:mb-6">
          <Wand2 className="h-6 w-6 md:h-8 md:w-8 text-primary" />
        </div>
        <CardTitle className="font-serif text-xl md:text-2xl mb-2">{t("shapeDraft")}</CardTitle>
        <CardDescription className="text-sm md:text-base max-w-sm mx-auto mb-6 md:mb-8 font-serif leading-relaxed">
          {t("shapeDraftDetail")}
        </CardDescription>
        
        <div className="w-full max-w-xs space-y-4">
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
      </Card>
    );
  }

  if (!selectedCompilation) return null;

  return (
    <Card className="h-full flex flex-col shadow-lg border-primary/30 bg-card overflow-hidden min-h-[500px]">
      <CardHeader className="border-b border-border/50 bg-primary/5 py-3 md:py-4 px-4 md:px-6 flex flex-col items-stretch space-y-0 sticky top-0 z-10 gap-3">
        <div className="flex items-center gap-2">
          <BookText className="h-4 w-4 md:h-5 md:w-5 text-primary shrink-0" />
          <CardTitle className="font-serif text-lg md:text-xl truncate">{t("compiledDraft")}</CardTitle>
        </div>
        
        <div className="flex items-center gap-2 w-full">
          {!isEditing && (
            <Select 
              value={selectedId?.toString()} 
              onValueChange={(val) => {
                if (val === 'new') setIsCreatingNew(true);
                else {
                  setSelectedId(parseInt(val, 10));
                  setIsEditing(false);
                }
              }}
              disabled={compileSubject.isPending}
            >
              <SelectTrigger className="h-9 flex-1 min-w-0 text-xs bg-background/70">
                <SelectValue placeholder={t("compilations")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new" className="text-primary font-medium">
                  <span className="flex items-center">
                    <Plus className="h-3.5 w-3.5 me-1.5" /> {t("newCompilation")}
                  </span>
                </SelectItem>
                {compilations.map(c => (
                  <SelectItem key={c.id} value={c.id.toString()}>
                    {getToneLabel(c.tone)} • {formatDateTime(c.createdAt, language)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {isEditing ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)} className="h-8">
                {t("cancel")}
              </Button>
              <Button size="sm" onClick={handleSaveEdit} disabled={updateCompilation.isPending} className="h-8">
                <Save className="me-2 h-3.5 w-3.5" /> {t("save")}
              </Button>
            </>
          ) : (
            <>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleStartEdit}
                className="h-8 border-primary/20 hover:bg-primary/10"
                title={t("edit")}
              >
                <Edit2 className="h-3.5 w-3.5" />
              </Button>
              
              <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10" title={t("delete")}>
                    <Trash2 className="h-4 w-4" />
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
      </CardHeader>
      
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
        
        {isEditing ? (
          <RichTextEditor
            value={editDraft}
            onChange={setEditDraft}
          />
        ) : (
          <div 
            className="rich-text-content flex-1 overflow-auto p-6 text-foreground cursor-text"
            onClick={handleStartEdit}
            title={t("clickToEdit")}
            dangerouslySetInnerHTML={{
              __html: sanitizeDraftHtml(normalizeDraftHtml(selectedCompilation.content || "")),
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}
