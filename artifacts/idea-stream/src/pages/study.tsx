import { useEffect, useState } from "react";
import { Link } from "wouter";
import { FileText, GraduationCap, Headphones, Layers, ListChecks, Loader2, NotebookPen } from "lucide-react";
import { useLanguage } from "@/lib/i18n";
import { listPacks, type StudySummary } from "@/lib/study-api";

/** All study packs, with what's due to review. */
export default function StudyPage() {
  const { isArabic, language } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const [packs, setPacks] = useState<StudySummary[] | null>(null);
  useEffect(() => { void listPacks().then(setPacks).catch(() => setPacks([])); }, []);
  const due = (packs ?? []).reduce((sum, pack) => sum + pack.dueCount, 0);
  const sourceIcon = { recording: Headphones, subject: NotebookPen, draft: FileText };
  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-16 pt-2 sm:px-6">
      <h1 className="font-serif text-4xl tracking-tight">{copy("Study", "الدراسة")}</h1>
      <p className="mt-1 max-w-xl text-sm text-muted-foreground">
        {copy("Study packs made from your lectures, notebooks and drafts: notes, a quiz, flashcards and handouts. Make one from a recording (Library), a notebook, or a draft.",
          "حزم دراسية من محاضراتك ودفاترك ومسوداتك: ملخص واختبار وبطاقات ومطبوعات. اصنع واحدة من تسجيل (المكتبة) أو دفتر أو مسودة.")}
      </p>
      {due > 0 && <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-2 text-sm font-semibold text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200"><Layers size={16} />{copy(`${due} flashcards to review today`, `${due} بطاقة للمراجعة اليوم`)}</p>}
      {!packs ? (
        <div className="grid h-40 place-items-center text-muted-foreground"><Loader2 className="animate-spin" /></div>
      ) : !packs.length ? (
        <div className="mx-auto mt-8 max-w-md rounded-3xl border border-dashed p-8 text-center">
          <GraduationCap size={40} className="mx-auto text-emerald-600" />
          <p className="mt-3 font-serif text-2xl">{copy("No study packs yet", "لا حزم بعد")}</p>
          <p className="mt-2 text-sm text-muted-foreground">{copy("Open a recording in the Library, a notebook, or a draft and choose “Study pack”.", "افتح تسجيلًا في المكتبة أو دفترًا أو مسودة واختر «حزمة دراسية».")}</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {packs.map((pack) => {
            const Icon = sourceIcon[pack.sourceKind];
            return (
              <Link key={pack.id} href={`/study/${pack.id}`} className="group rounded-3xl border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon size={13} />{pack.sourceKind === "recording" ? copy("Recording", "تسجيل") : pack.sourceKind === "subject" ? copy("Notebook", "دفتر") : copy("Draft", "مسودة")} · {new Date(pack.createdAt).toLocaleDateString(language, { day: "numeric", month: "short" })}</p>
                <p dir="auto" className="mt-1 font-serif text-xl leading-snug group-hover:text-primary">{pack.title}</p>
                {pack.status === "making" ? <p className="mt-3 flex items-center gap-1.5 text-sm text-emerald-700"><Loader2 size={14} className="animate-spin" />{copy("Being prepared…", "قيد الإعداد…")}</p>
                  : pack.status === "failed" ? <p className="mt-3 text-sm text-rose-600">{copy("Couldn't be made: open to try again", "تعذر الإنشاء: افتحها للمحاولة مجددًا")}</p>
                  : (
                    <p className="mt-3 flex flex-wrap gap-2 text-xs">
                      <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1"><ListChecks size={12} />{copy(`${pack.questionCount} questions`, `${pack.questionCount} سؤال`)}</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1"><Layers size={12} />{copy(`${pack.cardCount} cards`, `${pack.cardCount} بطاقة`)}</span>
                      {pack.dueCount > 0 && <span className="rounded-full bg-emerald-600 px-2.5 py-1 font-semibold text-white">{copy(`${pack.dueCount} due`, `${pack.dueCount} للمراجعة`)}</span>}
                    </p>
                  )}
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
