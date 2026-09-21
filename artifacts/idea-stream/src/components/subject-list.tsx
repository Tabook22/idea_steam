import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { formatDateTime } from "@/lib/formatters";
import {
  getListSubjectsQueryKey,
  type Subject,
  useDeleteSubject,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowRight,
  BookOpen,
  BookType,
  CalendarClock,
  Grid2X2,
  List,
  Search,
  Trash2,
  Plus,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

type ViewMode = "cards" | "list";
type SortMode = "newest" | "oldest" | "title" | "ideas";

interface SubjectListProps {
  subjects: Subject[];
  onCreate?: () => void;
}

export function SubjectList({ subjects, onCreate }: SubjectListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [subjectToDelete, setSubjectToDelete] = useState<Subject | null>(null);
  const { language, isArabic, t } = useLanguage();
  const queryClient = useQueryClient();
  const deleteSubject = useDeleteSubject();
  const { toast } = useToast();

  const filteredSubjects = subjects
    .filter(
      (subject) =>
        subject.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (subject.intro &&
          subject.intro.toLowerCase().includes(searchQuery.toLowerCase())),
    )
    .sort((a, b) => {
      if (sortMode === "oldest") {
        return (
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      }
      if (sortMode === "title") {
        return a.title.localeCompare(b.title, language);
      }
      if (sortMode === "ideas") {
        return b.ideaCount - a.ideaCount;
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

  const handleDelete = () => {
    if (!subjectToDelete) return;

    deleteSubject.mutate(
      { subjectId: subjectToDelete.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getListSubjectsQueryKey(),
          });
          toast({ title: t("subjectDeleted") });
          setSubjectToDelete(null);
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: t("error"),
            description: t("deleteSubjectFailed"),
          });
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("searchSubjects")}
            aria-label={t("searchSubjects")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="ps-9 bg-card border-card-border"
          />
        </div>
        <div className="flex gap-2">
          <Select
            value={sortMode}
            onValueChange={(value) => setSortMode(value as SortMode)}
          >
            <SelectTrigger
              className="flex-1 sm:w-44 bg-card"
              aria-label={t("sortSubjects")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">{t("sortNewest")}</SelectItem>
              <SelectItem value="oldest">{t("sortOldest")}</SelectItem>
              <SelectItem value="title">{t("sortTitle")}</SelectItem>
              <SelectItem value="ideas">{t("sortIdeas")}</SelectItem>
            </SelectContent>
          </Select>
          <div
            className="flex rounded-md border bg-card p-0.5"
            aria-label={t("viewStyle")}
          >
            <Button
              type="button"
              size="icon"
              variant={viewMode === "cards" ? "secondary" : "ghost"}
              onClick={() => setViewMode("cards")}
              aria-label={t("cardView")}
              aria-pressed={viewMode === "cards"}
              title={t("cardView")}
            >
              <Grid2X2 className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant={viewMode === "list" ? "secondary" : "ghost"}
              onClick={() => setViewMode("list")}
              aria-label={t("listView")}
              aria-pressed={viewMode === "list"}
              title={t("listView")}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {filteredSubjects.length === 0 ? (
        <div className="text-center py-10 sm:py-12 px-4 border border-dashed rounded-xl border-border">
          <BookType className="mx-auto h-10 w-10 sm:h-12 sm:w-12 text-muted-foreground/50 mb-3" />
          <p className="text-muted-foreground font-serif text-base sm:text-lg">
            {searchQuery
              ? isArabic
                ? "لا توجد دفاتر مطابقة"
                : "No matching notebooks"
              : t("noSubjects")}
          </p>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            {searchQuery ? t("trySearch") : t("createFirst")}
          </p>
          {!searchQuery && onCreate && (
            <Button className="mt-5" onClick={onCreate}>
              <Plus className="me-2 h-4 w-4" />
              {isArabic ? "ابدأ دفترك الأول" : "Start your first notebook"}
            </Button>
          )}
          {searchQuery && (
            <Button
              variant="outline"
              className="mt-5"
              onClick={() => setSearchQuery("")}
            >
              {isArabic ? "مسح البحث" : "Clear search"}
            </Button>
          )}
        </div>
      ) : (
        <div
          className={
            viewMode === "cards"
              ? "grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
              : "flex flex-col gap-3"
          }
        >
          {filteredSubjects.map((subject) => (
            <Card
              key={subject.id}
              className="notebook-card relative h-full group overflow-hidden"
            >
              <Link href={`/subjects/${subject.id}`} className="block h-full">
                <CardContent
                  className={`p-5 h-full ${viewMode === "cards" ? "flex flex-col min-h-52" : "grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center"} relative`}
                >
                  <div
                    className={viewMode === "cards" ? "contents" : "min-w-0"}
                  >
                    <div className="flex justify-between items-start mb-2 sm:mb-3">
                      <h3 className="font-serif font-medium text-lg line-clamp-2 leading-snug group-hover:text-primary transition-colors pe-2">
                        {subject.title}
                      </h3>
                      <div className="h-8 w-8 rounded-lg bg-primary/5 flex items-center justify-center shrink-0 ms-2 me-7 group-hover:bg-primary/10 transition-colors">
                        <BookOpen className="h-4 w-4 text-primary" />
                      </div>
                    </div>

                    {subject.intro ? (
                      <p className="text-xs leading-relaxed text-muted-foreground line-clamp-2 mb-4 flex-1">
                        {subject.intro}
                      </p>
                    ) : (
                      <p className="text-xs leading-relaxed text-muted-foreground/70 mb-4 flex-1">
                        {isArabic
                          ? "مساحة مفتوحة لأفكارك القادمة."
                          : "An open page for your next thought."}
                      </p>
                    )}

                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
                      <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                      <span>{formatDateTime(subject.updatedAt, language)}</span>
                    </div>
                  </div>

                  <div
                    className={`flex items-center justify-between text-xs text-muted-foreground ${viewMode === "cards" ? "mt-auto pt-4 border-t border-border/50" : "sm:min-w-40 sm:justify-end sm:gap-5"}`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent/80"></span>
                      {new Intl.NumberFormat(language).format(
                        subject.ideaCount,
                      )}{" "}
                      {subject.ideaCount === 1 ? t("fragment") : t("fragments")}
                    </span>
                    <span className="flex items-center gap-1 text-primary">
                      {t("open")}{" "}
                      <ArrowRight
                        className={`h-3 w-3 ${isArabic ? "rotate-180" : ""}`}
                      />
                    </span>
                  </div>
                </CardContent>
              </Link>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="absolute end-3 top-3 z-10 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setSubjectToDelete(subject)}
                aria-label={`${t("deleteSubject")}: ${subject.title}`}
                title={t("deleteSubject")}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog
        open={Boolean(subjectToDelete)}
        onOpenChange={(open) =>
          !open && !deleteSubject.isPending && setSubjectToDelete(null)
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteSubject")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteSubjectConfirm")}
              {subjectToDelete && (
                <span className="mt-2 block font-medium text-foreground">
                  {subjectToDelete.title}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSubject.isPending}>
              {t("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteSubject.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteSubject.isPending ? t("deleting") : t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
