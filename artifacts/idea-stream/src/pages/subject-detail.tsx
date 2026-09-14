import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Edit2, Trash2 } from "lucide-react";

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

export default function SubjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const subjectId = parseInt(id, 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

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
            title: "Error",
            description: "Failed to update title.",
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
            title: "Error",
            description: "Failed to update intro.",
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
            title: "Subject deleted",
          });
          setLocation("/");
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: "Error",
            description: "Failed to delete subject.",
          });
        }
      }
    );
  };

  if (isNaN(subjectId)) {
    return <div className="p-8 text-center text-destructive">Invalid subject ID</div>;
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
          <h2 className="text-xl font-semibold text-destructive mb-2">Subject not found</h2>
          <p className="text-destructive/80 mb-6">It may have been deleted or you don't have access.</p>
          <Button onClick={() => setLocation("/")} variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/10">
            <ArrowLeft className="mr-2 h-4 w-4" /> Return Home
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <header className="bg-card border-b border-border/50 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-6 lg:py-8">
          <div className="flex items-center justify-between mb-6">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setLocation("/")}
              className="text-muted-foreground hover:text-foreground -ml-3"
            >
              <ArrowLeft className="mr-2 h-4 w-4" /> Subjects
            </Button>

            <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete Subject</DialogTitle>
                  <DialogDescription>
                    Are you sure you want to delete "{subjectDetail.title}"? This will permanently delete the subject and all its fragments.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>Cancel</Button>
                  <Button variant="destructive" onClick={handleDelete} disabled={deleteSubject.isPending}>
                    {deleteSubject.isPending ? "Deleting..." : "Delete Subject"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="max-w-3xl">
            {isEditingTitle ? (
              <div className="flex items-center gap-2 mb-4">
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="text-3xl lg:text-4xl font-serif font-bold bg-transparent border-t-0 border-x-0 border-b-2 border-primary rounded-none px-0 focus-visible:ring-0 h-auto py-1"
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
                className="text-3xl lg:text-4xl font-serif font-bold tracking-tight mb-4 text-foreground group flex items-center gap-3 cursor-pointer"
                onClick={handleStartEditTitle}
              >
                {subjectDetail.title}
                <Edit2 className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </h1>
            )}

            {isEditingIntro ? (
              <div className="space-y-2 mt-4">
                <Textarea
                  value={editIntro}
                  onChange={(e) => setEditIntro(e.target.value)}
                  placeholder="Add a brief introduction or context for this subject..."
                  className="resize-none min-h-[100px] text-lg font-serif bg-transparent border-muted/50 focus-visible:ring-primary/20"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setIsEditingIntro(false);
                    // allow enter for newlines, require button click for save on textarea
                  }}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setIsEditingIntro(false)}>Cancel</Button>
                  <Button size="sm" onClick={handleSaveIntro}>Save Intro</Button>
                </div>
              </div>
            ) : (
              <div 
                className="mt-2 text-lg text-muted-foreground font-serif leading-relaxed group cursor-pointer border border-transparent hover:border-border/50 hover:bg-muted/10 p-3 -mx-3 rounded-lg transition-colors"
                onClick={handleStartEditIntro}
              >
                {subjectDetail.intro ? (
                  <p>{subjectDetail.intro}</p>
                ) : (
                  <p className="italic opacity-60">Add a brief introduction or context...</p>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 px-6 py-8 max-w-7xl mx-auto w-full grid lg:grid-cols-12 gap-10">
        <div className="lg:col-span-7 flex flex-col gap-10">
          <section>
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-serif font-semibold">Capture Fragment</h2>
            </div>
            <CreateIdeaForm subjectId={subjectId} />
          </section>

          <section>
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-serif font-semibold flex items-center gap-2">
                Stream 
                <span className="bg-primary/10 text-primary text-xs py-0.5 px-2 rounded-full font-sans font-medium">
                  {subjectDetail.ideas?.length || 0}
                </span>
              </h2>
            </div>
            <IdeaList subjectId={subjectId} initialIdeas={subjectDetail.ideas || []} />
          </section>
        </div>

        <aside className="lg:col-span-5 h-full relative">
          <div className="sticky top-40 h-[calc(100vh-12rem)] min-h-[500px]">
            <CompilationView 
              subjectId={subjectId} 
              draft={subjectDetail.draft}
              hasIdeas={(subjectDetail.ideas?.length || 0) > 0} 
            />
          </div>
        </aside>
      </main>
    </div>
  );
}
