import { useListSubjects } from "@workspace/api-client-react";
import { CreateSubjectForm } from "@/components/create-subject-form";
import { SubjectList } from "@/components/subject-list";
import { Skeleton } from "@/components/ui/skeleton";
import { useLanguage } from "@/lib/i18n";

export default function HomePage() {
  const { t } = useLanguage();
  const { data: subjects, isLoading, error } = useListSubjects();

  return (
    <div className="min-h-[100dvh] w-full flex flex-col items-center">
      {/* Hero Section */}
      <section className="w-full bg-[#e8e8e4] text-foreground py-16 md:py-24 px-4 md:px-6 relative overflow-hidden">
        {/* Subtle decorative pattern */}
        <div className="absolute inset-0 opacity-5" style={{ backgroundImage: "radial-gradient(circle at 2px 2px, white 1px, transparent 0)", backgroundSize: "32px 32px" }}></div>
        
        <div className="max-w-4xl mx-auto relative z-10">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-serif font-semibold tracking-tight mb-4 text-balance leading-[1.1]">
            {t("shapeThoughts")}
          </h1>
          <p className="text-muted-foreground text-base sm:text-lg md:text-xl max-w-2xl text-balance font-light leading-relaxed">
            {t("heroSubtitle")}
          </p>
          
          <div className="mt-8 sm:mt-10 max-w-xl bg-card rounded-xl p-2 shadow-xl border border-border/50">
            <CreateSubjectForm />
          </div>
        </div>
      </section>

      {/* Main Content */}
      <main className="w-full max-w-5xl mx-auto px-4 md:px-6 py-10 md:py-16 flex-1">
        <div className="flex items-center justify-between mb-6 sm:mb-8">
          <h2 className="text-xl sm:text-2xl font-serif font-semibold tracking-tight">{t("yourSubjects")}</h2>
        </div>

        {isLoading ? (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-40 rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <div className="p-8 text-center bg-destructive/10 rounded-xl text-destructive border border-destructive/20">
            <p className="font-medium mb-1">{t("error")}</p>
            <p className="text-sm opacity-80">{t("createFailed")}</p>
          </div>
        ) : (
          <SubjectList subjects={subjects || []} />
        )}
      </main>
    </div>
  );
}
