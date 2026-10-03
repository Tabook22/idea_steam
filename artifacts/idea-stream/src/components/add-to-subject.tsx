import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, ArrowUpRight, BookOpen, BookPlus, Check, Loader2, Plus, Search, X } from "lucide-react";
import {
  addAudioLibraryItemToSubject,
  createSubject,
  getListAudioLibraryQueryKey,
  getListSubjectsQueryKey,
  removeAudioLibraryItemFromSubject,
  useListSubjects,
  type AudioLibraryItem,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/i18n";

/**
 * Put a library recording into any subject (or several), move it between subjects, or take it
 * out of one. The recording itself always stays in the audio library.
 */
export function AddToSubject({ item, title, onClose }: { item: AudioLibraryItem; title: string; onClose: () => void }) {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: subjects = [], isLoading } = useListSubjects();
  const [links, setLinks] = useState(item.subjects);
  const [busy, setBusy] = useState<number | "new" | null>(null);
  const [filter, setFilter] = useState("");
  const [newTitle, setNewTitle] = useState("");

  const sorted = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase();
    return [...subjects]
      .filter((subject) => !needle || subject.title.toLocaleLowerCase().includes(needle))
      .sort((a, b) => Number(links.some((l) => l.subjectId === b.id)) - Number(links.some((l) => l.subjectId === a.id)) || a.title.localeCompare(b.title));
  }, [subjects, filter, links]);

  const refresh = async (updated: AudioLibraryItem) => {
    setLinks(updated.subjects);
    await queryClient.invalidateQueries({ queryKey: getListAudioLibraryQueryKey() });
    await queryClient.invalidateQueries({ queryKey: getListSubjectsQueryKey() });
  };
  const failed = (error: unknown) => toast({ variant: "destructive", title: copy("That didn't work", "لم ينجح ذلك"), description: (error as { data?: { error?: string } })?.data?.error });

  async function add(subjectId: number, subjectTitle: string, move = false) {
    setBusy(subjectId);
    try {
      let updated = await addAudioLibraryItemToSubject(item.id, { subjectId });
      if (move) for (const link of links) updated = await removeAudioLibraryItemFromSubject(item.id, link.subjectId);
      await refresh(updated);
      toast({ title: move ? copy(`Moved to “${subjectTitle}”`, `نُقلت إلى «${subjectTitle}»`) : copy(`Added to “${subjectTitle}”`, `أُضيفت إلى «${subjectTitle}»`),
        description: copy("It's still in your audio library too.", "وما زالت في مكتبة الصوت أيضًا.") });
    } catch (error) { failed(error); } finally { setBusy(null); }
  }

  async function remove(subjectId: number, subjectTitle: string) {
    setBusy(subjectId);
    try {
      await refresh(await removeAudioLibraryItemFromSubject(item.id, subjectId));
      toast({ title: copy(`Taken out of “${subjectTitle}”`, `أُخرجت من «${subjectTitle}»`), description: copy("The recording stays in your audio library.", "يبقى التسجيل في مكتبة الصوت.") });
    } catch (error) { failed(error); } finally { setBusy(null); }
  }

  async function createAndAdd() {
    const name = newTitle.trim();
    if (!name) return;
    setBusy("new");
    try {
      const subject = await createSubject({ title: name, intro: "" });
      await refresh(await addAudioLibraryItemToSubject(item.id, { subjectId: subject.id }));
      setNewTitle("");
      toast({ title: copy(`New subject “${name}” created`, `أُنشئ موضوع «${name}»`), description: copy("The recording was added to it.", "أُضيف التسجيل إليه.") });
    } catch (error) { failed(error); } finally { setBusy(null); }
  }

  const single = links.length === 1 ? links[0] : null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open && busy === null) onClose(); }}>
      <DialogContent className="flex max-h-[90dvh] max-w-lg flex-col gap-0 p-0" dir={isArabic ? "rtl" : "ltr"}>
        <div className="border-b px-5 pb-3 pt-5">
          <DialogTitle className="flex items-center gap-2"><BookPlus size={18} className="text-primary" />{copy("Add to a subject", "أضف إلى موضوع")}</DialogTitle>
          <DialogDescription className="mt-1">
            <span dir="auto" className="font-medium text-foreground">{title}</span>
            {" · "}{links.length
              ? copy(`In ${links.length} subject${links.length > 1 ? "s" : ""}. It always stays in your audio library.`, `في ${links.length} موضوع. ويبقى دائمًا في مكتبة الصوت.`)
              : copy("Only in your audio library so far.", "في مكتبة الصوت فقط حتى الآن.")}
          </DialogDescription>
          <label className="relative mt-3 flex h-10 items-center rounded-full border bg-card ps-9 pe-3 focus-within:border-primary">
            <Search size={15} className="absolute start-3.5 text-muted-foreground" />
            <input value={filter} onChange={(event) => setFilter(event.target.value)} dir="auto" placeholder={copy("Find a subject", "ابحث عن موضوع")} aria-label={copy("Find a subject", "ابحث عن موضوع")}
              className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none" />
            {filter && <button type="button" onClick={() => setFilter("")} aria-label={copy("Clear", "مسح")} className="text-muted-foreground"><X size={14} /></button>}
          </label>
        </div>

        <ul className="min-h-0 flex-1 divide-y overflow-y-auto px-2">
          {isLoading && <li className="grid place-items-center py-8"><Loader2 className="animate-spin text-primary" /></li>}
          {!isLoading && !sorted.length && <li className="px-3 py-6 text-center text-sm text-muted-foreground">{copy("No subjects match. Create one below.", "لا توجد مواضيع مطابقة. أنشئ واحدًا أدناه.")}</li>}
          {sorted.map((subject) => {
            const link = links.find((l) => l.subjectId === subject.id);
            return (
              <li key={subject.id} className="flex items-center gap-2 px-3 py-2.5">
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${link ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>
                  {link ? <Check size={15} /> : <BookOpen size={15} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span dir="auto" className="block truncate text-sm font-medium">{subject.title}</span>
                  {link && <span className="block text-[11px] text-primary">{copy("Added", "مُضافة")}</span>}
                </span>
                {busy === subject.id ? <Loader2 size={16} className="animate-spin text-primary" /> : link ? (
                  <>
                    <Button size="sm" variant="ghost" className="h-8 rounded-full px-2.5 text-xs" asChild>
                      <Link href={`/subjects/${subject.id}#idea-${link.ideaId}`}>{copy("Open", "افتح")}<ArrowUpRight size={12} className="ms-1 rtl:-scale-x-100" /></Link>
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 rounded-full px-2.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={busy !== null}
                      onClick={() => void remove(subject.id, subject.title)}>{copy("Remove", "إزالة")}</Button>
                  </>
                ) : (
                  <>
                    {single && (
                      <Button size="sm" variant="ghost" className="h-8 rounded-full px-2.5 text-xs" disabled={busy !== null} onClick={() => void add(subject.id, subject.title, true)}
                        title={copy(`Take it out of “${single.subjectTitle}” and put it here`, `أخرجها من «${single.subjectTitle}» وضعها هنا`)}>
                        <ArrowRightLeft size={12} className="me-1" />{copy("Move here", "انقل هنا")}
                      </Button>
                    )}
                    <Button size="sm" className="h-8 rounded-full px-3 text-xs" disabled={busy !== null} onClick={() => void add(subject.id, subject.title)}>
                      <Plus size={12} className="me-1" />{copy("Add", "أضف")}
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>

        <form className="flex items-center gap-2 border-t px-5 py-3" onSubmit={(event) => { event.preventDefault(); void createAndAdd(); }}>
          <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} dir="auto" maxLength={200} placeholder={copy("New subject name", "اسم موضوع جديد")} aria-label={copy("New subject name", "اسم موضوع جديد")}
            className="h-10 min-w-0 flex-1 rounded-full border bg-card px-4 text-sm outline-none focus:border-primary" />
          <Button type="submit" variant="outline" className="h-10 rounded-full" disabled={!newTitle.trim() || busy !== null}>
            {busy === "new" ? <Loader2 size={15} className="me-1.5 animate-spin" /> : <Plus size={15} className="me-1.5" />}{copy("Create & add", "أنشئ وأضف")}
          </Button>
        </form>
        <div className="flex justify-end px-5 pb-4"><Button variant="ghost" onClick={onClose} disabled={busy !== null}>{copy("Done", "تم")}</Button></div>
      </DialogContent>
    </Dialog>
  );
}
