import { useState } from "react";
import { FolderInput } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListSubjects,
  getListSubjectsQueryKey,
  useUpdateIdea,
  type Idea,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useLanguage } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { recordingStore, useRecorder } from "@/components/recorder-provider";

export function MoveIdeaDialog({ idea }: { idea: Idea }) {
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState("");
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const {
    data: subjects = [],
    isLoading,
    error,
    refetch,
  } = useListSubjects({
    query: { queryKey: getListSubjectsQueryKey(), enabled: open },
  });
  const update = useUpdateIdea();
  const queryClient = useQueryClient();
  const { refresh } = useRecorder();
  const { toast } = useToast();
  const choices = subjects.filter((subject) => subject.id !== idea.subjectId);
  async function move() {
    if (!destination) return;
    try {
      await update.mutateAsync({
        ideaId: idea.id,
        data: { subjectId: Number(destination) },
      });
      // Keep a local recording's notebook link consistent if this idea originated here.
      try {
        for (const record of await recordingStore.list())
          if (record.ideaId === idea.id)
            await recordingStore.patch(record.id, {
              subjectId: Number(destination),
            });
        await refresh();
      } catch {
        /* Server move has already succeeded. */
      }
      await queryClient.invalidateQueries();
      setOpen(false);
      toast({
        title: copy("Idea moved", "تم نقل الفكرة"),
        description: subjects.find((s) => s.id === Number(destination))?.title,
      });
    } catch {
      toast({
        variant: "destructive",
        title: copy(
          "Couldn't move this idea. It remains in its original notebook.",
          "تعذر نقل الفكرة. ما زالت في دفترها الأصلي.",
        ),
      });
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!update.isPending) {
          setOpen(value);
          setDestination("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs text-primary"
        >
          <FolderInput size={14} className="me-1.5" />
          {copy("Move to notebook", "نقل إلى دفتر")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {copy(
              "Find the right home for this idea",
              "اختر المكان المناسب لهذه الفكرة",
            )}
          </DialogTitle>
          <DialogDescription>
            {copy(
              "The original audio, attachments, and conversation move with it. Existing generated drafts stay unchanged.",
              "ينتقل الصوت الأصلي والمرفقات والمحادثة معها. تبقى المسودات السابقة كما هي.",
            )}
          </DialogDescription>
        </DialogHeader>
        <p
          className="line-clamp-3 text-sm text-muted-foreground rounded-lg bg-muted/40 p-3"
          dir="auto"
        >
          {idea.content}
        </p>
        {error ? (
          <Button variant="outline" onClick={() => refetch()}>
            {copy("Retry notebooks", "إعادة تحميل الدفاتر")}
          </Button>
        ) : (
          <select
            aria-label={copy("Destination notebook", "الدفتر المطلوب")}
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            disabled={isLoading || update.isPending}
            className="rounded-xl border bg-card p-3 text-sm"
          >
            <option value="">
              {isLoading
                ? copy("Loading…", "جارٍ التحميل…")
                : copy("Choose a notebook", "اختر دفترًا")}
            </option>
            {choices.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.title}
              </option>
            ))}
          </select>
        )}
        {!isLoading && !error && !choices.length && (
          <p className="text-sm text-muted-foreground">
            {copy(
              "Create another notebook from your workspace first.",
              "أنشئ دفترًا آخر من مساحة العمل أولًا.",
            )}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={update.isPending}
            onClick={() => setOpen(false)}
          >
            {copy("Cancel", "إلغاء")}
          </Button>
          <Button
            disabled={!destination || update.isPending}
            onClick={() => void move()}
          >
            {update.isPending
              ? copy("Moving…", "جارٍ النقل…")
              : copy("Move idea", "نقل الفكرة")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
