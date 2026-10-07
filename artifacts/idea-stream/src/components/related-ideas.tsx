import { Link } from "wouter";
import { FileText, Loader2, Mic, PenLine, Waypoints } from "lucide-react";
import { getGetRelatedQueryKey, useGetRelated, type RelatedItem } from "@workspace/api-client-react";
import { useLanguage } from "@/lib/i18n";

const dirOf = (text: string) => (/[֐-ࣿ]/.test(text.slice(0, 30)) ? "rtl" : "ltr");

export const relatedHref = (item: Pick<RelatedItem, "kind" | "id" | "subjectId">) =>
  item.kind === "recording" ? `/library#item-${item.id}`
    : item.kind === "draft" ? `/subjects/${item.subjectId}#draft-studio`
      : `/subjects/${item.subjectId}#idea-${item.id}`;

/** Recordings, ideas and drafts closest in meaning to this one, across all notebooks. */
export function RelatedIdeas({ kind, id, className = "" }: { kind: "recording" | "idea"; id: number; className?: string }) {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const params = { kind, id };
  const { data, isLoading, isError } = useGetRelated(params, { query: { queryKey: getGetRelatedQueryKey(params), staleTime: 60_000, retry: false } });
  const go = () => setTimeout(() => window.dispatchEvent(new HashChangeEvent("hashchange")), 50);
  const icon = (item: RelatedItem) => (item.kind === "recording" ? <Mic size={13} /> : item.kind === "draft" ? <PenLine size={13} /> : <FileText size={13} />);

  return (
    <div className={className}>
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Waypoints size={13} />{copy("Connected ideas", "أفكار مترابطة")}
      </p>
      {isLoading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={13} className="animate-spin" />{copy("Looking for connections…", "جارٍ البحث عن روابط…")}</p>
      ) : isError ? (
        <p className="text-xs text-muted-foreground">{copy("Connections are unavailable right now.", "الروابط غير متاحة الآن.")}</p>
      ) : !data?.length ? (
        <p className="text-xs text-muted-foreground">{copy("Nothing closely related yet. Connections appear as you capture more.", "لا يوجد ما يرتبط بها بعد. تظهر الروابط كلما التقطت المزيد.")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {data.map((item) => (
            <li key={`${item.kind}-${item.id}`}>
              <Link href={relatedHref(item)} onClick={go}
                className="flex items-start gap-2.5 rounded-xl border bg-background/60 px-3 py-2 transition-colors hover:border-primary/40 hover:bg-primary/5">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">{icon(item)}</span>
                <span className="min-w-0 flex-1">
                  <span dir={dirOf(item.title)} className="line-clamp-1 block text-start text-sm">{item.title}</span>
                  {item.subjectTitle && <span dir="auto" className="block text-[11px] text-muted-foreground">{item.subjectTitle}</span>}
                </span>
                <span className="mt-1 shrink-0 text-[10px] font-semibold tabular-nums text-primary/70" title={copy("How close in meaning", "مدى القرب في المعنى")}>
                  {Math.round(item.score * 100)}%
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
