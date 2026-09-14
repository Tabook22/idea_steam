import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  type Idea,
  IdeaSource,
  useUpdateIdea,
  useDeleteIdea,
  getListIdeasQueryKey,
  getGetSubjectQueryKey,
  useListIdeas,
} from "@workspace/api-client-react";
import { formatTimeAgo } from "@/lib/formatters";
import { Edit3, Trash2, Mic, FileText, Check, X } from "lucide-react";

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

interface IdeaListProps {
  subjectId: number;
  initialIdeas: Idea[];
}

export function IdeaList({ subjectId, initialIdeas }: IdeaListProps) {
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
        <p className="text-lg font-serif text-muted-foreground mb-1">Your stream is empty</p>
        <p className="text-sm text-muted-foreground/70">
          Capture your first thought above to start building this subject.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 relative before:absolute before:inset-y-0 before:left-4 before:w-px before:bg-border/60 ml-2 sm:ml-0 pl-10 sm:pl-0 sm:before:left-6">
      {ideas.map((idea) => (
        <IdeaItem key={idea.id} idea={idea} subjectId={subjectId} />
      ))}
    </div>
  );
}

function IdeaItem({ idea, subjectId }: { idea: Idea; subjectId: number }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(idea.content);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
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
            title: "Error",
            description: "Failed to update fragment.",
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
            title: "Error",
            description: "Failed to delete fragment.",
          });
        }
      }
    );
  };

  return (
    <div className="relative sm:pl-12 group">
      {/* Timeline dot */}
      <div className="absolute left-[-2.8rem] sm:left-4 top-5 w-3 h-3 rounded-full bg-background border-2 border-primary ring-4 ring-background z-10" />
      
      <div className="bg-card rounded-xl border border-border/60 p-5 shadow-sm hover:shadow-md transition-shadow group-hover:border-primary/20">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 bg-muted/50 px-2 py-0.5 rounded-md">
              {idea.source === IdeaSource.voice ? <Mic className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
              {idea.source === IdeaSource.voice ? 'Voice Note' : 'Text Note'}
            </span>
            <span className="text-xs text-muted-foreground/60">•</span>
            <span className="text-xs text-muted-foreground/80">{formatTimeAgo(idea.createdAt)}</span>
          </div>
          
          {!isEditing && (
            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => setIsEditing(true)}>
                <Edit3 className="h-4 w-4" />
              </Button>
              
              <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Delete Fragment</DialogTitle>
                    <DialogDescription>
                      Are you sure you want to delete this fragment? This action cannot be undone.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>Cancel</Button>
                    <Button variant="destructive" onClick={handleDelete} disabled={deleteIdea.isPending}>
                      {deleteIdea.isPending ? "Deleting..." : "Delete"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </div>
        
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
                <X className="h-4 w-4 mr-1.5" /> Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={updateIdea.isPending}>
                <Check className="h-4 w-4 mr-1.5" /> Save
              </Button>
            </div>
          </div>
        ) : (
          <div className="prose prose-sm max-w-none text-foreground font-serif leading-relaxed text-[1.05rem]">
            {idea.content.split('\n').map((paragraph, i) => (
              paragraph ? <p key={i} className="mb-2 last:mb-0">{paragraph}</p> : <br key={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
