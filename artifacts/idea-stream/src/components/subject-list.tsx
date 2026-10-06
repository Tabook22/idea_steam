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
  Palette,
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
import { CoverPicker } from "@/components/cover-picker";
import { coverStyle } from "@/lib/covers";

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
  const [covering, setCovering] = useState<Subject | null>(null);
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
          {filteredSubjects.map((subject) => {
            const count = `${new Intl.NumberFormat(language).format(subject.ideaCount)} ${subject.ideaCount === 1 ? t("fragment") : t("fragments")}`;
            const blurb = subject.latest ?? (subject.intro || null);
            return (
              <Card key={subject.id} className="notebook-card group relative h-full overflow-hidden">
                <Link href={`/subjects/${subject.id}`} className="block h-full">
                  {viewMode === "cards" ? (
                    <div className="flex h-full flex-col">
                      <div className="relative h-28 p-4 text-white transition-[filter] group-hover:brightness-110" style={coverStyle(subject)}>
                        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/20 text-2xl shadow-inner backdrop-blur-sm">
                          {subject.icon ?? <BookOpen className="h-5 w-5" />}
                        </span>
                        <span className="absolute bottom-3 end-4 rounded-full bg-black/25 px-2.5 py-1 text-xs font-semibold backdrop-blur-sm">{count}</span>
                      </div>
                      <CardContent className="flex flex-1 flex-col p-5">
                        <h3 dir="auto" className="line-clamp-2 font-serif text-lg font-medium leading-snug transition-colors group-hover:text-primary">{subject.title}</h3>
                        {blurb ? (
                          <p dir="auto" className={`mt-2 line-clamp-2 flex-1 text-sm leading-6 text-muted-foreground ${subject.latest ? "font-serif italic" : ""}`}>
                            {subject.latest ? `“${blurb}”` : blurb}
                          </p>
                        ) : (
                          <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground/70">
                            {isArabic ? "مساحة مفتوحة لأفكارك القادمة." : "An open page for your next thought."}
                          </p>
                        )}
                        <div className="mt-4 flex items-center justify-between border-t border-border/50 pt-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5 shrink-0" />{formatDateTime(subject.updatedAt, language)}</span>
                          <span className="flex items-center gap-1 text-primary">
                            {t("open")} <ArrowRight className={`h-3 w-3 ${isArabic ? "rotate-180" : ""}`} />
                          </span>
                        </div>
                      </CardContent>
                    </div>
                  ) : (
                    <CardContent className="flex items-center gap-4 p-3 pe-24">
                      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-2xl text-white shadow-sm" style={coverStyle(subject)}>
                        {subject.icon ?? <BookOpen className="h-5 w-5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 dir="auto" className="truncate font-serif text-base font-medium transition-colors group-hover:text-primary">{subject.title}</h3>
                        {blurb && <p dir="auto" className="mt-0.5 truncate text-sm text-muted-foreground">{blurb}</p>}
                        <p className="mt-1 text-xs text-muted-foreground">{count} · {formatDateTime(subject.updatedAt, language)}</p>
                      </div>
                    </CardContent>
                  )}
                </Link>
                <div className={`absolute end-2.5 top-2.5 z-10 flex gap-1 ${viewMode === "cards" ? "text-white" : "top-1/2 -translate-y-1/2 text-muted-foreground"}`}>
                  <Button type="button" size="icon" variant="ghost"
                    className={viewMode === "cards" ? "h-8 w-8 rounded-full bg-black/15 text-white backdrop-blur-sm hover:bg-black/30 hover:text-white" : "h-8 w-8 rounded-full"}
                    onClick={() => setCovering(subject)} aria-label={`${isArabic ? "غلاف الدفتر" : "Notebook cover"}: ${subject.title}`} title={isArabic ? "غلاف الدفتر" : "Notebook cover"}>
                    <Palette className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="icon" variant="ghost"
                    className={viewMode === "cards" ? "h-8 w-8 rounded-full bg-black/15 text-white backdrop-blur-sm hover:bg-red-600/80 hover:text-white" : "h-8 w-8 rounded-full hover:bg-destructive/10 hover:text-destructive"}
                    onClick={() => setSubjectToDelete(subject)} aria-label={`${t("deleteSubject")}: ${subject.title}`} title={t("deleteSubject")}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <CoverPicker subject={covering} onClose={() => setCovering(null)} />

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
