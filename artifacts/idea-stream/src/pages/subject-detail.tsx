import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, Edit2, Trash2 } from "lucide-react";

import { 
  useGetSubject, 
  useUpdateSubject, 
  useDeleteSubject,
  getGetSubjectQueryKey,
  getListSubjectsQueryKey
} from "@workspace/api-client-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
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

import { IdeaList } from "@/components/idea-list";
import { CreateIdeaForm } from "@/components/create-idea-form";
import { CompilationView } from "@/components/compilation-view";
import { useLanguage } from "@/lib/i18n";
import { formatDateTime } from "@/lib/formatters";

export default function SubjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const subjectId = parseInt(id, 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { language, isArabic, t } = useLanguage();

  const { data: subjectDetail, isLoading, error } = useGetSubject(subjectId, {
    query: {
      enabled: !isNaN(subjectId),
      queryKey: getGetSubjectQueryKey(subjectId),
    }
  });

  const updateSubject = useUpdateSubject();
  const deleteSubject = useDeleteSubject();

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [isEditingIntro, setIsEditingIntro] = useState(false);
  const [editIntro, setEditIntro] = useState("");
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  // Initialize edit states when starting edit
  const handleStartEditTitle = () => {
    setEditTitle(subjectDetail?.title || "");
    setIsEditingTitle(true);
  };

  const handleStartEditIntro = () => {
    setEditIntro(subjectDetail?.intro || "");
    setIsEditingIntro(true);
  };

  const handleSaveTitle = () => {
    if (!editTitle.trim() || editTitle === subjectDetail?.title) {
      setIsEditingTitle(false);
      return;
    }

    updateSubject.mutate(
      { subjectId, data: { title: editTitle.trim() } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSubjectQueryKey(subjectId) });
          queryClient.invalidateQueries({ queryKey: getListSubjectsQueryKey() });
          setIsEditingTitle(false);
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: t("error"),
            description: t("updateTitleFailed"),
          });
        }
      }
    );
  };

  const handleSaveIntro = () => {
    if (editIntro === subjectDetail?.intro) {
      setIsEditingIntro(false);
      return;
    }

    updateSubject.mutate(
      { subjectId, data: { intro: editIntro.trim() } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSubjectQueryKey(subjectId) });
          setIsEditingIntro(false);
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: t("error"),
            description: t("updateIntroFailed"),
          });
        }
      }
    );
  };

  const handleDelete = () => {
    deleteSubject.mutate(
      { subjectId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSubjectsQueryKey() });
          toast({
            title: t("subjectDeleted"),
          });
          setLocation("/");
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: t("error"),
            description: t("deleteSubjectFailed"),
          });
        }
      }
    );
  };

  if (isNaN(subjectId)) {
    return <div className="p-8 text-center text-destructive">{t("invalidSubject")}</div>;
  }

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex flex-col">
        <header className="border-b bg-card px-6 py-4">
          <Skeleton className="h-8 w-24 mb-6" />
          <Skeleton className="h-12 w-3/4 max-w-xl mb-4" />
          <Skeleton className="h-4 w-full max-w-2xl mb-2" />
          <Skeleton className="h-4 w-2/3 max-w-xl" />
        </header>
        <main className="flex-1 p-6 grid lg:grid-cols-12 gap-8 max-w-7xl mx-auto w-full">
          <div className="lg:col-span-7 space-y-6">
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
          <div className="lg:col-span-5">
            <Skeleton className="h-96 w-full rounded-xl" />
          </div>
        </main>
      </div>
    );
  }

  if (error || !subjectDetail) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center p-6">
        <div className="text-center max-w-md bg-destructive/10 p-8 rounded-xl border border-destructive/20">
          <h2 className="text-xl font-semibold text-destructive mb-2">{t("subjectNotFound")}</h2>
          <p className="text-destructive/80 mb-6">{t("subjectMissing")}</p>
          <Button onClick={() => setLocation("/")} variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/10">
            <ArrowLeft className={`me-2 h-4 w-4 ${isArabic ? "rotate-180" : ""}`} /> {t("returnHome")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <header className="bg-card border-b border-border/50 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6 lg:py-8">
          <div className="flex items-center justify-between mb-4 md:mb-6">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setLocation("/")}
              className="text-muted-foreground hover:text-foreground -ms-3"
            >
              <ArrowLeft className={`me-2 h-4 w-4 ${isArabic ? "rotate-180" : ""}`} /> {t("subjects")}
            </Button>

            <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="w-[95vw] sm:w-full max-w-md rounded-xl">
                <DialogHeader>
                  <DialogTitle>{t("deleteSubject")}</DialogTitle>
                  <DialogDescription>
                    {t("deleteSubjectConfirm")}
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter className="gap-2 sm:gap-0 mt-4 sm:mt-0">
                  <Button variant="outline" className="w-full sm:w-auto" onClick={() => setIsDeleteDialogOpen(false)}>{t("cancel")}</Button>
                  <Button variant="destructive" className="w-full sm:w-auto" onClick={handleDelete} disabled={deleteSubject.isPending}>
                    {deleteSubject.isPending ? t("deleting") : t("deleteSubject")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="max-w-3xl">
            {isEditingTitle ? (
              <div className="flex items-center gap-2 mb-3 md:mb-4">
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="text-2xl sm:text-3xl lg:text-4xl font-serif font-bold bg-transparent border-t-0 border-x-0 border-b-2 border-primary rounded-none px-0 focus-visible:ring-0 h-auto py-1"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveTitle();
                    if (e.key === 'Escape') setIsEditingTitle(false);
                  }}
                  onBlur={handleSaveTitle}
                />
              </div>
            ) : (
              <h1 
                className="text-2xl sm:text-3xl lg:text-4xl font-serif font-bold tracking-tight mb-3 md:mb-4 text-foreground group flex items-start sm:items-center gap-3 cursor-pointer"
                onClick={handleStartEditTitle}
              >
                <span className="break-words">{subjectDetail.title}</span>
                <Edit2 className="h-4 w-4 text-muted-foreground opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity mt-1.5 sm:mt-0 shrink-0" />
              </h1>
            )}

            <div className="mb-4 flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
              <span>
                {t("subjectCreatedAt")}: {formatDateTime(subjectDetail.createdAt, language)}
              </span>
            </div>

            {isEditingIntro ? (
              <div className="space-y-2 mt-4">
                <Textarea
                  value={editIntro}
                  onChange={(e) => setEditIntro(e.target.value)}
                  placeholder={t("addIntro")}
                  className="resize-none min-h-[100px] text-base sm:text-lg font-serif bg-transparent border-muted/50 focus-visible:ring-primary/20"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setIsEditingIntro(false);
                  }}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setIsEditingIntro(false)}>{t("cancel")}</Button>
                  <Button size="sm" onClick={handleSaveIntro}>{t("saveIntro")}</Button>
                </div>
              </div>
            ) : (
              <div 
                className="mt-2 text-base sm:text-lg text-muted-foreground font-serif leading-relaxed group cursor-pointer border border-transparent hover:border-border/50 hover:bg-muted/10 p-2 sm:p-3 -mx-2 sm:-mx-3 rounded-lg transition-colors"
                onClick={handleStartEditIntro}
              >
                {subjectDetail.intro ? (
                  <p>{subjectDetail.intro}</p>
                ) : (
                  <p className="italic opacity-60 flex items-center gap-2"><Edit2 className="h-3 w-3" /> {t("addIntro")}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 md:px-6 py-6 md:py-8 max-w-7xl mx-auto w-full grid lg:grid-cols-12 gap-8 lg:gap-10">
        <div className="lg:col-span-7 flex flex-col gap-8 md:gap-10">
          <section>
            <div className="mb-4 md:mb-6 flex items-center justify-between">
              <h2 className="text-lg md:text-xl font-serif font-semibold">{t("captureFragment")}</h2>
            </div>
            <CreateIdeaForm subjectId={subjectId} />
          </section>

          <section>
            <div className="mb-4 md:mb-6 flex items-center justify-between">
              <h2 className="text-lg md:text-xl font-serif font-semibold flex items-center gap-2">
                {t("stream")}
                <span className="bg-primary/10 text-primary text-xs py-0.5 px-2 rounded-full font-sans font-medium">
                  {subjectDetail.ideas?.length || 0}
                </span>
              </h2>
            </div>
            <IdeaList subjectId={subjectId} initialIdeas={subjectDetail.ideas || []} />
          </section>
        </div>

        <aside className="lg:col-span-5 h-full relative mt-8 lg:mt-0 border-t lg:border-t-0 pt-8 lg:pt-0 border-border/50">
          <div className="lg:sticky lg:top-40 h-[calc(100vh-12rem)] min-h-[500px]">
            <CompilationView 
              subjectId={subjectId} 
              subjectTitle={subjectDetail.title}
              hasIdeas={(subjectDetail.ideas?.length || 0) > 0} 
            />
          </div>
        </aside>
      </main>
    </div>
  );
}
